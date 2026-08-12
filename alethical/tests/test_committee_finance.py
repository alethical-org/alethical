"""What a committee's money figures must never claim (#1442).

A committee is identified by Minnesota's registration number, which needs nobody's
confirmation, so every read here runs with no legislator and no confirmed link
anywhere in the path. Each test stands in for a way this layer could state
something no filing supports.

The four that matter most:

* **"We hold no rows" is never a zero.** Only donors who pass $200 in aggregate for
  the year are ever named, so a committee-year we hold nothing for may hold real
  money. Reading absence as ``0`` states a fact about a named organisation.
* **Only ``Receipt type = 'Contribution'`` is a contribution**, and the rest is real
  money that gets its own label rather than being dropped or folded in.
* **Every expenditure ``Type`` counts.** A candidate committee and a party unit
  label the same spending differently, so a single-label filter reports a whole kind
  of filer as having spent nothing.
* **One release serves the whole page.** Re-resolving per dataset can pair one day's
  income with another day's spending.

Fixtures are tiny and hand-written. Every count quoted in a docstring is a
measurement of the live release on 12 Aug 2026, evidence for the test rather than
something asserted here (`docs/architecture/campaign-finance-system-design.md` §8).

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import text

from alethical.api.services.committee_finance import (
    NOT_REPORTED,
    REPORTED,
    UNAVAILABLE,
    committee_finance,
    current_release,
    find_committee,
    money_in,
    money_out,
    pin_to_one_view,
)
from alethical.db import models
from alethical.db.session import get_session_factory

Dataset = models.CampaignFinanceDataset
SnapshotStatus = models.CampaignFinanceSnapshotStatus
ReleaseStatus = models.CampaignFinanceReleaseStatus

# Real registration numbers from the live release, so a reader can check any of
# these figures against the Board's own download.
PARTY_UNIT = "20010"  # HRCC, a caucus: files General Expenditure and none other.
CANDIDATE = "18466"  # Port, Lindsey Senate Committee: Campaign Expenditure and a loan.
POLITICAL_FUND = "41360"  # Alliance for a Better Minnesota State PAC.
# A committee that appears only as the target of someone else's independent
# spending. 283 of these carry a negative number the Board assigns internally,
# because they are local candidates the state does not register.
LOCAL_CANDIDATE = "-2139639405"

# `on=None` means "use the default date", so a deliberately dateless row needs its
# own marker. Every date in the live release is real; the column is nullable.
NO_DATE = "none"

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


def _snapshot(db, dataset: Dataset) -> models.CampaignFinanceSnapshot:
    marker = f"{dataset.value}-{uuid.uuid4()}"
    snapshot = models.CampaignFinanceSnapshot(
        dataset=dataset,
        download_id="-2113865252",
        source_url=f"https://cfb.mn.gov/reports/{dataset.value}.csv",
        content_hash=hashlib.sha256(marker.encode()).hexdigest(),
        record_set_hash=hashlib.sha256(f"records-{marker}".encode()).hexdigest(),
        byte_size=1024,
        status=SnapshotStatus.loaded,
    )
    db.add(snapshot)
    db.flush()
    return snapshot


class Published:
    """A published release plus the 3 snapshots behind it, for adding rows to."""

    def __init__(self, db):
        self.contributions = _snapshot(db, Dataset.contributions)
        self.expenditures = _snapshot(db, Dataset.expenditures)
        self.independent = _snapshot(db, Dataset.independent_expenditures)
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
        # The pointer row exists forever in production, but a freshly migrated test
        # database has none, so insert-or-update rather than update.
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
    reg_num,
    amount,
    receipt_type="Contribution",
    year=2025,
    on=None,
    name="Port, Lindsey Senate Committee",
    entity="PCC",
):
    db.add(
        models.CampaignFinanceContributionRow(
            snapshot_id=snapshot.id,
            row_number=_next_row(snapshot),
            recipient_reg_num=reg_num,
            recipient=name,
            recipient_type=entity,
            amount=None if amount is None else Decimal(amount),
            receipt_date=None if on == NO_DATE else (on or date(year, 6, 1)),
            year=year,
            contributor="A Donor",
            receipt_type=receipt_type,
            in_kind="No",
        )
    )
    db.flush()


def _payment(
    db,
    snapshot,
    *,
    reg_num,
    amount,
    kind="Campaign Expenditure",
    year=2025,
    on=None,
    unpaid="0",
    name="Port, Lindsey Senate Committee",
    entity="PCC",
    sub_type=None,
    affected=None,
):
    db.add(
        models.CampaignFinanceExpenditureRow(
            snapshot_id=snapshot.id,
            row_number=_next_row(snapshot),
            committee_reg_num=reg_num,
            committee_name=name,
            entity_type=entity,
            entity_sub_type=sub_type,
            vendor_name="A Vendor",
            amount=None if amount is None else Decimal(amount),
            unpaid_amount=None if unpaid is None else Decimal(unpaid),
            transaction_date=None if on == NO_DATE else (on or date(year, 6, 1)),
            year=year,
            type=kind,
            affected_committee_reg_num=affected,
        )
    )
    db.flush()


def _independent(
    db,
    snapshot,
    *,
    reg_num,
    amount,
    direction="For",
    year=2025,
    name="Fateh, Omar for Minneapolis  Mayor",
):
    db.add(
        models.CampaignFinanceIndependentExpenditureRow(
            snapshot_id=snapshot.id,
            row_number=_next_row(snapshot),
            spender="Some Independent Committee",
            spender_reg_num="41234",
            affected_committee_name=name,
            affected_committee_reg_num=reg_num,
            for_against=direction,
            year=year,
            transaction_date=date(year, 6, 1),
            amount=Decimal(amount),
        )
    )
    db.flush()


def _finance(db, reg_num, *, year=2025):
    release = current_release(db)
    assert release is not None
    return committee_finance(db, release, registration_number=reg_num, year=year)


# --- Our own gaps are never a committee's zero -------------------------------


def test_no_published_release_is_not_an_answer(db):
    """With nothing published we know nothing, and must not say a committee is empty."""
    assert current_release(db) is None


def test_a_release_whose_rows_are_gone_is_unusable(db):
    """A release id held across 2 publishes finds no rows. That is our staleness.

    The loader keeps one spare generation, so this is reachable in production by a
    request that resolved a release just before 2 publishes landed. Reporting it as
    a committee's figures would put our own pruning on a named organisation's page.
    """
    Published(db)
    release = current_release(db)
    assert release is not None
    assert release.is_usable is False
    assert release.loaded == frozenset()


def test_one_stale_dataset_does_not_blank_the_others(db):
    """Staleness is per download, because the 3 are pruned independently."""
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="5100.00")
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.money_in.state == REPORTED
    assert finance.money_out.state == UNAVAILABLE
    assert finance.money_out.itemized_payment_total is None


def test_a_committee_we_hold_no_rows_for_reads_not_reported(db):
    """Absence of itemized rows is silence, never a zero.

    The live case is Senator Omar Fateh's Senate committee (18488): its 2025 filing
    itemizes $2,300.00 that the bulk download does not carry, so a page reading
    absence as zero would print "$0 raised" over a real filing.
    """
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="5100.00")
    _payment(db, published.expenditures, reg_num=CANDIDATE, amount="4151.04")
    # Somebody else's 2024 rows, so 2024 is a year the download covers. Without them
    # the honest answer is "unavailable", because a download holding nothing at all
    # for a year says nothing about any committee in it.
    _receipt(db, published.contributions, reg_num=PARTY_UNIT, amount="1.00", year=2024)
    _payment(db, published.expenditures, reg_num=PARTY_UNIT, amount="1.00", year=2024)
    db.commit()
    finance = _finance(db, CANDIDATE, year=2024)
    assert finance is not None
    assert finance.money_in.state == NOT_REPORTED
    assert finance.money_in.itemized_contribution_total is None
    assert finance.money_out.state == NOT_REPORTED
    assert finance.money_out.itemized_payment_total is None


# --- Money in: the contribution filter, and what it must not hide ------------


def test_a_candidate_loan_is_not_a_contribution(db):
    """Only ``Receipt type = 'Contribution'`` reaches the contribution figure.

    Senator Lindsey Port's committee (18466) is the plain case in the live release:
    $5,100.00 of 2025 contributions beside a $5,000.00 row typed ``Miscellaneous``,
    which is a loan from the candidate to her own campaign. Counting it would nearly
    double her figure. 1.2% of rows in the file called "itemized contributions" are
    not contributions, and 6.57% for party units.
    """
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="5100.00")
    _receipt(
        db,
        published.contributions,
        reg_num=CANDIDATE,
        amount="5000.00",
        receipt_type="Miscellaneous",
    )
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.money_in.itemized_contribution_total == Decimal("5100.00")
    assert finance.money_in.itemized_contribution_payments == 1


def test_the_money_the_filter_removes_is_still_reported(db):
    """A loan is real money the filing carries. Filtering it out must not lose it."""
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="5100.00")
    _receipt(
        db,
        published.contributions,
        reg_num=CANDIDATE,
        amount="5000.00",
        receipt_type="Miscellaneous",
    )
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert [
        (receipt.receipt_type, receipt.total, receipt.payments)
        for receipt in finance.money_in.other_receipts
    ] == [("Miscellaneous", Decimal("5000.00"), 1)]


def test_receipts_that_are_all_loans_are_not_a_zero_contribution(db):
    """A committee-year with receipts but no contributions is still "not reported".

    218 committee-years in the live release hold receipts of which not one is a
    contribution. Deciding this state from "does this committee appear at all" would
    print $0 raised across every one of them.
    """
    published = Published(db)
    _receipt(
        db,
        published.contributions,
        reg_num=CANDIDATE,
        amount="5000.00",
        receipt_type="Loan Payable",
    )
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.money_in.state == NOT_REPORTED
    assert finance.money_in.itemized_contribution_total is None
    assert finance.money_in.other_receipts[0].total == Decimal("5000.00")


def test_an_unexpected_receipt_label_is_never_silently_a_contribution(db):
    """The Board owns this spelling, so a changed one must land somewhere visible.

    A label we do not recognise goes under its own name rather than into the
    contribution figure: the money stays on the page, mislabelled at worst, instead
    of quietly inflating the headline number.
    """
    published = Published(db)
    _receipt(
        db,
        published.contributions,
        reg_num=CANDIDATE,
        amount="700.00",
        receipt_type="Contribution Refund",
    )
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.money_in.state == NOT_REPORTED
    assert finance.money_in.other_receipts[0].receipt_type == "Contribution Refund"


def test_a_differently_cased_contribution_still_counts(db):
    """Case and stray spacing must not move real contributions out of the figure."""
    published = Published(db)
    _receipt(
        db,
        published.contributions,
        reg_num=CANDIDATE,
        amount="250.00",
        receipt_type=" CONTRIBUTION ",
    )
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.money_in.state == REPORTED
    assert finance.money_in.itemized_contribution_total == Decimal("250.00")


# --- Money out: both labels, and the total that is not the paid column -------


def test_a_party_unit_filing_only_general_expenditure_is_counted(db):
    """In 2025 party units filed 7,524 ``General Expenditure`` rows and few others.

    Filtering money out to ``Campaign Expenditure`` would report every caucus and
    party unit in Minnesota as having spent nothing.
    """
    published = Published(db)
    _payment(
        db,
        published.expenditures,
        reg_num=PARTY_UNIT,
        amount="725879.43",
        kind="General Expenditure",
        name="HRCC",
        entity="PTU",
        sub_type="CAU",
    )
    db.commit()
    finance = _finance(db, PARTY_UNIT)
    assert finance is not None
    assert finance.money_out.state == REPORTED
    assert finance.money_out.itemized_payment_total == Decimal("725879.43")


def test_a_candidate_filing_only_campaign_expenditure_is_counted(db):
    """The mirror case: in 2025 candidate committees filed 6,781 of these and 0 of
    the party unit's label. One filter cannot serve both, so there is no filter."""
    published = Published(db)
    _payment(
        db,
        published.expenditures,
        reg_num=CANDIDATE,
        amount="4151.04",
        kind="Campaign Expenditure",
    )
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.money_out.itemized_payment_total == Decimal("4151.04")


