#!/usr/bin/env python3
"""Read 6 small official lists; queue collection without claiming publication."""

from __future__ import annotations

import argparse
from contextlib import redirect_stdout
from datetime import UTC, datetime
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS  # noqa: E402
from alethical.pipeline import campaign_finance_filings as filings  # noqa: E402
from alethical.pipeline.campaign_finance_refresh import read_lists, state_get, state_set  # noqa: E402
from alethical.pipeline.record_refresh import request_refresh  # noqa: E402
from alethical.pipeline.request_limits import DatabaseRequestLimiter, RateLimitedSession  # noqa: E402


def discover(engine):
    http = RateLimitedSession(filings.http_session(), DatabaseRequestLimiter(engine))
    try:
        with redirect_stdout(sys.stderr):
            readings = read_lists(http)
    finally:
        http.close()
    failed = any(r.error or not r.content_hash for r in readings) or len(readings) != 6
    if failed:
        return 1, {
            "status": "incomplete",
            "lists_read": sum(not r.error for r in readings),
        }
    hashes = {r.action: r.content_hash for r in readings}
    with Session(engine) as db:
        previous = state_get(db, "source_discovery:campaign")
        changed = previous != hashes
        if changed:
            request_refresh(db, "campaign-money", now=datetime.now(UTC))
            state_set(db, "source_discovery:campaign", hashes)
    return 0, {"status": "complete", "lists_read": 6, "collection_requested": changed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), required=True)
    args = parser.parse_args()
    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    try:
        code, finding = discover(engine)
        print(json.dumps(finding, sort_keys=True))
        return code
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
