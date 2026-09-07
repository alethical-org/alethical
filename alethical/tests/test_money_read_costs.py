"""What each money read is allowed to ask the database for ([#1966]).

Net: the money pages were slow because of *what* they asked for, not because anything
was broken. Answering about 1 committee read every filing in Minnesota; answering about
1 office read every contribution in the state; the outside-spending record asked 8
separate questions where 1 does. Each of those is invisible in an ordinary test, because
the answers were all correct -- only the reader waited.

So these tests count and inspect the requests rather than the answers. They fail on the
attempt (a statewide sweep, a second trip) rather than on the harm (a slow page), which
is the only way a speed rule survives: nothing else in the suite would notice the sweep
coming back.

**No test here has a time limit in it, deliberately.** A seeded test database holds a few
rows on the same machine as the tests, so it cannot reproduce the distance between our
server and our database, and a wall-clock assertion here would measure the laptop it ran
on. The times live in the pull request and on the issue, measured against production.

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import event, text

from alethical.api.services import campaign_finance_races as races_service
from alethical.api.services import committee_finance as committee_service
from alethical.api.services import outside_spending as outside_spending_service
from alethical.db import models
from alethical.db.session import get_engine, get_session_factory
from alethical.pipeline import campaign_finance_filings as filings
from alethical.tests.filed_figures import (
    clear_filings_snapshots,
    publish_filings_snapshot,
)

Dataset = models.CampaignFinanceDataset
SnapshotStatus = models.CampaignFinanceSnapshotStatus
ReleaseStatus = models.CampaignFinanceReleaseStatus
FilerKind = models.CampaignFinanceFilerKind

SENATE_COMMITTEE = "18466"
HOUSE_COMMITTEE = "18129"
SPENDING_FUND = "30558"

CF_TABLES = (
    "cf_contribution_row",
    "cf_expenditure_row",
    "cf_independent_expenditure_row",
    "cf_fetch_observation",
    "cf_snapshot_body",
)


def _clear(session) -> None:
    session.rollback()
    clear_filings_snapshots(session)
    session.execute(text("UPDATE cf_current_release SET release_id = NULL"))
    session.execute(text("DELETE FROM cf_release"))
    for table in CF_TABLES:
        session.execute(text(f"DELETE FROM {table}"))
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


def _snapshot(db, dataset: Dataset, *, row_count: int = 0):
    marker = f"{dataset.value}-{uuid.uuid4()}"
    snapshot = models.CampaignFinanceSnapshot(
        dataset=dataset,
        download_id="-1811203041",
        source_url=f"https://cfb.mn.gov/reports/{dataset.value}.csv",
        content_hash=hashlib.sha256(marker.encode()).hexdigest(),
        record_set_hash=hashlib.sha256(f"records-{marker}".encode()).hexdigest(),
        byte_size=1024,
        row_count=row_count,
        status=SnapshotStatus.loaded,
    )
    db.add(snapshot)
    db.flush()
    return snapshot


@pytest.fixture()
def published(db):
    """A published release with 2 committees' money, and a register that lists them."""
    contributions = _snapshot(db, Dataset.contributions)
    expenditures = _snapshot(db, Dataset.expenditures)
    independent = _snapshot(db, Dataset.independent_expenditures, row_count=2)
    release = models.CampaignFinanceRelease(
        contributions_snapshot_id=contributions.id,
        expenditures_snapshot_id=expenditures.id,
        independent_expenditures_snapshot_id=independent.id,
        status=ReleaseStatus.published,
        fetch_started_at=datetime(2026, 8, 12, 2, 52, tzinfo=UTC),
        fetch_completed_at=datetime(2026, 8, 12, 2, 54, tzinfo=UTC),
        published_at=datetime(2026, 8, 12, 2, 56, tzinfo=UTC),
    )
    db.add(release)
    db.flush()
    db.execute(
        text(
            "INSERT INTO cf_current_release (id, release_id) VALUES (true, :rid) "
            "ON CONFLICT (id) DO UPDATE SET release_id = EXCLUDED.release_id"
        ),
        {"rid": release.id},
    )
    for row_number, (committee, name) in enumerate(
        (
            (SENATE_COMMITTEE, "Port, Lindsey Senate Committee"),
            (HOUSE_COMMITTEE, "Stephenson, Zachary House Committee"),
        ),
        start=1,
    ):
        db.add(
            models.CampaignFinanceContributionRow(
                snapshot_id=contributions.id,
                row_number=row_number,
                recipient=name,
                recipient_reg_num=committee,
                recipient_type="PCC",
                contributor="Giver, Ada",
                contrib_type="I",
                receipt_type="Contribution",
                year=2026,
                receipt_date=date(2026, 3, 1),
                amount=Decimal("250.00"),
            )
        )
        db.add(
            models.CampaignFinanceIndependentExpenditureRow(
                snapshot_id=independent.id,
                row_number=row_number,
                spender="Education Minn PAC",
                spender_reg_num=SPENDING_FUND,
                spender_type="PCF",
                affected_committee_name=name,
                affected_committee_reg_num=committee,
                for_against="For",
                year=2026,
                transaction_date=date(2026, 6, 1),
                type="Independent Expenditure",
                amount=Decimal("1000.00"),
                unpaid_amount=Decimal("0"),
                in_kind="No",
                purpose="Advertising - Print: Direct Mail",
                vendor_name="A Mail House",
            )
        )
    db.commit()
    snapshot_id = publish_filings_snapshot(
        db,
        filings=[
            (
                SENATE_COMMITTEE,
                2026,
                "individuals_contributions",
                Decimal("8600.00"),
                date(2026, 12, 31),
            ),
            (
                SENATE_COMMITTEE,
                2026,
                "total_expenditures",
                Decimal("4200.00"),
                date(2026, 12, 31),
            ),
            (
                HOUSE_COMMITTEE,
                2026,
                "individuals_contributions",
                Decimal("1500.00"),
                date(2026, 12, 31),
            ),
            (
                SENATE_COMMITTEE,
                2025,
                "individuals_contributions",
                Decimal("900.00"),
                date(2025, 12, 31),
            ),
        ],
    )
    for committee, office, district in (
        (SENATE_COMMITTEE, "Senate", "41"),
        (HOUSE_COMMITTEE, "House", "35A"),
    ):
        db.add(
            models.CampaignFinanceFiler(
                snapshot_id=snapshot_id,
                registration_number=committee,
                kind=FilerKind.candidate_committee,
                name=f"Committee {committee}",
                office=office,
                district=district,
                is_incumbent=True,
            )
        )
    db.commit()
    return release


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


