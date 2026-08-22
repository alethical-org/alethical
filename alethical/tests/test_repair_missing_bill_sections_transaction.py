from __future__ import annotations

import sys
from collections.abc import Callable
from typing import Any, cast

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_engine
from alethical.pipeline import anthropic_enrichment, rag_ingest
from alethical.pipeline.bill_summary_requests import (
    canonical_source_text_fingerprint,
)
from alethical.pipeline.minnesota import (
    APPENDIX_PARSER_VERSION,
    CHANGE_ROLE_PARSER_VERSION,
    content_hash,
    parse_bill_text_html,
)
from alethical.tests.conftest import DATABASE_URL
from scripts import repair_missing_bill_sections as repair


OFFICIAL_PAGE = """
<html>
  <head><title>HF 457901</title></head>
  <body>
    <div class="bill_section" id="laws.0.1.0">
      <h2 class="section_number">Section 1.</h2>
      <p>First carried law.</p>
    </div>
    <div class="bill_section" id="laws.0.1.0">
      <h2 class="section_number">Section 2.</h2>
      <p>Second restored law.</p>
    </div>
    <div class="bill_section" id="laws.0.1.0">
      <h2 class="section_number">Section 3.</h2>
      <p>Third carried law.</p>
    </div>
  </body>
</html>
"""

ROLE_CHANGED_PAGE = OFFICIAL_PAGE.replace(
    "<p>First carried law.</p>",
    """<p><span class="sr-only">new text begin </span>
      <ins>First carried law.</ins>
      <span class="sr-only">new text end </span></p>""",
)


def _delete_bill(bill_key: str) -> None:
    with Session(get_engine()) as db:
        test_run_ids = list(
            db.scalars(
                select(schema.IngestionRun.id).where(
                    schema.IngestionRun.target_type == "repair_test",
                    schema.IngestionRun.target_key == bill_key,
                )
            )
        )
        bill_id = db.scalar(
            select(schema.Bill.id).where(schema.Bill.bill_key == bill_key)
        )
        if bill_id is not None:
            version_ids = list(
                db.scalars(
                    select(schema.BillVersion.id).where(
                        schema.BillVersion.bill_id == bill_id
                    )
                )
            )
            document_ids = list(
                db.scalars(
                    select(schema.RagSectionDocument.id).where(
                        schema.RagSectionDocument.bill_id == bill_id
                    )
                )
            )
            chunk_ids = (
                list(
                    db.scalars(
                        select(schema.RagChunk.id).where(
                            schema.RagChunk.rag_section_document_id.in_(document_ids)
                        )
                    )
                )
                if document_ids
                else []
            )
            if chunk_ids:
                db.execute(
                    delete(schema.RagChunkEmbedding).where(
                        schema.RagChunkEmbedding.rag_chunk_id.in_(chunk_ids)
                    )
                )
                db.execute(
                    delete(schema.RagChunk).where(schema.RagChunk.id.in_(chunk_ids))
                )
            if document_ids:
                db.execute(
                    delete(schema.RagSectionDocument).where(
                        schema.RagSectionDocument.id.in_(document_ids)
                    )
                )
            db.execute(
                delete(schema.BillSummaryRequest).where(
                    schema.BillSummaryRequest.bill_id == bill_id
                )
            )
            db.execute(
                delete(schema.AIEnrichment).where(
                    schema.AIEnrichment.bill_id == bill_id
                )
            )
            if version_ids:
                db.execute(
                    delete(schema.BillVersionAppendixReference).where(
                        schema.BillVersionAppendixReference.bill_version_id.in_(
                            version_ids
                        )
                    )
                )
                db.execute(
                    delete(schema.BillVersionSection).where(
                        schema.BillVersionSection.bill_version_id.in_(version_ids)
                    )
                )
            db.execute(
                delete(schema.BillVersion).where(schema.BillVersion.bill_id == bill_id)
            )
            db.execute(delete(schema.Bill).where(schema.Bill.id == bill_id))
        if test_run_ids:
            db.execute(
                delete(schema.SourceArtifact).where(
                    schema.SourceArtifact.run_id.in_(test_run_ids)
                )
            )
            db.execute(
                delete(schema.IngestionRun).where(
                    schema.IngestionRun.id.in_(test_run_ids)
                )
            )
        db.commit()


