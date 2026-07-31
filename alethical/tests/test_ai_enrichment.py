from __future__ import annotations

import json
import re
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
        # Anchor token resolved to the section identifier + a display label. The
        # label always abbreviates to "Sec." and carries no terminal period (a
        # chip is a label, not a sentence) — see test_chip_label_canonical_format.
        assert resolved[0]["section_id"] == "1.1"
        assert resolved[0]["label"] == "Sec. 1.1"
        # The stored quote never ends unpunctuated: this span is cut short of the
        # source's period, so it closes with the single "…" glyph.
        assert resolved[0]["quote"] == "establish a grant program for schools…"
        assert resolved[1]["section_id"] == "2.1"
    finally:
        with _session() as db:
            _cleanup(db, bill_id)


def test_chip_label_canonical_format() -> None:
    """The "From the bill" citation chip has ONE format on every surface:

        Sec. 4 · License classes          (heading present)
        Art. 1, Sec. 2 · Appropriations   (article-structured / omnibus bill)
        Sec. 14                           (no usable heading — number alone)

    The bill code is dropped (the chip only renders on that bill's own page,
    where the code already sits in the rail badge), "Section" always abbreviates
    to "Sec.", there is no terminal period, and a shouted statutory heading is
    downcased to a sentence-case topic rather than rendered verbatim. The
    frontend mirrors this in `citationChipLabel`
    (apps/frontend/src/lib/billDetail.ts) for bills enriched before this landed."""

    def label(raw: str) -> str:
        return ai_enrichment._chip_label(
            ai_enrichment.SectionAnchor(
                anchor_id="S1",
                label=raw,
                text="",
                source_hash="",
                section_id_text="x",
            )
        )

    # Bill code dropped; "Section" abbreviated; terminal period dropped.
    assert label("SF 334, Sec. 2.") == "Sec. 2"
    assert label("SF 334, Section 1.") == "Sec. 1"
    assert label("H.F. No. 12, Sec. 3.") == "Sec. 3"
    # Statutory heading downcased to a sentence-case topic.
    assert label("SF 334, Sec. 14. TRANSFER.") == "Sec. 14 · Transfer"
    assert label("SF 2483, Sec. 4. LICENSE CLASSES") == "Sec. 4 · License classes"
    # A heading that already carries mixed case keeps its own capitalization.
    assert label("SF 1, Sec. 5. Office of Higher Education") == (
        "Sec. 5 · Office of Higher Education"
    )
    # Article-structured (omnibus) bill.
    assert label("SF 2483, ARTICLE 1, Sec. 2. APPROPRIATIONS.") == (
        "Art. 1, Sec. 2 · Appropriations"
    )
    # An article heading between the article number and the section is dropped —
    # the section's own heading is the topic shown.
    assert label("SF 2483, ARTICLE 1, EDUCATION FINANCE, Sec. 2. GRANTS.") == (
        "Art. 1, Sec. 2 · Grants"
    )
    # No usable heading → the number alone, never a dangling middot.
    assert label("SF 334, Sec. 14") == "Sec. 14"
    assert label("SF 334, Sec. 14. .") == "Sec. 14"
    assert "·" not in label("SF 334, Sec. 14")
    # Never expose the internal, non-human-readable section_id_text key.
    assert label("") == "Cited section"

    # A long heading yields the number alone, NEVER a topic cut off mid-word.
    # `_chip_topic` used to cut at 40 characters, which wrote 2,033 production
    # labels like "Sec. 1 · Wright technical center; capital improv…". It now
    # delegates to `section_chip_topic`, the one implementation of this rule, so
    # ingest and the request-time path can no longer disagree about the same
    # heading: the compound heading splits on its semicolon, and a heading too long
    # for a chip is dropped rather than cut.
    assert label("SF 1, Sec. 1. WRIGHT TECHNICAL CENTER; CAPITAL IMPROVEMENTS.") == (
        "Sec. 1 · Wright technical center"
    )
    assert label(
        "SF 577, Sec. 7. SCOPING ENVIRONMENTAL ASSESSMENT WORKSHEET NOT REQUIRED "
        "FOR PROJECTS THAT REQUIRE A MANDATORY ENVIRONMENTAL IMPACT STATEMENT."
    ) == ("Sec. 7")
    # The 61-80 band the request-time path now keeps is kept here identically.
    assert label(
        "HF 4301, Section 1. DRINKING WATER REGIONALIZATION PLANNING AND "
        "ASSISTANCE GRANTS."
    ) == ("Sec. 1 · Drinking water regionalization planning and assistance grants")


