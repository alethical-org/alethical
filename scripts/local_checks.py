#!/usr/bin/env python3
"""Format the staged selection; test each commit Git is about to push in isolation."""

from __future__ import annotations

import concurrent.futures
import fnmatch
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import TextIO


class CheckError(RuntimeError):
    """A failed check must stop the commit or push."""


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=root, capture_output=True, text=True, check=False
    )
    if result.returncode:
        raise CheckError(f"Git check failed: {' '.join(args)}\n{result.stderr.strip()}")
    return result.stdout.rstrip("\n")


def run(command: list[str], root: Path, *, env=None) -> None:
    result = subprocess.run(command, cwd=root, env=env, check=False)
    if result.returncode:
        raise CheckError(f"Check failed ({result.returncode}): {' '.join(command)}")


def affected_suites(root: Path, files: list[str], sha: str | None = None) -> set[str]:
    # This JSON is also valid YAML and is read directly by CI's paths-filter.
    rules = json.loads(
        git(root, "show", f"{sha}:.github/check-paths.json")
        if sha
        else (root / ".github/check-paths.json").read_text()
    )
    return {
        suite
        for suite, patterns in rules.items()
        if any(
            fnmatch.fnmatchcase(name, pattern) for name in files for pattern in patterns
        )
    }


def push_targets(root: Path, data: str) -> list[tuple[str, list[str]]]:
    targets: dict[str, set[str]] = {}
    for line in data.splitlines():
        if not line.strip():
            continue
        fields = line.split()
        if len(fields) != 4:
            raise CheckError("Could not read the commits Git intends to push.")
        _, local_sha, _, remote_sha = fields
        if set(local_sha) == {"0"}:
            continue  # Deleting a remote ref uploads no code.
        local_sha = git(root, "rev-parse", "--verify", f"{local_sha}^{{commit}}")
        if set(remote_sha) == {"0"}:
            try:
                base = git(root, "merge-base", "origin/main", local_sha)
            except CheckError:
                base = None  # No main available: inspect the whole saved tree.
        else:
            try:
                base = git(root, "rev-parse", "--verify", f"{remote_sha}^{{commit}}")
            except CheckError as error:
                raise CheckError(
                    "The remote commit is missing locally. Fetch the remote and retry."
                ) from error
        output = (
            git(root, "diff", "--name-only", "--no-renames", "-z", base, local_sha)
            if base
            else git(root, "ls-tree", "-r", "--name-only", "-z", local_sha)
        )
        targets.setdefault(local_sha, set()).update(filter(None, output.split("\0")))
    return [(sha, sorted(files)) for sha, files in targets.items()]


@contextmanager
def commit_snapshot(root: Path, sha: str):
    # A real worktree lets tools inspect the exact uploaded Git history.
    with tempfile.TemporaryDirectory(prefix="alethical-pre-push-") as directory:
        snapshot = Path(directory) / "checkout"
        git(root, "worktree", "add", "--detach", str(snapshot), sha)
        try:
            # The app searches parent folders for .env. An empty local sentinel
            # stops that search even when TMPDIR sits below a developer checkout.
            # Never overwrite a committed .env: that is a separate unsafe input.
            with (snapshot / ".env").open("x"):
                pass
            yield snapshot
        finally:
            # This exact temporary worktree is ours, including test/build output.
            # Unlock only this target; no --force --force, ref rewrite, or stash.
            subprocess.run(
                ["git", "worktree", "unlock", str(snapshot)],
                cwd=root,
                capture_output=True,
                check=False,
            )
            git(root, "worktree", "remove", "--force", str(snapshot))


