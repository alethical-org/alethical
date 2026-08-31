#!/usr/bin/env python3
"""Check each committee's filing against the payments out we hold for it (#1645).

Net: the money coming **in** to every committee has been checked against the committee's
own filed report since #1433. The money going out had never been checked until 31 August
2026, and that run wrote nothing down. This is that check, stored per committee-year so
it can be read tomorrow and run again after the next download.

    # what would happen, writing nothing
    uv run python scripts/check_campaign_finance_stated_spending.py --dry-run

    # one committee, which is seconds rather than minutes
    uv run python scripts/check_campaign_finance_stated_spending.py --dry-run \\
        --only-filers 20010

    # every committee-year of 3 years, against production
    uv run python scripts/check_campaign_finance_stated_spending.py \\
        --target production --years 2024 2025 2026

**It asks the Board for nothing.** Every document it reads is one we already keep
(#1501), so a full sweep of about 3,600 committee-years costs 0 requests to
cfb.mn.gov and roughly 13 minutes. It needs the 4 ``SUPABASE_STORAGE_S3_*`` credentials
to read them back, and ``--target production`` needs ``SUPABASE_PROJECT_URL`` and
``SUPABASE_DB_PASSWORD`` from the environment settings file at the repository root.

**This never blocks a release.** It reports per committee-year, so one committee whose
figures contradict each other says so on its own page while every other committee
publishes normally.

**It cannot cover everything, and it says so rather than passing quietly.** A
committee-year we hold no document for is recorded as **not checked**, never as passed.

**And the reader proves itself first.** Each money-out figure the Board's totals route
publishes equals its schedule's paid column, and its ``total_expenditures`` equals every
money-out schedule together -- which is what proves the schedules the route reports no
line for. When that check fails the committee-year reads ``reader_unproven``, which says
our reader is wrong and makes no claim about the data.

Design: ``docs/architecture/campaign-finance-system-design.md`` §9.9 (what has and has
not been reconciled).
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db.models import (  # noqa: E402
    CampaignFinanceStatedSpendingStatus as Status,
)
from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.campaign_finance_report_document_store import (  # noqa: E402
    DocumentLibrary,
)
from alethical.pipeline.campaign_finance_stated_spending import (  # noqa: E402
    StatedSpendingRun,
    run_stated_spending_check,
)
from alethical.pipeline.raw_file_store import raw_file_store_from_env  # noqa: E402


def summary(run: StatedSpendingRun) -> str:
    counts = run.counts()
    agreed, tested = run.reader_accuracy()
    elapsed = ""
    if run.completed_at is not None:
        seconds = (run.completed_at - run.started_at).total_seconds()
        elapsed = f" in {seconds / 60:.1f} minutes"
    lines = [
        f"years {', '.join(str(year) for year in run.years)}: "
        f"{len(run.verdicts):,} committee-years, {run.documents_read:,} documents read"
        + elapsed,
        f"  agrees          {counts.get(Status.agrees.value, 0):,}",
        f"  disagrees       {counts.get(Status.disagrees.value, 0):,}",
        f"  not checked     {counts.get(Status.not_checked.value, 0):,}",
        f"  reader unproven {counts.get(Status.reader_unproven.value, 0):,}",
        f"  reader accuracy {agreed:,} of {tested:,} documents where the Board's own "
        "figures could prove it",
    ]
    if run.not_checked_reasons:
        lines.append("  why not checked:")
        for reason, count in sorted(
            run.not_checked_reasons.items(), key=lambda pair: -pair[1]
        ):
            lines.append(f"    {count:>6,}  {reason}")
    disagreeing = [v for v in run.verdicts if v.status is Status.disagrees]
    if disagreeing:
        lines.append("  committee-years whose 2 official sources do not agree:")
        for verdict in disagreeing:
            lines.append(
                f"    {verdict.registration_number} {verdict.filing_year}: "
                f"the filing states {verdict.stated_itemized} and we hold "
                f"{verdict.ours_itemized}"
            )
    unproven = [v for v in run.verdicts if v.status is Status.reader_unproven]
    if unproven:
        lines.append("  committee-years where OUR reader is at fault, not the data:")
        for verdict in unproven:
            lines.append(
                f"    {verdict.registration_number} {verdict.filing_year}: "
                f"{verdict.reason}"
            )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Compare each committee's own stated itemized money out, read from the "
            "filed report we already keep, against the payments we hold for it."
        )
    )
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET") or "local",
        choices=("local", "production"),
        help="Which database to read the payments from and write the answers to. "
        "Default local.",
    )
    parser.add_argument("--database-url", default=None)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read and compare, then report and write nothing.",
    )
    parser.add_argument(
        "--years",
        nargs="+",
        type=int,
        default=None,
        metavar="YEAR",
        help="Which filing years to check. Default this year and last year. Years "
        "before 2023 are reported as unavailable, because the Board serves no report "
        "document for them.",
    )
    parser.add_argument(
        "--only-filers",
        nargs="+",
        default=None,
        metavar="REGNUM",
        help="Check only these registration numbers. Turns a 13-minute run into "
        "seconds, which is what makes a scoped live check possible before a full one.",
    )
    args = parser.parse_args()

    this_year = datetime.now().year
    years = args.years or [this_year - 1, this_year]

    database_url = normalize_database_url(
        args.database_url or database_url_for_target(args.target)
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    with (
        Session(engine) as session,
        tempfile.TemporaryDirectory(prefix="cf-report-document-") as directory,
    ):
        library = DocumentLibrary(
            db=session, store=raw_file_store_from_env(), directory=directory
        )
        try:
            run = run_stated_spending_check(
                session,
                library,
                years=years,
                only_filers=args.only_filers,
                write=not args.dry_run,
                progress=lambda message: print(message, file=sys.stderr),
            )
        except RuntimeError as refusal:
            print(f"refused: {refusal}", file=sys.stderr)
            return 1

    print(summary(run))
    # A committee-year whose figures disagree exits 0. That is a finding to display, not
    # a failure to stop a pipeline with, and exiting non-zero on it would invite exactly
    # the release-wide refusal Eugene ruled against on 12 Aug 2026.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
