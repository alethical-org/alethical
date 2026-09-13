"""The report total's copy date belongs to its published source, not its payments."""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import text

from alethical.api.services.committee_finance import report_totals_copied_at
from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.tests.filed_figures import FETCHED_AT, publish_filings_snapshot
from alethical.tests.test_committee_finance import (
    CANDIDATE,
    Published,
    _clear,
    _receipt,
)


@pytest.fixture()
def db(seed_database):
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


def _filings(db):
    return publish_filings_snapshot(
        db,
        filings=[
            (CANDIDATE, 2025, "total_contributions", Decimal("100"), date(2025, 12, 31))
        ],
    )


def test_the_date_follows_the_published_source_not_the_newest_fetch(db):
    published = _filings(db)
    newer_date = datetime(2026, 9, 13, 12, tzinfo=UTC)
    newer = models.CampaignFinanceFilingSnapshot(
        fetch_started_at=newer_date,
        fetch_completed_at=newer_date,
        status=models.CampaignFinanceSnapshotStatus.fetched,
    )
    db.add(newer)
    db.commit()
    assert report_totals_copied_at(db) == FETCHED_AT
    # Republishing stored bytes must not renew their copy date.
    current = db.get(models.CampaignFinanceFilingSnapshot, published)
    current.updated_at = newer_date
    db.commit()
    assert report_totals_copied_at(db) == FETCHED_AT
    db.execute(text("UPDATE cf_filing_current SET snapshot_id = :id"), {"id": newer.id})
    db.commit()
    assert report_totals_copied_at(db) == newer_date


@pytest.mark.parametrize("with_filings", [False, True])
def test_both_routes_serve_the_report_date_beside_the_payment_date(
    db, client, with_filings
):
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="100.00")
    db.commit()
    if with_filings:
        _filings(db)
    member_id = db.execute(text("SELECT id FROM legislator LIMIT 1")).scalar_one()
    for path in (
        f"/api/v1/committees/{CANDIDATE}/finance?year=2025",
        f"/api/v1/legislators/{member_id}/campaign-finance?year=2025",
    ):
        response = client.get(path)
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert data["fetched_at"]
        if with_filings:
            assert datetime.fromisoformat(data["report_totals_copied_at"]) == FETCHED_AT
            assert data["report_totals_copied_at"] != data["fetched_at"]
        else:
            assert data["report_totals_copied_at"] is None
