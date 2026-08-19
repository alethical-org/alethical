"""What the committee page's two routes serve beyond the money blocks (#1442, phase 2).

The committee money page draws things the download release alone cannot say: the
register's own kind for the header, the termination date that makes a closed committee
its own display state, and the named/unnamed split whose 4 withheld states are each a
way a subtraction would state something false. These tests pin that the routes serve
them, and that the two sources stay independent -- a register gap never blanks the
money, and a money gap never denies a registered committee its page.

Display rules under test: `.claude/rules/grounded-answers.md` rule 12 and
`docs/architecture/campaign-finance-system-design.md` §7.

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import text

from alethical.db import models
from alethical.db.session import get_session_factory

Dataset = models.CampaignFinanceDataset
SnapshotStatus = models.CampaignFinanceSnapshotStatus
ReleaseStatus = models.CampaignFinanceReleaseStatus
FilerKind = models.CampaignFinanceFilerKind

#: Real numbers from the live data, so a reader can check the fixtures' shape.
CANDIDATE = "18472"  # Novotny, Paul House Committee -- terminated 28 Jul 2026.
NEIGHBOUR = "18334"  # Demuth, Lisa House Committee -- keeps the year "covered".


def _clear(session) -> None:
    session.rollback()
    session.execute(text("UPDATE cf_filing_current SET snapshot_id = NULL"))
    session.execute(text("DELETE FROM cf_filing_report"))
    session.execute(text("DELETE FROM cf_filer"))
    session.execute(text("DELETE FROM cf_filing_snapshot"))
    session.execute(text("UPDATE cf_current_release SET release_id = NULL"))
    session.execute(text("DELETE FROM cf_release"))
    for table in (
        "cf_contribution_row",
        "cf_expenditure_row",
        "cf_independent_expenditure_row",
    ):
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


def _snapshot(db, dataset: Dataset) -> models.CampaignFinanceSnapshot:
    marker = f"{dataset.value}-{uuid.uuid4()}"
    snapshot = models.CampaignFinanceSnapshot(
        dataset=dataset,
        download_id="-2113865252",
        source_url=f"https://cfb.mn.gov/reports/{dataset.value}.csv",
        content_hash=hashlib.sha256(marker.encode()).hexdigest(),
        record_set_hash=hashlib.sha256(f"records-{marker}".encode()).hexdigest(),
        byte_size=1024,
        row_count=0,
        status=SnapshotStatus.loaded,
    )
    db.add(snapshot)
    db.flush()
    return snapshot


class Published:
    """A published download release plus its 3 snapshots, for adding rows to."""

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


def _receipt(db, snapshot, *, reg_num, amount, on=None, year=2025, in_kind="No"):
    db.add(
        models.CampaignFinanceContributionRow(
            snapshot_id=snapshot.id,
            row_number=_next_row(snapshot),
            recipient_reg_num=reg_num,
            recipient="Novotny, Paul House Committee",
            recipient_type="PCC",
            amount=Decimal(amount),
            receipt_date=on or date(year, 6, 1),
            year=year,
            contributor="A Donor",
            receipt_type="Contribution",
            in_kind=in_kind,
        )
    )
    db.flush()


def _filings_snapshot(db, *, filer_count: int = 1):
    completed = datetime(2026, 8, 11, 6, 40, tzinfo=UTC)
    snapshot = models.CampaignFinanceFilingSnapshot(
        fetch_started_at=completed,
        fetch_completed_at=completed,
        status=SnapshotStatus.loaded,
        filer_count=filer_count,
        report_count=0,
    )
    db.add(snapshot)
    db.flush()
    db.execute(
        text(
            "INSERT INTO cf_filing_current (id, snapshot_id) VALUES (true, :sid) "
            "ON CONFLICT (id) DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id"
        ),
        {"sid": snapshot.id},
    )
    db.commit()
    return snapshot


def _filer(
    db,
    snapshot,
    registration: str,
    *,
    kind: FilerKind = FilerKind.candidate_committee,
    name: str = "Novotny, Paul House Committee",
    office: str | None = "House",
    district: str | None = "30B",
    terminated: date | None = None,
):
    db.add(
        models.CampaignFinanceFiler(
            snapshot_id=snapshot.id,
            registration_number=registration,
            kind=kind,
            name=name,
            office=office,
            district=district,
            termination_date=terminated,
            is_incumbent=False,
        )
    )
    db.commit()


# --- The register block on /finance -------------------------------------------


def test_the_register_entry_is_served_beside_the_money(db, client):
    """The header's facts come from the register, verbatim, with their own state.

    The kind is the register's own label (data census #1661: any kind shown anywhere
    is the register's string), and the termination date is what makes a closed
    committee its own display state (§7) -- Novotny's committee terminated 28 Jul
    2026 and its money routes read `not_reported` for 2026, which without this block
    is indistinguishable from a member who merely has not filed.
    """
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="250.00")
    db.commit()
    snapshot = _filings_snapshot(db)
    _filer(db, snapshot, CANDIDATE, terminated=date(2026, 7, 28))

    response = client.get(
        f"/api/v1/committees/{CANDIDATE}/finance", params={"year": 2026}
    )
    assert response.status_code == 200, response.text
    register = response.json()["data"]["register"]
    assert register["state"] == "reported"
    assert register["kind"] == "candidate_committee"
    assert register["name"] == "Novotny, Paul House Committee"
    assert register["office"] == "House"
    assert register["district"] == "30B"
    assert register["termination_date"] == "2026-07-28"
    assert register["as_of"] == "2026-08-11"


def test_no_register_is_a_fact_about_us_and_never_blanks_the_money(db, client):
    """With no filings snapshot the register block reads unavailable, money untouched."""
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="250.00")
    db.commit()

    response = client.get(
        f"/api/v1/committees/{CANDIDATE}/finance", params={"year": 2025}
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["register"]["state"] == "unavailable"
    assert data["register"]["reason"] == "no_filings_snapshot"
    assert data["money_in"]["state"] == "reported"
    assert data["money_in"]["itemized_contribution_total"] == "250.0000"


def test_a_register_listed_committee_with_no_money_rows_gets_its_page(db, client):
    """200 with each block saying what its absence means, never a 404.

    The register is the authority on whether a committee exists (§9.7), and 33
    committees and funds on census day (#1661) hold no money row in any download.
    Denying them a page would read our download's silence as nonexistence.
    """
    published = Published(db)
    # Another committee's row keeps 2025 "covered", so absence is the committee's
    # silence (`not_reported`) rather than our missing year.
    _receipt(db, published.contributions, reg_num=NEIGHBOUR, amount="10.00")
    db.commit()
    snapshot = _filings_snapshot(db)
    _filer(
        db,
        snapshot,
        "60083",
        kind=FilerKind.political_committee_or_fund,
        name="Vote Yes for Strong Schools",
        office=None,
        district=None,
    )

    response = client.get("/api/v1/committees/60083/finance", params={"year": 2025})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["committee_name"] == "Vote Yes for Strong Schools"
    assert data["register"]["state"] == "reported"
    assert data["register"]["kind"] == "political_committee_or_fund"
    assert data["money_in"]["state"] == "not_reported"
    assert data["money_in"]["itemized_contribution_total"] is None
    # And its payments answer the same way rather than 404ing.
    payments = client.get(
        "/api/v1/committees/60083/payments",
        params={"direction": "received", "year": 2025},
    )
    assert payments.status_code == 200, payments.text
    assert payments.json()["data"]["state"] == "not_reported"


def test_a_number_in_neither_place_is_404_about_our_records(db, client):
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="250.00")
    db.commit()
    snapshot = _filings_snapshot(db)
    _filer(db, snapshot, CANDIDATE)

    response = client.get("/api/v1/committees/99999/finance", params={"year": 2025})
    assert response.status_code == 404
    assert "register we hold" in response.json()["detail"]


# --- The split block on /finance ------------------------------------------------


def test_the_split_is_served_and_never_computed_by_a_page(db, client, monkeypatch):
    """Rule 12's division into named and unnamed money arrives decided, not derivable.

    The unnamed figure is reported total minus named *cash* (in-kind stays out of the
    subtraction because the Board's reported figure excludes it), and it exists only
    in the `shown` state. The page never subtracts (§7): 76 committee-years in the
    live release fail the reconciliation, and a client-side subtraction would render
    a negative dollar figure instead of a refusal.
    """
    from alethical.pipeline import campaign_finance_reader as reader

    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="5100.00")
    _receipt(
        db, published.contributions, reg_num=CANDIDATE, amount="250.00", in_kind="Yes"
    )
    db.commit()

    def one_real_total(db_, reg_num, years=None):
        return [
            reader.ReportedContributions(
                reg_num=reg_num,
                year=2025,
                total=Decimal("8600.00"),
                reported_through=date(2025, 12, 31),
                comparable=True,
            )
        ]

    monkeypatch.setattr(reader, "reported_contributions", one_real_total)
    response = client.get(
        f"/api/v1/committees/{CANDIDATE}/finance", params={"year": 2025}
    )
    assert response.status_code == 200, response.text
    split = response.json()["data"]["split"]
    assert split["state"] == "shown"
    assert split["reported_total"] == "8600.00"
    assert split["named_total"] == "5350.0000"
    assert split["named_cash_total"] == "5100.0000"
    assert split["named_in_kind_total"] == "250.0000"
    # 8600 reported minus 5100 named cash: the in-kind row stays out on purpose.
    assert Decimal(split["unnamed_total"]) == Decimal("3500.00")
    assert split["stated_split_state"] == "not_checked"


def test_a_total_covering_another_year_withholds_the_split(db, client, monkeypatch):
    """§7's coverage-end guard, served: a figure whose coverage end falls outside the
    year asked for is not a figure the page holds, so the split refuses rather than
    printing last year's money under this year's heading."""
    from alethical.pipeline import campaign_finance_reader as reader

    published = Published(db)
    _receipt(
        db,
        published.contributions,
        reg_num=CANDIDATE,
        amount="100.00",
        year=2026,
        on=date(2026, 2, 1),
    )
    db.commit()

    def an_earlier_years_answer(db_, reg_num, years=None):
        return [
            reader.ReportedContributions(
                reg_num=reg_num,
                year=2026,
                total=Decimal("9455.00"),
                reported_through=date(2025, 12, 31),
                comparable=True,
            )
        ]

    monkeypatch.setattr(reader, "reported_contributions", an_earlier_years_answer)
    response = client.get(
        f"/api/v1/committees/{CANDIDATE}/finance", params={"year": 2026}
    )
    assert response.status_code == 200, response.text
    split = response.json()["data"]["split"]
    assert split["state"] == "no_reported_total"
    assert split["reported_total"] is None
    assert split["reported_through"] is None
    assert split["named_total"] == "100.0000"


# --- Largest-first paging and the measured count on /payments -------------------


def test_amount_sort_pages_largest_first_and_counts_the_population(db, client):
    """`sort=amount` is the payments page's order: ranking inside one committee is a
    fact about that committee (§7), and `total_payments` is counted with the same
    filter as the rows so "Showing 2 of 3" can never describe a different population."""
    published = Published(db)
    _receipt(
        db,
        published.contributions,
        reg_num=CANDIDATE,
        amount="50.00",
        on=date(2025, 7, 1),
    )
    _receipt(
        db,
        published.contributions,
        reg_num=CANDIDATE,
        amount="900.00",
        on=date(2025, 1, 5),
    )
    _receipt(
        db,
        published.contributions,
        reg_num=CANDIDATE,
        amount="300.00",
        on=date(2025, 3, 3),
    )
    db.commit()

    response = client.get(
        f"/api/v1/committees/{CANDIDATE}/payments",
        params={"direction": "received", "year": 2025, "sort": "amount", "limit": 2},
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    amounts = [payment["amount"] for payment in data["payments"]]
    assert amounts == ["900.0000", "300.0000"]
    assert data["page"]["has_more"] is True
    assert data["page"]["total_payments"] == 3

    rest = client.get(
        f"/api/v1/committees/{CANDIDATE}/payments",
        params={
            "direction": "received",
            "year": 2025,
            "sort": "amount",
            "limit": 2,
            "offset": 2,
        },
    )
    assert [p["amount"] for p in rest.json()["data"]["payments"]] == ["50.0000"]
    assert rest.json()["data"]["page"]["has_more"] is False

    # The default order is unchanged: newest first by the row's own date.
    by_date = client.get(
        f"/api/v1/committees/{CANDIDATE}/payments",
        params={"direction": "received", "year": 2025},
    )
    assert [p["amount"] for p in by_date.json()["data"]["payments"]] == [
        "50.0000",
        "300.0000",
        "900.0000",
    ]


def test_an_empty_committee_year_serves_no_count(db, client):
    """`not_reported` is never a countable zero: the count is absent with the rows."""
    published = Published(db)
    _receipt(db, published.contributions, reg_num=NEIGHBOUR, amount="10.00")
    db.commit()

    response = client.get(
        f"/api/v1/committees/{NEIGHBOUR}/payments",
        params={"direction": "received", "year": 2025, "offset": 0},
    )
    assert response.json()["data"]["page"]["total_payments"] == 1
    empty_year = client.get(
        f"/api/v1/committees/{NEIGHBOUR}/payments",
        params={"direction": "made", "year": 2025},
    )
    assert empty_year.json()["data"]["state"] in {"not_reported", "unavailable"}
    assert empty_year.json()["data"]["page"]["total_payments"] is None


def test_a_page_past_the_last_row_still_serves_the_count(db, client):
    """Paging off the end of a real result is not silence: the state stays reported
    and the count still says how many rows exist, so a capped list's "show more"
    cannot turn the record's rows into an absence by walking past them."""
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="50.00")
    db.commit()

    response = client.get(
        f"/api/v1/committees/{CANDIDATE}/payments",
        params={"direction": "received", "year": 2025, "offset": 200},
    )
    data = response.json()["data"]
    assert data["state"] == "reported"
    assert data["payments"] == []
    assert data["page"]["total_payments"] == 1


def test_the_name_keyed_lookups_serve_no_count(db, client):
    """A count under a printed name is the number a page would print largest and
    trust most, about a key that is only a spelling -- deliberately absent."""
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="50.00")
    db.commit()

    response = client.get(
        "/api/v1/campaign-finance/payments-under-name",
        params={"name": "A Donor", "role": "contributor"},
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["state"] == "reported"
    assert data["page"]["total_payments"] is None


# --- Rule 12's second number for money out, and the printed period start ---------


def test_the_filings_own_spent_total_is_served_beside_the_itemized_sum(
    db, client, monkeypatch
):
    """Two numbers for money out, exactly as for money in: the filing's own
    "Total expenditures" figure beside the payments we can list, never added or
    subtracted (review of phase 2, 19 Aug 2026 — the ban was on labelling the
    itemized sum "spent", not on showing the filing's own total)."""
    from alethical.pipeline import campaign_finance_reader as reader

    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="100.00")
    db.commit()

    def one_real_total(db_, reg_num, years=None):
        return [
            reader.ReportedExpenditures(
                reg_num=reg_num,
                year=2025,
                total=Decimal("9508.24"),
                reported_through=date(2025, 12, 31),
                comparable=True,
            )
        ]

    monkeypatch.setattr(reader, "reported_expenditures", one_real_total)
    response = client.get(
        f"/api/v1/committees/{CANDIDATE}/finance", params={"year": 2025}
    )
    assert response.status_code == 200, response.text
    money_out = response.json()["data"]["money_out"]
    assert money_out["reported_total"] == "9508.24"
    assert money_out["reported_through"] == "2025-12-31"


