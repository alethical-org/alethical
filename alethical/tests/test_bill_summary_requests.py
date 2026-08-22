from __future__ import annotations

import hashlib
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Event
import time
from types import SimpleNamespace

import pytest
import requests
from sqlalchemy import create_engine, delete, event, func, select, text
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_engine, local_database_url
from alethical.pipeline import (
    ai_enrichment,
    anthropic_enrichment,
    oban_workers,
    rag as rag_text,
    rag_ingest,
)
from alethical.pipeline.bill_summary_requests import (
    SummaryAutomationLimits,
    _current_budget_cost,
    _month_start,
    _usage_cost_microusd,
    canonical_source_text_fingerprint,
    enqueue_ready_requests,
    mark_summary_requests_ready,
    reconcile_ready_requests,
    register_official_text_change,
    run_summary_request,
    summary_gap_rows,
)
from alethical.pipeline.minnesota import (
    APPENDIX_PARSER_VERSION,
    CHANGE_ROLE_PARSER_VERSION,
)
from scripts import load_minnesota_data as load_minnesota


def _text_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _change_role_hash(segments: list[dict[str, str]]) -> str:
    parts: list[str] = []
    for segment in segments:
        parts.extend([segment["role"], segment["text"]])
    return ai_enrichment.source_hash(parts)


def _set_complete_change_roles(
    section: schema.BillVersionSection,
    *,
    role: str = "carried_forward",
) -> None:
    segments = [{"role": role, "text": section.raw_text}]
    section.change_role_segments = segments
    section.change_role_source_hash = _change_role_hash(segments)
    section.change_role_parse_complete = True


def _set_appendix_coverage(
    version: schema.BillVersion,
    references: list[schema.BillVersionAppendixReference],
) -> None:
    parts = [f"appendix_present:{int(bool(version.appendix_present))}"]
    for reference in sorted(references, key=lambda item: item.source_order):
        parts.extend(
            [
                reference.reference_kind,
                reference.official_reference,
                reference.source_hash,
            ]
        )
    version.appendix_source_hash = ai_enrichment.source_hash(parts)


def _make_bill(
    db: Session,
    *,
    bill_key: str,
    file_number: int,
    source_orders: tuple[int, ...] = (1, 2),
    with_summary: bool = True,
) -> tuple[schema.Bill, schema.BillVersion]:
    session_id = db.scalar(select(schema.LegislativeSession.id))
    chamber_id = db.scalar(select(schema.Chamber.id))
    assert session_id is not None and chamber_id is not None
    bill = schema.Bill(
        session_id=session_id,
        chamber_id=chamber_id,
        bill_key=bill_key,
        file_type="HF",
        file_number=file_number,
        title="A bill for an act used by the summary request tests.",
    )
    db.add(bill)
    db.flush()
    version = schema.BillVersion(
        bill_id=bill.id,
        version_code="test-v1",
        sequence_number=1,
        is_current=True,
        appendix_parser_version=APPENDIX_PARSER_VERSION,
        appendix_parse_complete=True,
        appendix_present=False,
        change_role_parser_version=CHANGE_ROLE_PARSER_VERSION,
        change_role_parse_complete=True,
    )
    _set_appendix_coverage(version, [])
    db.add(version)
    db.flush()
    for source_order in source_orders:
        raw_text = f"Official section text at position {source_order}."
        section = schema.BillVersionSection(
            bill_version_id=version.id,
            section_id_text=f"laws.0.{source_order}.0",
            source_order=source_order,
            raw_text=raw_text,
            source_hash=_text_hash(raw_text),
        )
        _set_complete_change_roles(section)
        db.add(section)
    if with_summary:
        db.add(
            schema.AIEnrichment(
                bill_id=bill.id,
                bill_version_id=version.id,
                enrichment_type=schema.EnrichmentType.bill_summary,
                model_name="claude:claude-sonnet-5",
                source_version_hash="old-source",
                content_json={"short_title": "Old Plain Title"},
                is_current=True,
            )
        )
    db.flush()
    return bill, version


def _add_search_sections(db: Session, bill: schema.Bill, version: schema.BillVersion):
    sections = db.scalars(
        select(schema.BillVersionSection)
        .where(schema.BillVersionSection.bill_version_id == version.id)
        .order_by(schema.BillVersionSection.source_order)
    ).all()
    embedding_model = rag_ingest.effective_embedding_model(rag_ingest.DEFAULT_RAG_MODEL)
    for section in sections:
        prepared = rag_ingest._chunk_payloads(bill.file_type, bill.file_number, section)
        document = schema.RagSectionDocument(
            bill_id=bill.id,
            bill_version_id=version.id,
            bill_version_section_id=section.id,
            citation_label=prepared["citation_label"],
            clean_text=prepared["clean_text"],
            cleaning_version=rag_text.CLEANING_VERSION,
            source_hash=prepared["source_hash"],
            word_count=prepared["word_count"],
        )
        db.add(document)
        db.flush()
        for prepared_chunk in prepared["chunks"]:
            chunk = schema.RagChunk(
                rag_section_document_id=document.id,
                chunk_index=prepared_chunk["chunk_index"],
                citation_label=prepared_chunk["citation_label"],
                chunk_text=prepared_chunk["chunk_text"],
                search_text=prepared_chunk["search_text"],
                chunking_version=rag_text.CHUNKING_VERSION,
                word_count=prepared_chunk["word_count"],
                token_estimate=prepared_chunk["word_count"],
            )
            db.add(chunk)
            db.flush()
            db.add(
                schema.RagChunkEmbedding(
                    rag_chunk_id=chunk.id,
                    embedding_model=embedding_model,
                    embedding=rag_ingest._deterministic_embedding(
                        prepared_chunk["chunk_text"]
                    ),
                )
            )
    db.flush()


def _delete_bill(db: Session, bill_id) -> None:
    version_ids = list(
        db.scalars(
            select(schema.BillVersion.id).where(schema.BillVersion.bill_id == bill_id)
        )
    )
    rag_section_ids = select(schema.RagSectionDocument.id).where(
        schema.RagSectionDocument.bill_id == bill_id
    )
    rag_chunk_ids = select(schema.RagChunk.id).where(
        schema.RagChunk.rag_section_document_id.in_(rag_section_ids)
    )
    db.execute(
        delete(schema.RagChunkEmbedding).where(
            schema.RagChunkEmbedding.rag_chunk_id.in_(rag_chunk_ids)
        )
    )
    db.execute(
        delete(schema.RagChunk).where(
            schema.RagChunk.rag_section_document_id.in_(rag_section_ids)
        )
    )
    db.execute(
        delete(schema.RagSectionDocument).where(
            schema.RagSectionDocument.id.in_(rag_section_ids)
        )
    )
    db.execute(
        delete(schema.AIEnrichment).where(schema.AIEnrichment.bill_id == bill_id)
    )
    db.execute(
        delete(schema.BillSummaryRequest).where(
            schema.BillSummaryRequest.bill_id == bill_id
        )
    )
    if version_ids:
        db.execute(
            delete(schema.BillVersionAppendixReference).where(
                schema.BillVersionAppendixReference.bill_version_id.in_(version_ids)
            )
        )
        db.execute(
            delete(schema.BillVersionSection).where(
                schema.BillVersionSection.bill_version_id.in_(version_ids)
            )
        )
    db.execute(delete(schema.BillVersion).where(schema.BillVersion.bill_id == bill_id))
    db.execute(delete(schema.Bill).where(schema.Bill.id == bill_id))
    db.commit()


def _ready_request(
    db: Session, *, bill_key: str, file_number: int
) -> tuple[schema.Bill, schema.BillVersion, schema.BillSummaryRequest]:
    bill, version = _make_bill(db, bill_key=bill_key, file_number=file_number)
    request = register_official_text_change(db, bill)
    assert request is not None
    _add_search_sections(db, bill, version)
    assert mark_summary_requests_ready(db, [bill.bill_key]) == [request.id]
    db.commit()
    return bill, version, request


def _heading_only_pipeline_class(
    *,
    bill_id,
    version_id,
    new_heading: str,
    request_ids: list[uuid.UUID],
):
    class HeadingOnlyPipeline:
        def __init__(self, db):
            self.db = db

        def ingest_bills(self, _targets):
            bill = self.db.get(schema.Bill, bill_id)
            version = self.db.get(schema.BillVersion, version_id)
            section = self.db.scalar(
                select(schema.BillVersionSection)
                .where(schema.BillVersionSection.bill_version_id == version_id)
                .order_by(schema.BillVersionSection.source_order)
                .limit(1)
            )
            assert bill is not None and version is not None and section is not None
            raw_text = section.raw_text
            source_hash_value = section.source_hash
            section.section_heading = new_heading
            self.db.flush()
            assert section.raw_text == raw_text
            assert section.source_hash == source_hash_value
            request = register_official_text_change(self.db, bill)
            assert request is not None
            assert request.status == schema.BillSummaryRequestStatus.waiting_for_search
            request_ids.append(request.id)
            return {
                "bills_ingested": 1,
                "bill_keys": [bill.bill_key],
                "text_changed_bill_keys": [],
                "summary_changed_bill_keys": [bill.bill_key],
                "summary_request_ids": [str(request.id)],
            }

    return HeadingOnlyPipeline


def _enabled_limits() -> SummaryAutomationLimits:
    return SummaryAutomationLimits(
        enabled=True,
        monthly_budget_microusd=25_000_000,
        per_bill_budget_microusd=10_000_000,
        failure_cap=5,
        max_attempts=1,
    )


def _enable_automatic_summary_environment(monkeypatch) -> None:
    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_MONTHLY_BUDGET_CENTS", "2500")
    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_PER_BILL_BUDGET_CENTS", "1000")
    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_FAILURE_CAP", "5")
    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_MAX_ATTEMPTS", "1")


def _valid_summary() -> dict:
    return {
        "short_title": "Updated Official Duties",
        "summary": "Updates official duties.",
        "plain_language_summary": "Updates official duties using the saved text.",
        "key_points": ["Updates official duties."],
        "key_point_citations": [],
        "policy_areas": ["Government"],
        "confidence": "high",
        "question_prompts": ["What duties change?"],
    }


def _valid_cited_summary() -> dict:
    content = _valid_summary()
    content["key_point_citations"] = [
        {
            "point": "Updates official duties.",
            "section_id": "S1",
            "quote": "Official section text at position 1.",
        }
    ]
    return content


def _record_prior_request(
    db: Session,
    *,
    bill: schema.Bill,
    version: schema.BillVersion,
    label: str,
    status: schema.BillSummaryRequestStatus,
    actual_cost_microusd: int = 0,
) -> schema.BillSummaryRequest:
    request = schema.BillSummaryRequest(
        bill_id=bill.id,
        bill_version_id=version.id,
        source_text_fingerprint=hashlib.sha256(label.encode()).hexdigest(),
        prompt_context_version=ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION,
        prepared_prompt_fingerprint=hashlib.sha256(
            f"prepared:{label}".encode()
        ).hexdigest(),
        model_name="claude:claude-sonnet-5",
        status=status,
        provider_attempt_limit=1,
        provider_attempts=1,
        provider_call_started_at=datetime.now(UTC),
        provider_call_finished_at=datetime.now(UTC),
        actual_cost_microusd=actual_cost_microusd,
    )
    db.add(request)
    db.flush()
    return request


@pytest.mark.parametrize(
    ("raw_text", "segments", "expected_body"),
    [
        (
            "taxpayer",
            [
                {"role": "carried_forward", "text": "tax"},
                {"role": "added", "text": "payer"},
            ],
            "tax[+]payer[/+]",
        ),
        (
            "taxpayer",
            [
                {"role": "added", "text": "tax"},
                {"role": "carried_forward", "text": "payer"},
            ],
            "[+]tax[/+]payer",
        ),
        (
            "may not",
            [
                {"role": "carried_forward", "text": "may "},
                {"role": "deleted", "text": "not"},
            ],
            "may [-]not[/-]",
        ),
    ],
)
def test_proposed_change_roles_preserve_exact_inline_boundaries(
    raw_text: str,
    segments: list[dict[str, str]],
    expected_body: str,
) -> None:
    assert ai_enrichment.change_roles_match_raw_text(raw_text, segments)
    anchor = ai_enrichment.SectionAnchor(
        anchor_id="S1",
        label="Sec. 1",
        text=raw_text,
        source_hash=_text_hash(raw_text),
        section_id_text="1",
        change_role_segments=segments,
        change_role_source_hash=_change_role_hash(segments),
        change_role_parse_complete=True,
    )
    assert ai_enrichment._format_proposed_anchor(anchor).endswith(f"\n{expected_body}")


def test_proposed_change_role_proof_rejects_erased_whitespace() -> None:
    segments = [
        {"role": "carried_forward", "text": "may "},
        {"role": "added", "text": "not"},
    ]
    assert ai_enrichment.change_roles_match_raw_text("may not", segments)
    assert ai_enrichment.change_roles_match_raw_text(
        "Falls , South",
        [{"role": "carried_forward", "text": "Falls, South"}],
    )
    assert ai_enrichment.change_roles_match_raw_text(
        "CenterLicense",
        [
            {"role": "carried_forward", "text": "Center "},
            {"role": "added", "text": "License"},
        ],
    )
    assert not ai_enrichment.change_roles_match_raw_text(
        "tax payer",
        [{"role": "carried_forward", "text": "taxpayer"}],
    )
    assert not ai_enrichment.change_roles_match_raw_text(
        "may not",
        [{"role": "carried_forward", "text": "maynot"}],
    )


