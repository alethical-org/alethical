#!/usr/bin/env python3
"""Recheck the upstream Pillow warning without granting a release exception."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path

ADVISORY = "GHSA-654x-cwwv-5j9c"
URL = (
    f"https://api.github.com/repos/python-pillow/Pillow/security-advisories/{ADVISORY}"
)
ISSUE = "https://github.com/alethical-org/alethical/issues/2643"
MAX_RESPONSE_BYTES = 1_000_000


LOCK = Path(__file__).resolve().parents[1] / "uv.lock"
_VERSION = re.compile(r"[0-9]+(?:\.[0-9]+){1,3}")


def locked_pillow_version(lock: Path = LOCK) -> str | None:
    """The Pillow version ``uv.lock`` installs, or None when it cannot be read."""
    try:
        text = lock.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return None
    match = re.search(r'\nname = "pillow"\nversion = "([^"]+)"\n', text)
    return match.group(1) if match else None


def _parts(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def fix_installed(payload: object, locked: str | None) -> bool:
    """Whether the warning names 1 fixed release and the locked Pillow is at or past it.

    Strict on purpose: anything but this exact warning, 1 Pillow entry and a single
    plain version in its fix field reads as not fixed, so an unclear answer keeps the
    recorded exception and its proof in force.
    """
    if (
        not isinstance(payload, dict)
        or payload.get("ghsa_id") != ADVISORY
        or payload.get("cve_id") != "CVE-2026-114501"
        or payload.get("state") != "published"
        or payload.get("withdrawn_at") is not None
        or not isinstance(locked, str)
        or not _VERSION.fullmatch(locked)
    ):
        return False
    vulnerabilities = payload.get("vulnerabilities")
    if not isinstance(vulnerabilities, list) or len(vulnerabilities) != 1:
        return False
    affected = vulnerabilities[0]
    if (
        not isinstance(affected, dict)
        or affected.get("package") != {"ecosystem": "pip", "name": "Pillow"}
        or not isinstance(affected.get("patched_versions"), str)
        or not _VERSION.fullmatch(affected["patched_versions"])
    ):
        return False
    return _parts(locked) >= _parts(affected["patched_versions"])


def problems(payload: object, locked: str | None = None) -> list[str]:
    """Only the exact published warning with an explicit empty fix field matches.

    A warning that names a fixed release the locked Pillow already reaches is resolved
    too: the exception it recorded no longer applies.
    """
    if fix_installed(payload, locked):
        return []
    if not isinstance(payload, dict):
        return ["The upstream Pillow advisory is unreadable; review remains open."]
    if (
        payload.get("ghsa_id") != ADVISORY
        or payload.get("cve_id") != "CVE-2026-114501"
        or payload.get("state") != "published"
        or payload.get("withdrawn_at") is not None
    ):
        return ["The upstream Pillow advisory identity or status changed; review it."]
    vulnerabilities = payload.get("vulnerabilities")
    if not isinstance(vulnerabilities, list) or len(vulnerabilities) != 1:
        return ["The upstream Pillow advisory package coverage changed; review it."]
    affected = vulnerabilities[0]
    if (
        not isinstance(affected, dict)
        or affected.get("package") != {"ecosystem": "pip", "name": "Pillow"}
        or affected.get("vulnerable_version_range") != "11.2.1 - 13.0.0"
        or not isinstance(affected.get("patched_versions"), str)
    ):
        return [
            "The upstream Pillow advisory package, range or fix field changed; review it."
        ]
    if affected["patched_versions"] != "":
        return [
            "The upstream Pillow advisory reports a fixed release; review and upgrade."
        ]
    return []


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """A signed request must never follow a redirect to another address."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def token(env: dict | None = None) -> str | None:
    """GitHub's job token, else the saved local sign-in; never printed. A signed
    read avoids the shared unauthenticated rate limit."""
    env = os.environ if env is None else env
    value = env.get("GH_TOKEN") or env.get("GITHUB_TOKEN")
    if not value:
        try:
            result = subprocess.run(
                ["gh", "auth", "token", "--hostname", "github.com"],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        value = result.stdout.strip() if result.returncode == 0 else ""
    if re.fullmatch(r"[A-Za-z0-9_]{20,255}", value or ""):
        return value
    return None


def fetch(env: dict | None = None) -> object:
    """The advisory as GitHub serves it, or None when it could not be read."""
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "alethical-pillow-advisory-check/1",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    signed = token(env)
    if signed:
        headers["Authorization"] = f"Bearer {signed}"
    request = urllib.request.Request(URL, headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect).open(
            request, timeout=20
        ) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("Oversized advisory")
        return json.loads(raw)
    except (OSError, ValueError, UnicodeError):
        return None


def check(env: dict | None = None, locked: str | None = None) -> list[str]:
    payload = fetch(env)
    if payload is None:
        # A missing feed entry, rate limit or outage is not evidence of no fix.
        return ["The upstream Pillow advisory could not be read; review remains open."]
    return problems(payload, locked)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    locked = locked_pillow_version()
    payload = fetch()
    findings = (
        ["The upstream Pillow advisory could not be read; review remains open."]
        if payload is None
        else problems(payload, locked)
    )
    report = "\n## Pillow upstream advisory\n\n"
    report += f"[{ADVISORY}]({URL}); [owner and release hold]({ISSUE}).\n\n"
    report += (
        "\n".join(f"- {finding}" for finding in findings)
        if findings
        else (
            f"Upstream names a fixed release, and uv.lock holds Pillow {locked}, at "
            "or past it; the recorded exception no longer applies."
            if fix_installed(payload, locked)
            else "No fixed release is reported. This checks upstream status only; "
            "it neither verifies production runtime conditions nor grants an exception."
        )
    )
    report += "\n"
    print(report)
    if args.report:
        with args.report.open("a", encoding="utf-8") as output:
            output.write(report)
    return int(bool(findings))


if __name__ == "__main__":
    raise SystemExit(main())
