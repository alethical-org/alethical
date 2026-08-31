from __future__ import annotations

import hashlib

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_engine
from alethical.pipeline.minnesota import (
    APPENDIX_PARSER_VERSION,
    MinnesotaIngestionError,
    compute_appendix_source_hash,
    parse_bill_section,
    parse_bill_text_html,
    replace_bill_version_prompt_context,
)


SOURCE_URL = "https://example.test/bill.html"


def _assert_reference_contract(
    reference: dict[str, object],
    *,
    source_order: int,
    reference_kind: str,
    official_reference: str,
    linked_section_id_text: str | None = None,
    linked_section_source_order: int | None = None,
) -> None:
    expected_keys = {
        "source_order",
        "reference_kind",
        "official_reference",
        "raw_text",
        "body_blocks",
        "source_hash",
    }
    if linked_section_id_text is not None:
        expected_keys.update({"linked_section_id_text", "linked_section_source_order"})

    assert set(reference) == expected_keys
    assert reference["source_order"] == source_order
    assert reference["reference_kind"] == reference_kind
    assert reference["official_reference"] == official_reference
    assert (
        reference["source_hash"]
        == hashlib.sha256(str(reference["raw_text"]).encode("utf-8")).hexdigest()
    )

    if linked_section_id_text is not None:
        assert reference["linked_section_id_text"] == linked_section_id_text
        assert reference["linked_section_source_order"] == linked_section_source_order


def test_no_appendix_keeps_the_existing_bill_payload_byte_for_byte() -> None:
    parsed = parse_bill_text_html(
        """
        <html>
          <head><title>HF 4138</title></head>
          <body>
            <div class="bill_title">A bill for an act relating to testing.</div>
            <div class="bill_section" id="laws.0.1.0">
              <h2 class="section_number">Section 1.</h2>
              <p>Keep this proposed text unchanged.</p>
            </div>
          </body>
        </html>
        """,
        SOURCE_URL,
    )

    reader_sections = [
        {
            key: section[key]
            for key in (
                "section_id",
                "heading",
                "statute_heading",
                "cite_heading",
                "effective_date_heading",
                "text",
                "blocks",
            )
        }
        for section in parsed["sections"]
    ]
    assert {
        key: parsed[key]
        for key in ("source_url", "page_title", "bill_title_text", "articles")
    } == {
        "source_url": SOURCE_URL,
        "page_title": "HF 4138",
        "bill_title_text": "A bill for an act relating to testing.",
        "articles": [],
    }
    assert reader_sections == [
        {
            "section_id": "laws.0.1.0",
            "heading": "Section 1.",
            "statute_heading": "",
            "cite_heading": "",
            "effective_date_heading": "",
            "text": "Keep this proposed text unchanged.",
            "blocks": [{"kind": "para", "text": "Keep this proposed text unchanged."}],
        }
    ]
    assert parsed["appendix_references"] == []
    assert parsed["appendix_parser_version"] == APPENDIX_PARSER_VERSION
    assert parsed["appendix_parse_complete"] is True
    assert parsed["appendix_present"] is False
    assert len(str(parsed["appendix_source_hash"])) == 64


def test_appendix_source_hash_covers_presence_order_and_terminal_reference() -> None:
    references = [
        ("repealed_statute", "10.01 OLD STATUTE.", "a" * 64),
        ("repealed_session_law", "Laws 2020, chapter 1", "b" * 64),
    ]
    complete = compute_appendix_source_hash(True, references)

    assert complete != compute_appendix_source_hash(True, references[:-1])
    assert complete != compute_appendix_source_hash(True, reversed(references))
    assert complete != compute_appendix_source_hash(False, references)