def test_same_official_text_creates_one_exact_request(seed_database: None) -> None:
    with Session(get_engine()) as db:
        bill, version = _make_bill(
            db, bill_key="test-2025-HF457001", file_number=457001
        )

        first = register_official_text_change(db, bill)
        assert first is not None
        second = register_official_text_change(db, bill)
        db.flush()

        assert first is not None and second is not None
        assert first.id == second.id
        assert first.bill_id == bill.id
        assert first.bill_version_id == version.id
        assert len(first.source_text_fingerprint) == 64
        assert (
            first.prompt_context_version
            == ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION
        )
        assert first.prepared_prompt_fingerprint == (
            ai_enrichment.prepared_prompt_fingerprint(db, bill, version)
        )
        assert first.status == schema.BillSummaryRequestStatus.waiting_for_search
        assert db.scalar(select(func.count(schema.BillSummaryRequest.id))) == 1
        assert not db.scalar(
            select(schema.AIEnrichment.is_current).where(
                schema.AIEnrichment.bill_id == bill.id
            )
        )
        db.rollback()


@pytest.mark.parametrize(
    "stored_meta",
    [
        None,
        {
            "prompt_context_version": "older-context",
            "prepared_prompt_fingerprint": "older-prepared-hash",
        },
    ],
)
def test_matching_source_hash_does_not_keep_summary_with_old_or_missing_prompt_meta(
    seed_database: None,
    stored_meta: dict[str, str] | None,
) -> None:
    with Session(get_engine()) as db:
        bill, version = _make_bill(
            db, bill_key="test-2025-HF457113", file_number=457113
        )
        summary = db.scalar(
            select(schema.AIEnrichment).where(
                schema.AIEnrichment.bill_id == bill.id,
                schema.AIEnrichment.enrichment_type
                == schema.EnrichmentType.bill_summary,
            )
        )
        prepared = ai_enrichment.prepared_prompt_fingerprint(db, bill, version)
        assert summary is not None and prepared is not None
        summary.source_version_hash = prepared
        summary.content_json = {
            "short_title": "Old prompt result",
            **({"_meta": stored_meta} if stored_meta is not None else {}),
        }
        db.flush()

        request = register_official_text_change(db, bill)
        db.flush()

        assert request is not None
        assert summary.is_current is False
        db.rollback()


def test_completed_old_prompt_context_does_not_block_one_new_exact_request(
    seed_database: None, monkeypatch
) -> None:
    current_context = ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION
    with Session(get_engine()) as db:
        bill, _version = _make_bill(
            db, bill_key="test-2025-HF457108", file_number=457108
        )
        monkeypatch.setattr(
            ai_enrichment,
            "BILL_SUMMARY_PROMPT_CONTEXT_VERSION",
            f"{current_context}-old",
        )
        old_request = register_official_text_change(db, bill)
        assert old_request is not None
        old_request.status = schema.BillSummaryRequestStatus.completed
        old_request.provider_call_started_at = datetime.now(UTC)
        old_request.provider_call_finished_at = datetime.now(UTC)
        old_request.provider_attempts = 1
        old_request.actual_cost_microusd = 1_234
        _add_search_sections(db, bill, _version)
        db.flush()

        monkeypatch.setattr(
            ai_enrichment, "BILL_SUMMARY_PROMPT_CONTEXT_VERSION", current_context
        )
        new_request = register_official_text_change(db, bill)
        duplicate = register_official_text_change(db, bill)
        db.flush()

        assert new_request is not None and duplicate is not None
        assert new_request.id == duplicate.id
        assert new_request.id != old_request.id
        assert new_request.prompt_context_version == current_context
        assert new_request.status == schema.BillSummaryRequestStatus.ready
        assert old_request.status == schema.BillSummaryRequestStatus.completed
        assert old_request.actual_cost_microusd == 1_234
        assert db.scalar(select(func.count(schema.BillSummaryRequest.id))) == 2
        gaps = summary_gap_rows(db, bill_key_prefix=bill.bill_key)
        assert len(gaps) == 1
        assert gaps[0].request_status == "ready"
        db.rollback()


