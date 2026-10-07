#!/usr/bin/env python3
"""Run one due legislative refresh; the central runner owns timing and leases."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine  # noqa: E402
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target  # noqa: E402
from alethical.pipeline.legislative_refresh import (  # noqa: E402
    refresh_bills,
    refresh_roster,
    refresh_votes,
)
from scripts.load_minnesota_data import _validated_database_target  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=("bills", "votes", "roster"), required=True)
    parser.add_argument("--target", choices=("local", "production"), required=True)
    parser.add_argument("--session-code", required=True)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--after-key")
    parser.add_argument("--bill-key", action="append", default=[])
    parser.add_argument("--sweep-limit", type=int, default=100)
    args = parser.parse_args(argv)
    if args.sweep_limit < 0:
        parser.error("--sweep-limit cannot be negative")
    url = database_url_for_target(args.target)
    _validated_database_target(args.target, url)
    engine = create_engine(url, connect_args=NO_PREPARED_STATEMENTS)
    try:
        if args.kind == "bills":
            report = refresh_bills(
                engine,
                session_code=args.session_code,
                target=args.target,
                limit=args.limit,
                after_key=args.after_key,
            )
            failed = bool(report["failed"])
        elif args.kind == "roster":
            report = refresh_roster(
                engine, session_code=args.session_code, target=args.target
            )
            failed = bool(
                report["service"]["fetch_errors"]
                or report["service"]["write_errors"]
                or report["service"]["no_data"]
                or report["bio"]["fetch_errors"]
                or report["bio"]["write_errors"]
                or report["bio"]["source_errors"]
                or report["bio"]["no_profile_url"]
            )
        else:
            report = refresh_votes(
                engine,
                target=args.target,
                bill_keys=args.bill_key,
                sweep_limit=args.sweep_limit,
            )
            failed = bool(
                report["corrections"]["rejected"]
                or report["corrections"]["failed"]
                or report["missing"]["write_errors"]
            )
        print(json.dumps(report, default=str, sort_keys=True))
        return 1 if failed else 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
