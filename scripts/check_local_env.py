#!/usr/bin/env python3
"""Report gaps between what this repo expects locally and what is actually here.

Run it with `just doctor`.

The repo's documented setup (`README.md` -> `just up`) assumes Docker Compose,
and several workflows assume the local database matches the migrations on this
branch. Neither assumption announces itself when it breaks: `just up` fails with
a "command not found", and a drifted database surfaces much later as a test that
errors for a reason unrelated to the change being tested.

This script makes both visible in one command. It is advisory: it prints
findings and always exits 0, so it can never block work.

Checks:
  1. Tools the repo's own recipes invoke are on PATH.
  2. Ports the Compose file publishes are free, or already served by something.
  3. The local database's migration revision matches this branch's head.
"""

from __future__ import annotations

import os
import re
import shutil
import socket
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Tool -> what breaks without it, and how to get it.
EXPECTED_TOOLS = {
    "uv": ("backend commands and tests", "https://docs.astral.sh/uv/"),
    "pnpm": ("frontend install and build", "npm i -g pnpm"),
    "node": ("frontend tooling", "https://nodejs.org"),
    "git": ("everything", "xcode-select --install"),
    "gh": ("issue and PR commands", "brew install gh"),
    "docker": (
        "`just up`, the documented setup path in README.md",
        "https://docker.com, or OrbStack / Podman",
    ),
}

OK, WARN, GAP = "ok  ", "note", "GAP "


def line(status: str, text: str) -> None:
    print(f"  [{status}] {text}")


def check_tools() -> int:
    print("\nTools the repo's recipes invoke")
    missing = 0
    for tool, (needed_for, how) in EXPECTED_TOOLS.items():
        if shutil.which(tool):
            line(OK, f"{tool}")
        else:
            missing += 1
            line(
                GAP, f"{tool} is not installed. Needed for: {needed_for}. Get it: {how}"
            )
    return missing


def compose_ports() -> list[tuple[str, int]]:
    """Ports the Compose file publishes, without needing a YAML parser."""
    compose = REPO / "docker-compose.yml"
    if not compose.exists():
        return []
    found, service = [], "?"
    for raw in compose.read_text().splitlines():
        stripped = raw.strip()
        if (
            re.fullmatch(r"[a-z][\w-]*:", stripped)
            and raw.startswith("  ")
            and not raw.startswith("    ")
        ):
            service = stripped.rstrip(":")
        match = re.search(r'"\$\{[A-Z_]+:-(\d+)\}:\d+"|"(\d+):\d+"', stripped)
        if match:
            found.append((service, int(match.group(1) or match.group(2))))
    return found


def port_busy(port: int) -> bool:
    with socket.socket() as probe:
        probe.settimeout(0.3)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def check_ports() -> int:
    print("\nPorts the Compose file publishes")
    conflicts = 0
    for service, port in compose_ports():
        if not port_busy(port):
            line(OK, f"{port} free (service `{service}`)")
            continue
        conflicts += 1
        line(
            WARN,
            f"{port} is already in use, so `just up` will not be able to bind "
            f"service `{service}`. Override it, for example DB_PORT=54330 just up",
        )
    return conflicts


def repo_head_revision() -> str | None:
    versions = REPO / "alethical" / "alembic" / "versions"
    if not versions.is_dir():
        return None
    revisions, down = {}, set()
    for path in versions.glob("*.py"):
        text = path.read_text()
        rev = re.search(
            r"^revision(?::[^=]+)?\s*=\s*[\"']([^\"']+)", text, re.MULTILINE
        )
        if not rev:
            continue
        revisions[rev.group(1)] = path.name
        # A merge migration names several parents as a tuple, so capture every
        # quoted value in the assignment rather than only the first.
        parents = re.search(
            r"^down_revision(?::[^=]+)?\s*=\s*(.+)$", text, re.MULTILINE
        )
        if parents:
            down.update(re.findall(r"[\"']([^\"']+)[\"']", parents.group(1)))
    heads = set(revisions) - down
    return heads.pop() if len(heads) == 1 else None


def local_db_revision() -> str | None:
    url = os.environ.get("DATABASE_URL")
    if not url:
        return None
    try:
        result = subprocess.run(
            ["uv", "run", "alembic", "-c", "alembic.ini", "current"],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
            env={**os.environ, "DATABASE_URL": url},
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    # When the database is AHEAD of this branch, the tool cannot resolve the
    # stamped revision and errors out naming it. That name is the answer, and
    # this is the drift worth reporting, not a failed read.
    blocked = re.search(
        r"Can't locate revision identified by '([^']+)'", result.stdout + result.stderr
    )
    if blocked:
        return blocked.group(1)
    match = re.search(
        r"^([0-9a-z_]+)\s*\(head\)|^([0-9a-z_]+)", result.stdout.strip(), re.MULTILINE
    )
    return (match.group(1) or match.group(2)) if match else None


def check_database() -> int:
    print("\nLocal database against this branch's migrations")
    head = repo_head_revision()
    if head is None:
        line(WARN, "could not determine this branch's migration head; skipped")
        return 0
    if not os.environ.get("DATABASE_URL"):
        line(
            WARN,
            f"DATABASE_URL is not set, so the database was not checked "
            f"(this branch expects revision {head})",
        )
        return 0
    current = local_db_revision()
    if current is None:
        line(WARN, "could not read the database's revision; skipped")
        return 0
    if current == head:
        line(OK, f"database matches this branch at {head}")
        return 0
    line(
        GAP,
        f"database is at {current}, this branch expects {head}. A database ahead of "
        f"the code makes older branches fail to start for reasons unrelated to your "
        f"change. Use a scratch database for older branches, or run `just migrate`.",
    )
    return 1


def main() -> int:
    print(f"Local environment check for {REPO.name}")
    findings = check_tools() + check_ports() + check_database()
    print(
        f"\n{findings} thing(s) worth knowing about. This check never blocks; it only reports."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
