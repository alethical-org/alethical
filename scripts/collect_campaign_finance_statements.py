#!/usr/bin/env python3
"""Record the disclosure statements committees' catalogues list, and keep their PDFs (#2347).

Net: an unregistered association giving to an independent-expenditure committee files
a disclosure statement naming where the money for that gift came from. The Board lists
each one in the recipient committee's report catalogue. This reads the catalogues,
records each statement listed (never deleting one no longer listed), fetches each
statement PDF we do not hold (once, then kept), and notes any notice the catalogue marks
as revised.

The filings loader already fetches every catalogue at each totals refresh; it can call
``campaign_finance_notices.record_catalogue_statements`` with the catalogue it holds, at
no extra request to the Board. This script is the standalone form, for the backfill and
for a refresh that does not hold the catalogues.

Usage::

    PYTHONPATH=. uv run python scripts/collect_campaign_finance_statements.py --target production --dry-run
    PYTHONPATH=. uv run python scripts/collect_campaign_finance_statements.py --target production --kinds all
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine, select, text
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
from alethical.pipeline.raw_file_store import raw_file_store_from_env  # noqa: E402

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
    parser.add_argument("--pdf-cache", default=None)
    parser.add_argument(
        "--kinds",
        default="committees",
        choices=sorted(KINDS),
        help="Which filers' catalogues to read. 'committees' (political committees and "
        "funds, where statements are filed) is the routine scope; 'all' is the backfill.",
    )
    parser.add_argument("--only", nargs="*", default=None, help="Registration numbers.")
    parser.add_argument("--year", type=int, default=datetime.now(UTC).year)
    args = parser.parse_args()

    engine = create_engine(
        normalize_database_url(
            args.database_url or database_url_for_target(args.target)
        ),
        connect_args=NO_PREPARED_STATEMENTS,
    )
    with Session(engine) as db:
        if not db.execute(
            text("SELECT to_regclass('cf_disclosure_statement')")
        ).scalar():
            print(
                "refused: apply the migrations first (alembic upgrade head).",
                file=sys.stderr,
            )
            return 1
        snapshot = filings.live_filings_snapshot(db)
        if snapshot is None:
            print(
                "refused: no published register to read filers from.", file=sys.stderr
            )
            return 1
        filer = schema.CampaignFinanceFiler
        query = select(filer.kind, filer.registration_number).where(
            filer.snapshot_id == snapshot.id, filer.kind.in_(KINDS[args.kinds])
        )
        if args.only:
            query = query.where(filer.registration_number.in_(args.only))
        wanted = sorted(db.execute(query).all(), key=lambda row: row[1])
        print(f"reading {len(wanted)} catalogues for {args.year}", flush=True)
        store = None if args.dry_run else raw_file_store_from_env()
        report = notices.scan_catalogues_for_statements(
            db,
            filings.http_session(),
            store,
            filers=[(kind, number) for kind, number in wanted],
            segment=filings.segment_for_year(args.year),
            scope=f"{args.kinds}{' only ' + ' '.join(args.only) if args.only else ''}",
            dry_run=args.dry_run,
            cache=notices.PdfCache(args.pdf_cache),
        )
    print(
        f"catalogues read: {report.catalogues_read} of {len(wanted)}; statements listed: "
        f"{report.listed}; new: {report.new}; PDFs fetched and kept: {report.pdfs_fetched}; "
        f"notices marked revised and re-read: {report.notice_amendments}"
    )
    for line in report.failures:
        print(f"problem: {line}")
    failed = bool(report.failures or report.catalogues_read < len(wanted))
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
        failed_checks=["catalogue read"] if failed else [],
        details=list(report.failures),
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(run_script("statements", main))