def test_nested_rlang_inside_outer_appendix_is_parsed_exactly_once() -> None:
    parsed = parse_bill_text_html(
        """
        <html>
          <head><title>Nested appendix wrapper</title></head>
          <body>
            <div class="bill_section" id="laws.0.1.0">
              <h2 class="section_number">Section 1.</h2>
              <p>Current proposed text.</p>
            </div>
            <div class="rlang">
              <p>Repealed Minnesota Statutes: TEST-1</p>
              <div class="rlang">
                <h2 class="title">APPENDIX</h2>
                <div class="repealed_statutes">
                  <h1 class="shn">1.01 OLD LAW.</h1>
                  <div class="subd" id="laws.0.0.1">
                    <h2 class="subd_no">Subdivision 1.</h2>
                    <p>Old law text.</p>
                  </div>
                </div>
              </div>
            </div>
          </body>
        </html>
        """,
        SOURCE_URL,
    )

    assert parsed["appendix_present"] is True
    assert parsed["appendix_parse_complete"] is True
    assert len(parsed["appendix_references"]) == 1
    reference = parsed["appendix_references"][0]
    assert reference["source_order"] == 1
    assert reference["reference_kind"] == "repealed_statute"
    assert reference["official_reference"] == "1.01 OLD LAW."
    assert " ".join(str(reference["raw_text"]).split()) == (
        "Subdivision 1. Old law text."
    )


def test_proposed_sections_keep_page_order_when_an_article_is_in_the_middle() -> None:
    parsed = parse_bill_text_html(
        """
        <html>
          <head><title>Mixed section order</title></head>
          <body>
            <div class="bill_section" id="outside-before">
              <h2 class="section_number">Section 1.</h2>
              <p>Outside before the article.</p>
            </div>
            <div class="article" id="article-1">
              <h1 class="article_no">ARTICLE 1</h1>
              <h1 class="article_header">MIDDLE ARTICLE</h1>
              <div class="bill_section" id="inside-middle">
                <h2 class="section_number">Sec. 2.</h2>
                <p>Inside the middle article.</p>
              </div>
            </div>
            <div class="bill_section" id="outside-after">
              <h2 class="section_number">Sec. 3.</h2>
              <p>Outside after the article.</p>
            </div>
          </body>
        </html>
        """,
        SOURCE_URL,
    )

    assert [section["section_id"] for section in parsed["sections"]] == [
        "outside-before",
        "inside-middle",
        "outside-after",
    ]
    assert parsed["articles"] == [
        {
            "article_id": "article-1",
            "article_number": "ARTICLE 1",
            "article_heading": "MIDDLE ARTICLE",
            "sections": [parsed["sections"][1]],
        }
    ]


