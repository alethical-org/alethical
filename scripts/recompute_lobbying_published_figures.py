#!/usr/bin/env python3
"""Recompute the lobbying figures *The Money Only Goes One Way* publishes, from our rows (#1862).

Net: the research piece states $886 million of lobbying spending across 3,056
organisations, spending years 2015 through 2025, and names its 5 largest spenders. This
recomputes those figures from the live loaded snapshot and prints them beside what the
piece publishes, so a person can see at a glance whether the published figures still
reproduce from data we hold. It changes nothing.

    uv run python scripts/recompute_lobbying_published_figures.py --target production

If the recompute disagrees with the piece, the answer is `.claude/rules/grounded-answers.md`
rule 13's correction path (points 7a and below), never a quiet edit: the disagreement
goes to the Alethical team.

The counting, matching the piece's method inset: sum the `Total spent` column over
report years 2015–2025, count organisations as distinct Entity IDs, and rank principals
by their summed `Total spent`. Blank amounts contribute nothing — they are "not
reported", not 0.
"""

from __future__ import annotations

import argparse
import os
import sys
from decimal import Decimal
from pathlib import Path

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db import models as schema  # noqa: E402
from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.lobbying_expenditures import live_snapshot  # noqa: E402

# What the piece publishes, kept here so the comparison is explicit on every run.
# Source: apps/frontend/src/lib/researchPieces/moneyOnlyGoesOneWay.ts — the lobbying
# section and its top-5 table.
PUBLISHED_TOTAL_MILLIONS = 886
PUBLISHED_ORGANISATIONS = 3056
PUBLISHED_TOP_5 = (
    ("Enbridge Energy", "$25.9M"),
    ("MN Chamber of Commerce", "$24.4M"),
    ("Xcel Energy", "$21.7M"),
    ("Education Minnesota", "$11.3M"),
    ("MN Business Partnership", "$10.5M"),
)
FIRST_YEAR = 2015
LAST_YEAR = 2025


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Recompute the piece's lobbying figures from the live snapshot."
    )
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET") or "local",
        choices=("local", "production"),
    )
    parser.add_argument("--database-url", default=None)
    args = parser.parse_args()

    database_url = normalize_database_url(
        args.database_url or database_url_for_target(args.target)
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    rows = schema.LobbyingExpenditureRow
    with Session(engine) as db:
        snapshot = live_snapshot(db)
        if snapshot is None:
            print(
                "No lobbying snapshot is published, so there is nothing to recompute. "
                "Load one first: just load-lobbying"
            )
            return 1
        in_window = (
            (rows.snapshot_id == snapshot.id)
            & (rows.report_year >= FIRST_YEAR)
            & (rows.report_year <= LAST_YEAR)
        )
        total = db.scalar(
            select(func.sum(rows.total_spent)).where(in_window)
        ) or Decimal("0")
        organisations = (
            db.scalar(
                select(func.count(func.distinct(rows.entity_id))).where(in_window)
            )
            or 0
        )
        top = db.execute(
            select(
                rows.principal,
                rows.entity_id,
                func.sum(rows.total_spent).label("summed"),
            )
            .where(in_window)
            .group_by(rows.principal, rows.entity_id)
            # nullslast: a principal whose every amount is blank sums to NULL, and
            # Postgres sorts NULL first on a descending sort.
            .order_by(func.sum(rows.total_spent).desc().nullslast())
            .limit(5)
        ).all()

        print(
            f"live snapshot {snapshot.id} (records {snapshot.record_set_hash}), "
            f"fetched {snapshot.fetch_completed_at:%Y-%m-%d}"
        )
        print(
            f"recomputed, report years {FIRST_YEAR}-{LAST_YEAR}: "
            f"${total:,.2f} across {organisations:,} organisations"
        )
        print(
            f"published:  $ {PUBLISHED_TOTAL_MILLIONS} million across "
            f"{PUBLISHED_ORGANISATIONS:,} organisations"
        )
        print("recomputed top 5 (published beside):")
        for index, (principal, entity_id, summed) in enumerate(top):
            published = (
                f"{PUBLISHED_TOP_5[index][0]} {PUBLISHED_TOP_5[index][1]}"
                if index < len(PUBLISHED_TOP_5)
                else "(nothing published)"
            )
            print(
                f"  {principal} (entity {entity_id}): ${summed:,.2f}"
                f"   — published: {published}"
            )
        agrees = (
            round(total / Decimal(1_000_000)) == PUBLISHED_TOTAL_MILLIONS
            and organisations == PUBLISHED_ORGANISATIONS
        )
        print(
            "the published figures REPRODUCE from this snapshot"
            if agrees
            else "the published figures DO NOT reproduce from this snapshot — "
            "grounded-answers.md rule 13's correction path applies; raise it with "
            "the team, never edit the piece quietly"
        )
        return 0 if agrees else 2


if __name__ == "__main__":
    raise SystemExit(main())
