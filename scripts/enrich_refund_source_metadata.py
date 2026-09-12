#!/usr/bin/env python3
"""Inspect saved refund PDFs and enrich source-note metadata, dry-run by default.

This command reads the Board's index and kept published candidate PDF bytes. It never fetches
new PDFs, re-matches candidates, changes amounts, publishes, or changes copy dates.
The JSON report includes each affected row's before/after metadata for backup/review.

    uv run python scripts/enrich_refund_source_metadata.py --target local
    uv run python scripts/enrich_refund_source_metadata.py --target local --apply
"""

from __future__ import annotations

import argparse
import json
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
    REFUND_INDEX_URL,
    REQUEST_TIMEOUT_SECONDS,
    enrich_refund_source_metadata,
    http_session,
)
from alethical.pipeline.raw_file_store import raw_file_store_from_env  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), required=True)
    parser.add_argument("--index-url", default=REFUND_INDEX_URL)
    parser.add_argument("--year", type=int, action="append")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply metadata after all saved PDFs pass hash checks",
    )
    args = parser.parse_args()
    with http_session() as http:
        response = http.get(args.index_url, timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        index_html = response.text
    engine = create_engine(
        normalize_database_url(database_url_for_target(args.target)),
        connect_args=NO_PREPARED_STATEMENTS,
    )
    with Session(engine) as db:
        report = enrich_refund_source_metadata(
            db,
            store=raw_file_store_from_env(),
            index_html=index_html,
            index_url=args.index_url,
            years=args.year,
            dry_run=not args.apply,
        )
        # Print the exact reversible change before committing it.
        print(
            json.dumps({"dry_run": not args.apply, "summaries": report}, indent=2),
            flush=True,
        )
        if args.apply:
            db.commit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
