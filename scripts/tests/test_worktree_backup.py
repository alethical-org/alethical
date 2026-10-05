"""Recover real Git snapshots from disposable worktrees without touching user data."""

from __future__ import annotations

import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "worktree_backup.py"


class WorktreeBackupTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("worktree_backup", SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory(prefix="backup-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "main"
        self.repo.mkdir()
        self.dest = self.root / "backups"
        self.git(self.repo, "init", "-q")
        self.git(self.repo, "config", "user.name", "Test")
        self.git(self.repo, "config", "user.email", "test@example.invalid")
        self.git(self.repo, "config", "core.hooksPath", "/dev/null")
        self.git(self.repo, "config", "gc.auto", "0")
        self.git(self.repo, "config", "maintenance.auto", "false")
        (self.repo / "tracked").write_text("original\n")
        (self.repo / ".gitignore").write_text(".env\n")
        self.git(self.repo, "add", ".")
        self.git(self.repo, "commit", "-qm", "fixture")
        old_mask = os.umask(0o077)
        self.addCleanup(os.umask, old_mask)

    def git(self, root, *args):
        return (
            subprocess.check_output(
                [
                    "git",
                    "-c",
                    "gc.auto=0",
                    "-c",
                    "maintenance.auto=false",
                    "-C",
                    str(root),
                    *args,
                ],
                stderr=subprocess.DEVNULL,
            )
            .decode()
            .strip()
        )

    def worktree(self, parent):
        folder = self.root / parent / "Alethical"
        folder.parent.mkdir()
        self.git(self.repo, "worktree", "add", "-q", "--detach", str(folder))
        return folder

    def manifests(self):
        return [json.loads(p.read_text()) for p in self.dest.glob("*/manifest.json")]

    def test_backup_never_runs_filesystem_monitor_and_keeps_source_and_staging(self):
        (self.repo / "tracked").write_text("staged source\n")
        self.git(self.repo, "add", "tracked")
        (self.repo / "tracked").write_text("on-disk source\n")
        (self.repo / "new").write_text("untracked source\n")
        marker = self.root / "monitor-was-run"
        monitor = self.root / "filesystem-monitor"
        monitor.write_text(
            "#!/bin/sh\nprintf ran >> "
            + shlex.quote(str(marker))
            + "\nprintf 'token\\000/\\000'\n"
        )
        monitor.chmod(0o700)
        self.git(self.repo, "config", "core.fsmonitor", str(monitor))
        self.git(self.repo, "config", "core.fsmonitorHookVersion", "2")
        # Show that the real configured hook works, before testing its suppression.
        status = self.git(self.repo, "status", "--porcelain")
        self.assertTrue(marker.exists())
        marker.unlink()
        index = self.repo / ".git/index"
        index_before = index.read_bytes()
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        self.assertFalse(marker.exists())
        self.assertEqual(index.read_bytes(), index_before)
        self.assertEqual((self.repo / "tracked").read_text(), "on-disk source\n")
        self.assertEqual((self.repo / "new").read_text(), "untracked source\n")
        manifest = self.manifests()[0]
        recovery = self.root / "monitor-recovery"
        recovery.mkdir()
        self.git(recovery, "init", "-q")
        self.git(recovery, "fetch", manifest["bundle"], manifest["ref"])
        self.git(recovery, "checkout", "-q", "--detach", manifest["head"])
        self.git(
            recovery, "restore", "--source", manifest["snapshot"], "--worktree", "."
        )
        self.git(recovery, "read-tree", manifest["index_commit"])
        self.assertEqual((recovery / "tracked").read_text(), "on-disk source\n")
        self.assertEqual((recovery / "new").read_text(), "untracked source\n")
        self.assertEqual(self.git(recovery, "show", ":tracked"), "staged source")
        self.assertEqual(self.git(recovery, "status", "--porcelain"), status)
        self.assertFalse(marker.exists())

    def test_same_basename_has_independent_restorable_bundles_and_preserves_legacy(
        self,
    ):
        a, b = self.worktree("a"), self.worktree("b")
        (a / "new").write_text("first work\n")
        (b / "new").write_text("second work\n")
        self.dest.mkdir()
        legacy = self.dest / "Alethical.bundle"
        legacy.write_bytes(b"old backup")
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        manifests = self.manifests()
        self.assertEqual(len(manifests), 2)
        self.assertEqual(len({m["id"] for m in manifests}), 2)
        self.assertEqual(legacy.read_bytes(), b"old backup")
        for n, manifest in enumerate(manifests):
            recovery = self.root / f"recover-{n}"
            recovery.mkdir()
            self.git(recovery, "init", "-q")
            self.git(recovery, "fetch", manifest["bundle"], manifest["ref"])
            text = self.git(recovery, "show", "FETCH_HEAD:new")
            self.assertEqual(
                text, (Path(manifest["worktree"]) / "new").read_text().strip()
            )
            self.assertEqual(Path(manifest["bundle"]).stat().st_mode & 0o777, 0o600)

    def test_staged_disk_untracked_and_deletion_restore_without_index_changes(self):
        wt = self.worktree("staging")
        (wt / "tracked").write_text("staged\n")
        self.git(wt, "add", "tracked")
        (wt / "tracked").write_text("disk\n")
        (wt / "new").write_text("untracked\n")
        (wt / ".gitignore").unlink()
        status = self.git(wt, "status", "--porcelain")
        index = Path(self.git(wt, "rev-parse", "--absolute-git-dir")) / "index"
        before = index.read_bytes()
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        manifest = self.manifests()[0]
        self.assertEqual(index.read_bytes(), before)
        self.assertEqual(self.git(wt, "status", "--porcelain"), status)
        recovery = self.root / "recovery"
        recovery.mkdir()
        self.git(recovery, "init", "-q")
        self.git(recovery, "fetch", manifest["bundle"], manifest["ref"])
        self.git(recovery, "checkout", "-q", "--detach", manifest["head"])
        self.git(
            recovery, "restore", "--source", manifest["snapshot"], "--worktree", "."
        )
        self.git(recovery, "read-tree", manifest["index_commit"])
        self.assertEqual((recovery / "tracked").read_text(), "disk\n")
        self.assertEqual(self.git(recovery, "show", ":tracked"), "staged")
        self.assertEqual((recovery / "new").read_text(), "untracked\n")
        self.assertFalse((recovery / ".gitignore").exists())
        self.assertEqual(self.git(recovery, "status", "--porcelain"), status)

    def test_unchanged_does_not_rewrite_snapshot_but_missing_bundle_retries(self):
        (self.repo / "tracked").write_text("changed\n")
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        first = self.manifests()[0]
        bundle = Path(first["bundle"])
        mtime = bundle.stat().st_mtime_ns
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        self.assertEqual(self.manifests()[0], first)
        self.assertEqual(bundle.stat().st_mtime_ns, mtime)
        bundle.unlink()
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        self.assertTrue(bundle.exists())
        self.assertEqual(self.manifests()[0]["snapshot"], first["snapshot"])
        bundle.write_bytes(b"broken")
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        self.git(self.repo, "bundle", "verify", str(bundle))

    def test_failed_bundle_returns_failure_preserves_old_bundle_and_retries(self):
        (self.repo / "tracked").write_text("first\n")
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        first = self.manifests()[0]
        bundle = Path(first["bundle"])
        old_bytes = bundle.read_bytes()
        (self.repo / "tracked").write_text("second\n")
        original = self.module.git

        def failing(root, *args, **kwargs):
            if args[:2] == ("bundle", "create"):
                raise self.module.BackupError("fixture failure")
            return original(root, *args, **kwargs)

        with patch.object(self.module, "git", side_effect=failing):
            self.assertEqual(self.module.run(self.repo, self.dest), 1)
        self.assertEqual(bundle.read_bytes(), old_bytes)
        self.assertEqual(self.manifests()[0], first)
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        second = self.manifests()[0]
        self.assertEqual(
            self.git(self.repo, "show", second["snapshot"] + ":tracked"), "second"
        )
        self.git(
            self.repo,
            "merge-base",
            "--is-ancestor",
            first["snapshot"],
            second["snapshot"],
        )

    def test_corrupt_pack_is_never_reported_as_a_successful_backup(self):
        (self.repo / "tracked").write_text("changed\n")
        original = self.module.git

        def corrupting(root, *args, **kwargs):
            result = original(root, *args, **kwargs)
            if args[:2] == ("bundle", "create"):
                bundle = Path(args[2])
                content = bytearray(bundle.read_bytes())
                content[-1] ^= 1
                bundle.write_bytes(content)
            return result

        with patch.object(self.module, "git", side_effect=corrupting):
            self.assertEqual(self.module.run(self.repo, self.dest), 1)
        self.assertEqual(self.manifests(), [])
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        manifest = self.manifests()[0]
        bundle = Path(manifest["bundle"])
        content = bytearray(bundle.read_bytes())
        content[-1] ^= 1
        bundle.write_bytes(content)
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        self.assertEqual(
            self.module.checksum(bundle), self.manifests()[0]["bundle_sha256"]
        )

    def test_missing_and_invalid_registrations_never_backup_parent_or_foreign_repo(
        self,
    ):
        wt = self.worktree("missing")
        shutil.rmtree(wt)
        (self.repo / "tracked").write_text("main edit\n")
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        self.assertEqual(len(self.manifests()), 1)
        nested = self.repo / "nested"
        nested.mkdir()
        original = self.module.git

        def registrations(root, *args, **kwargs):
            if args[:2] == ("worktree", "list"):
                return b"worktree " + os.fsencode(nested) + b"\0\0"
            return original(root, *args, **kwargs)

        with patch.object(self.module, "git", side_effect=registrations):
            self.assertEqual(self.module.run(self.repo, self.dest), 1)
        self.assertEqual(len(self.manifests()), 1)

    def test_concurrent_run_leaves_existing_writer_in_control(self):
        self.dest.mkdir()
        (self.repo / "tracked").write_text("changed\n")
        with (self.dest / ".backup.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.module.run(self.repo, self.dest), 0)
            self.assertEqual(self.manifests(), [])

    def test_thin_bundle_restores_using_a_fresh_origin_clone(self):
        self.git(self.repo, "branch", "-M", "main")
        origin = self.root / "origin.git"
        self.git(self.repo, "clone", "--bare", str(self.repo), str(origin))
        self.git(self.repo, "remote", "add", "origin", str(origin))
        self.git(self.repo, "fetch", "origin")
        (self.repo / "tracked").write_text("local work\n")
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        manifest = self.manifests()[0]
        recovery = self.root / "fresh-clone"
        self.git(self.repo, "clone", str(origin), str(recovery))
        self.git(recovery, "fetch", manifest["bundle"], manifest["ref"])
        self.assertEqual(self.git(recovery, "show", "FETCH_HEAD:tracked"), "local work")

    def test_deleted_squashed_feature_never_becomes_a_recovery_prerequisite(self):
        self.git(self.repo, "branch", "-M", "main")
        origin = self.root / "origin.git"
        self.git(self.repo, "clone", "--bare", str(self.repo), str(origin))
        self.git(self.repo, "remote", "add", "origin", str(origin))
        self.git(self.repo, "checkout", "-qb", "feature")
        (self.repo / "feature").write_text("feature commit\n")
        self.git(self.repo, "add", "feature")
        self.git(self.repo, "commit", "-qm", "Feature history")
        feature_head = self.git(self.repo, "rev-parse", "HEAD")
        self.git(self.repo, "push", "origin", "feature")
        self.git(self.repo, "checkout", "-q", "main")
        self.git(self.repo, "merge", "--squash", "feature")
        self.git(self.repo, "commit", "-qm", "Squashed feature")
        self.git(self.repo, "push", "origin", "main")
        self.git(self.repo, "fetch", "origin")
        self.git(self.repo, "checkout", "-q", "feature")
        (self.repo / "tracked").write_text("unfinished source\n")
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        manifest = self.manifests()[0]
        self.git(self.repo, "push", "origin", "--delete", "feature")
        recovery = self.root / "main-only"
        self.git(
            self.repo,
            "clone",
            "--no-local",
            "--single-branch",
            "--branch",
            "main",
            str(origin),
            str(recovery),
        )
        self.assertNotEqual(
            subprocess.run(
                ["git", "-C", str(recovery), "cat-file", "-e", feature_head],
                capture_output=True,
            ).returncode,
            0,
        )
        self.git(recovery, "fetch", manifest["bundle"], manifest["ref"])
        self.assertEqual(
            self.git(recovery, "show", "FETCH_HEAD:tracked"), "unfinished source"
        )
        self.assertEqual(
            self.git(recovery, "show", manifest["head"] + ":feature"), "feature commit"
        )

    def test_explicitly_staged_ignored_file_keeps_staged_and_disk_versions(self):
        (self.repo / ".env").write_text("staged fixture\n")
        self.git(self.repo, "add", "--force", ".env")
        (self.repo / ".env").write_text("disk fixture\n")
        self.assertEqual(self.module.run(self.repo, self.dest), 0)
        manifest = self.manifests()[0]
        self.assertEqual(
            self.git(self.repo, "show", manifest["index_commit"] + ":.env"),
            "staged fixture",
        )
        self.assertEqual(
            self.git(self.repo, "show", manifest["snapshot"] + ":.env"), "disk fixture"
        )

    def test_changing_index_refuses_snapshot_and_other_worktrees_still_back_up(self):
        wt = self.worktree("healthy")
        (wt / "new").write_text("healthy work\n")
        (self.repo / "tracked").write_text("first edit\n")
        original = self.module.git

        def changing(root, *args, **kwargs):
            result = original(root, *args, **kwargs)
            if root.resolve() == self.repo.resolve() and args == ("write-tree",):
                self.git(self.repo, "add", "tracked")
            return result

        with patch.object(self.module, "git", side_effect=changing):
            self.assertEqual(self.module.run(self.repo, self.dest), 1)
        self.assertEqual(len(self.manifests()), 1)
        self.assertEqual(self.manifests()[0]["worktree"], str(wt.resolve()))

    def test_shell_entrypoint_keeps_environment_overrides_and_excludes_ignored(self):
        (self.repo / "tracked").write_text("changed\n")
        (self.repo / ".env").write_text("private fixture\n")
        env = dict(
            os.environ,
            ALETHICAL_REPO=str(self.repo),
            ALETHICAL_WIP_BACKUP_DIR=str(self.dest),
        )
        subprocess.run(
            ["/bin/sh", str(SCRIPT.with_name("back-up-uncommitted-worktree-work.sh"))],
            env=env,
            check=True,
        )
        manifest = self.manifests()[0]
        names = self.git(self.repo, "ls-tree", "--name-only", manifest["snapshot"])
        self.assertNotIn(".env", names)
        self.assertFalse(manifest["ignored_files_included"])


if __name__ == "__main__":
    unittest.main()
