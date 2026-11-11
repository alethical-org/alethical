#!/usr/bin/env python3
"""Read-only, exact-row accounting for the current election's outside spending."""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, select, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from alethical.api.services import election_finance_reads as finance  # noqa: E402
from alethical.api.services import election_outside_spending as outside  # noqa: E402
from alethical.api.services import election_comparison_reads as results  # noqa: E402
from alethical.db import models as m  # noqa: E402
from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS  # noqa: E402
from alethical.pipeline.election_comparison import ComparisonImportError  # noqa: E402


def audit(db: Session, election_key: str) -> dict:
    election = results.snapshot(db, election_key, None)
    context, release = outside._context(
        db,
        election_key=election_key,
        election_snapshot_id=election.id,
        version=None,
        release_id=None,
    )
    R = outside.R
    year = election.election_date.year
    rows = db.scalars(
        select(R)
        .where(
            R.snapshot_id == release.independent_expenditures.snapshot_id,
            R.year == year,
        )
        .order_by(R.row_number)
    ).all()
    claims = defaultdict(set)
    linked = set()
    decisions = set()
    race_ids = db.scalars(
        select(m.ElectionCampaignAccountDecision.race_id)
        .where(m.ElectionCampaignAccountDecision.election_key == election_key)
        .distinct()
    ).all()
    for race_id in race_ids:
        race = db.get(m.ElectionComparisonRace, (election.id, race_id))
        if race is None:
            continue
        for candidate in race.payload["candidates"]:
            accounts = finance._accounts(db, election_key, race, candidate)["accounts"]
            linked.update(a["registration_number"] for a in accounts)
            decisions.update(a["decision_id"] for a in accounts)
            # Use the reader's exact SQL interval predicate, not a second guessed match.
            for number in db.scalars(
                select(R.row_number).where(
                    *finance._attribution_filters(release, year, accounts)
                )
            ):
                claims[number].add((race.id, candidate["candidate_id"]))
    buckets = {}
    evidence = []
    for row in rows:
        count = len(claims[row.row_number])
        if count > 1:
            raise ComparisonImportError(
                "A spending row has multiple current candidacy claims"
            )
        state = (
            "attributed"
            if count
            else "no_confirmed_account"
            if row.affected_committee_reg_num not in linked
            else "missing_date"
            if row.transaction_date is None
            else "outside_reviewed_period"
        )
        bucket = buckets.setdefault(
            state, {"count": 0, "known_amount": Decimal(0), "missing_amount_count": 0}
        )
        bucket["count"] += 1
        bucket["known_amount"] += row.amount or Decimal(0)
        bucket["missing_amount_count"] += row.amount is None
        evidence.append(
            {
                "row_number": row.row_number,
                "state": state,
                "amount": str(row.amount) if row.amount is not None else None,
                "claims": sorted(claims[row.row_number]),
            }
        )
    if len({r["row_number"] for r in evidence}) != len(rows) or set(claims) - {
        r.row_number for r in rows
    }:
        raise ComparisonImportError("Spending row partition is not exact")
    amount = sum((row.amount or Decimal(0) for row in rows), Decimal(0))
    if (
        sum(b["count"] for b in buckets.values()) != len(rows)
        or sum(b["known_amount"] for b in buckets.values()) != amount
    ):
        raise ComparisonImportError("Spending partition does not reconcile")
    return {
        "checked_at": datetime.now(UTC).isoformat(),
        "election_key": election_key,
        "snapshot_id": election.id,
        "payment_context": context,
        "decision_ids": sorted(decisions),
        "reported_year": year,
        "count": len(rows),
        "known_amount": str(amount),
        "missing_amount_count": sum(row.amount is None for row in rows),
        "buckets": {
            state: {**bucket, "known_amount": str(bucket["known_amount"])}
            for state, bucket in buckets.items()
        },
        "each_row_exactly_once": True,
        "rows": evidence,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--election", required=True)
    parser.add_argument("--target", choices=("local", "production"), default="local")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.output.exists():
        parser.error("Output already exists; keep the previous audit")
    engine = create_engine(
        database_url_for_target(args.target),
        connect_args=NO_PREPARED_STATEMENTS,
        isolation_level="REPEATABLE READ",
    )
    try:
        with Session(engine) as db:
            db.execute(text("SET TRANSACTION READ ONLY"))
            receipt = audit(db, args.election)
        with args.output.open("x") as output:
            json.dump(receipt, output, indent=2, default=str)
            output.write("\n")
    finally:
        engine.dispose()
    print(f"Reconciled {receipt['count']} spending records; receipt: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
