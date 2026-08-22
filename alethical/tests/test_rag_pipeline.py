from __future__ import annotations

import sys
import uuid
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
from alethical.pipeline import bill_summary_requests, oban_workers, rag_ingest
from alethical.pipeline.rag_ingest import (
    DEFAULT_RAG_MODEL,
    FALLBACK_EMBEDDING_MODEL,
    build_rag_rows_for_bill_keys,
)
from scripts import load_minnesota_data as load_minnesota


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
        # Delete the embeddings with the SAME predicate the chunk delete uses, as a
        # subquery, rather than against a list of chunk ids read a statement earlier.
        #
        # What is certain, by reading rather than by measurement: those two were
        # different sets by construction. The embedding delete covered the chunks that
        # existed at read time; the chunk delete covers every chunk under these
        # documents. Any chunk in the second set but not the first keeps its embedding
        # and then makes the chunk delete fail on the foreign key. One predicate for
        # both cannot diverge.
        #
        # What is NOT established is that this caused the failure that led here. Running
        # this file straight after test_ask_scenarios.py raised exactly that foreign-key
        # error, twice, and deselecting that file's coverage-denominator test made it
        # pass — but after this change the old code stopped reproducing it too, so the
        # database state that triggered it is gone and the link is unproven. Recorded
        # that way deliberately: a comment asserting a reproduction that no longer
        # reproduces is worse than one admitting the gap.
        #
        # Neither CI nor the full suite ever saw it; only that two-file invocation did.
        db.execute(
            delete(schema.RagChunkEmbedding).where(
                schema.RagChunkEmbedding.rag_chunk_id.in_(
                    select(schema.RagChunk.id).where(
                        schema.RagChunk.rag_section_document_id.in_(section_rows)
                    )
                )
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


def _first_current_bill_section(db: Session, bill_key: str):
    bill = db.scalar(select(schema.Bill).where(schema.Bill.bill_key == bill_key))
    assert bill is not None
    version = db.scalar(
        select(schema.BillVersion).where(
            schema.BillVersion.bill_id == bill.id,
            schema.BillVersion.is_current.is_(True),
        )
    )
    assert version is not None
    section = db.scalar(
        select(schema.BillVersionSection)
        .where(schema.BillVersionSection.bill_version_id == version.id)
        .order_by(schema.BillVersionSection.source_order.asc())
    )
    assert section is not None
    return section


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


def test_build_embeddings_fails_loud_for_explicit_production_target_without_key(
    monkeypatch,
) -> None:
    """A queued production target refuses hash vectors without relying on the env."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ALETHICAL_DATABASE_TARGET", raising=False)
    with pytest.raises(RuntimeError, match="deterministic hash fallback"):
        rag_ingest._build_embeddings(
            ["some text"],
            model=DEFAULT_RAG_MODEL,
            batch_size=1,
            database_target="production",
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
        return {
            "bills_ingested": len(targets),
            "bill_keys": ["94-2025-SF1832"],
            "text_changed_bill_keys": ["94-2025-SF1832"],
        }


@pytest.mark.asyncio
async def test_bill_sync_indexes_the_text_saved_by_the_same_refresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ALETHICAL_DATABASE_TARGET", raising=False)
    bill_key = "94-2025-SF1832"
    refreshed_words = "The refreshed bill now contains this unmistakable wording."

    with _session() as db:
        section = _first_current_bill_section(db, bill_key)
        original_text = section.raw_text
        original_source_hash = section.source_hash
        _reset_bill_rag_rows(db, bill_key)
        build_rag_rows_for_bill_keys(
            db,
            [bill_key],
            dry_run=False,
            rag_embedding_batch_size=8,
            rag_model=DEFAULT_RAG_MODEL,
        )
        db.commit()

    class RefreshesStoredText:
        def __init__(self, db):
            self.db = db

        def ingest_bills(self, _targets):
            stored_section = _first_current_bill_section(self.db, bill_key)
            stored_section.raw_text = refreshed_words
            stored_section.source_hash = rag_ingest.rag_text.source_hash(
                refreshed_words
            )
            return {
                "bills_ingested": 1,
                "bill_keys": [bill_key],
                "text_changed_bill_keys": [bill_key],
            }

    monkeypatch.setattr(
        "alethical.pipeline.minnesota.MinnesotaIngestionPipeline",
        RefreshesStoredText,
    )
    monkeypatch.setattr(
        "alethical.pipeline.oban_workers._database_url",
        lambda _args: get_database_url(),
    )
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-never-called")
    monkeypatch.setattr(
        rag_ingest,
        "_build_embeddings",
        lambda texts, **_kwargs: [
            rag_ingest._deterministic_embedding(value) for value in texts
        ],
    )

    try:
        await BillSyncChunkWorker().process(
            SimpleNamespace(
                args={
                    "targets": [
                        {
                            "chamber": "senate",
                            "bill_number": "1832",
                            "session_code": "0942025",
                        }
                    ],
                    "dry_run": False,
                    "allow_writes": True,
                    "include_rag": True,
                    "rag_target": "production",
                    "rag_model": DEFAULT_RAG_MODEL,
                    "rag_embedding_batch_size": 8,
                    "database_target": "local",
                }
            )
        )

        with _session() as db:
            stored_chunks = db.scalars(
                select(schema.RagChunk.chunk_text)
                .join(schema.RagSectionDocument)
                .join(schema.Bill)
                .where(schema.Bill.bill_key == bill_key)
            ).all()
            assert any(refreshed_words in chunk for chunk in stored_chunks)
    finally:
        with _session() as db:
            section = _first_current_bill_section(db, bill_key)
            section.raw_text = original_text
            section.source_hash = original_source_hash
            db.flush()
            _reset_bill_rag_rows(db, bill_key)
            build_rag_rows_for_bill_keys(
                db,
                [bill_key],
                dry_run=False,
                rag_embedding_batch_size=8,
                rag_model=DEFAULT_RAG_MODEL,
            )
            db.commit()


@pytest.mark.asyncio
async def test_bill_sync_rolls_back_refreshed_text_when_search_build_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ALETHICAL_DATABASE_TARGET", raising=False)
    bill_key = "94-2025-SF1832"
    failed_refresh_words = "These words must not survive a failed search build."
    with _session() as db:
        original_text = _first_current_bill_section(db, bill_key).raw_text

    class RefreshesStoredText:
        def __init__(self, db):
            self.db = db

        def ingest_bills(self, _targets):
            stored_section = _first_current_bill_section(self.db, bill_key)
            stored_section.raw_text = failed_refresh_words
            stored_section.source_hash = rag_ingest.rag_text.source_hash(
                failed_refresh_words
            )
            return {
                "bills_ingested": 1,
                "bill_keys": [bill_key],
                "text_changed_bill_keys": [bill_key],
            }

    def fail_search_build(*_args, **_kwargs):
        raise RuntimeError("search build failed")

    monkeypatch.setattr(
        "alethical.pipeline.minnesota.MinnesotaIngestionPipeline",
        RefreshesStoredText,
    )
    monkeypatch.setattr(
        "alethical.pipeline.rag_ingest.build_rag_rows_for_bill_keys",
        fail_search_build,
    )
    monkeypatch.setattr(
        "alethical.pipeline.oban_workers._database_url",
        lambda _args: get_database_url(),
    )

    with pytest.raises(RuntimeError, match="search build failed"):
        await BillSyncChunkWorker().process(
            SimpleNamespace(
                args={
                    "targets": [
                        {
                            "chamber": "senate",
                            "bill_number": "1832",
                            "session_code": "0942025",
                        }
                    ],
                    "dry_run": False,
                    "allow_writes": True,
                    "include_rag": True,
                    "rag_target": "production",
                    "database_target": "local",
                }
            )
        )

    with _session() as db:
        assert _first_current_bill_section(db, bill_key).raw_text == original_text


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
async def test_bill_sync_rejects_search_writes_to_a_different_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "alethical.pipeline.minnesota.MinnesotaIngestionPipeline",
        _FakeMinnesotaIngestionPipeline,
    )

    def database_url(args):
        database_name = (
            "search-store" if args.get("database_target") == "production" else "bills"
        )
        return f"postgresql+psycopg://test:test@localhost:54329/{database_name}"

    monkeypatch.setattr("alethical.pipeline.oban_workers._database_url", database_url)

    with pytest.raises(ValueError, match="same database"):
        await BillSyncChunkWorker().process(
            SimpleNamespace(
                args={
                    "targets": [
                        {
                            "chamber": "senate",
                            "bill_number": "1832",
                            "session_code": "0942025",
                        }
                    ],
                    "dry_run": False,
                    "allow_writes": True,
                    "include_rag": True,
                    "rag_target": "production",
                    "database_target": "local",
                }
            )
        )


@pytest.mark.asyncio
async def test_bill_sync_chunk_worker_reports_rag_counts_for_production_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class ReportsOneChangedBill:
        def __init__(self, _db):
            pass

        def ingest_bills(self, _targets):
            return {
                "bills_ingested": 2,
                "bill_keys": ["94-2025-SF1832", "94-2025-HF2136"],
                "text_changed_bill_keys": ["94-2025-HF2136"],
            }

    monkeypatch.setattr(
        "alethical.pipeline.minnesota.MinnesotaIngestionPipeline",
        ReportsOneChangedBill,
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
    assert result["bill_keys"] == ["94-2025-SF1832", "94-2025-HF2136"]
    assert result["text_changed_bill_keys"] == ["94-2025-HF2136"]
    assert result["rag_built"] == 1
    assert result["rag_skipped"] == 0
    assert result["rag_already_exists"] == 0
    assert calls == [
        (
            ["94-2025-HF2136"],
            {
                "dry_run": False,
                "rag_model": "text-embedding-3-small",
                "rag_embedding_batch_size": 8,
                "database_target": "production",
            },
        )
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "include_rag", [True, False], ids=["search-enabled", "search-skipped"]
)
async def test_bill_sync_enqueues_role_only_summary_request_without_rag_change(
    monkeypatch: pytest.MonkeyPatch,
    include_rag: bool,
) -> None:
    """A saved legal-role change must enqueue its already-ready request once."""

    request_id = "00000000-0000-0000-0000-000000000457"

    class ReportsOneRoleOnlyChange:
        def __init__(self, _db):
            pass

        def ingest_bills(self, _targets):
            return {
                "bills_ingested": 1,
                "bill_keys": ["94-2026-SF3755"],
                "text_changed_bill_keys": [],
                "summary_changed_bill_keys": ["94-2026-SF3755"],
                "summary_request_ids": [request_id],
            }

    def unchanged_search_rows(_db, bill_keys, **_kwargs):
        assert list(bill_keys) == ["94-2026-SF3755"]
        return {
            "rag_built": 0,
            "rag_skipped": 0,
            "rag_already_exists": 1,
            "rag_results": [
                {
                    "bill_key": "94-2026-SF3755",
                    "status": "already_exists",
                }
            ],
            "ready_summary_request_ids": [],
        }

    monkeypatch.setattr(
        "alethical.pipeline.minnesota.MinnesotaIngestionPipeline",
        ReportsOneRoleOnlyChange,
    )
    monkeypatch.setattr(
        "alethical.pipeline.rag_ingest.build_rag_rows_for_bill_keys",
        unchanged_search_rows,
    )
    monkeypatch.setattr(
        "alethical.pipeline.bill_summary_requests.mark_summary_requests_ready",
        lambda _db, _bill_keys, **_kwargs: [],
    )
    monkeypatch.setattr(
        "alethical.pipeline.oban_workers._database_url",
        lambda _args: get_database_url(),
    )

    enqueued: list[list[str]] = []

    async def capture_enqueue(request_ids, **_kwargs):
        values = list(request_ids)
        enqueued.append(values)
        return [{"request_id": value} for value in values]

    monkeypatch.setattr(
        "alethical.pipeline.bill_summary_requests.enqueue_ready_requests",
        capture_enqueue,
    )

    record = await BillSyncChunkWorker().process(
        SimpleNamespace(
            args={
                "targets": [
                    {
                        "chamber": "senate",
                        "bill_number": "3755",
                        "session_code": "0942026",
                    }
                ],
                "dry_run": False,
                "allow_writes": True,
                "include_rag": include_rag,
                "rag_target": "production",
                "rag_model": DEFAULT_RAG_MODEL,
                "database_target": "local",
            }
        )
    )

    assert enqueued == [[request_id]]
    assert record.value["summary_children"] == [{"request_id": request_id}]


@pytest.mark.parametrize(
    "skip_rag", [False, True], ids=["search-enabled", "search-skipped"]
)
def test_direct_loader_enqueues_role_only_summary_request_without_rag_change(
    monkeypatch: pytest.MonkeyPatch,
    skip_rag: bool,
) -> None:
    """The laptop ingestion path must hand off the same already-ready request."""

    request_id = "00000000-0000-0000-0000-000000000458"

    class ReportsOneRoleOnlyChange:
        def __init__(self, _db):
            pass

        def ingest_bills(self, _targets):
            return {
                "bills_ingested": 1,
                "bill_keys": ["94-2026-SF3755"],
                "text_changed_bill_keys": [],
                "summary_changed_bill_keys": ["94-2026-SF3755"],
                "summary_request_ids": [request_id],
            }

    def unchanged_search_rows(_db, bill_keys, **_kwargs):
        assert list(bill_keys) == ["94-2026-SF3755"]
        return {
            "rag_built": 0,
            "rag_skipped": 0,
            "rag_already_exists": 1,
            "rag_results": [
                {
                    "bill_key": "94-2026-SF3755",
                    "status": "already_exists",
                }
            ],
            "ready_summary_request_ids": [],
        }

    monkeypatch.setattr(
        load_minnesota, "MinnesotaIngestionPipeline", ReportsOneRoleOnlyChange
    )
    monkeypatch.setattr(
        "alethical.pipeline.rag_ingest.build_rag_rows_for_bill_keys",
        unchanged_search_rows,
    )
    monkeypatch.setattr(
        "alethical.pipeline.bill_summary_requests.mark_summary_requests_ready",
        lambda _db, _bill_keys, **_kwargs: [],
    )

    enqueued: list[tuple[list[str], dict[str, object]]] = []

    async def capture_enqueue(request_ids, **kwargs):
        enqueued.append((list(request_ids), kwargs))
        return []

    monkeypatch.setattr(
        "alethical.pipeline.bill_summary_requests.enqueue_ready_requests",
        capture_enqueue,
    )
    argv = [
        "load_minnesota_data.py",
        "--database-url",
        get_database_url(),
        "--skip-legislators",
        "--bill",
        "SF3755",
    ]
    if skip_rag:
        argv.append("--skip-rag")
    monkeypatch.setattr(sys, "argv", argv)

    load_minnesota.main()

    assert enqueued == [
        (
            [request_id],
            {
                "database_target": "local",
                "database_url": get_database_url(),
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
async def test_rag_backfill_chunk_queues_ready_request_from_rag_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = schema.BillSummaryRequest(
        bill_id=uuid.uuid4(),
        bill_version_id=uuid.uuid4(),
        source_text_fingerprint="a" * 64,
        prompt_context_version="test-v1",
        prepared_prompt_fingerprint="b" * 64,
        model_name="claude:claude-sonnet-5",
        status=schema.BillSummaryRequestStatus.ready,
    )
    with _session() as db:
        db.add(request)
        db.commit()
        request_id = request.id

    def fake_build(_db, bill_keys, **_kwargs):
        assert list(bill_keys) == ["94-2026-SF3755"]
        return {
            "rag_built": 1,
            "rag_skipped": 0,
            "rag_already_exists": 0,
            "ready_summary_request_ids": [str(request_id)],
        }

    resolved_targets: list[tuple[str | None, str | None]] = []

    def resolve_database(target, database_url=None):
        resolved_targets.append((target, database_url))
        return get_database_url()

    queued: list[dict[str, object]] = []

    async def capture_child(_worker, args):
        queued.append(dict(args))
        return {"request_id": args["request_id"]}

    for name, value in {
        "ALETHICAL_AUTO_BILL_SUMMARY_ENABLED": "true",
        "ALETHICAL_AUTO_BILL_SUMMARY_MONTHLY_BUDGET_CENTS": "2500",
        "ALETHICAL_AUTO_BILL_SUMMARY_PER_BILL_BUDGET_CENTS": "1000",
        "ALETHICAL_AUTO_BILL_SUMMARY_FAILURE_CAP": "5",
        "ALETHICAL_AUTO_BILL_SUMMARY_MAX_ATTEMPTS": "1",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(rag_ingest, "build_rag_rows_for_bill_keys", fake_build)
    monkeypatch.setattr(
        oban_workers, "_resolve_rag_write_url", lambda _args: get_database_url()
    )
    monkeypatch.setattr(
        bill_summary_requests, "database_url_for_target", resolve_database
    )
    monkeypatch.setattr(oban_workers, "_enqueue_child", capture_child)

    try:
        record = await RagBackfillChunkWorker().process(
            SimpleNamespace(
                args={
                    "bill_keys": ["94-2026-SF3755"],
                    "rag_target": "production",
                    "database_target": "local",
                    "oban_target": "local",
                }
            )
        )

        assert resolved_targets == [("production", None)]
        assert len(record.value["summary_children"]) == 1
        assert queued == [
            {
                "_kind": "bill-summary-request",
                "task_key": f"bill-summary-request:{request_id}",
                "request_id": str(request_id),
                "database_target": "production",
                "oban_target": "local",
                "oban_dsn": None,
            }
        ]
    finally:
        with _session() as db:
            db.execute(
                delete(schema.BillSummaryRequest).where(
                    schema.BillSummaryRequest.id == request_id
                )
            )
            db.commit()


@pytest.mark.asyncio
async def test_rag_backfill_chunk_serializes_ready_request_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_id = uuid.uuid4()

    def fake_build(_db, bill_keys, **_kwargs):
        assert list(bill_keys) == ["94-2026-SF3755"]
        return {
            "rag_built": 1,
            "rag_skipped": 0,
            "rag_already_exists": 0,
            "ready_summary_request_ids": [request_id],
        }

    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_ENABLED", "false")
    monkeypatch.setattr(rag_ingest, "build_rag_rows_for_bill_keys", fake_build)
    monkeypatch.setattr(
        oban_workers, "_resolve_rag_write_url", lambda _args: get_database_url()
    )

    record = await RagBackfillChunkWorker().process(
        SimpleNamespace(
            args={
                "bill_keys": ["94-2026-SF3755"],
                "rag_target": "production",
                "database_target": "local",
            }
        )
    )

    assert record.value["ready_summary_request_ids"] == [str(request_id)]


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


def test_a_dropped_connection_is_retried_but_an_http_error_is_not(monkeypatch) -> None:
    """A blip on the wire is retried; a server that answered is the caller's call.

    Two full-corpus embedding runs died on `SSLV3_ALERT_BAD_RECORD_MAC` from
    api.openai.com (Aug 4 2026), losing a whole batch of paid work each time,
    because `_openai_embeddings` had no retry and the script calling it has none
    either. A transport error carries no response, so the request may never have
    been billed and retrying it is unambiguously right.

    The second half is the part worth pinning: an HTTP *status* means the server
    answered, and blindly retrying a 429 or a 400 would spend money against a
    limit or repeat a bad request. That stays the caller's decision.
    """
    import requests

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(rag_ingest.time, "sleep", lambda _seconds: None)

    class _Response:
        status_code = 200

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"data": [{"embedding": [0.5] * rag_ingest.VECTOR_DIMENSIONS}]}

    attempts: list[int] = []

    def _fail_twice_then_succeed(*_args, **_kwargs):
        attempts.append(1)
        if len(attempts) < 3:
            raise requests.exceptions.SSLError("bad record mac")
        return _Response()

    monkeypatch.setattr(rag_ingest.requests, "post", _fail_twice_then_succeed)
    vectors = rag_ingest._openai_embeddings(
        ["some section text"], model=DEFAULT_RAG_MODEL, batch_size=1
    )
    assert len(attempts) == 3, "the dropped connection was not retried"
    assert len(vectors) == 1 and len(vectors[0]) == rag_ingest.VECTOR_DIMENSIONS

    # Retrying is bounded: a real outage surfaces rather than being waited out.
    attempts.clear()

    def _always_fail(*_args, **_kwargs):
        attempts.append(1)
        raise requests.exceptions.ConnectionError("connection reset")

    monkeypatch.setattr(rag_ingest.requests, "post", _always_fail)
    with pytest.raises(requests.exceptions.ConnectionError):
        rag_ingest._openai_embeddings(
            ["some section text"], model=DEFAULT_RAG_MODEL, batch_size=1
        )
    assert len(attempts) == rag_ingest.EMBEDDING_CONNECTION_ATTEMPTS

    # An HTTP status is NOT retried: one call, and the caller decides.
    attempts.clear()

    class _RateLimited(_Response):
        status_code = 429

        def raise_for_status(self) -> None:
            raise requests.exceptions.HTTPError("429 Too Many Requests")

    def _rate_limited(*_args, **_kwargs):
        attempts.append(1)
        return _RateLimited()

    monkeypatch.setattr(rag_ingest.requests, "post", _rate_limited)
    with pytest.raises(requests.exceptions.HTTPError):
        rag_ingest._openai_embeddings(
            ["some section text"], model=DEFAULT_RAG_MODEL, batch_size=1
        )
    assert len(attempts) == 1, "an HTTP error must not be retried here"
