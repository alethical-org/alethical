#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session, selectinload

from alethical.db import models as schema
from alethical.db.session import get_database_url, normalize_database_url


AIEnrichment = schema.AIEnrichment
Bill = schema.Bill
BillVersion = schema.BillVersion
BillVersionSection = schema.BillVersionSection
EnrichmentType = schema.EnrichmentType
LegislativeSession = schema.LegislativeSession
RagSectionDocument = schema.RagSectionDocument
Sponsorship = schema.Sponsorship

OPENAI_API_BASE = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-5.2"
DEFAULT_OUTPUT_DIR = Path(".tmp/openai-batches")
MAX_BATCH_REQUESTS = 50_000
MAX_BATCH_FILE_BYTES = 200 * 1024 * 1024


SUMMARY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "what": {"type": "string"},
        "why": {"type": "string"},
        "summary": {"type": "string"},
        "plain_language_summary": {"type": "string"},
        "key_changes": {"type": "array", "items": {"type": "string"}},
        "who_affected": {"type": "array", "items": {"type": "string"}},
        "supporters_may_say": {"type": "array", "items": {"type": "string"}},
        "concerns_may_raise": {"type": "array", "items": {"type": "string"}},
        "quick_summary": {"type": "string"},
        "key_points": {"type": "array", "items": {"type": "string"}},
        "key_talking_points": {"type": "array", "items": {"type": "string"}},
        "policy_areas": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "truncated_source": {"type": "boolean"},
        "potential_benefits": {"type": "array", "items": {"type": "string"}},
        "potential_concerns": {"type": "array", "items": {"type": "string"}},
        "detailed_impact_analysis": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "economic": {"type": "array", "items": {"type": "string"}},
                "social": {"type": "array", "items": {"type": "string"}},
                "environmental": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["economic", "social", "environmental"],
        },
        "sentiment_analysis": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "overall_tone": {"type": "string"},
                "language_assessment": {"type": "string"},
                "emotional_appeal": {"type": "string"},
            },
            "required": ["overall_tone", "language_assessment", "emotional_appeal"],
        },
        "bias_detection": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "objectivity_score": {"type": "integer"},
                "detected_biases": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["objectivity_score", "detected_biases"],
        },
        "recommendations": {"type": "array", "items": {"type": "string"}},
        "alternative_policy_approaches": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "key_differences": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["title", "description", "key_differences"],
            },
        },
        "source_notes": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "what",
        "why",
        "summary",
        "plain_language_summary",
        "key_changes",
        "who_affected",
        "supporters_may_say",
        "concerns_may_raise",
        "quick_summary",
        "key_points",
        "key_talking_points",
        "policy_areas",
        "confidence",
        "truncated_source",
        "potential_benefits",
        "potential_concerns",
        "detailed_impact_analysis",
        "sentiment_analysis",
        "bias_detection",
        "recommendations",
        "alternative_policy_approaches",
        "source_notes",
    ],
}


SYSTEM_PROMPT = """You write careful, source-grounded legislative analysis for Alethical.

Return JSON matching the provided schema. Base the analysis only on the supplied bill metadata and bill text excerpts. Do not invent vote outcomes, author motives, public opinion, fiscal scores, or legal effects not supported by the text. If a field cannot be supported, use cautious language or an empty array. Keep wording neutral and make both benefits and concerns conditional when the bill text does not prove real-world outcomes."""


@dataclass(frozen=True)
class ManifestItem:
    custom_id: str
    bill_id: str
    bill_key: str
    bill_version_id: str
    model: str
    source_version_hash: str


def supabase_database_url() -> str | None:
    project_url = os.environ.get("SUPABASE_PROJECT_URL")
    password = os.environ.get("SUPABASE_DB_PASSWORD")
    if not project_url or not password:
        return None
    project_ref = re.sub(r"^https?://([^.]+).*$", r"\1", project_url)
    return f"postgresql+psycopg://postgres:{password}@db.{project_ref}.supabase.co:5432/postgres?sslmode=require"


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def source_hash(parts: list[str]) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def current_bill_version(db: Session, bill_id: Any) -> Any | None:
    return db.scalar(
        select(BillVersion)
        .where(BillVersion.bill_id == bill_id)
        .order_by(BillVersion.is_current.desc(), BillVersion.sequence_number.desc())
        .limit(1)
    )