def test_sf3755_appendix_keeps_repealed_law_out_of_the_proposed_text_identity() -> None:
    parsed = parse_bill_text_html(
        """
        <html>
          <head><title>SF 3755</title></head>
          <body>
            <div class="bill_section" id="laws.0.1.0">
              <h2 class="section_number">Section 1.</h2>
              <p>The proposal changes housing services.</p>
            </div>
            <div class="rlang">
              <h2 class="title">APPENDIX</h2>
              <p>Repealed Minnesota Statutes: S3755-2</p>
              <div class="repealed_statutes">
                <h1 class="shn">256B.051 HOUSING STABILIZATION SERVICES.</h1>
                <div class="subd" id="laws.0.0.1">
                  <h2 class="subd_no">Subdivision 1.</h2>
                  <h3 class="headnote">Purpose.</h3>
                  <p>Old housing stabilization services are established.</p>
                </div>
                <div class="subd" id="laws.0.0.2">
                  <h2 class="subd_no">Subd. 2.</h2>
                  <h3 class="headnote">Definitions.</h3>
                  <p>Old housing services include transition services.</p>
                </div>
              </div>
              <p>Repealed Minnesota Session Laws: S3755-2</p>
              <div class="a-wrapper-name-the-parser-must-not-depend-on">
                <div class="another-wrapper">
                  <p>Laws 2025, First Special Session chapter 3, article 18,
                     section 3</p>
                  <div class="bill_section uncoded" id="laws.0.1.0">
                    <h2 class="section_number">Sec. 3.
                      <span class="headnote">DIRECTION TO COMMISSIONER.</span>
                    </h2>
                    <p>The commissioner must submit an Indian Health Service plan
                       for facilities owned or operated by a Tribe or Tribal
                       organization.</p>
                  </div>
                </div>
              </div>
            </div>
          </body>
        </html>
        """,
        SOURCE_URL,
    )

    references = parsed["appendix_references"]
    assert isinstance(references, list)
    assert len(references) == 2

    statute = references[0]
    _assert_reference_contract(
        statute,
        source_order=1,
        reference_kind="repealed_statute",
        official_reference="256B.051 HOUSING STABILIZATION SERVICES.",
    )
    assert statute["body_blocks"] == [
        {"kind": "heading", "number": "Subdivision 1.", "text": "Purpose."},
        {
            "kind": "para",
            "text": "Old housing stabilization services are established.",
        },
        {"kind": "heading", "number": "Subd. 2.", "text": "Definitions."},
        {
            "kind": "para",
            "text": "Old housing services include transition services.",
        },
    ]

    session_law = references[1]
    _assert_reference_contract(
        session_law,
        source_order=2,
        reference_kind="repealed_session_law",
        official_reference=(
            "Laws 2025, First Special Session chapter 3, article 18, section 3"
        ),
        linked_section_id_text="laws.0.1.0",
        linked_section_source_order=2,
    )
    statute_text = " ".join(str(statute["raw_text"]).split())
    session_law_text = " ".join(str(session_law["raw_text"]).split())
    assert "Indian Health Service" not in statute_text
    assert "Indian Health Service" in session_law_text
    assert "Tribe or Tribal organization" in session_law_text

    # The appendix section still follows the old reader and search payload shape.
    # Its repeated source id does not replace the proposal section with the same id.
    assert [section["section_id"] for section in parsed["sections"]] == [
        "laws.0.1.0",
        "laws.0.1.0",
    ]
    assert parsed["sections"][1]["section_id"] == "laws.0.1.0"
    assert " ".join(str(parsed["sections"][1]["heading"]).split()) == (
        "Sec. 3. DIRECTION TO COMMISSIONER."
    )
    assert parsed["sections"][1]["blocks"] == [
        {
            "kind": "para",
            "text": (
                "The commissioner must submit an Indian Health Service plan "
                "for facilities owned or operated by a Tribe or Tribal "
                "organization."
            ),
        }
    ]
    assert session_law["raw_text"] == parsed["sections"][1]["text"]
    assert session_law["body_blocks"] == parsed["sections"][1]["blocks"]


