"""Project separation and native-app safety on disposable working folders."""

import json
import os
import plistlib
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.tests import test_worktree_cleanup as fixtures


class ProfileTest(unittest.TestCase):
    setUp = fixtures.CleanupTest.setUp
    git = fixtures.CleanupTest.git
    release = fixtures.CleanupTest.release

    def installer(self):
        with patch.dict(sys.modules, {"worktree_cleanup": self.cleanup}):
            return fixtures.load("install_worktree_maintenance")

    def test_commercialdeals_requires_exact_admission(self):
        self.cleanup.PROJECT = "commercialdeals"
        with self.assertRaises(self.cleanup.CleanupError):
            self.cleanup.identity(self.repo, self.tree)
        self.cleanup.ADMITTED_PATHS = {self.tree}
        self.assertEqual(
            self.cleanup.identity(self.repo, self.tree)["path"], str(self.tree)
        )
        with self.assertRaises(self.cleanup.CleanupError):
            self.cleanup.identity(self.repo, self.repo)

    def test_admission_cannot_adopt_another_repository(self):
        self.cleanup.ADMITTED_PATHS = {self.base / "other"}
        other = self.base / "other"
        other.mkdir()
        self.git("init", "-q", root=other)
        with self.assertRaises(self.cleanup.CleanupError):
            self.cleanup.identity(self.repo, other)

    def test_preview_protection_survives_an_owner_release_attempt(self):
        self.cleanup.PROTECTED_PATHS = {self.tree}
        self.cleanup.retain(
            self.repo, self.state, self.tree, "preview", "Design preview awaits review"
        )
        with self.assertRaisesRegex(self.cleanup.CleanupError, "installation-level"):
            self.release()
        self.assertTrue(self.tree.exists())

    def test_native_folder_can_record_hold_but_never_release(self):
        native_home = self.base / "native"
        native = native_home / "worktrees/task/project"
        native.parent.mkdir(parents=True)
        self.git("worktree", "add", "--detach", str(native), "HEAD")
        with patch.dict("os.environ", {"CODEX_HOME": str(native_home)}):
            payload = {
                "cwd": str(native),
                "session_id": "native-owner",
                "hook_event_name": "SessionStart",
            }
            self.assertIsNone(self.cleanup.hook(self.repo, self.state, payload))
            payload["hook_event_name"] = "Stop"
            self.assertIsNone(self.cleanup.hook(self.repo, self.state, payload))
            record = self.cleanup.identity(self.repo, native, allow_retained=True)
            target = self.state / "owners" / (record["id"] + ".json")
            before = target.read_bytes()
            with patch.object(
                self.cleanup, "write_json", side_effect=PermissionError("sandbox")
            ):
                with self.assertRaises(PermissionError):
                    self.cleanup.retain(
                        self.repo, self.state, native, "native-owner", "Review pending"
                    )
                payload["stop_hook_active"] = True
                self.assertIsNone(self.cleanup.hook(self.repo, self.state, payload))
            self.assertEqual(target.read_bytes(), before)
            self.assertEqual(
                json.loads(before)["owners"]["native-owner"]["status"], "held"
            )
            self.assertTrue(native.exists())
            payload["stop_hook_active"] = False
            self.cleanup.retain(
                self.repo,
                self.state,
                native,
                "native-owner",
                "Codex protects the primary checkout",
            )
            self.assertIsNone(self.cleanup.hook(self.repo, self.state, payload))
            with self.assertRaisesRegex(self.cleanup.CleanupError, "Codex owns"):
                self.cleanup.release(
                    self.repo, self.state, native, "native-owner", "Done"
                )
            self.assertTrue(native.exists())

    def test_new_version_invalidates_every_old_owner_decision(self):
        self.cleanup.retain(self.repo, self.state, self.tree, "first", "old preview")
        self.git("commit", "--allow-empty", "-qm", "Changed version", root=self.tree)
        record = self.cleanup.register(self.repo, self.state, self.tree, "second")
        self.assertEqual(record["owners"]["first"]["status"], "active")

    def test_project_jobs_and_private_storage_do_not_replace_each_other(self):
        installer = self.installer()
        home = self.base / "home"
        first = installer.install(self.repo, self.state, home, activate=False)
        second_state = self.base / "cd-state"
        second = installer.install(
            self.repo,
            second_state,
            home,
            activate=False,
            project="commercialdeals",
            admitted_paths=(self.tree,),
            protected_paths=(self.tree,),
        )
        self.assertNotEqual(first["labels"], second["labels"])
        self.assertNotEqual(first["backup_directory"], second["backup_directory"])
        self.assertNotEqual(first["claude_plugin"], second["claude_plugin"])
        for result in (first, second):
            for label in result["labels"]:
                data = plistlib.loads(
                    (home / "Library/LaunchAgents" / (label + ".plist")).read_bytes()
                )
                self.assertIn(str(self.repo), data["ProgramArguments"])
        with self.assertRaisesRegex(self.cleanup.CleanupError, "different project"):
            installer.install(
                self.repo, self.state, home, activate=False, project="commercialdeals"
            )
        self.assertFalse((home / ".codex/hooks.json").exists())

    def test_installer_preserves_existing_admissions_and_preview_holds(self):
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
        updated = installer.install(
            self.repo, self.state, home, activate=False, project="commercialdeals"
        )
        self.assertEqual(updated["protected_paths"], [str(self.tree)])
        self.assertEqual(updated["admitted_paths"], [str(self.tree)])

    def test_installed_inventory_runs_outside_the_source_checkout(self):
        installed = self.installer().install(
            self.repo,
            self.state,
            self.base / "home",
            activate=False,
            project="commercialdeals",
            admitted_paths=(self.tree,),
            protected_paths=(self.tree,),
        )
        unrelated = self.base / "unrelated"
        (unrelated / "scripts").mkdir(parents=True)
        (unrelated / "scripts/__init__.py").write_text(
            "raise RuntimeError('unrelated scripts package was imported')\n"
        )
        result = subprocess.run(
            [
                installed["python"],
                str(Path(installed["runtime"]) / "worktree_cleanup.py"),
                "--project",
                "commercialdeals",
                "--repo",
                str(self.repo),
                "--state",
                str(self.state),
                "inspect",
            ],
            cwd=self.base,
            env={**os.environ, "PYTHONPATH": str(unrelated)},
            capture_output=True,
            text=True,
            check=True,
        )
        report = json.loads(result.stdout)
        self.assertFalse(report["errors"])
        folder = next(row for row in report["folders"] if row["path"] == str(self.tree))
        self.assertEqual(folder["coverage"], "installation hold")

    def test_codex_hook_merge_preserves_unrelated_configuration_and_never_trusts(self):
        installer = self.installer()
        home = self.base / "home"
        target = home / ".codex/hooks.json"
        target.parent.mkdir(parents=True)
        original = {
            "description": "my hooks",
            "hooks": {
                "Stop": [
                    {"hooks": [{"type": "command", "command": "existing-command"}]}
                ]
            },
        }
        target.write_text(json.dumps(original))
        for _ in range(2):
            installer.install(
                self.repo, self.state, home, activate=False, install_codex_hooks=True
            )
        result = json.loads(target.read_text())
        self.assertEqual(result["description"], "my hooks")
        self.assertEqual(len(result["hooks"]["Stop"]), 2)
        self.assertEqual(result["hooks"]["Stop"][0], original["hooks"]["Stop"][0])
        self.assertFalse((home / ".codex/config.toml").exists())
        self.assertEqual(
            sorted(p.name for p in (home / ".codex").iterdir()), ["hooks.json"]
        )
        self.assertTrue(
            list((self.state / "previous-installations").glob("codex-hooks-*.json"))
        )


if __name__ == "__main__":
    unittest.main()
