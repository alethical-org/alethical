"""Finance's landing counts are read live and refused, never reported as 0."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.api.services import finance_landing
from alethical.api.services.legislative_sessions import current_legislature_scope
from alethical.db import models
from alethical.db.session import get_engine
from alethical.tests import test_tv_ad_review as tv_review
from alethical.tests.test_campaign_finance_landing_reads import (
    _published_release,
    db,  # noqa: F401 -- the shared fixture that clears and restores campaign money
)
from alethical.tests.test_lobbying_api import FIXTURE, _clear_lobbying, _pair

COUNTS = "/api/v1/finance/landing/counts"
FETCHED = datetime(2026, 9, 1, 11, 30, tzinfo=UTC)


def _contribution_rows(db, release, years: list[int]) -> None:  # noqa: F811
    for number, year in enumerate(years, start=1):
        db.add(
            models.CampaignFinanceContributionRow(
                snapshot_id=release.contributions_snapshot_id,
                row_number=number,
                recipient="Example Committee",
                year=year,
            )
        )
    by_year: dict[str, int] = {}
    for year in years:
        by_year[str(year)] = by_year.get(str(year), 0) + 1
    db.execute(
        text(
            "UPDATE cf_snapshot SET row_count = :n, rows_by_year = CAST(:y AS jsonb)"
            " WHERE id = :sid"
        ),
        {
            "n": len(years),
            "y": json.dumps(by_year),
            "sid": release.contributions_snapshot_id,
        },
    )
    db.commit()


def test_nothing_published_is_unavailable_never_0(db):  # noqa: F811
    result = finance_landing.landing_counts(db)["campaign_money_records"]
    assert result["state"] == "unavailable"
    assert result["count"] is None
    assert result["reason"] == "nothing_published"


def test_the_published_rows_are_counted_with_their_years_and_copy_date(db):  # noqa: F811
    release = _published_release(db, fetched=FETCHED)
    _contribution_rows(db, release, [2025, 2026, 2026])
    result = finance_landing.landing_counts(db)["campaign_money_records"]
    assert result == {
        "state": "reported",
        "count": 3,
        "unit": "campaign money records",
        "source": "Minnesota Campaign Finance Board",
        "first_year": 2025,
        "last_year": 2026,
        "copied_at": FETCHED.isoformat(),
        "organizations": None,
        "reason": None,
        "as_of": None,
        "roll_calls": None,
        "election_label": None,
        "results_status": None,
    }


def test_rows_replaced_after_publishing_are_refused(db):  # noqa: F811
    release = _published_release(db, fetched=FETCHED)
    db.execute(
        text("UPDATE cf_snapshot SET row_count = 5 WHERE id = :sid"),
        {"sid": release.contributions_snapshot_id},
    )
    db.commit()
    result = finance_landing.landing_counts(db)["campaign_money_records"]
    assert (result["state"], result["count"], result["reason"]) == (
        "unavailable",
        None,
        "rows_replaced",
    )


def test_a_published_release_of_no_rows_is_not_reported_as_0(db):  # noqa: F811
    _published_release(db, fetched=FETCHED)
    result = finance_landing.landing_counts(db)["campaign_money_records"]
    assert (result["state"], result["count"], result["reason"]) == (
        "unavailable",
        None,
        "empty",
    )


def test_1_unreadable_source_does_not_hide_the_others(db, monkeypatch):  # noqa: F811
    def broken(session):
        # A real failed statement, which leaves the transaction aborted until
        # the rollback, so the counts read after it prove the session recovered.
        session.execute(text("SELECT 1/0"))

    monkeypatch.setattr(
        finance_landing,
        "_COUNTS",
        tuple(
            (key, unit, source, broken if key == "campaign_money_records" else read)
            for key, unit, source, read in finance_landing._COUNTS
        ),
    )
    result = finance_landing.landing_counts(db)
    assert result["campaign_money_records"]["state"] == "unavailable"
    assert result["campaign_money_records"]["reason"] == "unreadable"
    assert result["current_legislature_bills"]["state"] == "reported"
    assert result["current_legislature_bills"]["count"] > 0


def test_no_count_is_ever_0(db):  # noqa: F811
    for result in finance_landing.landing_counts(db).values():
        assert result["count"] != 0
        assert (result["state"] == "reported") == (result["count"] is not None)


def test_no_lobbying_release_and_no_station_files_are_unavailable(db):  # noqa: F811
    _clear_lobbying(db)
    assert db.scalar(text("SELECT count(*) FROM fcc_document")) == 0
    result = finance_landing.landing_counts(db)
    lobbying, stations = result["lobbying_spending_reports"], result["tv_station_files"]
    assert (lobbying["state"], lobbying["count"], lobbying["reason"]) == (
        "unavailable",
        None,
        "nothing_published",
    )
    assert (stations["state"], stations["count"], stations["reason"]) == (
        "unavailable",
        None,
        "empty",
    )


@pytest.fixture()
def tv_db(seed_database):
    # Station rows go in a transaction rolled back after the test.
    with get_engine().connect() as connection:
        transaction = connection.begin()
        with Session(bind=connection, join_transaction_mode="create_savepoint") as s:
            yield s
        transaction.rollback()


def _station_file(session, first, facility_id, call_sign, copied, year):
    session.add(
        models.FCCDocument(
            facility_id=facility_id,
            file_id=first.file_id,
            content_hash=first.content_hash,
            call_sign=call_sign,
            folder_id=first.folder_id,
            folder_path=first.folder_path,
            name="Station file",
            url=first.url,
            year=year,
            last_downloaded_at=copied,
        )
    )
    session.flush()


def test_station_files_date_is_the_oldest_stations_newest_copy(tv_db):
    first, _store = tv_review.source.__wrapped__(tv_db)
    first.last_downloaded_at = datetime(2026, 10, 20, tzinfo=UTC)
    first.year = 2022
    tv_db.flush()
    _station_file(
        tv_db, first, "23079", "KARE", datetime(2026, 10, 27, tzinfo=UTC), 2026
    )
    partial = finance_landing.landing_counts(tv_db)["tv_station_files"]
    # 2 of 3 stations held: the date cannot speak for KMSP-TV.
    assert (partial["count"], partial["copied_at"]) == (2, None)
    _station_file(
        tv_db, first, "68883", "KMSP-TV", datetime(2026, 10, 25, tzinfo=UTC), 2024
    )
    result = finance_landing.landing_counts(tv_db)["tv_station_files"]
    assert result["count"] == 3
    assert (result["first_year"], result["last_year"]) == (2022, 2026)
    assert result["copied_at"] == datetime(2026, 10, 20, tzinfo=UTC).isoformat()


def test_lobbying_reports_name_how_many_organizations_filed_them(db):  # noqa: F811
    _clear_lobbying(db)
    try:
        _pair(db)
        result = finance_landing.landing_counts(db)["lobbying_spending_reports"]
    finally:
        _clear_lobbying(db)
    assert result["count"] == len(FIXTURE["spending"])
    assert result["organizations"] == len(
        {row["entity_id"] for row in FIXTURE["spending"]}
    )
    assert result["organizations"] < result["count"]


def test_every_held_bill_counts_with_or_without_its_summary(db):  # noqa: F811
    scope = current_legislature_scope(db)
    before = finance_landing.landing_counts(db)["current_legislature_bills"]["count"]
    seeded = db.get(models.LegislativeSession, scope.primary.id)
    chamber_id = db.scalar(
        text("SELECT chamber_id FROM bill WHERE session_id = :s LIMIT 1"),
        {"s": seeded.id},
    )
    bill = models.Bill(
        session_id=seeded.id,
        chamber_id=chamber_id,
        bill_key="94-2025-SF919191",
        file_type="SF",
        file_number=919191,
        title="A held bill with no plain-language summary yet",
        current_status="Introduced",
        has_current_summary=False,
    )
    db.add(bill)
    db.commit()
    try:
        after = finance_landing.landing_counts(db)["current_legislature_bills"]
    finally:
        db.delete(bill)
        db.commit()
    assert after["count"] == before + 1
    # The new bill has no finished copy behind it, so no date can speak for all.
    assert after["copied_at"] is None


def test_the_counts_route_is_public_and_shared_cacheable(client, db):  # noqa: F811
    response = client.get(COUNTS)
    assert response.status_code == 200
    cache = response.headers["cache-control"]
    assert cache.startswith("public") and "no-store" not in cache


def test_every_site_may_read_the_counts_whoever_asks(client, db):  # noqa: F811
    # The landing page reads the counts at every address it is served from, so
    # the answer is the same whatever site, or none, asked for it.
    for origin in ("https://finance.alethical.com", "https://elsewhere.example", None):
        headers = {"Origin": origin} if origin else {}
        response = client.get(COUNTS, headers=headers)
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "*"
        assert "access-control-allow-credentials" not in response.headers


def test_signed_in_finance_answers_still_name_the_asking_site(client):
    response = client.get(
        "/api/v1/finance/access", headers={"Origin": "http://localhost:5174"}
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:5174"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_other_finance_routes_stay_private(client):
    response = client.get("/api/v1/finance/access")
    assert "no-store" in response.headers["cache-control"]


def test_the_counts_route_answers_every_count(client, db):  # noqa: F811
    response = client.get(COUNTS)
    assert set(response.json()["data"]) == {
        "campaign_money_records",
        "lobbying_spending_reports",
        "current_legislature_bills",
        "tv_station_files",
        "national_fcc_filings",
        "election_races_with_results",
    }


# National FCC filings: the active search release's count and its last full day.


def _fcc_release(session, release_id, *, filings, through, active):
    session.add(
        models.NationalFCCSearchRelease(
            release_id=release_id,
            object_key=f"fcc-national/v1/search/{release_id}.sqlite.gz",
            sqlite_sha256="a" * 64,
            sqlite_bytes=1,
            stored_sha256="b" * 64,
            stored_bytes=1,
            filings=filings,
            saved=0,
            unavailable=0,
            unchecked=filings,
            index_through=through,
            saved_updated=through,
            active=active,
        )
    )
    session.flush()


def test_national_fcc_filings_are_the_active_releases_with_a_date_only_day(tv_db):
    tv_db.execute(text("DELETE FROM national_fcc_search_release"))
    _fcc_release(tv_db, "older", filings=5, through=date(2026, 11, 1), active=False)
    _fcc_release(
        tv_db, "active", filings=19_647_383, through=date(2026, 11, 22), active=True
    )
    result = finance_landing.landing_counts(tv_db)["national_fcc_filings"]
    assert result["state"] == "reported"
    assert result["count"] == 19_647_383
    assert (result["first_year"], result["last_year"]) == (2012, 2026)
    # A calendar day, never a timestamp a page could move across time zones.
    assert result["as_of"] == "2026-11-22"
    assert result["copied_at"] is None


def test_no_active_fcc_release_is_unavailable_never_0(tv_db):
    tv_db.execute(text("DELETE FROM national_fcc_search_release"))
    _fcc_release(tv_db, "inactive", filings=5, through=date(2026, 11, 1), active=False)
    result = finance_landing.landing_counts(tv_db)["national_fcc_filings"]
    assert (result["state"], result["count"], result["as_of"], result["reason"]) == (
        "unavailable",
        None,
        None,
        "nothing_published",
    )


def test_an_active_fcc_release_of_no_filings_is_not_reported_as_0(tv_db):
    tv_db.execute(text("DELETE FROM national_fcc_search_release"))
    _fcc_release(tv_db, "empty", filings=0, through=date(2026, 11, 22), active=True)
    result = finance_landing.landing_counts(tv_db)["national_fcc_filings"]
    assert (result["state"], result["count"], result["reason"]) == (
        "unavailable",
        None,
        "empty",
    )


# Roll calls: every recorded vote on a bill of the current Legislature's sessions.


def test_roll_calls_count_every_vote_on_a_current_legislature_bill(tv_db):
    scope = current_legislature_scope(tv_db)
    expected = tv_db.scalar(
        text(
            "SELECT count(*) FROM vote_event v JOIN bill b ON b.id = v.bill_id"
            " WHERE b.session_id = ANY(:ids)"
        ),
        {"ids": list(scope.ids)},
    )
    bill_id, chamber_id = tv_db.execute(
        text("SELECT id, chamber_id FROM bill WHERE session_id = :s LIMIT 1"),
        {"s": scope.primary.id},
    ).one()
    tv_db.add(models.VoteEvent(bill_id=bill_id, chamber_id=chamber_id, yes_count=1))
    tv_db.flush()
    result = finance_landing.landing_counts(tv_db)["current_legislature_bills"]
    assert result["state"] == "reported"
    assert result["roll_calls"] == expected + 1


def test_no_roll_calls_held_is_null_never_0(tv_db):
    tv_db.execute(text("DELETE FROM vote_record"))
    tv_db.execute(text("DELETE FROM vote_event"))
    result = finance_landing.landing_counts(tv_db)["current_legislature_bills"]
    assert result["state"] == "reported"
    assert result["roll_calls"] is None


def test_unreadable_roll_calls_are_null_and_keep_the_bill_count(tv_db, monkeypatch):
    real_scalar = tv_db.scalar

    def failing(statement, *args, **kwargs):
        if "vote_event" in str(statement):
            # A real failed statement, so the savepoint must recover the session.
            tv_db.execute(text("SELECT 1/0"))
        return real_scalar(statement, *args, **kwargs)

    monkeypatch.setattr(tv_db, "scalar", failing)
    result = finance_landing.landing_counts(tv_db)
    bills = result["current_legislature_bills"]
    assert bills["state"] == "reported" and bills["count"] > 0
    assert bills["roll_calls"] is None
    # The session still answers the counts read after the failure.
    assert result["tv_station_files"]["reason"] == "empty"


# Election races: the newest published Minnesota general election's reported races.

COPIED = datetime(2026, 11, 23, 15, 14, tzinfo=UTC)


def _election(
    session,
    snapshot_id,
    *,
    election_date,
    statuses,
    reporting=1,
    source_status="unofficial",
    current=True,
    key=None,
):
    key = key or f"mn-{election_date.isoformat()}-general"
    session.add(
        models.ElectionComparisonSnapshot(
            id=snapshot_id,
            election_key=key,
            election_date=election_date,
            stage="general",
            fetched_at=COPIED,
            first_published_at=COPIED,
            sources=[],
            coverage={"source_status": source_status},
        )
    )
    session.flush()
    for number, status in enumerate(statuses):
        session.add(
            models.ElectionComparisonRace(
                snapshot_id=snapshot_id,
                id=f"{snapshot_id[:8]}-{number}",
                label=f"Race {number}",
                office_id="0335",
                jurisdiction="88",
                result_status=status,
                payload={
                    "coverage": {
                        "reporting_precincts": reporting,
                        "expected_precincts": 1,
                    },
                    **(
                        {"certificationEvidence": [{"source": "canvass"}]}
                        if status == "certified"
                        else {}
                    ),
                },
            )
        )
    session.flush()
    if current:
        session.execute(
            text(
                "INSERT INTO election_comparison_current (election_key, snapshot_id)"
                " VALUES (:k, :s) ON CONFLICT (election_key)"
                " DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id"
            ),
            {"k": key, "s": snapshot_id},
        )


@pytest.fixture()
def election_db(tv_db):
    tv_db.execute(text("DELETE FROM election_comparison_current"))
    return tv_db


def test_election_races_with_results_come_from_the_newest_general(election_db):
    _election(
        election_db,
        "o" * 64,
        election_date=date(2024, 11, 5),
        statuses=["unofficial"] * 4,
    )
    _election(
        election_db,
        "n" * 64,
        election_date=date(2026, 11, 3),
        statuses=["unofficial"] * 3,
    )
    # A newer copy staged but not yet current is never read.
    _election(
        election_db,
        "s" * 64,
        election_date=date(2026, 11, 3),
        statuses=["unofficial"] * 9,
        current=False,
    )
    result = finance_landing.landing_counts(election_db)["election_races_with_results"]
    assert result == {
        "state": "reported",
        "count": 3,
        "unit": "election races with results",
        "source": "Minnesota Secretary of State",
        "first_year": 2026,
        "last_year": 2026,
        "copied_at": COPIED.isoformat(),
        "organizations": None,
        "reason": None,
        "as_of": None,
        "roll_calls": None,
        "election_label": "November 2026 general election",
        "results_status": "unofficial",
    }


def test_races_with_no_precinct_reporting_or_pending_are_left_out(election_db):
    _election(
        election_db,
        "n" * 64,
        election_date=date(2026, 11, 3),
        statuses=["unofficial", "pending", "unavailable"],
    )
    _election(
        election_db,
        "z" * 64,
        election_date=date(2026, 11, 3),
        key="mn-2026-11-03-x",
        statuses=["unofficial"],
        reporting=0,
        current=False,
    )
    result = finance_landing.landing_counts(election_db)["election_races_with_results"]
    assert result["count"] == 1
    # Not every race is unofficial, so the status is not claimed for the count.
    assert result["results_status"] is None


def test_a_reviewed_or_certified_race_means_no_status_is_claimed(election_db):
    _election(
        election_db,
        "n" * 64,
        election_date=date(2026, 11, 3),
        statuses=["unofficial", "certified"],
    )
    result = finance_landing.landing_counts(election_db)["election_races_with_results"]
    assert result["count"] == 2
    assert result["results_status"] is None


def test_an_outcome_review_means_no_status_is_claimed(election_db):
    _election(
        election_db,
        "n" * 64,
        election_date=date(2026, 11, 3),
        statuses=["unofficial"],
    )
    # A review can certify 1 race, so "unofficial" no longer speaks for all.
    election_db.add(
        models.ElectionOutcomeDecision(
            request_key="r" * 64,
            snapshot_id="n" * 64,
            race_id=f"{'n' * 8}-0",
            decision="recorded",
            result_status="unofficial",
            identity={},
            candidate_outcomes=[],
            evidence=[{"capture_id": "c"}],
            reason="Example review",
            reviewed_by="reviewer",
            reviewed_at=COPIED,
        )
    )
    election_db.flush()
    result = finance_landing.landing_counts(election_db)["election_races_with_results"]
    assert result["count"] == 1
    assert result["results_status"] is None


def test_no_published_general_election_is_unavailable_never_0(election_db):
    result = finance_landing.landing_counts(election_db)["election_races_with_results"]
    assert (result["state"], result["count"], result["reason"]) == (
        "unavailable",
        None,
        "nothing_published",
    )


def test_a_general_election_with_no_reported_race_is_not_reported_as_0(election_db):
    _election(
        election_db,
        "n" * 64,
        election_date=date(2026, 11, 3),
        statuses=["pending", "pending"],
        reporting=0,
    )
    result = finance_landing.landing_counts(election_db)["election_races_with_results"]
    assert (result["state"], result["count"], result["reason"]) == (
        "unavailable",
        None,
        "empty",
    )
    assert result["election_label"] is None
