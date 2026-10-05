"""Cleanup/recovery safety using disposable repositories, with no external writes."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if name == "install_worktree_maintenance" and "worktree_cleanup" in sys.modules:
        module.cleanup = sys.modules["worktree_cleanup"]
    return module


class CleanupTest(unittest.TestCase):
    def setUp(self):
        self.cleanup = load("worktree_cleanup")
        self.temp = tempfile.TemporaryDirectory(prefix="alethical-cleanup-test-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.repo = self.base / "Alethical"
        self.repo.mkdir()
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Cleanup fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "core.hooksPath", "/dev/null")
        self.git("config", "gc.auto", "0")
        self.git("config", "maintenance.auto", "false")
        (self.repo / "source.txt").write_text("published source\n")
        (self.repo / ".gitignore").write_text(".env\nprivate/\nnode_modules/\n")
        self.git("add", ".")
        self.git("commit", "-qm", "Published fixture")
        remote = self.base / "origin.git"
        subprocess.run(["git", "init", "--bare", "-q", str(remote)], check=True)
        self.git("remote", "add", "origin", str(remote))
        self.git("push", "-q", "origin", "main")
        self.git("fetch", "-q", "origin", "main")
        self.tree = self.base / "alethical-wt-fixture"
        self.git("worktree", "add", "-qb", "fixture", str(self.tree))
        self.state = self.base / "maintenance"
        self.prs = []
        original = self.cleanup.run

        def run(args, root=None, check=True):
            if args[0] == "gh":
                return json.dumps(self.prs)
            return original(args, root, check)

        self.addCleanup(patch.stopall)
        patch.object(self.cleanup, "run", side_effect=run).start()
        patch.object(self.cleanup, "process_paths", return_value=[]).start()

    def git(self, *args, root=None):
        return subprocess.check_output(
            ["git", "-c", "gc.auto=0", "-c", "maintenance.auto=false", *args],
            cwd=root or self.repo,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()

    def release(self):
        return self.cleanup.release(
            self.repo,
            self.state,
            self.tree,
            "owning fixture task",
            "Delivery accepted; preview released",
        )

    def test_unreleased_folder_is_never_inferred_finished(self):
        self.assertEqual(self.cleanup.sweep(self.repo, self.state, True), [])
        self.assertTrue(self.tree.exists())

    def test_real_removal_and_independent_recovery_of_code_and_private_settings(self):
        (self.tree / ".env").write_text("private fixture setting\n")
        (self.tree / "private").mkdir()
        (self.tree / "private/note.txt").write_text("keep my note\n")
        (self.tree / "node_modules").mkdir()
        (self.tree / "node_modules/download.txt").write_text("replaceable download")
        self.git("worktree", "lock", "--reason", "fixture ownership", str(self.tree))
        record = self.release()
        result = self.cleanup.sweep(self.repo, self.state, True)
        self.assertEqual(result[0]["state"], "removed")
        self.assertFalse(self.tree.exists())
        self.assertIn("fixture", self.git("branch", "--list"))
        # Recovery remains independent even after losing the entire source repository.
        saved_repo = self.repo.with_name("unavailable-original")
        self.repo.rename(saved_repo)
        restored = self.base / "recovered"
        self.cleanup.restore(self.state, record["id"], restored)
        self.assertEqual((restored / "source.txt").read_text(), "published source\n")
        self.assertEqual((restored / ".env").read_text(), "private fixture setting\n")
        self.assertEqual((restored / "private/note.txt").read_text(), "keep my note\n")
        self.assertFalse((restored / "node_modules").exists())

    def test_ignored_link_contents_restore_without_overwriting_shared_target(self):
        target = self.base / "shared-private-settings"
        target.write_text("private original")
        (self.tree / ".env").symlink_to(target)
        record = self.release()
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "removed"
        )
        target.write_text("new shared setting")
        recovered = self.base / "recovered"
        self.cleanup.restore(self.state, record["id"], recovered)
        self.assertEqual((recovered / ".env").read_text(), "private original")
        self.assertEqual(target.read_text(), "new shared setting")

    def test_dirty_tracked_and_untracked_work_holds_released_folder(self):
        self.release()
        for filename in ("source.txt", "new-unsaved.txt"):
            with self.subTest(filename=filename):
                file = self.tree / filename
                file.write_text("unfinished")
                self.assertEqual(
                    self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "held"
                )
                self.assertTrue(self.tree.exists())
                if filename == "source.txt":
                    self.git("restore", "source.txt", root=self.tree)
                else:
                    file.unlink()

    def test_head_change_invalidates_previous_release(self):
        self.release()
        (self.tree / "source.txt").write_text("new work")
        self.git("commit", "-qam", "Work resumed", root=self.tree)
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "held"
        )
        self.assertTrue(self.tree.exists())

    def test_open_preview_holds_folder_then_retry_removes_it(self):
        self.release()
        with patch.object(
            self.cleanup, "process_paths", return_value=[str(self.tree / "source.txt")]
        ):
            self.assertEqual(
                self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "held"
            )
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "removed"
        )

    def test_open_change_blocks_even_if_head_is_in_main(self):
        self.prs = [{"state": "OPEN"}]
        with self.assertRaises(self.cleanup.CleanupError):
            self.release()
        self.assertTrue(self.tree.exists())

    def test_squash_merge_needs_exact_head_and_published_merge_commit(self):
        (self.tree / "source.txt").write_text("feature")
        self.git("commit", "-qam", "Feature fixture", root=self.tree)
        head = self.git("rev-parse", "HEAD", root=self.tree)
        self.prs = [
            {
                "state": "MERGED",
                "headRefOid": head,
                "mergeCommit": {"oid": self.git("rev-parse", "origin/main")},
                "url": "https://example.invalid/change",
            }
        ]
        self.assertEqual(self.release()["proof"]["kind"], "exact merged change")
        self.prs[0]["headRefOid"] = "f" * 40
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "held"
        )

    def test_archive_failure_keeps_folder_and_original_lock(self):
        self.git("worktree", "lock", "--reason", "owner lock", str(self.tree))
        self.release()
        with patch.object(
            self.cleanup,
            "archive",
            side_effect=self.cleanup.CleanupError("fixture backup failed"),
        ):
            self.assertEqual(
                self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "held"
            )
        self.assertIn("locked owner lock", self.git("worktree", "list", "--porcelain"))

    def test_new_source_during_remove_refuses_and_relocks(self):
        self.git("worktree", "lock", "--reason", "owner lock", str(self.tree))
        self.release()
        original = self.cleanup.git

        def git(root, *args):
            if args[:2] == ("worktree", "remove"):
                (self.tree / "late-unsaved.txt").write_text("preserve me")
                self.assertNotIn("--force", args)
            return original(root, *args)

        with patch.object(self.cleanup, "git", side_effect=git):
            self.assertEqual(
                self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "held"
            )
        self.assertEqual((self.tree / "late-unsaved.txt").read_text(), "preserve me")
        self.assertIn("locked owner lock", self.git("worktree", "list", "--porcelain"))

    def test_main_codex_symlink_nested_and_missing_folders_are_protected(self):
        for folder in [self.repo, self.base / "missing"]:
            with (
                self.subTest(folder=folder),
                self.assertRaises(self.cleanup.CleanupError),
            ):
                self.cleanup.identity(self.repo, folder)
        alias = self.base / "alethical-wt-link"
        alias.symlink_to(self.tree)
        with self.assertRaises(self.cleanup.CleanupError):
            self.cleanup.identity(self.repo, alias)
        with (
            patch.dict("os.environ", {"CODEX_HOME": str(self.base)}),
            self.assertRaises(self.cleanup.CleanupError),
        ):
            native = self.base / "worktrees/fixture/Alethical"
            native.parent.mkdir(parents=True)
            self.git("worktree", "move", str(self.tree), str(native))
            self.cleanup.identity(self.repo, native)

    def test_nested_repository_is_protected_even_in_dependency_folder(self):
        self.release()
        nested = self.tree / "node_modules/nested"
        nested.mkdir(parents=True)
        subprocess.run(["git", "init", "-q", str(nested)], check=True)
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "held"
        )

    def test_report_only_keeps_files_and_recovery_damage_blocks_restore(self):
        record = self.release()
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, False)[0]["state"], "ready"
        )
        self.assertTrue(self.tree.exists())
        self.cleanup.sweep(self.repo, self.state, True)
        stored = json.loads(
            (self.state / "released" / (record["id"] + ".json")).read_text()
        )
        saved = json.loads(Path(stored["manifest"]).read_text())
        Path(saved["private"]).write_bytes(b"damaged")
        with self.assertRaises(self.cleanup.CleanupError):
            self.cleanup.restore(self.state, record["id"], self.base / "recovered")

    def test_interrupted_removal_still_restores_and_next_sweep_reconciles(self):
        record = self.release()
        original = self.cleanup.write_json

        def write(path, value):
            if value.get("status") == "removed":
                raise OSError("fixture interruption after removal")
            return original(path, value)

        with patch.object(self.cleanup, "write_json", side_effect=write):
            result = self.cleanup.sweep(self.repo, self.state, True)
        self.assertEqual(result[0]["state"], "held")
        self.assertFalse(self.tree.exists())
        self.cleanup.restore(self.state, record["id"], self.base / "recovered")
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "removed"
        )

    def test_resumed_owner_revokes_release_before_new_work(self):
        self.cleanup.register(self.repo, self.state, self.tree, "owning fixture task")
        self.release()
        self.cleanup.hook(
            self.repo,
            self.state,
            {
                "cwd": str(self.tree),
                "session_id": "owning fixture task",
                "hook_event_name": "UserPromptSubmit",
            },
        )
        self.assertEqual(self.cleanup.sweep(self.repo, self.state, True), [])
        self.assertTrue(self.tree.exists())

    def test_stop_gate_requires_explicit_hold_or_release_never_infers_completion(self):
        payload = {
            "cwd": str(self.tree),
            "session_id": "owning fixture task",
            "hook_event_name": "SessionStart",
        }
        self.cleanup.hook(self.repo, self.state, payload)
        payload["hook_event_name"] = "Stop"
        self.assertEqual(
            self.cleanup.hook(self.repo, self.state, payload)["decision"], "block"
        )
        self.cleanup.retain(
            self.repo,
            self.state,
            self.tree,
            "owning fixture task",
            "waiting for user review",
        )
        self.assertIsNone(self.cleanup.hook(self.repo, self.state, payload))
        self.assertEqual(self.cleanup.sweep(self.repo, self.state, True), [])
        self.release()
        self.assertIsNone(self.cleanup.hook(self.repo, self.state, payload))

    def test_hook_from_subfolder_registers_actual_root_and_dirty_turn_can_stop(self):
        subfolder = self.tree / "private"
        subfolder.mkdir()
        payload = {
            "cwd": str(subfolder),
            "session_id": "fixture",
            "hook_event_name": "SessionStart",
        }
        self.cleanup.hook(self.repo, self.state, payload)
        self.assertEqual(len(list((self.state / "owners").glob("*.json"))), 1)
        (self.tree / "source.txt").write_text("unfinished")
        payload["hook_event_name"] = "Stop"
        self.assertIsNone(self.cleanup.hook(self.repo, self.state, payload))

    def test_multiple_owners_all_need_to_release(self):
        self.cleanup.register(self.repo, self.state, self.tree, "owning fixture task")
        self.cleanup.register(self.repo, self.state, self.tree, "another fixture task")
        self.release()
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "held"
        )
        self.cleanup.release(
            self.repo,
            self.state,
            self.tree,
            "another fixture task",
            "preview completed",
        )
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "removed"
        )

    def test_hidden_working_file_flags_block_cleanup(self):
        self.release()
        for flag in ["--assume-unchanged", "--skip-worktree"]:
            self.git("update-index", flag, "source.txt", root=self.tree)
            (self.tree / "source.txt").write_text("hidden unfinished work")
            self.assertEqual(
                self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "held"
            )
            self.assertTrue(self.tree.exists())
            self.git(
                "update-index", "--no-assume-unchanged", "source.txt", root=self.tree
            )
            self.git("update-index", "--no-skip-worktree", "source.txt", root=self.tree)
            self.git("restore", "source.txt", root=self.tree)

    def test_one_bad_receipt_does_not_block_other_released_work(self):
        self.release()
        (self.state / "released/broken.json").write_text("malformed")
        states = {
            row["state"] for row in self.cleanup.sweep(self.repo, self.state, True)
        }
        self.assertEqual(states, {"removed", "held"})

    def test_python_in_removed_worktree_cannot_be_installed_as_permanent_runner(self):
        with patch.dict(sys.modules, {"worktree_cleanup": self.cleanup}):
            installer = load("install_worktree_maintenance")
        candidate = self.tree / ".venv/bin/python3"
        with (
            patch.object(installer.shutil, "which", return_value=str(candidate)),
            patch.object(installer.sys, "executable", str(candidate)),
        ):
            selected = installer.durable_python(self.repo)
        self.assertNotIn(str(self.tree), selected)

    def interrupted_remainder(self, contents):
        record = self.release()
        saved = self.cleanup.archive(self.repo, self.state, record)
        record.update(
            status="removing",
            manifest=str(Path(saved["private"]).with_name("manifest.json")),
        )
        receipt = self.state / "released" / (record["id"] + ".json")
        self.cleanup.write_json(receipt, record)
        self.git("worktree", "remove", str(self.tree))
        self.tree.mkdir()
        for filename, content in contents.items():
            (self.tree / filename).write_text(content)
        return record

    def test_finder_only_remainder_finishes_and_source_can_be_restored(self):
        record = self.interrupted_remainder({".DS_Store": "Finder metadata"})
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, False)[0]["state"],
            "reconcile ready",
        )
        self.assertTrue(self.tree.exists())
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "removed"
        )
        recovered = self.base / "recovered"
        self.cleanup.restore(self.state, record["id"], recovered)
        self.assertEqual((recovered / "source.txt").read_text(), "published source\n")

    def test_saved_source_remainder_is_removed_but_new_work_is_held(self):
        self.interrupted_remainder({"source.txt": "new work after removal"})
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "held"
        )
        self.assertEqual(
            (self.tree / "source.txt").read_text(), "new work after removal"
        )
        (self.tree / "source.txt").write_text("published source\n")
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "removed"
        )

    def test_changed_head_requires_a_new_finish_decision(self):
        owner = "owning fixture task"
        self.cleanup.register(self.repo, self.state, self.tree, owner)
        self.cleanup.retain(self.repo, self.state, self.tree, owner, "old review")
        self.git(
            "commit", "--allow-empty", "-qm", "new published version", root=self.tree
        )
        self.git("push", "-q", "origin", "HEAD:main", root=self.tree)
        payload = {
            "cwd": str(self.tree),
            "session_id": owner,
            "hook_event_name": "Stop",
        }
        self.assertEqual(
            self.cleanup.hook(self.repo, self.state, payload)["decision"], "block"
        )

    def test_stop_refreshes_main_before_recognizing_finished_clean_work(self):
        owner = "owning fixture task"
        self.cleanup.register(self.repo, self.state, self.tree, owner)
        self.git("commit", "--allow-empty", "-qm", "new version", root=self.tree)
        head = self.git("rev-parse", "HEAD", root=self.tree)
        self.git("push", "-q", "origin", "HEAD:main", root=self.tree)
        self.git("fetch", "origin", "main")
        old = self.git("rev-parse", "HEAD", root=self.repo)
        self.git("update-ref", "refs/remotes/origin/main", old)
        self.assertNotEqual(head, old)
        payload = {
            "cwd": str(self.tree),
            "session_id": owner,
            "hook_event_name": "Stop",
        }
        self.assertEqual(
            self.cleanup.hook(self.repo, self.state, payload)["decision"], "block"
        )
        self.assertEqual(self.git("rev-parse", "origin/main"), head)

    def test_reused_folder_keeps_distinct_private_recovery_generations(self):
        (self.tree / ".env").write_text("first settings")
        old = self.release()
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "removed"
        )
        self.git("worktree", "add", "-q", str(self.tree), "fixture")
        (self.tree / ".env").write_text("replacement settings")
        new = self.release()
        self.assertEqual(old["id"], new["id"])
        self.assertNotEqual(old["recovery_id"], new["recovery_id"])
        self.assertEqual(
            self.cleanup.sweep(self.repo, self.state, True)[0]["state"], "removed"
        )
        for record, expected in (
            (old, "first settings"),
            (new, "replacement settings"),
        ):
            destination = self.base / record["recovery_id"]
            self.cleanup.restore(self.state, record["recovery_id"], destination)
            self.assertEqual((destination / ".env").read_text(), expected)

    def test_watcher_waits_for_release_lock_instead_of_losing_the_event(self):
        import threading

        completed = threading.Event()

        def worker():
            with self.cleanup.locked(self.state, wait=True):
                completed.set()

        with self.cleanup.locked(self.state):
            thread = threading.Thread(target=worker)
            thread.start()
            self.assertFalse(completed.wait(0.05))
        thread.join(timeout=2)
        self.assertTrue(completed.is_set())

    def test_release_needs_active_matching_scheduler(self):
        with self.assertRaises((OSError, self.cleanup.CleanupError)):
            self.cleanup.require_scheduler(self.repo, self.state)
        self.cleanup.write_json(
            self.state / "installation.json",
            {"activated": True, "repository": str(self.repo)},
        )
        with (
            patch.object(self.cleanup.sys, "platform", "darwin"),
            patch.object(self.cleanup, "run", return_value=""),
            patch.object(self.cleanup, "git", return_value=str(self.repo / ".git")),
        ):
            self.cleanup.require_scheduler(self.repo, self.state)

    def test_installer_rejects_runtime_storage_in_a_removable_folder(self):
        with patch.dict(sys.modules, {"worktree_cleanup": self.cleanup}):
            installer = load("install_worktree_maintenance")
        with self.assertRaises(self.cleanup.CleanupError):
            installer.install(
                self.repo, self.tree / "maintenance", self.base / "home", activate=False
            )
        self.assertFalse((self.tree / "maintenance").exists())

    def test_conflicting_plugin_path_does_not_replace_jobs(self):
        with patch.dict(sys.modules, {"worktree_cleanup": self.cleanup}):
            installer = load("install_worktree_maintenance")
        fake_home = self.base / "home"
        plugin = fake_home / ".claude/skills/alethical-worktree-maintenance"
        plugin.mkdir(parents=True)
        with self.assertRaises(self.cleanup.CleanupError):
            installer.install(self.repo, self.state, fake_home, activate=False)
        self.assertFalse((fake_home / "Library/LaunchAgents").exists())

    def test_installer_uses_stable_runtime_and_preserves_previous_job(self):
        with patch.dict(sys.modules, {"worktree_cleanup": self.cleanup}):
            installer = load("install_worktree_maintenance")
        fake_home = self.base / "home"
        agents = fake_home / "Library/LaunchAgents"
        agents.mkdir(parents=True)
        previous = agents / "com.alethical.wip-backup.plist"
        previous.write_bytes(b"previous fixture configuration")
        installed = installer.install(self.repo, self.state, fake_home, activate=False)
        self.assertTrue(Path(installed["runtime"]).is_dir())
        self.assertTrue(any((self.state / "previous-installations").glob("*.plist")))
        import plistlib

        job = plistlib.loads(
            (agents / "com.alethical.worktree-cleanup.plist").read_bytes()
        )
        self.assertIn("--apply", job["ProgramArguments"])
        self.assertEqual(job["StartInterval"], 86400)
        self.assertEqual(job["WatchPaths"], [str(self.state / "released")])
        self.assertNotIn(str(self.tree), str(job))


if __name__ == "__main__":
    unittest.main()
