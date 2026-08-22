from __future__ import annotations

import hashlib
import re

import pytest
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_database_url
from alethical.pipeline import ai_enrichment, bill_summary_requests
from alethical.pipeline.minnesota import (
    APPENDIX_PARSER_VERSION,
    CHANGE_ROLE_PARSER_VERSION,
    MinnesotaIngestionPipeline,
    compute_appendix_source_hash,
)


APPENDIX_WARNING = (
    "APPENDIX: REPEALED EXISTING LAW. Use only to explain an explicit repeal; "
    "never describe it as a new duty, service, program, or appropriation."
)
SF3755_ADDED_PHRASE = (
    "publish the text of all public comments on the agency's website and"
)
SF3755_CARRIED_DUTIES = (
    "give the legislature 30 days' notice, allow 30 days for public comment, "
    "publish existing requests, and give notice of the federal decision."
)
SF3755_SEC5_RAW_TEXT = f"The agency must {SF3755_ADDED_PHRASE} {SF3755_CARRIED_DUTIES}"
SF3755_SEC5_SEGMENTS = [
    {"role": "carried_forward", "text": "The agency must "},
    {"role": "added", "text": SF3755_ADDED_PHRASE},
    {"role": "carried_forward", "text": f" {SF3755_CARRIED_DUTIES}"},
]
SF3755_OLD_SESSION_LAW = (
    "The commissioner must submit an Indian Health Service plan for facilities "
    "owned or operated by a Tribe or Tribal organization."
)


def _session() -> Session:
    return Session(create_engine(get_database_url(), pool_pre_ping=True))


def _parts_hash(parts: list[str]) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def _text_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _change_role_hash(segments: list[dict[str, str]]) -> str:
    parts: list[str] = []
    for segment in segments:
        parts.extend([segment["role"], segment["text"]])
    return _parts_hash(parts)


def _appendix_source_hash(references: list[dict[str, str]]) -> str:
    return compute_appendix_source_hash(
        True,
        (
            (
                reference["reference_kind"],
                reference["official_reference"],
                reference["source_hash"],
            )
            for reference in references
        ),
    )


def _refresh_appendix_source_hash(db: Session, version: schema.BillVersion) -> None:
    references = list(
        db.scalars(
            select(schema.BillVersionAppendixReference)
            .where(schema.BillVersionAppendixReference.bill_version_id == version.id)
            .order_by(schema.BillVersionAppendixReference.source_order.asc())
        )
    )
    version.appendix_source_hash = compute_appendix_source_hash(
        bool(version.appendix_present),
        (
            (
                reference.reference_kind,
                reference.official_reference,
                reference.source_hash,
            )
            for reference in references
        ),
    )


def _sf3755_reference_data() -> list[dict[str, str]]:
    statute_text = " ".join(
        f"Subd. {subdivision}. Existing repealed statute subdivision {subdivision} text."
        for subdivision in range(1, 13)
    )
    references = [
        {
            "reference_kind": "repealed_statute",
            "official_reference": "256B.051 HOUSING STABILIZATION SERVICES.",
            "raw_text": statute_text,
            "source_hash": _text_hash(statute_text),
        }
    ]
    references.append(
        {
            "reference_kind": "repealed_session_law",
            "official_reference": (
                "Laws 2025, First Special Session chapter 3, article 18, section 3"
            ),
            "raw_text": SF3755_OLD_SESSION_LAW,
            "source_hash": _text_hash(SF3755_OLD_SESSION_LAW),
        }
    )
    return references


