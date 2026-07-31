#!/usr/bin/env python3
"""Check that the live GitHub repo settings still match what the docs claim.

``docs/operations/repo-and-service-settings.md`` records the intended value of every
setting that controls this project but does not live in the repo. Nothing enforced
that, so the doc could go stale silently — a weaker version of the failure that
produced it (Dependabot alerts were off for the project's entire life, #691).

This reads the intended values straight out of that Markdown, so the doc stays the
single source of truth, and compares each one against the live API.

Three outcomes per setting:

- **match** — live value equals the documented one.
- **DRIFT** — they differ. Exit status is non-zero; either the setting or the doc is
  wrong and a human decides which.
- **unverifiable** — the token in use cannot read that endpoint. Reported loudly and
  counted, never silently treated as a pass. The default ``GITHUB_TOKEN`` in Actions
  has no administration scope, so the security and branch-protection settings need a
  token that does; without one this still checks everything else.

Deliberately not a required status check. Drift is caused by whoever changed a
setting, and blocking an unrelated PR on someone else's mistake would punish the
wrong session. It fails visibly instead.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs/operations/repo-and-service-settings.md"
API = "https://api.github.com"
REPO = os.environ.get("GITHUB_REPOSITORY", "alethical-org/alethical")

# Row label in the doc -> (endpoint, how to read the live value from its JSON).
# Endpoints are fetched once each and shared. A row not listed here is prose the
# check ignores; a row listed here but missing from the doc is itself a failure,
# so renaming a row breaks loudly rather than silently dropping a check.
REPO_CHECKS: dict[str, tuple[str, object]] = {
    "Visibility": ("", lambda d: d["visibility"]),
    "Secret scanning": (
        "",
        lambda d: d["security_and_analysis"]["secret_scanning"]["status"],
    ),
    "Secret scanning push protection": (
        "",
        lambda d: d["security_and_analysis"]["secret_scanning_push_protection"][
            "status"
        ],
    ),
    "Secret scanning validity checks": (
        "",
        lambda d: d["security_and_analysis"]["secret_scanning_validity_checks"][
            "status"
        ],
    ),
    "Dependabot automatic security fixes": (
        "/automated-security-fixes",
        lambda d: d["enabled"],
    ),
    "Allow squash merge": ("", lambda d: d["allow_squash_merge"]),
    "Allow merge commits": ("", lambda d: d["allow_merge_commit"]),
    "Allow rebase merge": ("", lambda d: d["allow_rebase_merge"]),
    "Automatically delete head branches": ("", lambda d: d["delete_branch_on_merge"]),
}

# Second table: the branch-protection rule on main.
PROTECTION_CHECKS: dict[str, object] = {
    "Required approving reviews": (
        lambda d: d["required_pull_request_reviews"]["required_approving_review_count"]
    ),
    "Required status checks": lambda d: d["required_status_checks"]["contexts"],
    "Strict (branch must be up to date)": lambda d: d["required_status_checks"][
        "strict"
    ],
    "Enforce for admins": lambda d: d["enforce_admins"]["enabled"],
}

TABLE_ROW = re.compile(r"^\|\s*(.+?)\s*\|\s*(.+?)\s*\|")


def normalize(value: object) -> str:
    """Reduce a documented cell or a live value to one comparable token."""
    if isinstance(value, bool):
        return "on" if value else "off"
    if isinstance(value, list):
        return ", ".join(sorted(str(v) for v in value))
    text = str(value).strip()
    text = re.sub(r"\*\*|`", "", text)  # drop Markdown bold and code ticks
    text = text.split("—")[0].strip()  # drop a trailing "— see below"
    lowered = text.lower()
    if lowered in {"enabled", "yes", "true"}:
        return "on"
    if lowered in {"disabled", "no", "false", "none", "blocked"}:
        return "off"
    if "," in lowered:
        # A documented list, e.g. the required status checks. Order is not part of
        # the setting, so sort both sides rather than reporting a reshuffle as drift.
        return ", ".join(sorted(part.strip() for part in lowered.split(",")))
    return lowered


def documented_values() -> dict[str, str]:
    """Every ``| label | value |`` row in the doc, normalized."""
    rows: dict[str, str] = {}
    for line in DOC.read_text().splitlines():
        m = TABLE_ROW.match(line)
        if not m:
            continue
        label, value = m.group(1).strip(), m.group(2).strip()
        if set(label) <= {"-", " "} or label == "Setting":
            continue  # separator or header row
        rows.setdefault(label, normalize(value))
    return rows


def get(path: str) -> object | None:
    """GET an API path, or None when the token may not read it."""
    req = urllib.request.Request(f"{API}/repos/{REPO}{path}")
    req.add_header("Accept", "application/vnd.github+json")
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        if exc.code in (403, 404):
            return None  # no permission, or the rule does not exist
        raise


def main() -> int:
    doc = documented_values()
    repo = get("")
    protection = get("/branches/main/protection")

    matches: list[str] = []
    drift: list[str] = []
    unverifiable: list[str] = []

    def compare(label: str, live: object | None, source: object | None) -> None:
        if label not in doc:
            drift.append(
                f"{label}: no row in {DOC.relative_to(ROOT)} — was it renamed?"
            )
            return
        if source is None or live is None:
            unverifiable.append(label)
            return
        want, got = doc[label], normalize(live)
        (matches if want == got else drift).append(
            f"{label}: doc says {want!r}, live is {got!r}" if want != got else label
        )

    for label, (path, read) in REPO_CHECKS.items():
        source = repo if path == "" else get(path)
        live = None
        if source is not None:
            try:
                live = read(source)
            except (KeyError, TypeError):
                live = None  # field withheld from this token
        compare(label, live, source if live is not None else None)

    # Branch protection: absent is itself a documented value ("None").
    if "Branch protection on `main`" in doc:
        want = doc["Branch protection on `main`"]
        got = "off" if protection is None else "on"
        if protection is None and want == "on":
            # Could be "no rule" or "cannot read it" — say which rather than guess.
            unverifiable.append(
                "Branch protection on `main` (needs a token with administration:read)"
            )
        elif want == got:
            matches.append("Branch protection on `main`")
        else:
            drift.append(
                f"Branch protection on `main`: doc says {want!r}, live is {got!r}"
            )

    if protection is not None:
        for label, read in PROTECTION_CHECKS.items():
            try:
                compare(label, read(protection), protection)
            except (KeyError, TypeError):
                unverifiable.append(label)

    for label in matches:
        print(f"  ok         {label}")
    for label in unverifiable:
        print(f"  UNVERIFIED {label}")
    for line in drift:
        print(f"  DRIFT      {line}")

    print(
        f"\n{len(matches)} match, {len(drift)} drifted, {len(unverifiable)} unverifiable"
    )
    if unverifiable:
        print(
            "Unverifiable settings need a token with administration:read; the default\n"
            "GITHUB_TOKEN has no such scope. They are NOT counted as passing."
        )
    if drift:
        print(
            f"\n::error::Repo settings drifted from {DOC.relative_to(ROOT)}. Either fix\n"
            "the setting or update the doc — whichever is wrong."
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
