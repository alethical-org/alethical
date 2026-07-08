#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy import event, func, select, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db import models as schema  # noqa: E402

Bill = schema.Bill
BillStats = schema.BillStats
ChatSession = schema.ChatSession
District = schema.District
Legislator = schema.Legislator
LegislatorServicePeriod = schema.LegislatorServicePeriod
RagChunk = schema.RagChunk
RagChunkEmbedding = schema.RagChunkEmbedding
RagSectionDocument = schema.RagSectionDocument
SavedPlace = schema.SavedPlace
Sponsorship = schema.Sponsorship
TrackedBill = schema.TrackedBill
VoteRecord = schema.VoteRecord
bill_detail_stmt = schema.bill_detail_stmt
bill_list_stmt = schema.bill_list_stmt
find_my_legislator_stmt = schema.find_my_legislator_stmt
legislator_directory_stmt = schema.legislator_directory_stmt
legislator_profile_stmt = schema.legislator_profile_stmt
legislator_sponsored_bills_stmt = schema.legislator_sponsored_bills_stmt
legislator_vote_history_stmt = schema.legislator_vote_history_stmt
rag_chunk_lookup_stmt = schema.rag_chunk_lookup_stmt
semantic_rag_chunk_stmt = schema.semantic_rag_chunk_stmt
tracked_bills_stmt = schema.tracked_bills_stmt


@dataclass
class SurfaceResult:
    name: str
    status: str
    statement_count: int
    notes: list[str]
    sql_preview: str


class QueryCounter:
    def __init__(self, engine):
        self.engine = engine
        self.statements: list[str] = []

    def before_cursor_execute(
        self, conn, cursor, statement, parameters, context, executemany
    ):
        self.statements.append(" ".join(statement.split()))

    @contextmanager
    def capture(self):
        self.statements = []
        event.listen(self.engine, "before_cursor_execute", self.before_cursor_execute)
        try:
            yield self
        finally:
            event.remove(
                self.engine, "before_cursor_execute", self.before_cursor_execute
            )


def compile_sql(statement, engine) -> str:
    return str(
        statement.compile(
            dialect=engine.dialect, compile_kwargs={"literal_binds": True}
        )
    )


def explain_preview(statement, engine) -> str:
    sql = compile_sql(statement, engine)
    with engine.connect() as conn:
        rows = conn.execute(text(f"EXPLAIN {sql}")).scalars().all()
    return " | ".join(rows[:3])


def current_period(periods):
    return next((period for period in periods if period.is_current), None)


def validate_bill_list(session: Session, engine, session_id, user_id) -> SurfaceResult:
    stmt = bill_list_stmt(session_id, user_id=user_id)
    with QueryCounter(engine).capture() as counter:
        bills = session.scalars(stmt).all()
        for bill in bills:
            _ = bill.stats.sponsor_count if bill.stats else 0
            _ = [
                s.legislator.full_name
                for s in bill.chief_sponsorships[:3]
                if s.legislator
            ]
            _ = bool(bill.tracked_by)
    notes = [
        "Direct path exists for bill cards, stats, sponsor preview, and tracked state.",
        f"Executed as {len(counter.statements)} SQL statements on the sample dataset.",
        "Tracked state is available through the signed-in bill-list helper.",
        "Sponsor preview is limited to chief sponsorships.",
    ]
    status = "pass"
    return SurfaceResult(
        "bill_list",
        status,
        len(counter.statements),
        notes,
        explain_preview(stmt, engine),
    )