def test_a_special_election_filers_spent_total_is_never_printed(
    db, client, monkeypatch
):
    """The same comparability rule as contributions: the totals copy cannot speak
    for a filer that filed 2 report series, so no figure reaches the page."""
    from alethical.pipeline import campaign_finance_reader as reader

    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="100.00")
    db.commit()

    def one_incomparable_total(db_, reg_num, years=None):
        return [
            reader.ReportedExpenditures(
                reg_num=reg_num,
                year=2025,
                total=Decimal("317.20"),
                reported_through=date(2025, 12, 31),
                comparable=False,
            )
        ]

    monkeypatch.setattr(reader, "reported_expenditures", one_incomparable_total)
    money_out = client.get(
        f"/api/v1/committees/{CANDIDATE}/finance", params={"year": 2025}
    ).json()["data"]["money_out"]
    assert money_out["reported_total"] is None
    assert money_out["reported_through"] is None


def test_the_period_start_is_the_boards_own_printed_one_or_absent(
    db, client, monkeypatch
):
    """Both ends of the period, each from the Board's own documents: the end off the
    filing, the start off the transcribed disclosure calendars — never an assumed
    1 January (§7). An end no calendar prints stays the covers-through state."""
    from alethical.pipeline import campaign_finance_reader as reader

    published = Published(db)
    _receipt(
        db,
        published.contributions,
        reg_num=CANDIDATE,
        amount="100.00",
        year=2026,
        on=date(2026, 2, 1),
    )
    db.commit()

    def totals_for(through):
        def totals(db_, reg_num, years=None):
            return [
                reader.ReportedContributions(
                    reg_num=reg_num,
                    year=2026,
                    total=Decimal("500.00"),
                    reported_through=through,
                    comparable=True,
                )
            ]

        return totals

    # The 2026 pre-primary end is printed against 1 Jan 2026 on the Board's calendar.
    monkeypatch.setattr(reader, "reported_contributions", totals_for(date(2026, 7, 20)))
    money_in = client.get(
        f"/api/v1/committees/{CANDIDATE}/finance", params={"year": 2026}
    ).json()["data"]["money_in"]
    assert money_in["reported_period_start"] == "2026-01-01"

    # An end the calendars do not print carries no start — covers-through, not Jan 1.
    monkeypatch.setattr(
        reader, "reported_contributions", totals_for(date(2026, 11, 16))
    )
    money_in = client.get(
        f"/api/v1/committees/{CANDIDATE}/finance", params={"year": 2026}
    ).json()["data"]["money_in"]
    assert money_in["reported_period_start"] is None
