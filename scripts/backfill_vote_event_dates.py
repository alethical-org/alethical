#!/usr/bin/env python3
"""Backfill vote_event.occurred_at from the linked bill_action.action_at.

Why this exists (one-time data fix, no money, no re-ingest): Senate roll calls
are parsed from journal PDFs, and ``votes.py:parse_senate_vote_from_pdf`` returns
``occurred_at=None`` — the ingest then falls back to ``bill_action.action_at``
(``votes.py`` ``occurred_at=parsed_vote.occurred_at or action.action_at``). But
those Senate vote_events were ingested *before* #328 populated action dates, so
they were written with a null occurred_at and skip-if-exists ingestion never
rewrote them. The correct date is now sitting in the linked action, so this just
applies the pipeline's own fallback to the already-ingested rows.

Recoverability was verified read-only against production (2026-07-21): 78/78
Senate vote_events with a null occurred_at have a linked bill_action whose
action_at is non-null. House vote_events already have occurred_at.

Safe by construction: only fills rows where occurred_at IS NULL (never overwrites
a real value); the value written is exactly what a fresh ingest would compute.

Usage:
    # dry run (default) — reports the count and a sample, writes nothing
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/backfill_vote_event_dates.py

    # apply
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/backfill_vote_event_dates.py --apply

    # scoped live check — apply to a single bill first, read back, then run the rest
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/backfill_vote_event_dates.py --apply --bill-key 94-2025-SF334
"""

from __future__ import annotations

import argparse
import os

from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session

from alethical.db.models import Bill, BillAction, VoteEvent
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill vote_event.occurred_at from the linked bill_action.action_at."
    )
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the changes. Without this flag the script only reports (dry run).",
    )
    parser.add_argument(
        "--bill-key",
        default=None,
        help="Limit to a single bill (e.g. 94-2025-SF334) for a scoped live check.",
    )
    args = parser.parse_args()

    database_url = normalize_database_url(
        args.database_url
        or database_url_for_target(os.environ.get("ALETHICAL_DATABASE_TARGET"))
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )

    with Session(engine) as session:
        # Candidate rows: occurred_at is null, but the linked action has a date.
        candidates_stmt = (
            select(VoteEvent.id, Bill.bill_key, BillAction.action_at)
            .join(BillAction, BillAction.id == VoteEvent.bill_action_id)
            .join(Bill, Bill.id == VoteEvent.bill_id)
            .where(
                VoteEvent.occurred_at.is_(None),
                BillAction.action_at.is_not(None),
            )
        )
        if args.bill_key:
            candidates_stmt = candidates_stmt.where(Bill.bill_key == args.bill_key)

        candidates = session.execute(candidates_stmt).all()
        print(f"candidates (occurred_at null, recoverable): {len(candidates)}")
        for vote_event_id, bill_key, action_at in candidates[:8]:
            print(f"  {bill_key}: occurred_at NULL -> {action_at.isoformat()}")
        if len(candidates) > 8:
            print(f"  ... and {len(candidates) - 8} more")

        if not args.apply:
            print("\ndry run — no changes written. Re-run with --apply to write.")
            return

        updated = 0
        for vote_event_id, _bill_key, action_at in candidates:
            session.execute(
                update(VoteEvent)
                .where(VoteEvent.id == vote_event_id)
                .values(occurred_at=action_at)
            )
            updated += 1
        session.commit()
        print(f"\napplied: set occurred_at on {updated} vote_event rows.")


if __name__ == "__main__":
    main()
