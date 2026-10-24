"""Cheap change checks keep retry obligations without claiming records published."""

from types import SimpleNamespace

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_engine
from alethical.pipeline.campaign_finance_refresh import (
    LIST_ACTIONS,
    ListReading,
    state_get,
)
from alethical.pipeline.minnesota import BillSearchResult
from scripts import discover_campaign_records as campaign
from scripts import discover_legislative_records as bills


def test_campaign_discovery_only_advances_after_all_6_lists(seed_database, monkeypatch):
    engine = get_engine()
    with Session(engine) as db:
        db.execute(delete(schema.SourceRefreshState))
        db.execute(delete(schema.CampaignFinanceRefreshState))
        db.commit()
    readings = [ListReading(action, "a" * 64, 1) for action in LIST_ACTIONS]
    monkeypatch.setattr(
        campaign, "RateLimitedSession", lambda *a: SimpleNamespace(close=lambda: None)
    )
    monkeypatch.setattr(campaign, "read_lists", lambda *a: readings)
    monkeypatch.setattr(campaign.filings, "http_session", lambda: None)
    code, first = campaign.discover(engine)
    assert code == 0 and first["collection_requested"]
    assert not campaign.discover(engine)[1]["collection_requested"]
    with Session(engine) as db:
        before = state_get(db, "source_discovery:campaign")
        assert (
            db.get(schema.SourceRefreshState, "campaign-money").last_checked_at is None
        )
    readings[0] = ListReading(LIST_ACTIONS[0], None, None, "failed")
    assert campaign.discover(engine)[0] == 1
    with Session(engine) as db:
        assert state_get(db, "source_discovery:campaign") == before


def bill(number):
    return BillSearchResult(
        "House",
        "HF",
        number,
        f"Bill {number}",
        f"https://example.test/{number}.xml",
        f"https://example.test/{number}.html",
        "0942026",
    )


def setup_bill_discovery(monkeypatch, inventory, held=None):
    saved = {}
    monkeypatch.setattr(bills, "load_progress", lambda *a: dict(saved))

    def save(*args):
        value = dict(args[-1])
        saved.clear()
        saved.update(value)

    monkeypatch.setattr(bills, "save_progress", save)
    monkeypatch.setattr(
        bills,
        "rate_limited_source_session",
        lambda *a, **k: SimpleNamespace(close=lambda: None),
    )
    monkeypatch.setattr(
        bills, "discover_recent_action_bills", lambda *a, **k: inventory
    )
    return saved


def test_action_candidates_are_reread_even_when_listing_fields_stay_the_same(
    monkeypatch,
):
    candidate = bill(2)
    saved = setup_bill_discovery(monkeypatch, [candidate])
    calls = []

    def collect(*a, **kw):
        calls.append([item.bill_key for item in kw["inventory"]])
        return {"accepted_bill_keys": [candidate.bill_key]}

    monkeypatch.setattr(bills, "refresh_bills", collect)
    monkeypatch.setattr(bills, "check_pending_votes", lambda *a, **k: [])
    args = dict(target="local", session_code="0942026", name="test", token="test")
    assert bills.refresh(None, **args) == 75
    assert saved["pending_votes"] == [candidate.bill_key]
    assert bills.refresh(None, **args) == 0
    assert "inventory" not in saved
    assert bills.refresh(None, **args) == 75
    assert len(calls) == 2


def test_unavailable_action_window_keeps_existing_progress(monkeypatch):
    saved = setup_bill_discovery(monkeypatch, [])
    saved["pending_votes"] = ["old"]

    def unavailable(*a, **k):
        raise ValueError("unavailable")

    monkeypatch.setattr(bills, "discover_recent_action_bills", unavailable)
    with pytest.raises(ValueError, match="unavailable"):
        bills.refresh(
            None, target="local", session_code="0942026", name="test", token="test"
        )
    assert saved == {"pending_votes": ["old"]}


def test_empty_action_window_completes_without_a_continuation_loop(monkeypatch):
    saved = setup_bill_discovery(monkeypatch, [])
    args = dict(target="local", session_code="0942026", name="test", token="test")
    assert bills.refresh(None, **args) == 0
    assert bills.refresh(None, **args) == 0
    assert "inventory" not in saved


def test_failed_old_vote_does_not_block_discovery_of_another_new_bill(monkeypatch):
    old, new = bill(1), bill(2)
    saved = setup_bill_discovery(monkeypatch, [old, new], {old.bill_key})
    saved["pending_votes"] = [old.bill_key]
    monkeypatch.setattr(bills, "check_pending_votes", lambda *a, **k: [old.bill_key])
    monkeypatch.setattr(
        bills, "refresh_bills", lambda *a, **k: {"accepted_bill_keys": [new.bill_key]}
    )
    assert (
        bills.refresh(
            None, target="local", session_code="0942026", name="test", token="test"
        )
        == 75
    )
    assert saved["pending_votes"] == sorted([old.bill_key, new.bill_key])


def test_filing_date_pass_for_superseded_snapshot_stays_unfinished(monkeypatch):
    from unittest.mock import Mock
    from scripts import backfill_campaign_finance_filed_dates as dates

    snapshot_id = "old-snapshot"
    monkeypatch.setattr(
        dates, "live_filings_snapshot", lambda db: SimpleNamespace(id=snapshot_id)
    )
    monkeypatch.setattr(dates, "_wanted", lambda *a: [])
    monkeypatch.setattr(dates, "http_session", Mock())
    db = Mock()
    db.execute.return_value.scalar_one_or_none.return_value = "new-snapshot"
    report = dates.backfill(
        db, year_from=2022, limit=None, carry_forward=False, progress=lambda text: None
    )
    assert report.exit_code == 75
    assert report.finding()["status"] == "continuing"


@pytest.mark.parametrize("changed,expected", [(0, False), (1, True)])
def test_filed_date_count_requires_an_actual_stored_row(changed, expected):
    from datetime import date
    from unittest.mock import Mock
    from scripts import backfill_campaign_finance_filed_dates as dates

    db = Mock()
    db.execute.return_value.rowcount = changed
    assert (
        dates._store(db, "snapshot", SimpleNamespace(row_number=1), date(2026, 10, 24))
        is expected
    )
