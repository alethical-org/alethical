"""What a legislator's profile read is allowed to ask the database for.

Net: the profile page was slow because of *how many times* it asked, not because
anything was wrong with the answers. Opening one member's page asked the database 11
separate questions -- who the session is, who the member is, who the member is again,
then one question per thing the page shows -- and our database sits in a different
region from our server, so every one of those is a trip across the country for a
question that takes no time to answer. The answers were all correct. Only the reader
waited.

So these tests count the questions rather than check the answers, and then prove the
answers did not move: the second test rebuilds the profile the old way, question by
question, and demands the page come back the same.

**No test here has a time limit in it, deliberately.** A seeded test database holds a
few rows on the same machine as the tests, so it cannot reproduce the distance between
our server and our database, and a wall-clock assertion here would measure the laptop
it ran on. The times live in the pull request and on the issue, measured against
production.
"""

from __future__ import annotations

import itertools
import uuid

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import selectinload

from alethical.api.routers.public import authored_bill_counts
from alethical.api.serializers import current_service_payload, service_history_payload
from alethical.db import models
from alethical.db.session import get_engine, get_session_factory

CommitteeMembership = models.CommitteeMembership
Legislator = models.Legislator
LegislatorElectionHistory = models.LegislatorElectionHistory
LegislatorServicePeriod = models.LegislatorServicePeriod
LegislatorStats = models.LegislatorStats
LegislativeSession = models.LegislativeSession

INCLUDES = ("current_service", "stats", "committees", "service_history")

# What the folded read asks for, and nothing else:
#   1. the session, the member, their current term, district and chamber, and their
#      stored counts -- one request, because each of those is at most one row;
#   2. the committees they sit on, with each committee's name;
#   3. their election history, with each row's chamber;
#   4. how many bills they authored, counted live.
EXPECTED_STATEMENTS = 4


class Statements:
    """Every statement one call sent, in order, as its SQL text."""

    def __init__(self) -> None:
        self.sent: list[str] = []

    def __enter__(self) -> "Statements":
        event.listen(get_engine(), "before_cursor_execute", self._record)
        return self

    def __exit__(self, *_exc) -> None:
        event.remove(get_engine(), "before_cursor_execute", self._record)

    def _record(self, _conn, _cursor, statement, *_rest) -> None:
        self.sent.append(statement)

    def touching(self, table: str) -> list[str]:
        return [statement for statement in self.sent if table in statement]


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()


def profile_subjects(db) -> list[tuple[str, str]]:
    """(id, slug) for the seeded members whose profiles carry the most to compare.

    Members holding a current term come first, so the comparison runs against rows
    with a district, a chamber and stored counts rather than against empty ones.
    """
    with_term = (
        db.scalars(
            select(Legislator)
            .join(
                LegislatorServicePeriod,
                LegislatorServicePeriod.legislator_id == Legislator.id,
            )
            .where(LegislatorServicePeriod.is_current.is_(True))
            .order_by(Legislator.sort_name.asc())
            .limit(4)
        )
        .unique()
        .all()
    )
    assert with_term, "the sample data seeds no serving member"
    return [(str(row.id), row.slug) for row in with_term]


def old_legislator_profile_stmt(legislator_id: uuid.UUID, session_id: uuid.UUID):
    """The read as it stood before it was folded: one statement per collection.

    Kept here, in the test rather than in the application, so the comparison below is
    against the code that actually shipped rather than against a description of it.
    """
    return (
        select(Legislator)
        .where(Legislator.id == legislator_id)
        .options(
            selectinload(
                Legislator.service_periods.and_(
                    LegislatorServicePeriod.session_id == session_id,
                    LegislatorServicePeriod.is_current.is_(True),
                )
            ).selectinload(LegislatorServicePeriod.district),
            selectinload(
                Legislator.committee_memberships.and_(
                    CommitteeMembership.is_current.is_(True)
                )
            ).selectinload(CommitteeMembership.committee),
            selectinload(
                Legislator.stats.and_(LegislatorStats.session_id == session_id)
            ),
            selectinload(Legislator.election_history).selectinload(
                LegislatorElectionHistory.chamber
            ),
        )
    )