def test_the_outside_spending_record_is_read_in_one_request(db, published) -> None:
    """One request for the rows, the figures, the counts and the link flags together.

    It used to be 8, and 2 of them were the whole cost of the page: the figures called
    the same text-tidying function on every row 4 times over, and the
    committees-we-cannot-link count re-asked all 41,130 rows instead of the 1,131
    committees they name. Together they were 2.7 s of a 2.9 s answer on production.
    """
    release = committee_service.current_release(db)
    with Statements() as sent:
        page = outside_spending_service.outside_spending(db, release)
    assert page.state == "reported"
    assert page.total_rows == 2
    rows_read = sent.touching("cf_independent_expenditure_row")
    assert len(rows_read) == 1, rows_read
    # The other 2 are the register pointer and the register snapshot behind it, which
    # `live_filings_snapshot` reads as 2 lookups for every caller in the codebase.
    assert len(sent.sent) == 3, sent.sent


def test_a_filtered_outside_spending_page_still_reads_the_record_once(
    db, published
) -> None:
    """The subject's own heading costs extra lookups; the record itself still costs 1."""
    release = committee_service.current_release(db)
    with Statements() as sent:
        page = outside_spending_service.outside_spending(
            db, release, about=SENATE_COMMITTEE
        )
    assert page.about is not None
    assert len(sent.touching("cf_independent_expenditure_row")) == 2, sent.sent
    # The second is the subject heading's own name lookup, which asks a different
    # question: what this committee is called on the rows filed about it.


