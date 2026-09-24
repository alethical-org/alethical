#!/usr/bin/env python3
"""Store the reviewed readings of disclosure statements' scanned PDFs (#2347).

Net: a statement PDF is a scanned image, so what it says is entered by a person who
read it, in ``alethical/pipeline/data/disclosure_statement_readings.json``. This stores
each reading after proving it was taken from the copy we keep: the kept PDF's page images
must hash to the reading's ``image_fingerprint``. A reading that fails is refused and the
run exits 1; a reading already stored unchanged is left alone.

``reviewed_by`` defaults to ``Alethical, LLC``, the reviewer of record the committee
confirmations use (``scripts/review_legislator_campaign_committees.py``).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline import campaign_finance_notices as notices  # noqa: E402
from alethical.pipeline.collection_run_summary import (  # noqa: E402
    record_stage,
    run_script,
)
from alethical.pipeline.raw_file_store import raw_file_store_from_env  # noqa: E402

REVIEWER_OF_RECORD = "Alethical, LLC"
READINGS = (
    ROOT / "alethical" / "pipeline" / "data" / "disclosure_statement_readings.json"
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET") or "local",
        choices=("local", "production"),
    )
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--readings", default=str(READINGS))
    parser.add_argument("--reviewer", default=REVIEWER_OF_RECORD)
    args = parser.parse_args()

    items = json.loads(Path(args.readings).read_text())["readings"]
    readings = [notices.reading_from_json(item, args.reviewer) for item in items]
    # A repeat must name an original in the same file that states exactly what it
    # states; anything else is 2 statements and both must show.
    by_key = {
        (
            r.recipient_registration_number,
            r.filing_year,
            r.report_period,
            r.statement_number,
        ): r
        for r in readings
    }
    for reading in readings:
        if reading.repeat_of_number is None:
            continue
        original = by_key.get(
            (
                reading.recipient_registration_number,
                reading.filing_year,
                reading.repeat_of_period,
                reading.repeat_of_number,
            )
        )
        if original is None or not notices.repeats_match(original, reading):
            print(
                f"refused: {reading.label} is not an exact repeat of what it names",
                file=sys.stderr,
            )
            return 1
    engine = create_engine(
        normalize_database_url(
            args.database_url or database_url_for_target(args.target)
        ),
        connect_args=NO_PREPARED_STATEMENTS,
    )
    refused = recorded = unchanged = 0
    with Session(engine) as db:
        if not db.execute(
            text("SELECT to_regclass('cf_disclosure_statement_reading')")
        ).scalar():
            print(
                "refused: apply the migrations first (alembic upgrade head).",
                file=sys.stderr,
            )
            return 1
        store = None if args.dry_run else raw_file_store_from_env()
        for reading in readings:
            outcome = notices.record_statement_reading(
                db, store, reading, dry_run=args.dry_run
            )
            print(outcome)
            if outcome.startswith("refused"):
                refused += 1
            elif outcome.startswith("recorded"):
                recorded += 1
            elif outcome.startswith("unchanged"):
                unchanged += 1
    # What this run did, for the failure review (#2350).
    record_stage(
        "statement readings",
        "failed"
        if refused
        else "dry_run"
        if args.dry_run
        else "published"
        if recorded
        else "unchanged",
        failed_checks=["reading refused"] if refused else [],
        counts={
            "readings stored": recorded,
            "readings already held": unchanged,
            "readings refused": refused,
        },
    )
    return 1 if refused else 0


if __name__ == "__main__":
    raise SystemExit(run_script("statement readings", main))
