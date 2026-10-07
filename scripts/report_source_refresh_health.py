#!/usr/bin/env python3
"""Keep one quiet, grouped source-update issue; no AI calls or source writes."""

from __future__ import annotations
import hashlib
import json
from pathlib import Path
import tempfile
import subprocess

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS
from alethical.pipeline.record_refresh import health

REPO = "alethical-org/alethical"
TITLE = "Public-record updates need attention"
MARKER = "<!-- source-refresh-health:"


def packet(report: list[dict]) -> tuple[str, str, bool]:
    problems = [
        row
        for row in report
        if row["status"] in ("failed", "review_required", "interrupted")
        or (row["overdue"] and not row["running"])
    ]
    stable = []
    lines = [
        "Net: These public-record updates need attention; previously accepted records remain available.",
        "",
        "Automatic retries continue for failed collections. Review findings do not replace approved data.",
        "",
    ]
    for row in problems:
        finding = row.get("finding") or {}
        keys = [item.get("finding_key") for item in finding.get("results", [])]
        if "unreviewed_session_codes" in finding:
            keys += finding["unreviewed_session_codes"]
        stable.append((row["name"], row["status"], row["overdue"], keys))
        lines.append(
            f"- **{row['name']}**: {row['status'] or 'not yet completed'}; last complete check: {row.get('last_checked_at') or 'none'}. [Official source]({row['source']})."
        )
        for result in finding.get("results", []):
            lines.append(f"  - {result.get('detail', 'Official source needs review')}")
        if finding.get("unreviewed_session_codes"):
            lines.append(
                "  - New official session codes: "
                + ", ".join(finding["unreviewed_session_codes"])
            )
    fingerprint = hashlib.sha256(
        json.dumps(stable, sort_keys=True).encode()
    ).hexdigest()
    if not problems:
        lines = [
            "Net: Every registered public-record job has a completed check within its expected interval."
        ]
    lines += ["", f"{MARKER}{fingerprint} -->"]
    return "\n".join(lines), fingerprint, bool(problems)


def gh(*arguments):
    return subprocess.check_output(["gh", *arguments], text=True)


def main():
    engine = create_engine(
        database_url_for_target("production"), connect_args=NO_PREPARED_STATEMENTS
    )
    try:
        with Session(engine) as db:
            body, fingerprint, open_needed = packet(health(db))
        # Exact marker proves ownership; a matching title alone is not permission
        # to edit an unrelated person's issue.
        issues = json.loads(
            gh(
                "issue",
                "list",
                "--repo",
                REPO,
                "--state",
                "all",
                "--search",
                f'"{TITLE}" in:title',
                "--limit",
                "100",
                "--json",
                "number,body,state",
            )
        )
        ours = next((issue for issue in issues if MARKER in issue["body"]), None)
        if (
            ours
            and f"{MARKER}{fingerprint} -->" in ours["body"]
            and (ours["state"] == "OPEN") == open_needed
        ):
            return 0
        if not ours and not open_needed:
            return 0
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "health.md"
            file.write_text(body)
            if ours:
                gh(
                    "issue",
                    "edit",
                    str(ours["number"]),
                    "--repo",
                    REPO,
                    "--body-file",
                    str(file),
                )
                if (ours["state"] == "OPEN") != open_needed:
                    gh(
                        "issue",
                        "reopen" if open_needed else "close",
                        str(ours["number"]),
                        "--repo",
                        REPO,
                    )
            else:
                gh(
                    "issue",
                    "create",
                    "--repo",
                    REPO,
                    "--title",
                    TITLE,
                    "--body-file",
                    str(file),
                )
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
