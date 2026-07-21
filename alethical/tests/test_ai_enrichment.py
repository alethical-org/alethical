from __future__ import annotations

import json
from types import SimpleNamespace

from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_database_url
from alethical.pipeline import ai_enrichment


def _session() -> Session:
    return Session(create_engine(get_database_url(), pool_pre_ping=True))


def _make_bill_with_summary(
    db: Session, *, bill_key: str, file_number: int, content: dict
) -> tuple:
    """Create an isolated bill + current version + current bill_summary
    enrichment so the title backfill has something to patch. Returns
    (bill_id, bill_version_id)."""
    session_id = db.scalar(select(schema.LegislativeSession.id))
    chamber_id = db.scalar(select(schema.Chamber.id))
    assert session_id is not None and chamber_id is not None
    bill = schema.Bill(
        session_id=session_id,
        chamber_id=chamber_id,
        bill_key=bill_key,
        file_type="HF",
        file_number=file_number,
        title="A relating to statutory run-on title that is far too long " * 6,
        description="Test bill for short-title enrichment",
        current_status="Referred to committee",
    )
    db.add(bill)
    db.flush()
    version = schema.BillVersion(
        bill_id=bill.id,
        version_code="test-v1",
        sequence_number=0,
        is_current=True,
    )
    db.add(version)
    db.flush()
    enrichment = schema.AIEnrichment(
        bill_id=bill.id,
        bill_version_id=version.id,
        enrichment_type=schema.EnrichmentType.bill_summary,
        model_name="gpt-4o-mini",
        source_version_hash="test-source-hash",
        content_json=content,
        is_current=True,
    )
    db.add(enrichment)
    db.commit()
    return bill.id, version.id


def _cleanup(db: Session, bill_id) -> None:
    db.execute(
        delete(schema.AIEnrichment).where(schema.AIEnrichment.bill_id == bill_id)
    )
    version_ids = list(
        db.scalars(
            select(schema.BillVersion.id).where(schema.BillVersion.bill_id == bill_id)
        )
    )
    if version_ids:
        db.execute(
            delete(schema.BillVersionSection).where(
                schema.BillVersionSection.bill_version_id.in_(version_ids)
            )
        )
    db.execute(delete(schema.BillVersion).where(schema.BillVersion.bill_id == bill_id))
    db.execute(delete(schema.Bill).where(schema.Bill.id == bill_id))
    db.commit()