def _make_sf3755_bill(
    db: Session, *, bill_key: str, file_number: int, with_rag: bool = False
) -> tuple:
    session_id = db.scalar(select(schema.LegislativeSession.id))
    chamber_id = db.scalar(select(schema.Chamber.id))
    assert session_id is not None and chamber_id is not None

    bill = schema.Bill(
        session_id=session_id,
        chamber_id=chamber_id,
        bill_key=bill_key,
        file_type="SF",
        file_number=file_number,
        title="A bill for an act relating to human services.",
        description="A focused SF3755 prompt test bill.",
        current_status="Referred to committee",
        official_url="https://www.revisor.mn.gov/bills/test",
    )
    db.add(bill)
    db.flush()

    reference_data = _sf3755_reference_data()
    version = schema.BillVersion(
        bill_id=bill.id,
        version_code="test-v1",
        version_name="First engrossment",
        sequence_number=0,
        is_current=True,
        appendix_parser_version=APPENDIX_PARSER_VERSION,
        appendix_source_hash=_appendix_source_hash(reference_data),
        appendix_parse_complete=True,
        appendix_present=True,
        change_role_parser_version=CHANGE_ROLE_PARSER_VERSION,
        change_role_parse_complete=True,
    )
    db.add(version)
    db.flush()

    repeal_text = (
        "Laws 2025, First Special Session chapter 3, article 18, section 3, "
        "is repealed."
    )
    repeal_segments = [{"role": "added", "text": repeal_text}]
    repeal_section = schema.BillVersionSection(
        bill_version_id=version.id,
        section_id_text="laws.0.1.0",
        source_order=1,
        section_heading="Sec. 12. REPEALER.",
        raw_text=repeal_text,
        body_blocks=[{"kind": "para", "text": repeal_text}],
        source_hash=_text_hash(repeal_text),
        change_role_segments=repeal_segments,
        change_role_source_hash=_change_role_hash(repeal_segments),
        change_role_parse_complete=True,
    )
    sec5 = schema.BillVersionSection(
        bill_version_id=version.id,
        section_id_text="laws.0.5.0",
        source_order=2,
        section_heading="Sec. 5. WAIVER REQUEST NOTICE.",
        raw_text=SF3755_SEC5_RAW_TEXT,
        body_blocks=[{"kind": "para", "text": SF3755_SEC5_RAW_TEXT}],
        source_hash=_text_hash(SF3755_SEC5_RAW_TEXT),
        change_role_segments=SF3755_SEC5_SEGMENTS,
        change_role_source_hash=_change_role_hash(SF3755_SEC5_SEGMENTS),
        change_role_parse_complete=True,
    )
    old_session_segments = [{"role": "carried_forward", "text": SF3755_OLD_SESSION_LAW}]
    old_session_law = schema.BillVersionSection(
        bill_version_id=version.id,
        # This official appendix id repeats the proposed section's id.
        section_id_text="laws.0.1.0",
        source_order=3,
        section_heading="Sec. 3. DIRECTION TO COMMISSIONER.",
        raw_text=SF3755_OLD_SESSION_LAW,
        body_blocks=[{"kind": "para", "text": SF3755_OLD_SESSION_LAW}],
        source_hash=_text_hash(SF3755_OLD_SESSION_LAW),
        change_role_segments=old_session_segments,
        change_role_source_hash=_change_role_hash(old_session_segments),
        change_role_parse_complete=True,
    )
    db.add_all([repeal_section, sec5, old_session_law])
    db.flush()

    statute_reference = reference_data[0]
    appendix_rows = [
        schema.BillVersionAppendixReference(
            bill_version_id=version.id,
            source_order=1,
            reference_kind=statute_reference["reference_kind"],
            official_reference=statute_reference["official_reference"],
            raw_text=statute_reference["raw_text"],
            body_blocks=[
                block
                for subdivision in range(1, 13)
                for block in (
                    {
                        "kind": "heading",
                        "number": f"Subd. {subdivision}.",
                        "text": f"Old subdivision {subdivision}.",
                    },
                    {
                        "kind": "para",
                        "text": (
                            f"Existing repealed statute subdivision {subdivision} text."
                        ),
                    },
                )
            ],
            source_hash=statute_reference["source_hash"],
        )
    ]
    appendix_rows.append(
        schema.BillVersionAppendixReference(
            bill_version_id=version.id,
            source_order=2,
            reference_kind="repealed_session_law",
            official_reference=reference_data[1]["official_reference"],
            raw_text=None,
            body_blocks=None,
            source_hash=reference_data[1]["source_hash"],
            bill_version_section_id=old_session_law.id,
        )
    )
    db.add_all(appendix_rows)

    if with_rag:
        db.add_all(
            [
                schema.RagSectionDocument(
                    bill_id=bill.id,
                    bill_version_id=version.id,
                    bill_version_section_id=section.id,
                    citation_label=label,
                    clean_text=section.raw_text,
                    cleaning_version="appendix-prompt-test-v1",
                    source_hash=_text_hash(section.raw_text),
                    word_count=len(section.raw_text.split()),
                )
                for section, label in (
                    (repeal_section, "SF 3755, Sec. 12"),
                    (sec5, "SF 3755, Sec. 5"),
                    (old_session_law, "SF 3755, Sec. 3"),
                )
            ]
        )

    db.commit()
    return bill.id, version.id