def test_every_expenditure_type_reaches_the_total_with_its_own_label(db):
    """6 labels exist and this layer never decides which of them count as spending."""
    published = Published(db)
    for kind, amount in (
        ("Campaign Expenditure", "4151.04"),
        ("Non-Campaign Disbursement", "237.80"),
        ("Contribution", "5000.00"),
    ):
        _payment(
            db, published.expenditures, reg_num=CANDIDATE, amount=amount, kind=kind
        )
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.money_out.itemized_payment_total == Decimal("9388.84")
    assert [entry.expenditure_type for entry in finance.money_out.by_type] == [
        "Campaign Expenditure",
        "Contribution",
        "Non-Campaign Disbursement",
    ]


def test_an_unpaid_bill_is_reported_beside_the_total_not_inside_it(db):
    """``Amount`` is the filing's total column and unpaid is a separate one.

    1,825 rows in the live release carry a non-zero unpaid amount. Subtracting it
    would report a figure the filing does not state; hiding it would drop the fact
    that some of the money has not left yet.
    """
    published = Published(db)
    _payment(
        db,
        published.expenditures,
        reg_num=CANDIDATE,
        amount="1000.00",
        unpaid="250.00",
    )
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.money_out.itemized_payment_total == Decimal("1000.00")
    assert finance.money_out.unpaid_total == Decimal("250.00")


