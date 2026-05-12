from __future__ import annotations

from collections.abc import Iterable
from hashlib import sha256
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from alethical.db import models as schema
from alethical.pipeline import rag as rag_text


DEFAULT_RAG_MODEL = "demo-minilm-1536"
DEFAULT_RAG_BATCH_SIZE = 32
VECTOR_DIMENSIONS = 1536


def _deterministic_embedding(text: str, dimensions: int = VECTOR_DIMENSIONS) -> list[float]:
    values: list[float] = []
    seed = text.encode("utf-8")
    counter = 0
    while len(values) < dimensions:
        digest = sha256(seed + counter.to_bytes(4, "big")).digest()
        for offset in range(0, len(digest), 4):
            chunk = digest[offset : offset + 4]
            scaled = (int.from_bytes(chunk, "big") / 0xFFFFFFFF) * 2.0 - 1.0
            values.append(scaled)
            if len(values) == dimensions:
                break
        counter += 1
    norm = sum(value * value for value in values) ** 0.5 or 1.0
    return [value / norm for value in values]


def _chunk_payloads(file_type: str, file_number: int, bill: Any, section: Any) -> dict[str, Any]:
    article_meta = {
        "article_id": section.article_id_text or "",
        "article_number": section.article_number or "",
        "article_heading": section.article_heading or "",
    }
    section_payload = {
        "heading": section.section_heading or section.section_id_text,
        "statute_heading": section.statute_heading or "",
        "cite_heading": section.cite_heading or "",
        "effective_date_heading": section.effective_date_heading or "",
    }
    clean_text, _metrics = rag_text.clean_section_text(section.raw_text)
    paragraphs = [paragraph for paragraph in clean_text.split("\n\n") if paragraph]
    citation_parts = [f"{file_type} {file_number}"]
    if article_meta["article_number"]:
        citation_parts.append(article_meta["article_number"])
    if section_payload["heading"]:
        citation_parts.append(section_payload["heading"])
    section_source_hash = rag_text.source_hash(section.raw_text or "")
    chunk_prefix = rag_text.compact_chunk_prefix(file_type, file_number, article_meta, section_payload)
    chunk_texts = rag_text.chunk_paragraphs(paragraphs, chunk_prefix)

    section_prefix = rag_text.full_section_prefix(file_type, file_number, bill.title or "", article_meta, section_payload)
    return {
        "bill_version_section_id": section.id,
        "section_id_text": section.section_id_text,
        "citation_label": ", ".join(citation_parts),
        "clean_text": clean_text,
        "search_text": f"{section_prefix}\n\n{clean_text}".strip(),
        "source_hash": section_source_hash,
        "word_count": rag_text.word_count(clean_text),
        "chunks": [
            {
                "chunk_index": index,
                "citation_label": ", ".join(citation_parts),
                "chunk_text": chunk_text,
                "search_text": chunk_text,
                "word_count": rag_text.word_count(chunk_text),
            }
            for index, chunk_text in enumerate(chunk_texts)
        ],
    }


def _bill_keys(iterable: Iterable[str | Any]) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for value in iterable:
        key = str(value)
        if key in seen:
            continue
        seen.add(key)
        values.append(key)
    return values


def _bill_rag_sections_complete(
    db: Any,
    version_id: Any,
    expected_sections: list[dict[str, Any]],
) -> bool:
    section_docs = db.scalars(
        select(schema.RagSectionDocument).where(
            schema.RagSectionDocument.bill_version_id == version_id,
            schema.RagSectionDocument.cleaning_version == rag_text.CLEANING_VERSION,
        )
    ).all()
    if len(section_docs) != len(expected_sections):
        return False

    section_by_id: dict[Any, schema.RagSectionDocument] = {
        doc.bill_version_section_id: doc
        for doc in section_docs
        if doc.bill_version_section_id is not None
    }
    if len(section_by_id) != len(expected_sections):
        return False

    for expected in expected_sections:
        doc = section_by_id.get(expected["bill_version_section_id"])
        if doc is None or doc.source_hash != expected["source_hash"]:
            return False
        existing_chunks = db.scalars(
            select(schema.RagChunk).where(
                schema.RagChunk.rag_section_document_id == doc.id,
                schema.RagChunk.chunking_version == rag_text.CHUNKING_VERSION,
            ).order_by(schema.RagChunk.chunk_index.asc())
        ).all()
        expected_chunks = expected["chunks"]
        if len(existing_chunks) != len(expected_chunks):
            return False
        for chunk_index, (expected_chunk, existing_chunk) in enumerate(zip(expected_chunks, existing_chunks)):
            if (
                existing_chunk.chunk_index != expected_chunk["chunk_index"]
                or existing_chunk.chunk_text != expected_chunk["chunk_text"]
            ):
                return False
            if existing_chunk.citation_label != expected_chunk["citation_label"]:
                return False
            if existing_chunk.chunking_version != rag_text.CHUNKING_VERSION:
                return False
            if existing_chunk.word_count != expected_chunk["word_count"]:
                return False
            if chunk_index != expected_chunk["chunk_index"]:
                return False
        if doc.citation_label != expected["citation_label"]:
            return False
        if doc.word_count != expected["word_count"]:
            return False

    return True