def _cleanup(db: Session, bill_id) -> None:
    version_ids = list(
        db.scalars(
            select(schema.BillVersion.id).where(schema.BillVersion.bill_id == bill_id)
        )
    )
    db.execute(
        delete(schema.RagSectionDocument).where(
            schema.RagSectionDocument.bill_id == bill_id
        )
    )
    db.execute(
        delete(schema.AIEnrichment).where(schema.AIEnrichment.bill_id == bill_id)
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


@pytest.mark.parametrize("with_rag", [False, True])
def test_sf3755_appendix_is_a1_to_a2_and_never_citable(with_rag: bool) -> None:
    file_number = 999101 + int(with_rag)
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key=f"test-2026-SF{file_number}",
            file_number=file_number,
            with_rag=with_rag,
        )
    try:
        with _session() as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            assert bill is not None and version is not None

            proposed = ai_enrichment.section_anchors(db, version)
            appendix = ai_enrichment.appendix_anchors(db, version)
            prompt, _version_hash, truncated = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )

        assert truncated is False
        assert [anchor.anchor_id for anchor in proposed] == ["S1", "S2"]
        assert all(anchor.anchor_id.startswith("S") for anchor in proposed)
        assert SF3755_OLD_SESSION_LAW not in [anchor.text for anchor in proposed]
        assert [anchor.anchor_id for anchor in appendix] == ["A1", "A2"]
        assert appendix[0].reference_kind == "repealed_statute"
        assert appendix[1].reference_kind == "repealed_session_law"

        assert APPENDIX_WARNING in prompt.splitlines()
        assert prompt.count(APPENDIX_WARNING) == 1
        assert re.findall(r"\[A(\d+)\]", prompt) == ["1", "2"]
        assert "[A1] 256B.051 HOUSING STABILIZATION SERVICES." in prompt
        assert "Subd. 1. Existing repealed statute subdivision 1 text." in prompt
        assert "Subd. 12. Existing repealed statute subdivision 12 text." in prompt
        assert (
            "[A2] Laws 2025, First Special Session chapter 3, article 18, section 3"
            in prompt
        )
        assert "[S3]" not in prompt
        assert prompt.count("Indian Health Service") == 1
        assert prompt.index("[A2]") < prompt.index("Indian Health Service")
        assert prompt.count("Tribe or Tribal organization") == 1
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_partial_search_rows_cannot_omit_saved_proposed_sections() -> None:
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key="test-2026-SF999111-partial-search",
            file_number=999111,
        )
    try:
        with _session() as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            first_proposed = db.scalar(
                select(schema.BillVersionSection).where(
                    schema.BillVersionSection.bill_version_id == version_id,
                    schema.BillVersionSection.source_order == 1,
                )
            )
            assert bill is not None and version is not None
            assert first_proposed is not None
            prompt_before, hash_before, refused_before = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )

            db.add(
                schema.RagSectionDocument(
                    bill_id=bill_id,
                    bill_version_id=version_id,
                    bill_version_section_id=first_proposed.id,
                    citation_label="A stale search-only label",
                    clean_text="A stale partial search copy.",
                    cleaning_version="partial-search-test-v1",
                    source_hash=_text_hash("A stale partial search copy."),
                    word_count=5,
                )
            )
            db.flush()
            prompt_after, hash_after, refused_after = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )

        assert refused_before is False
        assert refused_after is False
        assert prompt_after == prompt_before
        assert hash_after == hash_before
        assert "[S1]" in prompt_after
        assert "[S2]" in prompt_after
        assert "A stale partial search copy." not in prompt_after
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_appendix_change_markup_does_not_change_the_prompt_or_retire_summary() -> None:
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key="test-2026-SF999112-appendix-roles",
            file_number=999112,
        )
    try:
        with _session() as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            assert bill is not None and version is not None
            pipeline = MinnesotaIngestionPipeline(db)
            prompt_before, hash_before, refused_before = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            signatures_before = (
                pipeline._public_text_signature(bill),
                pipeline._appendix_context_signature(bill),
                pipeline._change_role_context_signature(bill),
            )
            summary = schema.AIEnrichment(
                bill_id=bill.id,
                bill_version_id=version.id,
                enrichment_type=schema.EnrichmentType.bill_summary,
                model_name="claude:claude-sonnet-5",
                source_version_hash=hash_before,
                content_json={"short_title": "Current exact-text title"},
                is_current=True,
            )
            db.add(summary)
            old_session_law = db.scalar(
                select(schema.BillVersionSection).where(
                    schema.BillVersionSection.bill_version_id == version_id,
                    schema.BillVersionSection.source_order == 3,
                )
            )
            assert old_session_law is not None
            old_session_law.change_role_segments = [
                {"role": "added", "text": old_session_law.raw_text}
            ]
            old_session_law.change_role_source_hash = _change_role_hash(
                old_session_law.change_role_segments
            )
            db.flush()

            prompt_after, hash_after, refused_after = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            signatures_after = (
                pipeline._public_text_signature(bill),
                pipeline._appendix_context_signature(bill),
                pipeline._change_role_context_signature(bill),
            )
            db.refresh(summary)

        assert refused_before is False
        assert refused_after is False
        assert prompt_after == prompt_before
        assert hash_after == hash_before
        assert signatures_after == signatures_before
        assert summary.is_current is True
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_changed_saved_proposed_text_with_old_roles_is_refused_everywhere() -> None:
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key="test-2026-SF999116-stale-change-roles",
            file_number=999116,
        )
    try:
        with _session() as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            section = db.scalar(
                select(schema.BillVersionSection).where(
                    schema.BillVersionSection.bill_version_id == version_id,
                    schema.BillVersionSection.source_order == 2,
                )
            )
            assert bill is not None and version is not None and section is not None
            section.raw_text = f"{section.raw_text} Newly repaired official words."
            section.source_hash = _text_hash(section.raw_text)
            db.flush()

            prompt, _fallback_hash, refused = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            source_fingerprint = (
                bill_summary_requests.canonical_source_text_fingerprint(
                    db, bill, version
                )
            )

        assert refused is True
        assert prompt.startswith("SOURCE REFUSAL:")
        assert source_fingerprint is None
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_deleted_terminal_appendix_reference_is_refused_everywhere() -> None:
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key="test-2026-SF999117-missing-terminal-appendix",
            file_number=999117,
        )
    try:
        with _session() as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            terminal_reference = db.scalar(
                select(schema.BillVersionAppendixReference).where(
                    schema.BillVersionAppendixReference.bill_version_id == version_id,
                    schema.BillVersionAppendixReference.source_order == 2,
                )
            )
            assert (
                bill is not None
                and version is not None
                and terminal_reference is not None
            )
            db.delete(terminal_reference)
            db.flush()

            prompt, _fallback_hash, refused = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            source_fingerprint = (
                bill_summary_requests.canonical_source_text_fingerprint(
                    db, bill, version
                )
            )

        assert refused is True
        assert prompt.startswith("SOURCE REFUSAL:")
        assert source_fingerprint is None
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_no_appendix_anchor_resolves_as_a_key_point_citation() -> None:
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key="test-2026-SF999103",
            file_number=999103,
        )
    try:
        content = {
            "key_points": [
                "Restarts an old housing service.",
                "Requires an Indian Health Service plan.",
            ],
            "key_point_citations": [
                {
                    "point": "Restarts an old housing service.",
                    "section_id": "A1",
                    "quote": "Existing repealed statute subdivision 1 text.",
                },
                {
                    "point": "Requires an Indian Health Service plan.",
                    "section_id": "A2",
                    "quote": "submit an Indian Health Service plan",
                },
            ],
        }
        with _session() as db:
            stats = ai_enrichment.resolve_key_point_citations(db, version_id, content)

        assert stats == {"points": 2, "anchored": 0, "dropped": 2}
        assert content["key_point_citations"] == []
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


