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


def test_new_biennium_cannot_replace_previous_session_roster():
    from alethical.pipeline.roster_pdf import validate_roster_biennium

    source = FIXTURE.read_text()
    validate_roster_biennium(source, year_start=2025, year_end=2026)
    with pytest.raises(ValueError, match="mapping review"):
        validate_roster_biennium(
            source.replace("2025-2026", "2027-2028"), year_start=2025, year_end=2026
        )


def test_unknown_current_or_future_session_is_reviewed_not_invented():
    from scripts.check_legislative_sessions import unreviewed_session_codes

    html = '<select name="session"><option value="0942025">Current</option><option value="0952027">New</option><option value="2942026">Special</option><option value="0912019">Historical</option></select>'
    assert unreviewed_session_codes(html) == ["0952027", "2942026"]
    with pytest.raises(ValueError, match="could not be read"):
        unreviewed_session_codes("<html>maintenance</html>")


def test_reviewed_calendar_refreshes_both_regular_years_during_continuing_sitting():
    from alethical.pipeline.legislative_calendar import session_refresh_interval

    assert session_refresh_interval("0942025", date(2026, 3, 1)) == timedelta(hours=4)
    assert session_refresh_interval("0942026", date(2026, 3, 1)) == timedelta(hours=4)
    assert session_refresh_interval("0942025", date(2025, 8, 1)) == timedelta(days=7)
    assert session_refresh_interval("1942025", date(2025, 6, 9)) == timedelta(hours=2)
    assert session_refresh_interval("1942025", date(2025, 6, 24)) == timedelta(hours=4)
    assert session_refresh_interval("1942025", date(2025, 6, 25)) == timedelta(days=7)
    with pytest.raises(ValueError, match="No legislative session mapped"):
        session_refresh_interval("0952027", date(2027, 1, 12))


def test_embedding_failure_rolls_back_canonical_bill_too(monkeypatch):
    from alethical.pipeline import legislative_refresh as refresh
    from alethical.pipeline.minnesota import BillSearchResult
    from alethical.pipeline import rag_ingest

    db = Mock()
    context = Mock()
    context.__enter__ = Mock(return_value=db)
    context.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(refresh, "Session", lambda *_: context)
    source = Mock()
    monkeypatch.setattr(
        refresh, "rate_limited_source_session", lambda *_a, **_kw: source
    )
    pipeline = Mock()
    pipeline.ingest_bills.return_value = {
        "bill_refresh_rejections": [],
        "text_changed_bill_keys": ["94-2025-HF1"],
        "summary_changed_bill_keys": [],
        "bill_keys": ["94-2025-HF1"],
    }
    monkeypatch.setattr(
        refresh, "MinnesotaIngestionPipeline", lambda *_a, **_kw: pipeline
    )
    embedding = Mock(side_effect=RuntimeError("embedding service unavailable"))
    monkeypatch.setattr(rag_ingest, "build_rag_rows_for_bill_keys", embedding)
    result = refresh.refresh_bills(
        Mock(),
        session_code="0942025",
        target="production",
        inventory=[
            BillSearchResult(
                chamber="House",
                file_type="HF",
                file_number=1,
                description="Bill",
                status_xml_uri="",
                latest_text_html_uri="",
                session_code="0942025",
            )
        ],
    )
    assert result["accepted"] == 0
    assert result["failed"] == [{"bill_key": "94-2025-HF1", "error": "RuntimeError"}]
    embedding.assert_called_once_with(db, ["94-2025-HF1"], database_target="production")
    db.rollback.assert_called_once()
    db.commit.assert_not_called()
    source.close.assert_called_once()
