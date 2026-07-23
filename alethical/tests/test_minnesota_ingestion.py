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
    Sponsorship,
    SponsorshipRole,
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


def _make_bill(pipeline, refs, *, file_number, key) -> Bill:
    bill = Bill(
        session_id=refs["session"].id,
        chamber_id=refs["chambers"]["house"].id,
        bill_key=key,
        file_type="HF",
        file_number=file_number,
        title=f"Merge test bill {file_number}",
    )
    pipeline.db.add(bill)
    pipeline.db.flush()
    return bill


def test_replace_sponsorships_attaches_to_existing_roster(seed_database: None) -> None:
    """#302: when the roster row already exists, replace_sponsorships attaches the
    sponsorship to it (matched by the member id in its profile URL) instead of
    spawning a parallel numeric-keyed bill-author row."""
    with Session(get_engine()) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        refs = pipeline.seed_reference_data()
        roster = pipeline.ingest_member_profile(
            refs,
            {
                "chamber": "house",
                "display_name": "Rep. Canonical One",
                "district": "45B",
                "profile_url": "https://www.house.mn.gov/members/profile/778899",
            },
        )
        session.flush()
        bill = _make_bill(pipeline, refs, file_number=7001, key="94-2025-HF7001")

        pipeline.replace_sponsorships(
            refs,
            bill,
            {
                "authors": {
                    "house": [{"legislator_key": "778899", "member_name": "One, C."}]
                }
            },
        )
        session.flush()

        # No parallel numeric-keyed author row was created.
        assert (
            session.scalar(
                select(Legislator).where(
                    Legislator.jurisdiction_id == refs["jurisdiction"].id,
                    Legislator.external_key == "778899",
                )
            )
            is None
        )
        # The sponsorship is on the roster row, and its name was not overwritten
        # by the bill's abbreviated MEMBER_NAME.
        sponsorships = session.scalars(
            select(Sponsorship).where(Sponsorship.bill_id == bill.id)
        ).all()
        assert len(sponsorships) == 1
        assert sponsorships[0].legislator_id == roster.id
        assert (
            session.scalar(
                select(Legislator.full_name).where(Legislator.id == roster.id)
            )
            == "Rep. Canonical One"
        )


def test_ingest_member_profile_folds_in_prior_bill_author_placeholder(
    seed_database: None,
) -> None:
    """#302: a bill ingested before its roster row creates a bare-numeric
    placeholder; ingesting the roster row later folds that placeholder in
    (sponsorships repointed, placeholder deleted) so there is one row per member."""
    with Session(get_engine()) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        refs = pipeline.seed_reference_data()
        bill = _make_bill(pipeline, refs, file_number=7002, key="94-2025-HF7002")

        # Bill first: creates the bare-numeric placeholder.
        pipeline.replace_sponsorships(
            refs,
            bill,
            {
                "authors": {
                    "house": [{"legislator_key": "334455", "member_name": "Two, D."}]
                }
            },
        )
        session.flush()
        placeholder = session.scalar(
            select(Legislator).where(
                Legislator.jurisdiction_id == refs["jurisdiction"].id,
                Legislator.external_key == "334455",
            )
        )
        assert placeholder is not None
        placeholder_id = placeholder.id

        # Roster second: folds the placeholder in.
        roster = pipeline.ingest_member_profile(
            refs,
            {
                "chamber": "house",
                "display_name": "Rep. Canonical Two",
                "district": "46A",
                "profile_url": "https://www.house.mn.gov/members/profile/334455",
            },
        )
        session.flush()

        assert session.get(Legislator, placeholder_id) is None
        sponsorships = session.scalars(
            select(Sponsorship).where(Sponsorship.bill_id == bill.id)
        ).all()
        assert len(sponsorships) == 1
        assert sponsorships[0].legislator_id == roster.id