def bill_text_sections(db: Session, version: Any) -> list[tuple[str, str, str]]:
    rag_rows = db.execute(
        select(RagSectionDocument, BillVersionSection)
        .outerjoin(
            BillVersionSection,
            BillVersionSection.id == RagSectionDocument.bill_version_section_id,
        )
        .where(RagSectionDocument.bill_version_id == version.id)
        .order_by(
            BillVersionSection.source_order.asc().nulls_last(),
            RagSectionDocument.citation_label.asc(),
        )
    ).all()
    if rag_rows:
        return [
            (row.citation_label, row.clean_text, row.source_hash)
            for row, _section in rag_rows
        ]

    section_rows = db.scalars(
        select(BillVersionSection)
        .where(BillVersionSection.bill_version_id == version.id)
        .order_by(BillVersionSection.source_order.asc())
    ).all()
    return [
        (
            " ".join(
                item
                for item in [
                    section.article_number,
                    section.article_heading,
                    section.section_heading or section.section_id_text,
                ]
                if item
            ),
            section.raw_text,
            section.source_hash
            or hashlib.sha256(section.raw_text.encode("utf-8")).hexdigest(),
        )
        for section in section_rows
    ]


def chief_sponsor_names(bill: Any) -> list[str]:
    names: list[str] = []
    for sponsorship in sorted(bill.sponsorships, key=lambda item: item.source_order):
        if (
            sponsorship.role == schema.SponsorshipRole.chief_author
            and sponsorship.legislator is not None
        ):
            names.append(sponsorship.legislator.full_name)
    return names


def bill_prompt(
    db: Session, bill: Any, version: Any, *, max_input_chars: int
) -> tuple[str, str, bool]:
    sections = bill_text_sections(db, version)
    version_hash = source_hash(
        [bill.bill_key, str(version.id), *[item[2] for item in sections]]
    )
    metadata = {
        "bill_key": bill.bill_key,
        "title": bill.title,
        "description": bill.description,
        "current_status": bill.current_status,
        "latest_action_at": bill.latest_action_at.isoformat()
        if bill.latest_action_at
        else None,
        "chief_sponsors": chief_sponsor_names(bill),
        "official_url": bill.official_url,
        "version_code": version.version_code,
        "version_name": version.version_name,
    }

    remaining = max_input_chars
    text_blocks: list[str] = []
    for citation, text, _hash in sections:
        block = f"[{citation}]\n{text.strip()}"
        if len(block) > remaining:
            if remaining > 500:
                text_blocks.append(block[:remaining])
            break
        text_blocks.append(block)
        remaining -= len(block)
    truncated = len(text_blocks) < len(sections)
    metadata["truncated_source"] = truncated
    metadata["included_section_count"] = len(text_blocks)
    metadata["total_section_count"] = len(sections)

    prompt = (
        "Analyze this Minnesota bill for a public-facing product. Produce neutral JSON only.\n\n"
        f"Bill metadata:\n{json.dumps(metadata, ensure_ascii=False, indent=2)}\n\n"
        "Bill text excerpts:\n" + "\n\n---\n\n".join(text_blocks)
    )
    return prompt, version_hash, truncated


def bills_for_batch(
    db: Session, *, session_slug: str | None, bill_key: str | None, limit: int | None
) -> list[Any]:
    stmt = select(Bill).options(
        selectinload(Bill.sponsorships).selectinload(Sponsorship.legislator),
        selectinload(Bill.enrichments),
    )
    if session_slug:
        stmt = stmt.join(
            LegislativeSession, LegislativeSession.id == Bill.session_id
        ).where(LegislativeSession.slug == session_slug)
    if bill_key:
        stmt = stmt.where(Bill.bill_key == bill_key)
    stmt = stmt.order_by(Bill.bill_key.asc())
    if limit:
        stmt = stmt.limit(limit)
    return list(db.scalars(stmt).unique().all())