def _seed_partial_bill(bill_key: str, file_number: int):
    _delete_bill(bill_key)
    source_url = f"https://example.test/{bill_key}/official"
    parsed = cast(
        dict[str, Any],
        parse_bill_text_html(OFFICIAL_PAGE, source_url),
    )
    with Session(get_engine()) as db:
        session_id = db.scalar(select(schema.LegislativeSession.id))
        chamber_id = db.scalar(select(schema.Chamber.id))
        assert session_id is not None and chamber_id is not None
        bill = schema.Bill(
            session_id=session_id,
            chamber_id=chamber_id,
            bill_key=bill_key,
            file_type="HF",
            file_number=file_number,
            title="A bill used to prove the missing-section repair transaction.",
        )
        db.add(bill)
        db.flush()
        run = schema.IngestionRun(
            adapter="minnesota_live",
            target_type="repair_test",
            target_key=bill_key,
            status=schema.IngestionStatus.succeeded,
            stats={},
        )
        db.add(run)
        db.flush()
        artifact = schema.SourceArtifact(
            run_id=run.id,
            adapter="minnesota_live",
            artifact_type=schema.ArtifactType.html,
            source_key=bill_key,
            source_url=source_url,
            storage_path=f"minnesota-live/{content_hash(OFFICIAL_PAGE)}",
            content_hash=content_hash(OFFICIAL_PAGE),
            http_status=200,
            content_type="text/html",
            metadata_json={},
            is_current=True,
        )
        db.add(artifact)
        db.flush()
        version = schema.BillVersion(
            bill_id=bill.id,
            version_code="repair-test-v1",
            sequence_number=1,
            html_url=source_url,
            source_artifact_id=artifact.id,
            is_current=True,
        )
        db.add(version)
        db.flush()
        sections = list(parsed["sections"])
        for source_order in (1, 3):
            section = sections[source_order - 1]
            db.add(
                schema.BillVersionSection(
                    bill_version_id=version.id,
                    section_id_text=str(section["section_id"]),
                    source_order=source_order,
                    section_heading=str(section.get("heading") or "") or None,
                    statute_heading=str(section.get("statute_heading") or "") or None,
                    cite_heading=str(section.get("cite_heading") or "") or None,
                    effective_date_heading=str(
                        section.get("effective_date_heading") or ""
                    )
                    or None,
                    raw_text=str(section["text"]),
                    source_hash=content_hash(str(section["text"])),
                    body_blocks=section.get("blocks") or None,
                )
            )
        db.add(
            schema.AIEnrichment(
                bill_id=bill.id,
                bill_version_id=version.id,
                enrichment_type=schema.EnrichmentType.bill_summary,
                model_name="claude:claude-sonnet-5",
                source_version_hash="old-source",
                content_json={"short_title": "Old title"},
                is_current=True,
            )
        )
        db.commit()
        return bill.id, version.id, parsed


def _block_outside_model_calls(monkeypatch: pytest.MonkeyPatch) -> Callable[[], int]:
    calls = {"outside": 0}

    def forbidden_call(*_args, **_kwargs):
        calls["outside"] += 1
        raise AssertionError("the repair test must not call a model provider")

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ALETHICAL_DATABASE_TARGET", raising=False)
    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_ENABLED", "false")
    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_MONTHLY_BUDGET_CENTS", "0")
    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_PER_BILL_BUDGET_CENTS", "0")
    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_FAILURE_CAP", "0")
    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_MAX_ATTEMPTS", "0")
    monkeypatch.setattr(anthropic_enrichment, "_call_anthropic", forbidden_call)
    monkeypatch.setattr(rag_ingest, "_openai_embeddings", forbidden_call)
    monkeypatch.setattr(rag_ingest.requests, "post", forbidden_call)
    return lambda: calls["outside"]


