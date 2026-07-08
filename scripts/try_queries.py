#!/usr/bin/env python3
from __future__ import annotations

import os
from pathlib import Path
import sys

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db import models as schema  # noqa: E402

Bill = schema.Bill
BillStats = schema.BillStats
ChatSession = schema.ChatSession
Legislator = schema.Legislator
LegislatorServicePeriod = schema.LegislatorServicePeriod
RagChunk = schema.RagChunk
RagChunkEmbedding = schema.RagChunkEmbedding
RagSectionDocument = schema.RagSectionDocument
TrackedBill = schema.TrackedBill
bill_detail_stmt = schema.bill_detail_stmt
bill_list_stmt = schema.bill_list_stmt
legislator_directory_stmt = schema.legislator_directory_stmt
semantic_rag_chunk_stmt = schema.semantic_rag_chunk_stmt
tracked_bills_stmt = schema.tracked_bills_stmt


def main() -> None:
    database_url = os.environ.get(
        "DATABASE_URL",
        "postgresql+psycopg://alethical:alethical@localhost:54329/alethical",
    )
    engine = create_engine(database_url, echo=False)

    with Session(engine) as session:
        session_id = session.scalar(select(LegislatorServicePeriod.session_id).limit(1))
        user_id = session.scalar(select(TrackedBill.user_id).limit(1))
        first_bill_id = session.scalar(
            select(Bill.id).order_by(Bill.file_number.asc()).limit(1)
        )

        bill_cards = session.scalars(bill_list_stmt(session_id, user_id=user_id)).all()
        print("bill_list_count", len(bill_cards))
        for bill in bill_cards[:2]:
            stats = bill.stats
            print(
                "bill_card",
                bill.bill_key,
                bill.title[:80],
                stats.sponsor_count if stats else 0,
                bool(bill.tracked_by),
            )

        bill = session.scalar(bill_detail_stmt(first_bill_id, user_id=user_id))
        print(
            "bill_detail",
            bill.bill_key,
            len(bill.sponsorships),
            len(bill.actions),
            len(bill.versions),
            len(bill.vote_events),
            bool(bill.tracked_by),
        )

        legislators = session.scalars(legislator_directory_stmt(session_id)).all()
        print("legislator_directory_count", len(legislators))
        for legislator in legislators[:3]:
            current = next(
                (period for period in legislator.service_periods if period.is_current),
                None,
            )
            print(
                "legislator_card",
                legislator.full_name,
                current.party if current else None,
                current.district.code if current else None,
            )

        tracked = session.scalars(tracked_bills_stmt(user_id)).all()
        print("tracked_bill_count", len(tracked))

        chat_sessions = session.scalars(select(ChatSession)).all()
        print("chat_session_count", len(chat_sessions))

        chunk_count = session.scalar(select(func.count()).select_from(RagChunk))
        print("rag_chunk_count", chunk_count)
        probe = session.scalar(select(RagChunkEmbedding).limit(1))
        sample_chunks = session.scalars(
            semantic_rag_chunk_stmt(
                list(probe.embedding),
                bill_id=first_bill_id,
                embedding_model=probe.embedding_model,
                limit=2,
            )
        ).all()
        for chunk in sample_chunks:
            print("rag_chunk", chunk.citation_label[:80], chunk.word_count)


if __name__ == "__main__":
    main()
