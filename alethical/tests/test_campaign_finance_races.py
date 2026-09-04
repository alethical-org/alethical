"""What the Money by race read may never do ([#1954]).

``GET /campaign-finance/races`` groups every candidate committee by the office and
district it registered for. Three constraints are the whole design, and each test here
is written to fail on the **attempt** rather than on the harm:

* **No per-contest total, ever.** A contest carries a count of committees and no key
  anywhere in it is a sum. A person can hold 2 committees in 2 contests, and money moved
  between them is reported by both, so any figure added across committees counts it
  twice ([#1663]). Every amount leaves the service tagged with the committee that
  reported it, so adding 2 of them raises instead of answering.
* **Never ordered by amount.** Print no total and still sort biggest-first, and the page
  becomes the ranking ``.claude/rules/grounded-answers.md`` rule 12 forbids. The order is
  office, then district read as a person reads it, then the filed name A to Z; the
  response names that order, and no parameter changes it.
* **Every figure carries its own dates.** A committee's reported total carries the
  period its own filing states; its named-donations figure carries the dates of the
  payments we hold; a contest whose committees report over different periods says so.

Fixtures are tiny and hand-written. Registration numbers are shaped like the Board's but
the committees are invented, because the point is the shape of the response rather than
any real campaign's money. Needs the local Postgres on port 54329.

[#1954]: https://github.com/alethical-org/alethical/issues/1954
[#1663]: https://github.com/alethical-org/alethical/issues/1663
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import text

from alethical.api.services.campaign_finance_races import (
    ORDERED_BY_DISTRICT_THEN_NAME,
    contest_anchor,
    district_sort_key,
    races,
)
from alethical.api.services.committee_amount import CrossCommitteeTotal
from alethical.api.services.committee_finance import (
    NOT_REPORTED,
    REPORTED,
    current_release,
)
from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.pipeline.campaign_finance_filing_calendars import (
    printed_period_start_for_end,
)

Dataset = models.CampaignFinanceDataset
SnapshotStatus = models.CampaignFinanceSnapshotStatus
ReleaseStatus = models.CampaignFinanceReleaseStatus
FilerKind = models.CampaignFinanceFilerKind

URL = "/api/v1/campaign-finance/races"

# A period end the Board's 2026 disclosure calendars print, with a printed start.
PRE_PRIMARY_END = date(2026, 7, 20)
# A period end no transcribed calendar prints, so it carries no start.
ODD_END = date(2026, 6, 30)

# Words no key in a contest, or at the top level, may contain. Named words rather
# than a shape check, so adding a combined figure has to be a deliberate edit here.
BANNED_KEY_WORDS = ("total", "sum", "raised", "combined", "all_committees")


def _clear(session) -> None:
    session.rollback()
    session.execute(text("UPDATE cf_filing_current SET snapshot_id = NULL"))
    session.execute(text("DELETE FROM cf_filing_figure"))
    session.execute(text("DELETE FROM cf_filing"))
    session.execute(text("DELETE FROM cf_filing_report"))
    session.execute(text("DELETE FROM cf_filer"))
    session.execute(text("DELETE FROM cf_filing_snapshot"))
    session.execute(text("UPDATE cf_current_release SET release_id = NULL"))
    session.execute(text("DELETE FROM cf_release"))
    session.execute(text("DELETE FROM cf_contribution_row"))
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


def _register(db, *, filer_count: int):
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
    office: str | None,
    district: str | None,
    kind: FilerKind = FilerKind.candidate_committee,
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


def _reported(
    db, snapshot, registration: str, amount: str, *, through: date = PRE_PRIMARY_END
) -> None:
    """One year of a filer's own reported contribution total, ending ``through``."""
    filing = models.CampaignFinanceFiling(
        snapshot_id=snapshot.id,
        registration_number=registration,
        filer_kind=FilerKind.candidate_committee,
        filing_year=2026,
        segment_start=2026,
        segment_end=2027,
        block_heading="2026 - Election year",
        reported_through=through,
        response_hash=hashlib.sha256(f"{registration}-2026".encode()).hexdigest(),
        archive_line=1,
    )
    db.add(filing)
    db.flush()
    db.add(
        models.CampaignFinanceFilingFigure(
            filing_id=filing.id,
            line_key="individuals_contributions",
            label_as_served="Individuals contributions",
            amount=Decimal(amount),
        )
    )
    db.commit()


