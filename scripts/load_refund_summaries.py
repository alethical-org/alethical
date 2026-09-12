#!/usr/bin/env python3
"""Load Minnesota's yearly Political Contribution Refund summaries (#2147).

Net: a Minnesota resident who gives to a state candidate's principal campaign committee
or to a party unit can claim that money back from the state. The Campaign Finance Board
publishes what it refunded once a year, as 2 PDFs and nothing else, so this command reads
the Board's own page for the files it links, keeps each file's exact bytes, reads the
figures out of the printed pages, and attaches a row to a committee only when a person
has already confirmed that committee belongs to a legislator.

    # what would happen, writing nothing to the database or the file store
    uv run python scripts/load_refund_summaries.py --dry-run

    # the real thing, locally
    uv run python scripts/load_refund_summaries.py --target local

    # one year only, repeat the flag for more
    uv run python scripts/load_refund_summaries.py --target local --year 2025

    # the real thing, against production
    uv run python scripts/load_refund_summaries.py --target production

**A file that fails a check is quarantined, not published**, and the command exits
non-zero. Its bytes and its checks are kept either way, so the next run sees what was
wrong rather than downloading into the same silence. Running it again on unchanged bytes
refreshes source-note metadata and re-runs the identity check while keeping copy dates:
a committee is confirmed by a person
days after a file is loaded, and the registered-filer directory is replaced by every
filings run.

**A year the Board published nothing for is recorded, not left as an absence.** The
addresses for gaps inside the linked history are fetched. Only the Board's explicit
missing-page heading corroborates a missing file. Failed reads and valid unlinked PDFs
are recorded as errors, never as evidence that the Board published nothing (``.claude/rules/grounded-answers.md`` rule 12, missing versus zero).

Which database, and what it needs: ``--target production`` needs ``SUPABASE_PROJECT_URL``
and ``SUPABASE_DB_PASSWORD``, and a real (non-dry) run of either target needs the 4
``SUPABASE_STORAGE_S3_*`` credentials, because the downloaded bytes are kept in a private
Supabase Storage bucket. All of them live in the gitignored ``.env`` at the repository
root. A dry run needs neither.

Design: ``docs/architecture/campaign-finance-system-design.md`` §4.5 (how a stored body is
kept) and §5.1 (what may attach a record to a named person).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.campaign_finance_refunds import (  # noqa: E402
    LoadReport,
    load_refund_summaries,
)


def _outcome_state(outcome, *, dry_run: bool) -> str:
    """What happened to one file, in the fewest words that are true of it."""
    if outcome.unavailable_reason:
        return f"unavailable -- {outcome.unavailable_reason}"
    if outcome.not_published_reason:
        return f"nothing to load -- {outcome.not_published_reason}"
    if dry_run:
        return "would be quarantined" if outcome.blocked else "would publish"
    if outcome.blocked:
        return "quarantined: a check that must pass did not"
    if outcome.reused and outcome.published:
        return "already held, still published"
    if outcome.published:
        return "published"
    return "not published"


def report_lines(report: LoadReport, *, dry_run: bool) -> list[str]:
    """The end-of-run report, one line per file, then the gaps, then the errors."""
    lines: list[str] = [f"{len(report.outcomes)} file(s) read"]
    for outcome in report.outcomes:
        rows = "-" if outcome.parsed is None else str(len(outcome.parsed.rows))
        lines.append(
            f"  {outcome.link.year} {outcome.link.kind}: {rows} row(s), "
            f"{_outcome_state(outcome, dry_run=dry_run)}"
        )
        if outcome.parsed is not None and outcome.parsed.unreadable:
            lines.append(
                f"    {len(outcome.parsed.unreadable)} line(s) carried money and could "
                "not be read; they are kept rather than dropped"
            )
        for check in outcome.checks:
            if check.blocks_publishing:
                lines.append(f"    failed: {check.name}: {check.detail}")
        if not dry_run and outcome.summary_id is not None:
            lines.append(
                f"    {outcome.attached_rows} row(s) attached to a confirmed "
                f"committee, {outcome.unattached_rows} not"
            )

    if report.not_published:
        lines.append(
            f"{len(report.not_published)} file(s) the Board publishes nothing for"
        )
        for year, kind, reason in report.not_published:
            lines.append(f"  {year} {kind}: {reason}")

    if report.errors:
        lines.append(f"{len(report.errors)} error(s)")
        for error in report.errors:
            lines.append(f"  {error}")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch Minnesota's yearly Political Contribution Refund summaries, read the "
            "figures out of the printed pages, and publish each file that passes its "
            "checks."
        )
    )
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET") or "local",
        choices=("local", "production"),
        help="Which database the summaries are published to. Default local.",
    )
    parser.add_argument("--database-url", default=None)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch, parse and run every check, then report and write nothing — not "
        "to the database and not to the file store. Needs no storage credentials.",
    )
    parser.add_argument(
        "--year",
        action="append",
        type=int,
        default=None,
        metavar="YEAR",
        help="Load only this year, and probe only this year for a file the Board's "
        "page does not link. May be passed multiple times. Default every year the "
        "page links.",
    )
    args = parser.parse_args()

    database_url = normalize_database_url(
        args.database_url or database_url_for_target(args.target)
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine) as session:
        report = load_refund_summaries(
            session,
            years=args.year,
            dry_run=args.dry_run,
            log=lambda message: print(message, file=sys.stderr),
        )

    for line in report_lines(report, dry_run=args.dry_run):
        print(line)

    if report.errors or any(outcome.blocked for outcome in report.outcomes):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
