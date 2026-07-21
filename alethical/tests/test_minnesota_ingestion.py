from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db.models import (
    ArtifactType,
    Bill,
    BillAction,
    BillVersion,
    Legislator,
    LegislatorServicePeriod,
    LegislatorStats,
)
from alethical.db.session import get_engine
from alethical.pipeline.minnesota import (
    LEGISLATOR_LOCK_KEY,
    REFERENCE_DATA_LOCK_KEY,
    MinnesotaIngestionPipeline,
    parse_bill_text_html,
    parse_bill_xml,
    parse_datetime,
)


SAMPLE_BILL_XML = """<?xml version="1.0"?>
<BILL>
  <SESSION_NUMBER>94</SESSION_NUMBER>
  <SESSION_YEAR>2025</SESSION_YEAR>
  <FILE_TYPE>HF</FILE_TYPE>
  <FILE_NUMBER>9999</FILE_NUMBER>
  <REVISOR_NUMBER>25-9999</REVISOR_NUMBER>
  <DESCRIPTION>Test live ingestion bill</DESCRIPTION>
  <COMPANION_TYPE>SF</COMPANION_TYPE>
  <COMPANION_NUMBER>9998</COMPANION_NUMBER>
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
    assert canonical["companion_type"] == "SF"
    assert canonical["companion_number"] == "9998"
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


def test_refresh_legislator_stats_scopes_to_given_ids(seed_database: None) -> None:
    """#257: refresh_legislator_stats(refs, legislator_ids=...) recomputes only the
    given legislators, so concurrent bill-sync chunk workers don't all rewrite every
    legislator_stats row and deadlock to a statement timeout. Passing None keeps the
    whole-jurisdiction behavior the roster sync relies on."""
    with Session(get_engine()) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        refs = pipeline.seed_reference_data()
        session_id = refs["session"].id
        touched = pipeline.upsert_legislator(refs, "Rep. Touched", external_key="t-1")
        untouched = pipeline.upsert_legislator(
            refs, "Rep. Untouched", external_key="u-1"
        )
        session.flush()

        def stats_for(legislator_id: uuid.UUID) -> LegislatorStats | None:
            return session.scalar(
                select(LegislatorStats).where(
                    LegislatorStats.legislator_id == legislator_id,
                    LegislatorStats.session_id == session_id,
                )
            )

        # Scoped: only the named legislator's stats are (re)computed.
        pipeline.refresh_legislator_stats(refs, legislator_ids={touched.id})
        assert stats_for(touched.id) is not None
        assert stats_for(untouched.id) is None

        # None → whole jurisdiction (roster path), so the other one now gets stats too.
        pipeline.refresh_legislator_stats(refs)
        assert stats_for(untouched.id) is not None


def test_reference_upserts_skip_advisory_lock_when_rows_exist(
    seed_database: None, monkeypatch
) -> None:
    """Double-checked locking: seed_reference_data / upsert_legislator take the
    advisory lock only when they actually insert. On a refresh (rows already
    present) they skip it, so concurrent chunks don't serialize on it.
    Regression guard for the ~7h→~1h refresh speedup."""
    with Session(get_engine()) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        refs = pipeline.seed_reference_data()
        session.commit()

        lock_calls: list[int] = []
        monkeypatch.setattr(
            pipeline, "advisory_xact_lock", lambda key: lock_calls.append(key)
        )

        # Reference data already present -> no reference lock.
        pipeline.seed_reference_data()
        assert REFERENCE_DATA_LOCK_KEY not in lock_calls

        # New legislator -> insert path takes the legislator lock. Unique key +
        # no commit (rollback at end) keeps the test idempotent across runs.
        new_key = f"tm-{uuid.uuid4().hex[:12]}"
        lock_calls.clear()
        pipeline.upsert_legislator(refs, "Test Member A", external_key=new_key)
        assert LEGISLATOR_LOCK_KEY in lock_calls

        # Same legislator again (now present in-session) -> no lock.
        lock_calls.clear()
        again = pipeline.upsert_legislator(refs, "Test Member A", external_key=new_key)
        assert lock_calls == []
        assert again.external_key == new_key

        session.rollback()


def test_reingest_with_new_version_code_keeps_one_current(seed_database: None) -> None:
    """#285 regression: a refresh that introduces a new version_code — the real
    engrossment code, when the prior ingest stored the "current" fallback — must
    leave exactly one is_current version per bill, not double the flag. The old
    version is retained (superseded) but demoted."""
    with Session(get_engine()) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        refs = pipeline.seed_reference_data()
        run = pipeline.start_run("bill", "94-2025-HF8888")
        artifact = pipeline.record_artifact(
            run,
            ArtifactType.html,
            "https://example.test/hf8888.html",
            "<html></html>",
        )

        bill = Bill(
            session_id=refs["session"].id,
            chamber_id=refs["chambers"]["house"].id,
            bill_key="94-2025-HF8888",
            file_type="HF",
            file_number=8888,
            title="Dup-current regression bill",
        )
        session.add(bill)
        session.flush()

        bill_text: dict = {"sections": [], "articles": []}

        # First ingest: empty text_versions -> the "current" fallback code.
        pipeline.upsert_versions_and_sections(
            bill, {"text_versions": []}, bill_text, artifact
        )
        # Second ingest (refresh): a real engrossment code "0".
        pipeline.upsert_versions_and_sections(
            bill,
            {
                "text_versions": [
                    {"document_engrossment": "0", "document_name": "Introduced"}
                ]
            },
            bill_text,
            artifact,
        )
        session.flush()

        current = session.scalars(
            select(BillVersion).where(
                BillVersion.bill_id == bill.id,
                BillVersion.is_current.is_(True),
            )
        ).all()
        assert len(current) == 1
        assert current[0].version_code == "0"

        all_codes = {
            v.version_code
            for v in session.scalars(
                select(BillVersion).where(BillVersion.bill_id == bill.id)
            ).all()
        }
        assert all_codes == {"current", "0"}


def test_parse_datetime_handles_source_datetime_format() -> None:
    """#328 regression: the MN source emits dates as "YYYY-MM-DD HH:MM:SS", not
    the date-only forms the parser originally handled. Every such value used to
    parse to None, leaving the whole corpus without action/version dates."""
    assert parse_datetime("2025-04-30 00:00:00") == datetime(2025, 4, 30, tzinfo=UTC)
    assert parse_datetime("2025-02-21 08:44:29") == datetime(
        2025, 2, 21, 8, 44, 29, tzinfo=UTC
    )
    # ISO 'T' separator and the pre-existing date-only forms still parse.
    assert parse_datetime("2025-04-30T00:00:00") == datetime(2025, 4, 30, tzinfo=UTC)
    assert parse_datetime("04/30/2025") == datetime(2025, 4, 30, tzinfo=UTC)
    # Empty / unparseable values stay None.
    assert parse_datetime("") is None
    assert parse_datetime("not a date") is None


# A bill whose actions use the real source datetime format, including a
# higher-numbered *undated* trailing action ("Laid on table") — the production
# shape that left latest_action_at null even where dated actions existed (#328).
DATED_BILL_XML = """<?xml version="1.0"?>
<BILL>
  <SESSION_NUMBER>94</SESSION_NUMBER>
  <SESSION_YEAR>2025</SESSION_YEAR>
  <FILE_TYPE>HF</FILE_TYPE>
  <FILE_NUMBER>7777</FILE_NUMBER>
  <REVISOR_NUMBER>25-7777</REVISOR_NUMBER>
  <DESCRIPTION>Test dated ingestion bill</DESCRIPTION>
  <ACTIONS>
    <house>
      <ACTION>
        <ACTION_NUMBER>1</ACTION_NUMBER>
        <ACTION_TEXT>Introduction and first reading</ACTION_TEXT>
        <ACTION_DATE>2025-01-10 00:00:00</ACTION_DATE>
      </ACTION>
      <ACTION>
        <ACTION_NUMBER>2</ACTION_NUMBER>
        <ACTION_TEXT>Referred to committee</ACTION_TEXT>
        <ACTION_DATE>2025-02-15 00:00:00</ACTION_DATE>
      </ACTION>
      <ACTION>
        <ACTION_NUMBER>3</ACTION_NUMBER>
        <ACTION_TEXT>Bill was passed</ACTION_TEXT>
        <ACTION_DATE>2025-03-20 00:00:00</ACTION_DATE>
      </ACTION>
      <ACTION>
        <ACTION_NUMBER>4</ACTION_NUMBER>
        <ACTION_TEXT>Laid on table</ACTION_TEXT>
        <ACTION_DATE></ACTION_DATE>
      </ACTION>
    </house>
  </ACTIONS>
  <TEXT_VERSION_LIST>
    <DOCUMENT>
      <HTML_URI>https://example.test/hf7777.html</HTML_URI>
      <DATE_INSERT>2025-01-10 08:44:29</DATE_INSERT>
      <DOCUMENT_NAME>Introduced</DOCUMENT_NAME>
      <DOCUMENT_TYPE>1</DOCUMENT_TYPE>
      <DOCUMENT_ENGROSSMENT>0</DOCUMENT_ENGROSSMENT>
    </DOCUMENT>
  </TEXT_VERSION_LIST>
