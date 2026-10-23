#!/usr/bin/env python3
"""Recheck the upstream Pillow warning without granting a release exception."""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

ADVISORY = "GHSA-654x-cwwv-5j9c"
URL = (
    f"https://api.github.com/repos/python-pillow/Pillow/security-advisories/{ADVISORY}"
)
ISSUE = "https://github.com/alethical-org/alethical/issues/2643"
MAX_RESPONSE_BYTES = 1_000_000


def problems(payload: object) -> list[str]:
    """Only the exact published warning with an explicit empty fix field matches."""
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


def check() -> list[str]:
    request = urllib.request.Request(
        URL,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "alethical-pillow-advisory-check/1",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("Oversized advisory")
        return problems(json.loads(raw))
    except (OSError, ValueError, UnicodeError):
        # A missing feed entry, rate limit or outage is not evidence of no fix.
        return ["The upstream Pillow advisory could not be read; review remains open."]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    findings = check()
    report = "\n## Pillow upstream advisory\n\n"
    report += f"[{ADVISORY}]({URL}); [owner and release hold]({ISSUE}).\n\n"
    report += (
        "\n".join(f"- {finding}" for finding in findings)
        if findings
        else (
            "No fixed release is reported. This checks upstream status only; "
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
