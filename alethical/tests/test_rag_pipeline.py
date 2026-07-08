from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_database_url
from alethical.pipeline.oban_workers import BillSyncChunkWorker
from alethical.pipeline.rag_ingest import build_rag_rows_for_bill_keys


def _session():
    return Session(create_engine(get_database_url(), pool_pre_ping=True))


def _counts_for_bill(db: Session, bill_id):
    section_count = db.scalar(
        select(func.count(schema.RagSectionDocument.id)).where(
            schema.RagSectionDocument.bill_id == bill_id
        )
    )
    chunk_count = db.scalar(
        select(func.count(schema.RagChunk.id)).where(
            schema.RagChunk.rag_section_document_id.in_(
                select(schema.RagSectionDocument.id).where(
                    schema.RagSectionDocument.bill_id == bill_id
                )
            )
        )
    )
    embedding_count = db.scalar(
        select(func.count(schema.RagChunkEmbedding.id)).where(
            schema.RagChunkEmbedding.rag_chunk_id.in_(
                select(schema.RagChunk.id).where(
                    schema.RagChunk.rag_section_document_id.in_(
                        select(schema.RagSectionDocument.id).where(
                            schema.RagSectionDocument.bill_id == bill_id
                        )
                    )
                )
            )
        )
    )
    return int(section_count), int(chunk_count), int(embedding_count)


def _reset_bill_rag_rows(db: Session, bill_key: str) -> int:
    bill_id = db.scalar(select(schema.Bill.id).where(schema.Bill.bill_key == bill_key))
    if bill_id is None:
        raise AssertionError(f"Missing seeded bill {bill_key}")

    section_rows = db.scalars(
        select(schema.RagSectionDocument.id).where(
            schema.RagSectionDocument.bill_id == bill_id
        )
    ).all()
    if section_rows:
        chunk_rows = db.scalars(
            select(schema.RagChunk.id).where(
                schema.RagChunk.rag_section_document_id.in_(section_rows)
            )
        ).all()
        if chunk_rows:
            db.execute(
                delete(schema.RagChunkEmbedding).where(
                    schema.RagChunkEmbedding.rag_chunk_id.in_(chunk_rows)
                )
            )
        db.execute(
            delete(schema.RagChunk).where(
                schema.RagChunk.rag_section_document_id.in_(section_rows)
            )
        )
        db.execute(
            delete(schema.RagSectionDocument).where(
                schema.RagSectionDocument.id.in_(section_rows)
            )
        )
    db.commit()
    return bill_id


def test_build_rag_rows_for_bill_keys_is_idempotent() -> None:
    bill_key = "94-2025-SF1832"
    with _session() as db:
        bill_id = _reset_bill_rag_rows(db, bill_key)
        before_counts = _counts_for_bill(db, bill_id)

        first = build_rag_rows_for_bill_keys(
            db,
            [bill_key],
            dry_run=False,
            rag_embedding_batch_size=8,
            rag_model="demo-minilm-1536",
        )
        db.commit()
        after_first = _counts_for_bill(db, bill_id)
        assert first["rag_built"] == 1
        assert first["rag_skipped"] == 0
        assert first["rag_already_exists"] == 0
        assert before_counts == (0, 0, 0)
        assert after_first[0] > 0
        assert after_first[1] > 0
        assert after_first[2] > 0

        second = build_rag_rows_for_bill_keys(
            db,
            [bill_key],
            dry_run=False,
            rag_embedding_batch_size=8,
            rag_model="demo-minilm-1536",
        )
        db.commit()
        after_second = _counts_for_bill(db, bill_id)
        assert second["rag_built"] == 0
        assert second["rag_skipped"] == 0
        assert second["rag_already_exists"] == 1
        assert second["rag_results"][0]["status"] == "already_exists"
        assert after_second == after_first


class _FakeMinnesotaIngestionPipeline:
    def __init__(self, _db):
        pass

    def ingest_bills(self, targets):
        return {"bills_ingested": len(targets), "bill_keys": ["94-2025-SF1832"]}


@pytest.mark.asyncio
async def test_bill_sync_chunk_worker_rejects_non_production_rag_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "alethical.pipeline.minnesota.MinnesotaIngestionPipeline",
        _FakeMinnesotaIngestionPipeline,
    )

    with pytest.raises(ValueError, match="rag_target=production"):
        await BillSyncChunkWorker().process(
            SimpleNamespace(
                args={
                    "targets": [
                        {
                            "chamber": "house",
                            "bill_number": "SF1832",
                            "session_code": "0942025",
                        }
                    ],
                    "dry_run": False,
                    "allow_writes": True,
                    "include_rag": True,
                    "rag_target": "local",
                    "rag_model": "demo-minilm-1536",
                    "rag_embedding_batch_size": 8,
                    "database_target": "local",
                }
            )
        )


@pytest.mark.asyncio
async def test_bill_sync_chunk_worker_reports_rag_counts_for_production_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "alethical.pipeline.minnesota.MinnesotaIngestionPipeline",
        _FakeMinnesotaIngestionPipeline,
    )
    calls: list[tuple[list[str], dict[str, object]]] = []

    def fake_build(db, bill_keys, **kwargs):
        calls.append((list(bill_keys), kwargs))
        return {
            "rag_built": 1,
            "rag_skipped": 0,
            "rag_already_exists": 0,
            "rag_results": [
                {
                    "bill_key": "94-2025-SF1832",
                    "status": "built",
                    "rag_section_count": 4,
                    "rag_chunk_count": 31,
                }
            ],
        }

    monkeypatch.setattr(
        "alethical.pipeline.rag_ingest.build_rag_rows_for_bill_keys", fake_build
    )
    monkeypatch.setattr(
        "alethical.pipeline.oban_workers._database_url", lambda args: get_database_url()
    )

    record = await BillSyncChunkWorker().process(
        SimpleNamespace(
            args={
                "targets": [
                    {
                        "chamber": "house",
                        "bill_number": "SF1832",
                        "session_code": "0942025",
                    }
                ],
                "dry_run": False,
                "allow_writes": True,
                "include_rag": True,
                "rag_target": "production",
                "rag_model": "demo-minilm-1536",
                "rag_embedding_batch_size": 8,
                "database_target": "local",
            }
        )
    )
    result = record.value
    assert result["rag_built"] == 1
    assert result["rag_skipped"] == 0
    assert result["rag_already_exists"] == 0
    assert calls == [
        (
            ["94-2025-SF1832"],
            {
                "dry_run": False,
                "rag_model": "demo-minilm-1536",
                "rag_embedding_batch_size": 8,
            },
        )
    ]
