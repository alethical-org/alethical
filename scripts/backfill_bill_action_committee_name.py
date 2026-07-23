#!/usr/bin/env python3
"""Backfill bill_action.committee_name from the free MN Revisor status XML (#599).

Why this exists (one-time data fix, no money, no paid re-ingest): the parser
already reads <COMMITTEE_NAME> per action (minnesota.py:421-422) but the write
path dropped it until #599, so every already-ingested referral / re-refer row
has committee_name NULL even though the source names the committee. The Revisor
status XML is a free public endpoint, so this re-fetches each bill's XML, re-parses
its actions, and fills committee_name on the matching bill_action rows.

Matching: the parsed XML groups actions by chamber ('house'/'senate') with a
per-chamber ACTION_NUMBER; bill_action rows carry (chamber_id, action_number). We
map chamber_id -> slug and match on (slug, action_number) — the same key the
ingest upsert uses (minnesota.py replace_actions).

Safe + idempotent by construction:
  * only writes when the source action carries a non-empty committee name AND it
    differs from what's stored — re-running is a no-op;
  * never overwrites a stored name with NULL/empty;
  * each bill's XML fetch is the same free request the daily ingest already makes.

The XML source_url comes from the bill's own actions' source_artifact (the exact
URL the ingest fetched); a bill whose actions have no recorded XML artifact is
skipped and reported (we never guess a URL).

Usage:
    # dry run (default) — reports how many rows would change, writes nothing
    ALETHICAL_DATABASE_TARGET=production uv run \
        python scripts/backfill_bill_action_committee_name.py

    # scoped live check — one bill first, then read it back before the full run
    ALETHICAL_DATABASE_TARGET=production uv run \
        python scripts/backfill_bill_action_committee_name.py --apply --bill-key 94-2025-HF10

    # full apply
    ALETHICAL_DATABASE_TARGET=production uv run \
        python scripts/backfill_bill_action_committee_name.py --apply
"""

from __future__ import annotations

import argparse
import os

from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session

from alethical.db.models import (
    ArtifactType,
    Bill,
    BillAction,
    Chamber,
    SourceArtifact,
)
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.minnesota import fetch_text, http_session, parse_bill_xml


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill bill_action.committee_name from the free MN Revisor XML."
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
        help="Limit to a single bill (e.g. 94-2025-HF10) for a scoped live check.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most N bills (for testing).",
    )
    args = parser.parse_args()

    database_url = normalize_database_url(
        args.database_url
        or database_url_for_target(os.environ.get("ALETHICAL_DATABASE_TARGET"))
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    http = http_session()

    with Session(engine) as session:
        # chamber_id -> slug ('house'/'senate'/'joint'); the XML groups actions by
        # this slug, so it's the join between parsed source and stored rows.
        chamber_slug = {c.id: c.slug for c in session.scalars(select(Chamber)).all()}

        bills_stmt = select(Bill.id, Bill.bill_key).order_by(Bill.bill_key)
        if args.bill_key:
            bills_stmt = bills_stmt.where(Bill.bill_key == args.bill_key)
        if args.limit:
            bills_stmt = bills_stmt.limit(args.limit)
        bills = session.execute(bills_stmt).all()
        print(f"bills to scan: {len(bills)}")

        total_updates = 0
        bills_touched = 0
        skipped_no_url = 0
        fetch_errors = 0

        for i, (bill_id, bill_key) in enumerate(bills, start=1):
            # The XML source_url is whatever the ingest fetched for this bill —
            # taken from any of its actions' xml source_artifact.
            source_url = session.scalar(
                select(SourceArtifact.source_url)
                .join(BillAction, BillAction.source_artifact_id == SourceArtifact.id)
                .where(
                    BillAction.bill_id == bill_id,
                    SourceArtifact.artifact_type == ArtifactType.xml,
                )
                .limit(1)
            )
            if not source_url:
                skipped_no_url += 1
                continue

            try:
                xml_text = fetch_text(http, source_url)
                canonical = parse_bill_xml(xml_text)
            except Exception as exc:  # noqa: BLE001 - report & continue, one bad bill mustn't stop the run
                fetch_errors += 1
                print(f"  ! {bill_key}: fetch/parse failed ({exc})")
                continue

            # (slug, action_number) -> committee_name (only where the source has one)
            source_committee: dict[tuple[str, int], str] = {}
            for slug, actions in canonical.get("actions", {}).items():
                for action in actions:
                    name = (action.get("committee_name") or "").strip()
                    num_raw = (action.get("action_number") or "").strip()
                    if not name or not num_raw.isdigit():
                        continue
                    source_committee[(slug, int(num_raw))] = name

            if not source_committee:
                continue

            rows = session.scalars(
                select(BillAction).where(BillAction.bill_id == bill_id)
            ).all()
            bill_updates = 0
            for row in rows:
                slug = chamber_slug.get(row.chamber_id)
                if slug is None:
                    continue
                name = source_committee.get((slug, row.action_number))
                if name and name != (row.committee_name or None):
                    if args.apply:
                        session.execute(
                            update(BillAction)
                            .where(BillAction.id == row.id)
                            .values(committee_name=name)
                        )
                    bill_updates += 1

            if bill_updates:
                bills_touched += 1
                total_updates += bill_updates
                if args.bill_key or args.limit:
                    print(f"  {bill_key}: {bill_updates} action(s) -> committee named")

            if args.apply and i % 200 == 0:
                session.commit()
                print(
                    f"  ... {i}/{len(bills)} bills scanned, "
                    f"{total_updates} rows updated so far"
                )

        if args.apply:
            session.commit()

        verb = "updated" if args.apply else "would update"
        print(
            f"\n{verb}: {total_updates} bill_action rows across {bills_touched} bills."
        )
        if skipped_no_url:
            print(f"skipped (no recorded XML source_url): {skipped_no_url} bills.")
        if fetch_errors:
            print(f"fetch/parse errors (skipped): {fetch_errors} bills.")
        if not args.apply:
            print("\ndry run — no changes written. Re-run with --apply to write.")


if __name__ == "__main__":
    main()