@pytest.mark.parametrize(
    "appendix_section_id",
    ["A2", "[A2]", " [ a2 ] ", "Appendix A2.", "A-2", "A.2", "A_2", "A/2"],
    ids=[
        "bare",
        "prompt-brackets",
        "lowercase-spaced",
        "labeled-punctuation",
        "hyphen-between",
        "period-between",
        "underscore-between",
        "slash-between",
    ],
)
def test_apply_rejects_a_summary_that_tries_to_cite_appendix_text(
    appendix_section_id: str,
) -> None:
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key="test-2026-SF999107",
            file_number=999107,
        )
    try:
        with _session() as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            assert bill is not None and version is not None
            _prompt, prepared_hash, refused = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            assert refused is False
            result = ai_enrichment.apply_full_summary(
                db,
                ai_enrichment.ManifestItem(
                    custom_id="summary-with-a-citation",
                    bill_id=str(bill_id),
                    bill_key=bill.bill_key,
                    bill_version_id=str(version_id),
                    model="claude:claude-sonnet-5",
                    source_version_hash=prepared_hash,
                    prompt_context_version=(
                        ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION
                    ),
                    prepared_prompt_fingerprint=prepared_hash,
                ),
                {
                    "key_points": ["Creates an old Tribal duty."],
                    "key_point_citations": [
                        {
                            "point": "Creates an old Tribal duty.",
                            "section_id": appendix_section_id,
                            "quote": "submit an Indian Health Service plan",
                        }
                    ],
                },
                provider_batch_id=None,
            )
            assert result.applied is False
            assert result.outdated is False
            assert result.rejected is True
            assert (
                db.scalar(
                    select(schema.AIEnrichment).where(
                        schema.AIEnrichment.bill_id == bill_id
                    )
                )
                is None
            )
            db.rollback()
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


