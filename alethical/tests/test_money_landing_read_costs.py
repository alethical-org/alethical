"""What the /money landing, the committee directory and the newest filings may ask for.

Net: these 3 reads were slow for one reason, and it was never the work. Our server and
our database sit in different regions, so every separate question costs about 25 ms of
travelling whatever it asks; the landing was asking 10, the directory 8 and the newest
filings 6, and almost every one of them was a count a database answers in under a
millisecond ([#1966](https://github.com/alethical-org/alethical/issues/1966)).

So these tests count the questions rather than check the answers, which nothing else in
the suite would notice going back up: every answer was correct the whole time, and only
the reader waited. Each one also pins the answer beside the count, and the confirmation
state pins its 4 figures against the 4 separate reads they used to be, because a fold
that changes what a figure means is worse than a slow page --
``.claude/rules/grounded-answers.md`` rule 12 is what these figures are printed under.

**No test here has a time limit in it**, for the same reason ``test_money_read_costs.py``
has none: a seeded database on the same machine as the tests cannot reproduce the
distance this is about, so a wall-clock assertion would measure the laptop it ran on. The
times live in the pull request.

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text

from alethical.api.services import committee_finance as committee_service
from alethical.api.services.campaign_finance_register import (
    NO_CURRENT_SESSION,
    committees as register_committees,
    contest_count,
    legislator_committee_confirmations,
    recent_filings,
    register_summary,
    sub_types_for,
)
from alethical.api.services.independent_spending import REPORTED, UNAVAILABLE
from alethical.db import models
from alethical.db.session import get_session_factory

# The builders come from the suite that owns each subject, the way this repository
# shares test setup: the landing's own register and downloads from the landing suite,
# and the statement recorder from the other money-cost suite. Copying either would put 2
# versions of one fixture in the tree, which is what drifts.
from alethical.tests.test_campaign_finance_landing_reads import (
    _filer,
    _filings_snapshot,
    _independent_expenditure_rows,
    _publish_row_count,
    _published_release,
)
from alethical.tests.test_money_read_costs import Statements

SUMMARY = "/api/v1/campaign-finance/summary"
COMMITTEES = "/api/v1/campaign-finance/committees"
FILINGS = "/api/v1/campaign-finance/filings"

# Real numbers from the live register, so a reader can check either row against the
# Board's own directory.
SENATE_COMMITTEE = "18466"  # Port, Lindsey Senate Committee.
HOUSE_COMMITTEE = "18129"  # Stephenson, Zachary House Committee.

# Both are documented codes, so either could be served; which one wins is the preference
# under test. `PC` is a political committee and `BF` a ballot-question fund.
EXPENDITURE_CODE = "PC"
CONTRIBUTION_CODE = "BF"

# The period end the Board's own 2026 disclosure calendar prints, with the start it
# prints beside it.
PRE_PRIMARY_END = date(2026, 7, 20)
PRE_PRIMARY_START = date(2026, 1, 1)


def _clear(session) -> None:
    session.rollback()
    session.execute(text("UPDATE cf_filing_current SET snapshot_id = NULL"))
    session.execute(text("DELETE FROM cf_filing_report"))
    session.execute(text("DELETE FROM cf_filer"))
    session.execute(text("DELETE FROM cf_filing_snapshot"))
    session.execute(text("UPDATE cf_current_release SET release_id = NULL"))
    session.execute(text("DELETE FROM cf_release"))
    # The money rows go with the snapshot they belong to, which cascades.
    session.execute(text("DELETE FROM cf_snapshot"))
    session.execute(text("DELETE FROM legislator_campaign_committee"))
    session.commit()


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


@pytest.fixture()
def published(db):
    """A published release and a register listing the 2 committees, as the landing sees.

    Both copies of Minnesota's data, because the landing names both: the 3 bulk downloads
    as one release, and the register of filers as its own run.
    """
    release = _published_release(db)
    _independent_expenditure_rows(db, release, 2)
    _publish_row_count(db, release, 2)
    snapshot = _filings_snapshot(db, filer_count=2)
    _filer(
        db,
        snapshot,
        SENATE_COMMITTEE,
        name="Port, Lindsey Senate Committee",
        office="Senate",
        district="41",
    )
    _filer(
        db,
        snapshot,
        HOUSE_COMMITTEE,
        name="Stephenson, Zachary House Committee",
        office="House",
        district="35A",
    )
    return release


def _a_sitting_legislator(db):
    """One member the legislator directory would list, from the seeded sample data."""
    session_id = db.scalar(
        select(models.LegislativeSession.id).where(
            models.LegislativeSession.is_current.is_(True)
        )
    )
    return db.scalar(
        select(models.LegislatorServicePeriod.legislator_id)
        .join(
            models.District,
            models.District.id == models.LegislatorServicePeriod.district_id,
        )
        .where(
            models.LegislatorServicePeriod.session_id == session_id,
            models.LegislatorServicePeriod.is_current.is_(True),
            models.District.code.not_like("%-unknown"),
        )
        .limit(1)
    )


def _confirm(db, legislator_id, registration: str, *, reviewed_at: datetime):
    row = models.LegislatorCampaignCommittee(
        legislator_id=legislator_id,
        registration_number=registration,
        decision=models.CommitteeLinkReviewDecision.confirmed,
        committee_name_as_reviewed="Port, Lindsey Senate Committee",
        reviewed_by="a person",
    )
    db.add(row)
    db.flush()
    row.reviewed_at = reviewed_at
    db.commit()
    return row


def _reject(db, legislator_id, registration: str) -> None:
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=legislator_id,
            registration_number=registration,
            decision=models.CommitteeLinkReviewDecision.rejected,
            committee_name_as_reviewed="Port, Lindsey Senate Committee",
            reviewed_by="a person",
        )
    )
    db.commit()


def _confirmations_the_old_way(db):
    """The 3 figures as the 3 separate reads answered them, to match the folded read to.

    Re-derived rather than written down as numbers, so the assertion is "1 read answers
    what 3 reads answered" rather than "it answers what somebody typed into a test".
    """
    session_id = db.scalar(
        select(models.LegislativeSession.id).where(
            models.LegislativeSession.is_current.is_(True)
        )
    )
    sitting = (
        select(models.LegislatorServicePeriod.legislator_id)
        .join(
            models.District,
            models.District.id == models.LegislatorServicePeriod.district_id,
        )
        .where(
            models.LegislatorServicePeriod.session_id == session_id,
            models.LegislatorServicePeriod.is_current.is_(True),
            models.District.code.not_like("%-unknown"),
        )
        .distinct()
    )
    sitting_count = db.scalar(select(func.count()).select_from(sitting.subquery()))
    confirmed = (
        select(
            models.LegislatorCampaignCommittee.legislator_id,
            models.LegislatorCampaignCommittee.reviewed_at,
        )
        .where(
            models.LegislatorCampaignCommittee.decision
            == models.CommitteeLinkReviewDecision.confirmed,
            models.LegislatorCampaignCommittee.legislator_id.in_(sitting),
        )
        .subquery()
    )
    confirmed_count = db.scalar(
        select(func.count(func.distinct(confirmed.c.legislator_id)))
    )
    newest = db.scalar(select(func.max(confirmed.c.reviewed_at)))
    return sitting_count, confirmed_count, newest


# --- How many members have a confirmed committee -------------------------------


def test_the_confirmation_state_is_answered_in_one_request(db, published) -> None:
    """The lane's 4 figures used to cost 4 crossings; the answers are unchanged.

    Which session is current, how many members are sitting in it, how many of them have a
    committee somebody confirmed, and when the newest of those was confirmed. Four
    questions about one set, so 1 read of that set answers all 4 -- and reading the set
    once is also what stops the 3 figures landing either side of a roster change.
    """
    reviewed = datetime(2026, 8, 18, 15, 30, tzinfo=UTC)
    _confirm(db, _a_sitting_legislator(db), SENATE_COMMITTEE, reviewed_at=reviewed)
    sitting, confirmed, newest = _confirmations_the_old_way(db)

    with Statements() as sent:
        state = legislator_committee_confirmations(db)

    assert len(sent.sent) == 1, sent.sent
    assert state.state == REPORTED
    assert state.sitting_member_count == sitting
    assert state.confirmed_member_count == confirmed == 1
    assert state.newest_confirmation_at == newest.astimezone(UTC)


def test_a_rejected_link_is_still_not_progress(db, published) -> None:
    """ "We looked and it is not theirs" is stored, and it is still not a confirmation.

    The count and the date now come from the same read as the sitting total, so a
    rejection leaking into either would leak into both at once.
    """
    _reject(db, _a_sitting_legislator(db), SENATE_COMMITTEE)

    state = legislator_committee_confirmations(db)

    assert state.confirmed_member_count == 0
    assert state.newest_confirmation_at is None


def test_a_member_confirmed_twice_counts_once(db, published) -> None:
    """The lane says "members", so 2 confirmed committees for 1 person is still 1 person.

    A count of rows rather than people would overstate the progress of a review whose
    whole subject is which committee belongs to whom.
    """
    member = _a_sitting_legislator(db)
    _confirm(
        db,
        member,
        SENATE_COMMITTEE,
        reviewed_at=datetime(2026, 8, 18, 9, 0, tzinfo=UTC),
    )
    _confirm(
        db, member, HOUSE_COMMITTEE, reviewed_at=datetime(2026, 8, 19, 9, 0, tzinfo=UTC)
    )

    state = legislator_committee_confirmations(db)

    assert state.confirmed_member_count == 1
    assert state.newest_confirmation_at.day == 19


def test_no_current_session_refuses_rather_than_counting_nobody(db, published) -> None:
    """ "No session is current" and "nobody is sitting" both count 0, and differ entirely.

    The folded read has to keep them apart inside a single answer, which is why it asks
    for the session's own id back rather than inferring one from an empty count. Without
    that, a landing with no current session would print "0 of 0 members" as a measurement.
    """
    was_current = list(
        db.scalars(
            select(models.LegislativeSession.id).where(
                models.LegislativeSession.is_current.is_(True)
            )
        )
    )
    db.execute(text("UPDATE legislative_session SET is_current = false"))
    db.commit()
    try:
        with Statements() as sent:
            state = legislator_committee_confirmations(db)
    finally:
        # Put the seeded sample data back exactly as it was: every test in the run shares
        # one database.
        db.rollback()
        db.execute(
            text(
                "UPDATE legislative_session SET is_current = true WHERE id = ANY(:ids)"
            ),
            {"ids": was_current},
        )
        db.commit()

    assert len(sent.sent) == 1, sent.sent
    assert state.state == UNAVAILABLE
    assert state.reason == NO_CURRENT_SESSION
    assert state.sitting_member_count is None
    assert state.confirmed_member_count is None


# --- The register's own counts --------------------------------------------------


def test_the_contest_count_reuses_a_register_count_already_read(db, published) -> None:
    """Counting the register twice in one request is 2 crossings for 1 number.

    The landing counts the register for its own lane card, and the contests are a
    narrower count of those same rows, so the second read was the same question asked
    again 25 ms away.
    """
    summary = register_summary(db)

    with Statements() as sent:
        contests = contest_count(db, summary=summary)

    assert len(sent.sent) == 1, sent.sent
    assert contests.state == REPORTED
    # Senate 41 and House 35A: 2 offices, 2 districts, 2 contests.
    assert contests.contest_count == 2
    assert contests.snapshot_id == summary.snapshot_id


def test_the_contest_count_still_answers_on_its_own(db, published) -> None:
    """A caller with no register count in hand still gets one, at its own cost."""
    with Statements() as sent:
        contests = contest_count(db)

    assert contests.contest_count == 2
    # Which register is live, the register count it had to read for itself, then the
    # contests. Outside a request nothing has resolved the live register yet, which is
    # the whole difference from the landing's 1.
    assert len(sent.sent) == 3, sent.sent


# --- The finer kind of committee, from the money rows ----------------------------


def _expenditure_row(db, release, registration: str, sub_type: str) -> None:
    db.add(
        models.CampaignFinanceExpenditureRow(
            snapshot_id=release.expenditures_snapshot_id,
            row_number=uuid.uuid4().int % 1_000_000,
            committee_reg_num=registration,
            committee_name="Committee under test",
            entity_type="PCF",
            entity_sub_type=sub_type,
            vendor_name="A Mail House",
            amount=Decimal("100.00"),
            year=2026,
        )
    )
    db.commit()


def _contribution_row(db, release, registration: str, sub_type: str) -> None:
    db.add(
        models.CampaignFinanceContributionRow(
            snapshot_id=release.contributions_snapshot_id,
            row_number=uuid.uuid4().int % 1_000_000,
            recipient_reg_num=registration,
            recipient="Committee under test",
            recipient_type="PCF",
            recipient_subtype=sub_type,
            contributor="Giver, Ada",
            contrib_type="I",
            receipt_type="Contribution",
            year=2026,
            receipt_date=date(2026, 3, 1),
            amount=Decimal("250.00"),
        )
    )
    db.commit()


def test_the_sub_type_lookup_asks_all_3_files_in_one_request(db, published) -> None:
    """Three files, one request, and the expenditures file still wins the disagreement.

    The 3 files carry the same column and the committee page reads them in a fixed order,
    so this list has to reach the same answer or the same filer reads as 2 different kinds
    on 2 pages. Asking them one after another is what fixed that order before; now each
    file's rank rides back with its rows and the lowest rank wins, which is the same
    answer in 1 crossing instead of 3.

    0 registration numbers carry 2 different codes on the live release, so the
    disagreement here is contrived on purpose: a preference nothing exercises is a
    preference nobody notices losing.
    """
    release = committee_service.current_release(db)
    _expenditure_row(db, published, SENATE_COMMITTEE, EXPENDITURE_CODE)
    _contribution_row(db, published, SENATE_COMMITTEE, CONTRIBUTION_CODE)

    with Statements() as sent:
        found = sub_types_for(db, release, [SENATE_COMMITTEE, HOUSE_COMMITTEE])

    assert len(sent.sent) == 1, sent.sent
    assert found == {SENATE_COMMITTEE: EXPENDITURE_CODE}


def test_a_sub_type_only_the_contributions_file_carries_is_still_found(
    db, published
) -> None:
    """Preferring the expenditures file never means ignoring the other 2."""
    release = committee_service.current_release(db)
    _contribution_row(db, published, HOUSE_COMMITTEE, CONTRIBUTION_CODE)

    found = sub_types_for(db, release, [SENATE_COMMITTEE, HOUSE_COMMITTEE])

    assert found == {HOUSE_COMMITTEE: CONTRIBUTION_CODE}


def test_an_undocumented_code_is_still_left_off(db, published) -> None:
    """`PCN` is documented nowhere, so it stays absent rather than reaching a page."""
    release = committee_service.current_release(db)
    _expenditure_row(db, published, SENATE_COMMITTEE, "PCN")

    assert sub_types_for(db, release, [SENATE_COMMITTEE]) == {}


# --- The committee directory -----------------------------------------------------


def test_the_directory_page_carries_its_own_total(db, published) -> None:
    """ "Showing 1 of 2" used to cost 2 requests; the rows now bring the total with them.

    Counted over the whole filtered set before the page is cut out of it, so it is still
    the total of the filter rather than of the page.
    """
    release = committee_service.current_release(db)

    with Statements() as sent:
        page = register_committees(db, limit=1, offset=0, release=release)

    assert page.state == REPORTED
    assert page.total == 2
    assert page.has_more is True
    assert len(page.committees) == 1
    # The register count the lane card needs, and the page of rows carrying its total.
    assert len(sent.touching("cf_filer")) == 2, sent.sent


def test_a_page_past_the_end_still_answers_the_total(db, published) -> None:
    """An empty page carries no row to read the total off, so it is counted separately.

    Rare and worth the extra request: a page past the end reporting 0 in total would tell
    a reader the register holds nobody.
    """
    release = committee_service.current_release(db)

    page = register_committees(db, limit=25, offset=500, release=release)

    assert page.committees == ()
    assert page.has_more is False
    assert page.total == 2


def test_a_filtered_directory_page_counts_the_filter_not_the_register(
    db, published
) -> None:
    """Two totals, and the folded one is still the narrower of the 2."""
    release = committee_service.current_release(db)

    page = register_committees(db, limit=25, offset=0, query="Port", release=release)

    assert [row.registration_number for row in page.committees] == [SENATE_COMMITTEE]
    assert page.total == 1
    assert page.register_total == 2


# --- The newest filings ----------------------------------------------------------


def _report(
    db,
    snapshot_id,
    registration: str,
    *,
    row_number: int,
    year: int = 2026,
    cut_off: date | None = PRE_PRIMARY_END,
    special_election: bool = False,
    amendment_index: int | None = 0,
    filed_date: date | None = None,
) -> None:
    """One catalogue row.

    ``amendment_index=None`` is what a report nobody has filed looks like: the Board
    serves a null amendment list for one, and every filed report carries at least ``['0']``
    (``docs/architecture/campaign-finance-system-design.md`` §9.6).
    """
    db.add(
        models.CampaignFinanceFilingReport(
            snapshot_id=snapshot_id,
            row_number=row_number,
            registration_number=registration,
            filing_year=year,
            report_type="C",
            report_name="2026 Pre-Primary Report",
            cut_off_date=cut_off,
            special_election=special_election,
            effective_amendment_index=amendment_index,
            amendment_count=1,
            filed_date=filed_date,
        )
    )
    db.commit()


def _live_filings_snapshot_id(db):
    return db.scalar(
        select(models.CampaignFinanceFilingCurrentSnapshot.snapshot_id).where(
            models.CampaignFinanceFilingCurrentSnapshot.id.is_(True)
        )
    )


def test_the_newest_filings_are_read_in_one_request(db, published) -> None:
    """The rows, the total, the order's name and the newest period, all in one.

    Four questions about one filtered set, and 3 of them used to be asked again after the
    rows came back. Each is still counted over that identical set -- the total over the
    whole of it rather than the page, the newest period grouped rather than read off the
    first row -- so none of them can become a figure about this page wearing the set's
    name.
    """
    snapshot_id = _live_filings_snapshot_id(db)
    _report(db, snapshot_id, SENATE_COMMITTEE, row_number=1)
    _report(db, snapshot_id, HOUSE_COMMITTEE, row_number=2)
    _report(db, snapshot_id, SENATE_COMMITTEE, row_number=3, cut_off=date(2025, 12, 31))
    # A second report closing on the same day as its committee's first one, which is how
    # a count of documents comes out larger than a count of committees while looking
    # exactly like it. The landing's sentence says committees, so the 2 stay apart.
    _report(db, snapshot_id, SENATE_COMMITTEE, row_number=4)

    with Statements() as sent:
        page = recent_filings(db, limit=1, offset=0, as_of=date(2026, 8, 19))

    assert len(sent.touching("cf_filing_report")) == 1, sent.sent
    assert page.state == REPORTED
    assert len(page.filings) == 1
    assert page.has_more is True
    assert page.total == 4
    assert page.newest_period_end == PRE_PRIMARY_END
    assert page.newest_period_filing_count == 3
    assert page.newest_period_committee_count == 2


def test_the_orders_name_comes_from_the_whole_set_not_the_page(db, published) -> None:
    """A filing date further down the set still names the order, as a separate read did.

    The name says whether any row in the set carries a filing date, so reading it off the
    page would let a first page of undated rows rename an order that is partly by arrival.
    """
    snapshot_id = _live_filings_snapshot_id(db)
    _report(db, snapshot_id, SENATE_COMMITTEE, row_number=1)
    _report(
        db,
        snapshot_id,
        HOUSE_COMMITTEE,
        row_number=2,
        cut_off=date(2025, 12, 31),
        filed_date=date(2026, 1, 15),
    )

    page = recent_filings(db, limit=1, offset=0, as_of=date(2026, 8, 19))

    assert [row.filed_date for row in page.filings] == [None]
    assert page.ordered_by == "filed_date_then_period_end"


def test_no_filing_date_anywhere_names_the_order_by_the_period(db, published) -> None:
    """With nothing dated, the order genuinely is the period end and says so."""
    snapshot_id = _live_filings_snapshot_id(db)
    _report(db, snapshot_id, SENATE_COMMITTEE, row_number=1)

    page = recent_filings(db, limit=5, offset=0, as_of=date(2026, 8, 19))

    assert page.ordered_by == "period_end"


def test_a_special_election_year_still_withholds_the_printed_start(
    db, published
) -> None:
    """The Board's calendar start is wrong for a filer who ran in a special election.

    Asked per row inside the page's own read now instead of as a second request, and it
    is the same question: does this filer have a special-election report in this year.
    Filer 19223's 2025 period opens 11 July rather than 1 January
    (``docs/architecture/campaign-finance-system-design.md`` §9.5), so a printed
    1 January would be a fabricated date on a named committee's filing.
    """
    snapshot_id = _live_filings_snapshot_id(db)
    _report(db, snapshot_id, SENATE_COMMITTEE, row_number=1)
    _report(db, snapshot_id, HOUSE_COMMITTEE, row_number=2)
    # The second series a special-election candidate files, which is what withholds it.
    _report(
        db,
        snapshot_id,
        SENATE_COMMITTEE,
        row_number=3,
        special_election=True,
        cut_off=date(2026, 3, 10),
        amendment_index=None,
    )

    page = recent_filings(db, limit=5, offset=0, as_of=date(2026, 8, 19))
    starts = {row.registration_number: row.period_start for row in page.filings}

    assert starts[SENATE_COMMITTEE] is None
    assert starts[HOUSE_COMMITTEE] == PRE_PRIMARY_START


def test_a_filings_page_past_the_end_still_answers_its_counts(db, published) -> None:
    """An empty page carries nothing to read the set's figures off, so they are re-asked.

    The alternative is a page reporting 0 filings in total because it happened to be
    asked for rows that are not there.
    """
    snapshot_id = _live_filings_snapshot_id(db)
    _report(db, snapshot_id, SENATE_COMMITTEE, row_number=1)

    page = recent_filings(db, limit=5, offset=500, as_of=date(2026, 8, 19))

    assert page.filings == ()
    assert page.total == 1
    assert page.newest_period_end == PRE_PRIMARY_END
    assert page.newest_period_filing_count == 1


def test_an_unfiled_report_is_still_left_out_of_the_feed(db, published) -> None:
    """The catalogue is a schedule, so a report nobody filed must not reach the feed.

    The folded read shares one filter with the total and the period counts, so a row
    wrongly let in would be let into all 3 at once.
    """
    snapshot_id = _live_filings_snapshot_id(db)
    _report(db, snapshot_id, SENATE_COMMITTEE, row_number=1)
    _report(db, snapshot_id, HOUSE_COMMITTEE, row_number=2, amendment_index=None)

    page = recent_filings(db, limit=5, offset=0, as_of=date(2026, 8, 19))

    assert [row.registration_number for row in page.filings] == [SENATE_COMMITTEE]
    assert page.total == 1
    assert page.newest_period_filing_count == 1


# --- What a whole request costs ---------------------------------------------------


def test_the_money_landing_summary_costs_4_requests(client, db, published) -> None:
    """The /money landing's own read, end to end: 10 crossings before, 4 now.

    One of the 4 resolves which copy of Minnesota's data is live -- the release and
    the filings pointer ride on 1 statement inside a pinned request since
    ``committee_finance.current_release`` folded them (#2266) -- and every money read
    pays that one. The other 3 are the register's counts, the confirmation state, and
    the contests and outside-spending rows riding together.
    """
    with Statements() as sent:
        response = client.get(SUMMARY)

    assert response.status_code == 200
    assert len(sent.sent) == 4, sent.sent
    data = response.json()["data"]
    assert data["register"]["filer_count"] == 2
    assert data["contests"]["contest_count"] == 2
    assert data["independent_expenditure_rows"]["row_count"] == 2


def test_the_committee_directory_costs_4_requests(client, db, published) -> None:
    """The /money/committees directory: 8 crossings before, 4 now.

    The release read carries the filings pointer (#2266); then the register's counts,
    the page rows with their total, and the finer kinds from the 3 money files.
    """
    with Statements() as sent:
        response = client.get(COMMITTEES, params={"limit": 50, "offset": 0})

    assert response.status_code == 200
    assert len(sent.sent) == 4, sent.sent
    data = response.json()["data"]
    assert data["page"]["total"] == 2
    assert data["register_total"] == 2


def test_the_newest_filings_cost_2_requests(client, db, published) -> None:
    """The landing's newest-filings module: 6 crossings before, 2 now."""
    snapshot_id = _live_filings_snapshot_id(db)
    _report(db, snapshot_id, SENATE_COMMITTEE, row_number=1)

    with Statements() as sent:
        response = client.get(FILINGS, params={"limit": 6})

    assert response.status_code == 200
    assert len(sent.sent) == 2, sent.sent
    data = response.json()["data"]
    assert len(data["filings"]) == 1
    assert data["page"]["total"] == 1