def test_a_committee_reads_only_its_own_filing(db, published, monkeypatch) -> None:
    """1 committee, 1 year, 1 narrowed read -- never the whole state's filings.

    Money in and money out are 2 lines of the same filed report, so they share one read.
    The statewide sweep returned 55,845 figure rows on the live snapshot and a committee
    page was building all of them twice to print 2 numbers.
    """
    calls: list[tuple[list[str], list[int] | None]] = []
    real = filings.reported_totals_for

    def spy(session, registration_numbers, years=None):
        calls.append(
            (sorted(registration_numbers), None if years is None else sorted(years))
        )
        return real(session, registration_numbers, years=years)

    def refuse(*_args, **_kwargs):
        raise AssertionError("a committee request must never read every filing")

    monkeypatch.setattr(filings, "reported_totals_for", spy)
    monkeypatch.setattr(filings, "filings_context", refuse)
    release = committee_service.current_release(db)
    finance = committee_service.committee_finance(
        db, release, registration_number=SENATE_COMMITTEE, year=2026
    )
    assert finance is not None
    assert finance.money_in.reported_total == Decimal("8600.00")
    assert finance.money_out.reported_total == Decimal("4200.00")
    assert calls == [([SENATE_COMMITTEE], [2026])]


def test_a_race_page_reads_only_the_committees_it_lists(db, published, monkeypatch):
    """An office filter narrows the money reads, and the office chips still count all.

    Filtering to one office used to cost exactly what listing every office cost, which
    is what a 775-byte answer taking the same 1.26 s as a 277 KB one was telling us.
    """
    calls: list[tuple[list[str], list[int] | None]] = []
    real = filings.reported_totals_for

    def spy(session, registration_numbers, years=None):
        calls.append(
            (sorted(registration_numbers), None if years is None else sorted(years))
        )
        return real(session, registration_numbers, years=years)

    def refuse(*_args, **_kwargs):
        raise AssertionError("a race page must never read every filing")

    monkeypatch.setattr(filings, "reported_totals_for", spy)
    monkeypatch.setattr(filings, "filings_context", refuse)
    release = committee_service.current_release(db)
    with Statements() as sent:
        page = races_service.races(db, year=2026, office="Senate", release=release)

    assert calls == [([SENATE_COMMITTEE], [2026])]
    assert [contest.office for contest in page.contests] == ["Senate"]
    # The chips still label themselves from the whole register, unfiltered.
    assert dict(page.offices) == {"House": 1, "Senate": 1}
    assert page.committee_count == 2

    named = [
        statement
        for statement in sent.touching("cf_contribution_row")
        if "recipient_reg_num = ANY" in statement
    ]
    assert len(named) == 1, sent.sent


def test_a_race_page_still_says_a_year_it_holds_nothing_of_is_covered(
    db, published
) -> None:
    """The coverage question stays statewide, and narrowing the rest must not narrow it.

    A year we hold contributions for is a year we hold, even when no committee on this
    page has a row in it. Read from the listed committees alone, the Governor's empty
    2026 would read "we have nothing for this year" instead of "nobody has filed yet".
    """
    release = committee_service.current_release(db)
    db.execute(
        text(
            "UPDATE cf_contribution_row SET recipient_reg_num = '99999' "
            " WHERE snapshot_id = :snapshot"
        ),
        {"snapshot": release.contributions.snapshot_id},
    )
    db.commit()
    page = races_service.races(db, year=2026, office="Senate", release=release)
    committee = page.contests[0].committees[0]
    assert committee.named.state == "not_reported"
    assert committee.named.total is None
