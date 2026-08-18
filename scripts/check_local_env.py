#!/usr/bin/env python3
"""Report whether this computer can run Alethical's chosen local setup.

Run ``just doctor`` before ``just up``. The check only reads project files and
asks installed commands for their versions. It never installs, starts, stops,
or changes anything, and it always exits successfully so its advice cannot
block other work.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
VERSION = re.compile(r"\d+(?:\.\d+){0,2}")


class CommandResult:
    def __init__(self, returncode: int, output: str) -> None:
        self.returncode = returncode
        self.output = output


Runner = Callable[[Sequence[str]], CommandResult | None]


def run(command: Sequence[str]) -> CommandResult | None:
    """Run a short version query without letting a broken command stop doctor."""
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            check=False,
            cwd=REPO,
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