# --- Which year, and which dates ---------------------------------------------


def test_the_files_own_year_column_decides_not_the_rows_date(db):
    """``Year`` and the row's date are separate claims that disagree on 702 rows.

    The filing is scoped by ``Year``, so a figure built from dates sums a different
    set than the total it will one day sit beside.
    """
    published = Published(db)
    _receipt(
        db,
        published.contributions,
        reg_num=CANDIDATE,
        amount="100.00",
        year=2025,
        on=date(2024, 12, 30),
    )
    _receipt(
        db,
        published.contributions,
        reg_num=CANDIDATE,
        amount="900.00",
        year=2024,
        on=date(2025, 1, 2),
    )
    db.commit()
    finance = _finance(db, CANDIDATE, year=2025)
    assert finance is not None
    assert finance.money_in.itemized_contribution_total == Decimal("100.00")
    assert finance.money_in.first_receipt_on == date(2024, 12, 30)


def test_the_dates_are_the_payments_we_hold_never_the_first_of_january(db):
    """Almost every report runs from 1 January and a special-election filer's does not.

    Filer 19223 reports from 11 July 2025. This layer states no reporting period at
    all -- only the first and last payment it holds -- so nothing downstream can
    inherit a hardcoded 1 January from here.
    """
    published = Published(db)
    _receipt(
        db,
        published.contributions,
        reg_num=CANDIDATE,
        amount="500.00",
        on=date(2025, 7, 11),
    )
    _receipt(
        db,
        published.contributions,
        reg_num=CANDIDATE,
        amount="500.00",
        on=date(2025, 11, 4),
    )
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.money_in.first_receipt_on == date(2025, 7, 11)
    assert finance.money_in.last_receipt_on == date(2025, 11, 4)


