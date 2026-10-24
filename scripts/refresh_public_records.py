#!/usr/bin/env python3
"""Run due public-source work or report its deadlines without changing data."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS  # noqa: E402
from alethical.pipeline.record_refresh import jobs, health, run_due, due_names  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), default="local")
    parser.add_argument("--job", action="append", choices=sorted(jobs()))
    parser.add_argument(
        "--check",
        action="store_true",
        help="Read deadlines only; exit 1 for overdue sources",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Run selected jobs before their deadline, retaining overlap protection",
    )
    parser.add_argument(
        "--loop",
        action="store_true",
        help="Dedicated worker: poll saved deadlines every 60 seconds",
    )
    parser.add_argument("--due", action="store_true", help="List due jobs as JSON")
    args = parser.parse_args()
    if args.loop and args.force:
        parser.error("--force cannot be combined with --loop")
    if args.check and (args.force or args.loop):
        parser.error("--check cannot run or loop jobs")
    engine = create_engine(
        database_url_for_target(args.target),
        connect_args=NO_PREPARED_STATEMENTS,
        pool_pre_ping=True,
    )
    sessions = sessionmaker(bind=engine)
    try:
        if args.due:
            with sessions() as db:
                print(json.dumps(due_names(db)))
            return 0
        if args.check:
            with sessions() as db:
                report = health(db)
            if args.job:
                report = [item for item in report if item["name"] in args.job]
            print(json.dumps(report, default=str, indent=2))
            return int(any(item["overdue"] for item in report))
        while True:
            code = run_due(
                sessions, target=args.target, names=args.job, force=args.force
            )
            if not args.loop:
                return code
            time.sleep(60)
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
