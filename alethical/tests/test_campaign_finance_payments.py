"""What a payment list must never claim about the name on it (#1331).

``test_committee_finance.py`` guards the figures. This guards the rows underneath them,
and every test here stands in for a way a clickable name could state something no filing
supports.

The five that matter most:

* **Two spellings of one person stay two spellings.** The exact-string match is the whole
  design, and a test that only checked "a lookup finds its rows" would pass just as
  happily against a loosened match.
* **Identical rows both survive.** One download legitimately holds many rows with
  identical contents, so a list that deduplicates loses real payments, and only the record
  number tells 2 of them apart.
* **A registration number is followed only when it resolves to a committee we hold.**
  Contribution rows carry lobbyist numbers and a digit-spelled blank, and linking either
  is a wrong link rather than a dead one.
* **"We hold no rows" is never a zero**, and a year the download does not reach is our gap
  rather than a finding.
* **A stale release refuses.** A release whose rows were replaced out from under it must
  not answer with an empty list about a named person or organisation.

Fixtures are tiny and hand-written. Every count quoted in a docstring is a measurement of
production release ``3f2bdf90`` on 12 Aug 2026, evidence for the test rather than
something asserted here (``docs/architecture/campaign-finance-system-design.md`` §8).

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import text

from alethical.api.services.campaign_finance_payments import (
    NOT_REPORTED,
    REPORTED,
    UNAVAILABLE,
    UNIDENTIFIED_REGISTRATION_NUMBER,
    independent_payments_about,
    independent_payments_to_vendor,
    linkable_committees,
    payments_from_contributor,
    payments_from_donors_typing,
    payments_made,
    payments_received,
    payments_to_vendor,
)
from alethical.api.services.committee_finance import current_release
from alethical.db import models
from alethical.db.session import get_session_factory

Dataset = models.CampaignFinanceDataset
SnapshotStatus = models.CampaignFinanceSnapshotStatus
ReleaseStatus = models.CampaignFinanceReleaseStatus

# Real registration numbers from the live release, so a reader can check anything here
# against the Board's own download.
CAUCUS = "20010"  # HRCC: files General Expenditure and no other label.
CANDIDATE = "18466"  # Port, Lindsey Senate Committee: Campaign Expenditure and a loan.
STATE_PARTY = "20003"  # MN DFL State Central Committee.
# A committee reachable only as the target of someone else's independent spending. 341 of
# these are in the live release and 283 carry a negative number the Board assigns
# internally, because they are local candidates the state does not register.
TARGET_ONLY = (
    "-2139633793"  # Olsen, Tom for Minneapolis Park and Recreation Commissioner
)
# A number that arrives on contribution rows and is nobody's filer number. All 912
# lobbyist numbers in the live release behave this way.
LOBBYIST_NUMBER = "900123"

CF_TABLES = (
    "cf_contribution_row",
    "cf_expenditure_row",
    "cf_independent_expenditure_row",
    "cf_fetch_observation",
    "cf_snapshot_body",
)


def _clear(session) -> None:
    session.rollback()
    session.execute(text("UPDATE cf_current_release SET release_id = NULL"))
    session.execute(text("DELETE FROM cf_release"))
    for table in CF_TABLES:
        session.execute(text(f"DELETE FROM {table}"))
    session.execute(text("DELETE FROM cf_snapshot"))
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
    """One loaded snapshot.

    ``row_count`` is what the snapshot recorded at publish time, which is what tells a
    pruned release from a download that was legitimately empty.
    """
    marker = f"{dataset.value}-{uuid.uuid4()}"
    snapshot = models.CampaignFinanceSnapshot(
        dataset=dataset,
        download_id="-2113865252",
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


class Published:
    """A published release plus the 3 snapshots behind it, for adding rows to."""

    def __init__(self, db, *, published_rows: int = 0):
        self.contributions = _snapshot(
            db, Dataset.contributions, row_count=published_rows
        )
        self.expenditures = _snapshot(
            db, Dataset.expenditures, row_count=published_rows
        )
        self.independent = _snapshot(
            db, Dataset.independent_expenditures, row_count=published_rows
        )
        release = models.CampaignFinanceRelease(
            contributions_snapshot_id=self.contributions.id,
            expenditures_snapshot_id=self.expenditures.id,
            independent_expenditures_snapshot_id=self.independent.id,
            status=ReleaseStatus.published,
            fetch_started_at=datetime(2026, 8, 12, 2, 52, tzinfo=UTC),
            fetch_completed_at=datetime(2026, 8, 12, 2, 54, tzinfo=UTC),
            published_at=datetime(2026, 8, 12, 2, 56, tzinfo=UTC),
        )
        db.add(release)
        db.flush()
        # The pointer row exists forever in production; a freshly migrated test database
        # has none, so insert-or-update rather than update.
        db.execute(
            text(
                "INSERT INTO cf_current_release (id, release_id) VALUES (true, :rid) "
                "ON CONFLICT (id) DO UPDATE SET release_id = EXCLUDED.release_id"
            ),
            {"rid": release.id},
        )
        self.release = release
        db.commit()


_ROW_COUNTER: dict[uuid.UUID, int] = {}


def _next_row(snapshot) -> int:
    _ROW_COUNTER[snapshot.id] = _ROW_COUNTER.get(snapshot.id, 0) + 1
    return _ROW_COUNTER[snapshot.id]


def _receipt(
    db,
    snapshot,
    *,
    reg_num=CANDIDATE,
    amount="250",
    contributor="A Donor",
    contributor_reg=None,
    contributor_type="Individual",
    employer=None,
    receipt_type="Contribution",
    year=2025,
    on=None,
    name="Port, Lindsey Senate Committee",
) -> int:
    """One contribution row. Returns its record number so a test can name it."""
    row_number = _next_row(snapshot)
    db.add(
        models.CampaignFinanceContributionRow(
            snapshot_id=snapshot.id,
            row_number=row_number,
            recipient_reg_num=reg_num,
            recipient=name,
            recipient_type="PCC",
            amount=None if amount is None else Decimal(amount),
            receipt_date=on if on is not None else date(year, 6, 1),
            year=year,
            contributor=contributor,
            contrib_reg_num=contributor_reg,
            contrib_type=contributor_type,
            contrib_employer_name=employer,
            receipt_type=receipt_type,
            in_kind="No",
        )
    )
    db.flush()
    return row_number


def _payment(
    db,
    snapshot,
    *,
    reg_num=CANDIDATE,
    amount="500",
    vendor="A Vendor",
    kind="Campaign Expenditure",
    year=2025,
    on=None,
    affected=None,
    affected_name=None,
    name="Port, Lindsey Senate Committee",
) -> int:
    """One expenditure row. Returns its record number."""
    row_number = _next_row(snapshot)
    db.add(
        models.CampaignFinanceExpenditureRow(
            snapshot_id=snapshot.id,
            row_number=row_number,
            committee_reg_num=reg_num,
            committee_name=name,
            entity_type="PCC",
            vendor_name=vendor,
            amount=None if amount is None else Decimal(amount),
            unpaid_amount=Decimal("0"),
            transaction_date=on if on is not None else date(year, 6, 1),
            year=year,
            type=kind,
            purpose="Printing",
            affected_committee_reg_num=affected,
            affected_committee_name=affected_name,
        )
    )
    db.flush()
    return row_number


def _independent(
    db,
    snapshot,
    *,
    affected=CANDIDATE,
    affected_name="Port, Lindsey Senate Committee",
    spender_reg=STATE_PARTY,
    vendor="A Mail House",
    amount="1000",
    direction="For",
    year=2025,
) -> int:
    """One independent-expenditure row. Returns its record number."""
    row_number = _next_row(snapshot)
    db.add(
        models.CampaignFinanceIndependentExpenditureRow(
            snapshot_id=snapshot.id,
            row_number=row_number,
            spender="MN DFL State Central Committee",
            spender_reg_num=spender_reg,
            affected_committee_name=affected_name,
            affected_committee_reg_num=affected,
            for_against=direction,
            year=year,
            transaction_date=date(year, 6, 1),
            type="Independent Expenditure",
            amount=Decimal(amount),
            vendor_name=vendor,
        )
    )
    db.flush()
    return row_number


def _release(db):
    release = current_release(db)
    assert release is not None
    return release


# --- Two spellings are two spellings -----------------------------------------


def test_two_similar_donor_spellings_are_never_merged(db):
    """ "Messinger, Alida" and "Messinger, Alida R" stay 2 separate donors.

    The live release holds 3 spellings of what is plainly one person -- 121 payments to 39
    committees, 10 to 6, and 4 to 1 -- and also holds "Messinger, William Frye" beside
    "Messinger, Wiiiam Frey". Any rule loose enough to join the first three joins those
    two as well, so the match is exact and each string answers only for itself
    (``docs/architecture/campaign-finance-system-design.md`` §5).
    """
    published = Published(db)
    _receipt(db, published.contributions, contributor="Messinger, Alida", amount="1000")
    _receipt(db, published.contributions, contributor="Messinger, Alida", amount="2000")
    _receipt(
        db,
        published.contributions,
        contributor="Messinger, Alida R",
        amount="500",
        reg_num=CAUCUS,
        name="House Republican Campaign Committee (HRCC)",
    )
    db.commit()
    release = _release(db)

    plain = payments_from_contributor(db, release, contributor="Messinger, Alida")
    with_initial = payments_from_contributor(
        db, release, contributor="Messinger, Alida R"
    )

    assert [payment.amount for payment in plain.payments] == [
        Decimal("2000"),
        Decimal("1000"),
    ]
    assert {payment.recipient_registration_number for payment in plain.payments} == {
        CANDIDATE
    }
    assert [payment.contributor for payment in with_initial.payments] == [
        "Messinger, Alida R"
    ]
    assert {
        payment.recipient_registration_number for payment in with_initial.payments
    } == {CAUCUS}


def test_a_prefix_of_a_real_name_matches_nothing(db):
    """A shorter string is a different string, and finds no rows rather than the longer one.

    Guards the exact match from the other side: a lookup that quietly became a prefix or
    a ``LIKE`` would pass the test above and fail this one.
    """
    published = Published(db)
    _receipt(db, published.contributions, contributor="Messinger, Alida R")
    db.commit()

    page = payments_from_contributor(db, _release(db), contributor="Messinger, Alida")

    assert page.state == NOT_REPORTED
    assert page.payments == ()


# --- Identical rows both survive ---------------------------------------------


def test_two_identical_payments_both_survive_and_differ_only_by_record_number(db):
    """A download legitimately repeats a row's contents, and both rows are real payments.

    15,786 contribution rows in the live release are content-identical to at least one
    other, in 6,464 groups, and one group holds 119 identical rows ($30.00 from
    "Zachary, Wivoda" to 20008 on 31 Aug 2019). So nothing may deduplicate and nothing may
    key on a row's contents; a row is its snapshot and its record number, and §4.2 is
    explicit that pair is not an identity across downloads.
    """
    published = Published(db)
    first = _receipt(
        db,
        published.contributions,
        contributor="Zachary, Wivoda",
        amount="30",
        on=date(2019, 8, 31),
        year=2019,
        reg_num=STATE_PARTY,
        name="MN DFL State Central Committee",
    )
    second = _receipt(
        db,
        published.contributions,
        contributor="Zachary, Wivoda",
        amount="30",
        on=date(2019, 8, 31),
        year=2019,
        reg_num=STATE_PARTY,
        name="MN DFL State Central Committee",
    )
    db.commit()

    page = payments_from_contributor(db, _release(db), contributor="Zachary, Wivoda")

    assert page.state == REPORTED
    assert len(page.payments) == 2
    assert {payment.record_number for payment in page.payments} == {first, second}
    one, other = page.payments
    everything_else = lambda payment: (  # noqa: E731
        payment.contributor,
        payment.amount,
        payment.received_on,
        payment.year,
        payment.recipient_registration_number,
        payment.receipt_type,
    )
    assert everything_else(one) == everything_else(other)


# --- A number is followed only where it resolves -----------------------------


def test_a_donor_number_the_release_holds_as_a_filer_is_linkable(db):
    """A party unit that gave money links by its registration number, which is §5's rule.

    85,764 of the 583,152 contribution rows carry a contributor registration number, and
    for the filer-shaped types it nearly always resolves: ``Party Unit`` 437 of 441
    distinct numbers, ``Political Committee/Fund`` 510 of 521.
    """
    published = Published(db)
    _receipt(
        db,
        published.contributions,
        contributor="MN DFL State Central Committee",
        contributor_reg=STATE_PARTY,
        contributor_type="Party Unit",
    )
    # The same number filing money out of its own account is what makes it a filer here.
    _payment(
        db,
        published.expenditures,
        reg_num=STATE_PARTY,
        name="MN DFL State Central Committee",
    )
    db.commit()

    page = payments_received(db, _release(db), registration_number=CANDIDATE, year=2025)

    assert [payment.contributor_registration_number for payment in page.payments] == [
        STATE_PARTY
    ]
    assert page.linkable_registration_numbers == frozenset({STATE_PARTY})


def test_a_lobbyist_number_is_returned_but_never_linkable(db):
    """A number that is nobody's filer number must not be offered as a link.

    All 912 distinct numbers arriving on rows typed ``Lobbyist`` in the live release
    appear nowhere as a committee's registration number, so resolving one as a committee
    would be a **wrong** link rather than a dead one. The check is against the rows we
    hold rather than against the type column, because that column is not a reliable
    sorter: 11 of 521 ``Political Committee/Fund`` numbers resolve nowhere either.
    """
    published = Published(db)
    _receipt(
        db,
        published.contributions,
        contributor="A Lobbyist",
        contributor_reg=LOBBYIST_NUMBER,
        contributor_type="Lobbyist",
    )
    db.commit()

    page = payments_received(db, _release(db), registration_number=CANDIDATE, year=2025)

    assert [payment.contributor_registration_number for payment in page.payments] == [
        LOBBYIST_NUMBER
    ]
    assert page.linkable_registration_numbers == frozenset()


def test_the_digit_spelled_blank_never_reaches_a_caller_as_a_number(db):
    """``Contrib Reg Num`` of "0" is a blank, and 621 unrelated donors share it.

    1,227 rows in the live release carry it, across 7 different contributor types and 621
    distinct names from "(Emily) Larson for Duluth" to "Ziton, Kim". A link on it merges
    all 621 onto one page, so it is normalised away before a caller can read it as an
    identifier.
    """
    published = Published(db)
    _receipt(
        db,
        published.contributions,
        contributor="Ziton, Kim",
        contributor_reg=UNIDENTIFIED_REGISTRATION_NUMBER,
    )
    db.commit()

    page = payments_received(db, _release(db), registration_number=CANDIDATE, year=2025)

    assert page.payments[0].contributor_registration_number is None
    assert page.linkable_registration_numbers == frozenset()


def test_linkable_committees_asked_for_nothing_answers_nothing(db):
    """No numbers in means no query and an empty answer, not every filer we hold."""
    Published(db)
    db.commit()
    assert linkable_committees(db, _release(db), []) == frozenset()


# --- A committee reachable only as a target ----------------------------------


def test_a_committee_only_outside_spending_names_still_resolves(db):
    """341 committees in the live release have no filings of their own, and still have rows.

    283 of them carry a negative number the Board assigns internally, because the state
    does not register candidates for city, county or school-board office. Their
    independent-spending rows are real records and must be reachable; their own money must
    read as silence rather than as a zero, because they file nothing with the state at all.
    """
    published = Published(db)
    _independent(
        db,
        published.independent,
        affected=TARGET_ONLY,
        affected_name="Olsen, Tom for Minneapolis Park and Recreation Commissioner",
    )
    # Real filings elsewhere in the release, so "no rows for this committee" cannot be
    # confused with "the download is empty". The spender's own outgoing filing is what
    # makes it a filer, which is the difference the linkable assertion below turns on.
    _receipt(db, published.contributions)
    _payment(
        db,
        published.expenditures,
        reg_num=STATE_PARTY,
        name="MN DFL State Central Committee",
    )
    db.commit()
    release = _release(db)

    about = independent_payments_about(
        db, release, registration_number=TARGET_ONLY, year=2025
    )
    assert about.state == REPORTED
    assert about.payments[0].affected_committee_registration_number == TARGET_ONLY
    assert about.payments[0].stance == "For"
    # The spender files with the state and is linkable; the target does not and is not.
    assert about.linkable_registration_numbers == frozenset({STATE_PARTY})

    for own_money in (payments_received, payments_made):
        page = own_money(db, release, registration_number=TARGET_ONLY, year=2025)
        assert page.state == NOT_REPORTED
        assert page.payments == ()


# --- Our own gaps are never a zero ------------------------------------------


def test_no_rows_for_a_covered_year_is_silence_and_carries_no_figure(db):
    """A committee-year we hold nothing for may hold real money, so it is never a zero.

    Minnesota names a donor only once their giving passes $200 in aggregate for the
    calendar year, so a committee whose donors all gave less is never itemized at all.
    """
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CAUCUS, name="HRCC")
    db.commit()

    page = payments_received(db, _release(db), registration_number=CANDIDATE, year=2025)

    assert page.state == NOT_REPORTED
    assert page.payments == ()
    assert page.has_more is False


def test_a_year_the_download_does_not_reach_is_our_gap_not_a_finding(db):
    """The downloads cover 2015 to 2026 and the route accepts 2100.

    Without this, a request for 2027 comes back as a confident empty list about a year
    nobody has filed for -- and a page defaulting to "this year" reaches it on 1 January.
    """
    published = Published(db)
    _receipt(db, published.contributions, year=2025)
    db.commit()

    page = payments_received(db, _release(db), registration_number=CANDIDATE, year=2027)

    assert page.state == UNAVAILABLE
    assert page.payments == ()


def test_a_stale_release_refuses_rather_than_returning_an_empty_list(db):
    """A release held across 2 publishes finds no rows, and that is our staleness.

    The loader keeps one spare generation, so a request that resolved a release just
    before 2 publishes landed reaches this in production. The snapshots say they published
    rows and hold none, which is what separates it from a download that was empty.
    """
    Published(db, published_rows=1000)
    db.commit()
    release = _release(db)

    for read in (payments_received, payments_made, independent_payments_about):
        page = read(db, release, registration_number=CANDIDATE, year=2025)
        assert page.state == UNAVAILABLE, read.__name__
        assert page.payments == ()

    by_name = payments_from_contributor(db, release, contributor="Messinger, Alida")
    assert by_name.state == UNAVAILABLE
    assert by_name.payments == ()


def test_a_name_matching_nothing_is_not_a_stale_release(db):
    """With rows present, a name nobody filed under reads as silence rather than a gap.

    The pair with the test above is the point: both return an empty list, and the 2 states
    are the difference between "no row carries this spelling" and "our copy of the file has
    been replaced".
    """
    published = Published(db, published_rows=1)
    _receipt(db, published.contributions, contributor="A Donor")
    db.commit()

    page = payments_from_contributor(db, _release(db), contributor="Nobody, At All")

    assert page.state == NOT_REPORTED
    assert page.payments == ()


# --- Every label counts ------------------------------------------------------


def test_both_expenditure_labels_are_listed_for_the_same_question(db):
    """A candidate committee and a party unit label the same spending differently.

    In 2025 candidate committees filed 6,781 rows typed ``Campaign Expenditure`` and none
    typed ``General Expenditure``; party units filed 7,524 the other way round. A list
    filtered to either label reports a whole kind of filer as having spent nothing.
    """
    published = Published(db)
    _payment(db, published.expenditures, kind="Campaign Expenditure", amount="100")
    _payment(db, published.expenditures, kind="Non-Campaign Disbursement", amount="200")
    _payment(
        db,
        published.expenditures,
        kind="Contribution",
        amount="300",
        affected=CAUCUS,
        affected_name="House Republican Campaign Committee (HRCC)",
        vendor=None,
    )
    _payment(
        db,
        published.expenditures,
        reg_num=CAUCUS,
        kind="General Expenditure",
        amount="400",
        name="House Republican Campaign Committee (HRCC)",
    )
    db.commit()
    release = _release(db)

    candidate = payments_made(db, release, registration_number=CANDIDATE, year=2025)
    caucus = payments_made(db, release, registration_number=CAUCUS, year=2025)

    assert {payment.expenditure_type for payment in candidate.payments} == {
        "Campaign Expenditure",
        "Non-Campaign Disbursement",
        "Contribution",
    }
    assert [payment.expenditure_type for payment in caucus.payments] == [
        "General Expenditure"
    ]
    # Only the transfer names another committee; the rest name a supplier instead.
    transfer = next(
        payment
        for payment in candidate.payments
        if payment.expenditure_type == "Contribution"
    )
    assert transfer.affected_committee_registration_number == CAUCUS
    assert candidate.linkable_registration_numbers == frozenset({CAUCUS})


def test_a_loan_is_listed_beside_a_contribution_and_keeps_its_own_label(db):
    """1.2% of rows in the "itemized contributions" file are not contributions.

    They are ``Miscellaneous``, ``Miscellaneous Income`` or ``Loan Payable``, reported on
    separate schedules -- Senator Lindsey Port's committee carries a $5,000 row typed
    ``Miscellaneous`` with contributor type ``Self``, a loan from the candidate to her own
    campaign. Dropping them from a *list* loses money the Board published; folding them
    into a *total* is the trap, and there is no total here.
    """
    published = Published(db)
    _receipt(db, published.contributions, amount="250", receipt_type="Contribution")
    _receipt(
        db,
        published.contributions,
        amount="5000",
        receipt_type="Miscellaneous",
        contributor="Port, Lindsey",
        contributor_type="Self",
    )
    db.commit()

    page = payments_received(db, _release(db), registration_number=CANDIDATE, year=2025)

    assert {(payment.receipt_type, payment.amount) for payment in page.payments} == {
        ("Contribution", Decimal("250")),
        ("Miscellaneous", Decimal("5000")),
    }


# --- The file's own Year column ---------------------------------------------


def test_the_year_filter_reads_the_files_own_year_column_not_the_date(db):
    """``Year`` and the row's date are separate claims and disagree on 702 rows.

    A filing is scoped by ``Year``, so that is what a year filter has to use. A row dated
    in January 2026 and filed under 2025 belongs to the 2025 request.
    """
    published = Published(db)
    _receipt(db, published.contributions, year=2025, on=date(2026, 1, 4), amount="777")
    # Another committee's 2026 filing, so the 2026 request below is asking about a year the
    # download reaches. Without it the answer would be "unavailable" -- correct, but about
    # our coverage rather than about which column the filter read.
    _receipt(db, published.contributions, reg_num=CAUCUS, name="HRCC", year=2026)
    db.commit()
    release = _release(db)

    filed_2025 = payments_received(
        db, release, registration_number=CANDIDATE, year=2025
    )
    filed_2026 = payments_received(
        db, release, registration_number=CANDIDATE, year=2026
    )

    assert [payment.amount for payment in filed_2025.payments] == [Decimal("777")]
    assert filed_2025.payments[0].received_on == date(2026, 1, 4)
    assert filed_2026.state == NOT_REPORTED


# --- Vendors and employers, which have no identifier either ------------------


def test_a_vendors_two_files_are_returned_separately_and_never_combined(db):
    """491 independent-expenditure rows share a spender, vendor, amount and date with an
    expenditures row, and 166 expenditure rows do the reverse.

    Whether those are one payment filed twice or two payments that coincide is not
    established, so the 2 downloads are 2 answers with their own source files and a caller
    cannot add them by accident.
    """
    published = Published(db)
    _payment(db, published.expenditures, vendor="Facebook", amount="900")
    _independent(db, published.independent, vendor="Facebook", amount="900")
    db.commit()
    release = _release(db)

    committee_side = payments_to_vendor(db, release, vendor="Facebook")
    independent_side = independent_payments_to_vendor(db, release, vendor="Facebook")

    assert committee_side.dataset is Dataset.expenditures
    assert independent_side.dataset is Dataset.independent_expenditures
    assert committee_side.source_url != independent_side.source_url
    assert len(committee_side.payments) == 1
    assert len(independent_side.payments) == 1
    # The paying committee is a filer, so a vendor's row links back to it.
    assert committee_side.linkable_registration_numbers == frozenset({CANDIDATE})


def test_an_employer_string_answers_only_for_itself(db):
    """The employer box holds statuses and occupations as much as employers.

    Its 4 commonest values in the live release are "Not Employed" (67,342 rows),
    "Retired" (36,517), "Self employed Retired" (16,788) and "Lawyer" (9,276), and 87,419
    rows carry nothing at all. So this is payments whose donor typed a string, never a
    company's giving, and "Retired" and "Self employed Retired" are 2 strings.
    """
    published = Published(db)
    _receipt(db, published.contributions, contributor="One Donor", employer="Retired")
    _receipt(
        db,
        published.contributions,
        contributor="Another Donor",
        employer="Self employed Retired",
    )
    db.commit()
    release = _release(db)

    retired = payments_from_donors_typing(db, release, employer="Retired")
    self_employed = payments_from_donors_typing(
        db, release, employer="Self employed Retired"
    )

    assert [payment.contributor for payment in retired.payments] == ["One Donor"]
    assert [payment.contributor for payment in self_employed.payments] == [
        "Another Donor"
    ]


# --- Nothing is presented as complete when it is not ------------------------


def test_a_truncated_list_says_so_and_pages_without_repeating_a_row(db):
    """``has_more`` is measured by asking for one more row than the page shows.

    A donor page has to be able to say it is showing part of a list, because the
    alternative is a page that looks complete and is not -- the failure
    ``.claude/rules/grounded-answers.md`` rule 11 forbids of a generated answer, arriving
    here through a limit instead.

    Paging orders by the row's date, newest first, and then by its record number, which is
    unique within a snapshot. It must not order by contents: 15,786 contribution rows in
    the live release share theirs with another row, so a content-keyed order could repeat
    or skip one.

    The 5 rows are laid out so the dates and the amounts disagree, and so 2 of them share a
    date. Ordered any other plausible way -- by amount, by date ascending, or by date with
    no tie-breaker -- the pages below come back in a different sequence.
    """
    published = Published(db)
    # (amount, date). Deliberately not in step: sorting by amount puts 104 first while
    # sorting by date puts 100 first, and records 3 and 4 tie on the date so only the
    # record-number tie-breaker decides which of them a page shows.
    laid_out = (
        ("100", date(2025, 6, 5)),
        ("101", date(2025, 6, 1)),
        ("102", date(2025, 6, 3)),
        ("103", date(2025, 6, 3)),
        ("104", date(2025, 6, 2)),
    )
    for amount, on in laid_out:
        _receipt(
            db,
            published.contributions,
            contributor="Messinger, Alida",
            amount=amount,
            on=on,
        )
    db.commit()
    release = _release(db)

    pages = [
        payments_from_contributor(
            db, release, contributor="Messinger, Alida", limit=2, offset=offset
        )
        for offset in (0, 2, 4)
    ]

    assert [page.has_more for page in pages] == [True, True, False]
    seen = [payment.record_number for page in pages for payment in page.payments]
    assert len(seen) == len(set(seen)) == 5
    # Newest date first; the same-date pair ordered by the later record number first.
    assert [payment.amount for page in pages for payment in page.payments] == [
        Decimal("100"),
        Decimal("103"),
        Decimal("102"),
        Decimal("104"),
        Decimal("101"),
    ]


def test_every_page_names_the_release_and_the_file_it_came_from(db):
    """A row's only honest citation is "record N of the file we downloaded from here".

    Minnesota publishes no per-transaction identifier and no page for an individual
    payment, so the record number is meaningless without the download it counts into --
    and ``release_id`` is what lets a caller see that a later page came from a different
    day's data.
    """
    published = Published(db)
    _receipt(db, published.contributions)
    db.commit()
    release = _release(db)

    page = payments_received(db, release, registration_number=CANDIDATE, year=2025)

    assert page.release_id == release.id
    assert page.source_url == release.contributions.source_url
    assert page.fetched_at == datetime(2026, 8, 12, 2, 54, tzinfo=UTC)
    assert page.payments[0].record_number >= 1


def test_a_name_holding_a_comma_and_a_quote_is_matched_not_interpreted(db):
    """Minnesota's names are full of punctuation, and every one is a bound parameter.

    The files hold `'Gordon, James "Jimmy"'` and vendor names like
    `'Amazon.com, 1.5\\" Micro Rod'`, so a lookup that built its own SQL string would
    both miss real rows and hand a caller a way to write the query.
    """
    published = Published(db)
    _receipt(db, published.contributions, contributor='Gordon, James "Jimmy"')
    db.commit()
    release = _release(db)

    found = payments_from_contributor(db, release, contributor='Gordon, James "Jimmy"')
    injected = payments_from_contributor(db, release, contributor="' OR 1=1 --")

    assert [payment.contributor for payment in found.payments] == [
        'Gordon, James "Jimmy"'
    ]
    assert injected.state == NOT_REPORTED
    assert injected.payments == ()


def test_no_year_asked_for_returns_every_year_the_download_holds(db):
    """A donor's payments are not confined to one year, so the year filter is optional.

    The release covers 2015 to 2026 today, and a caller omitting the year gets all of it
    with each payment carrying its own date -- which is what stops a page implying the
    list is a lifetime.
    """
    published = Published(db)
    _receipt(db, published.contributions, contributor="Messinger, Alida", year=2015)
    _receipt(db, published.contributions, contributor="Messinger, Alida", year=2025)
    db.commit()

    page = payments_from_contributor(db, _release(db), contributor="Messinger, Alida")

    assert sorted(payment.year for payment in page.payments) == [2015, 2025]


# --- The routes' own decisions -----------------------------------------------


def test_the_route_serves_a_committees_rows_with_its_citation(db, client):
    """End to end: the rows, which numbers may be linked, and where they came from."""
    published = Published(db)
    _receipt(
        db,
        published.contributions,
        contributor="MN DFL State Central Committee",
        contributor_reg=STATE_PARTY,
        contributor_type="Party Unit",
        amount="1000.00",
    )
    _receipt(
        db,
        published.contributions,
        contributor="A Lobbyist",
        contributor_reg=LOBBYIST_NUMBER,
        contributor_type="Lobbyist",
        amount="500.00",
    )
    _payment(
        db,
        published.expenditures,
        reg_num=STATE_PARTY,
        name="MN DFL State Central Committee",
    )
    db.commit()

    response = client.get(
        f"/api/v1/committees/{CANDIDATE}/payments",
        params={"direction": "received", "year": 2025},
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["state"] == "reported"
    assert body["dataset"] == "contributions"
    assert len(body["payments"]) == 2
    assert body["linkable_registration_numbers"] == [STATE_PARTY]
    assert body["source_url"].endswith("contributions.csv")
    assert body["page"]["has_more"] is False
    assert body["payments"][0]["record_number"] >= 1
    # No total anywhere in the payload, because every figure a page may print comes from
    # /committees/{n}/finance where the source's traps are enforced.
    assert "total" not in " ".join(body)


def test_the_route_reads_a_stale_download_as_unavailable_rather_than_an_error(
    db, client
):
    """A replaced set is a state a page can explain, not a 503.

    The aggregate route answers 503 on the same condition because it cannot even name the
    committee. This route names nothing, so it says which of the 3 things an empty list
    means and lets a surface say "our copy of this file is being replaced".
    """
    Published(db, published_rows=1000)

    response = client.get(
        f"/api/v1/committees/{CANDIDATE}/payments",
        params={"direction": "made", "year": 2025},
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["state"] == "unavailable"
    assert body["payments"] == []


def test_the_route_says_503_when_nothing_is_published(db, client):
    """No release at all is a fact about us and never a donor's or committee's zero."""
    response = client.get(
        "/api/v1/campaign-finance/payments-under-name",
        params={"name": "Messinger, Alida", "role": "contributor"},
    )
    assert response.status_code == 503


def test_the_name_route_answers_200_for_a_spelling_nobody_filed_under(db, client):
    """Not a 404. A 404 would say this person does not exist; we only know the string does not.

    The Board's registered-filer directory decides whether a committee exists, and nothing
    decides whether a person does, so the honest answer is "no row carries this spelling".
    """
    published = Published(db, published_rows=1)
    _receipt(db, published.contributions, contributor="Messinger, Alida")
    db.commit()

    response = client.get(
        "/api/v1/campaign-finance/payments-under-name",
        params={"name": "Messinger, Alida R", "role": "contributor"},
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["name"] == "Messinger, Alida R"
    assert body["state"] == "not_reported"
    assert body["payments"] == []


def test_the_name_route_keeps_a_vendors_two_files_apart(db, client):
    """2 roles rather than 1, so a caller cannot add the 2 filings by accident."""
    published = Published(db)
    _payment(db, published.expenditures, vendor="Facebook", amount="900.00")
    _independent(db, published.independent, vendor="Facebook", amount="900.00")
    db.commit()

    committee_side = client.get(
        "/api/v1/campaign-finance/payments-under-name",
        params={"name": "Facebook", "role": "vendor"},
    ).json()["data"]
    independent_side = client.get(
        "/api/v1/campaign-finance/payments-under-name",
        params={"name": "Facebook", "role": "independent_vendor"},
    ).json()["data"]

    assert committee_side["dataset"] == "expenditures"
    assert independent_side["dataset"] == "independent_expenditures"
    assert len(committee_side["payments"]) == 1
    assert len(independent_side["payments"]) == 1


def test_the_routes_refuse_a_direction_or_role_they_do_not_serve(db, client):
    """A misspelled parameter is a 422, never a silent fallback to a different question."""
    Published(db)
    db.commit()

    assert (
        client.get(
            f"/api/v1/committees/{CANDIDATE}/payments",
            params={"direction": "sideways", "year": 2025},
        ).status_code
        == 422
    )
    assert (
        client.get(
            "/api/v1/campaign-finance/payments-under-name",
            params={"name": "Facebook", "role": "landlord"},
        ).status_code
        == 422
    )


def test_the_route_refuses_a_registration_number_we_hold_no_record_of(db, client):
    """404, not "this committee reported nothing".

    The reader cannot tell an unknown number from a committee that filed nothing -- both
    are no rows -- so without a check first, an unknown number comes back as
    ``not_reported`` and the page invents a committee to attribute silence to. Live case:
    30161 circulates as "Alliance for a Better MN" and appears in no dataset of the current
    release, its real committees being 41360 and 80024. Found by an automated review
    (Greptile) on the first version of this route.

    The wording is about **our records**: the Board's registered-filer directory decides
    whether a committee exists and nothing here reads it yet.
    """
    # `published_rows=0` on purpose: a snapshot that published rows and holds none is the
    # *stale* case, which the test below covers and which must not 404.
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE)
    db.commit()

    response = client.get(
        "/api/v1/committees/30161/payments",
        params={"direction": "received", "year": 2025},
    )

    assert response.status_code == 404
    assert "registration number" in response.json()["detail"]
    # The number we do hold still answers.
    assert (
        client.get(
            f"/api/v1/committees/{CANDIDATE}/payments",
            params={"direction": "received", "year": 2025},
        ).status_code
        == 200
    )


def test_a_committee_only_outside_spending_names_is_not_refused(db, client):
    """The 341 target-only committees resolve, so the 404 above cannot swallow them.

    They have no filings of their own, so a check that looked only at the 2 money files
    would 404 every one of them -- including all 283 with a negative number -- and the
    independent-spending rows about them are real records.
    """
    published = Published(db)
    _independent(db, published.independent, affected=TARGET_ONLY)
    db.commit()

    response = client.get(
        f"/api/v1/committees/{TARGET_ONLY}/payments",
        params={"direction": "independent", "year": 2025},
    )

    assert response.status_code == 200
    assert response.json()["data"]["state"] == "reported"


def test_a_stale_release_is_never_a_missing_committee(db, client):
    """With the rows replaced, we cannot say whether we hold this committee -- so no 404.

    Denying a committee's existence on the strength of our own pruning is the same
    missing-versus-zero failure the 404 above prevents, one level up. The read reports
    ``unavailable`` instead, which is a fact about us.
    """
    Published(db, published_rows=1000)

    response = client.get(
        f"/api/v1/committees/{CANDIDATE}/payments",
        params={"direction": "received", "year": 2025},
    )

    assert response.status_code == 200
    assert response.json()["data"]["state"] == "unavailable"