def test_merge_duplicate_legislators_backfill(seed_database: None) -> None:
    """#302 backfill: merge_duplicate_legislators folds a legacy bill-author row
    (numeric key, "*-unknown" district) into its roster row, repointing
    sponsorships. dry_run reports without writing; author rows with no roster
    match are reported as orphans and left untouched."""
    with Session(get_engine()) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        refs = pipeline.seed_reference_data()
        chamber = refs["chambers"]["house"]
        bill = _make_bill(pipeline, refs, file_number=7003, key="94-2025-HF7003")

        real_district = pipeline.upsert_district(refs, chamber, "47C")
        unknown_district = pipeline.upsert_district(refs, chamber, "H7003-unknown")
        roster = pipeline.upsert_legislator(
            refs,
            "Rep. Canonical Three",
            external_key="https://www.house.mn.gov/members/profile/556677",
        )
        author = pipeline.upsert_legislator(refs, "Three, E.", external_key="556677")
        session.flush()
        session.add_all(
            [
                LegislatorServicePeriod(
                    legislator_id=roster.id,
                    session_id=refs["session"].id,
                    chamber_id=chamber.id,
                    district_id=real_district.id,
                    party="DFL",
                    is_current=True,
                ),
                LegislatorServicePeriod(
                    legislator_id=author.id,
                    session_id=refs["session"].id,
                    chamber_id=chamber.id,
                    district_id=unknown_district.id,
                    is_current=True,
                ),
                Sponsorship(
                    bill_id=bill.id,
                    legislator_id=author.id,
                    role=SponsorshipRole.chief_author,
                    source_order=1,
                    source_chamber="house",
                ),
            ]
        )
        session.flush()
        author_id = author.id
        roster_id = roster.id

        # Dry run: reports the pair, writes nothing.
        report = pipeline.merge_duplicate_legislators(dry_run=True)
        assert report.dry_run is True
        assert report.merged_pairs >= 1
        assert session.get(Legislator, author_id) is not None

        # Apply: the author row is gone and its sponsorship is on the roster row.
        report = pipeline.merge_duplicate_legislators(dry_run=False)
        assert report.dry_run is False
        assert report.merged_pairs >= 1
        assert session.get(Legislator, author_id) is None
        sponsorships = session.scalars(
            select(Sponsorship).where(Sponsorship.bill_id == bill.id)
        ).all()
        assert len(sponsorships) == 1
        assert sponsorships[0].legislator_id == roster_id
        # refresh_legislator_stats ran for the roster row → correct direct count.
        stats = session.scalar(
            select(LegislatorStats).where(
                LegislatorStats.legislator_id == roster_id,
                LegislatorStats.session_id == refs["session"].id,
            )
        )
        assert stats is not None and stats.total_bill_count == 1


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
    """#285/#531 regression: a refresh that introduces a real engrossment code,
    when the prior ingest stored only the "current" fallback, must leave exactly
    one is_current version per bill (not double the flag). Per #531 the text-empty
    "current" placeholder is now dropped once real versions exist, so it no longer
    lingers as a phantom row on the Versions tab — the guard is scoped strictly to
    version_code="current" (the synthetic empty-fetch fallback), so real superseded
    versions are still retained and demoted."""
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
        # #531: the text-empty "current" placeholder is dropped once the real
        # engrossment ("0") arrives — no phantom row survives.
        assert all_codes == {"0"}


def test_current_placeholder_guard_is_scoped(seed_database: None) -> None:
    """#531: the drop-stale-"current" guard must be narrow. A re-ingest that is
    still text-empty keeps the single "current" fallback (a bill genuinely lacking
    published text still shows its one placeholder), and a real superseded version
    code is never dropped — only version_code="current" is."""
    with Session(get_engine()) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        refs = pipeline.seed_reference_data()
        run = pipeline.start_run("bill", "94-2025-HF7777")
        artifact = pipeline.record_artifact(
            run,
            ArtifactType.html,
            "https://example.test/hf7777.html",
            "<html></html>",
        )
        bill = Bill(
            session_id=refs["session"].id,
            chamber_id=refs["chambers"]["house"].id,
            bill_key="94-2025-HF7777",
            file_type="HF",
            file_number=7777,
            title="Scoped-guard regression bill",
        )
        session.add(bill)
        session.flush()
        bill_text: dict = {"sections": [], "articles": []}

        # Two empty ingests in a row: the "current" fallback must persist (the bill
        # still has no published text), not get dropped by the guard.
        pipeline.upsert_versions_and_sections(
            bill, {"text_versions": []}, bill_text, artifact
        )
        pipeline.upsert_versions_and_sections(
            bill, {"text_versions": []}, bill_text, artifact
        )
        session.flush()
        codes = {
            v.version_code
            for v in session.scalars(
                select(BillVersion).where(BillVersion.bill_id == bill.id)
            ).all()
        }
        assert codes == {"current"}

        # Now real text arrives across two engrossments, then a refresh drops the
        # first: the superseded real "0" is retained (guard is scoped to "current"
        # only), and the "current" placeholder is gone.
        pipeline.upsert_versions_and_sections(
            bill,
            {
                "text_versions": [
                    {"document_engrossment": "0", "document_name": "Introduced"},
                    {"document_engrossment": "1", "document_name": "1st engrossment"},
                ]
            },
            bill_text,
            artifact,
        )
        session.flush()
        codes = {
            v.version_code
            for v in session.scalars(
                select(BillVersion).where(BillVersion.bill_id == bill.id)
            ).all()
        }
        assert codes == {"0", "1"}


