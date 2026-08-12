#!/usr/bin/env python3
"""Correct bill.current_status without re-fetching or renumbering actions (#1322).

Minnesota gives each chamber its own ACTION_NUMBER sequence. The old ingest
flattened both sequences and chose the largest number, so a House action could
hide a later Senate action or the reverse. The fixed selector orders numbers
only inside their chamber, compares chambers by the latest real date each one
has reached, and keeps a final veto or enactment milestone once it appears.

This repair uses the BillAction rows already stored from the official source.
It makes no network requests and changes only bill.current_status. Dry run is
the default. Applying requires a JSON snapshot path, and the same command can
restore that snapshot after checking every row still has the expected value.

Usage:
    # Read-only report.
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/correct_bill_current_statuses.py

    # One reversible live check.
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/correct_bill_current_statuses.py \
        --bill-key 94-2026-HF3908 --apply \
        --snapshot /tmp/alethical-1322-hf3908.json

    # Full correction after the scoped check.
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/correct_bill_current_statuses.py \
        --apply --snapshot /tmp/alethical-1322-all.json

    # Roll back the exact rows in a snapshot.
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/correct_bill_current_statuses.py \
        --apply --restore-snapshot /tmp/alethical-1322-all.json
"""

from __future__ import annotations

import argparse
import json
import os
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, select, text, update
from sqlalchemy.orm import Session

from alethical.db.models import Bill, BillAction, Chamber
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
)
from alethical.pipeline.minnesota import select_current_bill_action


@dataclass(frozen=True)
class StatusChange:
    bill_id: str
    bill_key: str
    before_current_status: str | None
    after_current_status: str
    before_status_key: str | None
    selected_chamber: str
    selected_action_number: int


def derive_status_changes(
    session: Session,
    *,
    bill_key: str | None = None,
    limit: int | None = None,
) -> list[StatusChange]:
    bills_stmt = select(
        Bill.id,
        Bill.bill_key,
        Bill.file_type,
        Bill.current_status,
        Bill.status_key,
    ).order_by(Bill.bill_key)
    if bill_key:
        bills_stmt = bills_stmt.where(Bill.bill_key == bill_key)
    if limit:
        bills_stmt = bills_stmt.limit(limit)
    bills = session.execute(bills_stmt).all()
    if not bills:
        return []

    bill_ids = [bill.id for bill in bills]
    grouped: dict[uuid.UUID, dict[str, list[dict[str, Any]]]] = {
        bill_id: {} for bill_id in bill_ids
    }
    action_rows = session.execute(
        select(
            BillAction.bill_id,
            Chamber.slug,
            BillAction.action_number,
            BillAction.action_text,
            BillAction.action_at,
        )
        .join(Chamber, Chamber.id == BillAction.chamber_id)
        .where(BillAction.bill_id.in_(bill_ids))
        .order_by(BillAction.bill_id, Chamber.slug, BillAction.action_number)
    ).all()
    for row in action_rows:
        grouped[row.bill_id].setdefault(row.slug, []).append(
            {
                "action_number": row.action_number,
                "action_text": row.action_text,
                "action_at": row.action_at,
                "_chamber": row.slug,
            }
        )

    changes: list[StatusChange] = []
    for bill in bills:
        chambers = grouped[bill.id]
        origin = "house" if str(bill.file_type).upper() == "HF" else "senate"
        chamber_order = [origin, *sorted(slug for slug in chambers if slug != origin)]
        ordered_actions = {
            slug: chambers[slug] for slug in chamber_order if slug in chambers
        }
        selected = select_current_bill_action(ordered_actions)
        if selected is None:
            continue
        selected_status = str(selected.get("action_text") or "")
        if selected_status == (bill.current_status or ""):
            continue
        changes.append(
            StatusChange(
                bill_id=str(bill.id),
                bill_key=bill.bill_key,
                before_current_status=bill.current_status,
                after_current_status=selected_status,
                before_status_key=bill.status_key,
                selected_chamber=str(selected["_chamber"]),
                selected_action_number=int(selected["action_number"]),
            )
        )
    return changes


