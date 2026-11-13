"""Real concurrent source work stays bounded and never becomes a stale verdict."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, Lock, Thread
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


def test_outcome_capacity_is_retryable_instead_of_missing_source(monkeypatch):
    from fastapi import HTTPException
    from alethical.pipeline import election_outcomes
    from alethical.pipeline.election_source_files import SourceFileLimitError

    def busy(*args, **kwargs):
        raise SourceFileLimitError("Source proof budget is occupied")

    monkeypatch.setattr(election_outcomes, "applicable_outcomes", busy)
    with pytest.raises(HTTPException) as exc:
        io.outcome_map(None, snapshot_id="snapshot", race_ids=["race"], store=Store())
    assert exc.value.status_code == 503
    assert exc.value.headers == {"Retry-After": "1"}


def test_outcome_without_sources_does_not_need_storage_configuration(monkeypatch):
    from alethical.pipeline import election_outcomes

    def unconfigured():
        raise AssertionError("No outcome bytes requested")

    monkeypatch.setattr(io, "reader_store_from_env", unconfigured)
    monkeypatch.setattr(election_outcomes, "applicable_outcomes", lambda *a, **k: {})
    assert io.outcome_map(None, snapshot_id="snapshot") == {}


def test_outcome_request_reuses_bytes_but_next_request_rechecks(monkeypatch, tmp_path):
    from alethical.pipeline import election_outcomes

    original = Store()
    seen = []
    monkeypatch.setattr(io, "reader_store_from_env", lambda: original)

    def read(db, *, snapshot_id, race_ids, store):
        seen.append(store)
        values = []
        for name in ("original", "binding"):
            path = tmp_path / name
            store.get("same", path, max_bytes=100)
            values.append(path.read_bytes())
        return {race_ids[0]: values}

    monkeypatch.setattr(election_outcomes, "applicable_outcomes", read)
    args = dict(snapshot_id="snapshot", race_ids=["race"])
    first = io.outcome_map(None, **args)
    assert original.calls == 1
    original.body = b"changed original"
    second = io.outcome_map(None, **args)
    assert original.calls == 2
    assert first != second
    scope = io.request_store(original)
    io.outcome_map(None, **args, store=scope)
    assert isinstance(seen[-1], io.SourceReadScope)
    assert seen[-1].store is scope


def test_outcome_request_does_not_relabel_other_validation_errors(monkeypatch):
    from alethical.pipeline import election_outcomes

    def invalid(*args, **kwargs):
        raise ComparisonImportError("Wrong source identity")

    monkeypatch.setattr(election_outcomes, "applicable_outcomes", invalid)
    with pytest.raises(ComparisonImportError, match="Wrong source identity"):
        io.outcome_map(None, snapshot_id="snapshot", store=Store())


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


def test_outcome_default_get_uses_bounded_reader_client(monkeypatch, tmp_path):
    import boto3
    from io import BytesIO
    from alethical.pipeline import election_outcomes, raw_file_store

    configs = []

    class Client:
        def get_object(self, **kwargs):
            return {"ContentLength": 8, "Body": BytesIO(b"original")}

    def client(service, **kwargs):
        configs.append(kwargs["config"])
        return Client()

    for name in raw_file_store.REQUIRED_ENV:
        monkeypatch.setenv(name, "fixture")
    monkeypatch.setattr(boto3, "client", client)

    def check(db, *, snapshot_id, race_ids, store):
        assert not configs  # No eager client before proof actually needs bytes.
        store.get("original", tmp_path / "proof", max_bytes=8)
        return {}

    monkeypatch.setattr(election_outcomes, "applicable_outcomes", check)
    assert io.outcome_map(None, snapshot_id="snapshot") == {}
    assert (tmp_path / "proof").read_bytes() == b"original"
    assert len(configs) == 1
    config = configs[0]
    assert config.connect_timeout == 10 and config.read_timeout == 30
    assert config.max_pool_connections == io.SOURCE_WORKERS
    assert config.retries == {"total_max_attempts": 1}


@pytest.mark.parametrize("ordered", [True, False])
def test_concurrent_requests_share_process_ceiling_and_preserve_every_result(
    tmp_path, ordered
):
    original = Store()

    def request(request_id):
        store = io.FreshReadStore(original)

        def check(number):
            path = tmp_path / f"{request_id}-{number}"
            store.get(str(number), path, max_bytes=100)
            return number, path.read_bytes()

        return list(io.source_map(check, range(48), ordered=ordered))

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(request, range(3)))
    assert all(
        sorted(rows) == [(i, original.body) for i in range(48)] for rows in results
    )
    if ordered:
        assert all(rows == sorted(rows) for rows in results)
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


def test_unordered_source_map_refills_while_first_job_is_held():
    release, started, refilled = Event(), Event(), Event()
    results, errors = [], []

    def work(number):
        if number == 0:
            started.set()
            assert release.wait(timeout=3)
        if number == io.SOURCE_WORKERS:
            refilled.set()
        return number

    def consume():
        try:
            results.extend(io.source_map(work, range(48), ordered=False))
        except BaseException as error:
            errors.append(error)

    owner = Thread(target=consume)
    owner.start()
    try:
        assert started.wait(timeout=3)
        assert refilled.wait(timeout=1), "Slow first job blocked a free source slot"
        assert 0 not in results
    finally:
        release.set()
        owner.join(timeout=3)
    assert not owner.is_alive() and not errors
    assert sorted(results) == list(range(48))
    assert len(set(results)) == len(results)


@pytest.mark.parametrize("ordered", [True, False])
@pytest.mark.parametrize("failure", ["close", "worker", "input", "interrupt"])
def test_source_map_bounds_input_and_drains(ordered, failure):
    release, started, failed, ended = Event(), Event(), Event(), Event()
    errors, consumed = [], []
    active = set()
    lock = Lock()

    def work(number):
        if number == 0 and failure != "input":
            if failure != "close":
                assert started.wait(timeout=3)
                failed.set()
                if failure == "interrupt":
                    raise KeyboardInterrupt()
                raise ValueError("worker failure")
            return number
        with lock:
            active.add(number)
        try:
            started.set()
            assert release.wait(timeout=3)
            return number
        finally:
            with lock:
                active.remove(number)

    def jobs():
        for number in range(1000):
            if number == 2 and failure == "input":
                assert started.wait(timeout=3)
                failed.set()
                raise ValueError("input failure")
            consumed.append(number)
            yield number

    def consume():
        iterator = io.source_map(work, jobs(), ordered=ordered)
        try:
            if failure == "close":
                assert next(iterator) == 0
                assert started.wait(timeout=3)
                failed.set()
                iterator.close()
            else:
                list(iterator)
        except BaseException as error:
            errors.append(error)
        finally:
            ended.set()

    owner = Thread(target=consume)
    owner.start()
    try:
        assert failed.wait(timeout=3)
        assert not ended.wait(timeout=0.05)
        assert len(consumed) == (2 if failure == "input" else io.SOURCE_WORKERS)
    finally:
        release.set()
        owner.join(timeout=3)
    assert ended.is_set() and not active
    if failure == "close":
        assert not errors
    else:
        assert len(errors) == 1
        assert isinstance(
            errors[0], KeyboardInterrupt if failure == "interrupt" else ValueError
        )


def test_default_source_map_keeps_input_order_when_later_jobs_finish():
    release, later_done = Event(), Event()
    results = []

    def work(number):
        if number == 0:
            assert release.wait(timeout=3)
        else:
            later_done.set()
        return number

    owner = Thread(target=lambda: results.extend(io.source_map(work, range(32))))
    owner.start()
    try:
        assert later_done.wait(timeout=3)
        assert not results
    finally:
        release.set()
        owner.join(timeout=3)
    assert not owner.is_alive() and results == list(range(32))


@pytest.mark.parametrize("ordered", [True, False])
def test_async_interrupt_during_cleanup_still_drains_started_jobs(monkeypatch, ordered):
    import os
    import signal

    release, started, draining, interrupted = Event(), Event(), Event(), Event()
    finished, returned = Event(), Event()
    actual_wait = io.wait

    def work(number):
        if number == 0:
            assert started.wait(timeout=3)
            return number
        started.set()
        assert release.wait(timeout=3)
        finished.set()
        return number

    def waiting(futures, **kwargs):
        if not kwargs:  # Cleanup, rather than completion-order result waiting.
            draining.set()
        try:
            return actual_wait(futures, **kwargs)
        except KeyboardInterrupt:
            interrupted.set()
            raise

    def interrupt():
        try:
            assert draining.wait(timeout=3)
            os.kill(os.getpid(), signal.SIGINT)
            assert interrupted.wait(timeout=3)
            assert not returned.wait(timeout=0.05)
        finally:
            release.set()

    monkeypatch.setattr(io, "wait", waiting)
    iterator = io.source_map(work, [0, 1], ordered=ordered)
    assert next(iterator) == 0
    interrupter = Thread(target=interrupt)
    interrupter.start()
    try:
        with pytest.raises(KeyboardInterrupt):
            iterator.close()
    finally:
        returned.set()
        release.set()
        interrupter.join(timeout=3)
    assert finished.is_set() and not interrupter.is_alive()
