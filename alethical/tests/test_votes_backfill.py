"""Unit tests for the roll-call vote backfill source parsing (#479).

Fixtures mirror the real MN House votes page and Senate journal formats so the
parser is exercised against the shapes it actually meets in production.
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from alethical.db.models import (
    Legislator,
    LegislativeSession,
    LegislatorServicePeriod,
    SessionType,
)
from alethical.db.session import get_engine
from alethical.pipeline.minnesota import MinnesotaIngestionPipeline
from alethical.pipeline.votes import (
    build_legislator_index,
    leading_chamber,
    looks_like_bill_number,
    parse_house_votes,
    parse_senate_vote_from_pdf,
    parse_senate_vote_scoped,
    resolve_name,
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
