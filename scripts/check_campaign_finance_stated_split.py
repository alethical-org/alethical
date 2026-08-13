#!/usr/bin/env python3
"""Check each committee's filing against the payments we hold for it (#1433).

Net: a committee's own filed report says how much of its money it named donors for.
This reads that figure out of the report and compares it to the payments we actually
hold. It is the only way to see our records being SHORT, and short is the dangerous
direction: money we are missing lands in the "no donor named" figure a page works out by
subtraction, where it reads as ordinary small-donor money under a real politician's name.

    # what would happen, writing nothing
    uv run python scripts/check_campaign_finance_stated_split.py --dry-run

    # the 4 committees whose figures are known to disagree, which is 4 requests
    uv run python scripts/check_campaign_finance_stated_split.py --dry-run \\
        --only-filers 18488 19043 17709 20010

    # one year, against production
    uv run python scripts/check_campaign_finance_stated_split.py \\
        --target production --years 2025

**This never blocks a release.** It reports per committee-year, so one committee whose
figures contradict each other withholds its own split while every other committee
publishes normally. Eugene ruled on 12 Aug 2026 that where 2 of Minnesota's own
publications disagree and we cannot derive the truth, we show both figures and say
plainly that they disagree.

**It cannot cover everything, and it says so rather than passing quietly.** The Board
serves no report document before 2023 and serves none for several report kinds inside
the years it does cover, answering HTTP 200 to every refusal. Those committee-years are
recorded as **not checked**, never as passed.

**And the reader proves itself first.** Each contributor-type figure the Board's totals
route publishes equals the matching schedule's itemized plus non-itemized cash, so the
reader is checked against numbers we already trust before it may say a filing disagrees.
When it fails that check the committee-year reads ``reader_unproven``, which says our
reader is wrong and makes no claim about the data.

A full year is roughly 1,300 requests at 0.25 seconds apart, so about 20 minutes. It
needs a published payments release and a published filings snapshot; run
``scripts/load_campaign_finance.py`` and ``scripts/load_campaign_finance_filings.py``
first. ``--target production`` needs ``SUPABASE_PROJECT_URL`` and
``SUPABASE_DB_PASSWORD`` from the gitignored ``.env`` at the repository root. No file
store is used: the document's own sha256 is recorded and the bytes are not kept.

Design: ``docs/architecture/campaign-finance-system-design.md`` §9.4 (Report PDFs are a
fallback, not a route).
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db.models import (  # noqa: E402
    CampaignFinanceStatedSplitStatus as Status,
)
from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.campaign_finance_stated_split import (  # noqa: E402
    StatedSplitRun,
    run_stated_split_check,
)


def summary(run: StatedSplitRun) -> str:
    counts = run.counts()
    agreed, tested = run.reader_accuracy()
    elapsed = ""
    if run.completed_at is not None:
        seconds = (run.completed_at - run.started_at).total_seconds()
        elapsed = f" in {seconds / 60:.1f} minutes"
    lines = [
        f"years {', '.join(str(year) for year in run.years)}: "
        f"{len(run.verdicts):,} committee-years, {run.requests_made:,} requests"
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
            "Compare each committee's own stated itemized figure, read from its filed "
            "report, against the payments we hold for it."
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
        help="Fetch, read and compare, then report and write nothing.",
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
        help="Check only these registration numbers. Turns a 20-minute run into "
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
    with Session(engine) as session:
        try:
            run = run_stated_split_check(
                session,
                years=years,
                only_filers=args.only_filers,
                write=not args.dry_run,
                progress=lambda message: print(message, file=sys.stderr),
            )
        except RuntimeError as refusal:
            print(f"refused: {refusal}", file=sys.stderr)
            return 1

    print(summary(run))
    # Always 0. A committee-year whose figures disagree is a finding to display, not a
    # failure to stop a pipeline with, and exiting non-zero here would invite exactly
    # the release-wide refusal Eugene ruled against on 12 Aug 2026.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
