"""What the committees list and the money search must never claim.

Every test here stands in for a way these 2 endpoints could put a false sentence on the
money section. The 5 that matter most:

* **No closest-spelling match, ever.** 178 registered filer names sit a single character
  apart from another registered name, and every one of those pairs is a different
  organisation ([#1661](https://github.com/alethical-org/alethical/issues/1661)). A
  helpful correction would hand a reader one organisation's money under another's name.
* **A capped count is never served as a total.** A number in the largest type on the page
  is a fact about the whole set, and a count that stopped at 200 is not that fact
  (``.claude/rules/grounded-answers.md`` rule 11).
* **A count we cannot compute is ``null``, never 0.** "We hold no register" and
  "Minnesota registers nobody" are different facts and one of them is a claim about the
  state.
* **A person is a result only where we hold more than a filing.** Everybody else resolves
  to what they filed, because a page about a donor is a page about a *spelling*
  (``docs/architecture/campaign-finance-system-design.md`` §5).
* **The 2 expenditure files are never added.** 491 rows of the independent file share a
  spender, vendor, amount and date with an expenditures row, so one merged count would
  invent payments.

Fixtures are tiny and hand-written. Registration numbers and the counts quoted in
docstrings are from the live data measured on 18-19 Aug 2026 (#1661), evidence for the
test rather than something asserted here.

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from alethical.api.services.campaign_finance_register import (
    NO_FILINGS_SNAPSHOT,
    ROWS_REPLACED,
)
from alethical.api.services.campaign_finance_search import (
    COMMITTEES,
    COUNTED_UP_TO,
    GAVE,
    GOT_PAID,
    GOT_PAID_INDEPENDENT,
    NO_RELEASE,
    PEOPLE,
    QUERY_TOO_SHORT,
)
from alethical.api.services.committee_finance import NOT_REPORTED
from alethical.api.services.independent_spending import REPORTED, UNAVAILABLE
from alethical.db import models
from alethical.db.session import get_session_factory

Dataset = models.CampaignFinanceDataset
SnapshotStatus = models.CampaignFinanceSnapshotStatus
ReleaseStatus = models.CampaignFinanceReleaseStatus
FilerKind = models.CampaignFinanceFilerKind

COMMITTEES_URL = "/api/v1/campaign-finance/committees"
SEARCH_URL = "/api/v1/campaign-finance/search"
FILINGS_URL = "/api/v1/campaign-finance/filings"

# Real registration numbers from the live register.
CANDIDATE = "18466"  # Port, Lindsey Senate Committee.
PARTY_UNIT = "20010"  # HRCC, a legislative caucus.
FUND = "41363"  # 100 Percent Future Fund.

CF_TABLES = (
    "cf_contribution_row",
    "cf_expenditure_row",
    "cf_independent_expenditure_row",
    "cf_fetch_observation",
    "cf_snapshot_body",
)


def _clear(session) -> None:
    session.rollback()
    session.execute(text("UPDATE cf_filing_current SET snapshot_id = NULL"))
    session.execute(text("DELETE FROM cf_filing_report"))
    session.execute(text("DELETE FROM cf_filer"))
    session.execute(text("DELETE FROM cf_filing_snapshot"))
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


def _register(db, *, filer_count: int = 0):
    """One published register-and-catalogue run.

    ``filer_count`` is what the run recorded at publish time, which is what tells a
    pruned snapshot from one that was legitimately empty.
    """
    completed = datetime(2026, 8, 12, 21, 34, tzinfo=UTC)
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
    name: str,
    kind: FilerKind = FilerKind.candidate_committee,
    office: str | None = None,
    district: str | None = None,
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


def _download(db, dataset: Dataset, *, row_count: int = 0):
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
    """A published release plus the 3 download snapshots behind it."""

    def __init__(self, db):
        self.contributions = _download(db, Dataset.contributions)
        self.expenditures = _download(db, Dataset.expenditures)
        self.independent = _download(db, Dataset.independent_expenditures)
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


def _receipt(db, snapshot, *, contributor: str, employer: str | None = None) -> None:
    db.add(
        models.CampaignFinanceContributionRow(
            snapshot_id=snapshot.id,
            row_number=_next_row(snapshot),
            recipient_reg_num=CANDIDATE,
            recipient="Port, Lindsey Senate Committee",
            recipient_type="PCC",
            amount=Decimal("250"),
            receipt_date=date(2025, 6, 1),
            year=2025,
            contributor=contributor,
            contrib_type="Individual",
            contrib_employer_name=employer,
            receipt_type="Contribution",
            in_kind="No",
        )
    )
    db.commit()


def _payment(db, snapshot, *, vendor: str) -> None:
    db.add(
        models.CampaignFinanceExpenditureRow(
            snapshot_id=snapshot.id,
            row_number=_next_row(snapshot),
            committee_reg_num=CANDIDATE,
            committee_name="Port, Lindsey Senate Committee",
            entity_type="PCC",
            vendor_name=vendor,
            amount=Decimal("500"),
            unpaid_amount=Decimal("0"),
            transaction_date=date(2025, 6, 1),
            year=2025,
            type="Campaign Expenditure",
            purpose="Printing",
        )
    )
    db.commit()


def _independent_payment(db, snapshot, *, vendor: str) -> None:
    db.add(
        models.CampaignFinanceIndependentExpenditureRow(
            snapshot_id=snapshot.id,
            row_number=_next_row(snapshot),
            spender="MN DFL State Central Committee",
            spender_reg_num="20003",
            affected_committee_name="Port, Lindsey Senate Committee",
            affected_committee_reg_num=CANDIDATE,
            for_against="For",
            year=2025,
            transaction_date=date(2025, 6, 1),
            type="Independent Expenditure",
            amount=Decimal("1000"),
            vendor_name=vendor,
        )
    )
    db.commit()


def _a_sitting_legislator(db):
    """One member the legislator directory would list, from the seeded sample data."""
    session_id = db.scalar(
        select(models.LegislativeSession.id).where(
            models.LegislativeSession.is_current.is_(True)
        )
    )
    return db.scalar(
        select(models.Legislator)
        .join(
            models.LegislatorServicePeriod,
            models.LegislatorServicePeriod.legislator_id == models.Legislator.id,
        )
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


def _group(payload, kind):
    return next(group for group in payload["groups"] if group["kind"] == kind)


# --- The committees list -----------------------------------------------------


def test_the_register_lists_every_kind_alphabetically_with_no_amount(
    client, db
) -> None:
    """Screen A's list: name as filed, the register's kind, ordered A to Z.

    **No key anywhere in a row may be an amount.** Asserted over the row's whole key set
    rather than by naming the fields we did not add, because the failure this guards
    against is a field somebody adds later.
    """
    snapshot = _register(db, filer_count=3)
    _filer(db, snapshot, PARTY_UNIT, name="HRCC", kind=FilerKind.party_unit)
    _filer(
        db,
        snapshot,
        CANDIDATE,
        name="Port, Lindsey Senate Committee",
        office="Senate",
        district="56",
    )
    _filer(
        db,
        snapshot,
        FUND,
        name="100 Percent Future Fund",
        kind=FilerKind.political_committee_or_fund,
    )

    data = client.get(COMMITTEES_URL).json()["data"]

    assert data["state"] == REPORTED
    assert data["ordered_by"] == "name"
    assert [row["name"] for row in data["committees"]] == [
        "100 Percent Future Fund",
        "HRCC",
        "Port, Lindsey Senate Committee",
    ]
    assert set(data["committees"][0]) == {
        "registration_number",
        "name",
        "kind",
        "office",
        "district",
        "is_closed",
        "termination_date",
    }


def test_a_party_unit_carries_no_office_or_district_because_the_register_has_none(
    client, db
) -> None:
    """The design draws "Party unit - Ramsey County"; the register cannot support it.

    Measured on the live register: office, district and party are carried on the 778
    candidate rows and on **0** of the 299 party units and 526 funds (#1661). The
    geography lives inside the printed name, and reading it out of the name is a mapping
    a person confirms rather than a column, so this serves ``null`` rather than a guess.
    """
    snapshot = _register(db, filer_count=2)
    _filer(
        db, snapshot, PARTY_UNIT, name="Ramsey County DFL", kind=FilerKind.party_unit
    )
    _filer(
        db,
        snapshot,
        CANDIDATE,
        name="Port, Lindsey Senate Committee",
        office="Senate",
        district="56",
    )

    rows = {
        row["name"]: row
        for row in client.get(COMMITTEES_URL).json()["data"]["committees"]
    }

    assert rows["Ramsey County DFL"]["office"] is None
    assert rows["Ramsey County DFL"]["district"] is None
    assert rows["Port, Lindsey Senate Committee"]["office"] == "Senate"
    assert rows["Port, Lindsey Senate Committee"]["district"] == "56"


def test_a_closed_committee_ships_its_flag_beside_the_date_that_proves_it(
    client, db
) -> None:
    """13 of the live register's 1,603 filers are terminated (#1661)."""
    snapshot = _register(db, filer_count=2)
    _filer(
        db,
        snapshot,
        CANDIDATE,
        name="Novotny, Paul House Committee",
        terminated=date(2026, 7, 28),
    )
    _filer(db, snapshot, PARTY_UNIT, name="HRCC", kind=FilerKind.party_unit)

    rows = {
        row["name"]: row
        for row in client.get(COMMITTEES_URL).json()["data"]["committees"]
    }

    assert rows["Novotny, Paul House Committee"]["is_closed"] is True
    assert rows["Novotny, Paul House Committee"]["termination_date"] == "2026-07-28"
    assert rows["HRCC"]["is_closed"] is False
    assert rows["HRCC"]["termination_date"] is None


def test_the_filtered_total_and_the_register_total_are_both_served(client, db) -> None:
    """The lane says 1,603 while the filtered page says how many the filter holds.

    One total would make one of those 2 sentences false. ``by_kind`` stays unfiltered so
    the 3 filter chips do not relabel themselves when a filter is applied.
    """
    snapshot = _register(db, filer_count=3)
    _filer(db, snapshot, PARTY_UNIT, name="HRCC", kind=FilerKind.party_unit)
    _filer(db, snapshot, CANDIDATE, name="Port, Lindsey Senate Committee")
    _filer(db, snapshot, "18467", name="Another Senate Committee")

    data = client.get(COMMITTEES_URL, params={"kind": "party_unit"}).json()["data"]

    assert [row["name"] for row in data["committees"]] == ["HRCC"]
    assert data["page"]["total"] == 1
    assert data["register_total"] == 3
    assert data["by_kind"] == {
        "candidate_committee": 2,
        "party_unit": 1,
        "political_committee_or_fund": 0,
    }


def test_a_kind_the_register_does_not_hold_is_refused_rather_than_searched(
    client, db
) -> None:
    """3 kinds, because the Board's directory carries 3.

    Independent-expenditure committees, ballot-question committees and political funds
    all arrive on one list with no type marker (§9.7), so a finer filter would promise a
    distinction the source cannot make.
    """
    _register(db, filer_count=0)

    assert (
        client.get(
            COMMITTEES_URL, params={"kind": "ballot_question_committee"}
        ).status_code
        == 422
    )


def test_the_name_box_matches_what_was_typed_and_never_a_near_spelling(
    client, db
) -> None:
    """The single-character rule, on the register itself.

    178 registered names sit one character from another registered name and every one of
    those pairs is a different organisation (#1661). "Green" must never reach "Greene".
    """
    snapshot = _register(db, filer_count=3)
    _filer(
        db,
        snapshot,
        "20101",
        name="41st Senate District Green Party",
        kind=FilerKind.party_unit,
    )
    _filer(
        db,
        snapshot,
        "20102",
        name="41st Senate District Greene Party",
        kind=FilerKind.party_unit,
    )
    _filer(db, snapshot, CANDIDATE, name="Port, Lindsey Senate Committee")

    data = client.get(COMMITTEES_URL, params={"q": "Greene"}).json()["data"]

    assert [row["name"] for row in data["committees"]] == [
        "41st Senate District Greene Party"
    ]
    assert data["page"]["total"] == 1


def test_a_wildcard_in_the_query_is_searched_for_rather_than_matching_everything(
    client, db
) -> None:
    """A reader typing ``%`` is looking for that character, not for every filer."""
    snapshot = _register(db, filer_count=2)
    _filer(db, snapshot, CANDIDATE, name="Port, Lindsey Senate Committee")
    _filer(
        db, snapshot, PARTY_UNIT, name="100% Renewable PAC", kind=FilerKind.party_unit
    )

    data = client.get(COMMITTEES_URL, params={"q": "0%"}).json()["data"]

    assert [row["name"] for row in data["committees"]] == ["100% Renewable PAC"]


def test_no_register_loaded_is_null_and_never_a_count_of_zero(client, db) -> None:
    """ "We hold no register" and "Minnesota registers nobody" are different facts."""
    data = client.get(COMMITTEES_URL).json()["data"]

    assert data["state"] == UNAVAILABLE
    assert data["reason"] == NO_FILINGS_SNAPSHOT
    assert data["committees"] == []
    assert data["page"]["total"] is None
    assert data["register_total"] is None
    assert data["by_kind"] is None


def test_a_register_whose_rows_were_replaced_refuses_rather_than_listing_nothing(
    client, db
) -> None:
    """A snapshot that published 1,603 filers and holds none has been replaced."""
    _register(db, filer_count=1603)

    data = client.get(COMMITTEES_URL).json()["data"]

    assert data["state"] == UNAVAILABLE
    assert data["reason"] == ROWS_REPLACED
    assert data["page"]["total"] is None


def test_paging_the_register_reports_more_and_keeps_the_total_whole(client, db) -> None:
    """``page.total`` counts the filter, not the page, so it does not move with offset."""
    snapshot = _register(db, filer_count=3)
    for index, registration in enumerate((CANDIDATE, "18467", "18468")):
        _filer(db, snapshot, registration, name=f"Committee {index}")

    first = client.get(COMMITTEES_URL, params={"limit": 2}).json()["data"]
    second = client.get(COMMITTEES_URL, params={"limit": 2, "offset": 2}).json()["data"]

    assert len(first["committees"]) == 2
    assert first["page"]["has_more"] is True
    assert len(second["committees"]) == 1
    assert second["page"]["has_more"] is False
    assert first["page"]["total"] == second["page"]["total"] == 3


def test_the_committees_limit_is_capped_so_one_request_cannot_pull_the_register(
    client, db
) -> None:
    """1,603 filers; screen A draws 8."""
    assert client.get(COMMITTEES_URL, params={"limit": 500}).status_code == 422


# --- The name search ---------------------------------------------------------


def test_every_group_is_returned_even_when_it_is_empty(client, db) -> None:
    """A missing group must never be readable as "no matches"."""
    _register(db, filer_count=0)
    Published(db)

    data = client.get(SEARCH_URL, params={"q": "nobody"}).json()["data"]

    assert [group["kind"] for group in data["groups"]] == [
        PEOPLE,
        COMMITTEES,
        GAVE,
        GOT_PAID,
        GOT_PAID_INDEPENDENT,
    ]
    assert all(group["state"] == NOT_REPORTED for group in data["groups"])
    assert all(group["total"] == 0 for group in data["groups"])


def test_a_query_shorter_than_the_index_can_answer_says_so_rather_than_nothing_found(
    client, db
) -> None:
    """ "Type at least 3 characters" is true; "nothing found" would not be.

    The floor is the trigram index's: there is no whole trigram in a 2-character query,
    so the search would fall back to reading all 583,152 contribution rows (#1486).
    """
    _register(db, filer_count=0)
    Published(db)

    data = client.get(SEARCH_URL, params={"q": "ab"}).json()["data"]

    assert data["state"] == UNAVAILABLE
    assert data["reason"] == QUERY_TOO_SHORT
    assert data["min_query_length"] == 3
    assert all(group["results"] == [] for group in data["groups"])
    assert all(group["total"] is None for group in data["groups"])


def test_only_a_sitting_member_is_a_person_result(client, db) -> None:
    """Everybody else on a filing resolves to what they filed (§5).

    A page about a donor would be a page about a *spelling* that still reads as a page
    about a human being, so a person result is served only where we hold a profile.
    """
    _register(db, filer_count=0)
    published = Published(db)
    member = _a_sitting_legislator(db)
    assert member is not None
    _receipt(db, published.contributions, contributor=member.full_name)

    data = client.get(SEARCH_URL, params={"q": member.full_name}).json()["data"]

    people = _group(data, PEOPLE)
    matched = {row["slug"]: row for row in people["results"]}
    assert member.slug in matched
    assert matched[member.slug]["kind"] == "person"
    assert matched[member.slug]["full_name"] == member.full_name
    # The same string also matched a contribution, and that is a separate result about a
    # name rather than a second result about the person.
    assert _group(data, GAVE)["results"][0]["kind"] == "payment_name"


def test_a_name_result_carries_the_role_that_opens_its_payments(client, db) -> None:
    """``role`` is verbatim what ``/payments-under-name`` takes, so nothing is mapped."""
    _register(db, filer_count=0)
    published = Published(db)
    _receipt(db, published.contributions, contributor="Aguirre, Jose")
    _payment(db, published.expenditures, vendor="Aguirre Print & Mail")
    _independent_payment(db, published.independent, vendor="Aguirre Signs LLC")

    data = client.get(SEARCH_URL, params={"q": "aguirre"}).json()["data"]

    assert [
        (row["name"], row["role"])
        for kind in (GAVE, GOT_PAID, GOT_PAID_INDEPENDENT)
        for row in _group(data, kind)["results"]
    ] == [
        ("Aguirre, Jose", "contributor"),
        ("Aguirre Print & Mail", "vendor"),
        ("Aguirre Signs LLC", "independent_vendor"),
    ]


def test_the_two_expenditure_files_are_never_added_into_one_count(client, db) -> None:
    """491 rows of the independent file share a spender, vendor, amount and date with an
    expenditures row, so whether they are one payment filed twice is not established.

    One vendor name, in both files, comes back as 2 rows carrying 2 counts. A single row
    reading 3 payments would be a number nothing in the filings supports.
    """
    _register(db, filer_count=0)
    published = Published(db)
    _payment(db, published.expenditures, vendor="Northgate Digital")
    _payment(db, published.expenditures, vendor="Northgate Digital")
    _independent_payment(db, published.independent, vendor="Northgate Digital")

    data = client.get(SEARCH_URL, params={"q": "northgate"}).json()["data"]

    assert _group(data, GOT_PAID)["results"] == [
        {
            "kind": "payment_name",
            "name": "Northgate Digital",
            "role": "vendor",
            "payment_count": 2,
        }
    ]
    assert _group(data, GOT_PAID_INDEPENDENT)["results"] == [
        {
            "kind": "payment_name",
            "name": "Northgate Digital",
            "role": "independent_vendor",
            "payment_count": 1,
        }
    ]


def test_the_employer_column_is_not_searched_and_has_no_group(client, db) -> None:
    """Its 4 commonest live values are "Not Employed" (67,342 rows), "Retired" (36,517),
    "Self employed Retired" and "Lawyer" -- statuses, not names somebody can open.
    """
    _register(db, filer_count=0)
    published = Published(db)
    _receipt(db, published.contributions, contributor="A Donor", employer="Retired")

    data = client.get(SEARCH_URL, params={"q": "retired"}).json()["data"]

    assert [group["kind"] for group in data["groups"]] == [
        PEOPLE,
        COMMITTEES,
        GAVE,
        GOT_PAID,
        GOT_PAID_INDEPENDENT,
    ]
    assert all(group["results"] == [] for group in data["groups"])


def test_a_count_that_stopped_at_the_cap_is_never_served_as_a_total(client, db) -> None:
    """A capped number printed as a total is a fabricated fact (rule 11).

    Past the cap the total is ``null`` and ``at_least`` says how far the count got, which
    is a different sentence from "there are 200".
    """
    _register(db, filer_count=0)
    published = Published(db)
    for index in range(COUNTED_UP_TO + 2):
        _receipt(db, published.contributions, contributor=f"Anderson, Person {index}")

    data = client.get(SEARCH_URL, params={"q": "anderson"}).json()["data"]

    gave = _group(data, GAVE)
    assert gave["total"] is None
    assert gave["at_least"] == COUNTED_UP_TO
    assert gave["has_more"] is True


def test_a_count_inside_the_cap_is_exact(client, db) -> None:
    """The ordinary query, where an exact total is both cheap and true."""
    _register(db, filer_count=0)
    published = Published(db)
    for index in range(3):
        _receipt(db, published.contributions, contributor=f"Aguirre, Person {index}")
        _receipt(db, published.contributions, contributor=f"Aguirre, Person {index}")

    gave = _group(client.get(SEARCH_URL, params={"q": "aguirre"}).json()["data"], GAVE)

    assert gave["total"] == 3
    assert gave["at_least"] is None
    assert [row["payment_count"] for row in gave["results"]] == [2, 2, 2]


def test_no_release_empties_the_name_groups_without_blanking_the_register(
    client, db
) -> None:
    """One missing copy of the data must not blank the groups that do not read it.

    The register and the downloads are 2 separate runs, so a page holding a register and
    no release still lists committees.
    """
    snapshot = _register(db, filer_count=1)
    _filer(db, snapshot, CANDIDATE, name="Port, Lindsey Senate Committee")

    data = client.get(SEARCH_URL, params={"q": "port"}).json()["data"]

    assert data["state"] == REPORTED
    assert _group(data, COMMITTEES)["state"] == REPORTED
    assert _group(data, COMMITTEES)["results"][0]["kind"] == "committee"
    assert _group(data, COMMITTEES)["results"][0]["filer_kind"] == "candidate_committee"
    for kind in (GAVE, GOT_PAID, GOT_PAID_INDEPENDENT):
        assert _group(data, kind)["state"] == UNAVAILABLE
        assert _group(data, kind)["reason"] == NO_RELEASE
        assert _group(data, kind)["total"] is None


def test_the_search_never_suggests_a_near_spelling_of_a_name_on_a_filing(
    client, db
) -> None:
    """The rule that decides this whole surface, on the payment names.

    "Messinger, Alida" and "Messinger, Alida R" are 2 strings in the live release and
    nothing establishes they are one person. A search for the first returns the first.
    """
    _register(db, filer_count=0)
    published = Published(db)
    _receipt(db, published.contributions, contributor="Messinger, Alida R")
    _receipt(db, published.contributions, contributor="Messinger, Wiiiam Frey")

    gave = _group(
        client.get(SEARCH_URL, params={"q": "Messinger, William"}).json()["data"], GAVE
    )

    assert gave["results"] == []
    assert gave["total"] == 0
    assert gave["state"] == NOT_REPORTED


def test_the_search_says_what_it_matched_on(client, db) -> None:
    """Served rather than assumed, so a page can say in its own words that nothing was
    corrected."""
    _register(db, filer_count=0)
    Published(db)

    data = client.get(SEARCH_URL, params={"q": "anything"}).json()["data"]

    assert data["matched_on"] == "substring_of_the_filed_name"
    assert data["counted_up_to"] == COUNTED_UP_TO


def test_the_search_pins_both_copies_of_the_data_it_read(client, db) -> None:
    """The register and the downloads are 2 runs, so both are named."""
    snapshot = _register(db, filer_count=1)
    _filer(db, snapshot, CANDIDATE, name="Port, Lindsey Senate Committee")
    published = Published(db)

    data = client.get(SEARCH_URL, params={"q": "port"}).json()["data"]

    assert data["snapshot_id"] == str(snapshot.id)
    assert data["release_id"] == str(published.release.id)
    assert data["as_of"] == "2026-08-12"


def test_the_committees_group_agrees_with_the_list_it_links_to(client, db) -> None:
    """ "See all N committees" must open a list holding the same rows in the same order.

    Same matching rule and same query, so the group is the list's first page rather than
    a second answer that could disagree with it.
    """
    snapshot = _register(db, filer_count=3)
    for index, registration in enumerate(("20101", "20102", "20103")):
        _filer(
            db,
            snapshot,
            registration,
            name=f"{index}1st Senate District DFL",
            kind=FilerKind.party_unit,
        )

    grouped = _group(
        client.get(SEARCH_URL, params={"q": "senate district", "limit": 2}).json()[
            "data"
        ],
        COMMITTEES,
    )
    listed = client.get(
        COMMITTEES_URL, params={"q": "senate district", "limit": 2}
    ).json()["data"]

    assert [row["name"] for row in grouped["results"]] == [
        row["name"] for row in listed["committees"]
    ]
    assert grouped["total"] == listed["page"]["total"] == 3
    assert grouped["has_more"] is True


def test_no_search_result_anywhere_carries_an_amount(client, db) -> None:
    """Rule 12, over the whole answer rather than one group at a time."""
    snapshot = _register(db, filer_count=1)
    _filer(db, snapshot, CANDIDATE, name="Aguirre-Bell, Marisol Senate Committee")
    published = Published(db)
    _receipt(db, published.contributions, contributor="Aguirre, Jose")
    _payment(db, published.expenditures, vendor="Aguirre Print & Mail")

    data = client.get(SEARCH_URL, params={"q": "aguirre"}).json()["data"]

    money_words = {"amount", "total_amount", "dollars", "sum", "raised", "spent"}
    for group in data["groups"]:
        for row in group["results"]:
            assert not money_words & set(row), row