</BILL>
"""


def test_upsert_bill_populates_action_dates(seed_database: None) -> None:
    """#328 regression: end-to-end, upsert_bill must capture action_at on each
    dated action, set latest_action_at from the newest *dated* action (not the
    undated trailing one), populate introduced_at, and set version.document_date
    — all from the source's "YYYY-MM-DD HH:MM:SS" format."""
    with Session(get_engine()) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        refs = pipeline.seed_reference_data()
        canonical = parse_bill_xml(DATED_BILL_XML)
        run = pipeline.start_run("bill", canonical["bill_key"])
        xml_artifact = pipeline.record_artifact(
            run, ArtifactType.xml, "https://example.test/hf7777.xml", DATED_BILL_XML
        )
        html_artifact = pipeline.record_artifact(
            run, ArtifactType.html, "https://example.test/hf7777.html", "<html></html>"
        )
        bill_text = {
            "sections": [],
            "articles": [],
            "source_url": "https://example.test/hf7777.html",
        }

        bill = pipeline.upsert_bill(
            refs, canonical, bill_text, run, xml_artifact, html_artifact
        )
        session.flush()

        # Newest dated action is #3 (2025-03-20); the undated #4 must not win.
        assert bill.latest_action_at == datetime(2025, 3, 20, tzinfo=UTC)
        assert bill.introduced_at == datetime(2025, 1, 10, tzinfo=UTC)

        actions = {
            a.action_number: a
            for a in session.scalars(
                select(BillAction).where(BillAction.bill_id == bill.id)
            ).all()
        }
        assert actions[1].action_at == datetime(2025, 1, 10, tzinfo=UTC)
        assert actions[2].action_at == datetime(2025, 2, 15, tzinfo=UTC)
        assert actions[3].action_at == datetime(2025, 3, 20, tzinfo=UTC)
        assert actions[4].action_at is None  # genuinely undated action stays null

        version = session.scalar(
            select(BillVersion).where(BillVersion.bill_id == bill.id)
        )
        assert version is not None
        assert version.document_date == datetime(2025, 1, 10, 8, 44, 29, tzinfo=UTC)

        session.rollback()

        session.rollback()