def old_profile_payload(db, legislator_ref: str, session_slug: str | None, includes):
    """The profile the old code built, assembled exactly as the old route assembled it."""
    include_set = set(includes)
    if session_slug:
        session_row = db.scalar(
            select(LegislativeSession).where(LegislativeSession.slug == session_slug)
        )
    else:
        session_row = db.scalar(
            select(LegislativeSession).where(LegislativeSession.is_current.is_(True))
        )
    assert session_row is not None
    try:
        parsed = uuid.UUID(legislator_ref)
    except ValueError:
        legislator = db.scalar(
            select(Legislator).where(Legislator.slug == legislator_ref)
        )
    else:
        legislator = db.scalar(select(Legislator).where(Legislator.id == parsed))
    assert legislator is not None
    row = db.scalar(old_legislator_profile_stmt(legislator.id, session_row.id))
    current_service = next(iter(row.service_periods), None)
    payload = {
        "id": str(row.id),
        "slug": row.slug,
        "full_name": row.full_name,
        "biography": row.biography,
    }
    if "current_service" in include_set:
        payload["current_service"] = (
            current_service_payload(current_service).model_dump()
            if current_service
            else None
        )
    if "stats" in include_set:
        stats = row.stats[0] if row.stats else None
        total_bill_count, chief_bill_count = authored_bill_counts(db, [row.id]).get(
            str(row.id), (0, 0)
        )
        if stats or total_bill_count or chief_bill_count:
            payload["stats"] = {
                "chief_bill_count": chief_bill_count,
                "total_bill_count": total_bill_count,
                "vote_record_count": stats.vote_record_count if stats else 0,
                "committee_count": stats.committee_count if stats else 0,
            }
    if "committees" in include_set:
        payload["committees"] = [
            {"name": membership.committee.name, "role": membership.role}
            for membership in row.committee_memberships
        ]
    if "service_history" in include_set:
        service_history = service_history_payload(row.election_history)
        if service_history:
            payload["service_history"] = service_history.model_dump()
    return {key: value for key, value in payload.items() if value is not None}


def test_a_profile_is_read_in_four_requests(client, crowded_member) -> None:
    """The page's own read: everything a profile shows, in 4 requests instead of 11.

    Run against a member who really has committee seats and an election history, so
    a committee name or a chamber fetched one row at a time would show up here.
    """
    with Statements() as sent:
        response = client.get(
            f"/api/v1/legislators/{crowded_member}",
            params={"include": ",".join(INCLUDES)},
        )
    assert response.status_code == 200
    served = response.json()["data"]
    assert served["id"] == crowded_member
    assert served["committees"] and served["service_history"]["periods"]
    assert len(sent.sent) == EXPECTED_STATEMENTS, sent.sent
    # The member, their term, their district, their chamber and their stored counts
    # arrive together -- the old read asked for each of those separately.
    root = [
        statement
        for statement in sent.sent
        if "FROM legislative_session" in statement and " legislator " in statement
    ]
    assert len(root) == 1, sent.sent
    for table in (
        "legislator_service_period",
        "JOIN district",
        "JOIN chamber",
        "legislator_stats",
    ):
        assert table in root[0], (table, root[0])
    # The committee each seat names, and the chamber each election period names, ride
    # on the request that fetched the seats and the periods.
    seats = sent.touching("committee_membership")
    assert len(seats) == 1 and "JOIN committee AS" in seats[0], sent.sent
    periods = sent.touching("legislator_election_history")
    assert len(periods) == 1 and "JOIN chamber AS" in periods[0], sent.sent


