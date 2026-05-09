from __future__ import annotations

import os

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from alethical.db.schema import load_schema
from alethical.db.session import normalize_database_url
from alethical.ingestion import minnesota
from alethical.ingestion.minnesota import BillTarget, MinnesotaIngestionPipeline, parse_bill_text_html, parse_bill_xml

schema = load_schema()
Bill = schema.Bill
BillAction = schema.BillAction
BillVersionSection = schema.BillVersionSection


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
    bill_text = parse_bill_text_html(SAMPLE_BILL_HTML, "https://example.test/hf9999.html")

    assert canonical["bill_key"] == "94-2025-HF9999"
    assert canonical["authors"]["house"][0]["member_name"] == "Example Author"
    assert canonical["actions"]["house"][0]["action_text"] == "Introduction and first reading"
    assert bill_text["bill_title_text"] == "A bill for an act relating to live ingestion tests."
    assert bill_text["sections"][0]["text"] == "Test section text."


def test_live_bill_ingestion_is_rerunnable(seed_database, monkeypatch) -> None:
    def fake_discover_bill(_sess, _target):
        return {
            "file_type": "HF",
            "file_number": "9999",
            "description": "Test live ingestion bill",
            "status_xml_uri": "https://example.test/hf9999.xml",
            "latest_text_html_uri": "https://example.test/hf9999.html",
        }

    def fake_fetch_text(_sess, url):
        if url.endswith(".xml"):
            return SAMPLE_BILL_XML
        return SAMPLE_BILL_HTML

    monkeypatch.setattr(minnesota, "discover_bill", fake_discover_bill)
    monkeypatch.setattr(minnesota, "fetch_text", fake_fetch_text)

    database_url = normalize_database_url(
        os.environ.get("DATABASE_URL", "postgresql+psycopg://alethical:alethical@localhost:54329/alethical")
    )
    engine = create_engine(database_url, echo=False)
    with Session(engine) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        target = BillTarget(chamber="House", bill_number="9999")
        pipeline.ingest_bills([target])
        pipeline.ingest_bills([target])
        session.commit()

        bill = session.scalar(select(Bill).where(Bill.bill_key == "94-2025-HF9999"))
        assert bill is not None
        assert bill.title == "A bill for an act relating to live ingestion tests."
        assert session.scalar(select(func.count()).select_from(Bill).where(Bill.bill_key == "94-2025-HF9999")) == 1
        assert session.scalar(select(func.count()).select_from(BillAction).where(BillAction.bill_id == bill.id)) == 1
        assert (
            session.scalar(
                select(func.count())
                .select_from(BillVersionSection)
                .join(schema.BillVersion, schema.BillVersion.id == BillVersionSection.bill_version_id)
                .where(schema.BillVersion.bill_id == bill.id)
            )
            == 1
        )
