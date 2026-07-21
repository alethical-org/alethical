"""Equivalence + drift guards for the denormalized bill signals (#505).

These pin the DB-maintained columns (``has_current_summary``, ``status_key``,
``status_rank``) to the Python expressions that remain the source of truth
(``current_bill_summary_enrichment_bill_ids``, ``bill_status_key_expr``,
``bill_progress_rank``). If the SQL cascade in alembic 0007 ever drifts from the
Python cascade — in either direction — a test here fails. This is the CI face of
#505's accuracy gate; the corpus byte-identical proof runs the same comparison
against real production data.
"""

from __future__ import annotations

import uuid

from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.models import (
    Bill,
    bill_progress_rank,
    bill_status_key_expr,
    bill_list_stmt,
    current_bill_summary_enrichment_bill_ids,
)
from alethical.db.session import get_database_url


def _session() -> Session:
    return Session(create_engine(get_database_url(), pool_pre_ping=True))


def _make_bill(
    db: Session, *, bill_key: str, file_number: int, status: str
) -> uuid.UUID:
    bill = Bill(
        session_id=db.scalar(select(schema.LegislativeSession.id)),
        chamber_id=db.scalar(select(schema.Chamber.id)),
        bill_key=bill_key,
        file_type="HF",
        file_number=file_number,
        title=f"Test bill {bill_key}",
        current_status=status,
    )
    db.add(bill)
    db.commit()
    return bill.id


def _add_summary(
    db: Session, bill_id: uuid.UUID, *, summary: str, is_current: bool = True
):
    version = schema.BillVersion(
        bill_id=bill_id,
        version_code=f"v-{uuid.uuid4().hex[:8]}",
        sequence_number=0,
        is_current=True,
    )
    db.add(version)
    db.flush()
    enrichment = schema.AIEnrichment(
        bill_id=bill_id,
        bill_version_id=version.id,
        enrichment_type=schema.EnrichmentType.bill_summary,
        model_name="test-model",
        source_version_hash=uuid.uuid4().hex,
        content_json={"summary": summary},
        is_current=is_current,
    )
    db.add(enrichment)
    db.commit()
    return enrichment.id


def _cleanup(db: Session, bill_id: uuid.UUID) -> None:
    db.execute(
        delete(schema.AIEnrichment).where(schema.AIEnrichment.bill_id == bill_id)
    )
    db.execute(delete(schema.BillVersion).where(schema.BillVersion.bill_id == bill_id))
    db.execute(delete(Bill).where(Bill.id == bill_id))
    db.commit()


# --- Corpus equivalence: stored columns == the Python source-of-truth ---------


def test_status_columns_match_python_cascade(seed_database) -> None:
    """Every bill's stored status_key/status_rank equals what the Python
    ``bill_status_key_expr`` / ``bill_progress_rank`` cascade computes."""
    with _session() as db:
        rows = db.execute(
            select(
                Bill.id,
                Bill.status_key,
                bill_status_key_expr(),
                Bill.status_rank,
                bill_progress_rank(),
            )
        ).all()
    assert rows, "expected sample bills"
    mismatches = [r for r in rows if r.status_key != r[2] or r.status_rank != r[4]]
    assert not mismatches, (
        f"status column drift on {len(mismatches)} bills: {mismatches[:5]}"
    )


def test_has_current_summary_matches_semijoin(seed_database) -> None:
    """The set of bills flagged ``has_current_summary`` equals the set the
    ``current_bill_summary_enrichment_bill_ids`` semi-join returns exactly."""
    with _session() as db:
        flagged = set(
            db.scalars(select(Bill.id).where(Bill.has_current_summary.is_(True)))
        )
        semijoin = set(
            db.scalars(
                select(Bill.id).where(
                    Bill.id.in_(current_bill_summary_enrichment_bill_ids())
                )
            )
        )
    assert flagged == semijoin


# --- Query-level equivalence: new column path == old expression path ----------


def _old_bill_list_ids(db: Session, session_id, sort: str) -> list:
    """Reconstruct the pre-#505 query (semi-join gate + live CASE sort) so CI can
    assert the new column-based query returns byte-identical ordered ids."""
    recency = (
        Bill.latest_action_at.desc().nullslast(),
        Bill.file_number.asc(),
        Bill.id.asc(),
    )
    if sort == "progress":
        order_by = (bill_progress_rank().asc(), *recency)
    elif sort == "introduced":
        order_by = (
            Bill.introduced_at.desc().nullslast(),
            Bill.file_number.desc(),
            Bill.id.asc(),
        )
    else:
        order_by = recency
    stmt = (
        select(Bill.id)
        .where(
            Bill.session_id == session_id,
            Bill.id.in_(current_bill_summary_enrichment_bill_ids()),
        )
        .order_by(*order_by)
    )
    return list(db.scalars(stmt))


