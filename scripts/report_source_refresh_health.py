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
#: The problems the issue body last described, so a new one can be told apart.
PROBLEMS_MARKER = "<!-- source-refresh-problems:"
#: Who is told when a new problem appears. An edited issue body notifies nobody.
OWNER = "euglopi"
_SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,80}")
_REGISTRATION = re.compile(r"[0-9]{3,8}")
_CHECK = re.compile(r"[A-Za-z0-9_ ./:-]{1,80}")


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
    if source == "campaign-totals-catch-up":
        return (
            "The Board's summary has covered a later period than our published "
            "totals for longer than the catch-up budget; the automatic totals "
            "refresh has not caught up."
        )
    if source == "campaign-reviewed-years":
        return (
            "Filed reports fall outside a confirmed account's reviewed years, so the "
            "legislator's page leaves them out until a person confirms the years."
        )
    if source in ("district-map-house", "district-map-senate"):
        return "Official map bytes changed; compare geometry before importing."
    if source == "candidate-ballot":
        return "Review the next official election mapping; the approved election is approaching or has ended."
    if source == "zip-state-reference":
        return "Review the next HUD ZIP workbook; its availability has not been established."
    return "Official source changes need review before publication."


def _years(values) -> str:
    return ", ".join(
        str(year) for year in values if type(year) is int and 2000 <= year <= 2199
    )


def finding_lines(finding: dict) -> list[str]:
    """Code-owned facts from a structured finding, checked before they are printed."""
    lines = []
    for stage in finding.get("stages", [])[:8]:
        name = str(stage.get("stage", ""))
        if not _CHECK.fullmatch(name):
            continue
        checks = [c for c in stage.get("failed_checks", []) if _CHECK.fullmatch(str(c))]
        committees = [
            c
            for c in stage.get("affected_committees", [])
            if _REGISTRATION.fullmatch(str(c))
        ]
        line = f"  - Stage **{name}** did not finish"
        if checks:
            line += ": " + ", ".join(f"`{c}`" for c in checks[:6])
        if committees:
            line += "; committees " + ", ".join(committees[:10])
        if years := _years(stage.get("affected_years", [])):
            line += f"; years {years}"
        lines.append(line + ".")
    for hidden in finding.get("hidden_filings", [])[:20]:
        # Older years are listed in the stored finding, not on the public issue.
        if hidden.get("needs_review") is False:
            continue
        member = str(hidden.get("member", ""))
        registration = str(hidden.get("registration_number", ""))
        if _SLUG.fullmatch(member) and _REGISTRATION.fullmatch(registration):
            lines.append(
                f"  - [{member}](https://alethical.com/legislators/{member}?tab=money), "
                f"account {registration}: filed years {_years(hidden.get('years', []))} "
                "are outside its reviewed years."
            )
    if finding.get("board_ahead_count"):
        lines.append(
            f"  - The Board is ahead of our totals for {int(finding['board_ahead_count'])} "
            "committee-year(s); a totals refresh is requested at most every 6 hours."
        )
    return lines


def problem_keys(problems: list[dict]) -> list[str]:
    """1 key per problem and reason: the same problem repeating keeps its key."""
    keys = []
    for row in problems:
        finding = row.get("finding") or {}
        reasons = [str(finding.get("finding_key") or "")] + sorted(
            str(r.get("finding_key") or r.get("source") or "")
            for r in finding.get("results", [])
        )
        # Hashed, because a finding key can be private evidence; the job name stays
        # readable so the notice can say which job is new.
        reason = hashlib.sha256("|".join(reasons).encode()).hexdigest()[:12]
        keys.append(f"{row['name']}:{row['status']}:{reason}")
    return sorted(set(keys))


def new_problems(body: str | None, keys: list[str]) -> list[str]:
    """Keys absent from the issue's last body; all of them when the issue is new."""
    previous: list[str] = []
    if body and PROBLEMS_MARKER in body:
        try:
            previous = json.loads(body.split(PROBLEMS_MARKER, 1)[1].split(" -->", 1)[0])
        except (ValueError, IndexError):
            previous = []
    return [key for key in keys if key not in set(previous)]


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
        lines.extend(finding_lines(finding))
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
                        if re.fullmatch(r"[0-9]{7,8}", code)
                    )
                )
            )
        for key, label in (
            ("missing_notice_window_years", "Notice filing windows need review for"),
            (
                "ballot_source_years_needing_review",
                "Notice ballot sources need review for",
            ),
        ):
            years = sorted(
                year
                for year in finding.get(key, [])
                if type(year) is int and 2000 <= year <= 2199
            )
            if years:
                lines.append(f"  - {label}: {', '.join(map(str, years))}.")
    fingerprint = hashlib.sha256(
        json.dumps(stable, sort_keys=True).encode()
    ).hexdigest()
    if not problems:
        lines = [
            "Net: No public-record update currently needs attention; some checks may still be running."
        ]
    lines += [
        "",
        f"{PROBLEMS_MARKER}{json.dumps(problem_keys(problems))} -->",
        f"{MARKER}{fingerprint} -->",
    ]
    return "\n".join(lines), fingerprint, bool(problems)


def problem_keys_in(body: str) -> list[str]:
    """The keys a body written by ``packet`` carries."""
    return json.loads(body.split(PROBLEMS_MARKER, 1)[1].split(" -->", 1)[0])


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
        added = new_problems(ours["body"] if ours else None, problem_keys_in(body))
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
                url = gh(
                    "issue",
                    "create",
                    "--repo",
                    REPO,
                    "--title",
                    TITLE,
                    "--body-file",
                    str(file),
                ).strip()
                ours = {"number": url.rsplit("/", 1)[-1]}
            if open_needed and added:
                # A mention is what reaches a person; the body edit above does not.
                names = sorted({key.split(":", 1)[0] for key in added})
                note = Path(directory) / "new.md"
                note.write_text(
                    f"@{OWNER} New since the last update: "
                    + ", ".join(f"**{name}**" for name in names)
                    + ". The issue body above says what each needs; nothing was "
                    "published or approved by this notice."
                )
                gh(
                    "issue",
                    "comment",
                    str(ours["number"]),
                    "--repo",
                    REPO,
                    "--body-file",
                    str(note),
                )
        return 0
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