def should_enqueue(bill: Any, model: str, version_hash: str, *, force: bool) -> bool:
    if force:
        return True
    for enrichment in bill.enrichments:
        if (
            enrichment.enrichment_type == EnrichmentType.bill_summary
            and enrichment.model_name == model
            and enrichment.source_version_hash == version_hash
            and enrichment.is_current
        ):
            return False
    return True


def has_current_summary(bill: Any, model: str) -> bool:
    for enrichment in bill.enrichments:
        if (
            enrichment.enrichment_type == EnrichmentType.bill_summary
            and enrichment.model_name == model
            and enrichment.is_current
        ):
            return True
    return False


def batch_request(custom_id: str, model: str, prompt: str) -> dict[str, Any]:
    return {
        "custom_id": custom_id,
        "method": "POST",
        "url": "/v1/responses",
        "body": {
            "model": model,
            "input": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "bill_summary",
                    "description": "Neutral public-facing bill analysis for Alethical.",
                    "strict": True,
                    "schema": SUMMARY_SCHEMA,
                }
            },
            "max_output_tokens": 2400,
        },
    }


def prepare_batch(args: argparse.Namespace) -> None:
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    database_url = normalize_database_url(
        args.database_url
        or "postgresql+psycopg://alethical:alethical@localhost:54329/alethical"
    )
    engine = create_engine(database_url, pool_pre_ping=True)

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    jsonl_path = output_dir / f"ai-enrichment-{timestamp}.jsonl"
    manifest_path = output_dir / f"ai-enrichment-{timestamp}.manifest.json"

    manifest: list[ManifestItem] = []
    bytes_written = 0
    pending_custom_ids = (
        pending_manifest_custom_ids(output_dir, model=args.model)
        if not args.force
        else set()
    )
    skipped_pending = 0
    skipped_existing_current = 0
    with Session(engine) as db, jsonl_path.open("w", encoding="utf-8") as handle:
        for bill in bills_for_batch(
            db, session_slug=args.session, bill_key=args.bill_key, limit=args.limit
        ):
            if getattr(args, "only_missing_current", False) and has_current_summary(
                bill, args.model
            ):
                skipped_existing_current += 1
                continue
            version = current_bill_version(db, bill.id)
            if version is None:
                continue
            prompt, version_hash, truncated = bill_prompt(
                db, bill, version, max_input_chars=args.max_input_chars
            )
            if not should_enqueue(bill, args.model, version_hash, force=args.force):
                continue
            custom_id = f"bill_summary:{bill.bill_key}:{version_hash[:16]}"
            if custom_id in pending_custom_ids:
                skipped_pending += 1
                continue
            line = json_dumps(batch_request(custom_id, args.model, prompt)) + "\n"
            bytes_written += len(line.encode("utf-8"))
            if len(manifest) + 1 > MAX_BATCH_REQUESTS:
                raise SystemExit(f"Batch request limit exceeded: {MAX_BATCH_REQUESTS}")
            if bytes_written > MAX_BATCH_FILE_BYTES:
                raise SystemExit(
                    f"Batch file size limit exceeded: {MAX_BATCH_FILE_BYTES} bytes"
                )
            handle.write(line)
            manifest.append(
                ManifestItem(
                    custom_id=custom_id,
                    bill_id=str(bill.id),
                    bill_key=bill.bill_key,
                    bill_version_id=str(version.id),
                    model=args.model,
                    source_version_hash=version_hash,
                )
            )

    manifest_path.write_text(
        json.dumps(
            {
                "created_at": timestamp,
                "endpoint": "/v1/responses",
                "jsonl_path": str(jsonl_path),
                "model": args.model,
                "items": [asdict(item) for item in manifest],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "requests": len(manifest),
                "skipped_pending": skipped_pending,
                "skipped_existing_current": skipped_existing_current,
                "jsonl_path": str(jsonl_path),
                "manifest_path": str(manifest_path),
            },
            indent=2,
        )
    )