def test_saving_prompt_context_does_not_rewrite_reader_or_search_rows() -> None:
    parsed = parse_bill_text_html(
        """
        <html>
          <head><title>Storage test</title></head>
          <body>
            <div class="bill_section" id="laws.0.1.0">
              <h2 class="section_number">Section 1.</h2>
              <p>Current proposed language.</p>
            </div>
            <div class="rlang">
              <h2 class="title">APPENDIX</h2>
              <p>Repealed Minnesota Session Laws: TEST-1</p>
              <div class="not-a-known-wrapper">
                <p>Laws 2025, chapter 1, section 3</p>
                <div class="bill_section uncoded" id="laws.0.1.0">
                  <h2 class="section_number">Sec. 3.</h2>
                  <p>Old session-law text.</p>
                </div>
              </div>
            </div>
          </body>
        </html>
        """,
        SOURCE_URL,
    )

    with Session(get_engine()) as db:
        bill_id = db.scalar(select(schema.Bill.id).limit(1))
        assert bill_id is not None
        version = schema.BillVersion(
            bill_id=bill_id,
            version_code="appendix-storage-test",
            sequence_number=99,
            is_current=False,
        )
        db.add(version)
        db.flush()

        saved_sections = []
        for source_order, parsed_section in enumerate(parsed["sections"], start=1):
            saved = schema.BillVersionSection(
                bill_version_id=version.id,
                section_id_text=parsed_section["section_id"],
                source_order=source_order,
                section_heading=parsed_section["heading"] or None,
                raw_text=parsed_section["text"],
                body_blocks=parsed_section["blocks"],
                source_hash=hashlib.sha256(
                    str(parsed_section["text"]).encode("utf-8")
                ).hexdigest(),
            )
            db.add(saved)
            saved_sections.append(saved)
        db.flush()

        search_row = schema.RagSectionDocument(
            bill_id=bill_id,
            bill_version_id=version.id,
            bill_version_section_id=saved_sections[0].id,
            citation_label="Section 1",
            clean_text=saved_sections[0].raw_text,
            cleaning_version="appendix-storage-test",
            source_hash=saved_sections[0].source_hash,
            word_count=len(saved_sections[0].raw_text.split()),
        )
        db.add(search_row)
        db.flush()
        reader_before = [
            (section.id, section.raw_text, section.source_hash, section.body_blocks)
            for section in saved_sections
        ]
        search_before = (
            search_row.id,
            search_row.citation_label,
            search_row.clean_text,
            search_row.source_hash,
        )

        replace_bill_version_prompt_context(db, version, parsed)
        db.flush()

        references = db.scalars(
            select(schema.BillVersionAppendixReference).where(
                schema.BillVersionAppendixReference.bill_version_id == version.id
            )
        ).all()
        assert len(references) == 1
        assert references[0].source_order == 1
        assert references[0].reference_kind == "repealed_session_law"
        assert references[0].bill_version_section_id == saved_sections[1].id
        assert references[0].raw_text is None
        assert references[0].body_blocks is None
        assert version.appendix_parse_complete is True
        assert version.appendix_present is True
        assert version.change_role_parse_complete is True
        assert all(section.change_role_parse_complete for section in saved_sections)
        assert [section.change_role_segments for section in saved_sections] == [
            parsed_section["change_role_segments"]
            for parsed_section in parsed["sections"]
        ]

        for section in saved_sections:
            db.refresh(section)
        db.refresh(search_row)
        assert [
            (section.id, section.raw_text, section.source_hash, section.body_blocks)
            for section in saved_sections
        ] == reader_before
        assert (
            search_row.id,
            search_row.citation_label,
            search_row.clean_text,
            search_row.source_hash,
        ) == search_before


def test_logical_references_keep_official_page_order_across_all_three_kinds() -> None:
    parsed = parse_bill_text_html(
        """
        <html>
          <head><title>Mixed appendix</title></head>
          <body>
            <div class="rlang">
              <h2 class="title">APPENDIX</h2>
              <p>Repealed Minnesota Statutes: TEST-1</p>
              <div class="repealed_statutes">
                <h1 class="shn">10.01 FIRST OLD STATUTE.</h1>
                <div class="subd" id="laws.0.0.1">
                  <h2 class="subd_no">Subdivision 1.</h2>
                  <h3 class="headnote">First part.</h3>
                  <p>First statute body.</p>
                </div>
                <div class="subd" id="laws.0.0.2">
                  <h2 class="subd_no">Subd. 2.</h2>
                  <h3 class="headnote">Second part.</h3>
                  <p>Second statute body.</p>
                </div>
                <h1 class="shn">10.02 SECOND OLD STATUTE.</h1>
                <p>Second statute text without a subdivision.</p>
              </div>
              <p>Repealed Minnesota Session Laws: TEST-1</p>
              <div class="repealed_laws">
                <p>Laws 2020, chapter 10, section 4</p>
                <div class="bill_section uncoded" id="laws.0.4.0">
                  <h2 class="section_number">Sec. 4.</h2>
                  <p>Old session-law text.</p>
                </div>
              </div>
              <p>Repealed Minnesota Rule: TEST-1</p>
              <div class="repealed_rules">
                <div class="part" id="rule.1000.0100">
                  <h1 class="headnote">1000.0100 FIRST OLD RULE.</h1>
                  <div class="item">
                    <h3 class="item_no">A.</h3>
                    <p>First old rule text.</p>
                  </div>
                </div>
                <div class="part" id="rule.1000.0200">
                  <h1 class="headnote">1000.0200 SECOND OLD RULE.</h1>
                  <p>Second old rule text.</p>
                </div>
              </div>
            </div>
          </body>
        </html>
        """,
        SOURCE_URL,
    )

    references = parsed["appendix_references"]
    assert isinstance(references, list)
    assert [reference["source_order"] for reference in references] == [1, 2, 3, 4, 5]
    assert [reference["reference_kind"] for reference in references] == [
        "repealed_statute",
        "repealed_statute",
        "repealed_session_law",
        "repealed_rule",
        "repealed_rule",
    ]
    assert [reference["official_reference"] for reference in references] == [
        "10.01 FIRST OLD STATUTE.",
        "10.02 SECOND OLD STATUTE.",
        "Laws 2020, chapter 10, section 4",
        "1000.0100 FIRST OLD RULE.",
        "1000.0200 SECOND OLD RULE.",
    ]

    first_statute = references[0]
    assert "First statute body." in str(first_statute["raw_text"])
    assert "Second statute body." in str(first_statute["raw_text"])

    statute_without_subdivisions = references[1]
    assert "Second statute text without a subdivision." in str(
        statute_without_subdivisions["raw_text"]
    )
    assert "First statute body." not in str(statute_without_subdivisions["raw_text"])

    for source_order, reference_kind, official_reference in (
        (1, "repealed_statute", "10.01 FIRST OLD STATUTE."),
        (2, "repealed_statute", "10.02 SECOND OLD STATUTE."),
        (4, "repealed_rule", "1000.0100 FIRST OLD RULE."),
        (5, "repealed_rule", "1000.0200 SECOND OLD RULE."),
    ):
        _assert_reference_contract(
            references[source_order - 1],
            source_order=source_order,
            reference_kind=reference_kind,
            official_reference=official_reference,
        )

    _assert_reference_contract(
        references[2],
        source_order=3,
        reference_kind="repealed_session_law",
        official_reference="Laws 2020, chapter 10, section 4",
        linked_section_id_text="laws.0.4.0",
        linked_section_source_order=1,
    )
    assert "A." in str(references[3]["body_blocks"])
    assert "First old rule text." in str(references[3]["body_blocks"])