def _delete_bill_rag_rows(db: Any, bill_id: Any, version_id: Any) -> dict[str, int]:
    section_ids = list(
        db.scalars(
            select(schema.RagSectionDocument.id).where(
                schema.RagSectionDocument.bill_id == bill_id,
                schema.RagSectionDocument.bill_version_id == version_id,
            )
        ).all()
    )
    if not section_ids:
        return {"deleted_sections": 0, "deleted_chunks": 0, "deleted_embeddings": 0}

    chunk_ids = list(
        db.scalars(
            select(schema.RagChunk.id).where(schema.RagChunk.rag_section_document_id.in_(section_ids))
        ).all()
    )
    deleted_embeddings = 0
    deleted_chunks = 0
    if chunk_ids:
        db.execute(
            delete(schema.RagChunkEmbedding).where(
                schema.RagChunkEmbedding.rag_chunk_id.in_(chunk_ids)
            )
        )
        deleted_embeddings = len(chunk_ids)
    if section_ids:
        db.execute(delete(schema.RagChunk).where(schema.RagChunk.rag_section_document_id.in_(section_ids)))
        deleted_chunks = len(chunk_ids)

    db.execute(delete(schema.RagSectionDocument).where(schema.RagSectionDocument.id.in_(section_ids)))
    return {
        "deleted_sections": len(section_ids),
        "deleted_chunks": deleted_chunks,
        "deleted_embeddings": deleted_embeddings,
    }


def _build_embeddings(texts: list[str], *, model: str, batch_size: int) -> list[list[float]]:
    _ = batch_size
    if not texts:
        return []
    if str(model) != DEFAULT_RAG_MODEL:
        # Force local deterministic embeddings to remain stable and uniform.
        # Keeping a different model here would violate the pipeline-wide embedding policy.
        model = DEFAULT_RAG_MODEL
    return [_deterministic_embedding(text, dimensions=VECTOR_DIMENSIONS) for text in texts]


def _upsert_rag_section_with_chunks(
    db,
    *,
    bill_id: Any,
    bill_version_id: Any,
    section_payload: dict[str, Any],
) -> list[tuple[schema.RagChunk, str]]:
    section_id = section_payload["bill_version_section_id"]
    chunk_text_rows: list[tuple[schema.RagChunk, str]] = []
    upsert = (
        insert(schema.RagSectionDocument)
        .values(
            bill_id=bill_id,
            bill_version_id=bill_version_id,
            bill_version_section_id=section_id,
            citation_label=section_payload["citation_label"],
            clean_text=section_payload["clean_text"],
            search_text=section_payload["search_text"],
            cleaning_version=rag_text.CLEANING_VERSION,
            source_hash=section_payload["source_hash"],
            word_count=section_payload["word_count"],
        )
        .on_conflict_do_update(
            index_elements=[
                schema.RagSectionDocument.bill_version_id,
                schema.RagSectionDocument.bill_version_section_id,
                schema.RagSectionDocument.cleaning_version,
            ],
            set_={
                "bill_id": bill_id,
                "citation_label": section_payload["citation_label"],
                "clean_text": section_payload["clean_text"],
                "search_text": section_payload["search_text"],
                "source_hash": section_payload["source_hash"],
                "word_count": section_payload["word_count"],
            },
        )
        .returning(schema.RagSectionDocument.id)
    )
    section_db_id = db.execute(upsert).scalar_one()

    # Remove stale chunks + embeddings before writing replacements for this section.
    old_chunk_ids = list(
        db.scalars(
            select(schema.RagChunk.id).where(schema.RagChunk.rag_section_document_id == section_db_id)
        ).all()
    )
    if old_chunk_ids:
        db.execute(delete(schema.RagChunkEmbedding).where(schema.RagChunkEmbedding.rag_chunk_id.in_(old_chunk_ids)))
        db.execute(delete(schema.RagChunk).where(schema.RagChunk.id.in_(old_chunk_ids)))

    for chunk in section_payload["chunks"]:
        rag_chunk = schema.RagChunk(
            rag_section_document_id=section_db_id,
            chunk_index=chunk["chunk_index"],
            citation_label=chunk["citation_label"],
            chunk_text=chunk["chunk_text"],
            search_text=chunk["search_text"],
            chunking_version=rag_text.CHUNKING_VERSION,
            word_count=chunk["word_count"],
            token_estimate=chunk["word_count"],
        )
        db.add(rag_chunk)
        db.flush()
        chunk_text_rows.append((rag_chunk, chunk["chunk_text"]))

    return chunk_text_rows


