"""Finance's landing counts are read live and refused, never reported as 0."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from alethical.api.services import finance_landing
from alethical.api.services.legislative_sessions import current_legislature_scope
from alethical.db import models
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
        raise OperationalError("SELECT", {}, Exception("down"))

    monkeypatch.setattr(
        finance_landing,
        "_COUNTS",
        tuple(
            (key, unit, source, broken if key == "tv_station_files" else read)
            for key, unit, source, read in finance_landing._COUNTS
        ),
    )
    release = _published_release(db, fetched=FETCHED)
    _contribution_rows(db, release, [2026])
    result = finance_landing.landing_counts(db)
    assert result["tv_station_files"]["state"] == "unavailable"
    assert result["tv_station_files"]["reason"] == "unreadable"
    assert result["campaign_money_records"]["count"] == 1


def test_no_count_is_ever_0(db):  # noqa: F811
    for result in finance_landing.landing_counts(db).values():
        assert result["count"] != 0
        assert (result["state"] == "reported") == (result["count"] is not None)


@pytest.mark.parametrize("key", ["lobbying_spending_reports", "tv_station_files"])
def test_an_empty_source_is_unavailable(db, key):  # noqa: F811
    result = finance_landing.landing_counts(db)[key]
    if result["state"] == "reported":
        assert result["count"] > 0
    else:
        assert result["count"] is None and result["reason"]


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
    }
