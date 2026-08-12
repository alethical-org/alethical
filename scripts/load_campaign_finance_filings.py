#!/usr/bin/env python3
"""Fetch what each Minnesota committee itself reported, and the state's filer list (#1408).

Net: this asks the Board, one committee at a time, what that committee reported raising
and spending, and stores the answer beside the payments we already hold. Without it the
only totals we can print are sums of the payments the state happened to name, which
understate every committee by roughly 4 dollars in 10. It also downloads Minnesota's
list of registered filers, which is what lets a registration number in a payment row be
resolved to a real committee.

    # what would happen, writing nothing to the database or the file store
    uv run python scripts/load_campaign_finance_filings.py --dry-run

    # one committee only, which is 3 requests instead of about 4,800
    uv run python scripts/load_campaign_finance_filings.py --dry-run --only-filers 11880

    # the real thing, locally
    uv run python scripts/load_campaign_finance_filings.py --target local

    # the real thing, against production
    uv run python scripts/load_campaign_finance_filings.py --target production

**A full run is about 4,800 requests and takes roughly 48 minutes.** One committee costs
1 catalogue request plus 1 request per 2-year window, and the default asks about this
calendar year and the one before it. Requests are spaced 0.25 seconds apart, which is
the pacing that drew no refusal across roughly 1,200 requests in 2 hours on 11 August
2026 — an observation about that day, not a rate limit the Board has published.

**A run that fails its checks is quarantined, not published**, and this command exits
non-zero. Its responses are kept either way, so a bad run can be examined. That includes
the very first run, which has nothing to compare against: read the counts it printed,
then publish it by naming the record hash you reviewed.

    uv run python scripts/load_campaign_finance_filings.py --target local \\
        --publish-hash <the records line, in full>

Naming a hash waives only the **comparison** checks — filer count, filer-year count,
reported total, the share of empty answers, the pinned test figures. It never waives a
structural one: a response that did not parse, a label this design does not know, a
value that is not money, and an empty-answer share above the ceiling stop the run
whatever you pass.

Which database, and what it needs: ``--target production`` needs
``SUPABASE_PROJECT_URL`` and ``SUPABASE_DB_PASSWORD``, and a real (non-dry) run of
either target needs the 4 ``SUPABASE_STORAGE_S3_*`` credentials, because every response
is kept in a private Supabase Storage bucket. All of them live in the gitignored
``.env`` at the repository root. A dry run needs neither.

Design: ``docs/architecture/campaign-finance-system-design.md`` §9 (Filed reports: where
the official totals come from). Plain-English walkthrough:
``docs/product-onboarding/data-ingestion-onboarding.md`` § "H — Campaign finance".
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
from alethical.pipeline.campaign_finance_filings import (  # noqa: E402
    CampaignFinanceFilingsRefusal,
    load_campaign_finance_filings,
    publish_stored_filings,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch each Minnesota committee's own reported figures and the state's "
            "registered-filer list, check them, and publish them as one dated set "
            "that replaces the previous one."
        )
    )
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET") or "local",
        choices=("local", "production"),
        help="Which database the set is published to. Default local.",
    )
    parser.add_argument("--database-url", default=None)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and run every check, then report and write nothing — not to the "
        "database and not to the file store. Needs no storage credentials.",
    )
    parser.add_argument(
        "--years",
        nargs="+",
        type=int,
        default=None,
        metavar="YEAR",
        help="Which calendar years to ask about. Default this year and last year. "
        "Each year resolves to its 2-year election segment, and one request returns "
        "both years of a segment, so asking for 2024 and 2025 costs no more than 2025 "
        "alone.",
    )
    parser.add_argument(
        "--only-filers",
        nargs="+",
        default=None,
        metavar="REGNUM",
        help="Ask about only these registration numbers. Turns a 48-minute run into "
        "seconds, which is what makes a scoped live check possible before a full one.",
    )
    parser.add_argument(
        "--publish-hash",
        default=None,
        metavar="SHA256",
        help="Fetch again, and publish if the figures still hash to this. Prefer "
        "--publish-stored-hash, which skips the 48-minute fetch entirely.",
    )
    parser.add_argument(
        "--publish-stored-hash",
        default=None,
        metavar="SHA256",
        help="Publish a set already on file, from the responses kept at fetch time, "
        "WITHOUT fetching anything. This is the intended path for a first run: read the "
        "counts a run printed, then name its record hash (the 'records' line, in full). "
        "Re-fetching to publish takes another 48 minutes and in an election season may "
        "never agree, because filings land daily and each fetch hashes differently. "
        "Structural checks still run against whatever is live now.",
    )
    args = parser.parse_args()

    if args.publish_stored_hash and (
        args.dry_run or args.publish_hash or args.only_filers or args.years
    ):
        parser.error(
            "--publish-stored-hash publishes bytes already on file and fetches nothing, "
            "so it takes no --years, no --only-filers, no --publish-hash and no "
            "--dry-run. The years and filers are whatever that stored run covered."
        )

    database_url = normalize_database_url(
        args.database_url or database_url_for_target(args.target)
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine) as session:
        try:
            if args.publish_stored_hash:
                run = publish_stored_filings(
                    session,
                    args.publish_stored_hash,
                    log=lambda message: print(message, file=sys.stderr),
                )
                print(run.summary())
                return 1 if run.blocked else 0
            run = load_campaign_finance_filings(
                session,
                dry_run=args.dry_run,
                years=args.years,
                only_filers=args.only_filers,
                publish_hash=args.publish_hash,
                log=lambda message: print(message, file=sys.stderr),
            )
        except CampaignFinanceFilingsRefusal as refusal:
            print(f"refused: {refusal}", file=sys.stderr)
            return 1

    print(run.summary())
    return 1 if run.blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