# A bill's text versions in the real MN shape, taken verbatim from HF 2438's live
# status XML (#467). It exhibits BOTH collision shapes at once:
#   - shape 1: the official 1st engrossment and the unofficial 1st engrossment
#     both carry DOCUMENT_ENGROSSMENT="1" (they differ only by DOCUMENT_TYPE,
#     "official" vs "ue").
#   - shape 2: the conference committee report has NO engrossment letter, so it
#     arrives as DOCUMENT_ENGROSSMENT="0" — the same "0" the introduced official
#     version uses.
# Keying the version on the engrossment alone collapses each pair onto one row,
# silently dropping the official 1st engrossment and the introduced text.
ENGROSSMENT_COLLISION_VERSIONS = [
    {
        "document_type": "official",
        "document_engrossment": "0",
        "document_name": "2025.0-HF2438-0",
        "date_insert": "2025-03-17 09:00:39",
    },
    {
        "document_type": "official",
        "document_engrossment": "1",
        "document_name": "2025.0-HF2438-1",
        "date_insert": "2025-04-21 12:41:57",
    },
    {
        "document_type": "official",
        "document_engrossment": "2",
        "document_name": "2025.0-HF2438-2",
        "date_insert": "2025-04-24 09:28:48",
    },
    {
        "document_type": "official",
        "document_engrossment": "3",
        "document_name": "2025.0-HF2438-3",
        "date_insert": "2025-04-28 18:25:39",
    },
    {
        "document_type": "ue",
        "document_engrossment": "1",
        "document_name": "2025.0-ueh2438-1",
        "date_insert": "2025-05-01 19:21:17",
    },
    {
        "document_type": "ccr",
        "document_engrossment": "0",
        "document_name": "2026.0-ccrhf2438",
        "date_insert": "2026-05-17 21:01:39",
    },
    {
        "document_type": "official",
        "document_engrossment": "4",
        "document_name": "2025.0-HF2438-4",
        "date_insert": "2026-05-18 17:02:17",
    },
]


def test_official_unofficial_and_ccr_versions_never_collide(
    seed_database: None,
) -> None:
    """#467 regression, both collision shapes. MN reuses DOCUMENT_ENGROSSMENT
    across document tracks: the official and unofficial 1st engrossments both
    arrive as "1" (shape 1), and a conference committee report with no engrossment
    letter arrives as "0" — the same "0" the introduced official version uses
    (shape 2). Keying the version on the engrossment alone collided both pairs, so
    the official 1st engrossment (overwritten by the unofficial) and the introduced
    text (overwritten by the CCR) were silently dropped. Every non-official track
    must land as its own row with a distinct, URL-safe version_code, and a CCR must
    never land on a bare engrossment number."""
    with Session(get_engine()) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        refs = pipeline.seed_reference_data()
        run = pipeline.start_run("bill", "94-2025-HF2438")
        artifact = pipeline.record_artifact(
            run,
            ArtifactType.html,
            "https://example.test/hf2438.html",
            "<html></html>",
        )
        bill = Bill(
            session_id=refs["session"].id,
            chamber_id=refs["chambers"]["house"].id,
            bill_key="94-2025-HF2438",
            file_type="HF",
            file_number=2438,
            title="Engrossment collision regression bill",
        )
        session.add(bill)
        session.flush()

        pipeline.upsert_versions_and_sections(
            bill,
            {"text_versions": ENGROSSMENT_COLLISION_VERSIONS},
            {"sections": [], "articles": []},
            artifact,
        )
        session.flush()

        versions = {
            v.version_code: v
            for v in session.scalars(
                select(BillVersion).where(BillVersion.bill_id == bill.id)
            ).all()
        }
        # Official 0-4 stay bare (stable URLs); the unofficial 1st engrossment is
        # namespaced to "ue-1"; the CCR is namespaced to "ccr-0" (never bare "0").
        # All seven source versions coexist — nothing overwrites anything.
        assert set(versions) == {"0", "1", "2", "3", "4", "ue-1", "ccr-0"}
        # version_code stays URL-safe for the frontend id + the
        # /bills/{bill_id}/versions/{version_code} route.
        for code in versions:
            assert code == code.lower()
            assert " " not in code and "/" not in code
        # Shape 1: the official 1st engrossment (04/21/2025) is no longer
        # overwritten by the unofficial one (05/01/2025); each keeps its own date.
        assert versions["1"].document_date == datetime(
            2025, 4, 21, 12, 41, 57, tzinfo=UTC
        )
        assert versions["ue-1"].document_date == datetime(
            2025, 5, 1, 19, 21, 17, tzinfo=UTC
        )
        # Shape 2: the introduced text (03/17/2025) is no longer overwritten by the
        # conference report (05/17/2026); each keeps its own row and date.
        assert versions["0"].document_date == datetime(
            2025, 3, 17, 9, 0, 39, tzinfo=UTC
        )
        assert versions["ccr-0"].document_date == datetime(
            2026, 5, 17, 21, 1, 39, tzinfo=UTC
        )


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