def openai_headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


def submit_batch(args: argparse.Namespace) -> None:
    api_key = args.api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is required")
    jsonl_path = Path(args.jsonl_path)
    with jsonl_path.open("rb") as handle:
        file_response = requests.post(
            f"{OPENAI_API_BASE}/files",
            headers=openai_headers(api_key),
            files={"file": (jsonl_path.name, handle, "application/jsonl")},
            data={"purpose": "batch"},
            timeout=120,
        )
    file_response.raise_for_status()
    input_file_id = file_response.json()["id"]

    batch_response = requests.post(
        f"{OPENAI_API_BASE}/batches",
        headers={**openai_headers(api_key), "Content-Type": "application/json"},
        json={
            "input_file_id": input_file_id,
            "endpoint": "/v1/responses",
            "completion_window": "24h",
            "metadata": {"job": "alethical_ai_enrichment", "input": jsonl_path.name},
        },
        timeout=120,
    )
    batch_response.raise_for_status()
    print(json.dumps(batch_response.json(), indent=2))


def batch_status(args: argparse.Namespace) -> None:
    api_key = args.api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is required")
    response = requests.get(
        f"{OPENAI_API_BASE}/batches/{args.batch_id}",
        headers=openai_headers(api_key),
        timeout=60,
    )
    response.raise_for_status()
    print(json.dumps(response.json(), indent=2))


def download_batch_output(api_key: str, batch_id: str, output_path: Path) -> None:
    batch_response = requests.get(
        f"{OPENAI_API_BASE}/batches/{batch_id}",
        headers=openai_headers(api_key),
        timeout=60,
    )
    batch_response.raise_for_status()
    batch = batch_response.json()
    if batch.get("status") != "completed":
        raise SystemExit(
            f"Batch is {batch.get('status')}; output is available only after completion"
        )
    output_file_id = batch.get("output_file_id")
    if not output_file_id:
        raise SystemExit("Completed batch has no output_file_id")
    file_response = requests.get(
        f"{OPENAI_API_BASE}/files/{output_file_id}/content",
        headers=openai_headers(api_key),
        timeout=120,
    )
    file_response.raise_for_status()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(file_response.text, encoding="utf-8")


def extract_response_text(body: dict[str, Any]) -> str:
    if isinstance(body.get("output_text"), str):
        return body["output_text"]
    fragments: list[str] = []
    for item in body.get("output", []) or []:
        for content in item.get("content", []) or []:
            if isinstance(content.get("text"), str):
                fragments.append(content["text"])
    return "".join(fragments).strip()


def load_manifest(path: Path) -> dict[str, ManifestItem]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {item["custom_id"]: ManifestItem(**item) for item in payload["items"]}