# --- Independent spending, reached without anyone confirming anything --------


def test_independent_spending_needs_no_confirmed_link(db):
    """The point of the whole issue: this figure resolves from a number alone.

    Nothing is written to ``legislator_campaign_committee`` here, which is the table
    holding 0 rows in production and gating 4 roadmap stages.
    """
    published = Published(db)
    _independent(db, published.independent, reg_num=LOCAL_CANDIDATE, amount="487974.82")
    _independent(
        db,
        published.independent,
        reg_num=LOCAL_CANDIDATE,
        amount="162841.95",
        direction="Against",
    )
    db.commit()
    finance = _finance(db, LOCAL_CANDIDATE)
    assert finance is not None
    assert finance.independent_spending.state == REPORTED
    assert finance.independent_spending.spending is not None
    assert finance.independent_spending.spending.supporting == Decimal("487974.82")
    assert finance.independent_spending.spending.opposing == Decimal("162841.95")


def test_no_independent_spending_about_a_committee_is_a_measured_zero(db):
    """Here absence really is a finding, unlike money in and money out.

    Nobody filed an independent expenditure over $200 about this committee. That is
    a fact about the file, where "we hold no contributions" is a fact about the $200
    threshold. The two states must not be collapsed.
    """
    published = Published(db)
    _independent(db, published.independent, reg_num="19999", amount="500.00")
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="5100.00")
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.independent_spending.state == REPORTED
    assert finance.independent_spending.spending is not None
    assert finance.independent_spending.spending.supporting == Decimal(0)
    assert finance.independent_spending.spending.opposing == Decimal(0)