def build_rag_rows_for_bill_keys(
    db,
    bill_keys: Iterable[str | Any],
    *,
    dry_run: bool = False,
    rag_model: str = DEFAULT_RAG_MODEL,
    rag_embedding_batch_size: int = DEFAULT_RAG_BATCH_SIZE,
) -> dict[str, Any]:
    rag_model = DEFAULT_RAG_MODEL
    bill_keys = _bill_keys(bill_keys)
    summary: dict[str, Any] = {
        "bill_keys": bill_keys,
        "bills_processed": 0,
        "rag_built": 0,
        "rag_skipped": 0,
        "rag_already_exists": 0,
        "rag_results": [],
    }

    for bill_key in bill_keys:
        bill = db.scalar(select(schema.Bill).where(schema.Bill.bill_key == bill_key))
        if bill is None:
            summary["rag_skipped"] += 1
            summary["rag_results"].append(
                {
                    "bill_key": bill_key,
                    "status": "missing_bill",
                    "rag_section_count": 0,
                    "rag_chunk_count": 0,
                }
            )
            continue

        bill_version = db.scalar(
            select(schema.BillVersion)
            .where(schema.BillVersion.bill_id == bill.id)
            .order_by(schema.BillVersion.is_current.desc(), schema.BillVersion.sequence_number.desc())
            .limit(1)
        )
        if bill_version is None:
            summary["rag_skipped"] += 1
            summary["rag_results"].append(
                {
                    "bill_key": bill_key,
                    "status": "missing_version",
                    "rag_section_count": 0,
                    "rag_chunk_count": 0,
                }
            )
            continue

        sections = db.scalars(
            select(schema.BillVersionSection)
            .where(schema.BillVersionSection.bill_version_id == bill_version.id)
            .order_by(schema.BillVersionSection.source_order.asc())
        ).all()
        if not sections:
            summary["rag_skipped"] += 1
            summary["rag_results"].append(
                {
                    "bill_key": bill_key,
                    "status": "no_sections",
                    "rag_section_count": 0,
                    "rag_chunk_count": 0,
                }
            )
            continue

        prepared_sections = [
            _chunk_payloads(str(bill.file_type), bill.file_number, bill, section)
            for section in sections
        ]
        summary["bills_processed"] += 1

        if _bill_rag_sections_complete(db, bill_version.id, prepared_sections):
            summary["rag_already_exists"] += 1
            summary["rag_results"].append(
                {
                    "bill_key": bill_key,
                    "status": "already_exists",
                    "rag_section_count": len(prepared_sections),
                    "rag_chunk_count": sum(len(section["chunks"]) for section in prepared_sections),
                }
            )
            continue

        if dry_run:
            summary["rag_skipped"] += 1
            summary["rag_results"].append(
                {
                    "bill_key": bill_key,
                    "status": "would_build",
                    "rag_section_count": len(prepared_sections),
                    "rag_chunk_count": sum(len(section["chunks"]) for section in prepared_sections),
                }
            )
            continue

        chunk_rows: list[tuple[schema.RagChunk, str]] = []
        for section in prepared_sections:
            chunk_rows.extend(
                _upsert_rag_section_with_chunks(
                    db,
                    bill_id=bill.id,
                    bill_version_id=bill_version.id,
                    section_payload=section,
                )
            )

        embeddings = _build_embeddings(
            [chunk_text for _, chunk_text in chunk_rows],
            model=rag_model,
            batch_size=max(1, rag_embedding_batch_size),
        )
        embedding_flush_size = max(1, rag_embedding_batch_size)
        for index, ((rag_chunk, _chunk_text), embedding) in enumerate(zip(chunk_rows, embeddings), start=1):
            db.add(schema.RagChunkEmbedding(rag_chunk_id=rag_chunk.id, embedding_model=rag_model, embedding=embedding))
            if index % embedding_flush_size == 0:
                db.flush()
        if embeddings:
            db.flush()

        summary["rag_built"] += 1
        summary["rag_results"].append(
            {
                "bill_key": bill_key,
                "status": "built",
                "rag_section_count": len(prepared_sections),
                "rag_chunk_count": sum(len(section["chunks"]) for section in prepared_sections),
                "deleted": True,
                "sections": [section["section_id_text"] for section in prepared_sections],
            }
        )
        summary["rag_section_count"] = summary.get("rag_section_count", 0) + len(prepared_sections)
        summary["rag_chunk_count"] = summary.get("rag_chunk_count", 0) + sum(
            len(section["chunks"]) for section in prepared_sections
        )

    return summary