def _special_election(db, snapshot, registration: str) -> None:
    db.add(
        models.CampaignFinanceFilingReport(
            snapshot_id=snapshot.id,
            row_number=1,
            registration_number=registration,
            filing_year=2026,
            report_type="C",
            report_name="2026 Special Election Pre-Primary Report",
            cut_off_date=ODD_END,
            special_election=True,
            effective_amendment_index=0,
            amendment_count=1,
        )
    )
    db.commit()


class Published:
    """A published download release, with its contributions snapshot to hand."""

    def __init__(self, db):
        self.snapshots = {}
        for dataset in (
            Dataset.contributions,
            Dataset.expenditures,
            Dataset.independent_expenditures,
        ):
            marker = f"{dataset.value}-{uuid.uuid4()}"
            snapshot = models.CampaignFinanceSnapshot(
                dataset=dataset,
                download_id="-2113865252",
                source_url=f"https://cfb.mn.gov/reports/{dataset.value}.csv",
                content_hash=hashlib.sha256(marker.encode()).hexdigest(),
                record_set_hash=hashlib.sha256(
                    f"records-{marker}".encode()
                ).hexdigest(),
                byte_size=1024,
                row_count=0,
                status=SnapshotStatus.loaded,
            )
            db.add(snapshot)
            db.flush()
            self.snapshots[dataset] = snapshot
        release = models.CampaignFinanceRelease(
            contributions_snapshot_id=self.snapshots[Dataset.contributions].id,
            expenditures_snapshot_id=self.snapshots[Dataset.expenditures].id,
            independent_expenditures_snapshot_id=self.snapshots[
                Dataset.independent_expenditures
            ].id,
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
        self.contributions = self.snapshots[Dataset.contributions]
        self._rows = 0
        db.commit()

    def donation(
        self,
        db,
        registration: str,
        amount: str | None,
        on: date,
        *,
        receipt_type: str = "Contribution",
    ) -> None:
        self._rows += 1
        db.add(
            models.CampaignFinanceContributionRow(
                snapshot_id=self.contributions.id,
                row_number=self._rows,
                recipient_reg_num=registration,
                recipient="A Committee",
                recipient_type="PCC",
                amount=Decimal(amount) if amount is not None else None,
                receipt_date=on,
                year=on.year,
                contributor="A Donor",
                contrib_type="Individual",
                receipt_type=receipt_type,
                in_kind="No",
            )
        )
        db.commit()


# Invented committees. Names are chosen so that alphabetical order, register order and
# amount order are all different, which is what makes the ordering tests bite.
HOUSE_12A = (
    ("31890", "Neighbors for Chen"),
    ("31544", "Committee to Elect R. Lindqvist"),
    ("30622", "Friends of Dale Okafor"),
)
HOUSE_2B = ("30011", "Alvarez for House")
SENATE_41 = ("30412", "Aguirre-Bell, Marisol Senate Committee")
GOVERNOR = (("33502", "Baxter for Minnesota"), ("33420", "Anderson for Governor"))
PARTY_UNIT = ("20010", "HRCC")


def _a_ballot_of_contests(db):
    """3 House 12A committees, 1 in House 2B, 1 Senate seat, 2 for Governor, and a
    party unit that must not appear at all."""
    snapshot = _register(db, filer_count=8)
    for number, name in HOUSE_12A:
        _filer(db, snapshot, number, name=name, office="House", district="12A")
    _filer(db, snapshot, HOUSE_2B[0], name=HOUSE_2B[1], office="House", district="2B")
    _filer(
        db, snapshot, SENATE_41[0], name=SENATE_41[1], office="Senate", district="41"
    )
    for number, name in GOVERNOR:
        _filer(db, snapshot, number, name=name, office="Governor", district=None)
    _filer(
        db,
        snapshot,
        PARTY_UNIT[0],
        name=PARTY_UNIT[1],
        office=None,
        district=None,
        kind=FilerKind.party_unit,
    )
    return snapshot


def _walk(value, path=""):
    """Every key in a nested payload with the path it sits at."""
    if isinstance(value, dict):
        for key, child in value.items():
            yield f"{path}.{key}" if path else key, key
            yield from _walk(child, f"{path}.{key}" if path else key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _walk(child, f"{path}[{index}]")


# --- The 3 constraints ----------------------------------------------------------


def test_a_contest_carries_a_count_and_no_key_anywhere_is_a_sum(client, db) -> None:
    """The heading says "3 candidate committees"; nothing says what they add up to.

    Checked over every key in the whole response rather than by naming the fields we did
    not add, because the failure this guards against is a field somebody adds later.
    ``reported_total`` and ``named.total`` sit on a committee, which is the one place a
    total is that committee's own figure, so the walk stops at a committee.
    """
    snapshot = _a_ballot_of_contests(db)
    for number, _ in HOUSE_12A:
        _reported(db, snapshot, number, "1000.00")

    payload = client.get(URL, params={"year": 2026}).json()["data"]

    house_12a = next(c for c in payload["contests"] if c["anchor"] == "house-12a")
    assert house_12a["committee_count"] == 3
    assert house_12a["office"] == "House" and house_12a["district"] == "12A"
    assert payload["committee_count"] == 7
    assert payload["contest_count"] == 4

    outside_a_committee = {
        key: value for key, value in payload.items() if key != "contests"
    }
    for contest in payload["contests"]:
        for key, value in contest.items():
            if key != "committees":
                outside_a_committee[f"contest.{key}"] = value
    for path, key in _walk(outside_a_committee):
        for banned in BANNED_KEY_WORDS:
            assert banned not in key, (
                f"a cross-committee key containing {banned!r} appeared at {path}"
            )


def test_adding_two_committees_figures_raises_instead_of_answering(db) -> None:
    """The arithmetic somebody will one day write, made to fail the day it is written.

    A person can hold a House committee and a Senate committee at once, and money moved
    between them is a ``Contribution`` reported by both (#1663). So a sum across a
    contest, or across the whole list, is never a figure this product may print, and
    every amount the service hands out refuses to be added to another committee's.
    """
    snapshot = _a_ballot_of_contests(db)
    for number, _ in HOUSE_12A:
        _reported(db, snapshot, number, "1000.00")
    published = Published(db)
    for number, _ in HOUSE_12A:
        published.donation(db, number, "250.00", date(2026, 6, 1))

    page = races(db, year=2026, release=current_release(db))
    contest = next(c for c in page.contests if c.anchor == "house-12a")

    with pytest.raises(CrossCommitteeTotal):
        sum(c.reported_total for c in contest.committees)
    with pytest.raises(CrossCommitteeTotal):
        sum(c.named.total for c in contest.committees)
    # One committee's own figure is untouched: it still compares as a number.
    assert contest.committees[0].reported_total == Decimal("1000.00")


def test_the_order_is_district_then_name_and_never_amount(client, db) -> None:
    """The largest raiser sits wherever its name puts it.

    Amounts are arranged so that biggest-first would be the opposite of A to Z, and so
    that the register's own row order is a third order again. Districts read as a
    person reads them: 2B before 12A, not the string sort that puts "12A" first.
    """
    snapshot = _a_ballot_of_contests(db)
    _reported(db, snapshot, "31890", "84310.00")  # Neighbors for Chen, biggest
    _reported(db, snapshot, "31544", "61200.00")  # Committee to Elect R. Lindqvist
    _reported(db, snapshot, "30622", "12940.00")  # Friends of Dale Okafor, smallest

    payload = client.get(URL, params={"year": 2026}).json()["data"]

    assert payload["ordered_by"] == ORDERED_BY_DISTRICT_THEN_NAME
    assert [c["anchor"] for c in payload["contests"]] == [
        "house-2b",
        "house-12a",
        "senate-41",
        "governor",
    ]
    house_12a = next(c for c in payload["contests"] if c["anchor"] == "house-12a")
    assert [c["name"] for c in house_12a["committees"]] == [
        "Committee to Elect R. Lindqvist",
        "Friends of Dale Okafor",
        "Neighbors for Chen",
    ]
    amounts = [Decimal(c["reported_total"]) for c in house_12a["committees"]]
    assert amounts != sorted(amounts) and amounts != sorted(amounts, reverse=True)
    governor = payload["contests"][-1]
    assert governor["district"] is None
    assert [c["name"] for c in governor["committees"]] == [
        "Anderson for Governor",
        "Baxter for Minnesota",
    ]


def test_no_parameter_orders_the_list_by_amount(client, db) -> None:
    """Asking for an amount order changes nothing: the response is byte-identical.

    The endpoint declares no ``sort`` or ``order`` parameter, so any such request is
    ignored rather than honoured, and this pins that a future parameter cannot quietly
    add the ranking the rules forbid.
    """
    snapshot = _a_ballot_of_contests(db)
    for number, amount in zip(
        (n for n, _ in HOUSE_12A), ("84310.00", "61200.00", "12940.00"), strict=True
    ):
        _reported(db, snapshot, number, amount)

    plain = client.get(URL, params={"year": 2026}).text
    for extra in (
        {"sort": "amount"},
        {"order": "desc"},
        {"sort": "reported_total", "order": "desc"},
        {"order_by": "amount"},
    ):
        assert client.get(URL, params={"year": 2026, **extra}).text == plain


def test_every_figure_carries_its_own_dates(client, db) -> None:
    """A reported total carries the period its filing states; the named figure carries
    the dates of the payments we hold; and the 2 are never given each other's dates."""
    snapshot = _a_ballot_of_contests(db)
    _reported(db, snapshot, "31544", "61200.00")
    published = Published(db)
    published.donation(db, "31544", "250.00", date(2026, 2, 3))
    published.donation(db, "31544", "500.00", date(2026, 6, 15))
    # Not a Contribution, so it is neither counted nor dated into the named figure.
    published.donation(
        db, "31544", "100.00", date(2026, 7, 1), receipt_type="Miscellaneous"
    )

    payload = client.get(URL, params={"year": 2026}).json()["data"]
    house_12a = next(c for c in payload["contests"] if c["anchor"] == "house-12a")
    lindqvist = next(
        c for c in house_12a["committees"] if c["name"].endswith("Lindqvist")
    )

    assert Decimal(lindqvist["reported_total"]) == Decimal("61200.00")
    assert lindqvist["reported_through"] == PRE_PRIMARY_END.isoformat()
    start = printed_period_start_for_end(PRE_PRIMARY_END)
    assert start is not None
    assert lindqvist["reported_period_start"] == start.isoformat()
    named = lindqvist["named"]
    assert named["state"] == REPORTED
    assert Decimal(named["total"]) == Decimal("750.00")
    assert named["payments"] == 2
    assert named["first_payment_on"] == "2026-02-03"
    assert named["last_payment_on"] == "2026-06-15"
    assert payload["as_of"] == "2026-08-12"
    assert payload["release_id"] == str(published.release.id)


def test_a_contest_whose_figures_cover_different_periods_says_so(client, db) -> None:
    """One committee reports through the pre-primary cut-off and another through a
    different day: ``periods_differ`` is set on that contest and on no other."""
    snapshot = _a_ballot_of_contests(db)
    _reported(db, snapshot, "31544", "61200.00")
    _reported(db, snapshot, "31890", "84310.00", through=ODD_END)
    _reported(db, snapshot, GOVERNOR[0][0], "1000.00")
    _reported(db, snapshot, GOVERNOR[1][0], "2000.00")

    payload = client.get(URL, params={"year": 2026}).json()["data"]
    by_anchor = {c["anchor"]: c for c in payload["contests"]}

    assert by_anchor["house-12a"]["periods_differ"] is True
    assert by_anchor["governor"]["periods_differ"] is False
    # A contest with 1 dated figure and 1 missing figure is not a mixed-period
    # contest: there is only 1 period on it.
    assert by_anchor["house-2b"]["periods_differ"] is False
    chen = next(c for c in by_anchor["house-12a"]["committees"] if "Chen" in c["name"])
    assert chen["reported_through"] == ODD_END.isoformat()
    # No transcribed calendar prints ODD_END, so no start is asserted for it (§7).
    assert chen["reported_period_start"] is None


# --- Missing is not zero ---------------------------------------------------------


def test_a_committee_with_no_filing_reads_missing_never_zero(client, db) -> None:
    """Rule 12's oldest rule: a committee we hold no figure for is not a committee that
    reported nothing. Both figures are ``null`` and the download's silence is
    ``not_reported`` when the download covers the year, ``unavailable`` when it does
    not cover the year at all."""
    _a_ballot_of_contests(db)
    published = Published(db)
    published.donation(db, "31890", "250.00", date(2026, 6, 1))

    payload = client.get(URL, params={"year": 2026}).json()["data"]
    house_12a = next(c for c in payload["contests"] if c["anchor"] == "house-12a")
    okafor = next(c for c in house_12a["committees"] if "Okafor" in c["name"])

    assert okafor["reported_total"] is None
    assert okafor["reported_through"] is None
    assert okafor["named"]["state"] == NOT_REPORTED
    assert okafor["named"]["total"] is None
    assert okafor["named"]["payments"] is None

    # A year the download holds no row for at all: silence is unavailability.
    last_year = client.get(URL, params={"year": 2025}).json()["data"]
    house_12a = next(c for c in last_year["contests"] if c["anchor"] == "house-12a")
    assert {c["named"]["state"] for c in house_12a["committees"]} == {"unavailable"}


def test_a_row_we_cannot_add_up_is_unavailable_not_a_smaller_figure(client, db) -> None:
    """A contribution row with no amount is a gap in our copy. The committee's named
    figure is withheld rather than summed short (#1442)."""
    _a_ballot_of_contests(db)
    published = Published(db)
    published.donation(db, "31890", "250.00", date(2026, 6, 1))
    published.donation(db, "31890", None, date(2026, 6, 2))

    payload = client.get(URL, params={"year": 2026}).json()["data"]
    house_12a = next(c for c in payload["contests"] if c["anchor"] == "house-12a")
    chen = next(c for c in house_12a["committees"] if "Chen" in c["name"])
    assert chen["named"] == {
        "state": "unavailable",
        "total": None,
        "payments": None,
        "first_payment_on": None,
        "last_payment_on": None,
    }


def test_a_reported_total_from_another_year_or_a_special_series_is_withheld(
    client, db
) -> None:
    """§7's 2 guards on the reported total: a filing whose period ends outside the year
    asked for is last year's money, and a special-election filer-year's regular series
    is not the year either. Both read "Not reported" rather than a figure."""
    snapshot = _a_ballot_of_contests(db)
    # Ends in 2025: never served under 2026.
    _reported(db, snapshot, "31544", "999.00", through=date(2025, 12, 31))
    # A real 2026 filing, but the filer also ran a 2026 special election.
    _reported(db, snapshot, "31890", "5000.00")
    _special_election(db, snapshot, "31890")

    payload = client.get(URL, params={"year": 2026}).json()["data"]
    house_12a = next(c for c in payload["contests"] if c["anchor"] == "house-12a")
    by_name = {c["name"]: c for c in house_12a["committees"]}
    assert by_name["Committee to Elect R. Lindqvist"]["reported_total"] is None
    assert by_name["Neighbors for Chen"]["reported_total"] is None


# --- The filter, the register's states, and the pure helpers ---------------------


def test_office_narrows_the_contests_and_offices_stay_unfiltered(client, db) -> None:
    """The chips label themselves from ``offices``, which counts the whole register
    whatever filter is applied, so a chip's count never looks like the filter found
    fewer than exist. A party unit is on none of them."""
    _a_ballot_of_contests(db)

    payload = client.get(URL, params={"year": 2026, "office": "Senate"}).json()["data"]

    assert payload["office"] == "Senate"
    assert [c["anchor"] for c in payload["contests"]] == ["senate-41"]
    assert payload["offices"] == [
        {"office": "House", "committee_count": 4},
        {"office": "Senate", "committee_count": 1},
        {"office": "Governor", "committee_count": 2},
    ]
    # The whole register's candidate count, not the filter's.
    assert payload["committee_count"] == 7

    nobody = client.get(URL, params={"year": 2026, "office": "Mayor"}).json()["data"]
    assert nobody["contests"] == [] and nobody["state"] == "reported"


def test_a_closed_committee_stays_in_its_contest_with_its_date(client, db) -> None:
    snapshot = _register(db, filer_count=1)
    _filer(
        db,
        snapshot,
        "30011",
        name="Alvarez for House",
        office="House",
        district="2B",
        terminated=date(2026, 3, 1),
    )
    payload = client.get(URL, params={"year": 2026}).json()["data"]
    row = payload["contests"][0]["committees"][0]
    assert row["is_closed"] is True and row["termination_date"] == "2026-03-01"


def test_no_register_refuses_rather_than_listing_nobody(client, db) -> None:
    """No filings snapshot published: the state says so and the list is empty, which is
    a fact about our copy and never a claim that Minnesota registers no candidates."""
    payload = client.get(URL, params={"year": 2026}).json()["data"]
    assert payload["state"] == "unavailable"
    assert payload["contests"] == [] and payload["offices"] == []
    assert payload["committee_count"] is None and payload["contest_count"] is None
    assert payload["reason"]


def test_a_register_replaced_under_the_read_refuses_too(client, db) -> None:
    _register(db, filer_count=778)
    payload = client.get(URL, params={"year": 2026}).json()["data"]
    assert payload["state"] == "unavailable"
    assert payload["contests"] == []


def test_the_list_still_answers_when_no_download_release_is_held(client, db) -> None:
    """The register and the downloads are different runs. With no release the contests
    and reported totals still come back; only the named figures go absent, as
    ``unavailable`` and never as a zero."""
    snapshot = _a_ballot_of_contests(db)
    _reported(db, snapshot, "31544", "61200.00")

    payload = client.get(URL, params={"year": 2026}).json()["data"]
    assert payload["release_id"] is None
    house_12a = next(c for c in payload["contests"] if c["anchor"] == "house-12a")
    lindqvist = next(c for c in house_12a["committees"] if "Lindqvist" in c["name"])
    assert Decimal(lindqvist["reported_total"]) == Decimal("61200.00")
    assert {c["named"]["state"] for c in house_12a["committees"]} == {"unavailable"}


def test_year_is_required_and_bounded(client) -> None:
    assert client.get(URL).status_code == 422
    assert client.get(URL, params={"year": 1999}).status_code == 422


def test_districts_sort_as_a_person_reads_them() -> None:
    districts = ["12A", "2B", "10", "67", "Chief", "2-14", "2-3", None, "12B"]
    assert sorted(districts, key=district_sort_key) == [
        None,
        "2-3",
        "2-14",
        "2B",
        "10",
        "12A",
        "12B",
        "67",
        "Chief",
    ]


def test_anchors_are_stable_slugs() -> None:
    assert contest_anchor("House", "12A") == "house-12a"
    assert contest_anchor("Senate", "41") == "senate-41"
    assert contest_anchor("Governor", None) == "governor"
    assert contest_anchor("District Court", "2-14") == "district-court-2-14"
    assert contest_anchor("Supreme Court", "Chief") == "supreme-court-chief"
