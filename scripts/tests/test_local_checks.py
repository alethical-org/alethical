"""Local check plumbing, using temporary repositories and no database or network."""

from __future__ import annotations

import importlib.util
import io
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "local_checks.py"


def load_checks():
    spec = importlib.util.spec_from_file_location("local_checks", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LocalChecksTest(unittest.TestCase):
    def setUp(self):
        self.checks = load_checks()
        self.temp = tempfile.TemporaryDirectory(prefix="alethical-hook-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Hook test")
        self.git("config", "user.email", "hook@example.invalid")
        self.git("config", "core.hooksPath", "/dev/null")
        (self.root / "first.txt").write_text("first\n")
        self.git("add", ".")
        self.git("commit", "-qm", "Initial fixture")
        self.base = self.git("rev-parse", "HEAD")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, text=True).strip()

    def test_affected_paths_match_ci_and_include_indirect_connections(self):
        root = SCRIPT.parents[1]
        for filename, expected in [
            ("apps/frontend/src/lib/example.ts", {"frontend"}),
            ("api/page.ts", {"frontend"}),
            ("alethical/api/main.py", {"backend"}),
            ("docs/README.md", {"backend"}),
            ("package.json", {"backend", "frontend"}),
            ("justfile", {"backend", "frontend"}),
            (".githooks/pre-push", {"backend", "frontend"}),
            (".github/check-paths.json", {"backend", "frontend"}),
            ("README.md", set()),
        ]:
            with self.subTest(filename=filename):
                self.assertEqual(
                    self.checks.affected_suites(root, [filename]), expected
                )

    def test_push_deletion_needs_no_tests(self):
        data = f"(delete) {'0' * 40} refs/heads/old {self.base}\n"
        self.assertEqual(self.checks.push_targets(self.root, data), [])

    def test_multiple_push_targets_are_all_checked(self):
        self.git("update-ref", "refs/remotes/origin/main", self.base)
        (self.root / "first.txt").write_text("second\n")
        self.git("commit", "-qam", "Second target")
        second = self.git("rev-parse", "HEAD")
        (self.root / "another.txt").write_text("another\n")
        self.git("add", ".")
        self.git("commit", "-qm", "Third target")
        third = self.git("rev-parse", "HEAD")
        targets = self.checks.push_targets(
            self.root,
            f"refs/heads/a {second} refs/heads/a {self.base}\n"
            f"refs/heads/b {third} refs/heads/b {self.base}\n",
        )
        self.assertEqual(
            targets, [(second, ["first.txt"]), (third, ["another.txt", "first.txt"])]
        )

    def test_push_reads_rules_from_saved_commit_not_unfinished_settings(self):
        folder = self.root / ".github"
        folder.mkdir()
        rules = folder / "check-paths.json"
        rules.write_text('{"backend": ["source.py"]}')
        self.git("add", ".")
        self.git("commit", "-qm", "Saved check selection")
        sha = self.git("rev-parse", "HEAD")
        rules.write_text("{}")
        self.assertEqual(
            self.checks.affected_suites(self.root, ["source.py"], sha), {"backend"}
        )

    def test_push_uses_stdin_commit_not_current_head(self):
        (self.root / "first.txt").write_text("second\n")
        self.git("commit", "-qam", "Second fixture")
        head = self.git("rev-parse", "HEAD")
        data = f"refs/heads/main {self.base} refs/heads/main {head}\n"
        self.assertEqual(
            self.checks.push_targets(self.root, data), [(self.base, ["first.txt"])]
        )

    def test_new_branch_compares_to_main_and_includes_deleted_files(self):
        self.git("update-ref", "refs/remotes/origin/main", self.base)
        (self.root / "first.txt").unlink()
        self.git("commit", "-qam", "Delete fixture")
        head = self.git("rev-parse", "HEAD")
        data = f"refs/heads/new {head} refs/heads/new {'0' * 40}\n"
        self.assertEqual(
            self.checks.push_targets(self.root, data), [(head, ["first.txt"])]
        )

    def test_missing_remote_commit_fails_closed(self):
        with self.assertRaises(self.checks.CheckError):
            self.checks.push_targets(
                self.root, f"refs/heads/x {self.base} refs/heads/x {'f' * 40}\n"
            )

    def test_new_branch_without_main_checks_whole_tree(self):
        targets = self.checks.push_targets(
            self.root, f"refs/heads/x {self.base} refs/heads/x {'0' * 40}\n"
        )
        self.assertEqual(targets, [(self.base, ["first.txt"])])

    def test_sanitized_test_environment_has_no_credentials_or_git_overrides(self):
        with patch.dict(
            "os.environ",
            {
                "OPENAI_API_KEY": "not-a-real-key",
                "GIT_DIR": "/elsewhere",
                "DATABASE_URL": "postgresql://example.invalid/production",
                "ALETHICAL_DATABASE_TARGET": "production",
                "PATH": "/bin",
                "ALETHICAL_TEST_DATABASE_URL": "postgresql://example.invalid/shared",
            },
            clear=True,
        ):
            env = self.checks.test_environment(self.root)
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertNotIn("GIT_DIR", env)
        self.assertNotIn("ALETHICAL_TEST_DATABASE_URL", env)
        self.assertEqual(env["ALETHICAL_DATABASE_TARGET"], "local")
        self.assertIn("localhost:54329", env["DATABASE_URL"])

    def test_snapshot_contains_commit_not_unfinished_work_and_is_removed(self):
        (self.root / "first.txt").write_text("unfinished\n")
        (self.root / "untracked.txt").write_text("private unfinished\n")
        with self.checks.commit_snapshot(self.root, self.base) as snapshot:
            self.assertEqual((snapshot / "first.txt").read_text(), "first\n")
            self.assertFalse((snapshot / "untracked.txt").exists())
            self.assertEqual((snapshot / ".env").read_text(), "")
        self.assertFalse(snapshot.exists())
        self.assertEqual((self.root / "first.txt").read_text(), "unfinished\n")
        self.assertEqual(
            (self.root / "untracked.txt").read_text(), "private unfinished\n"
        )

    def test_committed_environment_file_is_refused_and_snapshot_removed(self):
        (self.root / ".env").write_text("FAKE_FIXTURE_KEY=not-a-real-key\n")
        self.git("add", ".env")
        self.git("commit", "-qm", "Unsafe environment fixture")
        with self.assertRaises(FileExistsError):
            with self.checks.commit_snapshot(self.root, self.git("rev-parse", "HEAD")):
                self.fail("A committed environment file must not reach tests")
        self.assertEqual(
            self.git("worktree", "list", "--porcelain").count("worktree "), 1
        )

    def test_failed_suite_blocks_push_and_cleans_snapshot(self):
        with (
            patch.object(self.checks, "affected_suites", return_value={"frontend"}),
            patch.object(
                self.checks,
                "run_suites",
                side_effect=self.checks.CheckError("test failed"),
            ),
        ):
            with self.assertRaises(self.checks.CheckError):
                self.checks.pre_push(
                    self.root,
                    io.StringIO(f"refs/heads/x {self.base} refs/heads/x {'0' * 40}\n"),
                )
        self.assertEqual(
            self.git("worktree", "list", "--porcelain").count("worktree "), 1
        )


if __name__ == "__main__":
    unittest.main()