def _run_apply(
    monkeypatch: pytest.MonkeyPatch,
    bill_key: str,
    *,
    page: str = OFFICIAL_PAGE,
) -> None:
    monkeypatch.setattr(repair, "http_session", object)
    monkeypatch.setattr(repair, "fetch_text", lambda _http, _url: page)
    monkeypatch.setattr(repair.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "repair_missing_bill_sections.py",
            "--database-url",
            DATABASE_URL,
            "--apply",
            "--bill-key",
            bill_key,
        ],
    )
    repair.main()


def test_apply_refuses_same_words_with_different_change_roles(
    seed_database: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    bill_key = "test-2026-HF457900"
    bill_id, version_id, _parsed = _seed_partial_bill(bill_key, 457900)
    outside_call_count = _block_outside_model_calls(monkeypatch)

    try:
        assert [
            section["text"]
            for section in parse_bill_text_html(
                OFFICIAL_PAGE, "https://example.test/original"
            )["sections"]
        ] == [
            section["text"]
            for section in parse_bill_text_html(
                ROLE_CHANGED_PAGE, "https://example.test/changed"
            )["sections"]
        ]

        _run_apply(monkeypatch, bill_key, page=ROLE_CHANGED_PAGE)

        with Session(get_engine()) as db:
            assert list(
                db.scalars(
                    select(schema.BillVersionSection.source_order)
                    .where(schema.BillVersionSection.bill_version_id == version_id)
                    .order_by(schema.BillVersionSection.source_order)
                )
            ) == [1, 3]
            assert db.scalar(
                select(schema.AIEnrichment.is_current).where(
                    schema.AIEnrichment.bill_id == bill_id
                )
            )
            assert not db.scalar(
                select(func.count(schema.BillSummaryRequest.id)).where(
                    schema.BillSummaryRequest.bill_id == bill_id
                )
            )
        assert outside_call_count() == 0
    finally:
        _delete_bill(bill_key)


def test_apply_commits_text_context_request_and_search_together(
    seed_database: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    bill_key = "test-2026-HF457901"
    bill_id, version_id, parsed = _seed_partial_bill(bill_key, 457901)
    outside_call_count = _block_outside_model_calls(monkeypatch)

    try:
        _run_apply(monkeypatch, bill_key)

        with Session(get_engine()) as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            assert bill is not None and version is not None
            sections = list(
                db.scalars(
                    select(schema.BillVersionSection)
                    .where(schema.BillVersionSection.bill_version_id == version_id)
                    .order_by(schema.BillVersionSection.source_order)
                )
            )
            assert [section.source_order for section in sections] == [1, 2, 3]
            assert [section.raw_text for section in sections] == [
                str(section["text"]) for section in parsed["sections"]
            ]
            assert [section.change_role_segments for section in sections] == [
                section["change_role_segments"] for section in parsed["sections"]
            ]
            assert all(section.change_role_parse_complete for section in sections)
            assert version.change_role_parser_version == CHANGE_ROLE_PARSER_VERSION
            assert version.change_role_parse_complete is True
            assert version.appendix_parser_version == APPENDIX_PARSER_VERSION
            assert version.appendix_source_hash == parsed["appendix_source_hash"]
            assert version.appendix_parse_complete is True
            assert version.appendix_present is False

            request = db.scalar(
                select(schema.BillSummaryRequest).where(
                    schema.BillSummaryRequest.bill_id == bill_id
                )
            )
            assert request is not None
            assert request.status == schema.BillSummaryRequestStatus.ready
            assert request.provider_call_started_at is None
            assert request.source_text_fingerprint == (
                canonical_source_text_fingerprint(db, bill, version)
            )
            assert len(str(request.prepared_prompt_fingerprint)) == 64
            assert not db.scalar(
                select(schema.AIEnrichment.is_current).where(
                    schema.AIEnrichment.bill_id == bill_id
                )
            )

            document_ids = list(
                db.scalars(
                    select(schema.RagSectionDocument.id).where(
                        schema.RagSectionDocument.bill_id == bill_id
                    )
                )
            )
            chunk_ids = list(
                db.scalars(
                    select(schema.RagChunk.id).where(
                        schema.RagChunk.rag_section_document_id.in_(document_ids)
                    )
                )
            )
            assert len(document_ids) == 3
            assert chunk_ids
            assert db.scalar(
                select(func.count(schema.RagChunkEmbedding.id)).where(
                    schema.RagChunkEmbedding.rag_chunk_id.in_(chunk_ids)
                )
            ) == len(chunk_ids)
        assert outside_call_count() == 0
    finally:
        _delete_bill(bill_key)


def test_rag_failure_rolls_back_every_repair_write(
    seed_database: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    bill_key = "test-2026-HF457902"
    bill_id, version_id, _parsed = _seed_partial_bill(bill_key, 457902)
    outside_call_count = _block_outside_model_calls(monkeypatch)
    real_build = rag_ingest.build_rag_rows_for_bill_keys
    reached_failure_after_all_writes = False

    def build_then_fail(db, bill_keys, **kwargs):
        nonlocal reached_failure_after_all_writes
        real_build(db, bill_keys, **kwargs)
        db.flush()
        changed_version = db.get(schema.BillVersion, version_id)
        assert changed_version is not None
        assert changed_version.change_role_parse_complete is True
        assert changed_version.appendix_parse_complete is True
        assert (
            db.scalar(
                select(func.count(schema.BillVersionSection.id)).where(
                    schema.BillVersionSection.bill_version_id == version_id
                )
            )
            == 3
        )
        assert (
            db.scalar(
                select(func.count(schema.BillSummaryRequest.id)).where(
                    schema.BillSummaryRequest.bill_id == bill_id
                )
            )
            == 1
        )
        assert (
            db.scalar(
                select(schema.BillSummaryRequest.status).where(
                    schema.BillSummaryRequest.bill_id == bill_id
                )
            )
            == schema.BillSummaryRequestStatus.ready
        )
        assert not db.scalar(
            select(schema.AIEnrichment.is_current).where(
                schema.AIEnrichment.bill_id == bill_id
            )
        )
        assert (
            db.scalar(
                select(func.count(schema.RagSectionDocument.id)).where(
                    schema.RagSectionDocument.bill_id == bill_id
                )
            )
            == 3
        )
        reached_failure_after_all_writes = True
        raise RuntimeError("forced search preparation failure")

    monkeypatch.setattr(rag_ingest, "build_rag_rows_for_bill_keys", build_then_fail)

    try:
        with pytest.raises(RuntimeError, match="forced search preparation failure"):
            _run_apply(monkeypatch, bill_key)

        assert reached_failure_after_all_writes is True
        with Session(get_engine()) as db:
            version = db.get(schema.BillVersion, version_id)
            assert version is not None
            sections = list(
                db.scalars(
                    select(schema.BillVersionSection)
                    .where(schema.BillVersionSection.bill_version_id == version_id)
                    .order_by(schema.BillVersionSection.source_order)
                )
            )
            assert [section.source_order for section in sections] == [1, 3]
            assert all(section.change_role_segments is None for section in sections)
            assert all(not section.change_role_parse_complete for section in sections)
            assert version.change_role_parser_version is None
            assert version.change_role_parse_complete is False
            assert version.appendix_parser_version is None
            assert version.appendix_source_hash is None
            assert version.appendix_parse_complete is False
            assert version.appendix_present is None
            assert (
                db.scalar(
                    select(func.count(schema.BillSummaryRequest.id)).where(
                        schema.BillSummaryRequest.bill_id == bill_id
                    )
                )
                == 0
            )
            assert db.scalar(
                select(schema.AIEnrichment.is_current).where(
                    schema.AIEnrichment.bill_id == bill_id
                )
            )
            assert (
                db.scalar(
                    select(func.count(schema.RagSectionDocument.id)).where(
                        schema.RagSectionDocument.bill_id == bill_id
                    )
                )
                == 0
            )
        assert outside_call_count() == 0
    finally:
        _delete_bill(bill_key)
