from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from alethical.db.schema import load_schema
from alethical.db.session import get_session_factory


schema = load_schema()


def _totals(client, monkeypatch, excluded: str = "") -> dict:
    monkeypatch.setenv("TRAFFIC_EXCLUDED_ACCOUNT_IDS", excluded)
    response = client.get("/api/v1/site-metrics")
    assert response.status_code == 200
    assert response.headers["cache-control"].startswith("public")
    return response.json()["data"]


def test_site_metric_events_store_only_an_allowed_name(client, auth_headers):
    response = client.post(
        "/api/v1/site-metrics/events",
        json={"event": "bill_search_with_results"},
        headers=auth_headers,
    )
    assert response.status_code == 204

    with get_session_factory()() as db:
        event = db.scalars(
            select(schema.SiteMetricEvent).order_by(
                schema.SiteMetricEvent.created_at.desc()
            )
        ).first()
        assert event is not None
        assert event.event_kind == "bill_search_with_results"
        assert set(event.__table__.columns.keys()) == {
            "id",
            "event_kind",
            "created_at",
            "updated_at",
        }
        db.delete(event)
        db.commit()


def test_site_metric_events_reject_private_or_unknown_fields(client):
    for body in (
        {"event": "bill_search_with_results", "query": "private words"},
        {"event": "find_my_legislator_with_results", "address": "private address"},
        {"event": "unknown_action"},
    ):
        response = client.post("/api/v1/site-metrics/events", json=body)
        assert response.status_code == 422


def test_team_events_are_discarded_before_storage(client, auth_headers, monkeypatch):
    monkeypatch.setenv("TRAFFIC_EXCLUDED_ACCOUNT_IDS", "supabase-user-ada")
    with get_session_factory()() as db:
        before = db.query(schema.SiteMetricEvent).count()

    response = client.post(
        "/api/v1/site-metrics/events",
        json={"event": "official_source_opened"},
        headers=auth_headers,
    )
    assert response.status_code == 204

    with get_session_factory()() as db:
        assert db.query(schema.SiteMetricEvent).count() == before


def test_action_windows_and_reader_totals_exclude_team_accounts(
    client,
    auth_headers,
    second_auth_headers,
    monkeypatch,
):
    assert client.get("/api/v1/me", headers=auth_headers).status_code == 200
    assert client.get("/api/v1/me", headers=second_auth_headers).status_code == 200

    now = datetime.now(timezone.utc)
    created_ids = []
    with get_session_factory()() as db:
        ada_identity = db.scalar(
            select(schema.AuthIdentity).where(
                schema.AuthIdentity.provider_subject == "supabase-user-ada"
            )
        )
        grace_identity = db.scalar(
            select(schema.AuthIdentity).where(
                schema.AuthIdentity.provider_subject == "supabase-user-grace"
            )
        )
        assert ada_identity is not None and grace_identity is not None
        bills = db.scalars(select(schema.Bill).limit(2)).all()
        assert len(bills) == 2

        for user_id, bill in (
            (ada_identity.user_id, bills[0]),
            (grace_identity.user_id, bills[1]),
        ):
            existing = db.scalar(
                select(schema.TrackedBill).where(
                    schema.TrackedBill.user_id == user_id,
                    schema.TrackedBill.bill_id == bill.id,
                )
            )
            if existing is None:
                row = schema.TrackedBill(user_id=user_id, bill_id=bill.id)
                db.add(row)
                db.flush()
                created_ids.append(row.id)

        recent = schema.SiteMetricEvent(event_kind="bill_search_with_results")
        older = schema.SiteMetricEvent(event_kind="bill_search_with_results")
        db.add_all([recent, older])
        db.flush()
        recent.created_at = now - timedelta(days=2)
        older.created_at = now - timedelta(days=10)
        event_ids = [recent.id, older.id]
        db.commit()
        ada_watch_count = int(
            db.scalar(
                select(func.count(schema.TrackedBill.id)).where(
                    schema.TrackedBill.user_id == ada_identity.user_id
                )
            )
            or 0
        )

    try:
        without_exclusion = _totals(client, monkeypatch)
        with_exclusion = _totals(client, monkeypatch, "supabase-user-ada")

        assert with_exclusion["actions7d"]["billSearchesWithResults"] >= 1
        assert (
            with_exclusion["actions30d"]["billSearchesWithResults"]
            >= with_exclusion["actions7d"]["billSearchesWithResults"] + 1
        )
        assert with_exclusion["readers"]["registeredReaders"] == (
            without_exclusion["readers"]["registeredReaders"] - 1
        )
        assert with_exclusion["readers"]["currentBillWatches"] == (
            without_exclusion["readers"]["currentBillWatches"] - ada_watch_count
        )
        assert with_exclusion["teamExclusionConfigured"] is True
        assert set(with_exclusion) == {
            "actions7d",
            "actions30d",
            "readers",
            "fetchedAt",
            "teamExclusionConfigured",
        }
    finally:
        with get_session_factory()() as db:
            db.query(schema.SiteMetricEvent).filter(
                schema.SiteMetricEvent.id.in_(event_ids)
            ).delete(synchronize_session=False)
            if created_ids:
                db.query(schema.TrackedBill).filter(
                    schema.TrackedBill.id.in_(created_ids)
                ).delete(synchronize_session=False)
            db.commit()