@pytest.fixture()
def crowded_member(db):
    """One member carrying every row the profile read is supposed to leave out.

    The sample data gives each member one term, one set of stored counts and only
    current committee seats, so on it a read that forgot all 4 of its filters would
    still answer correctly. This member has a term in another session, a term that
    has ended, stored counts for another session and a committee seat they no longer
    hold -- so if the folded read stops filtering any of that, the comparison below
    sees a different profile. Removed again when the test ends.
    """
    jurisdiction_id = db.scalar(select(models.Jurisdiction.id))
    current_session_id = db.scalar(
        select(LegislativeSession.id).where(LegislativeSession.is_current.is_(True))
    )
    other_session_id = db.scalar(
        select(LegislativeSession.id).where(
            LegislativeSession.is_current.is_(False),
            LegislativeSession.id != current_session_id,
        )
    )
    assert other_session_id, "the sample data seeds no second session"
    district = db.scalar(select(models.District).limit(1))
    chamber_id = district.chamber_id
    other_district = db.scalar(
        select(models.District)
        .where(
            models.District.chamber_id == chamber_id,
            models.District.id != district.id,
        )
        .limit(1)
    )
    assert other_district is not None, "the sample data seeds one district per chamber"
    committees = [
        models.Committee(
            chamber_id=chamber_id,
            session_id=current_session_id,
            name=name,
            code=name,
        )
        for name in ("Read cost test committee A", "Read cost test committee B")
    ]
    db.add_all(committees)
    db.flush()

    member = Legislator(
        jurisdiction_id=jurisdiction_id,
        slug="read-cost-test-member",
        external_key="read-cost-test-member",
        full_name="Read Cost Test Member",
        sort_name="Zzz Test Member",
        biography="Seeded by the profile read-cost tests.",
    )
    db.add(member)
    db.flush()
    db.add_all(
        [
            LegislatorServicePeriod(
                legislator_id=member.id,
                session_id=current_session_id,
                chamber_id=chamber_id,
                district_id=district.id,
                period_sequence=1,
                party="DFL",
                is_current=True,
            ),
            # A term in the same session that has ended.
            LegislatorServicePeriod(
                legislator_id=member.id,
                session_id=current_session_id,
                chamber_id=chamber_id,
                district_id=other_district.id,
                period_sequence=2,
                party="Ended in this session",
                is_current=False,
            ),
            # A term in a different session, still marked current for that session.
            LegislatorServicePeriod(
                legislator_id=member.id,
                session_id=other_session_id,
                chamber_id=chamber_id,
                district_id=other_district.id,
                period_sequence=1,
                party="Another session",
                is_current=True,
            ),
            LegislatorStats(
                legislator_id=member.id,
                session_id=current_session_id,
                chief_bill_count=3,
                total_bill_count=9,
                vote_record_count=11,
                committee_count=1,
            ),
            LegislatorStats(
                legislator_id=member.id,
                session_id=other_session_id,
                chief_bill_count=99,
                total_bill_count=99,
                vote_record_count=99,
                committee_count=99,
            ),
            CommitteeMembership(
                committee_id=committees[0].id,
                legislator_id=member.id,
                role="chair",
                is_current=True,
            ),
            # A seat they no longer hold.
            CommitteeMembership(
                committee_id=committees[1].id,
                legislator_id=member.id,
                role="member",
                is_current=False,
            ),
            LegislatorElectionHistory(
                legislator_id=member.id,
                chamber_id=chamber_id,
                period_sequence=1,
                initial_year=2018,
                reelection_years=[2020, 2022],
                term_number=3,
                is_current_chamber=True,
            ),
        ]
    )
    db.commit()
    member_id = member.id
    committee_ids = [committee.id for committee in committees]
    try:
        yield str(member_id)
    finally:
        db.rollback()
        for table, column in (
            (LegislatorElectionHistory, LegislatorElectionHistory.legislator_id),
            (CommitteeMembership, CommitteeMembership.legislator_id),
            (LegislatorStats, LegislatorStats.legislator_id),
            (LegislatorServicePeriod, LegislatorServicePeriod.legislator_id),
        ):
            db.query(table).filter(column == member_id).delete()
        db.query(Legislator).filter(Legislator.id == member_id).delete()
        db.query(models.Committee).filter(
            models.Committee.id.in_(committee_ids)
        ).delete(synchronize_session=False)
        db.commit()


def test_the_folded_read_still_leaves_out_what_the_old_read_left_out(
    client, db, crowded_member
) -> None:
    """The 4 filters the read carries, proved on a member who has rows on both sides.

    The current term, the current session's stored counts and the committee seats
    still held are what a profile shows; the ended term, the other session's counts
    and the seat given up are what it does not. All 4 are checked by comparing
    against the old read on the same member.
    """
    response = client.get(
        f"/api/v1/legislators/{crowded_member}",
        params={"include": ",".join(INCLUDES)},
    )
    assert response.status_code == 200
    served = response.json()["data"]
    db.expire_all()
    assert served == old_profile_payload(db, crowded_member, None, INCLUDES)
    # Named separately, so a change that broke both reads the same way is still caught.
    assert served["current_service"]["party"] == "DFL"
    assert served["stats"]["vote_record_count"] == 11
    assert [seat["role"] for seat in served["committees"]] == ["chair"]
    # And the filtering happens in the database rather than after it, so a member
    # with rows on both sides still comes back as one row carrying one of each.
    db.expire_all()
    rows = (
        db.execute(
            models.legislator_profile_stmt(legislator_id=uuid.UUID(crowded_member))
        )
        .unique()
        .all()
    )
    assert len(rows) == 1
    assert len(rows[0][0].service_periods) == 1
    assert len(rows[0][0].stats) == 1


def test_a_profile_that_shows_nothing_extra_drops_the_counting_question(
    client, db
) -> None:
    """A bare profile stops counting bills, so it costs 3 requests instead of 4."""
    _, slug = profile_subjects(db)[0]
    with Statements() as sent:
        response = client.get(f"/api/v1/legislators/{slug}")
    assert response.status_code == 200
    assert len(sent.sent) == EXPECTED_STATEMENTS - 1, sent.sent
    assert sent.touching("sponsorship") == [], sent.sent


