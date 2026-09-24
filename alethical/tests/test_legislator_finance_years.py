"""The year buttons' one request says exactly what the 11 per-year requests said.

Net: ``GET /legislators/{id}/campaign-finance/years?from=&to=`` colours a member's year
buttons in 1 request where the tab used to read the whole per-year answer once per year.
That is only safe if, for every year, it names the same committees and the same
``split.state`` and ``split.reported_total`` the per-year route names, because a button
coloured from a different rule would send a reader to a year that then reads differently
(``.claude/rules/grounded-answers.md`` rule 12).

So the test here is equality against the per-year route itself, year by year, over a
fixture built to reach as many of the split's states as one member can: a committee held
in every year, one whose reviewed period covers only 2 of them, one the release holds no
record of, and one for a race that never belongs on a legislative profile. Years the
downloads do not reach, a year whose filing covers a different year, a year whose payments
run past its own report, a year with a filing and no named row, and a year whose filing
disagrees with our copy are all in the span.

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
from alethical.tests.filed_figures import (
    clear_filings_snapshots,
    pair_release_with_filings,
    publish_filings_snapshot,
)

Dataset = models.CampaignFinanceDataset
SnapshotStatus = models.CampaignFinanceSnapshotStatus
ReleaseStatus = models.CampaignFinanceReleaseStatus
Decision = models.CommitteeLinkReviewDecision

#: Held in every year of the span, with rows in 2024, 2025 and 2026.
SENATE = "18466"
#: Reviewed as covering 2025 and 2026 only, with no contribution row in either.
HOUSE = "18129"
#: Confirmed, and nowhere in the release's 3 files.
UNHELD = "99999"
#: Confirmed for a run at Governor, which never reaches a legislative profile.
GOVERNOR = "77777"

SPAN = list(range(2015, 2027))
SHORT_WINDOW = "public, max-age=60, stale-while-revalidate=300"

CF_TABLES = (
    "cf_stated_split",
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


def _snapshot(db, dataset: Dataset):
    marker = f"{dataset.value}-{uuid.uuid4()}"
    snapshot = models.CampaignFinanceSnapshot(
        dataset=dataset,
        download_id="-1811203041",
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


def _receipt(db, snapshot_id, *, row_number, year, on, amount, in_kind="No"):
    db.add(
        models.CampaignFinanceContributionRow(
            snapshot_id=snapshot_id,
            row_number=row_number,
            recipient="Port, Lindsey Senate Committee",
            recipient_reg_num=SENATE,
            recipient_type="PCC",
            contributor="Giver, Ada",
            contrib_type="I",
            receipt_type="Contribution",
            year=year,
            receipt_date=on,
            amount=Decimal(amount),
            in_kind=in_kind,
        )
    )


@pytest.fixture()
def member(db) -> str:
    """A member with 4 confirmed committees and a release built to reach 6 split states."""
    contributions = _snapshot(db, Dataset.contributions)
    expenditures = _snapshot(db, Dataset.expenditures)
    independent = _snapshot(db, Dataset.independent_expenditures)
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
    # 2024: 1 cash row under an $8,600 filing covering 2024, so the split is shown.
    _receipt(
        db,
        contributions.id,
        row_number=1,
        year=2024,
        on=date(2024, 3, 1),
        amount="250.00",
    )
    # 2025: cash and goods, under a filing whose coverage ends in 2026, so the filing's
    # figure is refused and the named payments stand alone.
    _receipt(
        db,
        contributions.id,
        row_number=2,
        year=2025,
        on=date(2025, 2, 1),
        amount="300.00",
    )
    _receipt(
        db,
        contributions.id,
        row_number=3,
        year=2025,
        on=date(2025, 5, 1),
        amount="100.00",
        in_kind="Yes",
    )
    # 2026: a payment dated after the filing's coverage end, so the periods differ.
    _receipt(
        db,
        contributions.id,
        row_number=4,
        year=2026,
        on=date(2026, 3, 1),
        amount="250.00",
    )
    _receipt(
        db,
        contributions.id,
        row_number=5,
        year=2026,
        on=date(2026, 8, 1),
        amount="75.00",
    )
    # The bounded committee is held by the release through 1 payment it made, so its
    # empty contribution years are its silence rather than our records lacking it.
    db.add(
        models.CampaignFinanceExpenditureRow(
            snapshot_id=expenditures.id,
            row_number=1,
            committee_reg_num=HOUSE,
            committee_name="Stephenson, Zachary House Committee",
            entity_type="PCC",
            vendor_name="A Vendor",
            amount=Decimal("40.00"),
            unpaid_amount=Decimal("0"),
            transaction_date=date(2024, 6, 1),
            year=2024,
            type="Campaign Expenditure",
        )
    )
    db.commit()

    filings_id = publish_filings_snapshot(
        db,
        filings=[
            (
                SENATE,
                2024,
                "individuals_contributions",
                Decimal("8600.00"),
                date(2024, 12, 31),
            ),
            (
                SENATE,
                2025,
                "individuals_contributions",
                Decimal("900.00"),
                date(2026, 1, 31),
            ),
            (
                SENATE,
                2026,
                "individuals_contributions",
                Decimal("8600.00"),
                date(2026, 7, 20),
            ),
            # A filing that reports money for a committee we hold no named row of.
            (
                HOUSE,
                2025,
                "individuals_contributions",
                Decimal("1500.00"),
                date(2025, 12, 31),
            ),
        ],
    )
    # The committee's own 2026 filing names donors and our copy holds no row of it.
    db.add(
        models.CampaignFinanceStatedSplit(
            snapshot_id=contributions.id,
            registration_number=HOUSE,
            filing_year=2026,
            filings_snapshot_id=filings_id,
            status=models.CampaignFinanceStatedSplitStatus.disagrees,
            reason="the filing itemizes $2,300.00 and our rows hold none of it",
            checked_at=datetime(2026, 8, 13, 12, 0, tzinfo=UTC),
        )
    )
    # A register row for the held committee, so the register-kind lookups have a row
    # to find; nothing here turns on it.
    db.add(
        models.CampaignFinanceFiler(
            snapshot_id=filings_id,
            registration_number=SENATE,
            kind=models.CampaignFinanceFilerKind.candidate_committee,
            name="Port, Lindsey Senate Committee",
            office="Senate",
            district="41",
            is_incumbent=True,
        )
    )
    legislator_id, slug = db.execute(
        text("SELECT id, slug FROM legislator ORDER BY slug LIMIT 1")
    ).one()
    for number, name, office, first, last in (
        (SENATE, "Port, Lindsey Senate Committee", "Senate", None, None),
        (HOUSE, "Stephenson, Zachary House Committee", "House", "2025", "2026"),
        (UNHELD, "A committee the release does not hold", "House", None, None),
        (GOVERNOR, "Port, Lindsey for Governor", "Gov", None, None),
    ):
        db.add(
            models.LegislatorCampaignCommittee(
                legislator_id=legislator_id,
                registration_number=number,
                decision=Decision.confirmed,
                committee_name_as_reviewed=name,
                office_as_reviewed=office,
                first_year_as_reviewed=first,
                last_year_as_reviewed=last,
                reviewed_by="a person",
            )
        )
    db.commit()
    return slug


def _year_states(payload: dict) -> tuple[str, dict[str, tuple[str, str | None]]]:
    return (
        payload["link_state"],
        {
            committee["registration_number"]: (
                committee["split"]["state"],
                committee["split"]["reported_total"],
            )
            for committee in payload["committees"]
        },
    )


def test_every_year_of_the_span_says_what_the_per_year_route_says(client, member):
    """Same committees, same ``split.state``, same ``split.reported_total``, every year.

    The span route reads each dataset once for all 12 years and folds each
    committee-year through the per-year route's own functions, and this is what proves
    that the folding, not only the reading, matches: a state reached on one route and
    not the other fails here by name.
    """
    span = client.get(
        f"/api/v1/legislators/{member}/campaign-finance/years",
        params={"from": SPAN[0], "to": SPAN[-1]},
    )
    assert span.status_code == 200, span.text
    data = span.json()["data"]
    assert [entry["year"] for entry in data["years"]] == SPAN
    by_year = {entry["year"]: entry for entry in data["years"]}

    states_reached: set[str] = set()
    for year in SPAN:
        single = client.get(
            f"/api/v1/legislators/{member}/campaign-finance", params={"year": year}
        )
        assert single.status_code == 200, (year, single.text)
        expected = _year_states(single.json()["data"])
        got = _year_states({**by_year[year], "link_state": data["link_state"]})
        assert got == expected, year
        states_reached.update(state for state, _ in expected[1].values())

    # The fixture reaches what it claims to, so the equality above is worth having.
    assert data["link_state"] == "confirmed"
    assert set(by_year[2024]["committees"][0]["split"]) == {"state", "reported_total"}
    assert _year_states({**by_year[2024], "link_state": "confirmed"})[1] == {
        SENATE: ("shown", "8600.0000"),
        UNHELD: ("no_reported_total", None),
    }
    assert _year_states({**by_year[2025], "link_state": "confirmed"})[1] == {
        SENATE: ("no_reported_total", None),
        HOUSE: ("no_named_payments", "1500.0000"),
        UNHELD: ("no_reported_total", None),
    }
    assert _year_states({**by_year[2026], "link_state": "confirmed"})[1] == {
        SENATE: ("periods_differ", "8600.0000"),
        HOUSE: ("named_payments_not_in_our_copy", None),
        UNHELD: ("no_reported_total", None),
    }
    # A year the downloads do not reach: the held committee is listed with no figure,
    # the bounded one is not listed at all, and the Governor run is nowhere.
    assert _year_states({**by_year[2015], "link_state": "confirmed"})[1] == {
        SENATE: ("no_reported_total", None),
        UNHELD: ("no_reported_total", None),
    }
    assert GOVERNOR not in {
        committee["registration_number"]
        for entry in data["years"]
        for committee in entry["committees"]
    }
    assert states_reached == {
        "shown",
        "no_reported_total",
        "no_named_payments",
        "periods_differ",
        "named_payments_not_in_our_copy",
    }


def test_the_span_answer_is_a_current_claim_and_says_when_it_checked(client, member):
    """``link_state`` is whose committee this is right now, so the answer keeps the
    short window and carries the moment it confirmed the claim, as the per-year route
    does (issue 2023)."""
    response = client.get(
        f"/api/v1/legislators/{member}/campaign-finance/years",
        params={"from": 2024, "to": 2026},
    )
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == SHORT_WINDOW
    data = response.json()["data"]
    assert data["current_claim_validated_at"]
    assert data["release_id"] and data["fetched_at"]
    assert [entry["year"] for entry in data["years"]] == [2024, 2025, 2026]


def test_a_span_is_inclusive_ordered_and_bounded(client, member):
    """``from`` may not pass ``to``, the span stops at 20 years, an unknown member is 404."""
    assert (
        client.get(
            f"/api/v1/legislators/{member}/campaign-finance/years",
            params={"from": 2026, "to": 2025},
        ).status_code
        == 422
    )
    assert (
        client.get(
            f"/api/v1/legislators/{member}/campaign-finance/years",
            params={"from": 2015, "to": 2035},
        ).status_code
        == 422
    )
    assert (
        client.get(
            f"/api/v1/legislators/{member}/campaign-finance/years",
            params={"from": 2015, "to": 2034},
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/api/v1/legislators/nobody-by-this-name/campaign-finance/years",
            params={"from": 2024, "to": 2026},
        ).status_code
        == 404
    )


def _split_states(client, member: str, year: int) -> dict[str, str]:
    """``split.state`` per committee, from the per-year route and the span route, after
    asserting the 2 agree -- which is the property the suite above exists for."""
    single = client.get(
        f"/api/v1/legislators/{member}/campaign-finance", params={"year": year}
    )
    assert single.status_code == 200, single.text
    span = client.get(
        f"/api/v1/legislators/{member}/campaign-finance/years",
        params={"from": year, "to": year},
    )
    assert span.status_code == 200, span.text
    single_states = _year_states(single.json()["data"])[1]
    span_states = _year_states(
        {**span.json()["data"]["years"][0], "link_state": "confirmed"}
    )[1]
    assert span_states == single_states
    return {number: state for number, (state, _) in single_states.items()}


def test_a_totals_refresh_before_the_next_payments_release_withholds_every_split(
    client, db, member
):
    """Rule 12: missing or unprocessed named donations are never presented as
    non-itemized donations, on the money tab as on the committee page.

    The fixture's release is first paired with the live filings snapshot, which is what
    the pipeline records when it publishes, and every state reads as before. Then a
    newer filings snapshot lands while the release still names the older one -- the
    23 Sep 2026 window in which Restore Sanity's page derived $12,885,000 of "unnamed"
    money from a total the payments file predates (issue 2344). Every committee-year
    with a reported total, and every one carrying a stored verdict against the new
    snapshot, now withholds its remainder in the one state that says why, on both the
    per-year route and the year-button route; a year with no official total keeps
    saying that, because there is nothing of the filings side to compare.
    """
    release_id = db.execute(
        text("SELECT release_id FROM cf_current_release WHERE id = true")
    ).scalar_one()
    older = db.execute(
        text("SELECT snapshot_id FROM cf_filing_current WHERE id = true")
    ).scalar_one()
    pair_release_with_filings(db, release_id=release_id, snapshot_id=older)

    assert _split_states(client, member, 2024)[SENATE] == "shown"
    assert _split_states(client, member, 2025)[HOUSE] == "no_named_payments"
    assert _split_states(client, member, 2026) == {
        SENATE: "periods_differ",
        HOUSE: "named_payments_not_in_our_copy",
        UNHELD: "no_reported_total",
    }

    newer = publish_filings_snapshot(
        db,
        filings=[
            (
                SENATE,
                2024,
                "individuals_contributions",
                Decimal("8600.00"),
                date(2024, 12, 31),
            ),
            (
                SENATE,
                2025,
                "individuals_contributions",
                Decimal("900.00"),
                date(2026, 1, 31),
            ),
            (
                SENATE,
                2026,
                "individuals_contributions",
                Decimal("8600.00"),
                date(2026, 7, 20),
            ),
            (
                HOUSE,
                2025,
                "individuals_contributions",
                Decimal("1500.00"),
                date(2025, 12, 31),
            ),
        ],
    )
    # The comparison re-run against the new totals copy with the old rows, which is what
    # a re-run does to the one verdict row a committee-year has: the newer filing names
    # money the older file predates, which reads as a disagreement and is not one.
    db.execute(
        text(
            "UPDATE cf_stated_split SET filings_snapshot_id = :newer, checked_at = :at "
            "WHERE registration_number = :number AND filing_year = 2026"
        ),
        {
            "newer": newer,
            "at": datetime(2026, 9, 23, 12, 0, tzinfo=UTC),
            "number": HOUSE,
        },
    )
    db.commit()

    assert _split_states(client, member, 2024) == {
        SENATE: "generations_differ",
        UNHELD: "no_reported_total",
    }
    assert _split_states(client, member, 2025) == {
        # Its filing's coverage ends in 2026, so there was never a total to compare.
        SENATE: "no_reported_total",
        HOUSE: "generations_differ",
        UNHELD: "no_reported_total",
    }
    assert _split_states(client, member, 2026) == {
        SENATE: "generations_differ",
        HOUSE: "generations_differ",
        UNHELD: "no_reported_total",
    }
    # Each source figure still travels with its own date; only the remainder is gone.
    senate_2024 = next(
        committee
        for committee in client.get(
            f"/api/v1/legislators/{member}/campaign-finance", params={"year": 2024}
        ).json()["data"]["committees"]
        if committee["registration_number"] == SENATE
    )["split"]
    assert senate_2024["reported_total"] == "8600.0000"
    assert senate_2024["reported_through"] == "2024-12-31"
    assert senate_2024["named_total"] == "250.0000"
    assert senate_2024["unnamed_total"] is None