def test_environment(snapshot: Path) -> dict[str, str]:
    # Do not copy a developer's production credentials or .env into a test run.
    env = {
        key: value
        for key, value in os.environ.items()
        if key
        in {"PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "LANG", "LC_ALL"}
    }
    env.update(
        {
            "CI": "true",
            "ALETHICAL_DATABASE_TARGET": "local",
            "ALETHICAL_LOG_DIR": str(snapshot / "logs"),
        }
    )
    return env


@contextmanager
def disposable_postgres(snapshot: Path):
    """Own a whole temporary server; test cleanup cannot reach shared databases."""
    env = test_environment(snapshot)
    image = "pgvector/pgvector:pg17"
    token = uuid.uuid4().hex
    name = f"alethical-pre-push-{token}"
    label = "io.alethical.local-checks"
    docker = ["docker"]

    def call(*args: str, timeout: float = 30):
        try:
            return subprocess.run(
                [*docker, *args],
                cwd=snapshot,
                env=env,
                capture_output=True,
                text=True,
                check=False,
                timeout=timeout,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise CheckError(
                "Docker is unavailable or did not respond. Start local Docker and retry."
            ) from error

    # A saved Docker context can point at another computer. Inspect configuration
    # first, then pin every daemon command to the same local Unix socket.
    context = call("context", "inspect")
    try:
        host = json.loads(context.stdout)[0]["Endpoints"]["docker"]["Host"]
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise CheckError("Docker did not identify a local connection.") from error
    if (
        context.returncode
        or not isinstance(host, str)
        or not host.startswith("unix:///")
    ):
        raise CheckError(
            "Upload tests require a local Docker Unix socket, not a remote Docker connection."
        )
    docker.extend(["--host", host])
    if call("image", "inspect", image).returncode:
        raise CheckError(
            f"Local Docker or its cached {image} image is unavailable. No image was downloaded."
        )

    owned_id = None

    def identify(target: str, expected: str | None = None):
        inspected = call("container", "inspect", target)
        if inspected.returncode:
            return None
        try:
            records = json.loads(inspected.stdout)
            if not isinstance(records, list) or len(records) != 1:
                raise ValueError("Expected exactly one container")
            info = records[0]
            identifier = info["Id"]
            if (
                not isinstance(identifier, str)
                or not re.fullmatch(r"[0-9a-f]{64}", identifier)
                or (expected is not None and identifier != expected)
                or info["Name"] != f"/{name}"
                or info["Config"]["Image"] != image
                or info["Config"]["Labels"].get(label) != token
            ):
                raise ValueError("Container identity did not match")
            return info
        except (KeyError, TypeError, ValueError) as error:
            raise CheckError(
                "Docker returned an unrecognized container; it will not be used or removed."
            ) from error

    try:
        result = call(
            "run",
            "--detach",
            "--rm",
            "--pull=never",
            "--name",
            name,
            "--label",
            f"{label}={token}",
            "--publish",
            "127.0.0.1::5432",
            "--tmpfs",
            "/var/lib/postgresql/data:rw",
            "--env",
            "POSTGRES_DB=alethical",
            "--env",
            "POSTGRES_USER=alethical",
            "--env",
            "POSTGRES_PASSWORD=alethical",
            image,
        )
        identifier = result.stdout.strip()
        if result.returncode or not re.fullmatch(r"[0-9a-f]{64}", identifier):
            raise CheckError(
                "Docker could not create the disposable test server from its cached image."
            )
        info = identify(identifier, identifier)
        if info is None:
            raise CheckError(
                "The disposable Docker test server disappeared before it was ready."
            )
        owned_id = info["Id"]
        try:
            bindings = info["NetworkSettings"]["Ports"]["5432/tcp"]
            if (
                not isinstance(bindings, list)
                or len(bindings) != 1
                or bindings[0]["HostIp"] != "127.0.0.1"
                or not re.fullmatch(r"[0-9]+", bindings[0]["HostPort"])
                or not 1 <= int(bindings[0]["HostPort"]) <= 65535
                or int(bindings[0]["HostPort"]) == 54329
            ):
                raise ValueError("Expected one loopback-only port")
            port = int(bindings[0]["HostPort"])
        except (KeyError, TypeError, ValueError) as error:
            raise CheckError(
                "Docker did not provide an exact loopback-only test database port."
            ) from error
        deadline = time.monotonic() + 45
        while (remaining := deadline - time.monotonic()) > 0:
            ready = call(
                "exec",
                owned_id,
                "pg_isready",
                "-h",
                "127.0.0.1",
                "-p",
                "5432",
                "-U",
                "alethical",
                "-d",
                "alethical",
                "-t",
                "2",
                timeout=min(5, remaining),
            )
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise CheckError(
                "The disposable PostgreSQL test server was not ready within 45 seconds."
            )
        database_url = (
            f"postgresql+psycopg://alethical:alethical@127.0.0.1:{port}/alethical"
        )
        # A Docker port mapping can coexist with a native listener or broken VM
        # forward. Prove the host connection reaches this exact PostgreSQL server
        # before pytest can migrate, seed, or prune anything.
        identifier_query = "SELECT system_identifier::text FROM pg_control_system()"
        server = call(
            "exec",
            "--env",
            "PGPASSWORD=alethical",
            owned_id,
            "psql",
            "-X",
            "-q",
            "-A",
            "-t",
            "-h",
            "127.0.0.1",
            "-U",
            "alethical",
            "-d",
            "alethical",
            "-c",
            identifier_query,
        )
        expected = server.stdout.strip()
        if server.returncode or not re.fullmatch(r"[0-9]{1,20}", expected):
            raise CheckError(
                "Docker did not identify its PostgreSQL server; tests will not connect."
            )
        try:
            identity = subprocess.run(
                [
                    "uv",
                    "run",
                    "--frozen",
                    "python",
                    "-c",
                    "import os, sys, psycopg; "
                    "connection = psycopg.connect(os.environ['DATABASE_URL'].replace('+psycopg', '', 1), "
                    "connect_timeout=5, options='-c default_transaction_read_only=on -c statement_timeout=5000'); "
                    f"actual = connection.execute({identifier_query!r}).fetchone()[0]; "
                    "connection.close(); sys.exit(0 if str(actual) == sys.argv[1] else 1)",
                    expected,
                ],
                cwd=snapshot,
                env={**env, "DATABASE_URL": database_url},
                capture_output=True,
                text=True,
                check=False,
                timeout=15,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise CheckError(
                "The host could not prove the disposable database's identity; tests stopped."
            ) from error
        if identity.returncode:
            raise CheckError(
                "The host database identity does not match this disposable server; tests stopped."
            )
        print(f"Test database ready: {name} (local port {port}).", flush=True)
        yield database_url
    finally:
        # Even a failed `docker run` can leave a created container. Recover only
        # this invocation's random name, and prove its label/image/ID before rm.
        if owned_id is None:
            info = identify(name)
            if info is not None:
                owned_id = info["Id"]
        if owned_id is not None and call("rm", "--force", owned_id).returncode:
            raise CheckError(
                f"Docker could not remove this test's container {owned_id}. The upload is stopped."
            )


def run_suites(snapshot: Path, suites: set[str]) -> None:
    def check(suite: str) -> None:
        env = test_environment(snapshot)
        if suite == "frontend":
            run(["pnpm", "install", "--frozen-lockfile"], snapshot, env=env)
            run(
                ["pnpm", "--dir", "apps/frontend", "run", "check:expo-packages"],
                snapshot,
                env=env,
            )
            run(
                ["pnpm", "--dir", "apps/frontend", "run", "check:build-tool-security"],
                snapshot,
                env=env,
            )
            run(
                [
                    "python3",
                    "-m",
                    "unittest",
                    "discover",
                    "-s",
                    "scripts/tests",
                    "-p",
                    "test_staged_checks.py",
                ],
                snapshot,
                env=env,
            )
            run(["node", "scripts/format_frontend.mjs", "--check"], snapshot, env=env)
            run(
                ["pnpm", "--dir", "apps/frontend", "exec", "tsc", "--noEmit"],
                snapshot,
                env=env,
            )
            run(["just", "test-frontend"], snapshot, env=env)
        elif suite == "backend":
            run(["uv", "sync", "--frozen"], snapshot, env=env)
            run(
                [
                    "uv",
                    "run",
                    "--frozen",
                    "python",
                    "scripts/check_declared_dependencies.py",
                ],
                snapshot,
                env=env,
            )
            run(
                [
                    "python3",
                    "-m",
                    "unittest",
                    "discover",
                    "-s",
                    "scripts/tests",
                    "-p",
                    "test_local_checks.py",
                ],
                snapshot,
                env=env,
            )
            run(
                ["uvx", "ruff@0.15.0", "check", "alethical", "scripts"],
                snapshot,
                env=env,
            )
            run(
                ["uvx", "ruff@0.15.0", "format", "--check", "alethical", "scripts"],
                snapshot,
                env=env,
            )
            run(["uvx", "ty@0.0.72", "check", "alethical/db"], snapshot, env=env)
            # The suite owns the same disposable server for manual and hook runs.
            run(
                [
                    "uv",
                    "run",
                    "--frozen",
                    "python",
                    "-m",
                    "unittest",
                    "discover",
                    "-s",
                    "scripts/tests",
                    "-p",
                    "test_manual_test_database.py",
                ],
                snapshot,
                env=env,
            )
            run(["uv", "run", "--frozen", "pytest"], snapshot, env=env)
        else:
            raise CheckError(f"Unknown test suite: {suite}")

    # Each suite has separate dependencies and resources. Wait for both even on
    # failure, so cleanup cannot remove a snapshot while the other still uses it.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(check, suite) for suite in sorted(suites)]
        errors = []
        for future in futures:
            try:
                future.result()
            except (CheckError, OSError) as error:
                errors.append(str(error))
        if errors:
            raise CheckError("\n".join(errors))


def pre_push(root: Path, source: TextIO) -> None:
    # Parse all refs first so malformed input cannot test a subset and pass.
    for sha, files in push_targets(root, source.read()):
        suites = affected_suites(root, files, sha)
        if not suites:
            print(f"Local checks: {sha[:12]} needs neither app nor server tests.")
            continue
        print(
            f"Local checks: testing {sha[:12]} ({', '.join(sorted(suites))}).",
            flush=True,
        )
        with commit_snapshot(root, sha) as snapshot:
            run_suites(snapshot, suites)
    print("Local checks passed for the commits being pushed.")


def staged(root: Path) -> None:
    common = Path(git(root, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    if (
        root.resolve() == common.parent.resolve()
        and git(root, "worktree", "list", "--porcelain").count("worktree ") > 1
    ):
        raise CheckError("Commit from your own worktree, not the shared checkout.")
    files = list(
        filter(
            None,
            git(
                root, "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"
            ).split("\0"),
        )
    )
    if not files:
        return
    if git(root, "ls-files", "--unmerged"):
        raise CheckError("Resolve the merge conflicts before committing.")
    configurations = [
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "pyproject.toml",
        "lint-staged.config.mjs",
        "scripts/format_frontend.mjs",
        "apps/frontend/package.json",
        "apps/frontend/.prettierrc.json",
        "apps/frontend/.prettierignore",
        ".gitattributes",
    ]
    if git(root, "diff", "--name-only", "--", *configurations):
        raise CheckError(
            "Stage or set aside unfinished formatting-settings changes before committing."
        )
    lint_package = root / "node_modules/lint-staged/package.json"
    try:
        wanted = json.loads((root / "package.json").read_text())["devDependencies"][
            "lint-staged"
        ]
        actual = json.loads(lint_package.read_text())["version"]
    except (OSError, KeyError) as error:
        raise CheckError(
            "Run pnpm install --frozen-lockfile before committing."
        ) from error
    if actual != wanted:
        raise CheckError(
            "The staged-file helper is out of date. Run pnpm install --frozen-lockfile."
        )
    # Keep the default backup and rollback. Never use --no-stash/--no-revert.
    run(
        [
            "node",
            "node_modules/lint-staged/bin/lint-staged.js",
            "--config",
            "lint-staged.config.mjs",
            "--hide-unstaged",
            "--concurrent",
            "false",
        ],
        root,
    )


def main() -> int:
    try:
        root = Path(git(Path.cwd(), "rev-parse", "--show-toplevel"))
        if sys.argv[1:] == ["staged"]:
            staged(root)
        elif sys.argv[1:] == ["pre-push"]:
            # Git exports repository-local variables to hooks. The snapshot's
            # subprocesses must discover their own .git, index and working tree.
            for name in git(root, "rev-parse", "--local-env-vars").splitlines():
                os.environ.pop(name, None)
            pre_push(root, sys.stdin)
        else:
            raise CheckError("Use local_checks.py staged or local_checks.py pre-push.")
    except (CheckError, OSError, ValueError) as error:
        print(f"Local checks stopped: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