def test_stored_quote_never_ends_unpunctuated() -> None:
    """A citation excerpt is displayed on its own, so it must read as a finished
    quotation: a complete clause keeps the source's own terminal mark, and a span
    cut short of one closes with the single "…" glyph (U+2026, never three
    periods). A quote that just stops mid-clause reads as a rendering bug. The
    model's own wrapping quote marks are stripped — the display supplies the
    quotation styling (italic type + a green left rule)."""
    with _session() as db:
        bill_id, version_id = _make_bill_with_sections(
            db,
            bill_key="test-2025-HF999011",
            file_number=999011,
            sections=[
                (
                    "1.1",
                    "The council consists of the following members, "
                    "appointed by the commissioner. "
                    "The commissioner shall convene the first meeting. "
                    '"eligible government" means a city or "Tribal governments." '
                    "The total aid payable is $.......",
                ),
            ],
        )
    try:
        cases = [
            # Cut mid-clause → single ellipsis appended.
            ("consists of the following members", "consists of the following members…"),
            # A verbatim trailing comma also marks a cut mid-clause: the comma is
            # replaced by the ellipsis rather than kept alongside it.
            (
                "consists of the following members,",
                "consists of the following members…",
            ),
            # Complete clause ending at the source's own period → left alone.
            (
                "The commissioner shall convene the first meeting.",
                "The commissioner shall convene the first meeting.",
            ),
            # The model's own wrapping quotes are stripped, curly or straight.
            (
                "“The commissioner shall convene the first meeting.”",
                "The commissioner shall convene the first meeting.",
            ),
            (
                '"The commissioner shall convene the first meeting."',
                "The commissioner shall convene the first meeting.",
            ),
            # A model-supplied ellipsis survives grounding (the glyph is ours, not
            # the bill's, so it is stripped before the verbatim match) and is
            # stored as one glyph — never three periods.
            ("The commissioner shall convene...", "The commissioner shall convene…"),
            ("The commissioner shall convene…", "The commissioner shall convene…"),
            # A statutory DEFINITION opens with the defined term in quotes, and a
            # list can close on a quoted item — those marks are the bill's own
            # punctuation, not a wrapper, so they must survive verbatim. Stripping
            # them left an unbalanced quote behind and swallowed the source's final
            # period (found against production: 2 of 57,473 stored excerpts).
            (
                '"eligible government" means a city or "Tribal governments."',
                '"eligible government" means a city or "Tribal governments."',
            ),
            # The bill's own blank-fill for an amount it left undecided is source
            # text, not an elision of ours — collapsing it to "…" would rewrite the
            # bill (found against production: 53 of 57,473 stored excerpts).
            ("The total aid payable is $.......", "The total aid payable is $......."),
        ]
        for quote, want in cases:
            content = {
                "key_points": ["A point."],
                "key_point_citations": [
                    {"point": "A point.", "section_id": "S1", "quote": quote}
                ],
            }
            with _session() as db:
                stats = ai_enrichment.resolve_key_point_citations(
                    db, version_id, content
                )
            # Every case stays grounded — the ellipsis/quote-mark handling must not
            # cost a correctly-elided quote its citation.
            assert stats["anchored"] == 1, quote
            stored = content["key_point_citations"][0]["quote"]
            assert stored == want, quote
            assert re.search(r"[.!?…][\"”'’]?$", stored), quote
            # Our own elision is always the single glyph — but the bill's blank-fill
            # dot run is left verbatim, so only check what we appended.
            assert not re.search(r"(?<![$\d\s.])\.{3,}\s*$", stored), quote
            # No wrapping pair left — but a definition's own opening quote stays.
            assert not re.fullmatch(r"[\"“'‘][^\"“”'‘’]*[\"”'’]", stored), quote
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
            "section_topic": "",
        },
        {
            "id": "2.1-1",
            "label": "Section 2.1",
            "url": url,
            "excerpt": "an annual report",
            "section_id": "2.1",
            "section_topic": "",
        },
    ]
    # A served topic rides alongside the label rather than being concatenated into
    # it: the stored label's shape varies by when the bill was enriched, so the
    # client normalizes the label and appends the topic only if none survives.
    topics = {"1.1": "License classes", "9.9": "Ignored — no such citation"}
    with_topics = serializers.ai_citation_payloads(content, url, topics)
    assert [(c.label, c.section_topic) for c in with_topics] == [
        ("Section 1.1", "License classes"),
        ("Section 2.1", ""),
    ]
    # No resolvable official URL → no dead-link citations (grounded-answers rule 5).
    assert serializers.ai_citation_payloads(content, None) == []
    assert serializers.ai_citation_payloads({}, url) == []


