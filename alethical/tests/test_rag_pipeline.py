from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_database_url
from alethical.pipeline.oban_workers import (
    BillSyncChunkWorker,
    PipelineRunWorker,
    RagBackfillChunkWorker,
    RagBackfillWorker,
)
from alethical.pipeline import rag_ingest
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


def test_effective_embedding_model_fails_loud_in_production_without_key(
    monkeypatch,
) -> None:
    """No OPENAI_API_KEY + production must raise, not resolve to the hash label (#105)."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("ALETHICAL_DATABASE_TARGET", "production")
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY is required"):
        rag_ingest.effective_embedding_model(DEFAULT_RAG_MODEL)


def test_build_embeddings_fails_loud_in_production_without_key(monkeypatch) -> None:
    """The vectorizer choke point refuses the hash fallback in production (#105)."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("ALETHICAL_DATABASE_TARGET", "production")
    with pytest.raises(RuntimeError, match="deterministic hash fallback"):
        rag_ingest._build_embeddings(
            ["some text"], model=DEFAULT_RAG_MODEL, batch_size=1
        )


def test_hash_fallback_still_works_off_production(monkeypatch) -> None:
    """Keyless local/test dev still gets the deterministic fallback (label + vectors)."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ALETHICAL_DATABASE_TARGET", raising=False)
    assert (
        rag_ingest.effective_embedding_model(DEFAULT_RAG_MODEL)
        == FALLBACK_EMBEDDING_MODEL
    )
    vectors = rag_ingest._build_embeddings(["x"], model=DEFAULT_RAG_MODEL, batch_size=1)
    assert len(vectors) == 1 and len(vectors[0]) == rag_ingest.VECTOR_DIMENSIONS


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


@pytest.mark.asyncio
async def test_pipeline_run_worker_threads_include_rag_to_full_bill_sync(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The coordinator must pass include_rag down to the full-bill-sync child so
    that --skip-rag (include_rag=False) actually suppresses inline RAG building.
    Regression: previously the coordinator dropped include_rag, so the child
    defaulted it back to True and chunks always built RAG."""
    calls: list[tuple[str, dict[str, object]]] = []

    async def fake_enqueue_child(worker_cls, args, *, force=False):
        calls.append((worker_cls.__name__, dict(args)))
        return {"inserted": False, "worker": worker_cls.__name__}

    monkeypatch.setattr(
        "alethical.pipeline.oban_workers._enqueue_child", fake_enqueue_child
    )

    bills_only = {
        "include_bills": True,
        "include_committees": False,
        "include_votes": False,
        "include_ai_prepare": False,
        "refresh_existing": True,
        "dry_run": True,
    }

    # include_rag=False must reach the full-bill-sync child.
    await PipelineRunWorker().process(
        SimpleNamespace(args={**bills_only, "include_rag": False})
    )
    child = next(args for name, args in calls if name == "FullBillSyncWorker")
    assert child["include_rag"] is False

    # Default (omitted) preserves the RAG-on behavior: child sees include_rag=True.
    calls.clear()
    await PipelineRunWorker().process(SimpleNamespace(args=bills_only))
    child = next(args for name, args in calls if name == "FullBillSyncWorker")
    assert child["include_rag"] is True


def test_semantic_retrieval_excludes_non_current_versions() -> None:
    """#285: retrieval keys on bill_id, not version, so RAG left on a superseded
    version must not surface in a grounded answer. semantic_rag_chunk_stmt defaults
    to current_version_only=True and returns only the current version's chunks;
    the opt-out returns both, proving the scope is what excludes the old one."""
    vec = [0.1] * 1536
    with _session() as db:
        seed = db.scalar(select(schema.Bill).limit(1))
        assert seed is not None
        bill = schema.Bill(
            session_id=seed.session_id,
            chamber_id=seed.chamber_id,
            bill_key="test-285-versionscope-HF7777",
            file_type="HF",
            file_number=7777,
            title="version-scoping retrieval test",
        )
        db.add(bill)
        db.flush()

        def add_version(code: str, is_current: bool, label: str):
            version = schema.BillVersion(
                bill_id=bill.id,
                version_code=code,
                sequence_number=1,
                is_current=is_current,
            )
            db.add(version)
            db.flush()
            rsd = schema.RagSectionDocument(
                bill_id=bill.id,
                bill_version_id=version.id,
                citation_label=label,
                clean_text="text",
                search_text="text",
                cleaning_version="v0.1",
                source_hash=f"hash-{code}",
                word_count=1,
            )
            db.add(rsd)
            db.flush()
            chunk = schema.RagChunk(
                rag_section_document_id=rsd.id,
                chunk_index=0,
                citation_label=label,
                chunk_text=f"chunk {label}",
                search_text="chunk",
                chunking_version="v0.1",
                word_count=1,
            )
            db.add(chunk)
            db.flush()
            db.add(
                schema.RagChunkEmbedding(
                    rag_chunk_id=chunk.id,
                    embedding_model="text-embedding-3-small",
                    embedding=vec,
                )
            )
            db.flush()

        # Current first, then the superseded version (the partial unique index
        # permits only one is_current at a time).
        add_version("0", True, "HF 7777 (current)")
        add_version("current", False, "HF 7777 (superseded)")

        scoped = {
            c.citation_label
            for c in db.scalars(
                schema.semantic_rag_chunk_stmt(
                    vec,
                    bill_id=bill.id,
                    embedding_model="text-embedding-3-small",
                    limit=10,
                )
            ).all()
        }
        assert "HF 7777 (current)" in scoped
        assert "HF 7777 (superseded)" not in scoped

        unscoped = {
            c.citation_label
            for c in db.scalars(
                schema.semantic_rag_chunk_stmt(
                    vec,
                    bill_id=bill.id,
                    embedding_model="text-embedding-3-small",
                    limit=10,
                    current_version_only=False,
                )
            ).all()
        }
        assert "HF 7777 (superseded)" in unscoped

        db.rollback()