def test_newer_text_supersedes_old_request_and_dedupes_itself(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, version = _make_bill(
            db, bill_key="test-2025-HF457002", file_number=457002
        )
        old_request = register_official_text_change(db, bill)
        assert old_request is not None
        stale_summary = db.scalar(
            select(schema.AIEnrichment).where(
                schema.AIEnrichment.bill_id == bill.id,
                schema.AIEnrichment.enrichment_type
                == schema.EnrichmentType.bill_summary,
            )
        )
        assert stale_summary is not None
        stale_summary.source_version_hash = None
        section = db.scalar(
            select(schema.BillVersionSection)
            .where(schema.BillVersionSection.bill_version_id == version.id)
            .order_by(schema.BillVersionSection.source_order)
            .limit(1)
        )
        assert section is not None
        section.raw_text = "The Legislature published newer official text."
        section.source_hash = _text_hash(section.raw_text)
        _set_complete_change_roles(section)
        db.flush()

        new_request = register_official_text_change(db, bill)
        duplicate = register_official_text_change(db, bill)
        db.flush()

        assert new_request is not None and duplicate is not None
        assert new_request.id == duplicate.id
        assert new_request.id != old_request.id
        assert old_request.status == schema.BillSummaryRequestStatus.superseded
        assert new_request.status == schema.BillSummaryRequestStatus.waiting_for_search
        assert db.scalar(select(func.count(schema.BillSummaryRequest.id))) == 2
        assert stale_summary.is_current is False
        db.rollback()


@pytest.mark.parametrize("start_ready", [False, True])
def test_unspent_request_is_reused_when_official_text_returns_to_its_fingerprint(
    seed_database: None,
    start_ready: bool,
) -> None:
    with Session(get_engine()) as db:
        bill, version = _make_bill(
            db,
            bill_key=f"test-2025-HF457103-{int(start_ready)}",
            file_number=457103 + int(start_ready),
        )
        section = db.scalar(
            select(schema.BillVersionSection)
            .where(schema.BillVersionSection.bill_version_id == version.id)
            .order_by(schema.BillVersionSection.source_order)
            .limit(1)
        )
        assert section is not None
        original_text = section.raw_text
        original_request = register_official_text_change(db, bill)
        assert original_request is not None
        if start_ready:
            _add_search_sections(db, bill, version)
            assert mark_summary_requests_ready(db, [bill.bill_key]) == [
                original_request.id
            ]

        section.raw_text = "Temporary newer official text."
        section.source_hash = _text_hash(section.raw_text)
        _set_complete_change_roles(section)
        db.flush()
        temporary_request = register_official_text_change(db, bill)
        assert temporary_request is not None
        assert temporary_request.id != original_request.id
        assert original_request.status == schema.BillSummaryRequestStatus.superseded

        section.raw_text = original_text
        section.source_hash = _text_hash(section.raw_text)
        _set_complete_change_roles(section)
        db.flush()
        returned_request = register_official_text_change(db, bill)
        assert returned_request is not None

        assert returned_request.id == original_request.id
        assert returned_request.status == (
            schema.BillSummaryRequestStatus.ready
            if start_ready
            else schema.BillSummaryRequestStatus.waiting_for_search
        )
        assert returned_request.provider_call_started_at is None
        assert returned_request.failure_kind is None
        assert temporary_request.status == schema.BillSummaryRequestStatus.superseded
        assert db.scalar(select(func.count(schema.BillSummaryRequest.id))) == 2
        if start_ready:
            assert mark_summary_requests_ready(db, [bill.bill_key]) == []
            assert returned_request.status == schema.BillSummaryRequestStatus.ready
        db.rollback()


def test_exact_context_cached_reapply_restores_completed_summary_without_provider(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, version, original_request = _ready_request(
            db, bill_key="test-2025-HF457104", file_number=457104
        )
        bill_id = bill.id
        version_id = version.id
        original_request_id = original_request.id

    provider_calls = 0

    def one_paid_call(*_args, **_kwargs):
        nonlocal provider_calls
        provider_calls += 1
        return _valid_cited_summary(), {
            "input_tokens": 100,
            "output_tokens": 200,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        }

    def forbidden_call(*_args, **_kwargs):
        raise AssertionError("an exact cached result must not call the provider again")

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        first_result = run_summary_request(
            local_database_url(),
            original_request_id,
            limits=_enabled_limits(),
            call_anthropic=one_paid_call,
        )
        assert first_result.outcome == "completed"

        with Session(get_engine()) as db:
            bill = db.get(schema.Bill, bill_id)
            section = db.scalar(
                select(schema.BillVersionSection)
                .where(schema.BillVersionSection.bill_version_id == version_id)
                .order_by(schema.BillVersionSection.source_order)
                .limit(1)
            )
            original_request = db.get(schema.BillSummaryRequest, original_request_id)
            assert bill is not None and section is not None
            assert original_request is not None
            first_summary = db.scalar(
                select(schema.AIEnrichment).where(
                    schema.AIEnrichment.bill_id == bill_id,
                    schema.AIEnrichment.enrichment_type
                    == schema.EnrichmentType.bill_summary,
                    schema.AIEnrichment.is_current.is_(True),
                )
            )
            assert first_summary is not None
            first_citations = [
                dict(citation)
                for citation in first_summary.content_json["key_point_citations"]
            ]
            assert first_citations == [
                {
                    "point": "Updates official duties.",
                    "section_id": "laws.0.1.0",
                    "label": "laws.0.1.0",
                    "quote": "Official section text at position 1.",
                }
            ]
            original_text = section.raw_text
            original_cost = original_request.actual_cost_microusd
            original_attempts = original_request.provider_attempts

            section.raw_text = "Temporary replacement text."
            section.source_hash = _text_hash(section.raw_text)
            _set_complete_change_roles(section)
            db.flush()
            temporary_request = register_official_text_change(db, bill)
            assert temporary_request is not None
            assert temporary_request.id != original_request_id

            section.raw_text = original_text
            section.source_hash = _text_hash(section.raw_text)
            _set_complete_change_roles(section)
            db.flush()
            returned_request = register_official_text_change(db, bill)
            db.commit()

            assert returned_request is not None
            assert returned_request.id == original_request_id
            assert returned_request.status == schema.BillSummaryRequestStatus.completed
            assert returned_request.provider_attempts == original_attempts
            assert returned_request.actual_cost_microusd == original_cost
            assert (
                temporary_request.status == schema.BillSummaryRequestStatus.superseded
            )
            current_summary = db.scalar(
                select(schema.AIEnrichment).where(
                    schema.AIEnrichment.bill_id == bill_id,
                    schema.AIEnrichment.enrichment_type
                    == schema.EnrichmentType.bill_summary,
                    schema.AIEnrichment.is_current.is_(True),
                )
            )
            assert current_summary is not None
            assert (
                current_summary.content_json["key_point_citations"] == first_citations
            )
            assert (
                returned_request.provider_response_json["key_point_citations"][0][
                    "section_id"
                ]
                == "S1"
            )

        repeated = run_summary_request(
            local_database_url(),
            original_request_id,
            limits=_enabled_limits(),
            call_anthropic=forbidden_call,
        )
        assert repeated.outcome == "completed"
        assert repeated.provider_attempts == 0
        assert provider_calls == 1
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_official_proposed_label_change_creates_one_new_source_request(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, version = _make_bill(
            db, bill_key="test-2025-HF457102", file_number=457102
        )
        old_request = register_official_text_change(db, bill)
        section = db.scalar(
            select(schema.BillVersionSection)
            .where(schema.BillVersionSection.bill_version_id == version.id)
            .order_by(schema.BillVersionSection.source_order)
            .limit(1)
        )
        assert old_request is not None and section is not None

        section.section_id_text = "laws.0.99.0"
        section.article_number = "ARTICLE 2"
        section.article_heading = "OFFICIAL ARTICLE HEADING"
        section.section_heading = "Sec. 1. OFFICIAL SECTION HEADING."
        db.flush()
        new_request = register_official_text_change(db, bill)
        duplicate = register_official_text_change(db, bill)

        assert new_request is not None and duplicate is not None
        assert new_request.id == duplicate.id
        assert new_request.id != old_request.id
        assert old_request.status == schema.BillSummaryRequestStatus.superseded
        assert db.scalar(select(func.count(schema.BillSummaryRequest.id))) == 2
        db.rollback()


def test_incomplete_official_text_retires_summary_without_request(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, _version = _make_bill(
            db,
            bill_key="test-2025-HF457003",
            file_number=457003,
            source_orders=(1, 3),
        )

        request = register_official_text_change(db, bill)
        db.flush()

        assert request is None
        assert db.scalar(select(func.count(schema.BillSummaryRequest.id))) == 0
        assert not db.scalar(
            select(schema.AIEnrichment.is_current).where(
                schema.AIEnrichment.bill_id == bill.id
            )
        )
        assert summary_gap_rows(db, bill_key_prefix=bill.bill_key) == []
        db.rollback()


def test_request_fingerprint_does_not_change_when_search_rows_arrive(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, version = _make_bill(
            db, bill_key="test-2025-HF457004", file_number=457004
        )
        before = canonical_source_text_fingerprint(db, bill, version)
        _add_search_sections(db, bill, version)
        after = canonical_source_text_fingerprint(db, bill, version)

        assert before == after
        assert before is not None and len(before) == 64
        db.rollback()


def test_full_summary_prompt_identity_ignores_mutable_display_metadata(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, version = _make_bill(
            db, bill_key="test-2025-HF457109", file_number=457109
        )
        original_prompt, original_hash, original_truncated = ai_enrichment.bill_prompt(
            db,
            bill,
            version,
            max_input_chars=ai_enrichment.PROPOSED_TEXT_CHAR_LIMIT,
        )

        bill.title = "A mutable corrected display title."
        bill.description = "A mutable status-page description."
        bill.current_status = "A mutable committee status."
        bill.latest_action_at = datetime(2026, 8, 22, tzinfo=UTC)
        bill.official_url = "https://example.test/mutable-official-url"
        version.version_code = "mutable-version-code"
        version.version_name = "A mutable version name"
        db.flush()

        changed_prompt, changed_hash, changed_truncated = ai_enrichment.bill_prompt(
            db,
            bill,
            version,
            max_input_chars=ai_enrichment.PROPOSED_TEXT_CHAR_LIMIT,
        )

        assert changed_prompt == original_prompt
        assert changed_hash == original_hash
        assert changed_truncated is original_truncated is False
        for mutable_value in (
            bill.title,
            bill.description,
            bill.current_status,
            bill.official_url,
            version.version_code,
            version.version_name,
        ):
            assert mutable_value not in changed_prompt
        for removed_key in (
            "current_status",
            "latest_action_at",
            "chief_sponsors",
            "official_url",
            "version_code",
            "version_name",
        ):
            assert f'"{removed_key}"' not in changed_prompt
        db.rollback()


def test_source_fingerprint_identifies_only_the_ordered_official_text(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        first_bill, first_version = _make_bill(
            db, bill_key="test-2025-HF457104", file_number=457104
        )
        second_bill, second_version = _make_bill(
            db, bill_key="test-2025-HF457204", file_number=457204
        )

        first = canonical_source_text_fingerprint(db, first_bill, first_version)
        second = canonical_source_text_fingerprint(db, second_bill, second_version)

        assert first == second
        assert first is not None and len(first) == 64
        db.rollback()


def test_request_becomes_ready_only_after_matching_search_sections(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, version = _make_bill(
            db, bill_key="test-2025-HF457005", file_number=457005
        )
        request = register_official_text_change(db, bill)
        assert request is not None

        assert mark_summary_requests_ready(db, [bill.bill_key]) == []
        assert request.status == schema.BillSummaryRequestStatus.waiting_for_search

        _add_search_sections(db, bill, version)
        ready_ids = mark_summary_requests_ready(db, [bill.bill_key])
        db.flush()

        assert ready_ids == [request.id]
        assert request.status == schema.BillSummaryRequestStatus.ready
        db.rollback()


def test_automatic_spending_is_off_until_every_limit_is_positive(
    monkeypatch,
) -> None:
    names = (
        "ALETHICAL_AUTO_BILL_SUMMARY_ENABLED",
        "ALETHICAL_AUTO_BILL_SUMMARY_MONTHLY_BUDGET_CENTS",
        "ALETHICAL_AUTO_BILL_SUMMARY_PER_BILL_BUDGET_CENTS",
        "ALETHICAL_AUTO_BILL_SUMMARY_FAILURE_CAP",
        "ALETHICAL_AUTO_BILL_SUMMARY_MAX_ATTEMPTS",
    )
    for name in names:
        monkeypatch.delenv(name, raising=False)
    assert SummaryAutomationLimits.from_environment().can_spend is False

    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_ENABLED", "true")
    assert SummaryAutomationLimits.from_environment().can_spend is False

    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_MONTHLY_BUDGET_CENTS", "2500")
    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_PER_BILL_BUDGET_CENTS", "1000")
    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_FAILURE_CAP", "5")
    monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_MAX_ATTEMPTS", "2")
    limits = SummaryAutomationLimits.from_environment()
    assert limits.can_spend is True
    assert limits.monthly_budget_microusd == 25_000_000
    assert limits.per_bill_budget_microusd == 10_000_000
    assert (
        SummaryAutomationLimits(
            enabled=True,
            monthly_budget_microusd=25_000_000,
            per_bill_budget_microusd=15_000_000,
            failure_cap=5,
            max_attempts=5,
        ).can_spend
        is False
    )


def test_sonnet_5_usage_cost_uses_the_permanent_current_prices() -> None:
    assert (
        _usage_cost_microusd(
            {
                "input_tokens": 1_000_000,
                "output_tokens": 1_000_000,
                "cache_creation_input_tokens": 1_000_000,
                "cache_read_input_tokens": 1_000_000,
            }
        )
        == 16_200_000
    )
    assert _usage_cost_microusd({"cache_read_input_tokens": 1}) == 1


def test_free_health_check_reports_complete_text_without_a_summary(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, _version = _make_bill(
            db, bill_key="test-2025-HF457006", file_number=457006
        )
        register_official_text_change(db, bill)
        db.flush()

        gaps = summary_gap_rows(db, bill_key_prefix="test-2025-HF457006")

        assert [gap.bill_key for gap in gaps] == [bill.bill_key]
        assert gaps[0].request_status == "waiting_for_search"
        db.rollback()


def test_free_health_check_uses_a_fixed_number_of_database_reads_as_bills_grow(
    seed_database: None,
) -> None:
    bill_ids = []
    with Session(get_engine()) as db:
        single, _version = _make_bill(
            db,
            bill_key="test-2025-HF457300-single",
            file_number=457300,
            with_summary=False,
        )
        bill_ids.append(single.id)
        for index in range(5):
            bill, _version = _make_bill(
                db,
                bill_key=f"test-2025-HF457301-many-{index}",
                file_number=457301 + index,
                with_summary=False,
            )
            bill_ids.append(bill.id)
        db.commit()

    def measured_reads(prefix: str) -> tuple[int, list]:
        statement_count = 0

        def count_statement(*_args) -> None:
            nonlocal statement_count
            statement_count += 1

        engine = get_engine()
        event.listen(engine, "before_cursor_execute", count_statement)
        try:
            with Session(engine) as db:
                gaps = summary_gap_rows(db, bill_key_prefix=prefix)
        finally:
            event.remove(engine, "before_cursor_execute", count_statement)
        return statement_count, gaps

    try:
        single_reads, single_gaps = measured_reads("test-2025-HF457300-single")
        many_reads, many_gaps = measured_reads("test-2025-HF457301-many-")

        assert len(single_gaps) == 1
        assert len(many_gaps) == 5
        assert many_reads <= single_reads + 1
        assert many_reads <= 8
    finally:
        for bill_id in bill_ids:
            with Session(get_engine()) as db:
                _delete_bill(db, bill_id)


def test_free_health_check_reports_a_stale_current_summary_context(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, version = _make_bill(
            db, bill_key="test-2025-HF457106", file_number=457106
        )
        summary = db.scalar(
            select(schema.AIEnrichment).where(
                schema.AIEnrichment.bill_id == bill.id,
                schema.AIEnrichment.enrichment_type
                == schema.EnrichmentType.bill_summary,
            )
        )
        prepared_hash = ai_enrichment.prepared_prompt_fingerprint(db, bill, version)
        assert summary is not None and prepared_hash is not None

        summary.source_version_hash = prepared_hash
        summary.content_json = {"short_title": "Missing saved prompt identity"}
        db.flush()
        gaps = summary_gap_rows(db, bill_key_prefix=bill.bill_key)
        assert len(gaps) == 1
        assert gaps[0].request_status == "outdated_prompt_context"

        summary.content_json = {
            "short_title": "Current saved prompt identity",
            "_meta": {
                "prompt_context_version": (
                    ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION
                ),
                "prepared_prompt_fingerprint": prepared_hash,
            },
        }
        db.flush()
        assert summary_gap_rows(db, bill_key_prefix=bill.bill_key) == []

        summary.source_version_hash = None
        db.flush()
        gaps = summary_gap_rows(db, bill_key_prefix=bill.bill_key)
        assert len(gaps) == 1
        assert gaps[0].request_status == "outdated_prompt_context"
        db.rollback()


def test_free_health_check_reports_legacy_complete_text_without_queueing_it(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, version = _make_bill(
            db,
            bill_key="test-2025-HF457110",
            file_number=457110,
            with_summary=False,
        )
        version.appendix_parser_version = None
        version.appendix_parse_complete = False
        version.appendix_source_hash = None
        version.change_role_parser_version = None
        version.change_role_parse_complete = False
        db.flush()

        gaps = summary_gap_rows(db, bill_key_prefix=bill.bill_key)

        assert len(gaps) == 1
        assert len(gaps[0].source_text_fingerprint) == 64
        assert gaps[0].request_status == "source_context_incomplete"
        assert register_official_text_change(db, bill) is None
        assert db.scalar(select(func.count(schema.BillSummaryRequest.id))) == 0
        db.rollback()


def test_concurrent_text_finalizers_still_create_one_request(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, _version = _make_bill(
            db, bill_key="test-2025-HF457007", file_number=457007
        )
        bill_id = bill.id
        db.commit()

    def register() -> str:
        with Session(get_engine()) as db:
            stored_bill = db.get(schema.Bill, bill_id)
            assert stored_bill is not None
            request = register_official_text_change(db, stored_bill)
            assert request is not None
            db.commit()
            return str(request.id)

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            request_ids = list(pool.map(lambda _value: register(), range(2)))
        assert len(set(request_ids)) == 1
        with Session(get_engine()) as db:
            assert (
                db.scalar(
                    select(func.count(schema.BillSummaryRequest.id)).where(
                        schema.BillSummaryRequest.bill_id == bill_id
                    )
                )
                == 1
            )
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_disabled_worker_never_calls_anthropic(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, _version, request = _ready_request(
            db, bill_key="test-2025-HF457008", file_number=457008
        )
        bill_id, request_id = bill.id, request.id
    called = False

    def forbidden_call(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("the off switch must stop before Anthropic")

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        result = run_summary_request(
            local_database_url(),
            request_id,
            limits=SummaryAutomationLimits(
                enabled=False,
                monthly_budget_microusd=10_000_000,
                per_bill_budget_microusd=1_000_000,
                failure_cap=5,
                max_attempts=1,
            ),
            call_anthropic=forbidden_call,
        )
        assert result.outcome == "disabled"
        assert called is False
        with Session(get_engine()) as db:
            stored = db.get(schema.BillSummaryRequest, request_id)
            assert stored is not None
            assert stored.status == schema.BillSummaryRequestStatus.ready
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


@pytest.mark.asyncio
async def test_ready_request_recovers_after_switch_was_off_when_job_ran(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, _version, request = _ready_request(
            db, bill_key="test-2025-HF457107", file_number=457107
        )
        bill_id, request_id = bill.id, request.id

    enqueued: list[str] = []

    async def record_enqueue(_worker, args):
        enqueued.append(str(args["request_id"]))
        return {"inserted": True, "task_key": args["task_key"]}

    try:
        monkeypatch.setattr(oban_workers, "_enqueue_child", record_enqueue)
        _enable_automatic_summary_environment(monkeypatch)
        first = await reconcile_ready_requests(database_url=local_database_url())

        monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_ENABLED", "false")
        disabled = run_summary_request(
            local_database_url(),
            request_id,
            call_anthropic=lambda *_args, **_kwargs: (_valid_summary(), {}),
        )
        while_off = await reconcile_ready_requests(database_url=local_database_url())

        monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_ENABLED", "true")
        recovered = await reconcile_ready_requests(database_url=local_database_url())

        assert disabled.outcome == "disabled"
        assert len(first) == 1
        assert while_off == []
        assert len(recovered) == 1
        assert enqueued == [str(request_id), str(request_id)]
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


@pytest.mark.asyncio
async def test_explicit_data_url_is_also_the_default_queue_destination(
    monkeypatch,
) -> None:
    _enable_automatic_summary_environment(monkeypatch)
    captured: list[dict] = []

    async def record_enqueue(_worker, args):
        captured.append(dict(args))
        return {"inserted": True, "task_key": args["task_key"]}

    monkeypatch.setattr(oban_workers, "_enqueue_child", record_enqueue)
    monkeypatch.setattr(
        "alethical.pipeline.bill_summary_requests._committed_ready_request_ids",
        lambda request_ids, **_kwargs: [str(value) for value in request_ids],
    )
    request_id = "00000000-0000-0000-0000-000000000457"
    remote_url = "postgresql://remote.example/alethical"

    await enqueue_ready_requests(
        [request_id],
        database_target="local",
        database_url=remote_url,
    )
    await enqueue_ready_requests(
        [request_id],
        database_target="local",
        database_url=remote_url,
        oban_target="production",
    )

    assert captured[0]["database_url"] == remote_url
    assert captured[0]["oban_dsn"] == remote_url
    assert captured[0]["oban_target"] is None
    assert captured[1]["database_url"] == remote_url
    assert captured[1]["oban_dsn"] is None
    assert captured[1]["oban_target"] == "production"


@pytest.mark.asyncio
async def test_enqueue_filters_supplied_ids_to_committed_ready_requests(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        ready_bill, _version, ready_request = _ready_request(
            db, bill_key="test-2025-HF457116", file_number=457116
        )
        waiting_bill, _version = _make_bill(
            db,
            bill_key="test-2025-HF457117",
            file_number=457117,
            with_summary=False,
        )
        waiting_request = register_official_text_change(db, waiting_bill)
        assert waiting_request is not None
        ready_bill_id = ready_bill.id
        waiting_bill_id = waiting_bill.id
        ready_request_id = ready_request.id
        waiting_request_id = waiting_request.id
        db.commit()

    enqueued: list[str] = []

    async def record_enqueue(_worker, args):
        enqueued.append(str(args["request_id"]))
        return {"inserted": True, "task_key": args["task_key"]}

    try:
        _enable_automatic_summary_environment(monkeypatch)
        monkeypatch.setattr(oban_workers, "_enqueue_child", record_enqueue)
        children = await enqueue_ready_requests(
            [waiting_request_id, ready_request_id],
            database_target="local",
            database_url=local_database_url(),
        )

        assert len(children) == 1
        assert enqueued == [str(ready_request_id)]
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, ready_bill_id)
        with Session(get_engine()) as db:
            _delete_bill(db, waiting_bill_id)


@pytest.mark.asyncio
async def test_oban_worker_passes_its_job_id_as_the_paid_claim_owner(
    monkeypatch,
) -> None:
    from alethical.pipeline import bill_summary_requests as request_module

    seen: dict[str, object] = {}
    request_id = uuid.uuid4()

    def record_claim(database_url, received_request_id, *, claim_job_id, **_kwargs):
        seen.update(
            database_url=database_url,
            request_id=received_request_id,
            claim_job_id=claim_job_id,
        )
        return SimpleNamespace(
            request_id=received_request_id,
            outcome="processing",
            provider_attempts=0,
            actual_cost_microusd=None,
            ready_successor_request_ids=(),
        )

    monkeypatch.setattr(request_module, "run_summary_request", record_claim)
    await oban_workers.BillSummaryRequestWorker().process(
        SimpleNamespace(
            id=457_117,
            args={
                "request_id": str(request_id),
                "database_url": local_database_url(),
            },
        )
    )

    assert seen == {
        "database_url": local_database_url(),
        "request_id": request_id,
        "claim_job_id": 457_117,
    }


@pytest.mark.asyncio
async def test_worker_enqueues_one_ready_successor_after_paid_a_becomes_stale(
    seed_database: None, monkeypatch
) -> None:
    from alethical.pipeline import bill_summary_requests as request_module

    original_run = request_module.run_summary_request
    with Session(get_engine()) as db:
        bill, version, request = _ready_request(
            db, bill_key="test-2025-HF457118", file_number=457118
        )
        bill_id, version_id, request_id = bill.id, version.id, request.id

    provider_calls = 0
    enqueue_attempts: list[dict[str, object]] = []
    active_jobs: dict[str, dict[str, object]] = {}

    def save_new_text_and_search_rows(*_args, **_kwargs):
        nonlocal provider_calls
        provider_calls += 1
        with Session(get_engine()) as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            section = db.scalar(
                select(schema.BillVersionSection)
                .where(schema.BillVersionSection.bill_version_id == version_id)
                .order_by(schema.BillVersionSection.source_order)
                .limit(1)
            )
            assert bill is not None and version is not None and section is not None
            section.raw_text = "New official text saved during the paid A call."
            section.source_hash = _text_hash(section.raw_text)
            _set_complete_change_roles(section)
            db.flush()
            rag_ingest._delete_bill_rag_rows(db, bill_id, version_id)
            _add_search_sections(db, bill, version)
            successor = register_official_text_change(db, bill)
            assert successor is not None
            assert successor.status == schema.BillSummaryRequestStatus.ready
            db.commit()
        return _valid_summary(), {"input_tokens": 100, "output_tokens": 200}

    def run_with_stub(database_url, received_request_id, *, claim_job_id):
        return original_run(
            database_url,
            received_request_id,
            limits=_enabled_limits(),
            call_anthropic=save_new_text_and_search_rows,
            claim_job_id=claim_job_id,
        )

    async def record_enqueue(_worker, args):
        copied = dict(args)
        enqueue_attempts.append(copied)
        task_key = str(copied["task_key"])
        if task_key in active_jobs:
            return {"inserted": False, "existing_job_id": 457_118_3}
        active_jobs[task_key] = copied
        return {"inserted": True, "job_id": 457_118_3}

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        monkeypatch.setattr(request_module, "run_summary_request", run_with_stub)
        monkeypatch.setattr(
            SummaryAutomationLimits,
            "from_environment",
            classmethod(lambda cls: _enabled_limits()),
        )
        monkeypatch.setattr(oban_workers, "_enqueue_child", record_enqueue)
        job_args = {
            "request_id": str(request_id),
            "database_url": local_database_url(),
        }

        await oban_workers.BillSummaryRequestWorker().process(
            SimpleNamespace(id=457_118_1, args=job_args)
        )
        await oban_workers.BillSummaryRequestWorker().process(
            SimpleNamespace(id=457_118_2, args=job_args)
        )

        assert provider_calls == 1
        assert len(enqueue_attempts) == 2
        assert len(active_jobs) == 1
        with Session(get_engine()) as db:
            requests = list(
                db.scalars(
                    select(schema.BillSummaryRequest)
                    .where(schema.BillSummaryRequest.bill_id == bill_id)
                    .order_by(schema.BillSummaryRequest.created_at)
                )
            )
            assert len(requests) == 2
            assert requests[0].status == schema.BillSummaryRequestStatus.superseded
            assert requests[1].status == schema.BillSummaryRequestStatus.ready
            active_job = next(iter(active_jobs.values()))
            assert active_job["request_id"] == str(requests[1].id)
            assert active_job["task_key"] == f"bill-summary-request:{requests[1].id}"
            assert active_job["database_url"] == local_database_url()
            assert active_job["oban_dsn"] == local_database_url()
            assert active_job["oban_target"] is None
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


@pytest.mark.asyncio
async def test_bill_sync_heading_only_change_rebuilds_search_and_hands_off_once(
    seed_database: None, monkeypatch
) -> None:
    bill_key = "test-2025-HF457119"
    with Session(get_engine()) as db:
        bill, version = _make_bill(db, bill_key=bill_key, file_number=457119)
        _add_search_sections(db, bill, version)
        section = db.scalar(
            select(schema.BillVersionSection)
            .where(schema.BillVersionSection.bill_version_id == version.id)
            .order_by(schema.BillVersionSection.source_order)
            .limit(1)
        )
        assert section is not None
        bill_id, version_id, section_id = bill.id, version.id, section.id
        original_raw_text = section.raw_text
        original_source_hash = section.source_hash
        db.commit()

    request_ids: list[uuid.UUID] = []
    enqueued: list[list[str]] = []

    async def capture_enqueue(values, **_kwargs):
        request_values = [str(value) for value in values]
        enqueued.append(request_values)
        return [{"request_id": value} for value in request_values]

    try:
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-never-called")
        monkeypatch.setattr(
            rag_ingest,
            "_build_embeddings",
            lambda texts, **_kwargs: [
                rag_ingest._deterministic_embedding(value) for value in texts
            ],
        )
        monkeypatch.setattr(
            "alethical.pipeline.minnesota.MinnesotaIngestionPipeline",
            _heading_only_pipeline_class(
                bill_id=bill_id,
                version_id=version_id,
                new_heading="A NEW OFFICIAL SECTION HEADING",
                request_ids=request_ids,
            ),
        )
        monkeypatch.setattr(
            oban_workers,
            "_resolve_rag_write_url",
            lambda _args: local_database_url(),
        )
        monkeypatch.setattr(
            "alethical.pipeline.bill_summary_requests.enqueue_ready_requests",
            capture_enqueue,
        )

        record = await oban_workers.BillSyncChunkWorker().process(
            SimpleNamespace(
                args={
                    "targets": [
                        {
                            "chamber": "house",
                            "bill_number": "457119",
                            "session_code": "0942025",
                        }
                    ],
                    "dry_run": False,
                    "allow_writes": True,
                    "include_rag": True,
                    "rag_target": "production",
                    "database_target": "local",
                    "database_url": local_database_url(),
                }
            )
        )

        assert len(request_ids) == 1
        assert enqueued == [[str(request_ids[0])]]
        assert record.value["rag_built"] == 1
        assert record.value["summary_children"] == [{"request_id": str(request_ids[0])}]
        with Session(get_engine()) as db:
            section = db.get(schema.BillVersionSection, section_id)
            request = db.get(schema.BillSummaryRequest, request_ids[0])
            search = db.scalar(
                select(schema.RagSectionDocument).where(
                    schema.RagSectionDocument.bill_version_section_id == section_id
                )
            )
            assert section is not None and request is not None and search is not None
            assert section.raw_text == original_raw_text
            assert section.source_hash == original_source_hash
            assert request.status == schema.BillSummaryRequestStatus.ready
            assert "A NEW OFFICIAL SECTION HEADING" in search.citation_label
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_direct_loader_heading_only_change_rebuilds_search_and_hands_off_once(
    seed_database: None, monkeypatch
) -> None:
    bill_key = "test-2025-HF457120"
    with Session(get_engine()) as db:
        bill, version = _make_bill(db, bill_key=bill_key, file_number=457120)
        _add_search_sections(db, bill, version)
        section = db.scalar(
            select(schema.BillVersionSection)
            .where(schema.BillVersionSection.bill_version_id == version.id)
            .order_by(schema.BillVersionSection.source_order)
            .limit(1)
        )
        assert section is not None
        bill_id, version_id, section_id = bill.id, version.id, section.id
        original_raw_text = section.raw_text
        original_source_hash = section.source_hash
        db.commit()

    request_ids: list[uuid.UUID] = []
    enqueued: list[list[str]] = []

    async def capture_enqueue(values, **_kwargs):
        request_values = [str(value) for value in values]
        enqueued.append(request_values)
        return [{"request_id": value} for value in request_values]

    try:
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.setattr(
            rag_ingest,
            "_build_embeddings",
            lambda texts, **_kwargs: [
                rag_ingest._deterministic_embedding(value) for value in texts
            ],
        )
        monkeypatch.setattr(
            load_minnesota,
            "MinnesotaIngestionPipeline",
            _heading_only_pipeline_class(
                bill_id=bill_id,
                version_id=version_id,
                new_heading="A DIRECT LOADER OFFICIAL HEADING",
                request_ids=request_ids,
            ),
        )
        monkeypatch.setattr(
            "alethical.pipeline.bill_summary_requests.enqueue_ready_requests",
            capture_enqueue,
        )
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "load_minnesota_data.py",
                "--database-url",
                local_database_url(),
                "--skip-legislators",
                "--bill",
                "HF457120",
            ],
        )

        load_minnesota.main()

        assert len(request_ids) == 1
        assert enqueued == [[str(request_ids[0])]]
        with Session(get_engine()) as db:
            section = db.get(schema.BillVersionSection, section_id)
            request = db.get(schema.BillSummaryRequest, request_ids[0])
            search = db.scalar(
                select(schema.RagSectionDocument).where(
                    schema.RagSectionDocument.bill_version_section_id == section_id
                )
            )
            assert section is not None and request is not None and search is not None
            assert section.raw_text == original_raw_text
            assert section.source_hash == original_source_hash
            assert request.status == schema.BillSummaryRequestStatus.ready
            assert "A DIRECT LOADER OFFICIAL HEADING" in search.citation_label
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_direct_loader_remote_production_target_fails_closed_without_openai_key(
    seed_database: None, monkeypatch
) -> None:
    bill_key = "test-2025-HF457123"
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ALETHICAL_DATABASE_TARGET", raising=False)
    with Session(get_engine()) as db:
        bill, version = _make_bill(db, bill_key=bill_key, file_number=457123)
        _add_search_sections(db, bill, version)
        section = db.scalar(
            select(schema.BillVersionSection)
            .where(schema.BillVersionSection.bill_version_id == version.id)
            .order_by(schema.BillVersionSection.source_order)
            .limit(1)
        )
        assert section is not None
        document_ids = tuple(
            db.scalars(
                select(schema.RagSectionDocument.id)
                .where(schema.RagSectionDocument.bill_id == bill.id)
                .order_by(schema.RagSectionDocument.id)
            )
        )
        chunk_ids = tuple(
            db.scalars(
                select(schema.RagChunk.id)
                .where(schema.RagChunk.rag_section_document_id.in_(document_ids))
                .order_by(schema.RagChunk.id)
            )
        )
        embedding_ids = tuple(
            db.scalars(
                select(schema.RagChunkEmbedding.id)
                .where(schema.RagChunkEmbedding.rag_chunk_id.in_(chunk_ids))
                .order_by(schema.RagChunkEmbedding.id)
            )
        )
        assert document_ids and chunk_ids and embedding_ids
        bill_id, version_id, section_id = bill.id, version.id, section.id
        original_heading = section.section_heading
        db.commit()

    request_ids: list[uuid.UUID] = []
    monkeypatch.setattr(
        load_minnesota,
        "MinnesotaIngestionPipeline",
        _heading_only_pipeline_class(
            bill_id=bill_id,
            version_id=version_id,
            new_heading="A PRODUCTION HEADING THAT MUST ROLL BACK",
            request_ids=request_ids,
        ),
    )
    monkeypatch.setattr(
        load_minnesota, "create_engine", lambda *_args, **_kwargs: get_engine()
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "load_minnesota_data.py",
            "--target",
            "production",
            "--database-url",
            "postgresql+psycopg://remote.example/production",
            "--skip-legislators",
            "--bill",
            "HF457123",
        ],
    )

    try:
        with pytest.raises(RuntimeError, match="OPENAI_API_KEY is required"):
            load_minnesota.main()

        assert len(request_ids) == 1
        with Session(get_engine()) as db:
            section = db.get(schema.BillVersionSection, section_id)
            request = db.get(schema.BillSummaryRequest, request_ids[0])
            assert section is not None
            assert section.section_heading == original_heading
            assert request is None
            assert (
                tuple(
                    db.scalars(
                        select(schema.RagSectionDocument.id)
                        .where(schema.RagSectionDocument.bill_id == bill_id)
                        .order_by(schema.RagSectionDocument.id)
                    )
                )
                == document_ids
            )
            assert (
                tuple(
                    db.scalars(
                        select(schema.RagChunk.id)
                        .where(
                            schema.RagChunk.rag_section_document_id.in_(document_ids)
                        )
                        .order_by(schema.RagChunk.id)
                    )
                )
                == chunk_ids
            )
            assert (
                tuple(
                    db.scalars(
                        select(schema.RagChunkEmbedding.id)
                        .where(schema.RagChunkEmbedding.rag_chunk_id.in_(chunk_ids))
                        .order_by(schema.RagChunkEmbedding.id)
                    )
                )
                == embedding_ids
            )
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_direct_loader_refuses_remote_url_without_production_target(
    monkeypatch,
) -> None:
    monkeypatch.delenv("ALETHICAL_DATABASE_TARGET", raising=False)
    monkeypatch.setattr(
        load_minnesota,
        "create_engine",
        lambda *_args, **_kwargs: pytest.fail(
            "target validation must happen before opening the remote database"
        ),
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "load_minnesota_data.py",
            "--database-url",
            "postgresql+psycopg://remote.example/production",
            "--skip-legislators",
            "--skip-bills",
        ],
    )

    with pytest.raises(RuntimeError, match="target=local.*database is remote"):
        load_minnesota.main()


@pytest.mark.asyncio
async def test_default_rag_role_only_change_survives_production_key_outage(
    seed_database: None, monkeypatch
) -> None:
    bill_key = "test-2025-HF457122"
    monkeypatch.setenv("OPENAI_API_KEY", "sk-label-only-never-called")
    with Session(get_engine()) as db:
        bill, version = _make_bill(db, bill_key=bill_key, file_number=457122)
        _add_search_sections(db, bill, version)
        section = db.scalar(
            select(schema.BillVersionSection)
            .where(schema.BillVersionSection.bill_version_id == version.id)
            .order_by(schema.BillVersionSection.source_order)
            .limit(1)
        )
        assert section is not None
        document_ids = tuple(
            db.scalars(
                select(schema.RagSectionDocument.id)
                .where(schema.RagSectionDocument.bill_id == bill.id)
                .order_by(schema.RagSectionDocument.id)
            )
        )
        chunk_ids = tuple(
            db.scalars(
                select(schema.RagChunk.id)
                .where(schema.RagChunk.rag_section_document_id.in_(document_ids))
                .order_by(schema.RagChunk.id)
            )
        )
        embedding_ids = tuple(
            db.scalars(
                select(schema.RagChunkEmbedding.id)
                .where(schema.RagChunkEmbedding.rag_chunk_id.in_(chunk_ids))
                .order_by(schema.RagChunkEmbedding.id)
            )
        )
        assert document_ids and chunk_ids and embedding_ids
        bill_id, section_id = bill.id, section.id
        original_raw_text = section.raw_text
        original_source_hash = section.source_hash
        db.commit()

    saved_request_ids: list[uuid.UUID] = []

    class SavesOnlyLegalRoles:
        def __init__(self, db):
            self.db = db

        def ingest_bills(self, _targets):
            bill = self.db.get(schema.Bill, bill_id)
            section = self.db.get(schema.BillVersionSection, section_id)
            assert bill is not None and section is not None
            _set_complete_change_roles(section, role="added")
            self.db.flush()
            assert section.raw_text == original_raw_text
            assert section.source_hash == original_source_hash
            request = register_official_text_change(self.db, bill)
            assert request is not None
            saved_request_ids.append(request.id)
            return {
                "bills_ingested": 1,
                "bill_keys": [bill.bill_key],
                "text_changed_bill_keys": [],
                "summary_changed_bill_keys": [bill.bill_key],
                "summary_request_ids": [str(request.id)],
            }

    def forbidden_embedding_call(*_args, **_kwargs):
        raise AssertionError("matching production search rows need no model call")

    try:
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.delenv("ALETHICAL_DATABASE_TARGET", raising=False)
        monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_ENABLED", "false")
        monkeypatch.setattr(
            "alethical.pipeline.minnesota.MinnesotaIngestionPipeline",
            SavesOnlyLegalRoles,
        )
        monkeypatch.setattr(
            oban_workers,
            "_resolve_rag_write_url",
            lambda _args: local_database_url(),
        )
        monkeypatch.setattr(rag_ingest, "_build_embeddings", forbidden_embedding_call)

        record = await oban_workers.BillSyncChunkWorker().process(
            SimpleNamespace(
                args={
                    "targets": [
                        {
                            "chamber": "house",
                            "bill_number": "457122",
                            "session_code": "0942025",
                        }
                    ],
                    "dry_run": False,
                    "allow_writes": True,
                    "rag_target": "production",
                    "database_target": "production",
                    "database_url": local_database_url(),
                }
            )
        )

        assert len(saved_request_ids) == 1
        assert record.value["rag_built"] == 0
        assert record.value["rag_already_exists"] == 1
        assert record.value["summary_children"] == []
        with Session(get_engine()) as db:
            request = db.get(schema.BillSummaryRequest, saved_request_ids[0])
            section = db.get(schema.BillVersionSection, section_id)
            assert request is not None and section is not None
            assert request.status == schema.BillSummaryRequestStatus.ready
            assert section.raw_text == original_raw_text
            assert section.source_hash == original_source_hash
            assert (
                tuple(
                    db.scalars(
                        select(schema.RagSectionDocument.id)
                        .where(schema.RagSectionDocument.bill_id == bill_id)
                        .order_by(schema.RagSectionDocument.id)
                    )
                )
                == document_ids
            )
            assert (
                tuple(
                    db.scalars(
                        select(schema.RagChunk.id)
                        .where(
                            schema.RagChunk.rag_section_document_id.in_(document_ids)
                        )
                        .order_by(schema.RagChunk.id)
                    )
                )
                == chunk_ids
            )
            assert (
                tuple(
                    db.scalars(
                        select(schema.RagChunkEmbedding.id)
                        .where(schema.RagChunkEmbedding.rag_chunk_id.in_(chunk_ids))
                        .order_by(schema.RagChunkEmbedding.id)
                    )
                )
                == embedding_ids
            )
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


@pytest.mark.asyncio
async def test_search_skipped_production_target_without_openai_key_commits_waiting_request(
    seed_database: None, monkeypatch
) -> None:
    bill_key = "test-2025-HF457121"
    with Session(get_engine()) as db:
        bill, version = _make_bill(db, bill_key=bill_key, file_number=457121)
        bill_id, version_id = bill.id, version.id
        db.commit()

    saved_request_ids: list[uuid.UUID] = []

    class SavesTextWithoutSearch:
        def __init__(self, db):
            self.db = db

        def ingest_bills(self, _targets):
            bill = self.db.get(schema.Bill, bill_id)
            section = self.db.scalar(
                select(schema.BillVersionSection)
                .where(schema.BillVersionSection.bill_version_id == version_id)
                .order_by(schema.BillVersionSection.source_order)
                .limit(1)
            )
            assert bill is not None and section is not None
            section.raw_text = "New official text saved while search is unavailable."
            section.source_hash = _text_hash(section.raw_text)
            _set_complete_change_roles(section)
            self.db.flush()
            request = register_official_text_change(self.db, bill)
            assert request is not None
            assert request.status == schema.BillSummaryRequestStatus.waiting_for_search
            saved_request_ids.append(request.id)
            return {
                "bills_ingested": 1,
                "bill_keys": [bill.bill_key],
                "text_changed_bill_keys": [bill.bill_key],
                "summary_changed_bill_keys": [bill.bill_key],
                "summary_request_ids": [str(request.id)],
            }

    def forbidden_model_or_embedding(*_args, **_kwargs):
        raise AssertionError("search-skipped ingestion must make no model call")

    try:
        monkeypatch.setenv("ALETHICAL_DATABASE_TARGET", "production")
        monkeypatch.setenv("ALETHICAL_AUTO_BILL_SUMMARY_ENABLED", "false")
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.setattr(
            "alethical.pipeline.minnesota.MinnesotaIngestionPipeline",
            SavesTextWithoutSearch,
        )
        monkeypatch.setattr(
            rag_ingest, "effective_embedding_model", forbidden_model_or_embedding
        )
        monkeypatch.setattr(
            rag_ingest, "_build_embeddings", forbidden_model_or_embedding
        )

        record = await oban_workers.BillSyncChunkWorker().process(
            SimpleNamespace(
                args={
                    "targets": [
                        {
                            "chamber": "house",
                            "bill_number": "457121",
                            "session_code": "0942025",
                        }
                    ],
                    "dry_run": False,
                    "allow_writes": True,
                    "include_rag": False,
                    "database_target": "production",
                    "database_url": local_database_url(),
                }
            )
        )

        assert len(saved_request_ids) == 1
        assert record.value["summary_children"] == []
        with Session(get_engine()) as db:
            request = db.get(schema.BillSummaryRequest, saved_request_ids[0])
            section = db.scalar(
                select(schema.BillVersionSection)
                .where(schema.BillVersionSection.bill_version_id == version_id)
                .order_by(schema.BillVersionSection.source_order)
                .limit(1)
            )
            assert request is not None and section is not None
            assert request.status == schema.BillSummaryRequestStatus.waiting_for_search
            assert section.raw_text == (
                "New official text saved while search is unavailable."
            )
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


@pytest.mark.asyncio
async def test_ready_request_recovers_after_job_found_no_api_key(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, _version, request = _ready_request(
            db, bill_key="test-2025-HF457108", file_number=457108
        )
        bill_id, request_id = bill.id, request.id

    enqueued: list[str] = []

    async def record_enqueue(_worker, args):
        enqueued.append(str(args["request_id"]))
        return {"inserted": True, "task_key": args["task_key"]}

    try:
        monkeypatch.setattr(oban_workers, "_enqueue_child", record_enqueue)
        _enable_automatic_summary_environment(monkeypatch)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-present-for-enqueue-test")
        first = await reconcile_ready_requests(database_url=local_database_url())

        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        missing_key = run_summary_request(local_database_url(), request_id)

        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-restored-for-enqueue-test")
        recovered = await reconcile_ready_requests(database_url=local_database_url())

        assert missing_key.outcome == "missing_api_key"
        assert len(first) == 1
        assert len(recovered) == 1
        assert enqueued == [str(request_id), str(request_id)]
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


@pytest.mark.asyncio
async def test_ready_request_reconciliation_waits_for_the_database_commit(
    seed_database: None, monkeypatch
) -> None:
    enqueued: list[str] = []

    async def record_enqueue(_worker, args):
        enqueued.append(str(args["request_id"]))
        return {"inserted": True, "task_key": args["task_key"]}

    monkeypatch.setattr(oban_workers, "_enqueue_child", record_enqueue)
    _enable_automatic_summary_environment(monkeypatch)
    with Session(get_engine()) as db:
        bill, version = _make_bill(
            db, bill_key="test-2025-HF457109", file_number=457109
        )
        request = register_official_text_change(db, bill)
        assert request is not None
        _add_search_sections(db, bill, version)
        assert mark_summary_requests_ready(db, [bill.bill_key]) == [request.id]
        db.flush()
        bill_id, request_id = bill.id, request.id

        before_commit = await reconcile_ready_requests(
            database_url=local_database_url()
        )
        db.commit()

    try:
        after_commit = await reconcile_ready_requests(
            database_url=local_database_url()
        )
        assert before_commit == []
        assert len(after_commit) == 1
        assert enqueued == [str(request_id)]
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_worker_stops_before_anthropic_when_monthly_ceiling_is_exhausted(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, _version, request = _ready_request(
            db, bill_key="test-2025-HF457011", file_number=457011
        )
        prior_bill, prior_version = _make_bill(
            db,
            bill_key="test-2025-HF457111",
            file_number=457111,
            with_summary=False,
        )
        _record_prior_request(
            db,
            bill=prior_bill,
            version=prior_version,
            label="the monthly budget was already spent on another bill",
            status=schema.BillSummaryRequestStatus.completed,
            actual_cost_microusd=500_000,
        )
        db.commit()
        bill_id, prior_bill_id, request_id = bill.id, prior_bill.id, request.id
    calls: list[str] = []

    def forbidden_call(*_args, **_kwargs):
        calls.append("called")
        raise AssertionError("the monthly ceiling must stop before Anthropic")

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        result = run_summary_request(
            local_database_url(),
            request_id,
            limits=SummaryAutomationLimits(
                enabled=True,
                monthly_budget_microusd=2_500_000,
                per_bill_budget_microusd=2_500_000,
                failure_cap=5,
                max_attempts=1,
            ),
            call_anthropic=forbidden_call,
        )

        assert result.outcome == "monthly_budget_cap"
        assert calls == []
        with Session(get_engine()) as db:
            stored = db.get(schema.BillSummaryRequest, request_id)
            assert stored is not None
            assert stored.status == schema.BillSummaryRequestStatus.ready
            assert stored.failure_kind == "monthly_budget_cap"
            assert stored.provider_call_started_at is None
            assert stored.provider_attempts == 0
            assert stored.reserved_cost_microusd == 0
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)
        with Session(get_engine()) as db:
            _delete_bill(db, prior_bill_id)


def test_worker_per_bill_ceiling_includes_paid_attempts_from_older_months(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, version, request = _ready_request(
            db, bill_key="test-2025-HF457012", file_number=457012
        )
        prior_request = _record_prior_request(
            db,
            bill=bill,
            version=version,
            label="an earlier summary call used part of this bill's allowance",
            status=schema.BillSummaryRequestStatus.completed,
            actual_cost_microusd=100_001,
        )
        prior_request.provider_call_started_at = datetime(2020, 1, 1, tzinfo=UTC)
        prior_request.provider_call_finished_at = datetime(2020, 1, 1, tzinfo=UTC)
        db.commit()
        bill_id, request_id = bill.id, request.id
    calls: list[str] = []

    def forbidden_call(*_args, **_kwargs):
        calls.append("called")
        raise AssertionError("the per-bill ceiling must stop before Anthropic")

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        result = run_summary_request(
            local_database_url(),
            request_id,
            limits=SummaryAutomationLimits(
                enabled=True,
                monthly_budget_microusd=2_500_000,
                per_bill_budget_microusd=2_500_000,
                failure_cap=5,
                max_attempts=1,
            ),
            call_anthropic=forbidden_call,
        )

        assert result.outcome == "per_bill_budget_cap"
        assert calls == []
        with Session(get_engine()) as db:
            stored = db.get(schema.BillSummaryRequest, request_id)
            assert stored is not None
            assert stored.status == schema.BillSummaryRequestStatus.ready
            assert stored.failure_kind == "per_bill_budget_cap"
            assert stored.provider_call_started_at is None
            assert stored.provider_attempts == 0
            assert stored.reserved_cost_microusd == 0
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_worker_stops_before_anthropic_when_monthly_failure_cap_is_reached(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, _version, request = _ready_request(
            db, bill_key="test-2025-HF457013", file_number=457013
        )
        failed_bill, failed_version = _make_bill(
            db,
            bill_key="test-2025-HF457113",
            file_number=457113,
            with_summary=False,
        )
        _record_prior_request(
            db,
            bill=failed_bill,
            version=failed_version,
            label="the monthly failure cap was reached on another bill",
            status=schema.BillSummaryRequestStatus.failed,
        )
        db.commit()
        bill_id, failed_bill_id, request_id = bill.id, failed_bill.id, request.id
    calls: list[str] = []

    def forbidden_call(*_args, **_kwargs):
        calls.append("called")
        raise AssertionError("the failure cap must stop before Anthropic")

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        result = run_summary_request(
            local_database_url(),
            request_id,
            limits=SummaryAutomationLimits(
                enabled=True,
                monthly_budget_microusd=10_000_000,
                per_bill_budget_microusd=2_500_000,
                failure_cap=1,
                max_attempts=1,
            ),
            call_anthropic=forbidden_call,
        )

        assert result.outcome == "failure_cap"
        assert calls == []
        with Session(get_engine()) as db:
            stored = db.get(schema.BillSummaryRequest, request_id)
            assert stored is not None
            assert stored.status == schema.BillSummaryRequestStatus.ready
            assert stored.failure_kind == "monthly_failure_cap"
            assert stored.provider_call_started_at is None
            assert stored.provider_attempts == 0
            assert stored.reserved_cost_microusd == 0
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)
        with Session(get_engine()) as db:
            _delete_bill(db, failed_bill_id)


def test_inflight_request_reserves_one_failure_slot(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        first_bill, _version, first_request = _ready_request(
            db, bill_key="test-2025-HF457128", file_number=457128
        )
        second_bill, _version, second_request = _ready_request(
            db, bill_key="test-2025-HF457129", file_number=457129
        )
        first_bill_id = first_bill.id
        second_bill_id = second_bill.id
        first_request_id = first_request.id
        second_request_id = second_request.id

    provider_started = Event()
    release_provider = Event()
    provider_calls: list[str] = []

    def held_call(*_args, **_kwargs):
        provider_calls.append("first")
        provider_started.set()
        assert release_provider.wait(timeout=10)
        return _valid_summary(), {"input_tokens": 100, "output_tokens": 200}

    def forbidden_call(*_args, **_kwargs):
        provider_calls.append("second")
        raise AssertionError("an in-flight call must reserve the last failure slot")

    limits = SummaryAutomationLimits(
        enabled=True,
        monthly_budget_microusd=25_000_000,
        per_bill_budget_microusd=10_000_000,
        failure_cap=1,
        max_attempts=1,
    )
    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(
                run_summary_request,
                local_database_url(),
                first_request_id,
                limits=limits,
                call_anthropic=held_call,
            )
            assert provider_started.wait(timeout=10)
            second = pool.submit(
                run_summary_request,
                local_database_url(),
                second_request_id,
                limits=limits,
                call_anthropic=forbidden_call,
            )
            second_result = second.result(timeout=10)
            release_provider.set()
            first_result = first.result(timeout=10)

        assert first_result.outcome == "completed"
        assert second_result.outcome == "failure_cap"
        assert provider_calls == ["first"]
    finally:
        release_provider.set()
        with Session(get_engine()) as db:
            _delete_bill(db, first_bill_id)
        with Session(get_engine()) as db:
            _delete_bill(db, second_bill_id)


def test_worker_waits_for_inflight_text_save_before_claiming_paid_request(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, version, request = _ready_request(
            db, bill_key="test-2025-HF457114", file_number=457114
        )
        bill_id, version_id, request_id = bill.id, version.id, request.id

    provider_calls: list[str] = []
    audit_engine = create_engine(local_database_url(), pool_pre_ping=True)

    def forbidden_call(*_args, **_kwargs):
        provider_calls.append("called")
        raise AssertionError("the worker must see the committed replacement first")

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        with Session(get_engine()) as ingest_db:
            bill = ingest_db.scalar(
                select(schema.Bill).where(schema.Bill.id == bill_id).with_for_update()
            )
            section = ingest_db.scalar(
                select(schema.BillVersionSection)
                .where(schema.BillVersionSection.bill_version_id == version_id)
                .order_by(schema.BillVersionSection.source_order)
                .limit(1)
            )
            assert bill is not None and section is not None
            section.raw_text = "New official text saved while the worker was waiting."
            section.source_hash = _text_hash(section.raw_text)
            _set_complete_change_roles(section)
            ingest_db.flush()
            blocker_pid = ingest_db.scalar(select(func.pg_backend_pid()))
            assert blocker_pid is not None

            with ThreadPoolExecutor(max_workers=1) as pool:
                worker = pool.submit(
                    run_summary_request,
                    local_database_url(),
                    request_id,
                    limits=_enabled_limits(),
                    call_anthropic=forbidden_call,
                )
                deadline = time.monotonic() + 5
                waiting_on_bill = False
                while time.monotonic() < deadline and not worker.done():
                    with Session(audit_engine) as audit_db:
                        waiting_on_bill = bool(
                            audit_db.scalar(
                                text(
                                    "SELECT EXISTS ("
                                    "SELECT 1 FROM pg_stat_activity "
                                    "WHERE :blocker_pid = ANY(pg_blocking_pids(pid))"
                                    ")"
                                ),
                                {"blocker_pid": blocker_pid},
                            )
                        )
                    if waiting_on_bill:
                        break
                    time.sleep(0.01)

                replacement = register_official_text_change(ingest_db, bill)
                assert replacement is not None and replacement.id != request_id
                ingest_db.commit()
                result = worker.result(timeout=10)

        assert result.outcome == "superseded"
        assert waiting_on_bill
        assert provider_calls == []
        with Session(get_engine()) as db:
            requests = list(
                db.scalars(
                    select(schema.BillSummaryRequest)
                    .where(schema.BillSummaryRequest.bill_id == bill_id)
                    .order_by(schema.BillSummaryRequest.created_at)
                )
            )
            assert len(requests) == 2
            assert requests[0].provider_attempts == 0
            assert requests[0].status == schema.BillSummaryRequestStatus.superseded
            assert (
                requests[1].status == schema.BillSummaryRequestStatus.waiting_for_search
            )
    finally:
        audit_engine.dispose()
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_provider_timeout_is_terminal_ambiguous_without_an_automatic_retry(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, _version, request = _ready_request(
            db, bill_key="test-2025-HF457014", file_number=457014
        )
        bill_id, request_id = bill.id, request.id
    post_calls = 0

    def timeout(*_args, **_kwargs):
        nonlocal post_calls
        post_calls += 1
        raise requests.exceptions.Timeout("provider outcome is unknown")

    limits = SummaryAutomationLimits(
        enabled=True,
        monthly_budget_microusd=20_000_000,
        per_bill_budget_microusd=10_000_000,
        failure_cap=5,
        max_attempts=4,
    )
    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        monkeypatch.setattr(anthropic_enrichment.requests, "post", timeout)

        result = run_summary_request(local_database_url(), request_id, limits=limits)
        repeated = run_summary_request(local_database_url(), request_id, limits=limits)

        assert result.outcome == "ambiguous"
        assert result.provider_attempts == 1
        assert repeated.outcome == "ambiguous"
        assert post_calls == 1
        with Session(get_engine()) as db:
            stored = db.get(schema.BillSummaryRequest, request_id)
            assert stored is not None
            assert stored.status == schema.BillSummaryRequestStatus.ambiguous
            assert stored.failure_kind == "ambiguous_transport"
            assert stored.provider_attempt_limit == 4
            assert stored.provider_attempts == 1
            assert stored.provider_call_started_at is not None
            assert stored.provider_call_finished_at is not None
            assert stored.actual_cost_microusd is None
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_restart_after_paid_claim_becomes_terminal_without_second_provider_call(
    seed_database: None, monkeypatch
) -> None:
    claim_job_id = 457_115
    with Session(get_engine()) as db:
        bill, _version, request = _ready_request(
            db, bill_key="test-2025-HF457115", file_number=457115
        )
        bill_id, request_id = bill.id, request.id
        request.status = schema.BillSummaryRequestStatus.processing
        request.provider_call_started_at = datetime.now(UTC)
        request.provider_claim_job_id = claim_job_id
        request.provider_attempt_limit = 1
        request.reserved_cost_microusd = 2_500_000
        db.commit()

    provider_calls = 0

    def forbidden_call(*_args, **_kwargs):
        nonlocal provider_calls
        provider_calls += 1
        raise AssertionError("a restarted claimed request must never call again")

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        first = run_summary_request(
            local_database_url(),
            request_id,
            limits=_enabled_limits(),
            call_anthropic=forbidden_call,
            claim_job_id=claim_job_id,
        )
        second = run_summary_request(
            local_database_url(),
            request_id,
            limits=_enabled_limits(),
            call_anthropic=forbidden_call,
            claim_job_id=claim_job_id,
        )

        assert first.outcome == "ambiguous"
        assert second.outcome == "ambiguous"
        assert provider_calls == 0
        with Session(get_engine()) as db:
            request = db.get(schema.BillSummaryRequest, request_id)
            assert request is not None
            assert request.status == schema.BillSummaryRequestStatus.ambiguous
            assert request.failure_kind == "provider_call_already_started"
            assert request.provider_claim_job_id == claim_job_id
            assert request.provider_call_finished_at is not None
            gaps = summary_gap_rows(db, bill_key_prefix="test-2025-HF457115")
            assert len(gaps) == 1
            assert gaps[0].request_status == "ambiguous"
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_distinct_jobs_cannot_steal_a_live_paid_claim(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, _version, request = _ready_request(
            db, bill_key="test-2025-HF457116", file_number=457116
        )
        bill_id, request_id = bill.id, request.id

    provider_started = Event()
    allow_provider_return = Event()
    provider_calls = 0

    def blocking_provider(*_args, **_kwargs):
        nonlocal provider_calls
        provider_calls += 1
        provider_started.set()
        assert allow_provider_return.wait(timeout=10)
        return _valid_summary(), {
            "input_tokens": 10,
            "output_tokens": 5,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        }

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        with ThreadPoolExecutor(max_workers=2) as executor:
            first_future = executor.submit(
                run_summary_request,
                local_database_url(),
                request_id,
                limits=_enabled_limits(),
                call_anthropic=blocking_provider,
                claim_job_id=457_116_1,
            )
            assert provider_started.wait(timeout=10)
            second = run_summary_request(
                local_database_url(),
                request_id,
                limits=_enabled_limits(),
                call_anthropic=blocking_provider,
                claim_job_id=457_116_2,
            )
            allow_provider_return.set()
            first = first_future.result(timeout=10)

        assert first.outcome == "completed"
        assert second.outcome == "processing"
        assert provider_calls == 1
        with Session(get_engine()) as db:
            stored = db.get(schema.BillSummaryRequest, request_id)
            assert stored is not None
            assert stored.status == schema.BillSummaryRequestStatus.completed
            assert stored.provider_claim_job_id == 457_116_1
            assert (
                db.scalar(
                    select(func.count(schema.AIEnrichment.id)).where(
                        schema.AIEnrichment.bill_id == bill_id,
                        schema.AIEnrichment.enrichment_type
                        == schema.EnrichmentType.bill_summary,
                        schema.AIEnrichment.is_current.is_(True),
                    )
                )
                == 1
            )
    finally:
        allow_provider_return.set()
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_worker_reuses_full_prompt_and_safe_apply_path(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, _version, request = _ready_request(
            db, bill_key="test-2025-HF457009", file_number=457009
        )
        request.prompt_context_version = "older-prompt-context"
        request.prepared_prompt_fingerprint = _text_hash("older prepared prompt")
        db.commit()
        bill_id, request_id = bill.id, request.id
    sent: dict = {}

    real_apply = ai_enrichment.apply_full_summary

    def capture_apply(db, item, content, *, provider_batch_id):
        sent["custom_id"] = item.custom_id
        sent["source_version_hash"] = item.source_version_hash
        sent["prompt_context_version"] = item.prompt_context_version
        sent["prepared_prompt_fingerprint"] = item.prepared_prompt_fingerprint
        return real_apply(db, item, content, provider_batch_id=provider_batch_id)

    def fake_call(_key, model, system, user, max_tokens, **kwargs):
        sent.update(
            {
                "model": model,
                "system": system,
                "user": user,
                "max_tokens": max_tokens,
                "max_attempts": kwargs["max_attempts"],
                "retry_ambiguous": kwargs["retry_ambiguous"],
            }
        )
        return _valid_summary(), {"input_tokens": 100, "output_tokens": 200}

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        monkeypatch.setattr(ai_enrichment, "apply_full_summary", capture_apply)
        result = run_summary_request(
            local_database_url(),
            request_id,
            limits=_enabled_limits(),
            call_anthropic=fake_call,
        )

        assert result.outcome == "completed"
        assert sent["model"] == "claude-sonnet-5"
        assert "Official section text" in sent["user"]
        assert sent["max_attempts"] == 1
        assert sent["retry_ambiguous"] is False
        with Session(get_engine()) as db:
            stored = db.get(schema.BillSummaryRequest, request_id)
            summary = db.scalar(
                select(schema.AIEnrichment).where(
                    schema.AIEnrichment.bill_id == bill_id,
                    schema.AIEnrichment.enrichment_type
                    == schema.EnrichmentType.bill_summary,
                    schema.AIEnrichment.is_current.is_(True),
                )
            )
            assert stored is not None and summary is not None
            assert stored.status == schema.BillSummaryRequestStatus.completed
            assert stored.provider_attempts == 1
            assert stored.actual_cost_microusd == 2_200
            assert (
                stored.prompt_context_version
                == ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION
            )
            assert stored.prepared_prompt_fingerprint == sent["source_version_hash"]
            assert (
                sent["prompt_context_version"]
                == ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION
            )
            assert sent["prepared_prompt_fingerprint"] == sent["source_version_hash"]
            assert sent["source_version_hash"] in sent["custom_id"]
            assert (
                db.scalar(
                    select(func.count(schema.BillSummaryRequest.id)).where(
                        schema.BillSummaryRequest.bill_id == bill_id
                    )
                )
                == 1
            )
            assert summary.content_json["short_title"] == "Updated Official Duties"

            stored_bill = db.get(schema.Bill, bill_id)
            assert stored_bill is not None
            same_request = register_official_text_change(db, stored_bill)
            db.flush()
            assert same_request is not None and same_request.id == request_id
            db.expire(summary)
            assert summary.is_current is True
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


@pytest.mark.parametrize(
    "usage",
    [
        {},
        {
            "input_tokens": -1,
            "output_tokens": 200,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        },
    ],
)
def test_missing_or_invalid_paid_usage_keeps_the_conservative_reservation(
    seed_database: None, monkeypatch, usage: dict
) -> None:
    file_number = 457105 + int(bool(usage))
    with Session(get_engine()) as db:
        bill, _version, request = _ready_request(
            db,
            bill_key=f"test-2025-HF{file_number}",
            file_number=file_number,
        )
        bill_id, request_id = bill.id, request.id

    def response_without_trustworthy_usage(*_args, **_kwargs):
        return _valid_summary(), usage

    limits = SummaryAutomationLimits(
        enabled=True,
        monthly_budget_microusd=4_000_000,
        per_bill_budget_microusd=2_500_000,
        failure_cap=5,
        max_attempts=1,
    )
    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        result = run_summary_request(
            local_database_url(),
            request_id,
            limits=limits,
            call_anthropic=response_without_trustworthy_usage,
        )

        assert result.outcome == "completed"
        assert result.provider_attempts == 1
        assert result.actual_cost_microusd is None
        with Session(get_engine()) as db:
            stored = db.get(schema.BillSummaryRequest, request_id)
            assert stored is not None
            assert stored.provider_attempts == 1
            assert stored.actual_cost_microusd is None
            assert stored.reserved_cost_microusd == 2_500_000
            assert (
                _current_budget_cost(db, since=_month_start(datetime.now(UTC)))
                >= 2_500_000
            )
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_paid_request_history_survives_source_version_and_bill_deletion(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, version = _make_bill(
            db,
            bill_key="test-2025-HF457107",
            file_number=457107,
        )
        request = _record_prior_request(
            db,
            bill=bill,
            version=version,
            label="paid source that is later cleaned",
            status=schema.BillSummaryRequestStatus.completed,
            actual_cost_microusd=123_456,
        )
        bill_id = bill.id
        version_id = version.id
        request_id = request.id
        since = _month_start(datetime.now(UTC))
        cost_before = _current_budget_cost(db, since=since)

        db.execute(
            delete(schema.AIEnrichment).where(schema.AIEnrichment.bill_id == bill_id)
        )
        db.execute(
            delete(schema.BillVersionSection).where(
                schema.BillVersionSection.bill_version_id == version_id
            )
        )
        db.execute(
            delete(schema.BillVersion).where(schema.BillVersion.id == version_id)
        )
        db.flush()

        assert db.get(schema.BillSummaryRequest, request_id) is not None
        assert _current_budget_cost(db, since=since) == cost_before

        db.execute(delete(schema.Bill).where(schema.Bill.id == bill_id))
        db.flush()

        assert db.get(schema.BillSummaryRequest, request_id) is not None
        assert _current_budget_cost(db, since=since) == cost_before
        db.rollback()


def test_cited_inflight_a_to_b_to_a_reuses_paid_response_without_provider(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, version, request = _ready_request(
            db, bill_key="test-2025-HF457010", file_number=457010
        )
        bill_id, version_id, old_request_id = bill.id, version.id, request.id
        original_text = db.scalar(
            select(schema.BillVersionSection.raw_text)
            .where(schema.BillVersionSection.bill_version_id == version.id)
            .order_by(schema.BillVersionSection.source_order)
            .limit(1)
        )
        assert original_text is not None

    provider_calls = 0

    def change_text_during_call(*_args, **_kwargs):
        nonlocal provider_calls
        provider_calls += 1
        with Session(get_engine()) as db:
            bill = db.get(schema.Bill, bill_id)
            section = db.scalar(
                select(schema.BillVersionSection)
                .where(schema.BillVersionSection.bill_version_id == version_id)
                .order_by(schema.BillVersionSection.source_order)
                .limit(1)
            )
            assert bill is not None and section is not None
            section.raw_text = "A newer official text arrived during generation."
            section.source_hash = _text_hash(section.raw_text)
            _set_complete_change_roles(section)
            db.flush()
            register_official_text_change(db, bill)
            db.commit()
        return _valid_cited_summary(), {"input_tokens": 100, "output_tokens": 200}

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        result = run_summary_request(
            local_database_url(),
            old_request_id,
            limits=_enabled_limits(),
            call_anthropic=change_text_during_call,
        )

        assert result.outcome == "superseded"
        with Session(get_engine()) as db:
            requests = list(
                db.scalars(
                    select(schema.BillSummaryRequest)
                    .where(schema.BillSummaryRequest.bill_id == bill_id)
                    .order_by(schema.BillSummaryRequest.created_at)
                )
            )
            current = db.scalar(
                select(schema.AIEnrichment).where(
                    schema.AIEnrichment.bill_id == bill_id,
                    schema.AIEnrichment.is_current.is_(True),
                )
            )
            assert len(requests) == 2
            assert requests[0].status == schema.BillSummaryRequestStatus.superseded
            assert requests[0].provider_attempts == 1
            assert (
                requests[0].provider_response_json["key_point_citations"][0][
                    "section_id"
                ]
                == "S1"
            )
            assert (
                requests[1].status == schema.BillSummaryRequestStatus.waiting_for_search
            )
            assert current is None

            bill = db.get(schema.Bill, bill_id)
            section = db.scalar(
                select(schema.BillVersionSection)
                .where(schema.BillVersionSection.bill_version_id == version_id)
                .order_by(schema.BillVersionSection.source_order)
                .limit(1)
            )
            assert bill is not None and section is not None
            section.raw_text = original_text
            section.source_hash = _text_hash(section.raw_text)
            _set_complete_change_roles(section)
            db.flush()
            returned_request = register_official_text_change(db, bill)
            db.flush()

            assert returned_request is not None
            assert returned_request.id == old_request_id
            assert returned_request.status == schema.BillSummaryRequestStatus.completed
            assert requests[1].status == schema.BillSummaryRequestStatus.superseded
            current = db.scalar(
                select(schema.AIEnrichment).where(
                    schema.AIEnrichment.bill_id == bill_id,
                    schema.AIEnrichment.enrichment_type
                    == schema.EnrichmentType.bill_summary,
                    schema.AIEnrichment.is_current.is_(True),
                )
            )
            assert current is not None
            assert current.content_json["key_point_citations"] == [
                {
                    "point": "Updates official duties.",
                    "section_id": "laws.0.1.0",
                    "label": "laws.0.1.0",
                    "quote": "Official section text at position 1.",
                }
            ]
            assert provider_calls == 1
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_mutable_display_metadata_change_during_call_does_not_strand_result(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, version, request = _ready_request(
            db, bill_key="test-2025-HF457110", file_number=457110
        )
        bill_id, version_id, request_id = bill.id, version.id, request.id

    def change_only_display_metadata(*_args, **_kwargs):
        with Session(get_engine()) as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            assert bill is not None and version is not None
            bill.title = "A corrected display title during generation."
            bill.description = "A corrected display description during generation."
            bill.current_status = "A corrected display status during generation."
            bill.latest_action_at = datetime(2026, 8, 22, tzinfo=UTC)
            bill.official_url = "https://example.test/corrected-display-url"
            version.version_code = "corrected-display-version-code"
            version.version_name = "Corrected display version name"
            db.commit()
        return _valid_summary(), {"input_tokens": 100, "output_tokens": 200}

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        result = run_summary_request(
            local_database_url(),
            request_id,
            limits=_enabled_limits(),
            call_anthropic=change_only_display_metadata,
        )

        assert result.outcome == "completed"
        with Session(get_engine()) as db:
            requests = list(
                db.scalars(
                    select(schema.BillSummaryRequest).where(
                        schema.BillSummaryRequest.bill_id == bill_id
                    )
                )
            )
            current = db.scalar(
                select(schema.AIEnrichment).where(
                    schema.AIEnrichment.bill_id == bill_id,
                    schema.AIEnrichment.enrichment_type
                    == schema.EnrichmentType.bill_summary,
                    schema.AIEnrichment.is_current.is_(True),
                )
            )
            assert len(requests) == 1
            assert requests[0].status == schema.BillSummaryRequestStatus.completed
            assert requests[0].provider_attempts == 1
            assert current is not None
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_prompt_context_change_during_paid_call_creates_one_ready_replacement(
    seed_database: None, monkeypatch
) -> None:
    original_context = ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION
    newer_context = f"{original_context}-newer"
    with Session(get_engine()) as db:
        bill, _version, request = _ready_request(
            db, bill_key="test-2025-HF457111", file_number=457111
        )
        bill_id, request_id = bill.id, request.id

    def change_prompt_contract(*_args, **_kwargs):
        monkeypatch.setattr(
            ai_enrichment, "BILL_SUMMARY_PROMPT_CONTEXT_VERSION", newer_context
        )
        return _valid_summary(), {"input_tokens": 100, "output_tokens": 200}

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        result = run_summary_request(
            local_database_url(),
            request_id,
            limits=_enabled_limits(),
            call_anthropic=change_prompt_contract,
        )

        assert result.outcome == "superseded"
        with Session(get_engine()) as db:
            bill = db.get(schema.Bill, bill_id)
            assert bill is not None
            requests = list(
                db.scalars(
                    select(schema.BillSummaryRequest)
                    .where(schema.BillSummaryRequest.bill_id == bill_id)
                    .order_by(schema.BillSummaryRequest.created_at)
                )
            )
            assert len(requests) == 2
            assert requests[0].status == schema.BillSummaryRequestStatus.superseded
            assert requests[0].provider_attempts == 1
            assert requests[1].prompt_context_version == newer_context
            assert requests[1].status == schema.BillSummaryRequestStatus.ready
            assert requests[1].provider_call_started_at is None
            assert result.ready_successor_request_ids == (requests[1].id,)
            duplicate = register_official_text_change(db, bill)
            assert duplicate is not None and duplicate.id == requests[1].id
            assert (
                db.scalar(
                    select(func.count(schema.BillSummaryRequest.id)).where(
                        schema.BillSummaryRequest.bill_id == bill_id
                    )
                )
                == 2
            )
            assert not db.scalar(
                select(func.count(schema.AIEnrichment.id)).where(
                    schema.AIEnrichment.bill_id == bill_id,
                    schema.AIEnrichment.is_current.is_(True),
                )
            )
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_source_fingerprint_requires_complete_change_roles_and_appendix_context(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, version = _make_bill(
            db, bill_key="test-2025-HF457015", file_number=457015
        )
        section = db.scalar(
            select(schema.BillVersionSection)
            .where(schema.BillVersionSection.bill_version_id == version.id)
            .order_by(schema.BillVersionSection.source_order)
            .limit(1)
        )
        assert section is not None
        original = canonical_source_text_fingerprint(db, bill, version)
        assert original is not None

        original_raw_hash = section.source_hash
        section.source_hash = _text_hash("text that was not saved")
        assert canonical_source_text_fingerprint(db, bill, version) is None
        section.source_hash = original_raw_hash

        version.change_role_parser_version = "older-change-role-parser"
        assert canonical_source_text_fingerprint(db, bill, version) is None
        version.change_role_parser_version = CHANGE_ROLE_PARSER_VERSION

        section.change_role_parse_complete = False
        assert canonical_source_text_fingerprint(db, bill, version) is None
        section.change_role_parse_complete = True
        _set_complete_change_roles(section, role="added")
        role_changed = canonical_source_text_fingerprint(db, bill, version)
        assert role_changed is not None and role_changed != original

        version.appendix_parse_complete = False
        assert canonical_source_text_fingerprint(db, bill, version) is None
        version.appendix_parse_complete = True
        version.appendix_parser_version = "older-appendix-parser"
        assert canonical_source_text_fingerprint(db, bill, version) is None
        version.appendix_parser_version = APPENDIX_PARSER_VERSION

        appendix_text = "Old law that the proposal explicitly repeals."
        reference = schema.BillVersionAppendixReference(
            bill_version_id=version.id,
            source_order=1,
            reference_kind="repealed_statute",
            official_reference="123.45 OLD LAW.",
            raw_text=appendix_text,
            source_hash=_text_hash(appendix_text),
        )
        db.add(reference)
        version.appendix_present = True
        _set_appendix_coverage(version, [reference])
        db.flush()
        appendix_added = canonical_source_text_fingerprint(db, bill, version)
        assert appendix_added is not None and appendix_added != role_changed

        reference.official_reference = "123.45 RENAMED OLD LAW."
        _set_appendix_coverage(version, [reference])
        db.flush()
        relabeled = canonical_source_text_fingerprint(db, bill, version)
        assert relabeled is not None and relabeled != appendix_added

        reference.source_hash = _text_hash("text that was not saved")
        assert canonical_source_text_fingerprint(db, bill, version) is None
        db.rollback()


def test_linked_empty_appendix_placeholder_is_complete_but_empty_proposed_text_is_not(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, version = _make_bill(
            db, bill_key="test-2025-HF457016", file_number=457016
        )
        sections = list(
            db.scalars(
                select(schema.BillVersionSection)
                .where(schema.BillVersionSection.bill_version_id == version.id)
                .order_by(schema.BillVersionSection.source_order)
            )
        )
        proposed, empty_appendix = sections
        empty_appendix.raw_text = ""
        empty_appendix.source_hash = _text_hash("")
        reference = schema.BillVersionAppendixReference(
            bill_version_id=version.id,
            bill_version_section_id=empty_appendix.id,
            source_order=1,
            reference_kind="repealed_session_law",
            official_reference="Laws 2024, chapter 79, article 1, section 15",
            source_hash=_text_hash(""),
        )
        db.add(reference)
        version.appendix_present = True
        _set_appendix_coverage(version, [reference])
        db.flush()

        fingerprint = canonical_source_text_fingerprint(db, bill, version)
        assert fingerprint is not None
        request = schema.BillSummaryRequest(
            bill_id=bill.id,
            bill_version_id=version.id,
            source_text_fingerprint=fingerprint,
            prompt_context_version=ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION,
            prepared_prompt_fingerprint=ai_enrichment.prepared_prompt_fingerprint(
                db, bill, version
            ),
            model_name="claude:claude-sonnet-5",
            status=schema.BillSummaryRequestStatus.waiting_for_search,
        )
        db.add(request)
        _add_search_sections(db, bill, version)

        assert mark_summary_requests_ready(db, [bill.bill_key]) == [request.id]
        empty_document = db.scalar(
            select(schema.RagSectionDocument).where(
                schema.RagSectionDocument.bill_version_section_id == empty_appendix.id
            )
        )
        assert empty_document is not None
        assert empty_document.clean_text == ""

        proposed.raw_text = ""
        proposed.source_hash = _text_hash("")
        assert canonical_source_text_fingerprint(db, bill, version) is None
        db.rollback()


@pytest.mark.parametrize(
    ("gate", "failure_kind"),
    [
        ("context", "source_context_incomplete"),
        ("missing_gate", "source_context_incomplete"),
        ("proposed", "proposed_lane_over_limit"),
        ("appendix", "appendix_lane_over_limit"),
        ("combined", "combined_lanes_over_limit"),
        ("request", "whole_request_over_limit"),
    ],
)
def test_worker_refuses_incomplete_or_over_limit_prompt_before_anthropic(
    seed_database: None,
    monkeypatch,
    gate: str,
    failure_kind: str,
) -> None:
    file_number = 457020 + [
        "context",
        "missing_gate",
        "proposed",
        "appendix",
        "combined",
        "request",
    ].index(gate)
    with Session(get_engine()) as db:
        bill, _version, request = _ready_request(
            db,
            bill_key=f"test-2025-HF{file_number}",
            file_number=file_number,
        )
        bill_id, request_id = bill.id, request.id

    measured: dict[str, int] = {}

    def refused_measurement(*_args, **kwargs):
        measured.update(kwargs)
        result = {
            "proposed": {"truncated": False, "over_limit": False},
            "appendix": {"truncated": False, "over_limit": False},
            "combined": {"over_limit": False},
            "request": {"over_limit": False},
            "is_complete": True,
            "refusal_reasons": [],
        }
        if gate == "context":
            result["is_complete"] = False
            result["refusal_reasons"] = ["source_context_incomplete"]
        elif gate == "missing_gate":
            del result["request"]
        elif gate in {"proposed", "appendix"}:
            result[gate]["over_limit"] = True
            result["refusal_reasons"] = [failure_kind]
        else:
            result[gate]["over_limit"] = True
            result["refusal_reasons"] = [failure_kind]
        return result

    def forbidden_call(*_args, **_kwargs):
        raise AssertionError("a refused prompt must not call Anthropic")

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        monkeypatch.setattr(
            ai_enrichment, "bill_prompt_measurement", refused_measurement
        )
        result = run_summary_request(
            local_database_url(),
            request_id,
            limits=_enabled_limits(),
            call_anthropic=forbidden_call,
        )

        assert result.outcome == "prompt_refused"
        assert measured == {
            "max_proposed_chars": ai_enrichment.PROPOSED_TEXT_CHAR_LIMIT,
            "max_appendix_chars": ai_enrichment.APPENDIX_TEXT_CHAR_LIMIT,
            "max_combined_chars": ai_enrichment.COMBINED_TEXT_CHAR_LIMIT,
            "max_request_chars": ai_enrichment.WHOLE_REQUEST_CHAR_LIMIT,
        }
        with Session(get_engine()) as db:
            stored = db.get(schema.BillSummaryRequest, request_id)
            assert stored is not None
            assert stored.status == schema.BillSummaryRequestStatus.failed
            assert stored.failure_kind == failure_kind
            assert stored.provider_call_started_at is None
            assert stored.provider_attempts == 0
            assert stored.reserved_cost_microusd == 0
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_repaired_source_gate_reopens_the_same_unspent_request_without_provider(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, _version, request = _ready_request(
            db, bill_key="test-2025-HF457112", file_number=457112
        )
        bill_id, request_id = bill.id, request.id

    original_measurement = ai_enrichment.bill_prompt_measurement

    def incomplete_measurement(*args, **kwargs):
        measurement = original_measurement(*args, **kwargs)
        measurement["is_complete"] = False
        measurement["refusal_reasons"] = ["source_context_incomplete"]
        return measurement

    def forbidden_call(*_args, **_kwargs):
        raise AssertionError("a repaired source gate must not call the provider")

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        monkeypatch.setattr(
            ai_enrichment, "bill_prompt_measurement", incomplete_measurement
        )
        refused = run_summary_request(
            local_database_url(),
            request_id,
            limits=_enabled_limits(),
            call_anthropic=forbidden_call,
        )
        assert refused.outcome == "prompt_refused"

        monkeypatch.setattr(
            ai_enrichment, "bill_prompt_measurement", original_measurement
        )
        with Session(get_engine()) as db:
            bill = db.get(schema.Bill, bill_id)
            request = db.get(schema.BillSummaryRequest, request_id)
            assert bill is not None and request is not None
            assert request.status == schema.BillSummaryRequestStatus.failed
            assert request.failure_kind == "source_context_incomplete"
            assert request.provider_call_started_at is None
            assert request.provider_attempts == 0

            reopened = register_official_text_change(db, bill)
            duplicate = register_official_text_change(db, bill)
            db.flush()

            assert reopened is not None and duplicate is not None
            assert reopened.id == duplicate.id == request_id
            assert reopened.status == schema.BillSummaryRequestStatus.ready
            assert reopened.failure_kind is None
            assert reopened.provider_call_started_at is None
            assert reopened.provider_attempts == 0
            assert (
                db.scalar(
                    select(func.count(schema.BillSummaryRequest.id)).where(
                        schema.BillSummaryRequest.bill_id == bill_id
                    )
                )
                == 1
            )
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_provider_started_under_older_prompt_context_is_terminal_and_visible(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        bill, _version, request = _ready_request(
            db, bill_key="test-2025-HF457025", file_number=457025
        )
        bill_id, request_id = bill.id, request.id
        request.prompt_context_version = "older-prompt-context"
        request.prepared_prompt_fingerprint = _text_hash("older prepared prompt")
        request.status = schema.BillSummaryRequestStatus.processing
        request.provider_call_started_at = datetime.now(UTC)
        request.reserved_cost_microusd = 2_500_000
        db.commit()

        gaps = summary_gap_rows(db, bill_key_prefix="test-2025-HF457025")
        assert len(gaps) == 1
        assert gaps[0].request_status == "processing:outdated_prompt_context"

        prepared_prompt_fingerprint = ai_enrichment.prepared_prompt_fingerprint
        monkeypatch.setattr(
            ai_enrichment, "prepared_prompt_fingerprint", lambda *_args: None
        )
        gaps = summary_gap_rows(db, bill_key_prefix="test-2025-HF457025")
        assert len(gaps) == 1
        assert gaps[0].request_status == "processing:outdated_prompt_context"
        monkeypatch.setattr(
            ai_enrichment,
            "prepared_prompt_fingerprint",
            prepared_prompt_fingerprint,
        )

    def forbidden_call(*_args, **_kwargs):
        raise AssertionError("an older paid prompt must never be charged again")

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        result = run_summary_request(
            local_database_url(),
            request_id,
            limits=_enabled_limits(),
            call_anthropic=forbidden_call,
        )

        assert result.outcome == "outdated_prompt_context"
        with Session(get_engine()) as db:
            stored = db.get(schema.BillSummaryRequest, request_id)
            assert stored is not None
            assert stored.status == schema.BillSummaryRequestStatus.superseded
            assert stored.failure_kind == "outdated_prompt_context_after_spend"
            assert stored.provider_call_finished_at is not None
            gaps = summary_gap_rows(db, bill_key_prefix="test-2025-HF457025")
            assert len(gaps) == 1
            assert gaps[0].request_status == "ready"
            current_requests = list(
                db.scalars(
                    select(schema.BillSummaryRequest).where(
                        schema.BillSummaryRequest.bill_id == bill_id,
                        schema.BillSummaryRequest.prompt_context_version
                        == ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION,
                    )
                )
            )
            assert len(current_requests) == 1
            assert current_requests[0].status == schema.BillSummaryRequestStatus.ready
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, bill_id)


def test_paid_citation_rejection_counts_toward_the_failure_cap(
    seed_database: None, monkeypatch
) -> None:
    with Session(get_engine()) as db:
        first_bill, _version, first_request = _ready_request(
            db, bill_key="test-2025-HF457026", file_number=457026
        )
        second_bill, _version, second_request = _ready_request(
            db, bill_key="test-2025-HF457027", file_number=457027
        )
        first_bill_id = first_bill.id
        second_bill_id = second_bill.id
        first_request_id = first_request.id
        second_request_id = second_request.id

    def appendix_citing_call(*_args, **_kwargs):
        content = _valid_summary()
        content["key_point_citations"] = [
            {
                "point": "Updates official duties.",
                "section_id": "A1",
                "quote": "Old law that is reference material only.",
            }
        ]
        return content, {"input_tokens": 100, "output_tokens": 200}

    def forbidden_call(*_args, **_kwargs):
        raise AssertionError("the paid rejection must close the monthly failure gate")

    try:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        rejected = run_summary_request(
            local_database_url(),
            first_request_id,
            limits=_enabled_limits(),
            call_anthropic=appendix_citing_call,
        )
        with Session(get_engine()) as db:
            stored = db.get(schema.BillSummaryRequest, first_request_id)
            first_bill = db.get(schema.Bill, first_bill_id)
            assert stored is not None and first_bill is not None
            stored.prompt_context_version = "older-prompt-context"
            stored.prepared_prompt_fingerprint = _text_hash("older prepared prompt")
            register_official_text_change(db, first_bill)
            db.commit()
            assert stored.status == schema.BillSummaryRequestStatus.failed
            assert stored.failure_kind == "non_citable_appendix_citation"

        repeated = run_summary_request(
            local_database_url(),
            first_request_id,
            limits=_enabled_limits(),
            call_anthropic=forbidden_call,
        )
        capped = run_summary_request(
            local_database_url(),
            second_request_id,
            limits=SummaryAutomationLimits(
                enabled=True,
                monthly_budget_microusd=25_000_000,
                per_bill_budget_microusd=10_000_000,
                failure_cap=1,
                max_attempts=1,
            ),
            call_anthropic=forbidden_call,
        )

        assert rejected.outcome == "failed"
        assert repeated.outcome == "failed"
        assert capped.outcome == "failure_cap"
        with Session(get_engine()) as db:
            stored = db.get(schema.BillSummaryRequest, first_request_id)
            assert stored is not None
            assert stored.status == schema.BillSummaryRequestStatus.failed
            assert stored.failure_kind == "non_citable_appendix_citation"
            assert stored.provider_call_started_at is not None
            assert stored.actual_cost_microusd == 2_200
    finally:
        with Session(get_engine()) as db:
            _delete_bill(db, first_bill_id)
        with Session(get_engine()) as db:
            _delete_bill(db, second_bill_id)