def test_prompt_and_schema_require_plain_language_summaries_and_key_points() -> None:
    """Durable enforcement of grounded-answers rule 9 at the enrichment source
    (#520): the generation prompt and schema must instruct plain-language
    summaries and key points with no bill-number prefix and no statute citations,
    while explicitly exempting the verbatim citation `quote` field so grounding
    stays intact. A regression here would let legalese back into the corpus."""
    prompt = ai_enrichment.SYSTEM_PROMPT
    assert "plain-language statements of what the bill does" in prompt
    # The three display fields are named as the scope of the plain-language rule.
    for field in ("`summary`", "`plain_language_summary`", "`key_points`"):
        assert field in prompt
    # No bill-number/"The bill" preamble; no raw statute citations.
    assert "Do NOT begin any of them with the bill number" in prompt
    assert "Do NOT include raw statute citations" in prompt
    # The verbatim citation quote is explicitly exempt (grounding must survive).
    assert "copied verbatim from the supplied excerpt" in prompt

    props = ai_enrichment.SUMMARY_SCHEMA["properties"]
    for field in ("summary", "plain_language_summary", "key_points"):
        desc = props[field].get("description", "")
        assert "Plain-language" in desc
        assert "statute citation" in desc


def test_section_chip_topic_reads_both_heading_columns() -> None:
    """A citation chip's topic comes from the cited section's own heading, and which
    column holds it depends on what the section does:

      * free-standing law  -> section_heading = "Sec. 14. TRANSFER."
      * statute create/amend -> section_heading = "Sec. 2." (bare), and the topic is
        on the cite line: cite_heading = "[16E.40] ADVISORY COUNCIL."

    Reading only section_heading is why most chips rendered a number and no topic
    (on SF 334 sections 1-4 are the statute-creating kind). Consulting both takes
    corpus coverage from 20.6% of sections to 39.6% — 19,771 of the 49,919
    current-version sections in production. The 60% with no topic at all are almost
    entirely repealer sections, which carry no heading in either column, so there is
    nothing honest to put on their chip.
    """
    from alethical.api.serializers import section_chip_topic as topic

    # Free-standing law: the section's own heading, shouted, downcased.
    assert topic("Sec. 14. TRANSFER.", None) == "Transfer"
    assert topic("Section 1. REPEALER.", None) == "Repealer"
    # Statute create/amend: falls through to the cite heading, bracketed number
    # dropped (a raw statute citation never reaches display copy — grounded-answers
    # rule 9).
    assert topic("Sec. 2.", "[16E.40] HUMAN SERVICES SYSTEMS MODERNIZATION FUND.") == (
        "Human services systems modernization fund"
    )
    # A cite heading can carry the number bare rather than bracketed.
    assert topic("Sec. 9.", "174.56 REPORT ON TRUNK HIGHWAY PERFORMANCE") == (
        "Report on trunk highway performance"
    )
    # A compound heading keeps its first clause, the heading's own primary term.
    assert topic("Sec. 7. APPROPRIATION; COUNTY IT SYSTEMS UPDATES.", None) == (
        "Appropriation"
    )
    # Mixed case is the drafter's own and is preserved.
    assert topic("Sec. 5. Office of Higher Education", None) == (
        "Office of Higher Education"
    )
    # No topic anywhere -> "" so the chip renders the number alone, never a
    # dangling middot.
    assert topic("Sec. 3.", None) == ""
    assert topic("Sec. 3.", "[16A.10]") == ""
    assert topic(None, None) == ""

    # The Revisor marks amendments with literal words inline. Such a heading is
    # dropped, not cleaned: choosing which words survive would restate the law.
    assert (
        topic(
            "Sec. 4.",
            "174.56 REPORT ON deleted text begin MAJOR PROJECTS,deleted text end "
            "TRUNK HIGHWAY PERFORMANCE",
        )
        == ""
    )
    assert topic("Sec. 4. new text begin GRANTS new text end", None) == ""

    # Too long to sit on a chip -> dropped rather than truncated, because a cut-off
    # phrase reads as broken while the number alone is a designed state. The limit is
    # where a heading stops being a name and becomes a sentence; the chip wraps to
    # the card, so a two-line name is fine and a clause is not.
    assert topic(f"Sec. 8. {'A' * 81}", None) == ""
    # At the limit it is kept, and an all-caps heading downcases whole.
    assert topic(f"Sec. 8. {'A' * 80}", None) == "A" + "a" * 79
    # Real headings from production that the old 60-char limit dropped, each a plain
    # noun phrase that belongs on a chip. The first is HF 4301 Sec. 1, which is where
    # this came from: its chip read "Sec. 1" with no topic while Sec. 2 next to it
    # read "Sec. 2 · Appropriation", and the only difference was one character.
    assert topic(
        "Section 1. DRINKING WATER REGIONALIZATION PLANNING AND ASSISTANCE GRANTS.",
        None,
    ) == ("Drinking water regionalization planning and assistance grants")
    assert topic(
        "Sec. 3. SUSTAINABLE CONSTRUCTION AND DEMOLITION WASTE TRANSITION GRANTS "
        "PROGRAM.",
        None,
    ) == ("Sustainable construction and demolition waste transition grants program")
    # Past the limit a heading is a full clause, not a name, so it still drops.
    assert (
        topic(
            "Sec. 4. SCOPING ENVIRONMENTAL ASSESSMENT WORKSHEET NOT REQUIRED FOR "
            "PROJECTS THAT REQUIRE A MANDATORY ENVIRONMENTAL IMPACT STATEMENT.",
            None,
        )
        == ""
    )