def test_a_stale_independent_snapshot_is_not_a_zero(db):
    """Our own pruning may not be reported as "nobody spent anything about them"."""
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="5100.00")
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.independent_spending.state == UNAVAILABLE
    assert finance.independent_spending.spending is None


# --- Identity, and the money that must not travel between committees ---------


def test_a_committee_known_only_by_its_expenditures_is_found(db):
    """333 filers in the live release appear only in the expenditures download."""
    published = Published(db)
    _payment(
        db,
        published.expenditures,
        reg_num=POLITICAL_FUND,
        amount="3000.00",
        kind="General Expenditure",
        name="Alliance for a Better Minnesota State PAC",
        entity="PCF",
        sub_type="IEC",
    )
    db.commit()
    release = current_release(db)
    assert release is not None
    committee = find_committee(db, release, POLITICAL_FUND)
    assert committee is not None
    assert committee.name == "Alliance for a Better Minnesota State PAC"
    assert (committee.entity_type, committee.entity_sub_type) == ("PCF", "IEC")


def test_a_committee_known_only_from_someone_elses_spending_is_found(db):
    """341 committees appear only as the target of an independent expenditure.

    They have no state filings of their own, so their kind of filer is unknown
    rather than guessed, and their own money reads "not reported" rather than 0.
    """
    published = Published(db)
    _independent(db, published.independent, reg_num=LOCAL_CANDIDATE, amount="1000.00")
    # Somebody else's rows, so the 2 filer downloads are live rather than stale.
    # Without them this committee's own money would correctly read "unavailable",
    # which is a different answer and not the one production gives.
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="5100.00")
    _payment(db, published.expenditures, reg_num=CANDIDATE, amount="4151.04")
    db.commit()
    finance = _finance(db, LOCAL_CANDIDATE)
    assert finance is not None
    assert finance.committee.name == "Fateh, Omar for Minneapolis  Mayor"
    assert finance.committee.entity_type is None
    assert finance.money_in.state == NOT_REPORTED
    assert finance.money_out.state == NOT_REPORTED


def test_a_registration_number_we_hold_nothing_for_resolves_to_nothing(db):
    """Not "no such committee": the Board's directory decides that and we do not
    read it yet. The caller must phrase it as a gap in our records."""
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="5100.00")
    db.commit()
    assert _finance(db, "99999") is None


def test_a_transfer_out_is_never_the_receiving_committees_money_in(db):
    """Money out and money in are read from different filings, never joined.

    A party unit's outgoing row names the committee it paid, and treating that as
    the receiving committee's income would build the chain rule 12 forbids: whether
    those same dollars arrived is not a fact any filing establishes.
    """
    published = Published(db)
    _payment(
        db,
        published.expenditures,
        reg_num=PARTY_UNIT,
        amount="5000.00",
        kind="Contribution",
        name="HRCC",
        entity="PTU",
        sub_type="CAU",
        affected=CANDIDATE,
    )
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="100.00")
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.money_in.itemized_contribution_total == Decimal("100.00")
    assert finance.money_in.other_receipts == ()


