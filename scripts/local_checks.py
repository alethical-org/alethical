#!/usr/bin/env python3
"""Format the staged selection; test each commit Git is about to push in isolation."""

from __future__ import annotations

import concurrent.futures
import fnmatch
import json
import os
import subprocess
import sys
import tempfile
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
    # Registered worktrees keep the backend's normal test-database pruning from
    # treating a running snapshot's database as abandoned.
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
            "DATABASE_URL": "postgresql+psycopg://alethical:alethical@localhost:54329/alethical",
            "ALETHICAL_LOG_DIR": str(snapshot / "logs"),
        }
    )
    return env


def run_suites(snapshot: Path, suites: set[str]) -> None:
    env = test_environment(snapshot)

    def check(suite: str) -> None:
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