def test_sf3045_repeated_section_ids_keep_two_distinct_session_law_references() -> None:
    parsed = parse_bill_text_html(
        """
        <html>
          <head><title>SF 3045</title></head>
          <body>
            <div class="bill_section" id="laws.0.1.0">
              <h2 class="section_number">Section 1.</h2>
              <p>Current proposed language.</p>
            </div>
            <div class="rlang">
              <h2 class="title">APPENDIX</h2>
              <p>Repealed Minnesota Session Laws: S3045-4</p>
              <div class="wrapper-with-an-unrelated-class">
                <p>Laws 2019, First Special Session chapter 3, article 2,
                   section 34</p>
                <div class="bill_section uncoded" id="laws.0.1.0">
                  <div class="subd" id="laws.0.1.1">
                    <h2 class="subd_no">Subdivision 1.</h2>
                    <h3 class="headnote">Legislative commissions.</h3>
                    <p>Old headingless commission text.</p>
                  </div>
                </div>
                <p>Laws 2022, chapter 50, article 3, section 2</p>
                <div class="bill_section uncoded" id="laws.0.1.0">
                  <h2 class="section_number">Sec. 2.</h2>
                  <p>Old COVID-19 response commission text.</p>
                </div>
              </div>
            </div>
          </body>
        </html>
        """,
        SOURCE_URL,
    )

    references = parsed["appendix_references"]
    assert isinstance(references, list)
    assert len(references) == 2
    assert [reference["source_order"] for reference in references] == [1, 2]
    assert [reference["official_reference"] for reference in references] == [
        "Laws 2019, First Special Session chapter 3, article 2, section 34",
        "Laws 2022, chapter 50, article 3, section 2",
    ]
    assert [reference["linked_section_id_text"] for reference in references] == [
        "laws.0.1.0",
        "laws.0.1.0",
    ]
    assert [reference["linked_section_source_order"] for reference in references] == [
        2,
        3,
    ]
    assert references[0]["raw_text"] != references[1]["raw_text"]
    assert [section["section_id"] for section in parsed["sections"]] == [
        "laws.0.1.0",
        "laws.0.1.0",
        "laws.0.1.0",
    ]
    assert parsed["sections"][1]["heading"] == ""
    assert parsed["sections"][2]["heading"] == "Sec. 2."


