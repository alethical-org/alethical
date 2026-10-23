#!/usr/bin/env python3
"""Daily private-data cleanup, independent of search providers and collection jobs."""

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from alethical.api.services.search_measurements import retention_status, sweep_retention  # noqa: E402
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target  # noqa: E402


def run_sweep(engine) -> dict:
    started = datetime.now(UTC)
    with Session(engine) as db, db.begin():
        sweep_retention(db, now=started)
    # A separate transaction proves the successful sweep receipt committed.
    with Session(engine) as db:
        status = retention_status(db, now=started)
    if (
        status["status"] != "current"
        or datetime.fromisoformat(status["lastSuccessAt"]) < started
        or status["expiredRawAwaitingDeletion"]
        or status["expiredSummariesAwaitingDeletion"]
    ):
        raise RuntimeError("Retention sweep did not verify")
    return status


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), required=True)
    args = parser.parse_args()
    engine = None
    try:
        # Explicit target, no ambient DATABASE_URL can redirect this command.
        engine = create_engine(
            database_url_for_target(args.target),
            connect_args={**NO_PREPARED_STATEMENTS, "connect_timeout": 10},
            pool_size=1,
            max_overflow=0,
            pool_timeout=10,
        )
        status = run_sweep(engine)
        print(json.dumps({"status": "succeeded", "retention": status}, sort_keys=True))
        return 0
    except Exception:
        # Connection and database exceptions can contain credentials or bound data.
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error": "Private measurement retention could not be verified.",
                }
            )
        )
        return 1
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
