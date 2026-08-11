#!/usr/bin/env python3
"""Load Minnesota's 3 campaign-finance downloads as one dated, replaceable set (#1328).

Net: this fetches the Board's 3 "All" files, keeps each download's exact bytes,
checks the new set against the one already published, and publishes it by replacing
the previous set entirely. Running it twice on unchanged files changes nothing.

    # what would happen, writing nothing to the database or the file store
    uv run python scripts/load_campaign_finance.py --dry-run

    # the real thing, locally
    uv run python scripts/load_campaign_finance.py --target local

    # the real thing, against production
    uv run python scripts/load_campaign_finance.py --target production

**A set that fails its checks is quarantined, not published**, and the command
exits non-zero. Its bytes are kept either way, so the download can be examined.
That includes the very first import, which has nothing to compare against: read
the measurements it printed, then publish it by naming the exact 3 hashes you
reviewed.

    uv run python scripts/load_campaign_finance.py --target local \\
        --publish-hashes <contributions> <expenditures> <independent>

Naming hashes waives only the **comparison** checks — row count, byte size, total,
repeat share, per-year rows, new blanks. It never waives a structural one: a header
that does not match the pinned contract, a record with the wrong number of fields, a
date that is not a date, or an amount that would have to be rounded stop the run
whatever you pass.

Which database, and what it needs: ``--target production`` needs
``SUPABASE_PROJECT_URL`` and ``SUPABASE_DB_PASSWORD``, and a real (non-dry) run of
either target needs the 4 ``SUPABASE_STORAGE_S3_*`` credentials, because the
downloaded bytes are kept in a private Supabase Storage bucket. All of them live in
the gitignored ``.env`` at the repository root. A dry run needs neither.

Design: ``docs/architecture/campaign-finance-system-design.md`` §4 (Ingestion:
snapshot and replace). Plain-English walkthrough:
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
from alethical.pipeline.campaign_finance import (  # noqa: E402
    CampaignFinanceRefusal,
    load_campaign_finance,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch Minnesota's 3 campaign-finance downloads, check them, and publish "
            "them as one dated set that replaces the previous one."
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
        help="Fetch, parse and run every check, then report and write nothing — not "
        "to the database and not to the file store. Needs no storage credentials.",
    )
    parser.add_argument(
        "--publish-hashes",
        nargs="+",
        default=None,
        metavar="SHA256",
        help="Publish a set the comparison checks quarantined, by naming all 3 of "
        "its content hashes. This is the intended path for a first import. Structural "
        "checks are never waived.",
    )
    args = parser.parse_args()

    if args.publish_hashes is not None and len(args.publish_hashes) != 3:
        parser.error(
            "--publish-hashes takes all 3 hashes, one per file, so a set cannot be "
            f"waved through by accident. Got {len(args.publish_hashes)}."
        )

    database_url = normalize_database_url(
        args.database_url or database_url_for_target(args.target)
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine) as session:
        try:
            report = load_campaign_finance(
                session,
                dry_run=args.dry_run,
                publish_hashes=args.publish_hashes,
                log=lambda message: print(message, file=sys.stderr),
            )
        except CampaignFinanceRefusal as refusal:
            print(f"refused: {refusal}", file=sys.stderr)
            return 1

    print(report.summary())
    if report.refusal:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