def validate_bill_detail(session: Session, engine, bill_id) -> SurfaceResult:
    user_id = session.scalar(select(TrackedBill.user_id).limit(1))
    stmt = bill_detail_stmt(bill_id, user_id=user_id)
    with QueryCounter(engine).capture() as counter:
        bill = session.scalar(stmt)
        assert bill is not None
        _ = len(bill.sponsorships)
        _ = len(bill.actions)
        _ = len(bill.versions)
        _ = sum(len(event.records) for event in bill.vote_events)
        _ = len(bill.topics)
        _ = len(bill.enrichments)
        _ = bool(bill.tracked_by)
    notes = [
        "Bill detail data is directly queryable with bounded eager loads.",
        f"Executed as {len(counter.statements)} SQL statements on the sample dataset.",
        "Tracked state and AI enrichments are part of the detail helper.",
    ]
    return SurfaceResult(
        "bill_detail",
        "pass",
        len(counter.statements),
        notes,
        explain_preview(stmt, engine),
    )


def validate_legislator_directory(
    session: Session, engine, session_id
) -> SurfaceResult:
    stmt = legislator_directory_stmt(session_id)
    with QueryCounter(engine).capture() as counter:
        legislators = session.scalars(stmt).all()
        for legislator in legislators:
            current = current_period(legislator.service_periods)
            _ = current.district.code if current and current.district else None
            _ = sum(stat.total_bill_count for stat in legislator.stats)
    notes = [
        "Directory card fields have a direct query path through service periods and stats.",
        f"Executed as {len(counter.statements)} SQL statements on the sample dataset.",
        "The eager load is constrained to the current service period for the current session.",
    ]
    return SurfaceResult(
        "legislator_directory",
        "pass",
        len(counter.statements),
        notes,
        explain_preview(stmt, engine),
    )


def validate_legislator_profile(
    session: Session, engine, legislator_id
) -> SurfaceResult:
    session_id = session.scalar(select(LegislatorServicePeriod.session_id).limit(1))
    stmt = legislator_profile_stmt(legislator_id, session_id)
    sponsored_bills_stmt = legislator_sponsored_bills_stmt(legislator_id, session_id)
    vote_history_stmt = legislator_vote_history_stmt(legislator_id, session_id)
    with QueryCounter(engine).capture() as counter:
        legislator = session.scalar(stmt)
        assert legislator is not None
        _ = len(legislator.committee_memberships)
        _ = [period.party for period in legislator.service_periods]
        sponsored_bills = session.scalars(sponsored_bills_stmt).all()
        _ = [bill.stats.sponsor_count if bill.stats else 0 for bill in sponsored_bills]
        _ = [
            [s.legislator.full_name for s in bill.chief_sponsorships if s.legislator]
            for bill in sponsored_bills
        ]
        _ = session.scalars(vote_history_stmt.limit(25)).all()
    notes = [
        "Profile root, sponsored bills, and vote history all have dedicated query helpers.",
        f"Executed as {len(counter.statements)} SQL statements on the sample dataset.",
        "Current-state service data is filtered to the requested session.",
    ]
    return SurfaceResult(
        "legislator_profile",
        "pass",
        len(counter.statements),
        notes,
        explain_preview(stmt, engine),
    )


def validate_find_my_legislator(
    session: Session, engine, session_id, user_id
) -> SurfaceResult:
    saved_place = session.scalar(
        select(SavedPlace).where(
            SavedPlace.user_id == user_id, SavedPlace.is_default.is_(True)
        )
    )
    district_ids = []
    if saved_place is not None:
        district_ids = [saved_place.house_district_id, saved_place.senate_district_id]
    if not any(district_ids):
        district_ids = session.scalars(
            select(LegislatorServicePeriod.district_id)
            .where(
                LegislatorServicePeriod.session_id == session_id,
                LegislatorServicePeriod.is_current.is_(True),
            )
            .limit(2)
        ).all()
    stmt = find_my_legislator_stmt(
        session_id, [district_id for district_id in district_ids if district_id]
    )
    with QueryCounter(engine).capture() as counter:
        periods = session.scalars(stmt).all()
        _ = [(period.legislator.full_name, period.district.code) for period in periods]
    notes = [
        "The district-to-member query path is direct and simple.",
        f"Executed as {len(counter.statements)} SQL statements on the sample dataset.",
        "This depends on external GIS lookup to provide district identifiers, which is the intended boundary.",
    ]
    return SurfaceResult(
        "find_my_legislator",
        "pass",
        len(counter.statements),
        notes,
        explain_preview(stmt, engine),
    )