COMMITTEE_BILL_XML = """<?xml version="1.0"?>
<BILL>
  <SESSION_NUMBER>94</SESSION_NUMBER>
  <SESSION_YEAR>2025</SESSION_YEAR>
  <FILE_TYPE>HF</FILE_TYPE>
  <FILE_NUMBER>6666</FILE_NUMBER>
  <REVISOR_NUMBER>25-6666</REVISOR_NUMBER>
  <DESCRIPTION>Test committee-name ingestion bill</DESCRIPTION>
  <ACTIONS>
    <house>
      <ACTION>
        <ACTION_NUMBER>1</ACTION_NUMBER>
        <ACTION_TEXT>Introduction and first reading, referred to</ACTION_TEXT>
        <ACTION_DATE>2025-01-10 00:00:00</ACTION_DATE>
        <COMMITTEE_ID>94012</COMMITTEE_ID>
        <COMMITTEE_NAME>Higher Education Finance and Policy</COMMITTEE_NAME>
      </ACTION>
      <ACTION>
        <ACTION_NUMBER>2</ACTION_NUMBER>
        <ACTION_TEXT>Author added</ACTION_TEXT>
        <ACTION_DATE>2025-01-15 00:00:00</ACTION_DATE>
      </ACTION>
    </house>
  </ACTIONS>
  <TEXT_VERSION_LIST></TEXT_VERSION_LIST>
</BILL>
"""


def test_parse_bill_xml_extracts_committee_name() -> None:
    """#599: the parser must surface <COMMITTEE_NAME> per action so the write
    path can persist it. A non-referral action carries no committee."""
    canonical = parse_bill_xml(COMMITTEE_BILL_XML)
    actions = canonical["actions"]["house"]
    assert actions[0]["committee_name"] == "Higher Education Finance and Policy"
    assert actions[0]["committee_id"] == "94012"
    assert actions[1]["committee_name"] == ""


def test_upsert_bill_persists_committee_name(seed_database: None) -> None:
    """#599 regression: the referral action's committee name reaches bill_action
    (it used to be dropped on write); a non-referral action stays null."""
    with Session(get_engine()) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        refs = pipeline.seed_reference_data()
        canonical = parse_bill_xml(COMMITTEE_BILL_XML)
        run = pipeline.start_run("bill", canonical["bill_key"])
        xml_artifact = pipeline.record_artifact(
            run, ArtifactType.xml, "https://example.test/hf6666.xml", COMMITTEE_BILL_XML
        )
        html_artifact = pipeline.record_artifact(
            run, ArtifactType.html, "https://example.test/hf6666.html", "<html></html>"
        )
        bill_text = {
            "sections": [],
            "articles": [],
            "source_url": "https://example.test/hf6666.html",
        }

        bill = pipeline.upsert_bill(
            refs, canonical, bill_text, run, xml_artifact, html_artifact
        )
        session.flush()

        actions = {
            a.action_number: a
            for a in session.scalars(
                select(BillAction).where(BillAction.bill_id == bill.id)
            ).all()
        }
        assert actions[1].committee_name == "Higher Education Finance and Policy"
        assert actions[2].committee_name is None  # non-referral action carries none

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
