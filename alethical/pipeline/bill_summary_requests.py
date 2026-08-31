from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Callable, Iterable

import requests
from sqlalchemy import and_, case, create_engine, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.ai_enrichment import change_roles_match_raw_text, source_hash


DEFAULT_MODEL = "claude-sonnet-5"
DEFAULT_MODEL_NAME = f"claude:{DEFAULT_MODEL}"
MAX_PROVIDER_ATTEMPTS = 4
# Conservative worst-case reservation for the measured 825,000-character proposed
# lane, 150,000-character APPENDIX lane, 925,000-character whole request, and
# 16,000 output tokens. Keep the $2.50 reserve after the permanent $2/$10 Sonnet 5
# prices so missing usage stays fail-closed. Four attempts require a $10 bill cap.
MAX_COST_PER_ATTEMPT_MICROUSD = 2_500_000
TYPICAL_COST_LOW_MICROUSD = 42_667
TYPICAL_COST_HIGH_MICROUSD = 48_000
_BUDGET_LOCK_KEY = 457_2026
_ACTIVE_REQUEST_STATUSES = (
    schema.BillSummaryRequestStatus.waiting_for_search,
    schema.BillSummaryRequestStatus.ready,
    schema.BillSummaryRequestStatus.processing,
)
_SOURCE_GATE_FAILURE_KINDS = {
    "source_context_incomplete",
    "proposed_lane_over_limit",
    "appendix_lane_over_limit",
    "combined_lanes_over_limit",
    "whole_request_over_limit",
    "prompt_changed_after_measurement",
}