def test_citation_section_topics_refuses_an_ambiguous_section_id() -> None:
    """A `section_id_text` naming more than one section resolves to NO topic.

    The id is not unique within a version: 66 (version, id) pairs in production name
    several sections, and on HF 1134 the single id "laws.0.1.0" covers three — "Sec.
    126. OAK GROVE; COMPREHENSIVE PLAN.", "Sec. 46. NOWTHEN; COMPREHENSIVE PLAN." and
    a bare "Section 1." Building the map with last-row-wins captioned 58 chips with a
    topic belonging to a section the citation does not point at: HF 1134's Sec. 1 chip
    read "Sec. 1 · Nowthen", and HF 1012's read "Sec. 1 · Forest land off-highway
    vehicle use reclassification", which is Sec. 167's subject.

    Which section is meant is unknowable from the id, so the honest answer is none and
    the chip falls back to the number alone (.claude/rules/grounded-answers.md rule 1).
    Replayed across production this drops 75 on-screen topics and every one was a
    caption belonging to a different section."""
    from alethical.api.routers.public import _citation_section_topics

    def topics(sections: list[tuple[str, str | None, str | None]]) -> dict[str, str]:
        version = SimpleNamespace(id=1, is_current=True)
        bill = SimpleNamespace(versions=[version])
        db = SimpleNamespace(
            execute=lambda _stmt: SimpleNamespace(all=lambda: sections)
        )
        return _citation_section_topics(db, bill)

    # Unique ids resolve normally — the ordinary case, unchanged.
    assert topics(
        [
            ("laws.0.1.0", "Section 1. DRINKING WATER GRANTS.", None),
            ("laws.0.2.0", "Sec. 2. APPROPRIATION.", None),
        ]
    ) == {"laws.0.1.0": "Drinking water grants", "laws.0.2.0": "Appropriation"}

    # The HF 1134 shape: one id, three sections. No topic for it, at all — not the
    # first one, not the last one.
    assert (
        topics(
            [
                ("laws.0.1.0", "Sec. 126. OAK GROVE; COMPREHENSIVE PLAN.", None),
                ("laws.0.1.0", "Sec. 46. NOWTHEN; COMPREHENSIVE PLAN.", None),
                ("laws.0.1.0", "Section 1.", None),
            ]
        )
        == {}
    )

    # A duplicate must not answer on behalf of a heading-less section that shares its
    # id — the heading-less row occupies the id too, so the pair is still ambiguous.
    assert (
        topics(
            [("laws.0.1.0", "Sec. 1.", None), ("laws.0.1.0", "Sec. 9. TRANSFER.", None)]
        )
        == {}
    )
    assert (
        topics(
            [("laws.0.1.0", "Sec. 9. TRANSFER.", None), ("laws.0.1.0", "Sec. 1.", None)]
        )
        == {}
    )

    # One ambiguous id does not poison the version's other, unique ids.
    assert topics(
        [
            ("laws.0.1.0", "Sec. 126. OAK GROVE.", None),
            ("laws.0.1.0", "Sec. 46. NOWTHEN.", None),
            ("laws.0.5.0", "Sec. 5. METROPOLITAN COUNCIL.", None),
        ]
    ) == {"laws.0.5.0": "Metropolitan council"}

    # Rows with no id are skipped without affecting anything else.
    assert (
        topics([(None, "Sec. 1. TRANSFER.", None), ("", "Sec. 2. REPEALER.", None)])
        == {}
    )

    # No current version -> no topics, and no query attempted.
    assert (
        _citation_section_topics(
            SimpleNamespace(execute=None),
            SimpleNamespace(versions=[SimpleNamespace(id=1, is_current=False)]),
        )
        == {}
    )