@pytest.mark.parametrize("missing_field", ["context_version", "prepared_hash"])
def test_apply_rejects_a_full_summary_without_complete_prompt_identity(
    missing_field: str,
) -> None:
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key=f"test-2026-SF999108-{missing_field}",
            file_number=999108 if missing_field == "context_version" else 999109,
        )
    try:
        with _session() as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            assert bill is not None and version is not None
            _prompt, prepared_hash, refused = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            assert refused is False

            result = ai_enrichment.apply_full_summary(
                db,
                ai_enrichment.ManifestItem(
                    custom_id=f"missing-{missing_field}",
                    bill_id=str(bill_id),
                    bill_key=bill.bill_key,
                    bill_version_id=str(version_id),
                    model="claude:claude-sonnet-5",
                    source_version_hash=prepared_hash,
                    prompt_context_version=(
                        None
                        if missing_field == "context_version"
                        else ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION
                    ),
                    prepared_prompt_fingerprint=(
                        None if missing_field == "prepared_hash" else prepared_hash
                    ),
                ),
                {"key_points": [], "key_point_citations": []},
                provider_batch_id=None,
            )

            assert result == ai_enrichment.FullSummaryApplyResult(
                applied=False, outdated=True
            )
            assert (
                db.scalar(
                    select(schema.AIEnrichment).where(
                        schema.AIEnrichment.bill_id == bill_id
                    )
                )
                is None
            )
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_apply_rejects_legacy_hash_when_saved_prompt_context_is_incomplete() -> None:
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key="test-2026-SF999110-incomplete-context",
            file_number=999110,
        )
    try:
        with _session() as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            assert bill is not None and version is not None
            raw_hashes = [
                hashlib.sha256(section.raw_text.encode("utf-8")).hexdigest()
                for section in db.scalars(
                    select(schema.BillVersionSection)
                    .where(schema.BillVersionSection.bill_version_id == version_id)
                    .order_by(schema.BillVersionSection.source_order)
                )
            ]
            legacy_hash = ai_enrichment.source_hash(
                [bill.bill_key, str(version.id), *raw_hashes]
            )
            version.appendix_parse_complete = False
            db.flush()

            result = ai_enrichment.apply_full_summary(
                db,
                ai_enrichment.ManifestItem(
                    custom_id="incomplete-saved-context",
                    bill_id=str(bill_id),
                    bill_key=bill.bill_key,
                    bill_version_id=str(version_id),
                    model="claude:claude-sonnet-5",
                    source_version_hash=legacy_hash,
                    prompt_context_version=(
                        ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION
                    ),
                    prepared_prompt_fingerprint=legacy_hash,
                ),
                {"key_points": [], "key_point_citations": []},
                provider_batch_id=None,
            )

            assert result == ai_enrichment.FullSummaryApplyResult(
                applied=False, outdated=True
            )
            assert (
                db.scalar(
                    select(schema.AIEnrichment).where(
                        schema.AIEnrichment.bill_id == bill_id
                    )
                )
                is None
            )
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_gapped_proposed_lane_is_refused_by_prepare_and_apply() -> None:
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key="test-2026-SF999113-gapped-proposal",
            file_number=999113,
        )
    try:
        with _session() as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            proposed = db.scalar(
                select(schema.BillVersionSection).where(
                    schema.BillVersionSection.bill_version_id == version_id,
                    schema.BillVersionSection.source_order == 2,
                )
            )
            assert bill is not None and version is not None and proposed is not None
            proposed.source_order = 4
            db.flush()

            prompt, fallback_hash, refused = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            result = ai_enrichment.apply_full_summary(
                db,
                ai_enrichment.ManifestItem(
                    custom_id="gapped-proposed-lane",
                    bill_id=str(bill.id),
                    bill_key=bill.bill_key,
                    bill_version_id=str(version.id),
                    model="claude:claude-sonnet-5",
                    source_version_hash=fallback_hash,
                    prompt_context_version=(
                        ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION
                    ),
                    prepared_prompt_fingerprint=fallback_hash,
                ),
                {"key_points": [], "key_point_citations": []},
                provider_batch_id=None,
            )

        assert refused is True
        assert prompt.startswith("SOURCE REFUSAL:")
        assert result == ai_enrichment.FullSummaryApplyResult(
            applied=False, outdated=True
        )
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


