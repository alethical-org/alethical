"""Unit tests for the roll-call vote backfill source parsing (#479).

Fixtures mirror the real MN House votes page and Senate journal formats so the
parser is exercised against the shapes it actually meets in production.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
import json
import re
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

import alethical.pipeline.votes as votes
from alethical.db.models import (
    Bill,
    BillAction,
    BillStats,
    Legislator,
    LegislatorStats,
    LegislativeSession,
    LegislatorServicePeriod,
    SessionType,
    VoteEvent,
    VoteRecord,
    VoteValue,
)
from alethical.db.session import get_engine
from alethical.pipeline.minnesota import MinnesotaIngestionPipeline
from alethical.pipeline.votes import (
    backup_incomplete_vote_records,
    build_legislator_index,
    leading_chamber,
    looks_like_bill_number,
    parse_house_votes,
    parse_senate_vote_from_pdf,
    parse_senate_votes_from_pdf,
    parse_senate_vote_scoped,
    reconcile_saved_votes,
    repair_incomplete_vote_records,
    resolve_name,
    write_json_report,
)


def test_looks_like_bill_number_distinguishes_headings():
    assert looks_like_bill_number("H.F. NO. 2115")
    assert looks_like_bill_number("S.F. NO. 1959")
    assert not looks_like_bill_number("TO CONSIDER FIRST FOR CALENDAR")
    assert not looks_like_bill_number("TO CONSIDER FIRST FOR CALENDAR FOR THE DAY")
    assert not looks_like_bill_number("")


def test_leading_chamber_identifies_acting_body():
    # Cross-chamber mirror phrasings from the Revisor action feed.
    assert (
        leading_chamber("Senate adopted conference committee report, bill repassed")
        == "senate"
    )
    assert leading_chamber("House adopted HCC report and repassed bill") == "house"
    # A chamber's own action does not open with a chamber name.
    assert leading_chamber("Third reading Passed") is None
    assert leading_chamber("Bill was passed as amended") is None
    assert leading_chamber("Motion did not prevail") is None
    assert leading_chamber(None) is None


def _house_block(heading: str, yeas: int, nays: int, aye: str, no: str) -> str:
    return (
        '<div class="panel-content">'
        f"<H3>{heading}</H3>"
        f"<H3>{yeas} YEA and {nays} Nay</H3>"
        "<div><b>Motion to consider</b></div>"
        "<b>Date:</b> 05/11/2026</div>"
        "<b>Journal Page</b> <a>1234</a>"
        "Those who voted in the affirmative were:"
        f"<table><tr><td>{aye}</td><td></td></tr></table>"
        "Those who voted in the negative were:"
        f"<table><tr><td>{no}</td><td></td></tr></table>"
    )


def test_parse_house_votes_accepts_motion_heading_block():
    # A motion vote whose H3 heading is the motion label, not the bill number
    # (cause A2: HF3658 "Motion did not prevail" 67-61).
    html = (
        "<main>"
        + _house_block("TO CONSIDER FIRST FOR CALENDAR", 67, 61, "Smith", "Jones")
        + "</main>"
    )
    votes = parse_house_votes(html, "HF3658", "https://example/HF3658")
    assert len(votes) == 1
    assert (votes[0].yes_count, votes[0].no_count) == (67, 61)
    assert votes[0].affirmative_names == ["Smith"]
    assert votes[0].negative_names == ["Jones"]


def test_parse_house_votes_excludes_other_bill_number_block():
    # A block explicitly headed by a *different* bill number is not this bill's.
    html = (
        "<main>"
        + _house_block("TO CONSIDER FIRST FOR CALENDAR", 67, 61, "Smith", "Jones")
        + _house_block("H.F. NO. 9999", 12, 3, "Other", "Person")
        + "</main>"
    )
    votes = parse_house_votes(html, "HF3658", "https://example/HF3658")
    tallies = {(v.yes_count, v.no_count) for v in votes}
    assert (67, 61) in tallies
    assert (12, 3) not in tallies


SENATE_DAY_JOURNAL = """\
4653

JOURNAL OF THE SENATE

S.F. No. 9999 was read the third time.
The question was taken on the passage of the bill.
The roll was called, and there were yeas 41 and nays 26 as follows:
Those who voted in the affirmative were:
Aardvark
Those who voted in the negative were:
Zylstra
So the bill passed.