# --- One release for the whole page ------------------------------------------


def test_every_dataset_is_read_from_the_release_the_request_resolved(db):
    """A publish landing mid-request must not pair new spending with old income.

    The release is resolved once and its 3 snapshot ids are passed to every read, so
    a newer release published afterwards cannot reach a figure on this page.
    """
    first = Published(db)
    _receipt(db, first.contributions, reg_num=CANDIDATE, amount="100.00")
    _payment(db, first.expenditures, reg_num=CANDIDATE, amount="50.00")
    db.commit()
    resolved = current_release(db)
    assert resolved is not None

    second = Published(db)
    _receipt(db, second.contributions, reg_num=CANDIDATE, amount="999999.00")
    _payment(db, second.expenditures, reg_num=CANDIDATE, amount="888888.00")
    db.commit()

    finance = committee_finance(db, resolved, registration_number=CANDIDATE, year=2025)
    assert finance is not None
    assert finance.release_id == first.release.id
    assert finance.money_in.itemized_contribution_total == Decimal("100.00")
    assert finance.money_out.itemized_payment_total == Decimal("50.00")


# --- The route's own decisions ------------------------------------------------


def test_the_route_refuses_rather_than_answering_from_a_stale_release(db, client):
    """503, not an empty page. We cannot answer, and that is a fact about us.

    A 404 here would say this committee does not exist, on the strength of our own
    pruning; a 200 with empty figures would say it has no money.
    """
    Published(db)
    response = client.get(
        f"/api/v1/committees/{CANDIDATE}/finance", params={"year": 2025}
    )
    assert response.status_code == 503


def test_the_route_says_404_about_our_records_not_about_minnesotas(db, client):
    """A number we hold nothing for is a gap in our copy, not a missing committee.

    The Board's registered-filer directory decides whether a committee exists and
    nothing here reads it yet, so the wording may not claim otherwise.
    """
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="5100.00")
    db.commit()
    response = client.get("/api/v1/committees/99999/finance", params={"year": 2025})
    assert response.status_code == 404
    assert "registration number" in response.json()["detail"]


def test_the_route_serves_both_traps_in_one_payload(db, client):
    """End to end: the loan stays out of the contribution figure and stays visible,
    and a party unit's only expenditure label still reaches its total."""
    published = Published(db)
    _receipt(
        db,
        published.contributions,
        reg_num=PARTY_UNIT,
        amount="1488168.08",
        name="HRCC",
        entity="PTU",
    )
    _receipt(
        db,
        published.contributions,
        reg_num=PARTY_UNIT,
        amount="382.59",
        receipt_type="Miscellaneous",
        name="HRCC",
        entity="PTU",
    )
    _payment(
        db,
        published.expenditures,
        reg_num=PARTY_UNIT,
        amount="725879.43",
        kind="General Expenditure",
        name="HRCC",
        entity="PTU",
        sub_type="CAU",
    )
    db.commit()
    response = client.get(
        f"/api/v1/committees/{PARTY_UNIT}/finance", params={"year": 2025}
    )
    assert response.status_code == 200, response.text
    body = response.json()["data"]
    assert body["committee_name"] == "HRCC"
    assert body["money_in"]["itemized_contribution_total"] == "1488168.0800"
    assert body["money_in"]["other_receipts"] == [
        {"receipt_type": "Miscellaneous", "total": "382.5900", "payments": 1}
    ]
    assert body["money_out"]["itemized_payment_total"] == "725879.4300"
    assert body["release_id"] == str(published.release.id)


