#!/usr/bin/env python3
"""Recompute and optionally publish source-bound donor evidence from retained reports.

The default is read-only. --publish stores immutable report/audit bytes and activates
one proof run, without replacing campaign sources or changing payment rows. It must
follow independent review of the dry-run output. A changed source requires a new run.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS  # noqa: E402
from alethical.pipeline.lobbyist_evidence_publication import (  # noqa: E402
    prepare_run,
    publish_run,
    audit_digest,
)
from alethical.pipeline.raw_file_store import raw_file_store_from_env  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["local", "production"], default="local")
    parser.add_argument("--sources", required=True, type=Path)
    parser.add_argument("--years", nargs="+", required=True, type=int)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument(
        "--reviewed-hash", help="Exact dry-run audit SHA256 accepted in review."
    )
    parser.add_argument(
        "--allow-rollback",
        action="store_true",
        help="Explicitly restore older reviewed evidence.",
    )
    parser.add_argument(
        "--reuse-retained",
        action="store_true",
        help="Explicitly reuse saved catalogue collection instead of refreshing it.",
    )
    parser.add_argument(
        "--collect",
        action="store_true",
        help="Refresh official source files with at most 2 concurrent reads.",
    )
    args = parser.parse_args()
    if args.publish and not args.reviewed_hash:
        parser.error("--publish requires --reviewed-hash from the accepted dry run.")
    if args.allow_rollback and not args.publish:
        parser.error("--allow-rollback requires --publish.")
    from alethical.api.services.lobbying_donations import last_completed_year

    if any(year < 2015 or year > last_completed_year() for year in args.years):
        parser.error("Choose completed years from 2015 onward.")
    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine) as db:
        if args.collect:
            from alethical.pipeline.lobbyist_report_collection import collect_reports

            print(
                "Source collection:",
                collect_reports(
                    db,
                    args.sources,
                    sorted(set(args.years)),
                    reuse_retained=args.reuse_retained,
                ),
            )
        db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
        run = prepare_run(db, args.sources, sorted(set(args.years)))
        db.rollback()
        args.output.write_text(json.dumps(run, sort_keys=True, default=str))
        print("Audit SHA256:", audit_digest(run))
        print("Checked recipient-years:", len(run["recipients"]))
        print("Unavailable recipient-years:", len(run["failures"]))
        print(
            "Donor checks:",
            dict(
                Counter(
                    d["status"] for r in run["recipients"] for d in r["donors"].values()
                )
            ),
        )
        if args.publish:
            # Independently regenerated source-bound evidence, never trust --output.
            print(
                "Activated evidence:",
                publish_run(
                    db,
                    raw_file_store_from_env(),
                    args.sources,
                    run,
                    reviewed_hash=args.reviewed_hash,
                    allow_rollback=args.allow_rollback,
                ),
            )


if __name__ == "__main__":
    main()
