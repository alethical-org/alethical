"""Restricted dispatch, durable duplicate protection and harmless failure."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
import threading
import uuid

import httpx
import pytest
from sqlalchemy import delete

from alethical.api.services import source_refresh_dispatch as service
from alethical.db.models import SourceRefreshState
from alethical.db.session import get_session_factory

NOW = datetime(2026, 10, 7, tzinfo=UTC)


@pytest.fixture(autouse=True)
def isolated(monkeypatch, seed_database):
    engine = get_session_factory().kw["bind"]
    SourceRefreshState.__table__.create(engine, checkfirst=True)
    with get_session_factory()() as db:
        db.execute(delete(SourceRefreshState))
        db.commit()
    monkeypatch.setenv("ALETHICAL_SOURCE_REFRESH_DISPATCH_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_SOURCE_REFRESH_APP_ID", "123")
    monkeypatch.setenv("ALETHICAL_SOURCE_REFRESH_INSTALLATION_ID", "456")
    monkeypatch.setenv("ALETHICAL_SOURCE_REFRESH_PRIVATE_KEY", "private-test-key")
    monkeypatch.setattr(service.jwt, "encode", lambda *a, **kw: "signed-test-jwt")
    real_jobs = service.jobs
    monkeypatch.setattr(service, "jobs", lambda *a: {"maps": real_jobs()["maps"]})
    monkeypatch.setattr(service, "due_names", lambda db, **kw: ["maps"])


def client_for(requests, *, dispatch=200, permissions=None):
    def handle(request):
        import json

        requests.append((request.url.path, json.loads(request.content)))
        if request.url.path.endswith("access_tokens"):
            assert request.headers["Authorization"] == "Bearer signed-test-jwt"
            return httpx.Response(
                201,
                json={
                    "token": "installation-test-token",
                    "permissions": permissions
                    or {"actions": "write", "metadata": "read"},
                },
            )
        assert request.headers["Authorization"] == "Bearer installation-test-token"
        return httpx.Response(dispatch, json={"workflow_run_id": 12345})

    return httpx.Client(transport=httpx.MockTransport(handle))


def test_fixed_workflow_scope_and_no_false_collection_success():
    requests = []
    with client_for(requests) as client:
        result = service.dispatch_due(get_session_factory(), now=NOW, client=client)
    assert result == [{"job": "maps", "status": "dispatched"}]
    assert requests == [
        (
            "/app/installations/456/access_tokens",
            {"repository_ids": [1188303032], "permissions": {"actions": "write"}},
        ),
        (
            "/repos/alethical-org/alethical/actions/workflows/source-record-refresh.yml/dispatches",
            {"ref": "main", "inputs": {"job": "maps"}},
        ),
    ]
    with get_session_factory()() as db:
        row = db.get(SourceRefreshState, "dispatch:maps")
        assert row.last_dispatched_at == NOW
        assert row.last_checked_at is None and row.last_succeeded_at is None
        assert row.progress == {"workflow_run_id": 12345}
        assert db.get(SourceRefreshState, "maps") is None


def test_cooldown_survives_next_process_and_then_retries():
    requests = []
    with client_for(requests) as client:
        service.dispatch_due(get_session_factory(), now=NOW, client=client)
        assert (
            service.dispatch_due(
                get_session_factory(), now=NOW + timedelta(minutes=29), client=client
            )
            == []
        )
        assert len(requests) == 2
        assert service.dispatch_due(
            get_session_factory(), now=NOW + timedelta(minutes=30), client=client
        )


def test_failure_retains_due_work_and_short_retry():
    requests = []
    with client_for(requests, dispatch=503) as client:
        assert (
            service.dispatch_due(get_session_factory(), now=NOW, client=client)[0][
                "status"
            ]
            == "dispatch_failed"
        )
        assert (
            service.dispatch_due(
                get_session_factory(), now=NOW + timedelta(minutes=4), client=client
            )
            == []
        )
    with get_session_factory()() as db:
        row = db.get(SourceRefreshState, "dispatch:maps")
        assert row.last_dispatched_at is None
        assert row.next_due_at == NOW + timedelta(minutes=5)
        assert row.failures == 1


@pytest.mark.parametrize("state", ["not_due", "running"])
def test_does_not_dispatch_future_or_running_job(state):
    with get_session_factory()() as db:
        db.add(
            SourceRefreshState(
                name="maps",
                next_due_at=NOW + timedelta(days=1) if state == "not_due" else NOW,
                lease_expires_at=NOW + timedelta(minutes=1)
                if state == "running"
                else None,
            )
        )
        db.commit()
    with client_for([]) as client:
        assert service.dispatch_due(get_session_factory(), now=NOW, client=client) == []


def test_concurrent_wakes_claim_once():
    barrier = threading.Barrier(2)

    def claim():
        barrier.wait()
        with get_session_factory()() as db:
            return service._claim(db, "maps", NOW)

    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda _: claim(), range(2)))
    assert sum(isinstance(value, uuid.UUID) for value in results) == 1


def test_interrupted_dispatch_recovers_after_lease():
    with get_session_factory()() as db:
        original = service._claim(db, "maps", NOW)
    with get_session_factory()() as db:
        assert service._claim(db, "maps", NOW + timedelta(minutes=4)) is None
    with get_session_factory()() as db:
        replacement = service._claim(db, "maps", NOW + timedelta(minutes=5))
        assert replacement is not None and replacement != original
    with get_session_factory()() as db:
        service._finish(db, "maps", original, NOW, True, 1)
        assert db.get(SourceRefreshState, "dispatch:maps").token == replacement


def test_rejects_broad_token_response():
    requests = []
    with client_for(
        requests, permissions={"actions": "write", "contents": "write"}
    ) as client:
        result = service.dispatch_due(get_session_factory(), now=NOW, client=client)
    assert result[0]["status"] == "dispatch_failed"
    assert len(requests) == 1


def test_disabled_by_default_and_no_personal_token_fallback(monkeypatch):
    monkeypatch.delenv("ALETHICAL_SOURCE_REFRESH_DISPATCH_ENABLED")
    monkeypatch.setenv("GITHUB_TOKEN", "broad-token-must-not-be-used")
    assert service.dispatch_due(None) == []
    monkeypatch.setenv("ALETHICAL_SOURCE_REFRESH_DISPATCH_ENABLED", "true")
    monkeypatch.delenv("ALETHICAL_SOURCE_REFRESH_PRIVATE_KEY")
    with pytest.raises(ValueError, match="incomplete"):
        service.dispatch_due(None)


def test_signing_claims_and_key_are_not_printable(monkeypatch):
    calls = []

    def encode(payload, key, algorithm):
        calls.append((payload, key, algorithm))
        return "signed-test-jwt"

    monkeypatch.setattr(service.jwt, "encode", encode)
    config = service.configuration()
    assert "private-test-key" not in repr(config)
    with client_for([]) as client:
        service.installation_token(client, config, NOW)
    assert calls == [
        (
            {
                "iat": int(NOW.timestamp()) - 60,
                "exp": int(NOW.timestamp()) + 540,
                "iss": "123",
            },
            "private-test-key",
            "RS256",
        )
    ]


def test_http_timeout_is_retryable_without_retaining_exception():
    def timeout(request):
        raise httpx.ReadTimeout("private-response-must-not-be-stored")

    with httpx.Client(transport=httpx.MockTransport(timeout)) as client:
        result = service.dispatch_due(get_session_factory(), now=NOW, client=client)
    assert result == [{"job": "maps", "status": "dispatch_failed"}]
    with get_session_factory()() as db:
        row = db.get(SourceRefreshState, "dispatch:maps")
        assert row.finding is None and row.progress == {}
        assert row.token is None and row.lease_expires_at is None


def test_legacy_accepted_response_and_stop_event():
    stop = threading.Event()
    stop.set()
    with client_for([], dispatch=204) as client:
        assert (
            service.dispatch_due(
                get_session_factory(), now=NOW, client=client, stop_event=stop
            )
            == []
        )
        assert (
            service.dispatch_due(
                get_session_factory(), now=NOW, client=client, max_dispatches=0
            )
            == []
        )
        assert (
            service.dispatch_due(get_session_factory(), now=NOW, client=client)[0][
                "status"
            ]
            == "dispatched"
        )
    with get_session_factory()() as db:
        assert db.get(SourceRefreshState, "dispatch:maps").progress == {}


def test_busy_lane_prevents_waking_competing_job(monkeypatch):
    from dataclasses import replace

    job = replace(service.jobs()["maps"], lane="campaign")
    monkeypatch.setattr(service, "jobs", lambda *a: {"maps": job})
    with get_session_factory()() as db:
        db.add(
            SourceRefreshState(
                name="lane:campaign",
                next_due_at=NOW,
                lease_expires_at=NOW + timedelta(minutes=1),
            )
        )
        db.commit()
    with client_for([]) as client:
        assert service.dispatch_due(get_session_factory(), now=NOW, client=client) == []
