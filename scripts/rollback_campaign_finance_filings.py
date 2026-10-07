#!/usr/bin/env python3
"""Capture a live rollback baseline or restore its exact retained rows.

Capture and default restore are read-only. --execute takes the campaign run lease,
checks expected source IDs and every retained row, and changes only the totals
pointer. It refuses after payments change; that needs a separately reviewed plan.
"""

from __future__ import annotations

import argparse
from contextlib import nullcontext
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS  # noqa: E402
from alethical.pipeline.campaign_finance_rollback import (  # noqa: E402
    capture_baseline,
    restore_baseline,
)  # noqa: E402
from alethical.pipeline.campaign_finance_refresh import hold_full_run_lease  # noqa: E402
from alethical.pipeline.raw_file_store import raw_file_store_from_env, sha256_of_file  # noqa: E402
from alethical.pipeline.cache_purge import (  # noqa: E402
    clear_after_publish,
    when_a_filings_release_lands,
)  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["local", "production"], default="local")
    parser.add_argument("--proof", type=Path, required=True)
    parser.add_argument("--capture", action="store_true")
    parser.add_argument("--expected-current")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if args.capture and args.execute:
        parser.error("Capture cannot execute a restore.")
    if not args.capture and not args.expected_current:
        parser.error("Restore requires --expected-current.")
    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    store = raw_file_store_from_env()
    with (
        hold_full_run_lease(engine, purpose="reviewed totals rollback")
        if args.execute
        else nullcontext() as lease
    ):
        if args.execute and (not lease or lease.refusal()):
            raise ValueError("campaign_writer_already_running")
        with Session(engine) as db:
            if not args.execute:
                db.execute(
                    text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                )
            if args.capture:
                proof = capture_baseline(db, store)
                # Never overwrite the only reviewed baseline.
                with args.proof.open("x") as output:
                    json.dump(proof, output, sort_keys=True, indent=2)
                print("Captured baseline:", proof["baseline_snapshot_id"])
            else:
                proof = json.loads(args.proof.read_text())
                with TemporaryDirectory() as temp:
                    for archive in proof["archives"]:
                        path = str(Path(temp) / "archive.gz")
                        store.get(archive["object_key"], path)
                        if sha256_of_file(path) != archive["compressed_hash"]:
                            raise ValueError("baseline_archive_changed")
                if args.execute and lease.refusal():
                    raise ValueError("campaign_lease_lost")
                restore_baseline(
                    db,
                    proof,
                    expected_current=args.expected_current,
                    apply=args.execute,
                )
                if args.execute:
                    db.commit()
                    failure = clear_after_publish(
                        when_a_filings_release_lands(), published=True
                    )
                    if failure:
                        raise RuntimeError(
                            "Restored baseline; saved-page clearing still needs retry"
                        )
                print(
                    "Restored baseline:" if args.execute else "Rollback checks passed:",
                    proof["baseline_snapshot_id"],
                )
            db.rollback()


if __name__ == "__main__":
    main()
