#!/usr/bin/env python3
"""Report whether this computer can run Alethical's chosen local setup.

Run ``just doctor`` before ``just up``. The check only reads project files,
local Git settings, and local Docker state. It never installs, starts, stops,
downloads, or changes anything, and it always exits successfully so its advice
cannot block other work.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
VERSION = re.compile(r"\d+(?:\.\d+){0,2}")
UPLOAD_DATABASE_IMAGE = "pgvector/pgvector:pg17"
UPLOAD_HOOKS = ("pre-commit", "pre-push")
SAFE_AMBIENT_KEYS = {
    "PATH",
    "HOME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SYSTEMROOT",
    "LANG",
    "LC_ALL",
}


class CommandResult:
    def __init__(self, returncode: int, output: str) -> None:
        self.returncode = returncode
        self.output = output


Runner = Callable[[Sequence[str]], CommandResult | None]


def run(command: Sequence[str]) -> CommandResult | None:
    """Run one short read-only query without letting it stop doctor."""
    env = None
    if command and command[0] == "docker":
        # Upload tests pass only this small ambient set, then pin Docker commands
        # to the saved local context's Unix socket. Doctor must inspect that same
        # connection without inherited hosts, contexts, certificates, or config.
        env = {
            key: value for key, value in os.environ.items() if key in SAFE_AMBIENT_KEYS
        }
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            check=False,
            cwd=REPO,
            env=env,
            text=True,
            timeout=2,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    return CommandResult(completed.returncode, completed.stdout + completed.stderr)


def first_version(text: str) -> str | None:
    match = VERSION.search(text)
    return match.group(0) if match else None


def project_requirements(repo: Path) -> tuple[str, str, str]:
    """Read the versions that the project itself already declares."""
    python = (repo / ".python-version").read_text().strip()
    packages = json.loads((repo / "package.json").read_text())
    package_manager = packages["packageManager"]
    pnpm_match = re.fullmatch(r"pnpm@(.+)", package_manager)
    if not pnpm_match:
        raise ValueError("package.json must name pnpm in packageManager")
    compose = (repo / "docker-compose.yml").read_text()
    node_match = re.search(r"^\s*image:\s*node:(\d+)(?:[-\s]|$)", compose, re.MULTILINE)
    if not node_match:
        raise ValueError(
            "docker-compose.yml must name a Node image with a major version"
        )
    return python, node_match.group(1), pnpm_match.group(1)


def status(kind: str, message: str) -> str:
    return f"  [{kind}] {message}"


def command_check(
    name: str,
    command: Sequence[str],
    runner: Runner,
    expected: str | None = None,
    compare: Callable[[str, str], bool] | None = None,
) -> list[str]:
    result = runner(command)
    if result is None:
        return [status("GAP", f"{name} is not installed.")]
    if result.returncode != 0:
        return [status("GAP", f"{name} did not run. {result.output.strip()}")]
    actual = first_version(result.output)
    if actual is None:
        return [status("GAP", f"{name} ran, but did not report a version.")]
    if expected and compare and not compare(actual, expected):
        return [status("GAP", f"{name} is {actual}; this project needs {expected}.")]
    return [status("ok", f"{name} {actual}")]


def exact(actual: str, expected: str) -> bool:
    return actual == expected


def same_major(actual: str, expected: str) -> bool:
    return actual.split(".", 1)[0] == expected


def effective_python(required: str, runner: Runner) -> list[str]:
    found = runner(("uv", "python", "find"))
    if found is None or found.returncode != 0:
        return [
            status(
                "GAP",
                f"Python {required} is not available through uv. Run `uv python install {required}`.",
            )
        ]
    interpreter = found.output.strip().splitlines()[-1]
    version = runner((interpreter, "--version"))
    if version is None or version.returncode != 0:
        return [
            status("GAP", f"uv selected Python, but it did not run: {interpreter}.")
        ]
    actual = first_version(version.output)
    if actual != required:
        return [
            status(
                "GAP",
                f"Project Python is {actual or 'unknown'}; this project needs {required}.",
            )
        ]
    return [status("ok", f"Project Python {actual} (selected by uv)")]


def optional_native_tools(target: str, runner: Runner) -> list[str]:
    if target == "web":
        return [
            status("skip", "Xcode is only needed for iPhone work."),
            status("skip", "Java is only needed for Android work."),
        ]
    if target == "ios":
        return command_check("Xcode", ("xcodebuild", "-version"), runner)
    return command_check("Java", ("java", "-version"), runner)


def upload_hook_checks(repo: Path, runner: Runner) -> list[str]:
    """Report whether Git will run Alethical's current hooks in this worktree."""
    lines: list[str] = []
    for name in UPLOAD_HOOKS:
        result = runner(
            (
                "git",
                "rev-parse",
                "--path-format=absolute",
                "--git-path",
                f"hooks/{name}",
            )
        )
        if result is None or result.returncode != 0 or not result.output.strip():
            lines.append(
                status(
                    "GAP",
                    f"Git could not find the active {name} hook for this worktree. "
                    "Run `just install-hooks` here.",
                )
            )
            continue
        active = Path(result.output.strip())
        if not active.is_absolute():
            active = repo / active
        source = repo / ".githooks" / name
        try:
            current = (
                active.is_file()
                and source.is_file()
                and active.read_bytes() == source.read_bytes()
                and os.access(active, os.X_OK)
            )
        except OSError:
            current = False
        if not current:
            lines.append(
                status(
                    "GAP",
                    f"Git's active {name} hook is missing, outdated, or not executable. "
                    "Run `just install-hooks` here.",
                )
            )
            continue
        lines.append(status("ok", f"Git {name} protection is active here"))
    return lines


