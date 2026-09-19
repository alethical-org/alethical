from __future__ import annotations

import asyncio
import threading

import anyio
import httpx
import pytest
from fastapi import Depends
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool
from starlette.responses import StreamingResponse

from alethical.api import main
from alethical.api.request_admission import MAX_IN_FLIGHT_REQUESTS
from alethical.api.schemas import DetailResponse
from alethical.db import session as database


def _app(monkeypatch, limit=1):
    monkeypatch.setattr(main, "MAX_IN_FLIGHT_REQUESTS", limit, raising=False)
    monkeypatch.setenv("ALETHICAL_CORS_ORIGINS", "https://alethical.com")
    return main.create_app()


def _client(app):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="https://api.alethical.com",
    )


@pytest.mark.asyncio
async def test_production_admission_leaves_connections_and_workers_for_cleanup():
    pool = database.get_engine().pool
    assert isinstance(pool, QueuePool)
    assert MAX_IN_FLIGHT_REQUESTS < pool.size() + pool._max_overflow
    workers = anyio.to_thread.current_default_thread_limiter()
    assert MAX_IN_FLIGHT_REQUESTS < workers.total_tokens


@pytest.mark.asyncio
async def test_busy_database_requests_cannot_starve_response_cleanup(monkeypatch):
    """Finished SELECTs must release their connections before more work enters.

    Before admission, the overflow occupies all 4 worker threads waiting for the
    2 held connections. The completed routes need those same threads to validate
    their responses, so their dependencies cannot close either connection.
    """
    engine = create_engine(
        "sqlite://",
        poolclass=QueuePool,
        pool_size=2,
        max_overflow=0,
        pool_timeout=0.5,
        connect_args={"check_same_thread": False},
    )
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(database, "get_session_factory", lambda: factory)
    app = _app(monkeypatch, limit=2)
    release_queries = threading.Event()
    queries_finished = []

    @app.get("/api/v1/admission-test", response_model=DetailResponse)
    def query(db: Session = Depends(database.get_db)):
        db.execute(text("SELECT 1"))
        queries_finished.append(True)
        release_queries.wait(timeout=2)
        return DetailResponse(data={"ok": True})

    workers = anyio.to_thread.current_default_thread_limiter()
    previous_tokens = workers.total_tokens
    workers.total_tokens = 4
    pending = []
    try:
        async with _client(app) as client:
            admitted = [
                asyncio.create_task(client.get("/api/v1/admission-test"))
                for _ in range(2)
            ]
            pending.extend(admitted)
            async with asyncio.timeout(1):
                while len(queries_finished) != 2:
                    await asyncio.sleep(0.001)
            overflow = [
                asyncio.create_task(client.get("/api/v1/admission-test"))
                for _ in range(6)
            ]
            pending.extend(overflow)
            rejected = await asyncio.wait_for(asyncio.gather(*overflow), 0.25)
            assert [response.status_code for response in rejected] == [503] * 6
            release_queries.set()
            completed = await asyncio.wait_for(asyncio.gather(*admitted), 1)
            assert [response.status_code for response in completed] == [200, 200]
            assert engine.pool.checkedout() == 0
            assert (await client.get("/api/v1/admission-test")).status_code == 200
    finally:
        release_queries.set()
        await asyncio.gather(*pending, return_exceptions=True)
        workers.total_tokens = previous_tokens
        engine.dispose()


@pytest.mark.asyncio
async def test_overload_shares_budget_and_keeps_cors_and_health(monkeypatch):
    app = _app(monkeypatch)
    entered = asyncio.Event()
    release = asyncio.Event()
    readiness_calls = []
    monkeypatch.setattr(
        main, "database_schema_is_ready", lambda: readiness_calls.append(True) or True
    )

    @app.get("/api/v1/admission-test")
    async def occupied():
        entered.set()
        await release.wait()
        return {"ok": True}

    async with _client(app) as client:
        running = asyncio.create_task(client.get("/api/v1/admission-test"))
        try:
            await asyncio.wait_for(entered.wait(), 1)
            for path in ("/api/v1/meta", "/internal/v1/test", "/readyz"):
                response = await asyncio.wait_for(
                    client.get(path, headers={"Origin": "https://alethical.com"}),
                    0.25,
                )
                assert response.status_code == 503
                assert response.headers["cache-control"] == "no-store"
                assert response.headers["retry-after"] == "1"
                assert response.headers["access-control-allow-origin"] == (
                    "https://alethical.com"
                )
                assert (
                    "retry-after"
                    in response.headers["access-control-expose-headers"].lower()
                )
                assert response.json()["status"] == 503
                assert response.json()["instance"] == path
                assert response.json()["type"].endswith("/service-busy")
            assert not readiness_calls
            preflight = await client.options(
                "/api/v1/meta",
                headers={
                    "Origin": "https://alethical.com",
                    "Access-Control-Request-Method": "GET",
                },
            )
            assert preflight.status_code == 200
            assert (await client.get("/healthz")).json() == {"status": "ok"}
            assert (await client.get("/not-an-api-route")).status_code == 404
        finally:
            release.set()
            await running
        assert (await client.get("/readyz")).status_code == 200
        assert readiness_calls == [True]


@pytest.mark.asyncio
async def test_health_does_not_need_a_worker_thread(monkeypatch):
    app = _app(monkeypatch)
    workers = anyio.to_thread.current_default_thread_limiter()
    previous_tokens = workers.total_tokens
    workers.total_tokens = 1
    release = threading.Event()
    occupied = asyncio.create_task(anyio.to_thread.run_sync(release.wait))
    try:
        async with asyncio.timeout(1):
            while workers.borrowed_tokens != 1:
                await asyncio.sleep(0.001)
        async with _client(app) as client:
            response = await asyncio.wait_for(client.get("/healthz"), 0.25)
            assert response.status_code == 200
    finally:
        release.set()
        await occupied
        workers.total_tokens = previous_tokens


@pytest.mark.asyncio
async def test_admission_covers_stream_and_dependency_cleanup(monkeypatch):
    app = _app(monkeypatch)
    cleanup_started = asyncio.Event()
    release_cleanup = asyncio.Event()

    async def dependency():
        try:
            yield
        finally:
            cleanup_started.set()
            await release_cleanup.wait()

    @app.get("/api/v1/admission-test", dependencies=[Depends(dependency)])
    async def streamed():
        async def body():
            yield b"done"

        return StreamingResponse(body())

    async with _client(app) as client:
        running = asyncio.create_task(client.get("/api/v1/admission-test"))
        try:
            await asyncio.wait_for(cleanup_started.wait(), 1)
            response = await client.get("/api/v1/meta")
            assert response.status_code == 503
        finally:
            release_cleanup.set()
            await running
        assert (await client.get("/api/v1/admission-test")).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["cancel", "error"])
async def test_cancelled_or_failed_requests_return_admission(monkeypatch, failure):
    app = _app(monkeypatch)
    entered = asyncio.Event()
    release = asyncio.Event()

    @app.get("/api/v1/admission-test")
    async def interrupted():
        entered.set()
        await release.wait()
        if failure == "error":
            raise RuntimeError("test request failed")
        return {"ok": True}

    async with _client(app) as client:
        running = asyncio.create_task(client.get("/api/v1/admission-test"))
        await asyncio.wait_for(entered.wait(), 1)
        if failure == "cancel":
            running.cancel()
            with pytest.raises(asyncio.CancelledError):
                await running
        else:
            release.set()
            assert (await running).status_code == 500
        release.set()
        response = await client.get("/api/v1/admission-test")
        assert response.status_code == (500 if failure == "error" else 200)