def test_prompt_consolidates_key_points_with_six_as_a_target_not_a_quota() -> None:
    """The rule is CONSOLIDATION; the count is whatever consolidating produces.
    Six is a target, not a quota — a narrow bill returns fewer, and a genuine
    omnibus with eight distinct subjects left after every merge returns eight.
    Ordering is by subject, not by section number: what the bill creates, then
    when those bodies must act, then the money."""
    prompt = ai_enrichment.SYSTEM_PROMPT

    # Consolidation is the rule, and it decides the count.
    assert "`key_points` is CONSOLIDATED" in prompt
    assert (
        "However many bullets remain after consolidating is the right number" in prompt
    )
    assert "six is a TARGET, not a quota" in prompt
    # Neither failure mode: padding up to six, or dropping substance down to six.
    assert "Do NOT pad to reach six" in prompt
    assert (
        "Do NOT drop, truncate, or compress away the bill's later substance" in prompt
    )
    assert "return eight" in prompt
    # The three merge rules: same fact for two bodies, appropriations, restatements.
    assert "differ only in which body, fund, or agency they name" in prompt
    assert "Merge every appropriation and transfer into ONE money bullet" in prompt
    assert "restates a figure another bullet already carries" in prompt
    # Subject order, explicitly not section order.
    assert "ordered BY SUBJECT rather than by section number" in prompt
    # Only the points needing verbatim proof get a card.
    assert "do NOT pair a citation to every bullet" in prompt


def _prepare_args(tmp_path, *, bill_key: str, min_key_points: int | None):
    return SimpleNamespace(
        database_url=get_database_url(),
        output_dir=str(tmp_path),
        model="gpt-5.2",
        session=None,
        bill_key=bill_key,
        limit=None,
        max_input_chars=60_000,
        force=False,
        only_missing_current=False,
        titles_only=False,
        min_key_points=min_key_points,
    )


