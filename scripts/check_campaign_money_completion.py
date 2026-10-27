#!/usr/bin/env python3
"""Check that filed campaign reports reached their totals and legislators' pages.

Run by the shared updater as the ``campaign-completion`` job. Prints 1 JSON finding on
standard output and nothing else; progress goes to standard error. Exit 0 when nothing
needs a person, 2 when something does, 1 when every Board probe failed. The rule is in
``alethical/pipeline/campaign_money_completion.py``.

    PYTHONPATH=. uv run python scripts/check_campaign_money_completion.py --target local
"""

from __future__ import annotations

import argparse
from contextlib import redirect_stdout
from datetime import UTC, date, datetime
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from alethical.db.models import SourceRefreshState  # noqa: E402
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target  # noqa: E402
from alethical.pipeline import campaign_finance_filings as filings  # noqa: E402
from alethical.pipeline import campaign_money_completion as completion  # noqa: E402
from alethical.pipeline.campaign_finance_refresh import (  # noqa: E402
    LAST_FULL_REFRESH_KEY,
    state_get,
    state_update,
)
from alethical.pipeline.record_refresh import request_refresh  # noqa: E402
from alethical.pipeline.request_limits import (  # noqa: E402
    DatabaseRequestLimiter,
    RateLimitedSession,
)


def check(engine, *, now: datetime, today: date) -> completion.CompletionResult:
    http = RateLimitedSession(filings.http_session(), DatabaseRequestLimiter(engine))

    def probe(registration, kind, segment):
        _response, tab = filings.fetch_figures(http, kind, registration, segment)
        return tab

    try:
        with Session(engine) as db:
            lagging, hidden = completion.read_state(db, completion.checked_years(today))
            probes = state_get(db, completion.PROBES_KEY) or {}
            last_full = state_get(db, LAST_FULL_REFRESH_KEY)
            requested = (state_get(db, completion.CATCH_UP_KEY) or {}).get(
                "requested_at"
            )
            money = db.get(SourceRefreshState, "campaign-money")
            running = bool(
                money and money.lease_expires_at and money.lease_expires_at > now
            )
            db.rollback()
        with redirect_stdout(sys.stderr):
            result = completion.evaluate(
                lagging,
                hidden,
                probes,
                probe=probe,
                now=now,
                last_full_refresh_at=datetime.fromisoformat(last_full)
                if last_full
                else None,
                last_requested_at=datetime.fromisoformat(requested)
                if requested
                else None,
                totals_running=running,
                alarm_years=completion.checked_years(today),
            )
    finally:
        http.close()
    with Session(engine) as db:
        marker = completion.catch_up_marker(
            state_get(db, completion.CATCH_UP_KEY), result, now
        )
        values = {completion.PROBES_KEY: result.state}
        if marker is not None:
            values[completion.CATCH_UP_KEY] = marker
        state_update(
            db,
            set_values=values,
            delete_keys=[] if marker is not None else [completion.CATCH_UP_KEY],
        )
        if result.request_totals:
            request_refresh(db, "campaign-money", now=now)
            db.commit()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target", choices=("local", "production"), required=True)
    args = parser.parse_args()
    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    try:
        now = datetime.now(UTC)
        result = check(engine, now=now, today=now.date())
        print(json.dumps(result.finding, sort_keys=True))
        return result.code
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
