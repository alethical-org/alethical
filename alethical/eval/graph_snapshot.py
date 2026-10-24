"""Bounded, public-record-only source copies for private retrieval experiments.

The caller supplies an engine and owns any file output. No credentials, network
services, account records, or generated summaries are read here. Import timestamps
are database observations, never claims about historical legislative validity.
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import date, datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any
from types import SimpleNamespace
from uuid import UUID

from sqlalchemy import and_, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from alethical.db.models import (
    Bill,
    BillVersion,
    BillVersionSection,
    Chamber,
    Legislator,
    RagChunk,
    RagChunkEmbedding,
    RagSectionDocument,
    SourceArtifact,
    Sponsorship,
    SponsorshipRole,
    VoteEvent,
    VoteRecord,
)

SCHEMA_VERSION = 1
MAX_BILLS = 20
MAX_CHUNKS = 10_000
MAX_STRUCTURED_RECORDS = 20_000


class SnapshotLimitError(ValueError):
    """A complete source copy cannot fit within the experiment's bounds."""


def _json_value(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    return value


def _artifact_columns() -> list:
    return [
        SourceArtifact.id.label("source_artifact_id"),
        SourceArtifact.content_hash.label("source_hash"),
        SourceArtifact.fetched_at.label("source_fetched_at"),
        SourceArtifact.source_url.label("source_url"),
    ]


def _bill_query(keys: list[str]):
    return (
        select(
            Bill.id,
            Bill.bill_key,
            Bill.title,
            Bill.current_status,
            Bill.official_url,
            BillVersion.id.label("current_version_id"),
            BillVersion.version_code.label("current_version_code"),
            BillVersion.document_date.label("current_version_document_date"),
        )
        .outerjoin(
            BillVersion,
            and_(BillVersion.bill_id == Bill.id, BillVersion.is_current.is_(True)),
        )
        .where(Bill.bill_key.in_(keys))
        .order_by(Bill.bill_key)
        .limit(MAX_BILLS + 1)
    )


def _chunk_query(keys: list[str], model: str):
    return (
        select(
            RagChunk.id,
            Bill.id.label("bill_id"),
            Bill.bill_key,
            RagChunk.chunk_text.label("text"),
            RagChunk.citation_label,
            RagChunk.chunk_index,
            RagSectionDocument.id.label("rag_section_document_id"),
            BillVersion.html_url,
            BillVersion.pdf_url,
            BillVersion.id.label("bill_version_id"),
            BillVersion.version_code,
            BillVersion.document_date.label("source_occurred_at"),
            BillVersionSection.id.label("section_id"),
            BillVersionSection.section_id_text,
            BillVersionSection.source_order.label("section_source_order"),
            BillVersionSection.source_hash.label("section_source_hash"),
            RagSectionDocument.source_hash.label("clean_text_source_hash"),
            RagChunk.created_at.label("imported_at"),
            RagChunk.updated_at.label("observed_at"),
            RagChunkEmbedding.embedding_model,
            RagChunkEmbedding.embedding,
            *_artifact_columns(),
        )
        .select_from(RagChunk)
        .join(
            RagSectionDocument,
            RagSectionDocument.id == RagChunk.rag_section_document_id,
        )
        .join(BillVersion, BillVersion.id == RagSectionDocument.bill_version_id)
        .join(Bill, Bill.id == RagSectionDocument.bill_id)
        .outerjoin(
            BillVersionSection,
            and_(
                BillVersionSection.id == RagSectionDocument.bill_version_section_id,
                BillVersionSection.bill_version_id == BillVersion.id,
            ),
        )
        .outerjoin(SourceArtifact, SourceArtifact.id == BillVersion.source_artifact_id)
        .outerjoin(
            RagChunkEmbedding,
            and_(
                RagChunkEmbedding.rag_chunk_id == RagChunk.id,
                RagChunkEmbedding.embedding_model == model,
            ),
        )
        .where(
            Bill.bill_key.in_(keys),
            BillVersion.bill_id == Bill.id,
            BillVersion.is_current.is_(True),
        )
        .order_by(RagChunk.id)
        .limit(MAX_CHUNKS + 1)
    )


def _authorship_query(keys: list[str]):
    return (
        select(
            Sponsorship.id,
            Bill.id.label("bill_id"),
            Bill.bill_key,
            Bill.official_url,
            Sponsorship.role,
            Sponsorship.source_chamber,
            Sponsorship.source_order,
            Sponsorship.legislator_id,
            Sponsorship.committee_id,
            Legislator.full_name,
            Sponsorship.created_at.label("imported_at"),
            Sponsorship.updated_at.label("observed_at"),
        )
        .select_from(Sponsorship)
        .join(Bill, Bill.id == Sponsorship.bill_id)
        .outerjoin(Legislator, Legislator.id == Sponsorship.legislator_id)
        .where(
            Bill.bill_key.in_(keys),
            Sponsorship.role.in_(
                [SponsorshipRole.chief_author, SponsorshipRole.co_author]
            ),
        )
        .order_by(Sponsorship.id)
        .limit(MAX_STRUCTURED_RECORDS + 1)
    )


def _vote_query(keys: list[str]):
    return (
        select(
            VoteRecord.id,
            Bill.id.label("bill_id"),
            Bill.bill_key,
            VoteRecord.legislator_id,
            Legislator.full_name,
            VoteRecord.vote_value,
            VoteEvent.id.label("event_id"),
            VoteEvent.motion_text.label("motion"),
            VoteEvent.result_text,
            VoteEvent.chamber_id,
            Chamber.chamber_type.label("chamber"),
            VoteEvent.occurred_at.label("source_occurred_at"),
            VoteEvent.official_url,
            VoteRecord.created_at.label("imported_at"),
            VoteRecord.updated_at.label("observed_at"),
            *_artifact_columns(),
        )
        .select_from(VoteRecord)
        .join(VoteEvent, VoteEvent.id == VoteRecord.vote_event_id)
        .join(Bill, Bill.id == VoteEvent.bill_id)
        .join(Legislator, Legislator.id == VoteRecord.legislator_id)
        .join(Chamber, Chamber.id == VoteEvent.chamber_id)
        .outerjoin(SourceArtifact, SourceArtifact.id == VoteEvent.source_artifact_id)
        .where(Bill.bill_key.in_(keys))
        .order_by(VoteRecord.id)
        .limit(MAX_STRUCTURED_RECORDS + 1)
    )


def _base_evidence(row: dict, kind: str, official_url: str | None) -> dict:
    identifier = f"{'chunk' if kind == 'text' else kind}:{row['id']}"
    return {
        "id": identifier,
        "bill_key": row["bill_key"],
        "bill_id": row["bill_id"],
        "kind": kind,
        "official_url": official_url,
        "eligible": bool(official_url),
        "ineligible_reason": None if official_url else "missing_official_url",
        "source_artifact_id": row.get("source_artifact_id"),
        "source_hash": row.get("source_hash"),
        "source_fetched_at": row.get("source_fetched_at"),
        "source_url": row.get("source_url"),
        "source_artifact_status": (
            "present" if row.get("source_artifact_id") else "missing"
        ),
        "observed_at": row["observed_at"],
        "imported_at": row["imported_at"],
        "source_occurred_at": row.get("source_occurred_at"),
    }


def _read_rows(connection, statement, cap: int, label: str) -> list[dict]:
    rows = [
        {key: _json_value(value) for key, value in row.items()}
        for row in connection.execute(statement).mappings()
    ]
    if len(rows) > cap:
        raise SnapshotLimitError(
            f"{label} exceeds the maximum of {cap}; no snapshot exported"
        )
    return rows


def snapshot_digest(snapshot: dict) -> str:
    """Hash all content except the digest field itself, including export time."""
    manifest = {
        key: value
        for key, value in snapshot["manifest"].items()
        if key != "content_digest"
    }
    content = {**snapshot, "manifest": manifest}
    canonical = json.dumps(
        content,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _validate_questions(
    questions: list[dict] | None,
    query_vectors: dict[str, list[float]] | None,
    bill_keys: list[str],
) -> None:
    if questions is None:
        if query_vectors is not None:
            raise ValueError("query_vectors requires questions")
        return
    identifiers: set[str] = set()
    for case in questions:
        if not isinstance(case, dict) or any(
            not isinstance(case.get(field), str) or not case[field].strip()
            for field in ("id", "bill_key", "question")
        ):
            raise ValueError(
                "Each question requires nonempty id, bill_key, and question"
            )
        if case["id"] in identifiers:
            raise ValueError("Question IDs must not contain duplicates")
        identifiers.add(case["id"])
        if case["bill_key"] not in bill_keys:
            raise ValueError("Every question bill_key must be requested for export")
        vector = (query_vectors or {}).get(case["question"])
        if (
            vector is None
            or len(vector) != 1536
            or any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                for value in vector
            )
        ):
            raise ValueError(
                "Every question requires a supplied finite 1536-dimensional query vector"
            )


def _production_rankings(
    connection,
    bills: list[dict],
    questions: list[dict],
    query_vectors: dict[str, list[float]],
    model: str,
) -> dict:
    # Only the serving passage selector runs: never resolution, embedding, or
    # answer generation. Session shares the already protected connection.
    from alethical.api.routers.ask import _LIST_QUESTION_RE, _retrieve_bill_text

    bill_map = {bill["bill_key"]: bill for bill in bills}
    result: dict[str, dict] = {}
    connection.execute(text("SET LOCAL hnsw.ef_search = 100"))
    with Session(bind=connection, autoflush=False) as session:
        for case in questions:
            enumerating = bool(_LIST_QUESTION_RE.search(case["question"]))
            bill = bill_map.get(case["bill_key"])
            if bill is None:
                result[case["id"]] = {
                    "evidence_ids": [],
                    "passages_total": 0,
                    "enumerating": enumerating,
                    "reason": "missing_bill",
                }
                continue
            chunks, coverage = _retrieve_bill_text(
                session,
                SimpleNamespace(id=UUID(bill["id"])),
                model,
                query_vectors[case["question"]],
                enumerating=enumerating,
            )
            result[case["id"]] = {
                "evidence_ids": [f"chunk:{chunk.id}" for chunk in chunks],
                "passages_total": coverage.total,
                "enumerating": enumerating,
                "reason": None,
            }
    return result


def export_snapshot(
    engine: Engine,
    bill_keys: list[str],
    embedding_model: str = "text-embedding-3-small",
    *,
    query_vectors: dict[str, list[float]] | None = None,
    questions: list[dict] | None = None,
) -> dict:
    """Read current text and recorded relationships in one protected transaction.

    Empty, repeated, or oversized key lists fail before connecting. More than the
    configured row bounds fail, rather than creating a deceptively partial copy.
    PostgreSQL is required so a READ ONLY, REPEATABLE READ transaction protects
    every query; unsupported engines fail before connecting.
    """
    if not bill_keys or any(
        not isinstance(key, str) or not key.strip() for key in bill_keys
    ):
        raise ValueError("bill_keys must contain nonempty strings")
    if len(bill_keys) != len(set(bill_keys)):
        raise ValueError("bill_keys must not contain duplicates")
    if len(bill_keys) > MAX_BILLS:
        raise SnapshotLimitError(f"At most {MAX_BILLS} bill keys may be exported")
    if not isinstance(embedding_model, str) or not embedding_model.strip():
        raise ValueError("embedding_model must be a nonempty string")
    if embedding_model == "deterministic-sha256":
        raise ValueError("Hash fallback embeddings cannot evaluate semantic retrieval")
    if engine.dialect.name != "postgresql":
        raise ValueError("Snapshot export requires PostgreSQL read-only transactions")

    _validate_questions(questions, query_vectors, bill_keys)

    with engine.connect() as connection, connection.begin():
        # Set protection before any data read. These settings apply only to this
        # transaction, so pooled connections cannot retain the exporter's mode.
        connection.execute(
            text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        )
        connection.execute(text("SET LOCAL statement_timeout = '30s'"))
        bills = _read_rows(connection, _bill_query(bill_keys), MAX_BILLS, "Bills")
        chunks = _read_rows(
            connection,
            _chunk_query(bill_keys, embedding_model),
            MAX_CHUNKS,
            "Text chunks",
        )
        authorships = _read_rows(
            connection,
            _authorship_query(bill_keys),
            MAX_STRUCTURED_RECORDS,
            "Authorship records",
        )
        votes = _read_rows(
            connection, _vote_query(bill_keys), MAX_STRUCTURED_RECORDS, "Vote records"
        )
        if len(authorships) + len(votes) > MAX_STRUCTURED_RECORDS:
            raise SnapshotLimitError(
                "Combined structured records exceed the maximum of 20000; no snapshot exported"
            )

        production_rankings = (
            _production_rankings(
                connection, bills, questions, query_vectors or {}, embedding_model
            )
            if questions
            else {}
        )

    evidence: dict[str, dict] = {}
    vectors: dict[str, dict] = {}
    for row in chunks:
        url = row["html_url"] or row["pdf_url"] or row["source_url"]
        record = _base_evidence(row, "text", url)
        record.update(
            {
                "text": row["text"],
                "citation_label": row["citation_label"],
                "bill_version_id": row["bill_version_id"],
                "current_version_id": row["bill_version_id"],
                "version_code": row["version_code"],
                "is_current_version": True,
                "section_id": row["section_id"],
                "source_order": row["section_source_order"],
                "chunk_index": row["chunk_index"],
                "rag_section_document_id": row["rag_section_document_id"],
                "section_id_text": row["section_id_text"],
                "section_source_order": row["section_source_order"],
                "section_source_hash": row["section_source_hash"],
                "clean_text_source_hash": row["clean_text_source_hash"],
                "relation": {
                    "from_id": record["id"],
                    "to_id": row["bill_id"],
                    "type": "text_of",
                },
            }
        )
        evidence[record["id"]] = record
        if row["embedding"] is not None:
            vectors[record["id"]] = {
                "model": row["embedding_model"],
                "values": [float(value) for value in row["embedding"]],
            }

    for row in authorships:
        record = _base_evidence(row, "authorship", row["official_url"])
        role = "chief author" if row["role"] == "chief_author" else "co-author"
        author = (
            row["full_name"] or f"Unresolved author identity ({row['committee_id']})"
        )
        chamber = row["source_chamber"] or "source chamber not recorded"
        record.update(
            {
                "text": f"{author} is recorded as {role} of {row['bill_key']} in the {chamber} authorship list. The record does not establish when the relationship began or ended.",
                "citation_label": f"{row['bill_key']} authorship list ({chamber})",
                "role": row["role"],
                "source_chamber": row["source_chamber"],
                "source_order": row["source_order"],
                "legislator_id": row["legislator_id"],
                "legislator_name": row["full_name"],
                "committee_id": row["committee_id"],
                "relation": {
                    "from_id": row["legislator_id"] or row["committee_id"],
                    "to_id": row["bill_id"],
                    "type": row["role"],
                },
            }
        )
        if not row["full_name"]:
            record.update(eligible=False, ineligible_reason="missing_author_identity")
        evidence[record["id"]] = record

    for row in votes:
        record = _base_evidence(row, "vote", row["official_url"])
        motion = row["motion"] or "motion not recorded"
        occurred = row["source_occurred_at"] or "date not recorded"
        record.update(
            {
                "text": f"{row['full_name']} is recorded with vote '{row['vote_value']}' on {row['bill_key']}, {row['chamber']} event {row['event_id']} dated {occurred}, motion: {motion}.",
                "citation_label": f"{row['bill_key']} {row['chamber']} roll call ({occurred}; {motion})",
                "legislator_id": row["legislator_id"],
                "legislator_name": row["full_name"],
                "vote_value": row["vote_value"],
                "event_id": row["event_id"],
                "motion": row["motion"],
                "result_text": row["result_text"],
                "chamber": row["chamber"],
                "chamber_id": row["chamber_id"],
                "relation": {
                    "from_id": row["legislator_id"],
                    "to_id": row["event_id"],
                    "type": "recorded_vote",
                },
            }
        )
        evidence[record["id"]] = record

    bill_map = {bill["bill_key"]: bill for bill in bills}
    snapshot = {
        "manifest": {
            "schema_version": SCHEMA_VERSION,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "requested_bill_keys": list(bill_keys),
            "missing_bill_keys": sorted(set(bill_keys) - bill_map.keys()),
            "embedding_model": embedding_model,
            "capture_code_hashes": {
                name: hashlib.sha256(
                    (Path(__file__).resolve().parents[2] / name).read_bytes()
                ).hexdigest()
                for name in (
                    "alethical/eval/graph_snapshot.py",
                    "alethical/api/routers/ask.py",
                    "alethical/db/models.py",
                )
            },
            "counts": {
                "bills": len(bills),
                "text": len(chunks),
                "authorship": len(authorships),
                "vote": len(votes),
                "missing_section_ids": sum(row["section_id"] is None for row in chunks),
                "missing_source_artifacts": sum(
                    record["source_artifact_id"] is None for record in evidence.values()
                ),
                "ineligible": sum(
                    not record["eligible"] for record in evidence.values()
                ),
            },
            "timestamp_meanings": {
                "imported_at": "database row creation",
                "observed_at": "database row last update",
                "source_occurred_at": "version document date or vote event date; unknown for authorship",
            },
        },
        "bills": bill_map,
        "evidence": evidence,
        "vectors": vectors,
        "production_rankings": production_rankings,
    }
    snapshot["manifest"]["content_digest"] = snapshot_digest(snapshot)
    return snapshot
