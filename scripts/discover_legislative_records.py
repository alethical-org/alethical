#!/usr/bin/env python3
"""Refresh a finite official dated-action window in bounded saved turns."""

from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timedelta
import os
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine  # noqa: E402
from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS  # noqa: E402
from alethical.pipeline.legislative_refresh import refresh_bills  # noqa: E402
from alethical.pipeline.minnesota import BillSearchResult, discover_recent_action_bills  # noqa: E402
from alethical.pipeline.votes import rate_limited_source_session  # noqa: E402
from alethical.pipeline.record_refresh import load_progress, save_progress  # noqa: E402
from scripts.run_scheduled_bill_refresh import check_pending_votes  # noqa: E402

LIMIT = 25


def refresh(engine, *, target, session_code, name, token, lookback_days=2):
    progress = load_progress(engine, name, token)
    if "inventory" not in progress:
        today = datetime.now(ZoneInfo("America/Chicago")).date()
        start = today - timedelta(days=lookback_days)
        source = rate_limited_source_session(engine, target=target)
        try:
            recent = discover_recent_action_bills(
                source, session_code=session_code, start=start, end=today
            )
        finally:
            source.close()
        records = {item.bill_key: asdict(item) for item in recent}
        # Prior failures remain owed even after their dated actions leave the window.
        for item in progress.get("retry_records", []):
            record = BillSearchResult(**item)
            records.setdefault(record.bill_key, item)
        progress.update(
            inventory=list(records.values()),
            cursor=0,
            failures=[],
            scope={
                "start": start.isoformat(),
                "end": today.isoformat(),
                "views": ["House", "Senate"],
                "dated_actions_only": True,
            },
        )
        save_progress(engine, name, token, progress)
    pending = progress.get("pending_votes", [])
    failed_votes = []
    if pending:
        failed_votes = check_pending_votes(
            engine, target=target, bill_keys=pending[:LIMIT]
        )
        pending = pending[LIMIT:] + failed_votes
    inventory = [BillSearchResult(**item) for item in progress["inventory"]]
    offset = progress["cursor"]
    work = inventory[offset : offset + LIMIT]
    if work:
        progress["pending_votes"] = sorted(
            set(pending + [item.bill_key for item in work])
        )
        # Persist before canonical action writes. An interrupted write can never
        # lose its vote follow-up, and replaying a bill remains safe.
        save_progress(engine, name, token, progress)
    accepted = []
    failed_records = list(progress.get("failures", []))
    for code in sorted({item.session_code for item in work}):
        grouped = [item for item in work if item.session_code == code]
        result = refresh_bills(
            engine, session_code=code, target=target, inventory=grouped, limit=LIMIT
        )
        accepted.extend(result["accepted_bill_keys"])
        failed_records.extend(
            asdict(item) for item in grouped if item.bill_key not in accepted
        )
    pending = sorted(set(pending + accepted))
    progress.update(
        cursor=offset + len(work), pending_votes=pending, failures=failed_records
    )
    if (
        progress["cursor"] < len(inventory)
        or (pending and work)
        or (pending and not failed_votes)
    ):
        save_progress(engine, name, token, progress)
        return 75
    # End this finite pass. A new due pass rereads the source window; an unchanged
    # listing cannot start an endless continuation or prove its status stayed still.
    progress.update(
        last_attempted_scope=progress["scope"], retry_records=failed_records
    )
    for key in ("inventory", "cursor", "failures", "scope"):
        progress.pop(key, None)
    save_progress(engine, name, token, progress)
    return 1 if failed_records or pending else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), required=True)
    parser.add_argument("--session-code", required=True)
    parser.add_argument("--lookback-days", type=int, default=2)
    args = parser.parse_args()
    if not 0 <= args.lookback_days <= 31:
        parser.error("lookback must be between 0 and 31 days")
    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    try:
        return refresh(
            engine,
            target=args.target,
            session_code=args.session_code,
            name=os.environ["ALETHICAL_REFRESH_JOB_NAME"],
            token=os.environ["ALETHICAL_REFRESH_JOB_TOKEN"],
            lookback_days=args.lookback_days,
        )
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