def test_the_route_never_prints_a_zero_for_a_committee_we_hold_no_rows_for(db, client):
    """The launch-day shape of most committee-years, and the one rule 12 turns on."""
    published = Published(db)
    # This committee is known to us and its 2025 is empty, which is the real shape:
    # Senator Omar Fateh's Senate committee (18488) has rows for 2024 and 2026 and
    # none for 2025, against a 2025 filing that itemizes $2,300.00.
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="100.00", year=2024)
    _payment(db, published.expenditures, reg_num=CANDIDATE, amount="100.00", year=2024)
    # Another committee's 2025 rows, so 2025 is a year the downloads cover and this
    # committee's empty 2025 is silence about the committee rather than a gap of ours.
    _receipt(db, published.contributions, reg_num=PARTY_UNIT, amount="1.00")
    _payment(db, published.expenditures, reg_num=PARTY_UNIT, amount="1.00")
    _independent(db, published.independent, reg_num=PARTY_UNIT, amount="100.00")
    db.commit()
    body = client.get(
        f"/api/v1/committees/{CANDIDATE}/finance", params={"year": 2025}
    ).json()["data"]
    assert body["money_in"] == {
        "state": NOT_REPORTED,
        "itemized_contribution_total": None,
        "itemized_contribution_payments": None,
        "first_receipt_on": None,
        "last_receipt_on": None,
        "other_receipts": [],
        "source_url": "https://cfb.mn.gov/reports/contributions.csv",
    }
    assert body["money_out"]["itemized_payment_total"] is None
    # And the one block where absence is a finding rather than a gap.
    assert body["independent_spending"]["state"] == REPORTED
    assert Decimal(body["independent_spending"]["supporting"]) == 0


# --- Our own gaps, found by an adversarial review (Codex, 12 Aug 2026) -------


def test_a_year_the_download_does_not_reach_is_never_a_zero(db):
    """The route accepts years to 2100 and the files reach 2026. 2027 is months away.

    The independent-spending block is the dangerous one, because an empty answer
    there is a published finding: without a per-year check it reports "nobody spent
    anything about this committee" for a year nobody has filed for. Money in and money
    out must not read "not reported" either, which implies a year we cover.
    """
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="5100.00")
    _payment(db, published.expenditures, reg_num=CANDIDATE, amount="4151.04")
    _independent(db, published.independent, reg_num=CANDIDATE, amount="1000.00")
    db.commit()
    finance = _finance(db, CANDIDATE, year=2100)
    assert finance is not None
    assert finance.money_in.state == UNAVAILABLE
    assert finance.money_out.state == UNAVAILABLE
    assert finance.independent_spending.state == UNAVAILABLE
    assert finance.independent_spending.spending is None


def test_a_year_the_download_does_reach_still_reads_not_reported(db):
    """The other side of that check, so it cannot be over-applied.

    A year the file covers, where this committee simply never appears, is silence
    about the committee and must stay `not_reported` -- otherwise the $200 threshold's
    ordinary case starts reading as our own outage.
    """
    published = Published(db)
    _receipt(
        db, published.contributions, reg_num=PARTY_UNIT, amount="100.00", year=2024
    )
    _receipt(
        db, published.contributions, reg_num=CANDIDATE, amount="5100.00", year=2025
    )
    _payment(db, published.expenditures, reg_num=PARTY_UNIT, amount="100.00", year=2024)
    _payment(db, published.expenditures, reg_num=CANDIDATE, amount="1.00", year=2025)
    db.commit()
    finance = _finance(db, CANDIDATE, year=2024)
    assert finance is not None
    assert finance.money_in.state == NOT_REPORTED
    assert finance.money_out.state == NOT_REPORTED


def test_a_row_with_no_amount_withholds_the_figure_instead_of_inventing_zero(db):
    """`sum` skips a blank amount while `count(*)` still counts its row.

    So a group of blanks sums to 0 over a positive row count, which publishes an
    invented zero on a named organisation's page. Every row in the live release
    carries an amount; the column is nullable and the loader stores a blank as null,
    so one blank cell in a future download is enough.
    """
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount=None)
    _payment(db, published.expenditures, reg_num=CANDIDATE, amount=None)
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.money_in.state == NOT_REPORTED
    assert finance.money_in.itemized_contribution_total is None
    assert finance.money_out.state == NOT_REPORTED
    assert finance.money_out.itemized_payment_total is None