def upload_docker_checks(runner: Runner) -> list[str]:
    """Report whether upload tests can start their disposable local database."""
    context = runner(("docker", "context", "inspect"))
    if context is None or context.returncode != 0:
        return [
            status(
                "GAP",
                "Docker did not identify its current connection. Start local Docker and retry.",
            )
        ]
    try:
        host = json.loads(context.output)[0]["Endpoints"]["docker"]["Host"]
    except (KeyError, IndexError, TypeError, ValueError):
        return [status("GAP", "Docker did not identify a local connection.")]
    if not isinstance(host, str) or not host.startswith("unix:///"):
        return [
            status(
                "GAP",
                "Upload tests need local Docker, but Docker points at another computer.",
            )
        ]

    docker = ("docker", "--host", host)
    daemon = runner((*docker, "info", "--format", "{{json .ServerVersion}}"))
    if daemon is None or daemon.returncode != 0:
        return [
            status(
                "GAP",
                "The local Docker service could not be reached. Make local Docker available and retry.",
            )
        ]

    lines = [status("ok", "Local Docker service is ready for upload tests")]
    image = runner((*docker, "image", "inspect", UPLOAD_DATABASE_IMAGE))
    if image is None or image.returncode != 0:
        lines.append(
            status(
                "GAP",
                f"The saved {UPLOAD_DATABASE_IMAGE} database image is unavailable. "
                "Run `docker compose pull db` to save it, or fix local Docker access, "
                "before uploading code.",
            )
        )
    else:
        lines.append(
            status("ok", f"Saved upload-test image {UPLOAD_DATABASE_IMAGE} is ready")
        )
    return lines


def doctor(repo: Path, target: str = "web", runner: Runner = run) -> list[str]:
    python, node, pnpm = project_requirements(repo)
    lines = [
        f"Alethical setup check for {repo.name}",
        "Versions come from .python-version, docker-compose.yml, and package.json.",
        "",
        "Required setup",
    ]
    lines += command_check("Docker", ("docker", "--version"), runner)
    lines += command_check("Docker Compose", ("docker", "compose", "version"), runner)
    lines += command_check("uv", ("uv", "--version"), runner)
    lines += command_check("just", ("just", "--version"), runner)
    lines += command_check("Node", ("node", "--version"), runner, node, same_major)
    lines += command_check("pnpm", ("pnpm", "--version"), runner, pnpm, exact)
    lines += effective_python(python, runner)
    lines += ["", "Commit and upload protection"]
    lines += upload_hook_checks(repo, runner)
    lines += ["", "Disposable upload-test database"]
    lines += upload_docker_checks(runner)
    lines += ["", f"Optional tools for {target} work"]
    lines += optional_native_tools(target, runner)
    gaps = sum(line.startswith("  [GAP]") for line in lines)
    lines += [
        "",
        f"{gaps} problem(s) found. This check only reports and always exits 0.",
    ]
    return lines


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "target",
        nargs="?",
        choices=("web", "ios", "android"),
        default="web",
        help="Check optional tools for web (default), ios, or android work.",
    )
    args = parser.parse_args(argv)
    print("\n".join(doctor(REPO, args.target)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
