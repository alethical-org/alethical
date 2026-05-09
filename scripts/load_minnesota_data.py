#!/usr/bin/env python3
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

from alethical.db.session import normalize_database_url  # noqa: E402
from alethical.ingestion.minnesota import BillTarget, MinnesotaIngestionPipeline  # noqa: E402

DEFAULT_BILLS = [
    BillTarget(chamber="House", bill_number="2136"),
    BillTarget(chamber="House", bill_number="4"),
    BillTarget(chamber="House", bill_number="1"),
    BillTarget(chamber="Senate", bill_number="1832"),
    BillTarget(chamber="Senate", bill_number="2483"),
    BillTarget(chamber="Senate", bill_number="3095"),
    BillTarget(chamber="Senate", bill_number="1047"),
    BillTarget(chamber="Senate", bill_number="1097"),
]


def parse_bill(value: str, session_code: str) -> BillTarget:
    normalized = value.strip().upper().replace(" ", "")
    if normalized.startswith("HF"):
        return BillTarget(chamber="House", bill_number=normalized.removeprefix("HF"), session_code=session_code)
    if normalized.startswith("SF"):
        return BillTarget(chamber="Senate", bill_number=normalized.removeprefix("SF"), session_code=session_code)
    raise argparse.ArgumentTypeError(f"Bill must look like HF2136 or SF1832, got {value!r}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Load live Minnesota legislative data into the canonical database.")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--session-code", default="0942025", help="Minnesota search session code, e.g. 0942025.")
    parser.add_argument(
        "--bill",
        action="append",
        default=[],
        help="Bill identifier to ingest, e.g. HF2136 or SF1832. May be passed multiple times.",
    )
    parser.add_argument("--skip-bills", action="store_true", help="Do not ingest bills.")
    parser.add_argument("--skip-legislators", action="store_true", help="Do not ingest the legislator roster.")
    parser.add_argument(
        "--legislator-limit",
        type=int,
        default=None,
        help="Limit roster/profile ingestion for smoke runs. Omit for the full roster.",
    )
    parser.add_argument(
        "--roster-only",
        action="store_true",
        help="Load roster identity/service rows without fetching each member profile.",
    )
    args = parser.parse_args()

    database_url = normalize_database_url(
        args.database_url or "postgresql+psycopg://alethical:alethical@localhost:54329/alethical"
    )
    targets = [parse_bill(value, args.session_code) for value in args.bill]
    if not targets and not args.skip_bills:
        targets = [BillTarget(item.chamber, item.bill_number, args.session_code) for item in DEFAULT_BILLS]

    engine = create_engine(database_url, echo=False)
    with Session(engine) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        if not args.skip_legislators:
            stats = pipeline.ingest_roster(limit=args.legislator_limit, fetch_profiles=not args.roster_only)
            print("legislators", stats)
        if not args.skip_bills:
            stats = pipeline.ingest_bills(targets)
            print("bills", stats)
        session.commit()


if __name__ == "__main__":
    main()