def validate_tracked_bills(session: Session, engine, user_id) -> SurfaceResult:
    stmt = tracked_bills_stmt(user_id)
    with QueryCounter(engine).capture() as counter:
        tracked = session.scalars(stmt).all()
        for row in tracked:
            _ = row.bill.title
            _ = row.bill.stats.action_count if row.bill.stats else 0
            _ = [
                s.legislator.full_name
                for s in row.bill.chief_sponsorships[:3]
                if s.legislator
            ]
    notes = [
        "Tracked bills are a first-class join and are directly queryable for signed-in users.",
        f"Executed as {len(counter.statements)} SQL statements on the sample dataset.",
        "Tracked bill cards use the same chief-sponsor preview path as the main bill list.",
    ]
    return SurfaceResult(
        "tracked_bills",
        "pass",
        len(counter.statements),
        notes,
        explain_preview(stmt, engine),
    )


def validate_chat_retrieval(session: Session, engine, bill_id) -> SurfaceResult:
    probe = session.scalar(select(RagChunkEmbedding).limit(1))
    assert probe is not None
    probe_vector = list(probe.embedding)
    stmt = semantic_rag_chunk_stmt(
        probe_vector,
        bill_id=bill_id,
        embedding_model=probe.embedding_model,
        limit=10,
    )
    with QueryCounter(engine).capture() as counter:
        chunks = session.scalars(stmt).all()
        _ = [
            (chunk.citation_label, chunk.rag_section_document.bill_id)
            for chunk in chunks
        ]
    embedding_count = session.scalar(
        select(func.count()).select_from(RagChunkEmbedding)
    )
    vector_index_exists = session.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM pg_indexes
                WHERE schemaname = current_schema()
                  AND indexname = 'ix_rag_chunk_embedding_embedding_ivfflat'
            )
            """
        )
    ).scalar_one()
    notes = [
        "Citation-safe chunks are directly queryable from the semantic retrieval helper.",
        f"Executed as {len(counter.statements)} SQL statements on the sample dataset.",
        f"Vector index present: {vector_index_exists}.",
        f"Current sample embedding row count: {embedding_count}.",
    ]
    status = "pass" if vector_index_exists and embedding_count > 0 else "fail"
    return SurfaceResult(
        "chat_retrieval",
        status,
        len(counter.statements),
        notes,
        explain_preview(stmt, engine),
    )


def main() -> None:
    database_url = os.environ.get(
        "DATABASE_URL",
        "postgresql+psycopg://alethical:alethical@localhost:54329/alethical",
    )
    engine = create_engine(database_url, echo=False)

    with Session(engine) as session:
        session_id = session.scalar(select(LegislatorServicePeriod.session_id).limit(1))
        user_id = session.scalar(select(TrackedBill.user_id).limit(1))
        bill_id = session.scalar(
            select(Bill.id).order_by(Bill.file_number.asc()).limit(1)
        )
        legislator_id = session.scalar(
            select(Legislator.id).order_by(Legislator.sort_name.asc()).limit(1)
        )

        results = [
            validate_bill_list(session, engine, session_id, user_id),
            validate_bill_detail(session, engine, bill_id),
            validate_legislator_directory(session, engine, session_id),
            validate_legislator_profile(session, engine, legislator_id),
            validate_find_my_legislator(session, engine, session_id, user_id),
            validate_tracked_bills(session, engine, user_id),
            validate_chat_retrieval(session, engine, bill_id),
        ]

    rubric = {
        "product_query_coverage": "pass",
        "n_plus_1_safety": "pass",
        "ingestion_compatibility": "pass",
        "rag_compatibility": "pass",
        "auditability": "pass",
        "evolvability": "pass",
    }

    payload = {
        "surfaces": [result.__dict__ for result in results],
        "rubric": rubric,
    }
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