def test_one_blank_amount_beside_a_real_one_withholds_the_whole_figure(db):
    """An understated total published as complete is as wrong as an invented zero.

    The same treatment §7 gives a filer-year whose split fails its reconciliation: a
    figure we cannot fully compute is not published at all.
    """
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="5100.00")
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount=None)
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.money_in.state == NOT_REPORTED
    assert finance.money_in.itemized_contribution_total is None


def test_a_contribution_with_no_date_does_not_crash_the_request(db):
    """`min()` over an empty sequence raised, so one blank date returned HTTP 500.

    Money out already guarded this and money in did not. The honest answer is the
    total we do hold with no dates beside it, never an error page.
    """
    published = Published(db)
    _receipt(
        db, published.contributions, reg_num=CANDIDATE, amount="100.00", on=NO_DATE
    )
    db.commit()
    finance = _finance(db, CANDIDATE)
    assert finance is not None
    assert finance.money_in.state == REPORTED
    assert finance.money_in.itemized_contribution_total == Decimal("100.00")
    assert finance.money_in.first_receipt_on is None
    assert finance.money_in.last_receipt_on is None


def test_rows_pruned_mid_request_cannot_turn_a_figure_into_an_absence(db, client):
    """2 publishes inside one request take the named release's rows away halfway.

    Section H names this exact sequence and forbids rendering it as "this committee
    has no payments". The request reads one pinned instant of the database, so a
    publish landing after it starts is invisible to it.
    """
    first = Published(db)
    _receipt(db, first.contributions, reg_num=CANDIDATE, amount="100.00")
    _payment(db, first.expenditures, reg_num=CANDIDATE, amount="50.00")
    _independent(db, first.independent, reg_num=CANDIDATE, amount="25.00")
    db.commit()

    session = get_session_factory()()
    try:
        pin_to_one_view(session)
        release = current_release(session)
        assert release is not None
        assert money_in(
            session, release, registration_number=CANDIDATE, year=2025
        ).itemized_contribution_total == Decimal("100.00")

        # Two publishes land, and the second one prunes the release above.
        second = Published(db)
        _receipt(db, second.contributions, reg_num=CANDIDATE, amount="1.00")
        db.commit()
        third = Published(db)
        _receipt(db, third.contributions, reg_num=CANDIDATE, amount="2.00")
        db.commit()
        for table in ("cf_contribution_row", "cf_expenditure_row"):
            db.execute(
                text(f"DELETE FROM {table} WHERE snapshot_id = ANY(:ids)"),
                {"ids": [first.contributions.id, first.expenditures.id]},
            )
        db.commit()

        after = money_out(session, release, registration_number=CANDIDATE, year=2025)
        assert after.state == REPORTED
        assert after.itemized_payment_total == Decimal("50.00")
    finally:
        session.rollback()
        session.close()


def test_the_route_itself_runs_in_the_pinned_view(db):
    """The pin is invisible in the response, so this reads it from the database.

    Without this the route could quietly stop pinning and every test would still
    pass, because the difference only shows when a publish lands mid-request. The
    isolation level is read while the request's own transaction is still open.
    Verified against production's Supabase transaction pooler on 12 Aug 2026: the
    default is "read committed", the pin makes it "repeatable read", and the next
    transaction on that pooled connection is back to "read committed", so the setting
    cannot leak into another reader's request.
    """
    from fastapi.testclient import TestClient

    from alethical.api.main import create_app
    from alethical.db.session import get_db

    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="5100.00")
    db.commit()

    seen: list[str] = []
    session = get_session_factory()()

    def one_session():
        try:
            yield session
        finally:
            # Still inside the request's transaction, so this is the level the route's
            # own reads ran at.
            seen.append(session.scalar(text("SHOW transaction_isolation")))

    app = create_app()
    app.dependency_overrides[get_db] = one_session
    try:
        response = TestClient(app).get(
            f"/api/v1/committees/{CANDIDATE}/finance", params={"year": 2025}
        )
        assert response.status_code == 200, response.text
    finally:
        session.rollback()
        session.close()
    assert seen == ["repeatable read"]
