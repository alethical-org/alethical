"""One-time backfill for Bill.companion_bill_id (#293).

The companion-linking step now runs on every ingest (see
alethical/pipeline/minnesota.py: parse_bill_xml + upsert_bill.link_companion),
but the ~10.5k bills already in the corpus were ingested before it existed and
read 0% linked. This script repopulates them WITHOUT a paid re-ingest: it
re-fetches only the free MN Revisor status XML per bill, reads COMPANION_TYPE /
COMPANION_NUMBER, and sets companion_bill_id on both sides.

MN companion pairs are always cross-chamber (a House HF and its Senate SF), so
iterating only the HF bills discovers and links every pair — half the fetches.

Usage:
    # dry run (no writes), whole corpus
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/backfill_companion_links.py --dry-run
    # scoped single-pair live check
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/backfill_companion_links.py --bill-key 94-2025-HF2431
    # full run
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/backfill_companion_links.py
"""

from __future__ import annotations

import argparse
import os
import re
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from alethical.db.schema import load_schema
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target
from alethical.pipeline.minnesota import (
    fetch_text,
    http_session,
    parse_bill_xml,
)

schema = load_schema()
Bill = schema.Bill

BILL_KEY_RE = re.compile(r"^(\d+)-(\d{4})-([A-Za-z]+)(\d+)$")


def status_xml_url(bill_key: str) -> str | None:
    """Build a bill's Revisor status-XML URL from its bill_key.

    bill_key "94-2025-HF2716" -> https://api.revisor.mn.gov/bills/v1/94/2025/0/HF/2716/
    """
    match = BILL_KEY_RE.match(bill_key)
    if not match:
        return None
    session_number, year, file_type, file_number = match.groups()
    return (
        f"https://api.revisor.mn.gov/bills/v1/{session_number}/{year}/0/"
        f"{file_type.upper()}/{file_number}/"
    )


def companion_key_for(bill_key: str, sess) -> str | None:
    """Fetch a bill's status XML and return its companion's bill_key, or None."""
    url = status_xml_url(bill_key)
    if url is None:
        return None
    try:
        canonical = parse_bill_xml(fetch_text(sess, url))
    except Exception:
        # Best-effort backfill: a fetch/parse failure on one bill just skips it.
        return None
    companion_type = str(canonical.get("companion_type") or "").strip().upper()
    companion_number = str(canonical.get("companion_number") or "").strip()
    if not companion_type or not companion_number:
        return None
    return (
        f"{canonical['session_number']}-{canonical['session_year']}"
        f"-{companion_type}{companion_number}"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dry-run", action="store_true", help="fetch + resolve, no DB writes"
    )
    parser.add_argument(
        "--bill-key", help="link just this one bill (scoped live check)"
    )
    parser.add_argument(
        "--limit", type=int, help="cap the number of HF bills processed"
    )
    parser.add_argument("--concurrency", type=int, default=8)
    args = parser.parse_args()

    target = os.environ.get("ALETHICAL_DATABASE_TARGET")
    engine = create_engine(
        database_url_for_target(target), connect_args=NO_PREPARED_STATEMENTS
    )

    with Session(engine) as db:
        # bill_key -> id for every bill, to resolve companions.
        key_to_id = dict(db.execute(select(Bill.bill_key, Bill.id)).all())

        if args.bill_key:
            source_keys = [args.bill_key]
        else:
            # HF bills only: cross-chamber pairs are all discovered from the House side.
            source_keys = [
                k
                for k in key_to_id
                if BILL_KEY_RE.match(k) and k.split("-")[2].startswith("HF")
            ]
            source_keys.sort()
            if args.limit:
                source_keys = source_keys[: args.limit]

        print(
            f"target={target or 'local'} source_bills={len(source_keys)} dry_run={args.dry_run}"
        )

        sess = http_session()

        def resolve(bill_key: str) -> tuple[str, str | None]:
            return bill_key, companion_key_for(bill_key, sess)

        linked_pairs = 0
        no_companion = 0
        companion_missing = 0
        processed = 0
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            for bill_key, companion_key in pool.map(resolve, source_keys):
                processed += 1
                if companion_key is None:
                    no_companion += 1
                elif companion_key not in key_to_id:
                    companion_missing += 1
                else:
                    bill = db.get(Bill, key_to_id[bill_key])
                    companion = db.get(Bill, key_to_id[companion_key])
                    if not args.dry_run:
                        bill.companion_bill_id = companion.id
                        companion.companion_bill_id = bill.id
                    linked_pairs += 1
                    if args.bill_key or linked_pairs <= 5:
                        print(f"  link {bill_key} <-> {companion_key}")
                if processed % 500 == 0:
                    print(
                        f"  ...{processed}/{len(source_keys)} (linked={linked_pairs})"
                    )
                    if not args.dry_run:
                        db.commit()

        if not args.dry_run:
            db.commit()

        filled = db.scalar(
            select(func.count())
            .select_from(Bill)
            .where(Bill.companion_bill_id.is_not(None))
        )
        print(
            f"done: linked_pairs={linked_pairs} no_companion={no_companion} "
            f"companion_not_in_corpus={companion_missing} "
            f"total_bills_now_linked={filled}"
        )


if __name__ == "__main__":
    main()
