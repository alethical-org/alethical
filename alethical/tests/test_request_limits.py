from __future__ import annotations

from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from time import monotonic
from types import SimpleNamespace
from uuid import uuid4

import pytest

from alethical.db.session import get_database_url, get_engine
from alethical.pipeline.oban_workers import BillSyncChunkWorker, FullBillSyncWorker
from alethical.pipeline.request_limits import (
    DEFAULT_SOURCE_REQUEST_INTERVAL_SECONDS,
    DatabaseRequestLimiter,
    RateLimitedSession,
)


class RecordingBind:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    @contextmanager
    def begin(self):  # noqa: ANN201
        calls = self.calls

        class Connection:
            def execute(self, statement, params):  # noqa: ANN001, ANN201
                calls.append((str(statement), params))

        yield Connection()


class FakeSession:
    def __init__(self) -> None:
        self.urls: list[str] = []

    def get(self, url: str, **kwargs):  # noqa: ANN001, ANN201
        del kwargs
        self.urls.append(url)
        return object()


def test_database_limiter_locks_and_sleeps_in_1_short_transaction() -> None:
    db = RecordingBind()
    limiter = DatabaseRequestLimiter(
        db,
        interval_seconds=0.25,
        lock_key=123,
    )

    limiter.wait()

    assert [statement for statement, _params in db.calls] == [
        "select pg_advisory_xact_lock(:lock_key)",
        "select pg_sleep(:interval_seconds)",
    ]
    assert db.calls[1][1] == {"interval_seconds": 0.25}


def test_every_get_waits_on_the_database_limiter() -> None:
    db = RecordingBind()
    source = FakeSession()
    session = RateLimitedSession(
        source,
        DatabaseRequestLimiter(db, interval_seconds=0.5),
    )

    session.get("https://www.revisor.mn.gov/first")
    session.get("https://www.revisor.mn.gov/retry")

    assert source.urls == [
        "https://www.revisor.mn.gov/first",
        "https://www.revisor.mn.gov/retry",
    ]
    assert sum("pg_sleep" in statement for statement, _params in db.calls) == 2


def test_database_limit_is_shared_by_separate_worker_connections(
    seed_database: None,
) -> None:
    interval = 0.05
    lock_key = uuid4().int % 2_000_000_000
    starts: list[float] = []

    def wait_for_turn() -> None:
        DatabaseRequestLimiter(
            get_engine(),
            interval_seconds=interval,
            lock_key=lock_key,
        ).wait()
        starts.append(monotonic())

    with ThreadPoolExecutor(max_workers=2) as workers:
        list(workers.map(lambda _index: wait_for_turn(), range(2)))

    starts.sort()
    assert starts[1] - starts[0] >= interval * 0.8


@pytest.mark.asyncio
async def test_every_production_bill_worker_uses_the_database_limiter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[object] = []

    class CapturesSession:
        def __init__(self, _db, sess=None):  # noqa: ANN001
            captured.append(sess)

        def ingest_bills(self, _targets):  # noqa: ANN001
            return {
                "bills_ingested": 1,
                "bill_keys": ["94-2025-HF1"],
                "text_changed_bill_keys": [],
                "bill_refresh_rejections": [],
            }

    monkeypatch.setattr(
        "alethical.pipeline.minnesota.MinnesotaIngestionPipeline",
        CapturesSession,
    )
    monkeypatch.setattr(
        "alethical.pipeline.oban_workers._database_url",
        lambda _args: get_database_url(),
    )

    await BillSyncChunkWorker().process(
        SimpleNamespace(
            args={
                "targets": [
                    {
                        "chamber": "House",
                        "bill_number": "1",
                        "session_code": "0942025",
                    }
                ],
                "dry_run": False,
                "allow_writes": True,
                "include_rag": False,
                "database_target": "production",
            }
        )
    )

    assert len(captured) == 1
    assert isinstance(captured[0], RateLimitedSession)
    assert isinstance(captured[0]._limiter, DatabaseRequestLimiter)
    assert (
        captured[0]._limiter.interval_seconds == DEFAULT_SOURCE_REQUEST_INTERVAL_SECONDS
    )


@pytest.mark.asyncio
async def test_manual_full_sync_discovery_uses_the_same_database_limiter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[object] = []

    class CapturesDiscoverySession:
        def __init__(self, _db, sess=None):  # noqa: ANN001
            captured.append(sess)

        def discover_bill_targets(self, **_kwargs):  # noqa: ANN201
            return []

    monkeypatch.setattr(
        "alethical.pipeline.minnesota.MinnesotaIngestionPipeline",
        CapturesDiscoverySession,
    )
    monkeypatch.setattr(
        "alethical.pipeline.oban_workers._database_url",
        lambda _args: get_database_url(),
    )

    await FullBillSyncWorker().process(
        SimpleNamespace(
            args={
                "dry_run": True,
                "database_target": "production",
            }
        )
    )

    assert len(captured) == 1
    assert isinstance(captured[0], RateLimitedSession)
    assert isinstance(captured[0]._limiter, DatabaseRequestLimiter)
