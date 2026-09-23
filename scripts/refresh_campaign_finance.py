"""Refresh Alethical's campaign-money records from the Board, once, start to finish.

Net: this is the command the daily GitHub Actions job runs, and the same one a person
runs by hand. It reads the Board's 6 small lists, refreshes the official totals for
every supported year when a list changed or a week has passed, downloads the 3 payment
files, publishes whatever passes every check, re-checks the published figures against
the filed reports, and clears the saved pages. Every route takes the same run-wide lock
first, so 2 starts at the same minute produce 1 run
([#2344](https://github.com/alethical-org/alethical/issues/2344), D3).

Exit codes: 0 when every step finished (including a no-op day); 1 when anything was
quarantined, refused, could not re-check, or could not clear, with the reasons printed.
The workflow turns a 1 into a GitHub issue. Nothing here ever publishes over a failed
check: a quarantine leaves the previous set live and keeps the bytes.

Usage:

    PYTHONPATH=. uv run python scripts/refresh_campaign_finance.py --target production
    PYTHONPATH=. uv run python scripts/refresh_campaign_finance.py --dry-run
    PYTHONPATH=. uv run python scripts/refresh_campaign_finance.py --force-totals
    PYTHONPATH=. uv run python scripts/refresh_campaign_finance.py --prove-alerting
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.campaign_finance_refresh import (  # noqa: E402
    full_run_lock,
    refresh_campaign_money,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET") or "local",
        choices=("local", "production"),
    )
    parser.add_argument("--database-url", default=None)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read the lists, print the plan, run the payment checks, write nothing.",
    )
    parser.add_argument(
        "--force-totals",
        action="store_true",
        help="Run the full totals refresh today whether or not a list changed.",
    )
    parser.add_argument(
        "--prove-alerting",
        action="store_true",
        help="Exit 1 after taking the lock and touching nothing else, so the "
        "workflow's issue-filing step can be proven once without a real failure.",
    )
    args = parser.parse_args()

    def log(message: str) -> None:
        print(message, file=sys.stderr, flush=True)

    database_url = normalize_database_url(
        args.database_url or database_url_for_target(args.target)
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )

    # The lock lives on its own connection, held open and otherwise unused for the whole
    # run, because a session-level advisory lock belongs to the connection that took it
    # and the ORM session below may use another one.
    with full_run_lock(engine) as held:
        if not held:
            log(
                "another campaign-money refresh holds the run-wide lock, so this one "
                "does nothing; the running one covers today"
            )
            return 0
        if args.prove_alerting:
            log("PROVING ALERTING: exiting 1 on purpose; nothing was read or written")
            return 1
        with Session(engine) as session:
            report = refresh_campaign_money(
                session, dry_run=args.dry_run, force_totals=args.force_totals, log=log
            )
    print(report.summary(), flush=True)
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
