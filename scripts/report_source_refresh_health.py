#!/usr/bin/env python3
"""Keep one quiet, grouped source-update issue; no AI calls or source writes."""

from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import subprocess

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS

REPO = "alethical-org/alethical"
TITLE = "Public-record updates need attention"
MARKER = "<!-- source-refresh-health:"


def health(db):
    # Keep the public warning usable even if a new collector cannot import.
    from alethical.pipeline.record_refresh import health as source_health

    return source_health(db)


def workflow_problems() -> list[dict]:
    return [
        {
            "name": f"workflow-{stage}",
            "status": "failed",
            "overdue": False,
            "running": False,
            "source": f"https://github.com/{REPO}/actions/workflows/source-record-refresh.yml",
        }
        for stage in ("plan", "collect")
        if os.getenv(f"SOURCE_REFRESH_{stage.upper()}_RESULT")
        in ("failure", "cancelled")
    ]


def public_detail(result: dict) -> str | None:
    """Describe known findings without forwarding source bodies or error strings."""
    source, status = result.get("source", ""), result.get("status")
    if status == "unavailable":
        return (
            "The official source could not be checked; retrying keeps the held records."
        )
    if status != "review_required":
        return None
    if source in ("district-map-house", "district-map-senate"):
        return "Official map bytes changed; compare geometry before importing."
    if source == "candidate-ballot":
        return "Review the next official election mapping; the approved election is approaching or has ended."
    if source == "zip-state-reference":
        return "Review the next HUD ZIP workbook; its availability has not been established."
    return "Official source changes need review before publication."


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
    for row in sorted(problems, key=lambda item: item["name"]):
        finding = row.get("finding") or {}
        keys = sorted(
            str(item.get("finding_key", "")) for item in finding.get("results", [])
        )
        if "unreviewed_session_codes" in finding:
            keys += sorted(finding["unreviewed_session_codes"])
        # Full audit hashes include collection times. The prepared bundle supplies
        # a semantic key; its bytes and private object location remain private.
        keys += [
            finding.get(key)
            for key in ("finding_key", "release_id", "filings_snapshot_id")
        ]
        stable.append((row["name"], row["status"], row["overdue"], keys))
        lines.append(
            f"- **{row['name']}**: {row['status'] or 'not yet completed'}; last complete check: {row.get('last_checked_at') or 'none'}. [Official source]({row['source']})."
        )
        for result in finding.get("results", []):
            if detail := public_detail(result):
                lines.append(f"  - {detail}")
        if (
            row["name"] == "donor-proof-preparation"
            and row["status"] == "review_required"
        ):
            lines.append(
                "  - A private donor-evidence bundle is ready for review; it has not been approved or published."
            )
        if finding.get("unreviewed_session_codes"):
            lines.append(
                "  - New official session codes: "
                + ", ".join(
                    sorted(
                        code
                        for code in finding["unreviewed_session_codes"]
                        if re.fullmatch(r"[0-9]{7}", code)
                    )
                )
            )
    fingerprint = hashlib.sha256(
        json.dumps(stable, sort_keys=True).encode()
    ).hexdigest()
    if not problems:
        lines = [
            "Net: No public-record update currently needs attention; some checks may still be running."
        ]
    lines += ["", f"{MARKER}{fingerprint} -->"]
    return "\n".join(lines), fingerprint, bool(problems)


def gh(*arguments):
    return subprocess.check_output(["gh", *arguments], text=True)


def main():
    engine = None
    try:
        try:
            engine = create_engine(
                database_url_for_target("production"),
                connect_args=NO_PREPARED_STATEMENTS,
            )
            with Session(engine) as db:
                rows = health(db)
        except Exception:
            # Database URLs and upstream bodies can appear inside exceptions.
            # Never send them to a public issue or hide the missing health read.
            rows = [
                {
                    "name": "source-health-unavailable",
                    "status": "failed",
                    "overdue": False,
                    "running": False,
                    "source": f"https://github.com/{REPO}/actions/workflows/source-record-refresh.yml",
                }
            ]
        body, fingerprint, open_needed = packet(rows + workflow_problems())
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
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