def pending_manifest_custom_ids(
    output_dir: Path, *, model: str | None = None
) -> set[str]:
    custom_ids: set[str] = set()
    for path in output_dir.glob("ai-enrichment-*.manifest.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for item in payload.get("items", []):
            if model is not None and item.get("model") != model:
                continue
            custom_id = item.get("custom_id")
            if isinstance(custom_id, str):
                custom_ids.add(custom_id)
    return custom_ids


def apply_output(args: argparse.Namespace) -> None:
    api_key = args.api_key or os.environ.get("OPENAI_API_KEY")
    output_path = Path(args.output_path) if args.output_path else None
    if args.batch_id:
        if not api_key:
            raise SystemExit(
                "OPENAI_API_KEY is required when downloading output by batch id"
            )
        output_path = (
            output_path or Path(args.output_dir) / f"{args.batch_id}.output.jsonl"
        )
        download_batch_output(api_key, args.batch_id, output_path)
    if output_path is None:
        raise SystemExit("--output-path or --batch-id is required")

    manifest = load_manifest(Path(args.manifest_path))
    database_url = normalize_database_url(
        args.database_url
        or "postgresql+psycopg://alethical:alethical@localhost:54329/alethical"
    )
    engine = create_engine(database_url, pool_pre_ping=True)
    applied = 0
    failed = 0
    with Session(engine) as db:
        for line in output_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            custom_id = row.get("custom_id")
            item = manifest.get(custom_id)
            if item is None:
                failed += 1
                continue
            response = row.get("response") or {}
            if response.get("status_code") != 200:
                failed += 1
                continue
            text = extract_response_text(response.get("body") or {})
            try:
                content = json.loads(text)
            except json.JSONDecodeError:
                failed += 1
                continue
            content["_meta"] = {
                "model": item.model,
                "source_version_hash": item.source_version_hash,
                "openai_batch_id": args.batch_id,
            }
            bill_id = uuid.UUID(item.bill_id)
            bill_version_id = uuid.UUID(item.bill_version_id)

            db.execute(
                update(AIEnrichment)
                .where(
                    AIEnrichment.bill_id == bill_id,
                    AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
                    AIEnrichment.is_current.is_(True),
                )
                .values(is_current=False)
            )
            existing = db.scalar(
                select(AIEnrichment).where(
                    AIEnrichment.bill_id == bill_id,
                    AIEnrichment.bill_version_id == bill_version_id,
                    AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
                    AIEnrichment.model_name == item.model,
                    AIEnrichment.source_version_hash == item.source_version_hash,
                )
            )
            if existing is None:
                existing = AIEnrichment(
                    bill_id=bill_id,
                    bill_version_id=bill_version_id,
                    enrichment_type=EnrichmentType.bill_summary,
                    model_name=item.model,
                    source_version_hash=item.source_version_hash,
                    content_json=content,
                    is_current=True,
                )
                db.add(existing)
            else:
                existing.content_json = content
                existing.is_current = True
            applied += 1
        if args.dry_run:
            db.rollback()
        else:
            db.commit()
    print(
        json.dumps(
            {"applied": applied, "failed": failed, "dry_run": args.dry_run}, indent=2
        )
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prepare, submit, and apply OpenAI Batch API bill AI enrichments."
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL")
        or supabase_database_url()
        or get_database_url(),
    )
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser(
        "prepare", help="Build a Batch API JSONL file and local manifest."
    )
    prepare.add_argument(
        "--model", default=os.environ.get("OPENAI_AI_ENRICHMENT_MODEL", DEFAULT_MODEL)
    )
    prepare.add_argument("--session", default="94-2025-regular")
    prepare.add_argument("--bill-key", default=None)
    prepare.add_argument("--limit", type=int, default=None)
    prepare.add_argument("--max-input-chars", type=int, default=60_000)
    prepare.add_argument("--force", action="store_true")
    prepare.add_argument("--only-missing-current", action="store_true")
    prepare.set_defaults(func=prepare_batch)

    submit = subparsers.add_parser(
        "submit", help="Upload a JSONL file and create an OpenAI batch."
    )
    submit.add_argument("jsonl_path")
    submit.set_defaults(func=submit_batch)

    status = subparsers.add_parser("status", help="Retrieve an OpenAI batch status.")
    status.add_argument("batch_id")
    status.set_defaults(func=batch_status)

    apply = subparsers.add_parser(
        "apply", help="Download or read batch output and upsert ai_enrichment rows."
    )
    apply.add_argument("--manifest-path", required=True)
    apply.add_argument("--batch-id", default=None)
    apply.add_argument("--output-path", default=None)
    apply.add_argument("--dry-run", action="store_true")
    apply.set_defaults(func=apply_output)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if not args.database_url:
        raise SystemExit("DATABASE_URL or Supabase env vars are required")
    args.func(args)


if __name__ == "__main__":
    main()