H.F. No. 3615 was read the third time.
The question was taken on the passage of the bill.
The roll was called, and there were yeas 41 and nays 26 as follows:
Those who voted in the affirmative were:
Abeler
Anderson
Boldon
Those who voted in the negative were:
Bahr
Drazkowski
So the bill passed and its title was agreed to.
"""


def test_parse_senate_vote_scoped_picks_correct_bill():
    # A full-day journal holds many roll calls; the same tally (41-26) appears
    # for two bills. The scoped parser must return the one for H.F. 3615
    # (cause B: journal_page NULL, recovered via the day journal).
    parsed = parse_senate_vote_scoped(
        SENATE_DAY_JOURNAL,
        "HF",
        3615,
        41,
        26,
        "https://example/journal.pdf",
    )
    assert parsed is not None
    assert (parsed.yes_count, parsed.no_count) == (41, 26)
    assert parsed.affirmative_names == ["Abeler", "Anderson", "Boldon"]
    assert parsed.negative_names == ["Bahr", "Drazkowski"]


def test_parse_senate_vote_motion_prefers_question_line():
    # The motion must name what *this* vote decided, not quote the prior vote's
    # outcome ("The motion did not prevail.") that sits just above it.
    text = (
        "The motion did not prevail.\n"
        "The question was taken on the final passage of S.F. No. 856, as amended.\n"
        "The roll was called, and there were yeas 60 and nays 7 as follows:\n"
        "Those who voted in the affirmative were:\n"
        "Abeler\n"
        "Those who voted in the negative were:\n"
        "Bahr\n"
        "So the bill passed.\n"
    )
    parsed = parse_senate_vote_from_pdf(text, 60, 7, "4654", "https://example/j.pdf")
    assert parsed is not None
    assert parsed.motion_text == "Final passage of S.F. No. 856, as amended"


def test_parse_senate_votes_reads_corrected_tally_without_old_count():
    text = (
        "The question was taken on the final passage of S.F. No. 856.\n"
        "The roll was called, and there were yeas 59 and nays 8 as follows:\n"
        "Those who voted in the affirmative were:\n"
        "Abeler\n"
        "Those who voted in the negative were:\n"
        "Bahr\n"
        "So the bill passed.\n"
    )

    parsed = parse_senate_votes_from_pdf(text, "4654", "https://example/journal.pdf")

    assert len(parsed) == 1
    assert (parsed[0].yes_count, parsed[0].no_count) == (59, 8)
    assert parsed[0].affirmative_names == ["Abeler"]
    assert parsed[0].negative_names == ["Bahr"]


def test_parse_senate_vote_scoped_returns_none_when_bill_absent():
    parsed = parse_senate_vote_scoped(
        SENATE_DAY_JOURNAL,
        "SF",
        1234,
        41,
        26,
        "https://example/journal.pdf",
    )
    assert parsed is None


def test_build_legislator_index_includes_departed_session_members(
    seed_database: None,
) -> None:
    # Roll calls are historical: a member who served this session and then
    # departed (is_current=False) still cast votes and must resolve. The index
    # is scoped by session, not is_current (cause C: Hortman/Vang Her/Schomacker).
    with Session(get_engine()) as db:
        pipeline = MinnesotaIngestionPipeline(db)
        refs = pipeline.seed_reference_data()
        house = refs["chambers"]["house"]
        session = LegislativeSession(
            jurisdiction_id=refs["jurisdiction"].id,
            slug=f"test-{uuid.uuid4().hex[:12]}",
            session_number=99,
            session_type=SessionType.regular,
            year_start=2099,
            year_end=2100,
            name="Vote index test session",
            is_current=False,
        )
        db.add(session)
        db.flush()

        for full_name, district_code, is_current in [
            ("Ada Current", "10A", True),
            ("Bo Departed", "11A", False),
        ]:
            district = pipeline.upsert_district(refs, house, district_code)
            legislator = Legislator(
                jurisdiction_id=refs["jurisdiction"].id,
                slug=f"{full_name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}",
                external_key=f"key-{uuid.uuid4().hex}",
                full_name=full_name,
                sort_name=f"{full_name.split()[1]}, {full_name.split()[0]}",
            )
            db.add(legislator)
            db.flush()
            db.add(
                LegislatorServicePeriod(
                    legislator_id=legislator.id,
                    session_id=session.id,
                    chamber_id=house.id,
                    district_id=district.id,
                    period_sequence=1,
                    is_current=is_current,
                )
            )
        db.flush()

        index = build_legislator_index(db, house.id, session.id)
        # The departed member resolves just like the current one.
        assert resolve_name("Departed", index) is not None
        assert resolve_name("Current", index) is not None


def test_official_house_initials_resolve_same_first_initial_members(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        pipeline = MinnesotaIngestionPipeline(db)
        refs = pipeline.seed_reference_data()
        house = refs["chambers"]["house"]

        expected: dict[str, str] = {}
        for full_name, sort_name, district_code in [
            ("Paul Anderson", "Anderson, P. H.", "12A"),
            ("Patti Anderson", "Anderson, P. E.", "33A"),
            ("Liz Lee", "Lee, K.", "67A"),
        ]:
            legislator = Legislator(
                jurisdiction_id=refs["jurisdiction"].id,
                slug=f"{full_name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}",
                external_key=f"key-{uuid.uuid4().hex}",
                full_name=full_name,
                sort_name=sort_name,
            )
            db.add(legislator)
            db.flush()
            expected[sort_name] = str(legislator.id)
            district = pipeline.upsert_district(refs, house, district_code)
            db.add(
                LegislatorServicePeriod(
                    legislator_id=legislator.id,
                    session_id=refs["session"].id,
                    chamber_id=house.id,
                    district_id=district.id,
                    period_sequence=1,
                    is_current=True,
                )
            )
        db.flush()

        index = build_legislator_index(db, house.id, refs["session"].id)

        assert (
            str(resolve_name("Anderson, P. H.", index).id)
            == expected["Anderson, P. H."]
        )
        assert (
            str(resolve_name("Anderson, P. E.", index).id)
            == expected["Anderson, P. E."]
        )
        assert str(resolve_name("Lee, K.", index).id) == expected["Lee, K."]


def _vote_reconciliation_fixture(
    db: Session,
) -> tuple[Bill, BillAction, list[Legislator]]:
    pipeline = MinnesotaIngestionPipeline(db)
    refs = pipeline.seed_reference_data()
    house = refs["chambers"]["house"]
    file_number = 100_000 + uuid.uuid4().int % 900_000
    bill = Bill(
        session_id=refs["session"].id,
        chamber_id=house.id,
        bill_key=f"94-2025-HF{file_number}",
        file_type="HF",
        file_number=file_number,
        title="Vote correction test bill",
    )
    db.add(bill)
    db.flush()
    action = BillAction(
        bill_id=bill.id,
        chamber_id=house.id,
        action_number=10,
        action_text="Bill was passed",
        action_at=datetime(2026, 5, 11, tzinfo=UTC),
        journal_page="1234",
        roll_call_text="2-1",
    )
    db.add(action)
    db.flush()

    legislators: list[Legislator] = []
    unique = uuid.uuid4().hex[:8]
    for index, (first, last) in enumerate(
        (("Ada", "Able"), ("Bo", "Baker"), ("Cy", "Corrected")), start=1
    ):
        name = f"{first} {last}{unique}"
        district = pipeline.upsert_district(refs, house, f"{70 + index}A")
        legislator = Legislator(
            jurisdiction_id=refs["jurisdiction"].id,
            slug=f"{name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}",
            external_key=f"vote-correction-{uuid.uuid4().hex}",
            full_name=name,
            sort_name=f"{name.split()[1]}, {name.split()[0]}",
        )
        db.add(legislator)
        db.flush()
        db.add(
            LegislatorServicePeriod(
                legislator_id=legislator.id,
                session_id=refs["session"].id,
                chamber_id=house.id,
                district_id=district.id,
                period_sequence=1,
                is_current=True,
            )
        )
        legislators.append(legislator)

    event = VoteEvent(
        bill_id=bill.id,
        bill_action_id=action.id,
        chamber_id=house.id,
        motion_text="Old motion",
        result_text="Old result",
        occurred_at=datetime(2026, 5, 10, tzinfo=UTC),
        official_url="https://example.test/old",
        yes_count=2,
        no_count=1,
    )
    db.add(event)
    db.flush()
    db.add_all(
        [
            VoteRecord(
                vote_event_id=event.id,
                legislator_id=legislators[0].id,
                vote_value=VoteValue.yes,
                sort_order=1,
            ),
            VoteRecord(
                vote_event_id=event.id,
                legislator_id=legislators[1].id,
                vote_value=VoteValue.yes,
                sort_order=2,
            ),
            VoteRecord(
                vote_event_id=event.id,
                legislator_id=legislators[2].id,
                vote_value=VoteValue.no,
                sort_order=3,
            ),
        ]
    )
    db.add(BillStats(bill_id=bill.id, vote_event_count=1))
    for legislator in legislators:
        db.add(
            LegislatorStats(
                legislator_id=legislator.id,
                session_id=refs["session"].id,
                vote_record_count=1,
            )
        )
    db.commit()
    return bill, action, legislators


def _corrected_house_vote_html(bill_number: int = 9001, suffix: str = "") -> str:
    return (
        "<main>"
        '<div class="panel-content">'
        f"<H3>H.F. NO. {bill_number}</H3>"
        "<H3>2 YEA and 1 Nay</H3>"
        "<div><b>Final passage</b></div>"
        "<b>Date:</b> 05/11/2026</div>"
        "<b>Journal Page</b> <a>1234</a>"
        "Those who voted in the affirmative were:"
        f"<table><tr><td>Able{suffix}</td><td></td></tr>"
        f"<tr><td>Corrected{suffix}</td><td></td></tr></table>"
        "Those who voted in the negative were:"
        f"<table><tr><td>Baker{suffix}</td><td></td></tr></table>"
        "</main>"
    )


class _StaticSourceSession:
    def __init__(self, text: str) -> None:
        self.text = text
        self.urls: list[str] = []

    def get(self, url: str, **_kwargs):  # noqa: ANN201
        self.urls.append(url)
        return SimpleNamespace(
            text=self.text,
            content=self.text.encode(),
            encoding="utf-8",
            apparent_encoding="utf-8",
            headers={"Content-Type": "text/html; charset=utf-8"},
            raise_for_status=lambda: None,
        )


def _fixture_vote_html(bill: Bill, legislators: list[Legislator]) -> str:
    suffix = legislators[0].full_name.removeprefix("Ada Able")
    return _corrected_house_vote_html(bill.file_number, suffix)


def test_reconciliation_replaces_changed_event_and_member_votes_together(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, action, legislators = _vote_reconciliation_fixture(db)
        source = _StaticSourceSession(_fixture_vote_html(bill, legislators))

        report = reconcile_saved_votes(
            db,
            bill_keys=[bill.bill_key],
            dry_run=False,
            source_session=source,
        )

        assert [item.bill_key for item in report.updated] == [bill.bill_key], report
        assert not report.unchanged
        assert not report.rejected
        assert not report.failed
        event = db.scalar(
            select(VoteEvent).where(VoteEvent.bill_action_id == action.id)
        )
        assert event is not None
        assert event.motion_text == "Final passage"
        assert event.result_text == action.action_text
        assert event.occurred_at == datetime(2026, 5, 11, tzinfo=UTC)
        assert event.official_url and "house.mn.gov/votes/Details" in event.official_url
        records = db.scalars(
            select(VoteRecord)
            .where(VoteRecord.vote_event_id == event.id)
            .order_by(VoteRecord.sort_order)
        ).all()
        assert [(row.legislator_id, row.vote_value) for row in records] == [
            (legislators[0].id, VoteValue.yes),
            (legislators[2].id, VoteValue.yes),
            (legislators[1].id, VoteValue.no),
        ]


def test_incomplete_vote_repair_only_adds_proven_missing_records(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, action, legislators = _vote_reconciliation_fixture(db)
        event = db.scalar(
            select(VoteEvent).where(VoteEvent.bill_action_id == action.id)
        )
        assert event is not None
        records = {
            row.legislator_id: row
            for row in db.scalars(
                select(VoteRecord).where(VoteRecord.vote_event_id == event.id)
            ).all()
        }
        records[legislators[1].id].vote_value = VoteValue.no
        db.delete(records[legislators[2].id])
        corrected_stats = db.scalar(
            select(LegislatorStats).where(
                LegislatorStats.legislator_id == legislators[2].id,
                LegislatorStats.session_id == bill.session_id,
            )
        )
        assert corrected_stats is not None
        corrected_stats.vote_record_count = 0
        db.commit()
        source = _StaticSourceSession(_fixture_vote_html(bill, legislators))

        excluded = repair_incomplete_vote_records(
            db,
            dry_run=True,
            allowed_legislator_ids=set(),
            source_session=source,
            event_ids=[event.id],
        )
        assert excluded.records_added == 0
        assert not excluded.updated

        preview = repair_incomplete_vote_records(
            db,
            dry_run=True,
            allowed_legislator_ids={legislators[2].id},
            source_session=source,
            event_ids=[event.id],
        )

        assert len(preview.updated) == 1
        assert preview.records_added == 1
        assert (
            db.scalar(
                select(func.count())
                .select_from(VoteRecord)
                .where(VoteRecord.vote_event_id == event.id)
            )
            == 2
        )
        backup = backup_incomplete_vote_records(db, event_ids=[event.id])
        assert backup["max_missing"] == 4
        assert len(backup["events"]) == 1
        assert len(backup["events"][0]["event"]["records"]) == 2

        applied = repair_incomplete_vote_records(
            db,
            dry_run=False,
            allowed_legislator_ids={legislators[2].id},
            source_session=source,
            event_ids=[event.id],
        )

        assert len(applied.updated) == 1
        assert applied.records_added == 1
        assert not applied.rejected
        assert not applied.failed
        db.refresh(event)
        assert event.motion_text == "Old motion"
        assert event.official_url == "https://example.test/old"
        repaired_records = db.scalars(
            select(VoteRecord)
            .where(VoteRecord.vote_event_id == event.id)
            .order_by(VoteRecord.sort_order)
        ).all()
        assert {row.legislator_id: row.vote_value for row in repaired_records} == {
            legislators[0].id: VoteValue.yes,
            legislators[2].id: VoteValue.yes,
            legislators[1].id: VoteValue.no,
        }
        db.refresh(corrected_stats)
        assert corrected_stats.vote_record_count == 1

        repeated = repair_incomplete_vote_records(
            db,
            dry_run=False,
            allowed_legislator_ids={legislators[2].id},
            source_session=source,
            event_ids=[event.id],
        )
        assert repeated.records_added == 0
        assert not repeated.updated


def test_incomplete_vote_repair_refuses_conflicting_saved_vote(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, action, legislators = _vote_reconciliation_fixture(db)
        event = db.scalar(
            select(VoteEvent).where(VoteEvent.bill_action_id == action.id)
        )
        assert event is not None
        missing = db.scalar(
            select(VoteRecord).where(
                VoteRecord.vote_event_id == event.id,
                VoteRecord.legislator_id == legislators[2].id,
            )
        )
        assert missing is not None
        db.delete(missing)
        db.commit()

        report = repair_incomplete_vote_records(
            db,
            dry_run=False,
            allowed_legislator_ids={legislators[2].id},
            source_session=_StaticSourceSession(_fixture_vote_html(bill, legislators)),
            event_ids=[event.id],
        )

        assert not report.updated
        assert report.records_added == 0
        assert len(report.rejected) == 1
        assert "conflicts" in (report.rejected[0].reason or "")
        assert (
            db.scalar(
                select(func.count())
                .select_from(VoteRecord)
                .where(VoteRecord.vote_event_id == event.id)
            )
            == 2
        )


def test_incomplete_vote_repair_ignores_large_gaps(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, action, _legislators = _vote_reconciliation_fixture(db)
        event = db.scalar(
            select(VoteEvent).where(VoteEvent.bill_action_id == action.id)
        )
        assert event is not None
        db.query(VoteRecord).filter(VoteRecord.vote_event_id == event.id).delete()
        db.commit()
        source = _StaticSourceSession("")

        report = repair_incomplete_vote_records(
            db,
            dry_run=False,
            allowed_legislator_ids=set(),
            source_session=source,
            max_missing=2,
            event_ids=[event.id],
        )

        assert not report.updated
        assert not report.rejected
        assert not report.failed
        assert source.urls == []


def test_reconciliation_finds_independent_tally_correction_by_vote_identity(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, action, legislators = _vote_reconciliation_fixture(db)
        suffix = legislators[0].full_name.removeprefix("Ada Able")
        html = _fixture_vote_html(bill, legislators).replace(
            "<H3>2 YEA and 1 Nay</H3>", "<H3>1 YEA and 2 Nay</H3>"
        )
        html = html.replace(
            f"<tr><td>Corrected{suffix}</td><td></td></tr>", ""
        ).replace(
            f"<table><tr><td>Baker{suffix}</td><td></td></tr></table>",
            f"<table><tr><td>Baker{suffix}</td><td></td></tr>"
            f"<tr><td>Corrected{suffix}</td><td></td></tr></table>",
        )

        report = reconcile_saved_votes(
            db,
            bill_keys=[bill.bill_key],
            dry_run=False,
            source_session=_StaticSourceSession(html),
        )

        assert [item.bill_key for item in report.updated] == [bill.bill_key], report
        event = db.scalar(
            select(VoteEvent).where(VoteEvent.bill_action_id == action.id)
        )
        assert event is not None
        assert (event.yes_count, event.no_count) == (1, 2)
        records = db.scalars(
            select(VoteRecord)
            .where(VoteRecord.vote_event_id == event.id)
            .order_by(VoteRecord.sort_order)
        ).all()
        assert [(row.legislator_id, row.vote_value) for row in records] == [
            (legislators[0].id, VoteValue.yes),
            (legislators[1].id, VoteValue.no),
            (legislators[2].id, VoteValue.no),
        ]


def test_targeted_reconciliation_fills_a_new_roll_call_and_refreshes_counts(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, action, legislators = _vote_reconciliation_fixture(db)
        event = db.scalar(
            select(VoteEvent).where(VoteEvent.bill_action_id == action.id)
        )
        assert event is not None
        db.query(VoteRecord).filter(VoteRecord.vote_event_id == event.id).delete()
        db.delete(event)
        db.scalar(
            select(BillStats).where(BillStats.bill_id == bill.id)
        ).vote_event_count = 0
        for legislator in legislators:
            db.scalar(
                select(LegislatorStats).where(
                    LegislatorStats.legislator_id == legislator.id,
                    LegislatorStats.session_id == bill.session_id,
                )
            ).vote_record_count = 0
        db.commit()

        report = reconcile_saved_votes(
            db,
            bill_keys=[bill.bill_key],
            dry_run=False,
            source_session=_StaticSourceSession(_fixture_vote_html(bill, legislators)),
        )

        assert [item.bill_key for item in report.updated] == [bill.bill_key], report
        created = db.scalar(
            select(VoteEvent).where(VoteEvent.bill_action_id == action.id)
        )
        assert created is not None
        assert (
            db.scalar(
                select(BillStats).where(BillStats.bill_id == bill.id)
            ).vote_event_count
            == 1
        )
        assert all(
            db.scalar(
                select(LegislatorStats).where(
                    LegislatorStats.legislator_id == legislator.id,
                    LegislatorStats.session_id == bill.session_id,
                )
            ).vote_record_count
            == 1
            for legislator in legislators
        )


def test_targeted_reconciliation_accepts_confirmed_action_removal(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, action, _legislators = _vote_reconciliation_fixture(db)
        event = db.scalar(
            select(VoteEvent).where(VoteEvent.bill_action_id == action.id)
        )
        assert event is not None
        event.bill_action_id = None
        db.flush()
        db.delete(action)
        db.commit()

        report = reconcile_saved_votes(
            db,
            bill_keys=[bill.bill_key],
            dry_run=False,
            source_session=_StaticSourceSession(""),
        )

        assert [item.bill_key for item in report.unchanged] == [bill.bill_key]
        assert report.unchanged[0].reason == "no current roll-call action"
        assert db.get(VoteEvent, event.id) is not None


def test_reconciliation_rejects_duplicate_events_for_one_action(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, action, legislators = _vote_reconciliation_fixture(db)
        db.add(
            VoteEvent(
                bill_id=bill.id,
                bill_action_id=action.id,
                chamber_id=action.chamber_id,
                result_text="Duplicate",
                yes_count=2,
                no_count=1,
            )
        )
        db.commit()

        report = reconcile_saved_votes(
            db,
            bill_keys=[bill.bill_key],
            dry_run=False,
            source_session=_StaticSourceSession(_fixture_vote_html(bill, legislators)),
        )

        assert len(report.rejected) == 1
        assert report.rejected[0].reason == "bill action has 2 saved roll calls"


def test_reconciliation_writes_nothing_when_every_saved_fact_matches(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, action, legislators = _vote_reconciliation_fixture(db)
        source = _StaticSourceSession(_fixture_vote_html(bill, legislators))
        first = reconcile_saved_votes(
            db, bill_keys=[bill.bill_key], dry_run=False, source_session=source
        )
        event = db.scalar(
            select(VoteEvent).where(VoteEvent.bill_action_id == action.id)
        )
        assert event is not None
        event_updated_at = event.updated_at
        record_ids = tuple(
            db.scalars(
                select(VoteRecord.id)
                .where(VoteRecord.vote_event_id == event.id)
                .order_by(VoteRecord.sort_order)
            ).all()
        )

        second = reconcile_saved_votes(
            db, bill_keys=[bill.bill_key], dry_run=False, source_session=source
        )

        assert len(first.updated) == 1
        assert [item.bill_key for item in second.unchanged] == [bill.bill_key]
        db.refresh(event)
        assert event.updated_at == event_updated_at
        assert (
            tuple(
                db.scalars(
                    select(VoteRecord.id)
                    .where(VoteRecord.vote_event_id == event.id)
                    .order_by(VoteRecord.sort_order)
                ).all()
            )
            == record_ids
        )


@pytest.mark.parametrize(
    "source_change",
    [
        lambda html: html.replace(
            re.search(r"<tr><td>Corrected[^<]*</td><td></td></tr>", html).group(0),
            "",
        ),
        lambda html: html.replace("Corrected", "Unknown Person"),
        lambda html: html.replace(
            re.search(r"<tr><td>Corrected([^<]*)</td><td></td></tr>", html).group(0),
            re.search(r"<tr><td>Able([^<]*)</td><td></td></tr>", html).group(0),
        ),
    ],
)
def test_reconciliation_rejects_incomplete_unresolved_or_duplicate_member_lists(
    seed_database: None,
    source_change,
) -> None:
    with Session(get_engine()) as db:
        bill, action, legislators = _vote_reconciliation_fixture(db)
        html = source_change(_fixture_vote_html(bill, legislators))
        before_event = db.scalar(
            select(VoteEvent).where(VoteEvent.bill_action_id == action.id)
        )
        assert before_event is not None
        before_motion = before_event.motion_text
        before_records = tuple(
            db.scalars(
                select(VoteRecord.id)
                .where(VoteRecord.vote_event_id == before_event.id)
                .order_by(VoteRecord.sort_order)
            ).all()
        )

        report = reconcile_saved_votes(
            db,
            bill_keys=[bill.bill_key],
            dry_run=False,
            source_session=_StaticSourceSession(html),
        )

        assert [item.bill_key for item in report.rejected] == [bill.bill_key]
        db.refresh(before_event)
        assert before_event.motion_text == before_motion
        assert (
            tuple(
                db.scalars(
                    select(VoteRecord.id)
                    .where(VoteRecord.vote_event_id == before_event.id)
                    .order_by(VoteRecord.sort_order)
                ).all()
            )
            == before_records
        )


def test_reconciliation_rolls_back_event_when_member_replace_fails(
    seed_database: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with Session(get_engine()) as db:
        bill, action, legislators = _vote_reconciliation_fixture(db)
        event = db.scalar(
            select(VoteEvent).where(VoteEvent.bill_action_id == action.id)
        )
        assert event is not None
        old_motion = event.motion_text
        old_records = tuple(
            db.scalars(
                select(VoteRecord.id).where(VoteRecord.vote_event_id == event.id)
            ).all()
        )

        def fail_after_event_update(*_args, **_kwargs):  # noqa: ANN202
            raise RuntimeError("forced member write failure")

        monkeypatch.setattr(
            "alethical.pipeline.votes._replace_vote_records", fail_after_event_update
        )
        report = reconcile_saved_votes(
            db,
            bill_keys=[bill.bill_key],
            dry_run=False,
            source_session=_StaticSourceSession(_fixture_vote_html(bill, legislators)),
        )

        assert [item.bill_key for item in report.failed] == [bill.bill_key]
        db.expire_all()
        restored = db.get(VoteEvent, event.id)
        assert restored is not None and restored.motion_text == old_motion
        assert (
            tuple(
                db.scalars(
                    select(VoteRecord.id).where(VoteRecord.vote_event_id == event.id)
                ).all()
            )
            == old_records
        )


def test_exact_bill_key_keeps_same_number_from_another_session_out(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        bill, _action, _legislators = _vote_reconciliation_fixture(db)
        report = reconcile_saved_votes(
            db,
            bill_keys=[bill.bill_key.replace("94-2025", "94-2026")],
            dry_run=True,
            source_session=_StaticSourceSession(_corrected_house_vote_html()),
        )
        assert not report.updated
        assert not report.unchanged
        assert len(report.failed) == 1
        assert report.failed[0].reason == "bill key not found"


def test_bounded_sweep_is_repeatable_for_one_day_and_rotates_next_day(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        _vote_reconciliation_fixture(db)
        _vote_reconciliation_fixture(db)
        _vote_reconciliation_fixture(db)
        source = _StaticSourceSession(_corrected_house_vote_html())

        first = reconcile_saved_votes(
            db,
            safety_sweep_limit=2,
            dry_run=True,
            source_session=source,
            now=datetime(2026, 8, 12, tzinfo=UTC),
        )
        repeated = reconcile_saved_votes(
            db,
            safety_sweep_limit=2,
            dry_run=True,
            source_session=source,
            now=datetime(2026, 8, 12, 23, 59, tzinfo=UTC),
        )
        rotated = reconcile_saved_votes(
            db,
            safety_sweep_limit=2,
            dry_run=True,
            source_session=source,
            now=datetime(2026, 8, 13, tzinfo=UTC),
        )

        assert [item.vote_event_id for item in first.items] == [
            item.vote_event_id for item in repeated.items
        ]
        assert [item.vote_event_id for item in first.items] != [
            item.vote_event_id for item in rotated.items
        ]


def test_json_report_replaces_the_destination_atomically(tmp_path) -> None:
    destination = tmp_path / "vote-report.json"
    destination.write_text('{"old": true}\n', encoding="utf-8")

    write_json_report(destination, {"counts": {"updated": 1}})

    assert json.loads(destination.read_text(encoding="utf-8")) == {
        "counts": {"updated": 1}
    }
    assert list(tmp_path.iterdir()) == [destination]


def test_production_reconciliation_ignores_ambient_database_url(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv(
        "DATABASE_URL", "postgresql://alethical:alethical@localhost:54329/alethical"
    )
    monkeypatch.setenv("SUPABASE_PROJECT_URL", "https://target-ref.supabase.co")
    monkeypatch.setenv("SUPABASE_DB_PASSWORD", "production-password")
    monkeypatch.delenv("SUPABASE_POOLER_HOST", raising=False)
    captured: dict[str, object] = {}

    def capture_engine(url: str, **_kwargs):  # noqa: ANN202
        captured["url"] = url
        return object()

    class FakeSession:
        def __init__(self, _engine: object) -> None:
            pass

        def __enter__(self) -> object:
            return object()

        def __exit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(votes, "create_engine", capture_engine)
    monkeypatch.setattr(votes, "Session", FakeSession)
    monkeypatch.setattr(
        votes, "rate_limited_source_session", lambda _engine, *, target: object()
    )
    monkeypatch.setattr(
        votes,
        "reconcile_saved_votes",
        lambda *_args, **_kwargs: votes.VoteReconciliationReport(),
    )

    exit_code = votes.main(["--target", "production", "--bill-key", "94-2025-HF1141"])

    assert exit_code == 0
    resolved = make_url(str(captured["url"]))
    assert resolved.host == "aws-1-us-east-2.pooler.supabase.com"
    assert resolved.database == "postgres"
    assert json.loads(capsys.readouterr().out) == {
        "counts": {"failed": 0, "rejected": 0, "unchanged": 0, "updated": 0},
        "failed": [],
        "rejected": [],
        "target": "production",
        "unchanged": [],
        "updated": [],
        "write": False,
    }


def test_database_url_cannot_be_combined_with_a_named_target(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        votes,
        "database_url_for_target",
        lambda *_args, **_kwargs: pytest.fail("conflicting inputs reached resolution"),
    )

    with pytest.raises(SystemExit) as raised:
        votes.main(
            [
                "--target",
                "production",
                "--database-url",
                "postgresql://localhost/alethical",
                "--bill-key",
                "94-2025-HF1141",
            ]
        )

    assert raised.value.code == 2
    assert "not allowed with argument" in capsys.readouterr().err