def _companion_xml(
    file_type: str, file_number: str, companion_type: str, companion_number: str
) -> str:
    return f"""<?xml version="1.0"?>
<BILL>
  <SESSION_NUMBER>94</SESSION_NUMBER>
  <SESSION_YEAR>2025</SESSION_YEAR>
  <FILE_TYPE>{file_type}</FILE_TYPE>
  <FILE_NUMBER>{file_number}</FILE_NUMBER>
  <DESCRIPTION>Companion pair test bill</DESCRIPTION>
  <COMPANION_TYPE>{companion_type}</COMPANION_TYPE>
  <COMPANION_NUMBER>{companion_number}</COMPANION_NUMBER>
  <ACTIONS></ACTIONS>
  <TEXT_VERSION_LIST></TEXT_VERSION_LIST>
</BILL>
"""


def test_upsert_bill_links_companion_symmetrically(seed_database: None) -> None:
    """#293: MN bills come in HF/SF companion pairs. The status XML names the
    companion's file type + number; upsert_bill must resolve it to a Bill row and
    set companion_bill_id on *both* sides. Linking is order-independent: the first
    bill ingested has no companion row yet (stays null), and ingesting the second
    connects the pair symmetrically."""
    with Session(get_engine()) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        refs = pipeline.seed_reference_data()

        def _ingest(xml: str) -> Bill:
            canonical = parse_bill_xml(xml)
            key = canonical["bill_key"]
            run = pipeline.start_run("bill", key)
            xml_artifact = pipeline.record_artifact(
                run, ArtifactType.xml, f"https://example.test/{key}.xml", xml
            )
            html_artifact = pipeline.record_artifact(
                run,
                ArtifactType.html,
                f"https://example.test/{key}.html",
                "<html></html>",
            )
            bill_text = {
                "sections": [],
                "articles": [],
                "source_url": f"https://example.test/{key}.html",
            }
            bill = pipeline.upsert_bill(
                refs, canonical, bill_text, run, xml_artifact, html_artifact
            )
            session.flush()
            return bill

        hf = _ingest(_companion_xml("HF", "6001", "SF", "6002"))
        # First bill ingested: its companion isn't in the DB yet, so no link.
        assert hf.companion_bill_id is None

        sf = _ingest(_companion_xml("SF", "6002", "HF", "6001"))
        session.refresh(hf)
        # Ingesting the second member links both directions.
        assert sf.companion_bill_id == hf.id
        assert hf.companion_bill_id == sf.id

        session.rollback()
