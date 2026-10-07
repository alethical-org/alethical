from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import text

from alethical.db.session import get_engine
from alethical.pipeline import committee_memberships
from alethical.pipeline.legislative_refresh import bill_refresh_interval
from alethical.pipeline.request_limits import (
    DatabaseRequestLimiter,
    RateLimitedSession,
    retry_after_seconds,
)
from alethical.pipeline.roster_pdf import parse_roster_pdf

FIXTURE = Path(__file__).parent / "fixtures" / "roster-pdf-text.txt"


def test_partial_roster_with_both_headings_cannot_remove_members():
    source = FIXTURE.read_text()
    source = source.replace("Acomb, Patty (DFL)", "unreadable")
    with pytest.raises(ValueError, match="Incomplete or duplicate house"):
        parse_roster_pdf(source)


def test_missing_vacancy_is_not_evidence_of_vacancy():
    source = FIXTURE.read_text().replace("Vacant", "unreadable")
    with pytest.raises(ValueError, match="Incomplete or duplicate house"):
        parse_roster_pdf(source)


def test_thin_committee_source_retains_memberships(monkeypatch):
    db = Mock()
    db.scalar.return_value = SimpleNamespace(id="session")
    member = SimpleNamespace(id="member")
    chamber = SimpleNamespace(slug="house")
    monkeypatch.setattr(
        committee_memberships,
        "current_legislator_rows",
        lambda *_: [(member, chamber, "https://example.test/member")],
    )
    monkeypatch.setattr(
        committee_memberships,
        "fetch_text",
        lambda *_: "<html>Temporary maintenance</html>",
    )
    clear = Mock()
    monkeypatch.setattr(committee_memberships, "clear_current_memberships", clear)
    with pytest.raises(RuntimeError, match="retaining all saved"):
        committee_memberships.backfill(db, dry_run=False, cleanup_orphans=False)
    clear.assert_not_called()
    db.commit.assert_not_called()


def test_cadence_uses_sitting_intervals_and_post_adjournment():
    assert bill_refresh_interval(
        date(2026, 3, 1), sitting_start=date(2026, 2, 1), sitting_end=date(2026, 5, 18)
    ) == timedelta(hours=4)
    assert bill_refresh_interval(
        date(2026, 3, 1), sitting_start=date(2026, 3, 1), special=True
    ) == timedelta(hours=2)
    assert bill_refresh_interval(
        date(2026, 5, 30), sitting_end=date(2026, 5, 18)
    ) == timedelta(hours=4)
    assert bill_refresh_interval(
        date(2026, 6, 2), sitting_end=date(2026, 5, 18)
    ) == timedelta(days=7)
    assert bill_refresh_interval(date(2026, 1, 1)) == timedelta(days=7)


def test_retry_after_integer_date_and_invalid():
    assert retry_after_seconds("120") == 120
    assert (
        retry_after_seconds(
            "Wed, 07 Oct 2026 12:01:00 GMT", now=datetime(2026, 10, 7, 12, tzinfo=UTC)
        )
        == 60
    )
    assert retry_after_seconds("bad") == 1
    assert retry_after_seconds("999999") == 3600


def test_busy_response_sets_shared_cooldown():
    session = Mock()
    session.get.return_value = SimpleNamespace(
        status_code=429, headers={"Retry-After": "120"}
    )
    limiter = Mock()
    RateLimitedSession(session, limiter).get("https://www.house.mn.gov/test")
    limiter.wait.assert_called_once_with("https://www.house.mn.gov/test")
    limiter.defer.assert_called_once_with("https://www.house.mn.gov/test", 120)


def test_database_limiter_reserves_after_shared_cooldown(monkeypatch, seed_database):
    engine = get_engine()
    limiter = DatabaseRequestLimiter(engine, interval_seconds=0.01)
    limiter.defer("https://www.house.mn.gov/test", 1)
    # Inspect the shared state rather than sleeping a second in the test.
    with engine.connect() as db:
        wait = db.execute(
            text(
                "SELECT EXTRACT(EPOCH FROM blocked_until - clock_timestamp()) FROM source_request_limits WHERE host='house.mn.gov'"
            )
        ).scalar_one()
    assert 0 < wait <= 1
    assert limiter.key("https://house.mn.gov/another") == limiter.key(
        "https://www.house.mn.gov/test"
    )


def test_conditional_bill_text_reuses_only_matching_body_after_304():
    from alethical.pipeline.minnesota import MinnesotaIngestionPipeline, content_hash

    body = "<html>official bill</html>"
    prior = SimpleNamespace(
        content_hash=content_hash(body),
        metadata_json={"conditional_body": body, "etag": '"v1"'},
    )
    db = Mock()
    db.scalar.return_value = prior
    http = Mock()
    http.get.return_value = SimpleNamespace(status_code=304)
    pipeline = MinnesotaIngestionPipeline(db, sess=http, conditional_bill_text=True)
    assert pipeline._fetch_bill_html(
        SimpleNamespace(id="run"), "https://revisor.mn.gov/bill", "key"
    ) == (body, prior)
    assert http.get.call_args.kwargs["headers"] == {"If-None-Match": '"v1"'}


def test_conditional_bill_text_rejects_304_for_corrupt_copy():
    from alethical.pipeline.minnesota import (
        MinnesotaIngestionError,
        MinnesotaIngestionPipeline,
    )

    db = Mock()
    db.scalar.return_value = SimpleNamespace(
        content_hash="different",
        metadata_json={"conditional_body": "corrupt", "etag": '"v1"'},
    )
    http = Mock()
    http.get.return_value = SimpleNamespace(status_code=304)
    pipeline = MinnesotaIngestionPipeline(db, sess=http, conditional_bill_text=True)
    with pytest.raises(MinnesotaIngestionError, match="without a saved matching"):
        pipeline._fetch_bill_html(
            SimpleNamespace(id="run"), "https://revisor.mn.gov/bill", "key"
        )


def test_unknown_session_refused_before_source_or_database_access():
    from alethical.pipeline.legislative_refresh import refresh_bills, refresh_roster

    engine = Mock()
    for refresh in (refresh_bills, refresh_roster):
        with pytest.raises(ValueError, match="No legislative session mapped"):
            refresh(engine, session_code="0952027", target="production")
    engine.assert_not_called()


def test_redirect_destination_gets_its_own_source_slot():
    session = Mock()
    redirect = Mock(status_code=302, headers={"Location": "https://senate.mn/member"})
    result = Mock(status_code=200)
    session.get.side_effect = [redirect, result]
    limiter = Mock()
    assert (
        RateLimitedSession(session, limiter).get("https://leg.mn.gov/member") is result
    )
    assert [call.args[0] for call in limiter.wait.call_args_list] == [
        "https://leg.mn.gov/member",
        "https://senate.mn/member",
    ]
    assert all(
        call.kwargs["allow_redirects"] is False for call in session.get.call_args_list
    )
    redirect.close.assert_called_once()


def test_revisor_api_and_website_share_pacing_budget():
    assert DatabaseRequestLimiter.key(
        "https://api.revisor.mn.gov/bills"
    ) == DatabaseRequestLimiter.key("https://www.revisor.mn.gov/bills")