def _enabled(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _nonnegative_int(name: str, default: int = 0) -> int:
    value = int(os.environ.get(name, str(default)))
    if value < 0:
        raise ValueError(f"{name} must be at least 0")
    return value


@dataclass(frozen=True)
class SummaryAutomationLimits:
    enabled: bool
    monthly_budget_microusd: int
    per_bill_budget_microusd: int
    failure_cap: int
    max_attempts: int

    @classmethod
    def from_environment(cls) -> "SummaryAutomationLimits":
        attempts = _nonnegative_int(
            "ALETHICAL_AUTO_BILL_SUMMARY_MAX_ATTEMPTS", default=0
        )
        if attempts > MAX_PROVIDER_ATTEMPTS:
            raise ValueError(
                "ALETHICAL_AUTO_BILL_SUMMARY_MAX_ATTEMPTS cannot exceed "
                f"{MAX_PROVIDER_ATTEMPTS}"
            )
        return cls(
            enabled=_enabled(os.environ.get("ALETHICAL_AUTO_BILL_SUMMARY_ENABLED")),
            monthly_budget_microusd=_nonnegative_int(
                "ALETHICAL_AUTO_BILL_SUMMARY_MONTHLY_BUDGET_CENTS"
            )
            * 10_000,
            per_bill_budget_microusd=_nonnegative_int(
                "ALETHICAL_AUTO_BILL_SUMMARY_PER_BILL_BUDGET_CENTS"
            )
            * 10_000,
            failure_cap=_nonnegative_int("ALETHICAL_AUTO_BILL_SUMMARY_FAILURE_CAP"),
            max_attempts=attempts,
        )

    @property
    def request_reservation_microusd(self) -> int:
        return self.max_attempts * MAX_COST_PER_ATTEMPT_MICROUSD

    @property
    def can_spend(self) -> bool:
        reservation = self.request_reservation_microusd
        return (
            self.enabled
            and 0 < self.max_attempts <= MAX_PROVIDER_ATTEMPTS
            and self.failure_cap > 0
            and reservation > 0
            and self.per_bill_budget_microusd >= reservation
            and self.monthly_budget_microusd >= self.per_bill_budget_microusd
        )


@dataclass(frozen=True)
class SummaryGap:
    bill_key: str
    bill_version_id: uuid.UUID
    source_text_fingerprint: str
    request_status: str | None


@dataclass(frozen=True)
class SummaryRequestRunResult:
    request_id: uuid.UUID
    outcome: str
    provider_attempts: int = 0
    actual_cost_microusd: int | None = None
    ready_successor_request_ids: tuple[uuid.UUID, ...] = ()


def _ready_successor_ids(
    request: schema.BillSummaryRequest | None,
) -> tuple[uuid.UUID, ...]:
    if request is not None and request.status == schema.BillSummaryRequestStatus.ready:
        return (request.id,)
    return ()


def _current_version(db: Session, bill_id: uuid.UUID) -> schema.BillVersion | None:
    return db.scalar(
        select(schema.BillVersion).where(
            schema.BillVersion.bill_id == bill_id,
            schema.BillVersion.is_current.is_(True),
        )
    )


def _ordered_sections(
    db: Session, version_id: uuid.UUID
) -> list[schema.BillVersionSection]:
    return list(
        db.scalars(
            select(schema.BillVersionSection)
            .where(schema.BillVersionSection.bill_version_id == version_id)
            .order_by(schema.BillVersionSection.source_order.asc())
        )
    )


def _sections_are_complete(
    sections: list[schema.BillVersionSection],
    *,
    allowed_empty_section_ids: set[uuid.UUID] | None = None,
) -> bool:
    if not sections:
        return False
    allowed_empty_section_ids = allowed_empty_section_ids or set()
    if any(
        not (section.raw_text or "").strip()
        and section.id not in allowed_empty_section_ids
        for section in sections
    ):
        return False
    return [section.source_order for section in sections] == list(
        range(1, len(sections) + 1)
    )


def _is_sha256(value: object) -> bool:
    text_value = str(value or "")
    return len(text_value) == 64 and all(
        character in "0123456789abcdef" for character in text_value
    )


def _change_role_hash(section: schema.BillVersionSection) -> str | None:
    segments = section.change_role_segments
    if not section.change_role_parse_complete or not isinstance(segments, list):
        return None
    if not change_roles_match_raw_text(section.raw_text or "", segments):
        return None
    parts: list[str] = []
    for segment in segments:
        if not isinstance(segment, dict):
            return None
        role = str(segment.get("role") or "")
        text_value = str(segment.get("text") or "")
        if role not in {"added", "deleted", "carried_forward"} or not text_value:
            return None
        parts.extend([role, text_value])
    if not parts:
        return None
    calculated = source_hash(parts)
    if section.change_role_source_hash != calculated:
        return None
    return calculated


def _current_parser_versions() -> tuple[str, str]:
    # Import lazily because Minnesota ingestion imports this request ledger after
    # it saves a bill version.
    from alethical.pipeline.minnesota import (
        APPENDIX_PARSER_VERSION,
        CHANGE_ROLE_PARSER_VERSION,
    )

    return CHANGE_ROLE_PARSER_VERSION, APPENDIX_PARSER_VERSION


def _appendix_identity_parts_from_rows(
    version: schema.BillVersion,
    appendix_rows: Iterable[
        tuple[schema.BillVersionAppendixReference, schema.BillVersionSection | None]
    ],
) -> tuple[list[str], set[uuid.UUID]] | None:
    _change_role_parser_version, appendix_parser_version = _current_parser_versions()
    if (
        not version.appendix_parse_complete
        or version.appendix_parser_version != appendix_parser_version
        or not _is_sha256(version.appendix_source_hash)
        or version.appendix_present is None
    ):
        return None

    rows = sorted(appendix_rows, key=lambda row: row[0].source_order)
    if [reference.source_order for reference, _section in rows] != list(
        range(1, len(rows) + 1)
    ):
        return None
    if rows and not version.appendix_present:
        return None

    parts = [
        f"appendix_present:{int(version.appendix_present)}",
        str(version.appendix_source_hash),
    ]
    linked_section_ids: set[uuid.UUID] = set()
    appendix_manifest: list[tuple[str, str, str]] = []
    for reference, linked_section in rows:
        label = reference.official_reference.strip()
        if (
            reference.reference_kind
            not in {"repealed_statute", "repealed_session_law", "repealed_rule"}
            or not label
            or not _is_sha256(reference.source_hash)
        ):
            return None

        if reference.bill_version_section_id is not None:
            if (
                linked_section is None
                or linked_section.bill_version_id != version.id
                or reference.raw_text is not None
                or reference.body_blocks is not None
            ):
                return None
            raw_text = linked_section.raw_text
            linked_section_ids.add(linked_section.id)
            linked_order = str(linked_section.source_order)
            linked_heading = str(linked_section.section_heading or "")
        else:
            if reference.raw_text is None or not reference.raw_text.strip():
                return None
            raw_text = reference.raw_text
            linked_order = ""
            linked_heading = ""

        raw_hash = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()
        if reference.source_hash != raw_hash:
            return None
        appendix_manifest.append(
            (
                reference.reference_kind,
                reference.official_reference,
                reference.source_hash,
            )
        )
        parts.extend(
            [
                str(reference.source_order),
                reference.reference_kind,
                label,
                linked_order,
                linked_heading,
                raw_hash,
            ]
        )
    from alethical.pipeline.minnesota import compute_appendix_source_hash

    if version.appendix_source_hash != compute_appendix_source_hash(
        bool(version.appendix_present), appendix_manifest
    ):
        return None
    return parts, linked_section_ids


def _appendix_identity_parts(
    db: Session, version: schema.BillVersion
) -> tuple[list[str], set[uuid.UUID]] | None:
    rows = db.execute(
        select(schema.BillVersionAppendixReference, schema.BillVersionSection)
        .outerjoin(
            schema.BillVersionSection,
            schema.BillVersionSection.id
            == schema.BillVersionAppendixReference.bill_version_section_id,
        )
        .where(schema.BillVersionAppendixReference.bill_version_id == version.id)
        .order_by(schema.BillVersionAppendixReference.source_order.asc())
    ).all()
    return _appendix_identity_parts_from_rows(version, rows)


def _current_prompt_identity(
    db: Session,
    bill: schema.Bill,
    version: schema.BillVersion,
    *,
    official_sections: Iterable[schema.BillVersionSection] | None = None,
    appendix_rows: Iterable[
        tuple[schema.BillVersionAppendixReference, schema.BillVersionSection | None]
    ]
    | None = None,
) -> tuple[str, str] | None:
    from alethical.pipeline.ai_enrichment import (
        BILL_SUMMARY_PROMPT_CONTEXT_VERSION,
        prepared_prompt_fingerprint,
        prepared_prompt_fingerprint_from_rows,
    )

    fingerprint = (
        prepared_prompt_fingerprint_from_rows(
            bill, version, official_sections, appendix_rows
        )
        if official_sections is not None and appendix_rows is not None
        else prepared_prompt_fingerprint(db, bill, version)
    )
    if len(str(fingerprint or "")) != 64:
        return None
    return BILL_SUMMARY_PROMPT_CONTEXT_VERSION, str(fingerprint)


def canonical_source_text_fingerprint(
    db: Session,
    bill: schema.Bill,
    version: schema.BillVersion,
    *,
    official_sections: Iterable[schema.BillVersionSection] | None = None,
    appendix_rows: Iterable[
        tuple[schema.BillVersionAppendixReference, schema.BillVersionSection | None]
    ]
    | None = None,
) -> str | None:
    """Exact saved legal-source identity, independent of derived search rows."""
    if not version.is_current or version.bill_id != bill.id:
        return None
    change_role_parser_version, _appendix_parser_version = _current_parser_versions()
    if (
        not version.change_role_parse_complete
        or version.change_role_parser_version != change_role_parser_version
    ):
        return None
    sections = (
        sorted(official_sections, key=lambda section: section.source_order)
        if official_sections is not None
        else _ordered_sections(db, version.id)
    )
    appendix = (
        _appendix_identity_parts_from_rows(version, appendix_rows)
        if appendix_rows is not None
        else _appendix_identity_parts(db, version)
    )
    if appendix is None:
        return None
    appendix_parts, linked_section_ids = appendix
    if not _sections_are_complete(
        sections, allowed_empty_section_ids=linked_section_ids
    ):
        return None

    parts = ["bill-summary-official-context-v2"]
    proposed_count = 0
    for section in sections:
        if section.id in linked_section_ids:
            continue
        raw_hash = hashlib.sha256(section.raw_text.encode("utf-8")).hexdigest()
        if section.source_hash != raw_hash:
            return None
        change_hash = _change_role_hash(section)
        if change_hash is None:
            return None
        proposed_count += 1
        parts.extend(
            [
                "proposed",
                str(section.source_order),
                str(section.section_id_text or ""),
                str(section.article_number or ""),
                str(section.article_heading or ""),
                str(section.section_heading or ""),
                raw_hash,
                change_hash,
            ]
        )
    if proposed_count == 0:
        return None
    parts.extend(["appendix", *appendix_parts])
    return source_hash(parts)


def _reapply_exact_paid_response(
    db: Session,
    *,
    bill: schema.Bill,
    version: schema.BillVersion,
    request: schema.BillSummaryRequest,
) -> bool:
    """Reapply a paid exact-context response through every shared safety check."""
    if (
        request.status
        not in {
            schema.BillSummaryRequestStatus.completed,
            schema.BillSummaryRequestStatus.superseded,
        }
        or request.provider_call_started_at is None
        or request.provider_attempts < 1
        or not isinstance(request.provider_response_json, dict)
    ):
        return False
    enrichment = db.scalar(
        select(schema.AIEnrichment).where(
            schema.AIEnrichment.bill_id == bill.id,
            schema.AIEnrichment.bill_version_id == version.id,
            schema.AIEnrichment.enrichment_type == schema.EnrichmentType.bill_summary,
            schema.AIEnrichment.model_name == request.model_name,
            schema.AIEnrichment.source_version_hash
            == request.prepared_prompt_fingerprint,
        )
    )
    if enrichment is not None and isinstance(enrichment.content_json, dict):
        result_meta = enrichment.content_json.get("_meta")
        if (
            enrichment.is_current
            and isinstance(result_meta, dict)
            and result_meta.get("prompt_context_version")
            == request.prompt_context_version
            and result_meta.get("prepared_prompt_fingerprint")
            == request.prepared_prompt_fingerprint
        ):
            return True

    from alethical.pipeline.ai_enrichment import ManifestItem, apply_full_summary

    prepared_hash = request.prepared_prompt_fingerprint
    item = ManifestItem(
        custom_id=f"bill_summary_cached_reapply:{request.id}:{prepared_hash}",
        bill_id=str(bill.id),
        bill_key=bill.bill_key,
        bill_version_id=str(version.id),
        model=request.model_name,
        source_version_hash=prepared_hash,
        prompt_context_version=request.prompt_context_version,
        prepared_prompt_fingerprint=prepared_hash,
    )
    applied = apply_full_summary(
        db,
        item,
        copy.deepcopy(request.provider_response_json),
        provider_batch_id=None,
    )
    if not applied.applied:
        return False

    from alethical.pipeline.policy_area_counts import refresh_all_counts

    refresh_all_counts(db)
    return True


def register_official_text_change(
    db: Session, bill: schema.Bill
) -> schema.BillSummaryRequest | None:
    """Retire stale output and durably record the exact replacement once."""
    locked_bill = db.scalar(
        select(schema.Bill).where(schema.Bill.id == bill.id).with_for_update()
    )
    if locked_bill is None:
        return None

    version = _current_version(db, locked_bill.id)
    fingerprint = (
        canonical_source_text_fingerprint(db, locked_bill, version)
        if version is not None
        else None
    )
    prompt_identity = (
        _current_prompt_identity(db, locked_bill, version)
        if version is not None and fingerprint is not None
        else None
    )
    retire_summaries = update(schema.AIEnrichment).where(
        schema.AIEnrichment.bill_id == locked_bill.id,
        schema.AIEnrichment.enrichment_type == schema.EnrichmentType.bill_summary,
        schema.AIEnrichment.is_current.is_(True),
    )
    if prompt_identity is not None:
        # A duplicate finalizer for the same exact saved context must not retire
        # the summary that its already-completed request produced.
        prompt_context_version, prepared_prompt_fingerprint = prompt_identity
        retire_summaries = retire_summaries.where(
            or_(
                schema.AIEnrichment.source_version_hash.is_distinct_from(
                    prepared_prompt_fingerprint
                ),
                schema.AIEnrichment.content_json["_meta"]["prompt_context_version"]
                .as_string()
                .is_distinct_from(prompt_context_version),
                schema.AIEnrichment.content_json["_meta"]["prepared_prompt_fingerprint"]
                .as_string()
                .is_distinct_from(prepared_prompt_fingerprint),
            )
        )
    db.execute(retire_summaries.values(is_current=False))

    supersede = update(schema.BillSummaryRequest).where(
        schema.BillSummaryRequest.bill_id == locked_bill.id,
        schema.BillSummaryRequest.status.in_(_ACTIVE_REQUEST_STATUSES),
    )
    if version is not None and fingerprint is not None and prompt_identity is not None:
        prompt_context_version, prepared_prompt_fingerprint = prompt_identity
        supersede = supersede.where(
            ~and_(
                schema.BillSummaryRequest.bill_version_id == version.id,
                schema.BillSummaryRequest.source_text_fingerprint == fingerprint,
                schema.BillSummaryRequest.prompt_context_version
                == prompt_context_version,
                schema.BillSummaryRequest.prepared_prompt_fingerprint
                == prepared_prompt_fingerprint,
            )
        )
    db.execute(
        supersede.values(
            status=schema.BillSummaryRequestStatus.superseded,
            failure_kind="newer_official_text",
            provider_call_finished_at=func.now(),
        )
    )
    if version is None or fingerprint is None or prompt_identity is None:
        return None
    prompt_context_version, prepared_prompt_fingerprint = prompt_identity

    insert_request = (
        pg_insert(schema.BillSummaryRequest)
        .values(
            bill_id=locked_bill.id,
            bill_version_id=version.id,
            source_text_fingerprint=fingerprint,
            prompt_context_version=prompt_context_version,
            prepared_prompt_fingerprint=prepared_prompt_fingerprint,
            model_name=DEFAULT_MODEL_NAME,
            status=schema.BillSummaryRequestStatus.waiting_for_search,
        )
        .on_conflict_do_nothing(constraint="uq_bill_summary_request_exact_prompt")
        .returning(schema.BillSummaryRequest.id)
    )
    request_id = db.execute(insert_request).scalar_one_or_none()
    request = None
    if request_id is None:
        request = db.scalar(
            select(schema.BillSummaryRequest)
            .where(
                schema.BillSummaryRequest.bill_id == locked_bill.id,
                schema.BillSummaryRequest.bill_version_id == version.id,
                schema.BillSummaryRequest.source_text_fingerprint == fingerprint,
                schema.BillSummaryRequest.prompt_context_version
                == prompt_context_version,
                schema.BillSummaryRequest.prepared_prompt_fingerprint
                == prepared_prompt_fingerprint,
            )
            .with_for_update()
        )
        if request is None:
            return None
        if request.provider_call_started_at is None:
            # Official text can return to an earlier exact fingerprint before
            # either request spends anything (A -> B -> A). Reuse that one
            # durable row, but make it wait for search proof again because the
            # current derived rows may still describe B.
            reopen_source_gate = (
                request.status == schema.BillSummaryRequestStatus.failed
                and request.failure_kind in _SOURCE_GATE_FAILURE_KINDS
                and request.provider_attempts == 0
                and request.reserved_cost_microusd == 0
                and request.actual_cost_microusd is None
            )
            if (
                request.status == schema.BillSummaryRequestStatus.superseded
                or reopen_source_gate
            ):
                request.status = schema.BillSummaryRequestStatus.waiting_for_search
                request.failure_kind = None
                request.provider_call_finished_at = None
        elif request.status in {
            schema.BillSummaryRequestStatus.completed,
            schema.BillSummaryRequestStatus.superseded,
        }:
            if _reapply_exact_paid_response(
                db,
                bill=locked_bill,
                version=version,
                request=request,
            ):
                request.status = schema.BillSummaryRequestStatus.completed
                request.failure_kind = None
    db.flush()
    request = request or db.get(schema.BillSummaryRequest, request_id)
    if (
        request is not None
        and request.status == schema.BillSummaryRequestStatus.waiting_for_search
        and _search_sections_match_current_text(
            db, locked_bill, version, rag_model="text-embedding-3-small"
        )
    ):
        request.status = schema.BillSummaryRequestStatus.ready
        request.failure_kind = None
        db.flush()
    return request


def _search_sections_match_current_text(
    db: Session,
    bill: schema.Bill,
    version: schema.BillVersion,
    *,
    rag_model: str,
    database_target: str | None = None,
) -> bool:
    sections = _ordered_sections(db, version.id)
    appendix = _appendix_identity_parts(db, version)
    if appendix is None or not _sections_are_complete(
        sections, allowed_empty_section_ids=appendix[1]
    ):
        return False
    from alethical.pipeline.rag_ingest import (
        _bill_rag_sections_complete,
        _chunk_payloads,
    )

    target = (
        database_target
        if database_target is not None
        else os.environ.get("ALETHICAL_DATABASE_TARGET")
    )
    if target == "production":
        # This path only reads saved search-row labels. Production rows use the
        # real requested model label even when a temporary key outage prevents
        # new vectors from being written. Do not invoke the write-time key gate.
        stored_embedding_model = rag_model
    else:
        from alethical.pipeline.rag_ingest import effective_embedding_model

        stored_embedding_model = effective_embedding_model(rag_model)

    prepared_sections = [
        _chunk_payloads(str(bill.file_type), bill.file_number, section)
        for section in sections
    ]
    return _bill_rag_sections_complete(
        db,
        version.id,
        prepared_sections,
        embedding_model=stored_embedding_model,
    )


def mark_summary_requests_ready(
    db: Session,
    bill_keys: Iterable[str],
    *,
    rag_model: str = "text-embedding-3-small",
    database_target: str | None = None,
) -> list[uuid.UUID]:
    ready_ids: list[uuid.UUID] = []
    for bill_key in dict.fromkeys(str(key) for key in bill_keys):
        bill = db.scalar(select(schema.Bill).where(schema.Bill.bill_key == bill_key))
        if bill is None:
            continue
        version = _current_version(db, bill.id)
        if version is None or not _search_sections_match_current_text(
            db,
            bill,
            version,
            rag_model=rag_model,
            database_target=database_target,
        ):
            continue
        fingerprint = canonical_source_text_fingerprint(db, bill, version)
        prompt_identity = _current_prompt_identity(db, bill, version)
        if fingerprint is None or prompt_identity is None:
            continue
        prompt_context_version, prepared_prompt_fingerprint = prompt_identity
        request = db.scalar(
            select(schema.BillSummaryRequest)
            .where(
                schema.BillSummaryRequest.bill_id == bill.id,
                schema.BillSummaryRequest.bill_version_id == version.id,
                schema.BillSummaryRequest.source_text_fingerprint == fingerprint,
                schema.BillSummaryRequest.prompt_context_version
                == prompt_context_version,
                schema.BillSummaryRequest.prepared_prompt_fingerprint
                == prepared_prompt_fingerprint,
                schema.BillSummaryRequest.status
                == schema.BillSummaryRequestStatus.waiting_for_search,
            )
            .with_for_update()
        )
        if request is None:
            continue
        request.status = schema.BillSummaryRequestStatus.ready
        request.failure_kind = None
        ready_ids.append(request.id)
    db.flush()
    return ready_ids


def _legacy_gap_fingerprint_from_sections(
    sections: Iterable[schema.BillVersionSection],
) -> str | None:
    """Report-only identity for pre-proof rows; never creates a request."""
    sections = sorted(sections, key=lambda section: section.source_order)
    if not _sections_are_complete(sections):
        return None
    parts = ["bill-summary-legacy-raw-gap-v1"]
    for section in sections:
        parts.extend(
            [
                str(section.source_order),
                hashlib.sha256(section.raw_text.encode("utf-8")).hexdigest(),
            ]
        )
    return source_hash(parts)


def _legacy_gap_fingerprint(db: Session, version: schema.BillVersion) -> str | None:
    return _legacy_gap_fingerprint_from_sections(_ordered_sections(db, version.id))


def summary_gap_rows(
    db: Session, *, bill_key_prefix: str | None = None
) -> list[SummaryGap]:
    query = select(schema.Bill)
    if bill_key_prefix:
        query = query.where(schema.Bill.bill_key.like(f"{bill_key_prefix}%"))
    bills = list(db.scalars(query.order_by(schema.Bill.bill_key.asc())).unique())
    if not bills:
        return []

    bill_ids = [bill.id for bill in bills]
    versions = list(
        db.scalars(
            select(schema.BillVersion).where(
                schema.BillVersion.bill_id.in_(bill_ids),
                schema.BillVersion.is_current.is_(True),
            )
        )
    )
    versions_by_bill = {version.bill_id: version for version in versions}
    version_ids = [version.id for version in versions]

    sections_by_version: dict[uuid.UUID, list[schema.BillVersionSection]] = {
        version_id: [] for version_id in version_ids
    }
    appendix_by_version: dict[
        uuid.UUID,
        list[
            tuple[
                schema.BillVersionAppendixReference,
                schema.BillVersionSection | None,
            ]
        ],
    ] = {version_id: [] for version_id in version_ids}
    summaries_by_bill: dict[uuid.UUID, list[schema.AIEnrichment]] = {
        bill_id: [] for bill_id in bill_ids
    }
    requests_by_identity: dict[
        tuple[uuid.UUID, uuid.UUID, str, str, str], schema.BillSummaryRequest
    ] = {}
    latest_request_by_source: dict[
        tuple[uuid.UUID, uuid.UUID, str], schema.BillSummaryRequest
    ] = {}
    if version_ids:
        for section in db.scalars(
            select(schema.BillVersionSection)
            .where(schema.BillVersionSection.bill_version_id.in_(version_ids))
            .order_by(
                schema.BillVersionSection.bill_version_id.asc(),
                schema.BillVersionSection.source_order.asc(),
            )
        ):
            sections_by_version[section.bill_version_id].append(section)
        for reference, linked_section in db.execute(
            select(
                schema.BillVersionAppendixReference,
                schema.BillVersionSection,
            )
            .outerjoin(
                schema.BillVersionSection,
                schema.BillVersionSection.id
                == schema.BillVersionAppendixReference.bill_version_section_id,
            )
            .where(schema.BillVersionAppendixReference.bill_version_id.in_(version_ids))
            .order_by(
                schema.BillVersionAppendixReference.bill_version_id.asc(),
                schema.BillVersionAppendixReference.source_order.asc(),
            )
        ):
            appendix_by_version[reference.bill_version_id].append(
                (reference, linked_section)
            )
        for request in db.scalars(
            select(schema.BillSummaryRequest)
            .where(schema.BillSummaryRequest.bill_version_id.in_(version_ids))
            .order_by(
                schema.BillSummaryRequest.created_at.asc(),
                schema.BillSummaryRequest.id.asc(),
            )
        ):
            requests_by_identity[
                (
                    request.bill_id,
                    request.bill_version_id,
                    request.source_text_fingerprint,
                    request.prompt_context_version,
                    request.prepared_prompt_fingerprint,
                )
            ] = request
            latest_request_by_source[
                (
                    request.bill_id,
                    request.bill_version_id,
                    request.source_text_fingerprint,
                )
            ] = request
    for summary in db.scalars(
        select(schema.AIEnrichment).where(
            schema.AIEnrichment.bill_id.in_(bill_ids),
            schema.AIEnrichment.enrichment_type == schema.EnrichmentType.bill_summary,
            schema.AIEnrichment.is_current.is_(True),
        )
    ):
        summaries_by_bill[summary.bill_id].append(summary)

    gaps: list[SummaryGap] = []
    for bill in bills:
        version = versions_by_bill.get(bill.id)
        if version is None:
            continue
        official_sections = sections_by_version[version.id]
        appendix_rows = appendix_by_version[version.id]
        current_summaries = summaries_by_bill[bill.id]
        fingerprint = canonical_source_text_fingerprint(
            db,
            bill,
            version,
            official_sections=official_sections,
            appendix_rows=appendix_rows,
        )
        if fingerprint is None:
            if current_summaries:
                continue
            legacy_fingerprint = _legacy_gap_fingerprint_from_sections(
                official_sections
            )
            if legacy_fingerprint is None:
                continue
            gaps.append(
                SummaryGap(
                    bill_key=bill.bill_key,
                    bill_version_id=version.id,
                    source_text_fingerprint=legacy_fingerprint,
                    request_status="source_context_incomplete",
                )
            )
            continue
        current_prompt_identity = _current_prompt_identity(
            db,
            bill,
            version,
            official_sections=official_sections,
            appendix_rows=appendix_rows,
        )
        matching_summary = False
        if current_prompt_identity is not None:
            prompt_context_version, prepared_prompt_fingerprint = (
                current_prompt_identity
            )
            for summary in current_summaries:
                content = summary.content_json
                meta = content.get("_meta") if isinstance(content, dict) else None
                if (
                    summary.source_version_hash == prepared_prompt_fingerprint
                    and isinstance(meta, dict)
                    and meta.get("prompt_context_version") == prompt_context_version
                    and meta.get("prepared_prompt_fingerprint")
                    == prepared_prompt_fingerprint
                ):
                    matching_summary = True
                    break
        if matching_summary:
            continue
        source_identity = (bill.id, version.id, fingerprint)
        request = (
            requests_by_identity.get(
                (
                    *source_identity,
                    current_prompt_identity[0],
                    current_prompt_identity[1],
                )
            )
            if current_prompt_identity is not None
            else None
        )
        if request is None:
            request = latest_request_by_source.get(source_identity)
        request_status = request.status.value if request is not None else None
        if (
            request is not None
            and request.status in _ACTIVE_REQUEST_STATUSES
            and request.provider_call_started_at is not None
            and (
                current_prompt_identity is None
                or request.prompt_context_version != current_prompt_identity[0]
                or request.prepared_prompt_fingerprint != current_prompt_identity[1]
            )
        ):
            request_status = f"{request.status.value}:outdated_prompt_context"
        if current_summaries:
            request_status = "outdated_prompt_context"
        gaps.append(
            SummaryGap(
                bill_key=bill.bill_key,
                bill_version_id=version.id,
                source_text_fingerprint=fingerprint,
                request_status=request_status,
            )
        )
    return gaps


def _month_start(now: datetime) -> datetime:
    return datetime(now.year, now.month, 1, tzinfo=UTC)


def _usage_cost_microusd(usage: dict[str, int]) -> int:
    """Permanent Sonnet 5 list price, rounded up to a micro-dollar."""
    input_cost = int(usage.get("input_tokens") or 0) * 2
    output_cost = int(usage.get("output_tokens") or 0) * 10
    cache_write_cost = int(usage.get("cache_creation_input_tokens") or 0) * 4
    cache_read_tokens = int(usage.get("cache_read_input_tokens") or 0)
    cache_read_cost = (cache_read_tokens * 2 + 9) // 10
    return input_cost + output_cost + cache_write_cost + cache_read_cost


def _current_budget_cost(
    db: Session, *, since: datetime | None = None, bill_id=None
) -> int:
    budget_cost = case(
        (
            schema.BillSummaryRequest.actual_cost_microusd.is_not(None),
            schema.BillSummaryRequest.actual_cost_microusd,
        ),
        else_=schema.BillSummaryRequest.reserved_cost_microusd,
    )
    query = select(func.coalesce(func.sum(budget_cost), 0))
    if since is not None:
        query = query.where(schema.BillSummaryRequest.provider_call_started_at >= since)
    if bill_id is not None:
        query = query.where(schema.BillSummaryRequest.bill_id == bill_id)
    return int(db.scalar(query) or 0)


def _prompt_refusal_kind(measurement: dict[str, Any]) -> str | None:
    proposed = measurement.get("proposed")
    appendix = measurement.get("appendix")
    combined = measurement.get("combined")
    request = measurement.get("request")
    reasons = measurement.get("refusal_reasons")
    if not (
        isinstance(proposed, dict)
        and isinstance(proposed.get("truncated"), bool)
        and isinstance(proposed.get("over_limit"), bool)
        and isinstance(appendix, dict)
        and isinstance(appendix.get("truncated"), bool)
        and isinstance(appendix.get("over_limit"), bool)
        and isinstance(combined, dict)
        and isinstance(combined.get("over_limit"), bool)
        and isinstance(request, dict)
        and isinstance(request.get("over_limit"), bool)
        and isinstance(measurement.get("is_complete"), bool)
        and isinstance(reasons, list)
    ):
        return "source_context_incomplete"
    if bool(proposed.get("truncated")) or bool(proposed.get("over_limit")):
        return "proposed_lane_over_limit"
    if bool(appendix.get("truncated")) or bool(appendix.get("over_limit")):
        return "appendix_lane_over_limit"
    if bool(combined.get("over_limit")):
        return "combined_lanes_over_limit"
    if bool(request.get("over_limit")):
        return "whole_request_over_limit"
    if not bool(measurement.get("is_complete")):
        if isinstance(reasons, list) and reasons:
            return str(reasons[0])[:80]
        return "source_context_incomplete"
    if isinstance(reasons, list) and reasons:
        return str(reasons[0])[:80]
    return None


def run_summary_request(
    database_url: str,
    request_id: uuid.UUID,
    *,
    limits: SummaryAutomationLimits | None = None,
    call_anthropic: Callable[..., tuple[dict[str, Any], dict[str, Any]]] | None = None,
    claim_job_id: int | None = None,
) -> SummaryRequestRunResult:
    """Claim, generate, and safely apply 1 exact request.

    The queue worker itself never retries. The existing Anthropic call owns the
    bounded schema/HTTP retry loop, while ambiguous transport failures stop here.
    """
    from alethical.pipeline import anthropic_enrichment
    from alethical.pipeline.ai_enrichment import (
        APPENDIX_TEXT_CHAR_LIMIT,
        COMBINED_TEXT_CHAR_LIMIT,
        ManifestItem,
        PROPOSED_TEXT_CHAR_LIMIT,
        SYSTEM_PROMPT,
        WHOLE_REQUEST_CHAR_LIMIT,
        apply_full_summary,
        bill_prompt,
        bill_prompt_measurement,
    )

    limits = limits or SummaryAutomationLimits.from_environment()
    if not limits.can_spend:
        return SummaryRequestRunResult(request_id, "disabled")
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return SummaryRequestRunResult(request_id, "missing_api_key")
    call = call_anthropic or anthropic_enrichment._call_anthropic
    engine = create_engine(
        normalize_database_url(database_url),
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    usage_totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    }
    provider_attempts = 0
    usage_is_complete = True

    def observe_attempt(usage: dict[str, Any] | None = None) -> None:
        nonlocal provider_attempts, usage_is_complete
        provider_attempts += 1
        if not isinstance(usage, dict):
            usage_is_complete = False
            return
        for key in usage_totals:
            value = usage.get(key, 0)
            if key in {"input_tokens", "output_tokens"} and key not in usage:
                usage_is_complete = False
                continue
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                usage_is_complete = False
                continue
            usage_totals[key] += value

    with Session(engine) as db:
        db.execute(
            text("select pg_advisory_xact_lock(:key)"), {"key": _BUDGET_LOCK_KEY}
        )
        # A worker can wait here across a UTC month boundary. Attribute its
        # reservation to the month in which it actually owns the budget lock.
        now = datetime.now(UTC)
        request_bill_id = db.scalar(
            select(schema.BillSummaryRequest.bill_id).where(
                schema.BillSummaryRequest.id == request_id
            )
        )
        if request_bill_id is None:
            return SummaryRequestRunResult(request_id, "missing")
        # Ingestion and summary apply both take the Bill lock first. Waiting for
        # that same lock before claiming the request prevents paying for A while
        # an uncommitted refresh is already saving B, without reversing the lock
        # order and creating a deadlock.
        db.scalar(
            select(schema.Bill)
            .where(schema.Bill.id == request_bill_id)
            .with_for_update()
        )
        request = db.scalar(
            select(schema.BillSummaryRequest)
            .where(schema.BillSummaryRequest.id == request_id)
            .with_for_update()
        )
        if request is None:
            return SummaryRequestRunResult(request_id, "missing")
        bill = db.get(schema.Bill, request.bill_id)
        version = _current_version(db, request.bill_id)
        if (
            bill is None
            or version is None
            or version.id != request.bill_version_id
            or canonical_source_text_fingerprint(db, bill, version)
            != request.source_text_fingerprint
        ):
            request.status = schema.BillSummaryRequestStatus.superseded
            request.failure_kind = "newer_official_text"
            successor = None
            if bill is not None and version is not None:
                successor = register_official_text_change(db, bill)
            db.commit()
            return SummaryRequestRunResult(
                request_id,
                "superseded",
                ready_successor_request_ids=_ready_successor_ids(successor),
            )

        current_prompt_identity = _current_prompt_identity(db, bill, version)
        prompt_identity_changed = current_prompt_identity is None or (
            request.prompt_context_version != current_prompt_identity[0]
            or request.prepared_prompt_fingerprint != current_prompt_identity[1]
        )
        if (
            request.provider_call_started_at is not None
            and request.status in _ACTIVE_REQUEST_STATUSES
            and prompt_identity_changed
        ):
            request.status = schema.BillSummaryRequestStatus.superseded
            request.failure_kind = "outdated_prompt_context_after_spend"
            request.provider_call_finished_at = func.now()
            successor = register_official_text_change(db, bill)
            db.commit()
            return SummaryRequestRunResult(
                request_id,
                "outdated_prompt_context",
                ready_successor_request_ids=_ready_successor_ids(successor),
            )
        if (
            request.status in _ACTIVE_REQUEST_STATUSES
            and request.provider_call_started_at is not None
        ):
            if (
                request.status == schema.BillSummaryRequestStatus.processing
                and claim_job_id is not None
                and request.provider_claim_job_id is not None
                and request.provider_claim_job_id != claim_job_id
            ):
                # Queue insertion is not atomic, so 2 different Oban jobs can
                # briefly target the same request. The later job must leave the
                # live owner's paid call alone. Only that same job id on a
                # recovered retry can declare its prior call abandoned.
                return SummaryRequestRunResult(request_id, "processing")
            request.status = schema.BillSummaryRequestStatus.ambiguous
            request.failure_kind = "provider_call_already_started"
            request.provider_call_finished_at = func.now()
            db.commit()
            return SummaryRequestRunResult(request_id, "ambiguous")
        if request.status != schema.BillSummaryRequestStatus.ready:
            return SummaryRequestRunResult(request_id, request.status.value)
        if current_prompt_identity is None:
            request.status = schema.BillSummaryRequestStatus.failed
            request.failure_kind = "source_context_incomplete"
            db.commit()
            return SummaryRequestRunResult(request_id, "prompt_refused")

        prompt_context_version, prepared_prompt_fingerprint = current_prompt_identity
        request.prompt_context_version = prompt_context_version
        request.prepared_prompt_fingerprint = prepared_prompt_fingerprint
        measurement = bill_prompt_measurement(
            db,
            bill,
            version,
            max_proposed_chars=PROPOSED_TEXT_CHAR_LIMIT,
            max_appendix_chars=APPENDIX_TEXT_CHAR_LIMIT,
            max_combined_chars=COMBINED_TEXT_CHAR_LIMIT,
            max_request_chars=WHOLE_REQUEST_CHAR_LIMIT,
        )
        refusal_kind = _prompt_refusal_kind(measurement)
        if refusal_kind is not None:
            request.status = schema.BillSummaryRequestStatus.failed
            request.failure_kind = refusal_kind
            db.commit()
            return SummaryRequestRunResult(request_id, "prompt_refused")

        failure_slots = int(
            db.scalar(
                select(func.count(schema.BillSummaryRequest.id)).where(
                    schema.BillSummaryRequest.provider_call_started_at
                    >= _month_start(now),
                    schema.BillSummaryRequest.status.in_(
                        (
                            schema.BillSummaryRequestStatus.failed,
                            schema.BillSummaryRequestStatus.ambiguous,
                            schema.BillSummaryRequestStatus.processing,
                        )
                    ),
                )
            )
            or 0
        )
        reservation = limits.request_reservation_microusd
        monthly_cost = _current_budget_cost(db, since=_month_start(now))
        bill_cost = _current_budget_cost(db, bill_id=request.bill_id)
        if failure_slots >= limits.failure_cap:
            request.failure_kind = "monthly_failure_cap"
            db.commit()
            return SummaryRequestRunResult(request_id, "failure_cap")
        if monthly_cost + reservation > limits.monthly_budget_microusd:
            request.failure_kind = "monthly_budget_cap"
            db.commit()
            return SummaryRequestRunResult(request_id, "monthly_budget_cap")
        if bill_cost + reservation > limits.per_bill_budget_microusd:
            request.failure_kind = "per_bill_budget_cap"
            db.commit()
            return SummaryRequestRunResult(request_id, "per_bill_budget_cap")

        prompt, prepared_hash, truncated = bill_prompt(
            db,
            bill,
            version,
            max_input_chars=PROPOSED_TEXT_CHAR_LIMIT,
            max_appendix_chars=APPENDIX_TEXT_CHAR_LIMIT,
            max_combined_chars=COMBINED_TEXT_CHAR_LIMIT,
            max_request_chars=WHOLE_REQUEST_CHAR_LIMIT,
        )
        if truncated or prepared_hash != prepared_prompt_fingerprint:
            request.status = schema.BillSummaryRequestStatus.failed
            request.failure_kind = "prompt_changed_after_measurement"
            db.commit()
            return SummaryRequestRunResult(request_id, "prompt_refused")
        item = ManifestItem(
            custom_id=f"bill_summary:{bill.bill_key}:{prepared_hash}",
            bill_id=str(bill.id),
            bill_key=bill.bill_key,
            bill_version_id=str(version.id),
            model=request.model_name,
            source_version_hash=prepared_hash,
            prompt_context_version=prompt_context_version,
            prepared_prompt_fingerprint=prepared_hash,
        )
        request.status = schema.BillSummaryRequestStatus.processing
        request.provider_attempt_limit = limits.max_attempts
        request.provider_call_started_at = now
        request.provider_claim_job_id = claim_job_id
        request.reserved_cost_microusd = reservation
        request.actual_cost_microusd = None
        request.failure_kind = None
        db.commit()

    try:
        content, final_usage = call(
            api_key,
            DEFAULT_MODEL,
            SYSTEM_PROMPT,
            prompt,
            anthropic_enrichment.DEFAULT_MAX_TOKENS,
            max_attempts=limits.max_attempts,
            retry_ambiguous=False,
            attempt_observer=observe_attempt,
        )
        # A test double may not use the observer. Count its one successful call and
        # retain its usage without counting the same real response twice.
        if provider_attempts == 0:
            observe_attempt(final_usage)
    except Exception as exc:  # noqa: BLE001 - the terminal state is the safety net
        ambiguous = isinstance(
            exc,
            (requests.exceptions.ConnectionError, requests.exceptions.Timeout),
        )
        outcome = "ambiguous" if ambiguous else "failed"
        with Session(engine) as db:
            request = db.scalar(
                select(schema.BillSummaryRequest)
                .where(schema.BillSummaryRequest.id == request_id)
                .with_for_update()
            )
            if request is not None:
                if request.status == schema.BillSummaryRequestStatus.processing:
                    request.status = (
                        schema.BillSummaryRequestStatus.ambiguous
                        if ambiguous
                        else schema.BillSummaryRequestStatus.failed
                    )
                    request.failure_kind = (
                        "ambiguous_transport" if ambiguous else type(exc).__name__[:80]
                    )
                else:
                    outcome = request.status.value
                request.provider_attempts = provider_attempts
                request.provider_call_finished_at = func.now()
                for key, value in usage_totals.items():
                    setattr(request, key, value)
                db.commit()
        return SummaryRequestRunResult(
            request_id,
            outcome,
            provider_attempts=provider_attempts,
        )

    actual_cost = _usage_cost_microusd(usage_totals) if usage_is_complete else None
    raw_provider_response = copy.deepcopy(content)
    with Session(engine) as db:
        bill_id = uuid.UUID(item.bill_id)
        db.scalar(
            select(schema.Bill).where(schema.Bill.id == bill_id).with_for_update()
        )
        request = db.scalar(
            select(schema.BillSummaryRequest)
            .where(schema.BillSummaryRequest.id == request_id)
            .with_for_update()
        )
        bill = db.get(schema.Bill, bill_id)
        version = _current_version(db, bill_id)
        current_prompt_identity = (
            _current_prompt_identity(db, bill, version)
            if bill is not None and version is not None
            else None
        )
        source_is_current = bool(
            request is not None
            and bill is not None
            and version is not None
            and version.id == request.bill_version_id
            and canonical_source_text_fingerprint(db, bill, version)
            == request.source_text_fingerprint
        )
        request_is_current = (
            bool(
                request is not None
                and request.status == schema.BillSummaryRequestStatus.processing
                and request.prompt_context_version == current_prompt_identity[0]
                and request.prepared_prompt_fingerprint == current_prompt_identity[1]
                and item.source_version_hash == current_prompt_identity[1]
                and source_is_current
            )
            if current_prompt_identity is not None
            else False
        )

        applied = None
        final_outcome = "superseded"
        ready_successor_request_ids: tuple[uuid.UUID, ...] = ()
        if request_is_current:
            applied = apply_full_summary(db, item, content, provider_batch_id=None)
        if request is not None:
            # Keep the immutable S# response even when newer text made this paid
            # result stale. If the exact legal context returns later, the normal
            # lock, freshness, citation, and apply path can reuse it at no charge.
            request.provider_response_json = raw_provider_response
            if applied is not None and applied.applied:
                request.status = schema.BillSummaryRequestStatus.completed
                request.failure_kind = None
            elif applied is not None and applied.rejected:
                request.status = schema.BillSummaryRequestStatus.failed
                request.failure_kind = "non_citable_appendix_citation"
            elif request.status == schema.BillSummaryRequestStatus.processing:
                request.status = schema.BillSummaryRequestStatus.superseded
                request.failure_kind = "outdated_result"
            final_outcome = request.status.value
            request.provider_attempts = provider_attempts
            request.provider_call_finished_at = func.now()
            request.actual_cost_microusd = actual_cost
            for key, value in usage_totals.items():
                setattr(request, key, value)
        if (
            not request_is_current
            and bill is not None
            and version is not None
            and current_prompt_identity is not None
        ):
            successor = register_official_text_change(db, bill)
            ready_successor_request_ids = _ready_successor_ids(successor)
        db.commit()
        if applied is not None and applied.applied:
            from alethical.pipeline.policy_area_counts import refresh_all_counts

            refresh_all_counts(db)
            db.commit()
    return SummaryRequestRunResult(
        request_id,
        final_outcome,
        provider_attempts=provider_attempts,
        actual_cost_microusd=actual_cost,
        ready_successor_request_ids=ready_successor_request_ids,
    )


def dry_run_report(db: Session) -> dict[str, Any]:
    ready = int(
        db.scalar(
            select(func.count(schema.BillSummaryRequest.id)).where(
                schema.BillSummaryRequest.status
                == schema.BillSummaryRequestStatus.ready
            )
        )
        or 0
    )
    limits = SummaryAutomationLimits.from_environment()
    return {
        "paid_calls_made": 0,
        "ready_requests": ready,
        "measured_typical_cost_low_usd": ready * TYPICAL_COST_LOW_MICROUSD / 1_000_000,
        "measured_typical_cost_high_usd": ready
        * TYPICAL_COST_HIGH_MICROUSD
        / 1_000_000,
        "worst_case_reserved_usd": ready
        * limits.request_reservation_microusd
        / 1_000_000,
        "automation_enabled": limits.enabled,
        "spending_gate_open": limits.can_spend,
    }


def _committed_ready_request_ids(
    request_ids: Iterable[str | uuid.UUID],
    *,
    database_target: str | None,
    database_url: str | None,
) -> list[str]:
    parsed_ids: list[uuid.UUID] = []
    for value in dict.fromkeys(str(item) for item in request_ids):
        try:
            parsed_ids.append(uuid.UUID(value))
        except ValueError:
            continue
    if not parsed_ids:
        return []

    resolved_database_url = database_url_for_target(database_target, database_url)
    engine = create_engine(
        normalize_database_url(resolved_database_url),
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    try:
        with Session(engine) as db:
            return [
                str(value)
                for value in db.scalars(
                    select(schema.BillSummaryRequest.id)
                    .where(
                        schema.BillSummaryRequest.id.in_(parsed_ids),
                        schema.BillSummaryRequest.status
                        == schema.BillSummaryRequestStatus.ready,
                    )
                    .order_by(
                        schema.BillSummaryRequest.created_at.asc(),
                        schema.BillSummaryRequest.id.asc(),
                    )
                )
            ]
    finally:
        engine.dispose()


async def enqueue_ready_requests(
    request_ids: Iterable[str | uuid.UUID],
    *,
    database_target: str | None,
    database_url: str | None = None,
    oban_target: str | None = None,
    oban_dsn: str | None = None,
) -> list[dict[str, Any]]:
    """Create worker jobs only when the default-off spending gate is open."""
    if not SummaryAutomationLimits.from_environment().can_spend:
        return []
    from alethical.pipeline.oban_workers import (
        BillSummaryRequestWorker,
        _enqueue_child,
    )

    ready_request_ids = _committed_ready_request_ids(
        request_ids,
        database_target=database_target,
        database_url=database_url,
    )
    children: list[dict[str, Any]] = []
    queue_uses_explicit_database_url = bool(
        database_url and oban_target is None and oban_dsn is None
    )
    for value in ready_request_ids:
        args: dict[str, Any] = {
            "_kind": "bill-summary-request",
            "task_key": f"bill-summary-request:{value}",
            "request_id": value,
            "database_target": database_target,
            "oban_target": (
                None
                if queue_uses_explicit_database_url
                else oban_target or database_target
            ),
            "oban_dsn": database_url if queue_uses_explicit_database_url else oban_dsn,
        }
        if database_url:
            args["database_url"] = database_url
        children.append(await _enqueue_child(BillSummaryRequestWorker, args))
    return children


async def reconcile_ready_requests(
    *,
    database_target: str | None = None,
    database_url: str | None = None,
    oban_target: str | None = None,
    oban_dsn: str | None = None,
) -> list[dict[str, Any]]:
    """Re-enqueue every committed request that is still ready to run."""
    resolved_database_url = database_url_for_target(database_target, database_url)
    engine = create_engine(
        normalize_database_url(resolved_database_url),
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    try:
        with Session(engine) as db:
            request_ids = list(
                db.scalars(
                    select(schema.BillSummaryRequest.id)
                    .where(
                        schema.BillSummaryRequest.status
                        == schema.BillSummaryRequestStatus.ready
                    )
                    .order_by(
                        schema.BillSummaryRequest.created_at.asc(),
                        schema.BillSummaryRequest.id.asc(),
                    )
                )
            )
    finally:
        engine.dispose()
    return await enqueue_ready_requests(
        request_ids,
        database_target=database_target,
        database_url=database_url,
        oban_target=oban_target,
        oban_dsn=oban_dsn,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Report automatic bill-summary requests without model calls."
    )
    parser.add_argument("--target", choices=("local", "production"), default="local")
    parser.add_argument("--database-url", default=None)
    return parser


def main() -> None:
    args = _build_parser().parse_args()
    database_url = database_url_for_target(args.target, args.database_url)
    engine = create_engine(
        normalize_database_url(database_url),
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    with Session(engine) as db:
        print(json.dumps(dry_run_report(db), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
