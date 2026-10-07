"""Independent installer regressions using disposable repositories and Mac homes."""

import fcntl
import io
import json
import subprocess
import sys
import unittest
from contextlib import contextmanager, redirect_stdout
from unittest.mock import patch

import test_worktree_cleanup as fixtures


class InstallSafetyTest(unittest.TestCase):
    setUp = fixtures.CleanupTest.setUp
    git = fixtures.CleanupTest.git

    def installer(self):
        with patch.dict(sys.modules, {"worktree_cleanup": self.cleanup}):
            return fixtures.load("install_worktree_maintenance")

    def test_protection_is_persisted_and_locked_before_mac_jobs_start(self):
        installer = self.installer()
        home = self.base / "home"
        installer.install(self.repo, self.state, home, activate=False)
        original_run = self.cleanup.run
        original_subprocess_run = subprocess.run
        starts = []

        def run(args, *rest, **kwargs):
            if args[0] != "launchctl":
                return original_run(args, *rest, **kwargs)
            if args[1] == "bootstrap":
                saved = json.loads((self.state / "installation.json").read_text())
                self.assertEqual(saved["protected_paths"], [str(self.tree)])
                self.assertFalse(saved["activated"])
                # A second independently opened descriptor models another cleanup
                # process: it must not enter while installation changes protection.
                with (self.state / "cleanup.lock").open("a+") as stream:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                starts.append(args)
            return ""

        def subprocess_run(args, *rest, **kwargs):
            if args[0] == "launchctl":
                return subprocess.CompletedProcess(args, 0)
            return original_subprocess_run(args, *rest, **kwargs)

        with (
            patch.object(installer.sys, "platform", "darwin"),
            patch.object(self.cleanup, "run", side_effect=run),
            patch.object(subprocess, "run", side_effect=subprocess_run),
        ):
            result = installer.install(
                self.repo, self.state, home, protected_paths=(self.tree,)
            )
        self.assertEqual(len(starts), 2)
        self.assertTrue(result["activated"])

    def test_cleanup_reads_protection_only_after_entering_shared_lock(self):
        installer = self.installer()
        installer.install(self.repo, self.state, self.base / "home", activate=False)
        original_locked = self.cleanup.locked
        seen = []

        @contextmanager
        def lock_after_install(state, wait=False):
            # The caller has parsed its command, but an installer finishes before
            # this cleanup process gets the lock. It must use that newer decision.
            saved = json.loads((state / "installation.json").read_text())
            saved["protected_paths"] = [str(self.tree)]
            self.cleanup.write_json(state / "installation.json", saved)
            with original_locked(state, wait=wait):
                yield

        def sweep(repo, state, apply):
            seen.append(self.cleanup.PROTECTED_PATHS.copy())
            return []

        with (
            patch.object(
                sys,
                "argv",
                [
                    "cleanup",
                    "--repo",
                    str(self.repo),
                    "--state",
                    str(self.state),
                    "sweep",
                    "--apply",
                ],
            ),
            patch.object(self.cleanup, "locked", side_effect=lock_after_install),
            patch.object(self.cleanup, "sweep", side_effect=sweep),
            redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(self.cleanup.main(), 0)
        self.assertEqual(seen, [{self.tree}])

    def test_removed_historical_admission_does_not_block_runtime_update(self):
        installer = self.installer()
        home = self.base / "home"
        installer.install(
            self.repo,
            self.state,
            home,
            activate=False,
            project="commercialdeals",
            admitted_paths=(self.tree,),
            protected_paths=(self.tree,),
        )
        self.git("worktree", "remove", str(self.tree))
        result = installer.install(
            self.repo, self.state, home, activate=False, project="commercialdeals"
        )
        self.assertEqual(result["admitted_paths"], [str(self.tree)])
        self.assertEqual(result["protected_paths"], [str(self.tree)])
        self.assertFalse(self.tree.exists())

    def test_new_missing_admission_still_fails_without_recording_it(self):
        installer = self.installer()
        home = self.base / "home"
        installer.install(
            self.repo, self.state, home, activate=False, project="commercialdeals"
        )
        missing = self.base / "missing-folder"
        with self.assertRaises(self.cleanup.CleanupError):
            installer.install(
                self.repo,
                self.state,
                home,
                activate=False,
                project="commercialdeals",
                admitted_paths=(missing,),
            )
        saved = json.loads((self.state / "installation.json").read_text())
        self.assertEqual(saved["admitted_paths"], [])


if __name__ == "__main__":
    unittest.main()