def test_bill_list_ordered_ids_match_old_path(seed_database) -> None:
    with _session() as db:
        session_id = db.scalar(select(schema.LegislativeSession.id))
        for sort in ("latest_action", "progress", "introduced"):
            new_ids = list(
                db.scalars(
                    bill_list_stmt(session_id, sort=sort).with_only_columns(Bill.id)
                )
            )
            old_ids = _old_bill_list_ids(db, session_id, sort)
            assert new_ids == old_ids, f"ordered id mismatch for sort={sort}"


# --- Branch coverage: the SQL cascade classifies every stage correctly --------


def test_status_cascade_covers_all_branches_and_priority(seed_database) -> None:
    """Insert synthetic statuses hitting each branch (and priority collisions)
    and assert the trigger-set columns match the expected classification."""
    cases = {
        "Governor vetoed the bill": ("vetoed", 1),
        "Chapter number": ("signed_into_law", 0),
        "Sent to Governor": ("signed_into_law", 0),
        "Filed with Secretary of State": ("signed_into_law", 0),
        "Effective date": ("signed_into_law", 0),
        "Senate passed as amended": ("passed_senate", 2),
        "Bill was passed": ("passed_house", 3),
        "Referred to committee": ("in_committee", 4),
        "Second reading": ("in_committee", 4),
        "Introduced": ("proposed", 5),
        "": ("proposed", 5),
        # Priority collisions: earlier branch wins.
        "Governor vetoed after Senate passed": ("vetoed", 1),  # veto > signed/passed
        "Senate passed, sent to Governor": ("signed_into_law", 0),  # signed > passed
    }
    bill_ids = []
    try:
        with _session() as db:
            for i, status in enumerate(cases):
                bid = _make_bill(
                    db,
                    bill_key=f"denorm-branch-{i}",
                    file_number=900000 + i,
                    status=status,
                )
                bill_ids.append(bid)
            got = {
                bid: (key, rank)
                for bid, key, rank in db.execute(
                    select(Bill.id, Bill.status_key, Bill.status_rank).where(
                        Bill.id.in_(bill_ids)
                    )
                ).all()
            }
        for i, (status, expected) in enumerate(cases.items()):
            assert got[bill_ids[i]] == expected, (
                f"status={status!r} → {got[bill_ids[i]]}, expected {expected}"
            )
    finally:
        with _session() as db:
            for bid in bill_ids:
                _cleanup(db, bid)


def test_status_trigger_recomputes_on_update(seed_database) -> None:
    bid = None
    try:
        with _session() as db:
            bid = _make_bill(
                db, bill_key="denorm-update", file_number=910001, status="Introduced"
            )
            assert db.get(Bill, bid).status_key == "proposed"
            db.get(Bill, bid).current_status = "Chapter number"
            db.commit()
            row = db.get(Bill, bid)
            assert (row.status_key, row.status_rank) == ("signed_into_law", 0)
    finally:
        if bid:
            with _session() as db:
                _cleanup(db, bid)


# --- has_current_summary trigger maintenance (insert / update / delete) -------


def test_has_current_summary_trigger_lifecycle(seed_database) -> None:
    bid = None
    try:
        with _session() as db:
            bid = _make_bill(
                db, bill_key="denorm-summary", file_number=920001, status="Introduced"
            )
            # No enrichment yet → false.
            assert db.get(Bill, bid).has_current_summary is False

            # Current non-empty summary → true.
            enr_id = _add_summary(db, bid, summary="A real summary.")
            db.expire_all()
            assert db.get(Bill, bid).has_current_summary is True

            # Flip is_current false → false.
            db.get(schema.AIEnrichment, enr_id).is_current = False
            db.commit()
            db.expire_all()
            assert db.get(Bill, bid).has_current_summary is False

            # Back to current → true; then blank/whitespace summary → false.
            db.get(schema.AIEnrichment, enr_id).is_current = True
            db.commit()
            db.expire_all()
            assert db.get(Bill, bid).has_current_summary is True
            db.get(schema.AIEnrichment, enr_id).content_json = {"summary": "   "}
            db.commit()
            db.expire_all()
            assert db.get(Bill, bid).has_current_summary is False

            # Delete the enrichment → false (already false; make it true first).
            db.get(schema.AIEnrichment, enr_id).content_json = {"summary": "again"}
            db.commit()
            db.expire_all()
            assert db.get(Bill, bid).has_current_summary is True
            db.execute(
                delete(schema.AIEnrichment).where(schema.AIEnrichment.id == enr_id)
            )
            db.commit()
            db.expire_all()
            assert db.get(Bill, bid).has_current_summary is False
    finally:
        if bid:
            with _session() as db:
                _cleanup(db, bid)