@pytest.mark.parametrize("corruption", ["gapped_order", "cross_version_link"])
def test_inconsistent_appendix_lane_is_refused_by_prepare_and_apply(
    corruption: str,
) -> None:
    file_number = 999114 if corruption == "gapped_order" else 999115
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key=f"test-2026-SF{file_number}-{corruption}",
            file_number=file_number,
        )
    try:
        with _session() as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            reference = db.scalar(
                select(schema.BillVersionAppendixReference).where(
                    schema.BillVersionAppendixReference.bill_version_id == version_id,
                    schema.BillVersionAppendixReference.source_order == 2,
                )
            )
            assert bill is not None and version is not None and reference is not None
            if corruption == "gapped_order":
                reference.source_order = 14
            else:
                foreign_version = schema.BillVersion(
                    bill_id=bill.id,
                    version_code="foreign-appendix-test",
                    sequence_number=0,
                    is_current=False,
                )
                db.add(foreign_version)
                db.flush()
                foreign_section = schema.BillVersionSection(
                    bill_version_id=foreign_version.id,
                    section_id_text="laws.0.1.0",
                    source_order=1,
                    section_heading="Sec. 3. DIRECTION TO COMMISSIONER.",
                    raw_text=SF3755_OLD_SESSION_LAW,
                    source_hash=_text_hash(SF3755_OLD_SESSION_LAW),
                )
                db.add(foreign_section)
                db.flush()
                reference.bill_version_section_id = foreign_section.id
            db.flush()

            prompt, fallback_hash, refused = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            result = ai_enrichment.apply_full_summary(
                db,
                ai_enrichment.ManifestItem(
                    custom_id=f"inconsistent-appendix-{corruption}",
                    bill_id=str(bill.id),
                    bill_key=bill.bill_key,
                    bill_version_id=str(version.id),
                    model="claude:claude-sonnet-5",
                    source_version_hash=fallback_hash,
                    prompt_context_version=(
                        ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION
                    ),
                    prepared_prompt_fingerprint=fallback_hash,
                ),
                {"key_points": [], "key_point_citations": []},
                provider_batch_id=None,
            )

        assert refused is True
        assert prompt.startswith("SOURCE REFUSAL:")
        assert result == ai_enrichment.FullSummaryApplyResult(
            applied=False, outdated=True
        )
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_sf3755_sec5_marks_only_the_added_phrase_and_preserves_reader_text() -> None:
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key="test-2026-SF999104",
            file_number=999104,
        )
    try:
        with _session() as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            assert bill is not None and version is not None
            sec5 = db.scalar(
                select(schema.BillVersionSection).where(
                    schema.BillVersionSection.bill_version_id == version_id,
                    schema.BillVersionSection.section_id_text == "laws.0.5.0",
                )
            )
            assert sec5 is not None
            reader_text_before = sec5.raw_text
            reader_hash_before = sec5.source_hash

            prompt, _version_hash, truncated = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            db.refresh(sec5)

            assert sec5.raw_text == reader_text_before == SF3755_SEC5_RAW_TEXT
            assert (
                sec5.source_hash
                == reader_hash_before
                == _text_hash(SF3755_SEC5_RAW_TEXT)
            )

        assert truncated is False
        proposed_lane = prompt[
            prompt.index("[S2]") : prompt.index("Appendix reference material:")
        ]
        assert proposed_lane.count("[+]") == 1
        assert proposed_lane.count("[/+]") == 1
        assert f"[+]{SF3755_ADDED_PHRASE}[/+]" in proposed_lane
        assert SF3755_CARRIED_DUTIES in proposed_lane
        assert f"[+]{SF3755_CARRIED_DUTIES}" not in proposed_lane
        assert "[+]give the legislature 30 days' notice" not in proposed_lane
        assert "[+]" not in reader_text_before
        assert "[/+]" not in reader_text_before

        assert ai_enrichment.CHANGE_ROLE_WARNING in prompt.splitlines()
        assert (
            "Never present carried-forward text as a new bill effect."
            in ai_enrichment.CHANGE_ROLE_WARNING
        )
        assert (
            "Never describe carried-forward words as a new bill effect."
            in ai_enrichment.SYSTEM_PROMPT
        )
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_appendix_label_and_text_are_part_of_prompt_freshness() -> None:
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key="test-2026-SF999105",
            file_number=999105,
        )
    try:
        with _session() as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            assert bill is not None and version is not None
            prompt, original_hash, _truncated = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            assert '"prompt_context_version":' in prompt
            assert ai_enrichment.source_version_matches_current_text(
                db, bill, version, original_hash
            )

            first_subdivision = db.scalar(
                select(schema.BillVersionAppendixReference).where(
                    schema.BillVersionAppendixReference.bill_version_id == version.id,
                    schema.BillVersionAppendixReference.source_order == 1,
                )
            )
            assert first_subdivision is not None
            first_subdivision.official_reference = (
                "256B.051 HOUSING STABILIZATION SERVICES, corrected label"
            )
            _refresh_appendix_source_hash(db, version)
            db.flush()
            _prompt, relabeled_hash, _truncated = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            assert relabeled_hash != original_hash
            assert not ai_enrichment.source_version_matches_current_text(
                db, bill, version, original_hash
            )
            assert ai_enrichment.source_version_matches_current_text(
                db, bill, version, relabeled_hash
            )

            first_subdivision.raw_text = "Corrected old subdivision text."
            first_subdivision.source_hash = _text_hash(first_subdivision.raw_text)
            _refresh_appendix_source_hash(db, version)
            db.flush()
            _prompt, corrected_hash, _truncated = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            assert corrected_hash != relabeled_hash
            assert not ai_enrichment.source_version_matches_current_text(
                db, bill, version, relabeled_hash
            )
            assert ai_enrichment.source_version_matches_current_text(
                db, bill, version, corrected_hash
            )

            bill.title = "A corrected official bill title."
            bill.current_status = "Passed by the Senate"
            db.flush()
            metadata_prompt, metadata_hash, _truncated = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            assert "A corrected official bill title." not in metadata_prompt
            assert "Passed by the Senate" not in metadata_prompt
            assert metadata_hash == corrected_hash
            assert ai_enrichment.source_version_matches_current_text(
                db, bill, version, corrected_hash
            )
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_older_prompt_context_version_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key="test-2026-SF999106",
            file_number=999106,
        )
    try:
        current_context_version = ai_enrichment.BILL_SUMMARY_PROMPT_CONTEXT_VERSION
        with _session() as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            assert bill is not None and version is not None

            monkeypatch.setattr(
                ai_enrichment,
                "BILL_SUMMARY_PROMPT_CONTEXT_VERSION",
                f"{current_context_version}-older",
            )
            _prompt, older_hash, _truncated = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            assert ai_enrichment.source_version_matches_current_text(
                db, bill, version, older_hash
            )

            monkeypatch.setattr(
                ai_enrichment,
                "BILL_SUMMARY_PROMPT_CONTEXT_VERSION",
                current_context_version,
            )
            _prompt, current_hash, _truncated = ai_enrichment.bill_prompt(
                db, bill, version, max_input_chars=100_000
            )
            assert current_hash != older_hash
            assert not ai_enrichment.source_version_matches_current_text(
                db, bill, version, older_hash
            )
            assert ai_enrichment.source_version_matches_current_text(
                db, bill, version, current_hash
            )
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_proposed_and_appendix_limits_are_measured_and_refused_separately() -> None:
    with _session() as db:
        bill_id, version_id = _make_sf3755_bill(
            db,
            bill_key="test-2026-SF999107",
            file_number=999107,
        )
        version = db.get(schema.BillVersion, version_id)
        assert version is not None
        sec5 = db.scalar(
            select(schema.BillVersionSection).where(
                schema.BillVersionSection.bill_version_id == version_id,
                schema.BillVersionSection.section_id_text == "laws.0.5.0",
            )
        )
        first_subdivision = db.scalar(
            select(schema.BillVersionAppendixReference).where(
                schema.BillVersionAppendixReference.bill_version_id == version_id,
                schema.BillVersionAppendixReference.source_order == 1,
            )
        )
        assert sec5 is not None and first_subdivision is not None
        sec5.raw_text = "P" * 2_000
        sec5.source_hash = _text_hash(sec5.raw_text)
        sec5.change_role_segments = [{"role": "carried_forward", "text": sec5.raw_text}]
        sec5.change_role_source_hash = _change_role_hash(sec5.change_role_segments)
        first_subdivision.raw_text = "A" * 2_000
        first_subdivision.source_hash = _text_hash(first_subdivision.raw_text)
        first_subdivision.body_blocks = [
            {"kind": "para", "text": first_subdivision.raw_text}
        ]
        _refresh_appendix_source_hash(db, version)
        db.commit()
    try:
        with _session() as db:
            bill = db.get(schema.Bill, bill_id)
            version = db.get(schema.BillVersion, version_id)
            assert bill is not None and version is not None

            proposed_short = ai_enrichment.bill_prompt_measurement(
                db,
                bill,
                version,
                max_proposed_chars=600,
                max_appendix_chars=10_000,
            )
            appendix_short = ai_enrichment.bill_prompt_measurement(
                db,
                bill,
                version,
                max_proposed_chars=10_000,
                max_appendix_chars=600,
            )
            proposed_prompt, _hash, proposed_refused = ai_enrichment.bill_prompt(
                db,
                bill,
                version,
                max_input_chars=600,
                max_appendix_chars=10_000,
            )
            appendix_prompt, _hash, appendix_refused = ai_enrichment.bill_prompt(
                db,
                bill,
                version,
                max_input_chars=10_000,
                max_appendix_chars=600,
            )

        assert proposed_short["proposed"]["over_limit"] is True
        assert proposed_short["appendix"]["over_limit"] is False
        assert proposed_short["is_complete"] is False
        assert proposed_short["refusal_reasons"] == ["proposed_lane_over_limit"]
        assert proposed_refused is True
        assert proposed_prompt.startswith("SOURCE REFUSAL:")
        assert '"proposed_lane_over_limit"' in proposed_prompt
        assert "P" * 2_000 in proposed_prompt

        assert appendix_short["proposed"]["over_limit"] is False
        assert appendix_short["appendix"]["over_limit"] is True
        assert appendix_short["is_complete"] is False
        assert appendix_short["refusal_reasons"] == ["appendix_lane_over_limit"]
        assert appendix_refused is True
        assert appendix_prompt.startswith("SOURCE REFUSAL:")
        assert '"appendix_lane_over_limit"' in appendix_prompt
        assert "A" * 2_000 in appendix_prompt

        for measurement in (proposed_short, appendix_short):
            for lane in ("proposed", "appendix"):
                values = measurement[lane]
                assert values["included_chars"] == values["total_chars"]
                assert values["omitted_chars"] == 0
                assert values["truncated"] is False
    finally:
        with _session() as db:
            _cleanup(db, bill_id)
