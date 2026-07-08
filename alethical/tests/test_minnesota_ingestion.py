from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db.models import Legislator, LegislatorServicePeriod
from alethical.db.session import get_engine
from alethical.pipeline.minnesota import (
    MinnesotaIngestionPipeline,
    parse_bill_text_html,
    parse_bill_xml,
)


SAMPLE_BILL_XML = """<?xml version="1.0"?>
<BILL>
  <SESSION_NUMBER>94</SESSION_NUMBER>
  <SESSION_YEAR>2025</SESSION_YEAR>
  <FILE_TYPE>HF</FILE_TYPE>
  <FILE_NUMBER>9999</FILE_NUMBER>
  <REVISOR_NUMBER>25-9999</REVISOR_NUMBER>
  <DESCRIPTION>Test live ingestion bill</DESCRIPTION>
  <AUTHORS>
    <house>
      <AUTHOR>
        <LEGISLATOR_KEY>15518</LEGISLATOR_KEY>
        <MEMBER_NAME>Example Author</MEMBER_NAME>
      </AUTHOR>
    </house>
  </AUTHORS>
  <ACTIONS>
    <house>
      <ACTION>
        <ACTION_NUMBER>1</ACTION_NUMBER>
        <ACTION_GROUP>Intro</ACTION_GROUP>
        <ACTION_TEXT>Introduction and first reading</ACTION_TEXT>
        <ACTION_DATE>04/30/2026</ACTION_DATE>
      </ACTION>
    </house>
  </ACTIONS>
  <TEXT_VERSION_LIST>
    <DOCUMENT>
      <HTML_URI>https://example.test/hf9999.html</HTML_URI>
      <DATE_INSERT>04/30/2026</DATE_INSERT>
      <DOCUMENT_NAME>Introduced</DOCUMENT_NAME>
      <DOCUMENT_TYPE>1</DOCUMENT_TYPE>
      <DOCUMENT_ENGROSSMENT>0</DOCUMENT_ENGROSSMENT>
    </DOCUMENT>
  </TEXT_VERSION_LIST>
</BILL>
"""


SAMPLE_BILL_HTML = """
<html>
  <head><title>HF 9999</title></head>
  <body>
    <div class="bill_title">A bill for an act relating to live ingestion tests.</div>
    <div class="bill_section" id="section-1">
      <h2 class="section_number">Section 1.</h2>
      <p>Test section text.</p>
    </div>
  </body>
</html>
"""


def test_bill_parsers_extract_canonical_payloads() -> None:
    canonical = parse_bill_xml(SAMPLE_BILL_XML)
    bill_text = parse_bill_text_html(
        SAMPLE_BILL_HTML, "https://example.test/hf9999.html"
    )

    assert canonical["bill_key"] == "94-2025-HF9999"
    assert canonical["authors"]["house"][0]["member_name"] == "Example Author"
    assert (
        canonical["actions"]["house"][0]["action_text"]
        == "Introduction and first reading"
    )
    assert (
        bill_text["bill_title_text"]
        == "A bill for an act relating to live ingestion tests."
    )
    assert bill_text["sections"][0]["text"] == "Test section text."


def test_roster_only_member_can_be_ingested(seed_database: None) -> None:
    with Session(get_engine()) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        refs = pipeline.seed_reference_data()

        legislator = pipeline.ingest_member_profile(
            refs,
            {
                "chamber": "house",
                "display_name": "Rep. Example Roster",
                "district": "60B",
                "profile_url": "https://example.test/representatives/60b",
                "image_url": "https://example.test/representatives/60b.jpg",
            },
        )

        service_period = session.scalar(
            select(LegislatorServicePeriod).where(
                LegislatorServicePeriod.legislator_id == legislator.id
            )
        )

        assert (
            session.scalar(
                select(Legislator.full_name).where(Legislator.id == legislator.id)
            )
            == "Rep. Example Roster"
        )
        assert service_period is not None
        assert service_period.profile_url == "https://example.test/representatives/60b"
        assert (
            service_period.photo_url == "https://example.test/representatives/60b.jpg"
        )
