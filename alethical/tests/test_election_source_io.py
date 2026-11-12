"""Real concurrent source work stays bounded and never becomes a stale verdict."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, Lock
import time

import pytest

from alethical.api.services import election_source_io as io
from alethical.pipeline.election_comparison import ComparisonImportError


class Store:
    def __init__(self):
        self.calls = 0
        self.active = 0
        self.peak = 0
        self.lock = Lock()
        self.body = b"retained original"
        self.fail = False

    def get(self, key, path, *, max_bytes=None):
        with self.lock:
            self.calls += 1
            self.active += 1
            self.peak = max(self.peak, self.active)
        try:
            time.sleep(0.005)
            if self.fail:
                raise OSError("Original unavailable")
            Path(path).write_bytes(self.body)
        finally:
            with self.lock:
                self.active -= 1


def test_reader_client_bounds_calls_without_changing_ingestion(monkeypatch):
    import boto3
    from alethical.pipeline import raw_file_store

    captured = []

    def client(service, **kwargs):
        assert service == "s3"
        captured.append(kwargs)
        return object()

    for name in raw_file_store.REQUIRED_ENV:
        monkeypatch.setenv(name, "fixture")
    monkeypatch.setattr(boto3, "client", client)
    io.reader_store_from_env()
    raw_file_store.raw_file_store_from_env()
    bounded, ordinary = [call["config"] for call in captured]
    assert bounded.max_pool_connections == io.SOURCE_WORKERS
    assert bounded.connect_timeout == 10 and bounded.read_timeout == 30
    assert bounded.retries == {"total_max_attempts": 1}
    assert bounded.signature_version == ordinary.signature_version == "s3v4"
    assert bounded.s3 == ordinary.s3 == {"addressing_style": "path"}
    assert ordinary.connect_timeout == ordinary.read_timeout == 60
    assert ordinary.retries is None


def test_concurrent_requests_share_process_ceiling_and_preserve_every_result(tmp_path):
    original = Store()

    def request(request_id):
        store = io.FreshReadStore(original)

        def check(number):
            path = tmp_path / f"{request_id}-{number}"
            store.get(str(number), path, max_bytes=100)
            return number, path.read_bytes()

        return list(io.source_map(check, range(48)))

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(request, range(3)))
    assert all(rows == [(i, original.body) for i in range(48)] for rows in results)
    assert original.calls == 144
    assert 1 < original.peak <= io.SOURCE_WORKERS
    assert original.active == 0


def test_same_request_shares_fetch_and_new_request_rereads_original(tmp_path):
    original = Store()
    store = io.FreshReadStore(original)

    def get(number):
        path = tmp_path / str(number)
        store.get("same", path, max_bytes=100)
        return path.read_bytes()

    with ThreadPoolExecutor(max_workers=16) as pool:
        assert list(pool.map(get, range(32))) == [original.body] * 32
    assert original.calls == 1
    assert store.size == len(original.body)
    original.body = b"changed original"
    fresh = io.request_store(original)
    fresh.get("same", tmp_path / "fresh", max_bytes=100)
    assert (tmp_path / "fresh").read_bytes() == original.body
    assert original.calls == 2
    assert io.request_store(store) is store


def test_cache_eviction_length_and_failed_fetch_keep_sources_honest(tmp_path):
    original = Store()
    original.body = b"12345678"
    store = io.FreshReadStore(original, limit=12)
    for key in ("one", "two", "one"):
        store.get(key, tmp_path / key, max_bytes=8)
        assert store.size <= 12
    assert original.calls == 3
    with pytest.raises(ComparisonImportError, match="retained length"):
        store.get("one", tmp_path / "small", max_bytes=7)
    assert original.calls == 3
    original.fail = True
    with pytest.raises(OSError):
        store.get("missing", tmp_path / "missing", max_bytes=8)
    original.fail = False
    store.get("missing", tmp_path / "missing", max_bytes=8)
    assert original.calls == 5
    original.body = b"larger than cache"
    for _ in range(2):
        store.get("large", tmp_path / "large", max_bytes=100)
    assert original.calls == 7 and store.size <= 12
    with pytest.raises(ComparisonImportError, match="retained length"):
        store.get("bad-length", tmp_path / "bad", max_bytes=1)
    assert "bad-length" not in store.entries


def test_abandoned_and_failed_work_drains_started_jobs_and_bounds_input():
    release = Event()
    lock = Lock()
    consumed = 0
    active = 0

    def jobs():
        nonlocal consumed
        for number in range(1000):
            consumed += 1
            yield number

    def work(number):
        nonlocal active
        with lock:
            active += 1
        try:
            if number:
                assert release.wait(timeout=3)
            return number
        finally:
            with lock:
                active -= 1

    iterator = io.source_map(work, jobs())
    assert next(iterator) == 0
    assert consumed == io.SOURCE_WORKERS
    release.set()
    iterator.close()
    assert active == 0 and consumed == io.SOURCE_WORKERS

    def fails(number):
        if number == 0:
            raise ValueError("failed original")
        return work(number)

    with pytest.raises(ValueError, match="failed original"):
        list(io.source_map(fails, range(1000)))
    assert active == 0
    assert list(io.source_map(lambda n: n + 1, [1, 2])) == [2, 3]


def test_eviction_releases_old_bytes_before_loading_replacement(tmp_path):
    import shutil
    import tracemalloc

    source = tmp_path / "original"
    source.write_bytes(b"x" * (4 * 1024 * 1024))

    class FileStore:
        def get(self, key, path, *, max_bytes=None):
            shutil.copyfile(source, path)

    limit = 6 * 1024 * 1024
    store = io.FreshReadStore(FileStore(), limit=limit)
    tracemalloc.start()
    try:
        store.get("first", tmp_path / "first", max_bytes=4 * 1024 * 1024)
        store.get("second", tmp_path / "second", max_bytes=4 * 1024 * 1024)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert store.size == 4 * 1024 * 1024
    assert peak < limit + 1024 * 1024


def test_interrupt_while_waiting_drains_the_current_running_job(monkeypatch):
    from concurrent.futures import Future
    from threading import Thread

    started, release, interrupted, ended = Event(), Event(), Event(), Event()
    finished = Event()
    actual_result = Future.result

    def work(_):
        started.set()
        assert release.wait(timeout=3)
        finished.set()

    def interrupt_result(future, *args, **kwargs):
        if not interrupted.is_set():
            assert started.wait(timeout=3)
            interrupted.set()
            raise KeyboardInterrupt()
        return actual_result(future, *args, **kwargs)

    def owner():
        try:
            list(io.source_map(work, [1]))
        except KeyboardInterrupt:
            pass
        finally:
            ended.set()

    monkeypatch.setattr(Future, "result", interrupt_result)
    thread = Thread(target=owner)
    thread.start()
    try:
        assert interrupted.wait(timeout=3)
        assert not ended.wait(timeout=0.05), (
            "Owner exited before its running source read"
        )
    finally:
        release.set()
        thread.join(timeout=3)
    assert ended.is_set() and finished.is_set() and not thread.is_alive()
