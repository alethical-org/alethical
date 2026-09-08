"""Local check plumbing, using temporary repositories and no database or network."""

from __future__ import annotations

import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

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
        self.assertNotIn("DATABASE_URL", env)

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


class DisposablePostgresTest(unittest.TestCase):
    """Mock every process: no Docker daemon, database, or network is contacted."""

    def setUp(self):
        self.checks = load_checks()
        self.snapshot = Path("/unused-disposable-postgres-fixture")
        self.token = "b" * 32
        self.container = "a" * 64
        self.host = "unix:///fixture/docker.sock"
        self.commands = []
        self.create_code = 0
        self.image_code = 0
        self.remove_code = 0
        self.host_identity_code = 0
        self.ready_code = 0
        self.inspect_code = 0
        self.run_id = self.container
        self.server_identity = "7347282919283712345"
        self.info = {
            "Id": self.container,
            "Name": f"/alethical-pre-push-{self.token}",
            "Config": {
                "Image": "pgvector/pgvector:pg17",
                "Labels": {"io.alethical.local-checks": self.token},
            },
            "NetworkSettings": {
                "Ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "49165"}]}
            },
        }
        for patcher in (
            patch.object(self.checks.uuid, "uuid4", return_value=Mock(hex=self.token)),
            patch.object(self.checks.subprocess, "run", side_effect=self.dispatch),
            patch.object(self.checks.time, "sleep"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def dispatch(self, command, **kwargs):
        self.commands.append((command, kwargs))
        code, output = 0, ""
        if command[0] == "uv":
            code = self.host_identity_code
            self.assertIn("default_transaction_read_only=on", command[-2])
            self.assertIn("statement_timeout=5000", command[-2])
            self.assertEqual(command[-1], self.server_identity)
            self.assertEqual(
                kwargs["env"]["DATABASE_URL"],
                "postgresql+psycopg://alethical:alethical@127.0.0.1:49165/alethical",
            )
        elif command == ["docker", "context", "inspect"]:
            output = json.dumps([{"Endpoints": {"docker": {"Host": self.host}}}])
        else:
            self.assertEqual(command[:3], ["docker", "--host", self.host])
            args = command[3:]
            if args[:2] == ["image", "inspect"]:
                code = self.image_code
            elif args[0] == "run":
                code, output = self.create_code, self.run_id
            elif args[:2] == ["container", "inspect"]:
                code, output = self.inspect_code, json.dumps([self.info])
            elif args[:3] == ["exec", self.container, "pg_isready"]:
                self.assertIn("127.0.0.1", args)
                code = self.ready_code
            elif args[:5] == [
                "exec",
                "--env",
                "PGPASSWORD=alethical",
                self.container,
                "psql",
            ]:
                output = self.server_identity
            elif args == ["rm", "--force", self.container]:
                code = self.remove_code
            else:
                self.fail(f"Unexpected Docker command: {command}")
        return subprocess.CompletedProcess(command, code, output, "")

    def removed(self):
        return [
            command for command, _ in self.commands if command[3:5] == ["rm", "--force"]
        ]

    def test_server_is_local_cached_temporary_identified_and_removed(self):
        with patch.dict(
            "os.environ",
            {
                "OPENAI_API_KEY": "fake",
                "DOCKER_HOST": "ssh://remote",
                "DOCKER_CONTEXT": "remote",
                "DATABASE_URL": "postgresql://remote/production",
            },
        ):
            with self.checks.disposable_postgres(self.snapshot) as url:
                self.assertEqual(
                    url,
                    "postgresql+psycopg://alethical:alethical@127.0.0.1:49165/alethical",
                )
                self.assertEqual(self.removed(), [])
        self.assertEqual(len(self.removed()), 1)
        run = next(command for command, _ in self.commands if command[3:4] == ["run"])
        for required in (
            "--detach",
            "--rm",
            "--pull=never",
            "127.0.0.1::5432",
            "--tmpfs",
            "/var/lib/postgresql/data:rw",
            "pgvector/pgvector:pg17",
        ):
            self.assertIn(required, run)
        for command, kwargs in self.commands:
            for private in (
                "OPENAI_API_KEY",
                "DOCKER_HOST",
                "DOCKER_CONTEXT",
                "ALETHICAL_TEST_DATABASE_URL",
            ):
                self.assertNotIn(private, kwargs["env"])
            self.assertNotIn("54329", " ".join(command))
            self.assertNotIn("prune", command)
            self.assertNotIn("stop", command)
            self.assertNotIn("--volume", command)
            self.assertNotIn("-v", command)

    def test_missing_docker_fails_without_cleanup_target(self):
        with patch.object(self.checks.subprocess, "run", side_effect=FileNotFoundError):
            with self.assertRaisesRegex(
                self.checks.CheckError, "Docker is unavailable"
            ):
                with self.checks.disposable_postgres(self.snapshot):
                    self.fail("Missing Docker must not yield")

    def test_remote_docker_context_is_rejected_before_daemon_commands(self):
        self.host = "ssh://example.invalid"
        with self.assertRaisesRegex(self.checks.CheckError, "local Docker Unix socket"):
            with self.checks.disposable_postgres(self.snapshot):
                self.fail("Remote context must not yield")
        self.assertEqual(len(self.commands), 1)

    def test_missing_cached_image_never_runs_or_pulls_container(self):
        self.image_code = 1
        with self.assertRaisesRegex(self.checks.CheckError, "No image was downloaded"):
            with self.checks.disposable_postgres(self.snapshot):
                self.fail("Missing image must not yield")
        self.assertEqual(len(self.commands), 2)

    def test_create_failure_without_container_does_not_remove_anything(self):
        self.create_code = 1
        self.inspect_code = 1
        with self.assertRaisesRegex(self.checks.CheckError, "could not create"):
            with self.checks.disposable_postgres(self.snapshot):
                self.fail("Creation failure must not yield")
        self.assertEqual(self.removed(), [])

    def test_failed_start_recovers_and_removes_only_verified_owned_id(self):
        self.create_code = 1
        with self.assertRaisesRegex(self.checks.CheckError, "could not create"):
            with self.checks.disposable_postgres(self.snapshot):
                self.fail("Failed start must not yield")
        self.assertEqual(
            self.removed(),
            [["docker", "--host", self.host, "rm", "--force", self.container]],
        )

    def test_readiness_timeout_removes_owned_container(self):
        self.ready_code = 1
        with patch.object(self.checks.time, "monotonic", side_effect=[0, 0, 46]):
            with self.assertRaisesRegex(self.checks.CheckError, "not ready within 45"):
                with self.checks.disposable_postgres(self.snapshot):
                    self.fail("Unready database must not yield")
        self.assertEqual(len(self.removed()), 1)

    def test_test_failure_still_removes_owned_container(self):
        with self.assertRaisesRegex(self.checks.CheckError, "fixture test failure"):
            with self.checks.disposable_postgres(self.snapshot):
                raise self.checks.CheckError("fixture test failure")
        self.assertEqual(len(self.removed()), 1)

    def test_cleanup_failure_blocks_success(self):
        self.remove_code = 1
        with self.assertRaisesRegex(self.checks.CheckError, "could not remove"):
            with self.checks.disposable_postgres(self.snapshot):
                pass
        self.assertEqual(len(self.removed()), 1)

    def test_invalid_run_id_never_yields_but_recovers_owned_container(self):
        self.run_id = "not-a-container-id"
        with self.assertRaises(self.checks.CheckError):
            with self.checks.disposable_postgres(self.snapshot):
                self.fail("Invalid ID must not yield")
        self.assertEqual(len(self.removed()), 1)

    def test_unrecognized_container_is_neither_used_nor_removed(self):
        self.info["Config"]["Labels"] = {"io.alethical.local-checks": "someone-else"}
        with self.assertRaisesRegex(self.checks.CheckError, "unrecognized container"):
            with self.checks.disposable_postgres(self.snapshot):
                self.fail("Foreign container must not yield")
        self.assertEqual(self.removed(), [])

    def test_nonhex_inspection_id_cannot_be_used_or_removed(self):
        self.info["Id"] = "not-an-exact-container-id"
        with self.assertRaisesRegex(self.checks.CheckError, "unrecognized container"):
            with self.checks.disposable_postgres(self.snapshot):
                self.fail("Malformed inspection ID must not yield")
        self.assertEqual(self.removed(), [])

    def test_invalid_bindings_are_rejected_and_owned_container_removed(self):
        for ip, port in (
            ("0.0.0.0", "49165"),
            ("127.0.0.1", "unknown"),
            ("127.0.0.1", "0"),
            ("127.0.0.1", "65536"),
            ("127.0.0.1", "54329"),
        ):
            with self.subTest(ip=ip, port=port):
                self.commands.clear()
                self.info["NetworkSettings"]["Ports"]["5432/tcp"] = [
                    {"HostIp": ip, "HostPort": port}
                ]
                with self.assertRaisesRegex(self.checks.CheckError, "loopback-only"):
                    with self.checks.disposable_postgres(self.snapshot):
                        self.fail("Invalid mapping must not yield")
                self.assertEqual(len(self.removed()), 1)

    def test_host_server_identity_mismatch_refuses_tests_and_cleans_container(self):
        self.host_identity_code = 1
        with self.assertRaisesRegex(self.checks.CheckError, "identity does not match"):
            with self.checks.disposable_postgres(self.snapshot):
                self.fail("A different host server must never reach pytest")
        self.assertEqual(len(self.removed()), 1)

    def test_invalid_server_identity_is_rejected_before_host_connection(self):
        self.server_identity = "not-an-identifier"
        with self.assertRaisesRegex(
            self.checks.CheckError, "did not identify its PostgreSQL"
        ):
            with self.checks.disposable_postgres(self.snapshot):
                self.fail("Invalid server identity must not yield")
        self.assertFalse(any(command[0] == "uv" for command, _ in self.commands))
        self.assertEqual(len(self.removed()), 1)

    def test_host_identity_timeout_refuses_tests_and_removes_container(self):
        def timeout(command, **kwargs):
            if command[0] == "uv":
                raise subprocess.TimeoutExpired(command, 15)
            return self.dispatch(command, **kwargs)

        with patch.object(self.checks.subprocess, "run", side_effect=timeout):
            with self.assertRaisesRegex(self.checks.CheckError, "could not prove"):
                with self.checks.disposable_postgres(self.snapshot):
                    self.fail("Host identity timeout must not yield")
        self.assertEqual(len(self.removed()), 1)

    def test_only_pytest_receives_disposable_database_url(self):
        url = "postgresql+psycopg://alethical:alethical@127.0.0.1:49165/alethical"
        with patch.object(self.checks, "run") as run:
            self.checks.run_suites(self.snapshot, {"backend", "frontend"})
        pytest_calls = [
            call
            for call in run.call_args_list
            if call.args[0] == ["uv", "run", "--frozen", "pytest"]
        ]
        self.assertEqual(len(pytest_calls), 1)
        self.assertEqual(pytest_calls[0].kwargs["env"]["DATABASE_URL"], url)
        for call in run.call_args_list:
            if call not in pytest_calls:
                self.assertNotIn("DATABASE_URL", call.kwargs["env"])
        self.assertEqual(len(self.removed()), 1)


if __name__ == "__main__":
    unittest.main()
