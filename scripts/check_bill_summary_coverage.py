#!/usr/bin/env python3
"""Report complete current bills with a missing or outdated full summary (#457).

This reads saved official text, the product's current-summary flag, and the
durable request row. It makes no model call and writes nothing. A summary gap
therefore stays visible even while automatic paid work is switched off.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.bill_summary_requests import summary_gap_rows


ISSUE_SAMPLE_LIMIT = 100
ISSUE_REPORT_CHAR_LIMIT = 50_000


def _gap_line(gap: Any) -> str:
    return (
        f"    {str(gap.bill_key)[:100]:20} "
        f"request={str(gap.request_status or 'missing')[:100]} "
        f"fingerprint={str(gap.source_text_fingerprint)[:64]}"
    )


def issue_report(gaps: Iterable[Any]) -> str:
    """A bounded alert summary; the workflow keeps the full report as an artifact."""
    rows = list(gaps)
    lines = [
        f"SUMMARY GAPS: {len(rows)} complete current bills have a missing or "
        "outdated full summary:"
    ]
    lines.extend(_gap_line(gap) for gap in rows[:ISSUE_SAMPLE_LIMIT])
    omitted = len(rows) - ISSUE_SAMPLE_LIMIT
    if omitted > 0:
        lines.append(
            f"    ... {omitted:,} more gaps are in the attached workflow report."
        )
    report = "\n".join(lines)
    if len(report) > ISSUE_REPORT_CHAR_LIMIT:
        report = report[: ISSUE_REPORT_CHAR_LIMIT - 80].rstrip()
        report += "\n    ... the remaining gaps are in the attached workflow report."
    return report


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Report complete current bills without a matching full summary."
    )
    parser.add_argument("--issue-report-path", type=Path, default=None)
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    database_url = normalize_database_url(
        os.environ.get("DATABASE_URL")
        or database_url_for_target(os.environ.get("ALETHICAL_DATABASE_TARGET"))
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine) as db:
        gaps = summary_gap_rows(db)

    if not gaps:
        report = "OK: every complete current bill has a current full summary."
        print(report)
        if args.issue_report_path is not None:
            args.issue_report_path.write_text(report + "\n", encoding="utf-8")
        return 0

    header = (
        f"SUMMARY GAPS: {len(gaps)} complete current bills have a missing or "
        "outdated full summary:"
    )
    print(header)
    for gap in gaps:
        print(_gap_line(gap))
    if args.issue_report_path is not None:
        args.issue_report_path.write_text(issue_report(gaps) + "\n", encoding="utf-8")
    return 1


if __name__ == "__main__":
    sys.exit(main())