def test_merge_apply_patches_short_title_and_preserves_other_fields(tmp_path) -> None:
    original = {
        "summary": "This bill does a specific thing.",
        "key_points": ["point one", "point two"],
        "policy_areas": ["Education"],
        "_meta": {
            "model": "gpt-4o-mini",
            "source_version_hash": "test-source-hash",
            "openai_batch_id": "batch_original",
        },
    }
    with _session() as db:
        bill_id, version_id = _make_bill_with_summary(
            db,
            bill_key="test-2025-HF999001",
            file_number=999001,
            content=dict(original),
        )
    try:
        custom_id = "bill_title:test-2025-HF999001:deadbeefdeadbeef"
        manifest = {
            "created_at": "20260715T000000Z",
            "endpoint": "/v1/responses",
            "mode": "titles_only",
            "model": "gpt-4o-mini",
            "items": [
                {
                    "custom_id": custom_id,
                    "bill_id": str(bill_id),
                    "bill_key": "test-2025-HF999001",
                    "bill_version_id": str(version_id),
                    "model": "gpt-4o-mini",
                    "source_version_hash": "test-meta-hash",
                }
            ],
        }
        manifest_path = tmp_path / "manifest.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        # Mocked LLM output: a static batch-output file, no OpenAI call.
        output_row = {
            "custom_id": custom_id,
            "response": {
                "status_code": 200,
                "body": {
                    "output_text": json.dumps({"short_title": "Neutral Short Title"})
                },
            },
        }
        output_path = tmp_path / "output.jsonl"
        output_path.write_text(json.dumps(output_row) + "\n", encoding="utf-8")

        result = ai_enrichment.apply_output(
            SimpleNamespace(
                api_key=None,
                output_path=str(output_path),
                output_dir=str(tmp_path),
                batch_id=None,
                manifest_path=str(manifest_path),
                database_url=get_database_url(),
                dry_run=False,
            )
        )
        assert result is None  # apply_output prints a summary, returns None

        with _session() as db:
            enrichment = db.scalar(
                select(schema.AIEnrichment).where(
                    schema.AIEnrichment.bill_id == bill_id,
                    schema.AIEnrichment.enrichment_type
                    == schema.EnrichmentType.bill_summary,
                    schema.AIEnrichment.is_current.is_(True),
                )
            )
            assert enrichment is not None
            patched = enrichment.content_json
            # short_title patched in
            assert patched["short_title"] == "Neutral Short Title"
            # other content_json fields preserved untouched
            assert patched["summary"] == original["summary"]
            assert patched["key_points"] == original["key_points"]
            assert patched["policy_areas"] == original["policy_areas"]
            # existing _meta preserved, provenance added without clobbering
            assert patched["_meta"]["model"] == "gpt-4o-mini"
            assert patched["_meta"]["source_version_hash"] == "test-source-hash"
            assert patched["_meta"]["openai_batch_id"] == "batch_original"
            assert patched["_meta"]["short_title_model"] == "gpt-4o-mini"
            # the row stays current (merge must not flip is_current)
            assert enrichment.is_current is True
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_titles_only_prepare_request_shape_is_pinned_to_gpt_4o_mini(tmp_path) -> None:
    with _session() as db:
        bill_id, _version_id = _make_bill_with_summary(
            db,
            bill_key="test-2025-HF999002",
            file_number=999002,
            content={
                "summary": "Summary without a short title yet.",
                "key_points": [],
                "policy_areas": [],
            },
        )
    try:
        ai_enrichment.prepare_batch(
            SimpleNamespace(
                database_url=get_database_url(),
                output_dir=str(tmp_path),
                # Deliberately pass a non-title model to prove title-only overrides it.
                model="gpt-5.2",
                session=None,
                bill_key="test-2025-HF999002",
                limit=None,
                max_input_chars=60_000,
                force=False,
                only_missing_current=False,
                titles_only=True,
            )
        )

        manifest_path = next(tmp_path.glob("ai-enrichment-*.manifest.json"))
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert manifest["mode"] == "titles_only"
        assert manifest["model"] == "gpt-4o-mini"
        assert len(manifest["items"]) == 1

        jsonl_path = next(tmp_path.glob("ai-enrichment-*.jsonl"))
        lines = [
            line
            for line in jsonl_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        assert len(lines) == 1
        request = json.loads(lines[0])
        body = request["body"]
        assert body["model"] == "gpt-4o-mini"
        assert request["custom_id"].startswith("bill_title:")
        fmt = body["text"]["format"]
        assert fmt["name"] == "bill_short_title"
        assert fmt["schema"] == ai_enrichment.SHORT_TITLE_SCHEMA
        assert body["input"][0]["content"] == ai_enrichment.SHORT_TITLE_SYSTEM_PROMPT
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_titles_only_prepare_skips_bills_that_already_have_a_short_title(
    tmp_path,
) -> None:
    with _session() as db:
        bill_id, _version_id = _make_bill_with_summary(
            db,
            bill_key="test-2025-HF999003",
            file_number=999003,
            content={
                "summary": "Already-titled summary.",
                "key_points": [],
                "policy_areas": [],
                "short_title": "Existing Short Title",
            },
        )
    try:
        ai_enrichment.prepare_batch(
            SimpleNamespace(
                database_url=get_database_url(),
                output_dir=str(tmp_path),
                model="gpt-5.2",
                session=None,
                bill_key="test-2025-HF999003",
                limit=None,
                max_input_chars=60_000,
                force=False,
                only_missing_current=False,
                titles_only=True,
            )
        )
        manifest_path = next(tmp_path.glob("ai-enrichment-*.manifest.json"))
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert manifest["items"] == []
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def _make_bill_with_sections(
    db: Session, *, bill_key: str, file_number: int, sections: list[tuple[str, str]]
):
    """Create a bill + current version + BillVersionSection rows. `sections` is
    an ordered list of (section_id_text, raw_text). Returns (bill_id, version_id)."""
    session_id = db.scalar(select(schema.LegislativeSession.id))
    chamber_id = db.scalar(select(schema.Chamber.id))
    assert session_id is not None and chamber_id is not None
    bill = schema.Bill(
        session_id=session_id,
        chamber_id=chamber_id,
        bill_key=bill_key,
        file_type="HF",
        file_number=file_number,
        title="Traceable citations test bill",
        description="Test bill for #377 key-point anchors",
        current_status="Referred to committee",
        official_url="https://www.revisor.mn.gov/bills/test",
    )
    db.add(bill)
    db.flush()
    version = schema.BillVersion(
        bill_id=bill.id,
        version_code="test-v1",
        sequence_number=0,
        is_current=True,
    )
    db.add(version)
    db.flush()
    for order, (section_id_text, raw_text) in enumerate(sections):
        db.add(
            schema.BillVersionSection(
                bill_version_id=version.id,
                section_id_text=section_id_text,
                source_order=order,
                section_heading=f"Section {section_id_text}",
                raw_text=raw_text,
            )
        )
    db.commit()
    return bill.id, version.id


def test_resolve_key_point_citations_grounds_and_cites_anchorable_subset() -> None:
    with _session() as db:
        bill_id, version_id = _make_bill_with_sections(
            db,
            bill_key="test-2025-HF999010",
            file_number=999010,
            sections=[
                (
                    "1.1",
                    "The commissioner shall establish a grant program for schools.",
                ),
                ("2.1", "Each district must submit an annual report by January 15."),
            ],
        )
    try:
        content = {
            "key_points": [
                "Creates a school grant program.",  # S1, valid quote
                "Requires an annual district report.",  # S2, valid quote
                "Imposes a fine on late filers.",  # bad anchor S9 → dropped
                "Paraphrased point with no matching quote.",  # quote not in excerpt
            ],
            "key_point_citations": [
                {
                    "point": "Creates a school grant program.",
                    "section_id": "S1",
                    "quote": "establish a grant program for schools",
                },
                {
                    "point": "Requires an annual district report.",
                    "section_id": "S2",
                    "quote": "submit an annual report by January 15",
                },
                {
                    "point": "Imposes a fine on late filers.",
                    "section_id": "S9",  # not a supplied anchor → dropped
                    "quote": "submit an annual report",
                },
                {
                    "point": "Paraphrased point with no matching quote.",
                    "section_id": "S1",
                    "quote": "this text is nowhere in the bill",  # verbatim check fails
                },
            ],
        }
        with _session() as db:
            stats = ai_enrichment.resolve_key_point_citations(db, version_id, content)

        assert stats == {"points": 4, "anchored": 2, "dropped": 2}
        # All key points are preserved for display; only the two grounded ones
        # get a citation (unanchorable points show without a marker).
        assert content["key_points"] == [
            "Creates a school grant program.",
            "Requires an annual district report.",
            "Imposes a fine on late filers.",
            "Paraphrased point with no matching quote.",
        ]
        resolved = content["key_point_citations"]
        assert len(resolved) == 2
        # Anchor token resolved to the section identifier + a display label.
        assert resolved[0]["section_id"] == "1.1"
        assert resolved[0]["label"] == "Section 1.1"
        assert resolved[0]["quote"] == "establish a grant program for schools"
        assert resolved[1]["section_id"] == "2.1"
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_ai_citation_payloads_uses_official_url_and_drops_without_one() -> None:
    from alethical.api import serializers

    content = {
        "key_point_citations": [
            {"section_id": "1.1", "label": "Section 1.1", "quote": "a grant program"},
            {"section_id": "2.1", "label": "Section 2.1", "quote": "an annual report"},
        ]
    }
    url = "https://www.revisor.mn.gov/bills/test"
    citations = serializers.ai_citation_payloads(content, url)
    assert [c.model_dump() for c in citations] == [
        {
            "id": "1.1-0",
            "label": "Section 1.1",
            "url": url,
            "excerpt": "a grant program",
            "section_id": "1.1",
        },
        {
            "id": "2.1-1",
            "label": "Section 2.1",
            "url": url,
            "excerpt": "an annual report",
            "section_id": "2.1",
        },
    ]
    # No resolvable official URL → no dead-link citations (grounded-answers rule 5).
    assert serializers.ai_citation_payloads(content, None) == []
    assert serializers.ai_citation_payloads({}, url) == []