def test_the_profile_reads_the_same_for_a_uuid_url_as_for_a_slug(client, db) -> None:
    """Links shared before profiles moved to readable addresses still cost the same."""
    legislator_id, slug = profile_subjects(db)[0]
    with Statements() as sent:
        by_id = client.get(
            f"/api/v1/legislators/{legislator_id}",
            params={"include": ",".join(INCLUDES)},
        )
    assert by_id.status_code == 200
    assert len(sent.sent) == EXPECTED_STATEMENTS, sent.sent
    by_slug = client.get(
        f"/api/v1/legislators/{slug}", params={"include": ",".join(INCLUDES)}
    )
    assert by_slug.json() == by_id.json()


def test_the_folded_read_returns_the_same_profile_as_the_old_one(client, db) -> None:
    """Every combination of what a profile can show, compared against the old read.

    16 combinations per member, both address forms, and the answer has to match the
    old code's answer key for key. This is the whole point of the change: fewer
    questions, identical page.
    """
    combinations = [
        list(combination)
        for size in range(len(INCLUDES) + 1)
        for combination in itertools.combinations(INCLUDES, size)
    ]
    for legislator_id, slug in profile_subjects(db):
        for reference in (legislator_id, slug):
            for includes in combinations:
                params = {"include": ",".join(includes)} if includes else {}
                response = client.get(f"/api/v1/legislators/{reference}", params=params)
                assert response.status_code == 200, (reference, includes)
                db.expire_all()
                assert response.json()["data"] == old_profile_payload(
                    db, reference, None, includes
                ), (reference, includes)


def test_a_named_session_reads_the_same_profile_as_the_old_read(client, db) -> None:
    """Asking about a named session still filters the term and the stored counts."""
    session_slug = db.scalar(
        select(LegislativeSession.slug).where(LegislativeSession.is_current.is_(True))
    )
    assert session_slug
    for legislator_id, _ in profile_subjects(db):
        response = client.get(
            f"/api/v1/legislators/{legislator_id}",
            params={"session": session_slug, "include": ",".join(INCLUDES)},
        )
        assert response.status_code == 200
        db.expire_all()
        assert response.json()["data"] == old_profile_payload(
            db, legislator_id, session_slug, INCLUDES
        )


def test_a_missing_session_is_still_answered_before_a_missing_member(client) -> None:
    """The two ways a profile can be missing keep saying which one it was.

    Folding the session lookup into the member lookup could have made an unknown
    session read as an unknown member. The session is the one the old code checked
    first, so it stays the one the answer names first.
    """
    missing_session = client.get(
        "/api/v1/legislators/not-a-real-member",
        params={"session": "no-such-session"},
    )
    assert missing_session.status_code == 404
    assert missing_session.json()["detail"] == "session not found"

    missing_member = client.get("/api/v1/legislators/not-a-real-member")
    assert missing_member.status_code == 404
    assert missing_member.json()["detail"] == "legislator not found"

    missing_member_by_uuid = client.get(f"/api/v1/legislators/{uuid.uuid4()}")
    assert missing_member_by_uuid.status_code == 404
    assert missing_member_by_uuid.json()["detail"] == "legislator not found"


def test_an_unknown_member_costs_one_request(client) -> None:
    """Nothing is loaded for a member who is not there."""
    with Statements() as sent:
        response = client.get(
            "/api/v1/legislators/not-a-real-member",
            params={"include": ",".join(INCLUDES)},
        )
    assert response.status_code == 404
    assert len(sent.sent) == 1, sent.sent


def test_the_profile_statement_reads_the_current_session_by_default(db) -> None:
    """With no session named, the read resolves the current one, in the same request."""
    legislator_id, _ = profile_subjects(db)[0]
    current_session_id = db.scalar(
        select(LegislativeSession.id).where(LegislativeSession.is_current.is_(True))
    )
    resolved = (
        db.execute(
            models.legislator_profile_stmt(legislator_id=uuid.UUID(legislator_id))
        )
        .unique()
        .first()
    )
    assert resolved is not None
    assert resolved[1] == current_session_id
    assert str(resolved[0].id) == legislator_id


def test_joined_eager_loading_cannot_multiply_a_profile_row(db) -> None:
    """The term, the district, the chamber and the counts ride on one row, provably.

    A member holds at most one current term per session
    (``uq_legislator_service_period_one_current``) and at most one stored counts row
    per session (``legislator_stats``'s unique constraint), so joining them onto the
    member cannot turn one member into several. If either constraint were dropped,
    this read would start picking an arbitrary one of two -- so the guarantee is
    asserted here rather than assumed.
    """
    for legislator_id, _ in profile_subjects(db):
        rows = (
            db.execute(
                models.legislator_profile_stmt(legislator_id=uuid.UUID(legislator_id))
            )
            .unique()
            .all()
        )
        assert len(rows) == 1, legislator_id
        legislator = rows[0][0]
        assert len(legislator.service_periods) <= 1
        assert len(legislator.stats) <= 1
