"""Tests for the real-user-monitoring (RUM) read-surface latency beacon (#516).

Covers the sink endpoint contract (valid event writes a row; malformed/oversized
rejected; rate limit enforced) and the documented p50/p75/p95 readout query.
The privacy posture — timing + coarse dimensions only, no PII/IP/precise
location/user id — is enforced structurally by RumEventRequest and the table
schema; these tests exercise the accept/reject behaviour on top of it.
"""

from __future__ import annotations

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from alethical.db.schema import load_schema
from alethical.db.session import get_engine

schema = load_schema()
RumLatencyEvent = schema.RumLatencyEvent

VALID_EVENT = {
    "interaction": "bills_list",
    "duration_ms": 142,
    "ttfb_ms": 90,
    "cache_status": "hit",
    "device_class": "mobile",
    "cold": True,
    "coarse_geo": "America/Chicago",
}


def _clear_events() -> None:
    with Session(get_engine()) as db:
        db.execute(delete(RumLatencyEvent))
        db.commit()


def _event_count() -> int:
    with Session(get_engine()) as db:
        return db.scalar(select(func.count()).select_from(RumLatencyEvent))


def test_valid_rum_event_writes_a_row(client):
    _clear_events()
    before = _event_count()

    response = client.post("/api/v1/rum", json=VALID_EVENT)

    assert response.status_code == 202
    assert _event_count() == before + 1

    with Session(get_engine()) as db:
        row = db.scalars(select(RumLatencyEvent)).one()
        assert row.interaction == "bills_list"
        assert row.duration_ms == 142
        assert row.ttfb_ms == 90
        assert row.cache_status == "hit"
        assert row.device_class == "mobile"
        assert row.cold is True
        assert row.coarse_geo == "America/Chicago"
        # Server stamps the receive time; the client never supplies it.
        assert row.created_at is not None


def test_rum_event_accepts_the_filter_interaction_and_optional_fields(client):
    _clear_events()
    response = client.post(
        "/api/v1/rum",
        json={
            "interaction": "bills_filter",
            "duration_ms": 0,
            "device_class": "desktop",
            "cold": False,
        },
    )
    assert response.status_code == 202
    with Session(get_engine()) as db:
        row = db.scalars(select(RumLatencyEvent)).one()
        assert row.interaction == "bills_filter"
        assert row.device_class == "desktop"
        assert row.cold is False
        # Omitted optionals default cleanly, never stored as junk.
        assert row.ttfb_ms is None
        assert row.cache_status == "unknown"
        assert row.coarse_geo is None


def test_rum_event_rejects_malformed_payloads_without_writing(client):
    _clear_events()
    before = _event_count()

    malformed_payloads = [
        # Unknown interaction.
        {**VALID_EVENT, "interaction": "not_a_surface"},
        # Missing required device_class.
        {k: v for k, v in VALID_EVENT.items() if k != "device_class"},
        # Out-of-range duration.
        {**VALID_EVENT, "duration_ms": -5},
        {**VALID_EVENT, "duration_ms": 999_999_999},
        # Unknown cache status.
        {**VALID_EVENT, "cache_status": "warm"},
        # Extra field — RumEventRequest forbids extras (no PII smuggling, no
        # unbounded payload growth).
        {**VALID_EVENT, "user_id": "abc", "ip": "1.2.3.4"},
    ]
    for payload in malformed_payloads:
        response = client.post("/api/v1/rum", json=payload)
        assert response.status_code == 422, payload

    assert _event_count() == before


def test_rum_event_rejects_oversized_body_without_writing(client):
    _clear_events()
    before = _event_count()

    # A body well over the 2KB cap. Rejected either by the Content-Length guard
    # (413) or by field validation (422, coarse_geo is length-capped) — either
    # way it must not be stored.
    oversized = {**VALID_EVENT, "coarse_geo": "x" * 4000}
    response = client.post("/api/v1/rum", json=oversized)

    assert response.status_code in {413, 422}
    assert _event_count() == before


def test_reject_oversized_rum_body_guard_returns_413_on_large_content_length():
    """Unit-test the size guard directly (like the rate-limit helpers): a large
    declared Content-Length is rejected with 413 before any parsing/write."""
    from fastapi import HTTPException

    from alethical.api.routers.public import (
        _RUM_MAX_BODY_BYTES,
        _reject_oversized_rum_body,
    )

    class _FakeRequest:
        def __init__(self, content_length: str | None) -> None:
            self.headers = (
                {"content-length": content_length} if content_length is not None else {}
            )

    # Under the cap: allowed (returns None, no raise).
    assert _reject_oversized_rum_body(_FakeRequest("500")) is None
    # Missing / non-numeric: falls through to Pydantic validation, no raise.
    assert _reject_oversized_rum_body(_FakeRequest(None)) is None
    assert _reject_oversized_rum_body(_FakeRequest("not-a-number")) is None
    # Over the cap: 413.
    try:
        _reject_oversized_rum_body(_FakeRequest(str(_RUM_MAX_BODY_BYTES + 1)))
    except HTTPException as exc:
        assert exc.status_code == 413
    else:  # pragma: no cover
        raise AssertionError("expected a 413 HTTPException")


def test_rum_endpoint_rate_limit_enforced(client, monkeypatch):
    """The per-client rate limit rejects a client that exceeds the ceiling. Set a
    tiny ceiling on this app's limiter and confirm the (limit+1)th call 429s."""
    from alethical.api.rate_limit import SlidingWindowLimiter

    client.app.state.rum_limiter = SlidingWindowLimiter(
        max_requests=3, window_seconds=60.0
    )
    _clear_events()

    accepted = 0
    for _ in range(3):
        assert client.post("/api/v1/rum", json=VALID_EVENT).status_code == 202
        accepted += 1
    # The next call over the ceiling is rejected and not stored.
    limited = client.post("/api/v1/rum", json=VALID_EVENT)
    assert limited.status_code == 429
    assert _event_count() == accepted


# The documented p50/p75/p95 readout query (kept in sync with
# docs/rum-read-surface-monitoring.md). Grouped by the coarse dimensions.
READOUT_QUERY = text(
    """
    SELECT
      interaction,
      device_class,
      cold,
      cache_status,
      count(*) AS samples,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY duration_ms) AS p75,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
    FROM rum_latency_event
    GROUP BY interaction, device_class, cold, cache_status
    ORDER BY interaction, samples DESC
    """
)


def test_readout_query_returns_sane_percentiles(client):
    _clear_events()
    # Seed a spread of durations for one dimension bucket so the percentiles are
    # well-defined and ordered.
    for duration in range(100, 200, 10):  # 100..190, ten samples
        client.post(
            "/api/v1/rum",
            json={
                "interaction": "bills_list",
                "duration_ms": duration,
                "cache_status": "hit",
                "device_class": "mobile",
                "cold": False,
            },
        )

    with Session(get_engine()) as db:
        rows = db.execute(READOUT_QUERY).mappings().all()

    assert len(rows) == 1
    row = rows[0]
    assert row["samples"] == 10
    # Percentiles are monotonic and within the seeded range.
    assert 100 <= row["p50"] <= row["p75"] <= row["p95"] <= 190
    assert row["p50"] < row["p95"]