def write_snapshot(path: Path, changes: list[StatusChange]) -> None:
    if path.exists():
        raise RuntimeError(f"Refusing to overwrite existing snapshot: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": 1, "issue": 1322, "changes": [asdict(c) for c in changes]}
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def apply_changes(session: Session, changes: list[StatusChange]) -> None:
    for change in changes:
        result = session.execute(
            update(Bill)
            .where(
                Bill.id == uuid.UUID(change.bill_id),
                Bill.bill_key == change.bill_key,
                Bill.current_status.is_not_distinct_from(change.before_current_status),
            )
            .values(current_status=change.after_current_status)
        )
        if result.rowcount != 1:
            raise RuntimeError(
                f"{change.bill_key} changed after the dry run; no changes committed"
            )

    session.flush()
    stored = dict(
        session.execute(
            select(Bill.bill_key, Bill.current_status).where(
                Bill.id.in_(uuid.UUID(change.bill_id) for change in changes)
            )
        ).all()
    )
    for change in changes:
        if stored.get(change.bill_key) != change.after_current_status:
            raise RuntimeError(
                f"{change.bill_key} failed read-back; no changes committed"
            )


def restore_snapshot(session: Session, path: Path) -> int:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("version") != 1 or payload.get("issue") != 1322:
        raise RuntimeError("Snapshot is not a bill-status correction from issue #1322")
    changes = [StatusChange(**item) for item in payload.get("changes", [])]

    for change in changes:
        bill = session.scalar(
            select(Bill).where(
                Bill.id == uuid.UUID(change.bill_id), Bill.bill_key == change.bill_key
            )
        )
        if bill is None or bill.current_status != change.after_current_status:
            raise RuntimeError(
                f"{change.bill_key} no longer matches the snapshot; no restore committed"
            )
        bill.current_status = change.before_current_status

    session.flush()
    for change in changes:
        restored = session.execute(
            select(Bill.current_status, Bill.status_key).where(
                Bill.id == uuid.UUID(change.bill_id)
            )
        ).one()
        if restored.current_status != change.before_current_status:
            raise RuntimeError(
                f"{change.bill_key} failed restore read-back; no restore committed"
            )
        if restored.status_key != change.before_status_key:
            raise RuntimeError(
                f"{change.bill_key} status class changed since the snapshot; "
                "no restore committed"
            )
    return len(changes)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Correct bill.current_status using chamber-local action order (#1322)."
    )
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--bill-key", default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write after verification. Default is dry run.",
    )
    parser.add_argument(
        "--snapshot",
        type=Path,
        help="Required for --apply; written before any status changes.",
    )
    parser.add_argument(
        "--restore-snapshot",
        type=Path,
        help="Restore a prior snapshot after checking every row still matches it.",
    )
    args = parser.parse_args()

    if args.restore_snapshot and not args.apply:
        parser.error("--restore-snapshot requires --apply")
    if args.restore_snapshot and (args.bill_key or args.limit or args.snapshot):
        parser.error("--restore-snapshot cannot be combined with scan options")
    if args.apply and not args.restore_snapshot and args.snapshot is None:
        parser.error("--apply requires --snapshot so every write has a rollback")

    database_url = database_url_for_target(
        os.environ.get("ALETHICAL_DATABASE_TARGET"), args.database_url
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )

    with Session(engine) as session:
        if args.restore_snapshot:
            restored = restore_snapshot(session, args.restore_snapshot)
            session.commit()
            print(f"restored and verified: {restored} bill statuses")
            return

        if not args.apply:
            session.execute(text("SET TRANSACTION READ ONLY"))
        changes = derive_status_changes(
            session, bill_key=args.bill_key, limit=args.limit
        )
        for change in changes:
            print(
                f"{change.bill_key}: {change.before_current_status!r} -> "
                f"{change.after_current_status!r} "
                f"({change.selected_chamber} #{change.selected_action_number})"
            )

        if args.apply:
            write_snapshot(args.snapshot, changes)
            apply_changes(session, changes)
            session.commit()
            print(f"updated and verified: {len(changes)} bill statuses")
            print(f"rollback snapshot: {args.snapshot}")
        else:
            print(f"would update: {len(changes)} bill statuses")
            print("dry run: no changes written")


if __name__ == "__main__":
    main()
