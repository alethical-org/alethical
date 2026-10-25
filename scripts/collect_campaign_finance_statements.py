#!/usr/bin/env python3
"""Record the disclosure statements committees' catalogues list, and keep their PDFs (#2347).

Net: an unregistered association giving to an independent-expenditure committee files
a disclosure statement naming where the money for that gift came from. The Board lists
each one in the recipient committee's report catalogue. This reads the catalogues,
records each statement listed (never deleting one no longer listed), fetches each
statement PDF we do not hold (once, then kept), and notes any notice the catalogue marks
as revised.

This standalone collector reads the catalogues for statements and notice amendments.
It shares a narrow writer lock with notice collection and reviewed statement readings.

Usage::

    PYTHONPATH=. uv run python scripts/collect_campaign_finance_statements.py --target production --dry-run
    PYTHONPATH=. uv run python scripts/collect_campaign_finance_statements.py --target production --kinds all
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from contextlib import redirect_stdout
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db import models as schema  # noqa: E402
from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline import campaign_finance_filings as filings  # noqa: E402
from alethical.pipeline import campaign_finance_notices as notices  # noqa: E402
from alethical.pipeline.collection_run_summary import (  # noqa: E402
    record_stage,
    run_script,
)
from alethical.pipeline.cache_purge import (  # noqa: E402
    clear_and_note,
    when_notices_or_statements_are_stored,
)
from alethical.pipeline.raw_file_store import raw_file_store_from_env  # noqa: E402
from alethical.pipeline.notice_collection_lock import (  # noqa: E402
    NoticeWriterBusy,
    NoticeWriterLost,
)
from alethical.pipeline.campaign_notice_reference import load_reference  # noqa: E402
from alethical.pipeline.request_limits import DatabaseRequestLimiter, RateLimitedSession  # noqa: E402

KINDS = {
    "committees": (schema.CampaignFinanceFilerKind.political_committee_or_fund,),
    "all": tuple(schema.CampaignFinanceFilerKind),
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET") or "local",
        choices=("local", "production"),
    )
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--refresh-existing",
        action="store_true",
        help="Check retained statement PDFs for corrections at unchanged addresses.",
    )
    parser.add_argument("--pdf-cache", default=None)
    parser.add_argument(
        "--kinds",
        default="all",
        choices=sorted(KINDS),
        help="Which filers' catalogues to read. 'committees' (political committees and "
        "funds only); 'all' also checks candidates and party units for amendment markers.",
    )
    parser.add_argument("--only", nargs="*", default=None, help="Registration numbers.")
    parser.add_argument("--year", type=int, default=datetime.now(UTC).year)
    parser.add_argument(
        "--json", action="store_true", help="Print a safe source-check summary as JSON."
    )
    args = parser.parse_args()

    engine = create_engine(
        normalize_database_url(
            args.database_url or database_url_for_target(args.target)
        ),
        connect_args=NO_PREPARED_STATEMENTS,
    )
    try:
        if args.json:
            summary: dict = {}
            with redirect_stdout(sys.stderr):
                code = _collect(args, engine, summary=summary)
            print(json.dumps({"exit_code": code, **summary}, sort_keys=True))
            return code
        return _collect(args, engine)
    except (NoticeWriterBusy, NoticeWriterLost) as error:
        print(str(error), file=sys.stderr)
        record_stage(
            "statements", "skipped", details=["notice/statement writer unavailable"]
        )
        return 76
    finally:
        engine.dispose()


def _collect(args, engine, summary: dict | None = None) -> int:
    with Session(engine) as db:
        if not db.execute(
            text("SELECT to_regclass('cf_disclosure_statement')")
        ).scalar():
            print(
                "refused: apply the migrations first (alembic upgrade head).",
                file=sys.stderr,
            )
            return 1
        try:
            reference = load_reference(engine)
        except ValueError as error:
            print(f"refused: {error}", file=sys.stderr)
            return 1
        wanted = sorted(
            [
                (f.kind, f.registration_number)
                for f in reference.filers
                if f.kind in KINDS[args.kinds]
                and (not args.only or f.registration_number in args.only)
            ],
            key=lambda row: row[1],
        )
        if not wanted:
            print(
                "refused: no requested catalogues in the published register",
                file=sys.stderr,
            )
            return 1
        print(f"reading {len(wanted)} catalogues for {args.year}", flush=True)
        store = None if args.dry_run else raw_file_store_from_env()
        report = notices.scan_catalogues_for_statements(
            db,
            RateLimitedSession(filings.http_session(), DatabaseRequestLimiter(engine)),
            store,
            filers=[(kind, number) for kind, number in wanted],
            segment=filings.segment_for_year(args.year),
            scope=f"{args.kinds}{' only ' + ' '.join(args.only) if args.only else ''}",
            dry_run=args.dry_run,
            cache=notices.PdfCache(args.pdf_cache),
            refresh_existing=args.refresh_existing,
            completion_check=lambda: reference.still_current(db),
        )
    print(
        f"catalogues read: {report.catalogues_read} of {len(wanted)}; statements listed: "
        f"{report.listed}; new: {report.new}; PDFs fetched and kept: {report.pdfs_fetched}; "
        f"notices marked revised and re-read: {report.notice_amendments}"
    )
    for line in report.failures:
        print(f"problem: {line}")
    for line in report.not_served:
        print(f"not served, asked again next run: {line}")
    catalogue_failed = bool(
        report.failures or report.catalogues_read < len(wanted) or report.not_served
    )
    # A full scan records a new copy date, which the statement cards print (#1979).
    clearing_failed, clearing_note = clear_and_note(
        when_notices_or_statements_are_stored(),
        stored=not args.dry_run
        and (report.new > 0 or report.notice_amendments > 0 or not catalogue_failed),
    )
    failed = catalogue_failed or clearing_failed
    # What this run did, for the failure review (#2350).
    record_stage(
        "statements",
        "failed"
        if failed
        else "dry_run"
        if args.dry_run
        else "published"
        if report.new
        else "unchanged",
        failed_checks=(["catalogue read"] if catalogue_failed else [])
        + (["clearing saved answers"] if clearing_failed else []),
        details=list(report.failures)
        + [f"not served: {line}" for line in report.not_served]
        + [clearing_note],
        counts={
            "catalogues read": report.catalogues_read,
            "statements listed": report.listed,
            "statements new": report.new,
            "PDFs kept": report.pdfs_fetched,
            "PDFs not served": len(report.not_served),
        },
    )
    # PDFs the Board says it does not hold are source gaps, asked for again next
    # run: a review result (2), not a failed collector, so a scheduled weekly scan is
    # not retried every few hours. Any other problem still fails.
    only_source_gaps = bool(
        report.not_served
        and not report.failures
        and report.catalogues_read == len(wanted)
        and not clearing_failed
    )
    code = 2 if only_source_gaps else 1 if failed else 0
    if summary is not None:
        summary.update(
            status={0: "complete", 1: "failed", 2: "review"}[code],
            catalogues_read=report.catalogues_read,
            catalogues_wanted=len(wanted),
            statements_new=report.new,
            pdfs_kept=report.pdfs_fetched,
            pdfs_not_served=len(report.not_served),
            problems=len(report.failures),
        )
    return code


if __name__ == "__main__":
    raise SystemExit(run_script("statements", main))
