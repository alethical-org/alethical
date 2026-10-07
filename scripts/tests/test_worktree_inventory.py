"""Local inventory reports uncertainty and never turns evidence into deletion."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from scripts import worktree_inventory as inventory


class InventoryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.repo = self.base / "repo"
        self.repo.mkdir()
        self.git("init", "-qb", "main")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "core.hooksPath", "/dev/null")
        (self.repo / "source.txt").write_text("saved\n")
        (self.repo / ".gitignore").write_text(".env\n")
        self.git("add", ".")
        self.git("commit", "-qm", "Fixture")
        self.tree = self.base / "working"
        self.git("worktree", "add", "-qb", "work", str(self.tree))
        self.state = self.base / "state"

    def git(self, *args, root=None):
        return subprocess.check_output(
            ["git", *args], cwd=root or self.repo, text=True, stderr=subprocess.DEVNULL
        ).strip()

    def report(self):
        return inventory.inspect_folders(self.repo, self.state)

    def row(self, path=None):
        return next(
            row
            for row in self.report()["folders"]
            if row["path"] == str(path or self.tree)
        )

    def note(self, owners, path=None):
        identity = self.row(path)["identity"]
        directory = self.state / "owners"
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / (identity["id"] + ".json")
        target.write_text(json.dumps({**identity, "owners": owners}))
        return target

    def test_includes_main_unowned_clean_folders_without_finish_inference(self):
        report = self.report()
        self.assertEqual(len(report["folders"]), 2)
        self.assertEqual(self.row(self.repo)["kind"], "main")
        row = self.row()
        self.assertFalse(row["dirty_source"])
        self.assertEqual(row["finish_decision"], "absent")
        self.assertEqual(row["chat_activity"], "unknown")
        self.assertIn("No recorded owning task", row["issues"])
        self.assertFalse(self.state.exists())

    def test_reports_source_changes_without_names_contents_or_ignored_secrets(self):
        (self.tree / ".env").write_text("PRIVATE_VALUE=secret")
        self.assertFalse(self.row()["dirty_source"])
        (self.tree / "secret-name.txt").write_text("private contents")
        report = self.report()
        self.assertTrue(self.row()["dirty_source"])
        output = json.dumps(report)
        for private in ("secret-name.txt", "private contents", "PRIVATE_VALUE"):
            self.assertNotIn(private, output)

    def test_held_owners_preserved_and_active_is_not_chat_activity(self):
        self.note(
            {
                "owner-a": {"status": "held", "reason": "Private preview remains"},
                "owner-b": {"status": "active"},
            }
        )
        row = self.row()
        self.assertEqual(len(row["owners"]), 2)
        self.assertEqual(row["owners"][0]["reason"], "Private preview remains")
        self.assertEqual(row["finish_decision"], "absent")
        self.assertEqual(row["chat_activity"], "unknown")
        self.note({"owner-a": {"status": "held", "reason": "Review pending"}})
        self.assertEqual(self.row()["finish_decision"], "held")

    def test_old_head_makes_hold_stale(self):
        self.note({"owner": {"status": "held", "reason": "Review pending"}})
        (self.tree / "source.txt").write_text("new\n")
        self.git("add", ".", root=self.tree)
        self.git("commit", "-qm", "New head", root=self.tree)
        row = self.row()
        self.assertEqual(row["owners"][0]["note_identity"], "stale")
        self.assertEqual(row["finish_decision"], "absent")

    def test_same_head_different_branch_makes_hold_stale(self):
        self.note({"owner": {"status": "held", "reason": "Review pending"}})
        head = self.row()["head"]
        self.git("switch", "-qc", "different-branch", root=self.tree)
        row = self.row()
        self.assertEqual(row["head"], head)
        self.assertEqual(row["owners"][0]["note_identity"], "stale")
        self.assertEqual(row["finish_decision"], "absent")

    def test_detached_head_empty_branch_is_valid_identity(self):
        self.git("switch", "-q", "--detach", root=self.tree)
        self.note({"owner": {"status": "held", "reason": "Review pending"}})
        row = self.row()
        self.assertEqual(row["branch"], "")
        self.assertEqual(row["owners"][0]["note_identity"], "current")
        self.assertEqual(row["finish_decision"], "held")

    def test_missing_registered_folder_and_duplicate_registration_are_visible(self):
        shutil.rmtree(self.tree)
        row = self.row()
        self.assertIsNone(row["dirty_source"])
        self.assertTrue(any("missing" in issue for issue in row["issues"]))
        original = inventory.cleanup.registrations(self.repo)
        with patch.object(
            inventory.cleanup, "registrations", return_value=original + [original[0]]
        ):
            self.assertEqual(self.row(self.repo)["registration_count"], 2)
            self.assertIn(
                "Working folder has duplicate Git registrations",
                self.row(self.repo)["issues"],
            )

    def test_foreign_folder_cannot_report_clean(self):
        foreign = self.base / "foreign"
        foreign.mkdir()
        subprocess.run(["git", "init", "-q", str(foreign)], check=True)
        registration = {"worktree": str(foreign), "HEAD": "untrusted"}
        with patch.object(
            inventory.cleanup, "registrations", return_value=[registration]
        ):
            row = self.report()["folders"][0]
        self.assertIsNone(row["dirty_source"])
        self.assertTrue(any("different" in issue for issue in row["issues"]))

    def test_malformed_state_does_not_hide_other_folders(self):
        note = self.note({"owner": {"status": "held", "reason": "Preview"}})
        note.write_text("{ private broken contents")
        report = self.report()
        self.assertEqual(len(report["folders"]), 2)
        self.assertEqual(len(report["state_errors"]), 1)
        self.assertIn("saved note is unreadable or malformed", self.row()["issues"])
        self.assertNotIn("private broken contents", json.dumps(report))

    def test_codex_folder_keeps_all_owners_and_native_archive_route(self):
        codex_home = self.base / "codex"
        native = codex_home / "worktrees" / "fixture" / "repo"
        native.parent.mkdir(parents=True)
        self.git("worktree", "move", str(self.tree), str(native))
        with patch.dict("os.environ", {"CODEX_HOME": str(codex_home)}):
            self.note(
                {
                    "a": {"status": "held", "reason": "Review"},
                    "b": {"status": "active"},
                },
                native,
            )
            row = self.row(native)
        self.assertEqual(row["kind"], "codex")
        self.assertIn("Codex", row["route"])
        self.assertEqual(len(row["owners"]), 2)

    def test_status_failure_stays_unknown_and_commands_are_read_only(self):
        original = inventory.cleanup.run
        calls = []

        def run(args, root=None, check=True):
            calls.append(args)
            self.assertEqual(args[0], "git")
            self.assertIn(args[1], ("rev-parse", "worktree", "status"))
            if args[1] == "worktree":
                self.assertEqual(args[2], "list")
            if args[1] == "status" and root == self.tree:
                raise inventory.cleanup.CleanupError("private Git error")
            return original(args, root, check)

        index = Path(self.row()["identity"]["gitdir"]) / "index"
        before = index.stat().st_mtime_ns
        with patch.object(inventory.cleanup, "run", side_effect=run):
            report = self.report()
        row = next(row for row in report["folders"] if row["path"] == str(self.tree))
        self.assertIsNone(row["dirty_source"])
        self.assertNotIn("private Git error", json.dumps(report))
        self.assertEqual(before, index.stat().st_mtime_ns)
        self.assertFalse(self.state.exists())
        self.assertTrue(calls)

    def test_release_owner_is_visible_and_requires_evidence(self):
        identity = self.row()["identity"]
        directory = self.state / "released"
        directory.mkdir(parents=True)
        target = directory / (identity["id"] + ".json")
        note = {**identity, "owner": "terminal owner", "status": "released"}
        target.write_text(json.dumps(note))
        self.assertEqual(self.row()["finish_decision"], "release receipt missing")
        note["evidence"] = "Delivery accepted and preview stopped"
        target.write_text(json.dumps(note))
        row = self.row()
        self.assertEqual(row["finish_decision"], "released")
        self.assertEqual(row["owners"][0]["owner"], "terminal owner")

    def test_hold_without_reason_is_not_a_finish_decision(self):
        self.note({"owner": {"status": "held"}})
        self.assertEqual(self.row()["finish_decision"], "absent")

    def test_other_identity_fields_make_a_note_stale(self):
        for field in ("path", "common", "gitdir"):
            with self.subTest(field=field):
                target = self.note({"owner": {"status": "held", "reason": "Review"}})
                data = json.loads(target.read_text())
                data[field] += "-changed"
                target.write_text(json.dumps(data))
                self.assertEqual(self.row()["owners"][0]["note_identity"], "stale")

    def test_registration_failure_is_an_error_not_empty_success(self):
        with patch.object(
            inventory.cleanup,
            "registrations",
            side_effect=inventory.cleanup.CleanupError("private"),
        ):
            report = self.report()
        self.assertEqual(report["folders"], [])
        self.assertEqual(
            report["errors"], ["Cannot read Git working-folder registrations"]
        )

    def installation(self, **changes):
        self.state.mkdir(exist_ok=True)
        data = {
            "repository": str(self.repo),
            "project": "alethical",
            "activated": True,
            "admitted_paths": [],
            "protected_paths": [],
            **changes,
        }
        (self.state / "installation.json").write_text(json.dumps(data))

    def test_exact_admission_and_protected_paths_are_visible_without_other_settings(
        self,
    ):
        self.installation(
            admitted_paths=[str(self.tree)],
            protected_paths=[str(self.tree / "preview")],
            private_setting="never-print-me",
        )
        report = self.report()
        row = self.row()
        self.assertEqual(report["project"], "alethical")
        self.assertEqual(report["installation"]["admitted_paths"], [str(self.tree)])
        self.assertEqual(row["protected_by"], [str(self.tree / "preview")])
        self.assertEqual(row["coverage"], "installation hold")
        self.assertTrue(row["admitted"])
        self.assertNotIn("never-print-me", json.dumps(report))

    def test_admitted_path_does_not_admit_children(self):
        self.installation(admitted_paths=[str(self.tree.parent)])
        self.assertEqual(self.row()["coverage"], "outside removal scope")
        self.assertFalse(self.row()["admitted"])
        self.installation(admitted_paths=[str(self.tree)])
        self.assertEqual(self.row()["coverage"], "admitted external cleanup")
        self.assertEqual(self.row()["finish_decision"], "absent")

    def test_builtin_scope_is_project_specific(self):
        builtin = self.base / "alethical-wt-valid"
        self.git("worktree", "move", str(self.tree), str(builtin))
        self.installation()
        self.assertEqual(self.row(builtin)["coverage"], "admitted external cleanup")
        self.installation(project="commercialdeals")
        self.assertEqual(self.row(builtin)["coverage"], "outside removal scope")
        self.assertEqual(self.row(builtin)["project"], "commercialdeals")

    def test_malformed_or_foreign_installation_preserves_unknown_coverage(self):
        for changes in (
            {"protected_paths": "bad"},
            {"repository": "/elsewhere"},
            {"activated": "yes"},
        ):
            with self.subTest(changes=changes):
                self.installation(**changes)
                report = self.report()
                self.assertEqual(report["installation"]["status"], "unknown")
                self.assertTrue(report["state_errors"])
                self.assertIsNone(self.row()["admitted"])
                self.assertEqual(self.row()["coverage"], "unknown")

    def test_default_and_custom_codex_homes_stay_native(self):
        fake_home = self.base / "home"
        with (
            patch.object(Path, "home", return_value=fake_home),
            patch.dict("os.environ", {"CODEX_HOME": str(self.base / "custom")}),
        ):
            for path in (
                fake_home / ".codex/worktrees/tree/repo",
                self.base / "custom/worktrees/tree/repo",
            ):
                self.assertEqual(inventory._kind(path, None)[0], "codex")

    def test_report_generation_time_has_utc_offset(self):
        time = datetime.fromisoformat(self.report()["generated_at"])
        self.assertEqual(time.utcoffset(), timezone.utc.utcoffset(time))


if __name__ == "__main__":
    unittest.main()