def _prepared_item_count(tmp_path, sub: str) -> int:
    run_dir = tmp_path / sub
    manifest_path = next(run_dir.glob("ai-enrichment-*.manifest.json"))
    return len(json.loads(manifest_path.read_text(encoding="utf-8"))["items"])


def test_prepare_min_key_points_selects_only_the_over_target_bills(tmp_path) -> None:
    """`--min-key-points N` is the screen for a re-consolidation run (#723): it
    enqueues only bills whose CURRENT summary already carries at least N key
    points, so a run targeting the over-six bills never pays to redo the bills
    that are already consolidated. Model-agnostic — it screens on what the bill
    displays today (these fixtures are `gpt-4o-mini`, the run is Claude)."""
    long_content = {
        "summary": "Does eight distinct things.",
        "key_points": [f"point {index}" for index in range(8)],
        "policy_areas": [],
    }
    short_content = {
        "summary": "Does six things.",
        "key_points": [f"point {index}" for index in range(6)],
        "policy_areas": [],
    }
    with _session() as db:
        long_bill_id, _ = _make_bill_with_summary(
            db, bill_key="test-2025-HF999010", file_number=999010, content=long_content
        )
        short_bill_id, _ = _make_bill_with_summary(
            db, bill_key="test-2025-HF999011", file_number=999011, content=short_content
        )
        # A bill with sections but NO enrichment: nothing to re-consolidate.
        bare_bill_id, _ = _make_bill_with_sections(
            db,
            bill_key="test-2025-HF999012",
            file_number=999012,
            sections=[("1.1", "Some bill text.")],
        )
    try:
        # Eight points -> in scope at the "more than six" screen.
        ai_enrichment.prepare_batch(
            _prepare_args(
                tmp_path / "over", bill_key="test-2025-HF999010", min_key_points=7
            )
        )
        assert _prepared_item_count(tmp_path, "over") == 1

        # Exactly six -> already consolidated, so not re-run.
        ai_enrichment.prepare_batch(
            _prepare_args(
                tmp_path / "at", bill_key="test-2025-HF999011", min_key_points=7
            )
        )
        assert _prepared_item_count(tmp_path, "at") == 0

        # No current summary -> skipped, not treated as zero points.
        ai_enrichment.prepare_batch(
            _prepare_args(
                tmp_path / "bare", bill_key="test-2025-HF999012", min_key_points=7
            )
        )
        assert _prepared_item_count(tmp_path, "bare") == 0

        # Without the flag the six-point bill is enqueued as before — the screen is
        # opt-in and changes nothing for existing callers.
        ai_enrichment.prepare_batch(
            _prepare_args(
                tmp_path / "unset", bill_key="test-2025-HF999011", min_key_points=None
            )
        )
        assert _prepared_item_count(tmp_path, "unset") == 1
    finally:
        with _session() as db:
            for bill_id in (long_bill_id, short_bill_id, bare_bill_id):
                _cleanup(db, bill_id)


def test_key_points_schema_ceiling_is_a_runaway_guard_not_the_target() -> None:
    """`maxItems` is enforced by strict Structured Outputs, and the model satisfies
    it by TRUNCATING the tail rather than merging — verified against /v1/responses,
    where a 12-item request came back as the first 6 with the rest silently dropped.
    So the schema ceiling must sit well ABOVE the ~6 target: a ceiling at the target
    would mechanically do the one thing the consolidation rule forbids, which is
    drop the bill's later substance. It exists only to stop the pathological case
    (one production bill carried 59 key points)."""
    ceiling = ai_enrichment.SUMMARY_SCHEMA["properties"]["key_points"]["maxItems"]
    # Comfortably above six, so ordinary bills are shaped by the prompt, not clipped.
    assert ceiling >= 10, "a ceiling near the target truncates instead of merging"
    # Still bounded — the guard has to actually guard.
    assert ceiling <= 20

    # The target lives in the prompt and the description, never as the ceiling.
    desc = ai_enrichment.SUMMARY_SCHEMA["properties"]["key_points"]["description"]
    assert "AIM FOR ABOUT SIX" in desc
    assert "target" in desc and "not a quota" in desc
