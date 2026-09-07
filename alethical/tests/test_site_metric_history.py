"""Anonymous totals count committed actions, not rows left after deletion."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select

from alethical.api.auth import get_auth_service
from alethical.api import auth as auth_module
from alethical.api.services.auth import AuthenticatedPrincipal
from alethical.api.services import site_metric_history as history_service
from alethical.api.routers import me, site_metrics
from alethical.db.schema import load_schema
from alethical.db.session import get_session_factory


schema = load_schema()
AUTH = {"Authorization": "Bearer synthetic-only"}


@pytest.fixture(autouse=True)
def clean_history(seed_database):
    with get_session_factory()() as db:
        for model in (
            schema.SiteMetricReceipt,
            schema.SiteMetricCoverage,
            schema.SiteMetricHourlyCount,
        ):
            db.execute(delete(model))
        db.commit()


@pytest.fixture()
def reader(client):
    principal = AuthenticatedPrincipal(
        provider="supabase",
        provider_subject=str(uuid4()),
        email=f"{uuid4()}@reader.invalid",
        email_verified=True,
    )

    class AuthService:
        def __init__(self, principal):
            self.principal = principal

        def authenticate(self, token):
            return self.principal

    auth = AuthService(principal)
    client.app.dependency_overrides[get_auth_service] = lambda: auth
    return client, auth


def _count(kind):
    with get_session_factory()() as db:
        return db.scalar(
            select(
                func.coalesce(func.sum(schema.SiteMetricHourlyCount.count), 0)
            ).where(schema.SiteMetricHourlyCount.metric_kind == kind)
        )


def _bill_key():
    with get_session_factory()() as db:
        return db.scalars(select(schema.Bill)).first().bill_key


def _advance_public_clock(monkeypatch):
    next_hour = history_service.completed_hour(datetime.now(timezone.utc)) + timedelta(
        hours=1
    )

    class FutureClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return next_hour

    monkeypatch.setattr(site_metrics, "datetime", FutureClock)


def test_unfollowing_does_not_erase_a_follow_action(reader, monkeypatch):
    client, _ = reader
    path = f"/api/v1/me/tracked-bills/{_bill_key()}"
    assert client.put(path, json={}, headers=AUTH).status_code == 200
    assert _count("bill_watch_created") == 1
    _advance_public_clock(monkeypatch)
    before = client.get("/api/v1/site-metrics").json()["data"]["actions7d"]
    assert before["newBillWatches"] == 1
    assert client.delete(path, headers=AUTH).status_code == 204
    after = client.get("/api/v1/site-metrics").json()["data"]["actions7d"]
    assert after["newBillWatches"] == 1


def test_bill_retries_and_updates_do_not_create_counts_but_refollow_does(reader):
    client, _ = reader
    path = f"/api/v1/me/tracked-bills/{_bill_key()}"
    for _ in range(3):
        assert (
            client.put(path, json={"alerts_enabled": False}, headers=AUTH).status_code
            == 200
        )
    assert _count("bill_watch_created") == 1
    assert (
        client.patch(path, json={"note": "synthetic note"}, headers=AUTH).status_code
        == 200
    )
    assert _count("bill_watch_created") == 1
    assert client.delete(path, headers=AUTH).status_code == 204
    assert client.put(path, json={}, headers=AUTH).status_code == 200
    assert _count("bill_watch_created") == 2


def test_committee_retries_do_not_create_counts_and_removal_preserves_them(
    reader, monkeypatch
):
    client, _ = reader
    monkeypatch.setattr(me, "_committee_we_hold", lambda *args: True)
    path = "/api/v1/me/tracked-committees/synthetic-metrics"
    for _ in range(3):
        assert client.put(path, headers=AUTH).status_code == 200
    assert _count("committee_watch_created") == 1
    assert client.delete(path, headers=AUTH).status_code == 204
    assert _count("committee_watch_created") == 1


def test_missing_targets_do_not_create_follow_counts(reader, monkeypatch):
    client, _ = reader
    assert (
        client.put(
            "/api/v1/me/tracked-bills/missing", json={}, headers=AUTH
        ).status_code
        == 404
    )
    monkeypatch.setattr(me, "_committee_we_hold", lambda *args: False)
    assert (
        client.put("/api/v1/me/tracked-committees/missing", headers=AUTH).status_code
        == 404
    )
    assert _count("bill_watch_created") == _count("committee_watch_created") == 0


def test_first_local_account_counts_once_across_reads_and_identity_linking(reader):
    client, auth = reader
    first = client.get("/api/v1/me", headers=AUTH)
    assert first.status_code == 200
    assert _count("account_created") == 1
    assert client.get("/api/v1/me", headers=AUTH).status_code == 200
    auth.principal = replace(auth.principal, provider_subject=str(uuid4()))
    second = client.get("/api/v1/me", headers=AUTH)
    assert second.json()["data"]["id"] == first.json()["data"]["id"]
    assert _count("account_created") == 1


@pytest.mark.parametrize(
    "email",
    [
        "eug+metrics@alethical.com",
        "angel@alethical.com",
        "Af.Netter+metrics@googlemail.com",
        "reader@example.com",
    ],
)
def test_excluded_accounts_and_their_follows_do_not_count(reader, monkeypatch, email):
    client, auth = reader
    auth.principal = replace(auth.principal, email=email)
    assert (
        client.put(
            f"/api/v1/me/tracked-bills/{_bill_key()}", json={}, headers=AUTH
        ).status_code
        == 200
    )
    monkeypatch.setattr(me, "_committee_we_hold", lambda *args: True)
    assert (
        client.put(
            "/api/v1/me/tracked-committees/synthetic-excluded", headers=AUTH
        ).status_code
        == 200
    )
    assert (
        _count("account_created")
        == _count("bill_watch_created")
        == _count("committee_watch_created")
        == 0
    )
    decision = client.get("/api/v1/site-metrics/collection", headers=AUTH)
    assert decision.json() == {
        "collect": False,
        "teamAccount": True,
        "teamExclusionConfigured": True,
    }
    assert decision.headers["cache-control"] == "private, no-store"


def test_configured_subject_exclusion_applies_before_identity_creation(
    reader, monkeypatch
):
    client, auth = reader
    monkeypatch.setenv("TRAFFIC_EXCLUDED_ACCOUNT_IDS", auth.principal.provider_subject)
    assert client.get("/api/v1/me", headers=AUTH).status_code == 200
    assert _count("account_created") == 0


def test_collection_eligibility_requires_authentication_and_allows_a_reader(reader):
    client, _ = reader
    assert client.get("/api/v1/site-metrics/collection").status_code == 401
    assert (
        client.get("/api/v1/site-metrics/collection", headers=AUTH).json()["collect"]
        is True
    )


def test_deactivated_account_does_not_turn_into_an_anonymous_event(reader):
    client, _ = reader
    user_id = client.get("/api/v1/me", headers=AUTH).json()["data"]["id"]
    with get_session_factory()() as db:
        db.get(schema.UserAccount, user_id).is_active = False
        before = db.scalar(select(func.count()).select_from(schema.SiteMetricEvent))
        db.commit()
    assert (
        client.post(
            "/api/v1/site-metrics/events",
            headers=AUTH,
            json={"event": "money_search_with_results", "eventId": str(uuid4())},
        ).status_code
        == 204
    )
    with get_session_factory()() as db:
        assert (
            db.scalar(select(func.count()).select_from(schema.SiteMetricEvent))
            == before
        )
        assert (
            db.scalar(select(func.count()).select_from(schema.SiteMetricReceipt)) == 0
        )


def test_creation_counter_is_atomic_under_concurrent_transactions():
    def increment(_):
        with get_session_factory()() as db:
            history_service.record_creation(db, "bill_watch_created")
            db.commit()

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(increment, range(32)))
    assert _count("bill_watch_created") == 32


def test_rollback_removes_count_and_coverage():
    with get_session_factory()() as db:
        history_service.record_creation(db, "account_created")
        db.rollback()
    assert _count("account_created") == 0
    with get_session_factory()() as db:
        assert db.get(schema.SiteMetricCoverage, "account_created") is None


def test_failed_account_provision_rolls_back_personal_rows_and_count(
    reader, monkeypatch
):
    client, auth = reader
    original = auth_module.record_creation

    def fail_after_increment(db, kind):
        original(db, kind)
        raise RuntimeError("synthetic account rollback")

    monkeypatch.setattr(auth_module, "record_creation", fail_after_increment)
    with pytest.raises(RuntimeError, match="synthetic account rollback"):
        client.get("/api/v1/me", headers=AUTH)
    assert _count("account_created") == 0
    with get_session_factory()() as db:
        assert (
            db.scalar(
                select(schema.AuthIdentity.id).where(
                    schema.AuthIdentity.provider_subject
                    == auth.principal.provider_subject
                )
            )
            is None
        )
        assert (
            db.scalar(
                select(schema.UserAccount.id).where(
                    schema.UserAccount.primary_email == auth.principal.email
                )
            )
            is None
        )


def test_failed_follow_transaction_cannot_keep_an_anonymous_count(reader, monkeypatch):
    client, _ = reader
    assert client.get("/api/v1/me", headers=AUTH).status_code == 200
    original = me.record_creation

    def fail_after_increment(db, kind):
        original(db, kind)
        raise RuntimeError("synthetic rollback check")

    monkeypatch.setattr(me, "record_creation", fail_after_increment)
    with pytest.raises(RuntimeError, match="synthetic rollback check"):
        client.put(f"/api/v1/me/tracked-bills/{_bill_key()}", json={}, headers=AUTH)
    assert _count("bill_watch_created") == 0


def test_deleting_personal_rows_leaves_only_anonymous_totals(reader):
    client, _ = reader
    response = client.get("/api/v1/me", headers=AUTH)
    user_id = response.json()["data"]["id"]
    with get_session_factory()() as db:
        db.execute(
            delete(schema.AuthIdentity).where(schema.AuthIdentity.user_id == user_id)
        )
        db.execute(delete(schema.UserAccount).where(schema.UserAccount.id == user_id))
        db.commit()
    assert _count("account_created") == 1
    assert set(schema.SiteMetricHourlyCount.__table__.columns.keys()) == {
        "metric_kind",
        "bucket_started_at",
        "count",
    }
    assert not schema.SiteMetricHourlyCount.__table__.foreign_keys


def test_empty_inventory_is_not_backfilled_as_creation_history(client):
    data = client.get("/api/v1/site-metrics").json()["data"]
    assert data["totalsSinceStart"] == {
        "newReaderAccounts": 0,
        "newBillWatches": 0,
        "newCommitteeWatches": 0,
    }
    assert data["history"]["newReaderAccounts"]["recordingStartedAt"] is None
    assert data["previousActions7d"]["newReaderAccounts"] is None


def test_event_retry_id_is_per_action_short_lived_and_optional(client):
    event_id = str(uuid4())
    with get_session_factory()() as db:
        before = db.scalar(select(func.count()).select_from(schema.SiteMetricEvent))
    body = {"event": "money_search_with_results", "eventId": event_id}
    for _ in range(3):
        assert client.post("/api/v1/site-metrics/events", json=body).status_code == 204
    with get_session_factory()() as db:
        assert (
            db.scalar(select(func.count()).select_from(schema.SiteMetricEvent))
            == before + 1
        )
        receipt = db.get(schema.SiteMetricReceipt, event_id)
        assert receipt is not None
        assert (
            timedelta(hours=23)
            < receipt.expires_at - datetime.now(timezone.utc)
            <= timedelta(hours=24)
        )
        receipt.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert client.post("/api/v1/site-metrics/events", json=body).status_code == 204
    assert (
        client.post(
            "/api/v1/site-metrics/events", json={"event": "money_search_with_results"}
        ).status_code
        == 204
    )
    with get_session_factory()() as db:
        assert (
            db.scalar(select(func.count()).select_from(schema.SiteMetricEvent))
            == before + 3
        )
    assert set(schema.SiteMetricReceipt.__table__.columns.keys()) == {
        "event_id",
        "expires_at",
    }


def test_receipt_and_event_rollback_together():
    event_id = uuid4()
    now = datetime.now(timezone.utc)
    with get_session_factory()() as db:
        assert history_service.claim_event_receipt(db, event_id, now)
        db.rollback()
    with get_session_factory()() as db:
        assert history_service.claim_event_receipt(db, event_id, now)
        db.rollback()


def test_concurrent_event_retries_create_one_event():
    event_id = uuid4()
    now = datetime.now(timezone.utc)
    with get_session_factory()() as db:
        before = db.scalar(select(func.count()).select_from(schema.SiteMetricEvent))

    def submit(_):
        with get_session_factory()() as db:
            accepted = history_service.claim_event_receipt(db, event_id, now)
            if accepted:
                db.add(schema.SiteMetricEvent(event_kind="money_search_with_results"))
            db.commit()
            return accepted

    with ThreadPoolExecutor(max_workers=8) as executor:
        accepted = list(executor.map(submit, range(16)))
    assert sum(accepted) == 1
    with get_session_factory()() as db:
        assert (
            db.scalar(select(func.count()).select_from(schema.SiteMetricEvent))
            == before + 1
        )


def test_current_following_readers_count_people_once_and_exclude_deactivated(
    reader, monkeypatch
):
    client, auth = reader
    before = client.get("/api/v1/site-metrics").json()["data"]["readers"]
    response = client.get("/api/v1/me", headers=AUTH)
    user_id = response.json()["data"]["id"]
    with get_session_factory()() as db:
        bills = db.scalars(select(schema.Bill).limit(2)).all()
    for bill in bills:
        assert (
            client.put(
                f"/api/v1/me/tracked-bills/{bill.bill_key}", json={}, headers=AUTH
            ).status_code
            == 200
        )
    monkeypatch.setattr(me, "_committee_we_hold", lambda *args: True)
    for _ in range(2):
        registration = str(uuid4())[:20]
        assert (
            client.put(
                f"/api/v1/me/tracked-committees/{registration}", headers=AUTH
            ).status_code
            == 200
        )
    after = client.get("/api/v1/site-metrics").json()["data"]["readers"]
    for key in (
        "currentReaderAccounts",
        "currentBillFollowingReaders",
        "currentCommitteeFollowingReaders",
    ):
        assert after[key] == before[key] + 1
    for key in (
        "currentBillWatches",
        "currentCommitteeWatches",
        "differentCommitteesCurrentlyWatched",
    ):
        assert after[key] == before[key] + 2
    with get_session_factory()() as db:
        db.get(schema.UserAccount, user_id).is_active = False
        db.commit()
    inactive = client.get("/api/v1/site-metrics").json()["data"]["readers"]
    assert inactive == before


def test_event_contract_rejects_identity_and_large_bodies_before_auth(client):
    for body in (
        {"event": "money_search_with_results", "eventId": "not-a-uuid"},
        {"event": "money_search_with_results", "sessionId": str(uuid4())},
        {"event": "money_search_with_results", "email": "synthetic@example.com"},
    ):
        assert client.post("/api/v1/site-metrics/events", json=body).status_code == 422
    response = client.post(
        "/api/v1/site-metrics/events",
        content=b" " * 513,
        headers={"Authorization": "Bearer invalid", "Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_rolling_windows_share_completed_hour_and_incomplete_history_is_unknown(client):
    now = datetime.now(timezone.utc)
    end = history_service.completed_hour(now)
    start = end - timedelta(days=7)
    with get_session_factory()() as db:
        db.add(
            schema.SiteMetricCoverage(
                metric_kind="account_created", recording_started_at=start
            )
        )
        for at, count in (
            (end, 100),
            (end - timedelta(hours=1), 3),
            (start, 5),
            (start - timedelta(hours=1), 7),
        ):
            db.add(
                schema.SiteMetricHourlyCount(
                    metric_kind="account_created", bucket_started_at=at, count=count
                )
            )
        db.commit()
    data = client.get("/api/v1/site-metrics").json()["data"]
    assert data["periods7d"]["endsAt"] == end.isoformat()
    assert data["periods30d"]["endsAt"] == end.isoformat()
    assert data["actions7d"]["newReaderAccounts"] == 8
    assert data["actions30d"]["newReaderAccounts"] == 15
    assert data["totalsSinceStart"]["newReaderAccounts"] == 15
    assert data["history"]["newReaderAccounts"]["current7dComplete"] is True
    assert data["history"]["newReaderAccounts"]["current30dComplete"] is False
    assert data["previousActions7d"]["newReaderAccounts"] is None
    with get_session_factory()() as db:
        db.get(schema.SiteMetricCoverage, "account_created").recording_started_at = (
            end - timedelta(days=60)
        )
        db.commit()
    complete = client.get("/api/v1/site-metrics").json()["data"]
    assert complete["previousActions7d"]["newReaderAccounts"] == 7
    assert complete["previousActions30d"]["newReaderAccounts"] == 0