def test_sf1832_finds_appendix_after_10_articles_and_105_proposed_sections() -> None:
    proposal_sections = []
    section_number = 0
    for article_number in range(1, 11):
        article_sections = []
        sections_in_article = 11 if article_number <= 5 else 10
        for _ in range(sections_in_article):
            section_number += 1
            article_sections.append(
                f"""
                <div class="bill_section" id="laws.{article_number}.{section_number}.0">
                  <h2 class="section_number">Sec. {section_number}.</h2>
                  <p>Proposed section {section_number}.</p>
                </div>
                """
            )
        proposal_sections.append(
            f"""
            <div class="article" id="article-{article_number}">
              <h1 class="article_no">ARTICLE {article_number}</h1>
              <h1 class="article_header">TEST ARTICLE {article_number}</h1>
              {"".join(article_sections)}
            </div>
            """
        )

    parsed = parse_bill_text_html(
        f"""
        <html>
          <head><title>SF 1832</title></head>
          <body>
            {"".join(proposal_sections)}
            <div class="rlang">
              <h2 class="title">APPENDIX</h2>
              <p>Repealed Minnesota Session Laws: S1832-4</p>
              <div class="repealed_laws">
                <p>Laws 2024, chapter 1, section 1</p>
                <div class="bill_section" id="laws.0.1.0">
                  <h2 class="section_number">Section 1.</h2>
                  <p>Old reference text after the full proposal.</p>
                </div>
              </div>
            </div>
          </body>
        </html>
        """,
        SOURCE_URL,
    )

    assert section_number == 105
    assert len(parsed["articles"]) == 10
    assert len(parsed["sections"]) == 106
    assert len(parsed["appendix_references"]) == 1
    appendix = parsed["appendix_references"][0]
    assert appendix["source_order"] == 1
    assert appendix["reference_kind"] == "repealed_session_law"
    assert appendix["linked_section_source_order"] == 106
    assert parsed["appendix_parse_complete"] is True


def test_appendix_with_only_no_active_language_has_no_reference_records() -> None:
    parsed = parse_bill_text_html(
        """
        <html>
          <head><title>SF 2298</title></head>
          <body>
            <div class="rlang">
              <h2 class="title">APPENDIX</h2>
              <p>Repealed Minnesota Statutes: S2298-4</p>
              <div class="repealed_statutes">
                <p>No active language found for: 16A.287</p>
                <p>No active language found for: 462A.43</p>
              </div>
            </div>
          </body>
        </html>
        """,
        SOURCE_URL,
    )

    assert parsed["sections"] == []
    assert parsed["appendix_references"] == []


def test_statute_heading_with_no_active_language_has_no_reference_record() -> None:
    parsed = parse_bill_text_html(
        """
        <html>
          <head><title>No active statute body</title></head>
          <body>
            <div class="rlang">
              <h2 class="title">APPENDIX</h2>
              <p>Repealed Minnesota Statutes: TEST-4</p>
              <div class="repealed_statutes">
                <h1 class="shn">16A.287 OLD STATUTE.</h1>
                <p>No active language found for: 16A.287</p>
              </div>
            </div>
          </body>
        </html>
        """,
        SOURCE_URL,
    )

    assert parsed["appendix_present"] is True
    assert parsed["appendix_parse_complete"] is True
    assert parsed["appendix_no_active_count"] == 1
    assert parsed["appendix_references"] == []


