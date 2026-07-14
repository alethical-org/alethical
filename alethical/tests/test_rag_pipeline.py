from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_database_url
from alethical.pipeline.oban_workers import (
    BillSyncChunkWorker,
    RagBackfillChunkWorker,
    RagBackfillWorker,
)
from alethical.pipeline.rag_ingest import (
    DEFAULT_RAG_MODEL,
    FALLBACK_EMBEDDING_MODEL,
    build_rag_rows_for_bill_keys,
)


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
            rag_model="text-embedding-3-small",
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
            rag_model="text-embedding-3-small",
        )
        db.commit()
        after_second = _counts_for_bill(db, bill_id)
        assert second["rag_built"] == 0
        assert second["rag_skipped"] == 0
        assert second["rag_already_exists"] == 1
        assert second["rag_results"][0]["status"] == "already_exists"
        assert after_second == after_first


def test_fallback_embeddings_are_labeled_distinctly_and_rebuilt_when_keyed(
    monkeypatch,
) -> None:
    """Keyless builds store FALLBACK_EMBEDDING_MODEL, and a keyed run re-embeds them (#221)."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    bill_key = "94-2025-SF1832"
    with _session() as db:
        bill_id = _reset_bill_rag_rows(db, bill_key)
        build_rag_rows_for_bill_keys(
            db,
            [bill_key],
            dry_run=False,
            rag_embedding_batch_size=8,
            rag_model=DEFAULT_RAG_MODEL,
        )
        db.commit()

        stored_models = set(
            db.scalars(
                select(schema.RagChunkEmbedding.embedding_model).where(
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
            ).all()
        )
        assert stored_models == {FALLBACK_EMBEDDING_MODEL}

        # Still keyless: the fallback rows count as complete — no rebuild loop.
        keyless_again = build_rag_rows_for_bill_keys(
            db, [bill_key], dry_run=True, rag_model=DEFAULT_RAG_MODEL
        )
        assert keyless_again["rag_results"][0]["status"] == "already_exists"

        # With a key present, the same rows must read as needing re-embedding.
        # Dry-run reports would_build before any embedding call, so no API hit.
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-a-real-key")
        keyed = build_rag_rows_for_bill_keys(
            db, [bill_key], dry_run=True, rag_model=DEFAULT_RAG_MODEL
        )
        assert keyed["rag_results"][0]["status"] == "would_build"


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
                    "rag_model": "text-embedding-3-small",
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
                "rag_model": "text-embedding-3-small",
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
                "rag_model": "text-embedding-3-small",
                "rag_embedding_batch_size": 8,
            },
        )
    ]


@pytest.mark.asyncio
async def test_rag_backfill_chunk_worker_calls_build_rag_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[list[str], dict[str, object]]] = []

    def fake_build(db, bill_keys, **kwargs):
        calls.append((list(bill_keys), kwargs))
        return {
            "rag_built": 2,
            "rag_skipped": 0,
            "rag_already_exists": 0,
            "rag_results": [],
        }

    monkeypatch.setattr(
        "alethical.pipeline.rag_ingest.build_rag_rows_for_bill_keys", fake_build
    )
    monkeypatch.setattr(
        "alethical.pipeline.oban_workers._database_url", lambda args: get_database_url()
    )

    record = await RagBackfillChunkWorker().process(
        SimpleNamespace(
            args={
                "bill_keys": ["94-2025-SF1832", "94-2025-HF2136"],
                "rag_target": "production",
                "rag_model": "text-embedding-3-small",
                "rag_embedding_batch_size": 8,
                "database_target": "local",
            }
        )
    )
    result = record.value
    assert result["rag_built"] == 2
    assert result["bill_keys"] == ["94-2025-SF1832", "94-2025-HF2136"]
    assert len(calls) == 1
    assert calls[0][0] == ["94-2025-SF1832", "94-2025-HF2136"]
    assert calls[0][1]["rag_model"] == "text-embedding-3-small"
    assert calls[0][1]["dry_run"] is False


@pytest.mark.asyncio
async def test_rag_backfill_chunk_worker_rejects_non_production_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "alethical.pipeline.oban_workers._database_url", lambda args: get_database_url()
    )
    with pytest.raises(ValueError, match="rag_target=production"):
        await RagBackfillChunkWorker().process(
            SimpleNamespace(
                args={
                    "bill_keys": ["94-2025-SF1832"],
                    "rag_target": "local",
                    "rag_model": "text-embedding-3-small",
                    "rag_embedding_batch_size": 8,
                    "database_target": "local",
                }
            )
        )


@pytest.mark.asyncio
async def test_rag_backfill_worker_dry_run_reports_candidates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Dry-run path should report candidate count without enqueuing children."""
    monkeypatch.setattr(
        "alethical.pipeline.oban_workers._database_url", lambda args: get_database_url()
    )

    # Stub out the DB session so the discovery SQL doesn't run against a real DB.
    class _FakeResult:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

    class _FakeSession:
        def execute(self, stmt, params=None):
            return _FakeResult([(k,) for k in ("94-2025-SF1832", "94-2025-HF2136")])

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    class _FakeEngine:
        def __enter__(self):
            return _FakeSession()

        def __exit__(self, *args):
            return False

    # create_engine and Session are imported lazily inside run(), so patch
    # them at their source modules.
    monkeypatch.setattr("sqlalchemy.create_engine", lambda *a, **kw: _FakeEngine())
    monkeypatch.setattr("sqlalchemy.orm.Session", lambda *a, **kw: _FakeSession())

    record = await RagBackfillWorker().process(
        SimpleNamespace(
            args={
                "dry_run": True,
                "rag_model": "text-embedding-3-small",
                "chunk_size": 25,
                "database_target": "local",
            }
        )
    )
    result = record.value
    assert result["dry_run"] is True
    assert result["candidates"] == 2
    assert result["chunks"] == 1
    assert result["sample"] == ["94-2025-SF1832", "94-2025-HF2136"]