def test_explicitly_empty_session_law_placeholder_is_complete_context() -> None:
    parsed = parse_bill_text_html(
        """
        <html>
          <head><title>HF 2115</title></head>
          <body>
            <div class="bill_section" id="laws.0.1.0">
              <h2 class="section_number">Section 1.</h2>
              <p>Current proposed language.</p>
            </div>
            <div class="rlang">
              <h2 class="title">APPENDIX</h2>
              <p>Repealed Minnesota Session Laws: H2115-3</p>
              <div class="repealed_laws">
                <p>Laws 2024, chapter 79, article 1, section 15</p>
                <div class="bill_section am_subd" id="laws.0.1.0"/>
              </div>
            </div>
          </body>
        </html>
        """,
        SOURCE_URL,
    )

    assert parsed["appendix_present"] is True
    assert parsed["appendix_parse_complete"] is True
    assert len(parsed["appendix_references"]) == 1
    reference = parsed["appendix_references"][0]
    assert reference["reference_kind"] == "repealed_session_law"
    assert reference["official_reference"] == (
        "Laws 2024, chapter 79, article 1, section 15"
    )
    assert reference["raw_text"] == ""
    assert reference["source_hash"] == hashlib.sha256(b"").hexdigest()
    assert reference["linked_section_source_order"] == 2


def test_unknown_meaningful_appendix_content_is_not_safe_to_store() -> None:
    parsed = parse_bill_text_html(
        """
        <html>
          <head><title>Unknown appendix format</title></head>
          <body>
            <div class="rlang">
              <h2 class="title">APPENDIX</h2>
              <p>Repealed Minnesota Ordinances: TEST-1</p>
              <div class="repealed_ordinances">
                <p>Old city program text that the parser does not understand.</p>
              </div>
            </div>
          </body>
        </html>
        """,
        SOURCE_URL,
    )

    assert parsed["appendix_present"] is True
    assert parsed["appendix_references"] == []
    assert parsed["appendix_parse_complete"] is False
    with pytest.raises(
        MinnesotaIngestionError, match="APPENDIX parsing was not complete"
    ):
        replace_bill_version_prompt_context(None, None, parsed)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "change_html",
    [
        (
            '<span class="sr-only">new text begin </span>'
            "an alleged new duty"
            '<span class="sr-only">new text end </span>'
        ),
        '<ins style="text-decoration: underline">an unlabeled new duty</ins>',
        (
            '<span class="sr-only">deleted text begin </span>'
            '<span class="del" style="text-decoration: line-through">'
            "an old duty</span>"
        ),
    ],
)
def test_unprovable_or_malformed_change_markup_is_not_complete(
    change_html: str,
) -> None:
    section = parse_bill_section(
        f"""
        <div class="bill_section" id="laws.0.1.0">
          <h2 class="section_number">Section 1.</h2>
          <p>The agency has {change_html}.</p>
        </div>
        """,
        "laws.0.1.0",
    )

    assert section["change_role_parse_complete"] is False


def test_sf3755_proposed_text_keeps_added_and_carried_forward_roles() -> None:
    section_html = """
    <div class="bill_section" id="laws.0.5.0">
      <h2 class="section_number">Sec. 5.</h2>
      <p>The agency must
        <span class="sr-only">new text begin </span>
        <ins style="text-decoration: underline">publish the text of all public
        comments on the agency's website and</ins>
        <span class="sr-only">new text end </span>
        give the legislature 30 days' notice, allow 30 days for public comment,
        publish existing requests, and give notice of the federal decision.</p>
    </div>
    """
    parsed = parse_bill_text_html(
        f"<html><body>{section_html}</body></html>", SOURCE_URL
    )
    section = parsed["sections"][0]

    assert section["change_role_parse_complete"] is True
    assert section["change_role_segments"] == [
        {"role": "carried_forward", "text": "The agency must "},
        {
            "role": "added",
            "text": "publish the text of all public comments on the agency's website and",
        },
        {
            "role": "carried_forward",
            "text": (
                " give the legislature 30 days' notice, allow 30 days for public "
                "comment, publish existing requests, and give notice of the "
                "federal decision."
            ),
        },
    ]
    assert len(str(section["change_role_source_hash"])) == 64

    # The reader and search copy stays on the established flat-text path. The
    # added phrase is present, but no new role marker changes its bytes or hash.
    legacy = parse_bill_section(section_html, "laws.0.5.0")
    assert section["text"] == legacy["text"]
    assert (
        hashlib.sha256(str(section["text"]).encode()).hexdigest()
        == hashlib.sha256(str(legacy["text"]).encode()).hexdigest()
    )
