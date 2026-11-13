"""External readers must not turn failed source operations into checked gaps."""

import gzip
import hashlib
import io
from pathlib import Path
from types import SimpleNamespace
from typing import cast

from botocore.exceptions import ClientError, ReadTimeoutError
from fastapi import HTTPException
import pytest

from alethical.api.services import election_external_finance_reads as reads
from alethical.api.services import election_source_io as source_io
from alethical.db import models as m
from alethical.pipeline import election_external_finance as storage
from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.pipeline.election_source_files import (
    SourceFileError,
    verified_source_files,
)
from alethical.pipeline.raw_file_store import (
    StorageObjectMissingError,
    StorageReadError,
)


RAW = b"%PDF-1.7\nsynthetic original\n"
STORED = gzip.compress(RAW, mtime=0)
HASH = hashlib.sha256(RAW).hexdigest()
ROW = SimpleNamespace(
    content_hash=HASH,
    object_key="private/source",
    byte_size=len(RAW),
    compressed_hash=hashlib.sha256(STORED).hexdigest(),
    compressed_byte_size=len(STORED),
    compression="gzip",
)


class Store:
    def __init__(self, error=None):
        self.error, self.calls = error, 0

    def get(self, key, path, *, max_bytes):
        self.calls += 1
        if self.error is not None:
            raise self.error
        Path(path).write_bytes(STORED)


class DB:
    def __init__(self, row=ROW):
        self.row = row

    def scalars(self, _):
        return [self.row] if self.row else []

    def get(self, *_):
        return self.row

    def scalar(self, _):
        return [{"sha256": HASH, "media_type": "application/pdf"}]


def timeout():
    return ReadTimeoutError(endpoint_url="private/source", error="private/source")


def assert_busy(call):
    with pytest.raises(HTTPException) as caught:
        call()
    assert caught.value.status_code == 503
    assert caught.value.headers == {"Retry-After": "1"}
    assert "private/source" not in str(caught.value.detail)


@pytest.mark.parametrize("large", [False, True])
@pytest.mark.parametrize(
    "error", [timeout(), RuntimeError("private/source"), KeyError("private/source")]
)
def test_availability_operational_failure_aborts(large, error):
    row = SimpleNamespace(**vars(ROW))
    if large:
        row.byte_size = 17 * 1024 * 1024
    assert_busy(lambda: reads._availability(DB(row), Store(error), {HASH}))


@pytest.mark.parametrize("large", [False, True])
def test_availability_explicit_missing_stays_gap(large):
    row = SimpleNamespace(**vars(ROW))
    if large:
        row.byte_size = 17 * 1024 * 1024
    assert reads._availability(
        DB(row), Store(StorageObjectMissingError("private/source")), {HASH}
    )[1] == {HASH: False}


def test_missing_metadata_does_not_attempt_get():
    store = Store(timeout())
    assert reads._availability(DB(None), store, {HASH})[1] == {HASH: False}
    assert store.calls == 0


def test_fresh_read_local_short_read_is_operational(monkeypatch, tmp_path):
    original = Path.read_bytes
    monkeypatch.setattr(Path, "read_bytes", lambda path: original(path)[:-1])
    scope = source_io.request_store(Store())
    with pytest.raises(StorageReadError):
        scope.get(ROW.object_key, tmp_path / "copy", max_bytes=len(STORED))
    assert not scope.entries


def test_late_inventory_get_failure_is_not_unknown_version(monkeypatch):
    generation = {
        "id": "generation",
        "sources": [
            {"sha256": HASH, "authority": "local:test", "media_type": "application/pdf"}
        ],
        "reports": [{"report_key": "report", "version_binding": {}}],
    }
    monkeypatch.setattr(storage, "version_dependencies", lambda *a, **k: {HASH})
    monkeypatch.setattr(storage, "_current_readings", lambda *a, **k: True)
    monkeypatch.setattr(
        storage, "validate_report_version", lambda *a, **k: {"effective": True}
    )
    original = Store()
    scope = source_io.FreshReadStore(original, limit=0)
    assert reads._availability(DB(), scope, {HASH})[1] == {HASH: True}
    original.error = timeout()
    assert_busy(
        lambda: reads._inventory_versions(DB(), scope, generation, {HASH: True}, {})
    )
    assert original.calls == 2


def test_source_body_operational_failure_has_safe_retry(monkeypatch):
    monkeypatch.setattr(reads.finance_versions, "pin", lambda *_: None)
    monkeypatch.setattr(
        reads, "_published_row", lambda *_: SimpleNamespace(id="generation")
    )
    db = DB()
    assert_busy(
        lambda: reads.source_body(
            db,
            election_key="election",
            generation_id="generation",
            source_hash=HASH,
            store=Store(timeout()),
        )
    )


@pytest.mark.parametrize("operation", ["HeadBucket", "ListObjectsV2"])
def test_non_get_object_missing_code_is_operational(operation):
    error = ClientError(
        {"Error": {"Code": "NoSuchKey"}, "ResponseMetadata": {"HTTPStatusCode": 404}},
        operation,
    )
    assert_busy(lambda: reads._availability(DB(), Store(error), {HASH}))


def short_spool(monkeypatch):
    original = Path.open

    class ShortWriter:
        def __init__(self, file):
            self.file = file

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.file.close()

        def write(self, body):
            return self.file.write(body[:-1])

    def open_file(path, mode="r", *args, **kwargs):
        file = original(path, mode, *args, **kwargs)
        return ShortWriter(file) if mode == "xb" else file

    monkeypatch.setattr(Path, "open", open_file)


def test_short_local_spool_write_is_retryable(monkeypatch):
    short_spool(monkeypatch)

    def restore():
        try:
            with verified_source_files(Store(), [ROW]):
                pass
        except SourceFileError as error:
            source_io.raise_source_read_error(error)

    assert_busy(restore)


def test_partial_consumer_cannot_hide_local_spool_failure(monkeypatch):
    original = Store()
    scope = source_io.source_read_scope(original, factory=lambda: None)
    with monkeypatch.context() as patched:
        short_spool(patched)
        # The actual file verifier preserves its wrapped error; an ordinary
        # partial consumer may consume it, but cannot clear the API request flag.
        with pytest.raises(SourceFileError) as caught:
            with verified_source_files(scope, [ROW]):
                pass
        assert isinstance(caught.value.__cause__, StorageReadError)
    assert_busy(scope.raise_if_failed)
    fresh = source_io.source_read_scope(original, factory=lambda: None)
    with verified_source_files(fresh, [ROW]):
        pass
    fresh.raise_if_failed()


def test_swallowed_retained_body_error_cannot_be_cleared_by_later_success(tmp_path):
    original = Store(timeout())
    cache = source_io.FreshReadStore(original, limit=0)
    scope = source_io.source_read_scope(
        cache, factory=lambda: pytest.fail("unexpected setup")
    )
    generation = {"sources": [{"sha256": HASH}]}
    with pytest.raises(ComparisonImportError):
        storage.retained_bodies(DB(), scope, generation, {HASH})
    assert_busy(scope.raise_if_failed)
    original.error = None
    scope.get(ROW.object_key, tmp_path / "later", max_bytes=len(STORED))
    assert_busy(scope.raise_if_failed)
    fresh = source_io.source_read_scope(original, factory=lambda: None)
    fresh.get(ROW.object_key, tmp_path / "fresh", max_bytes=len(STORED))
    fresh.raise_if_failed()
    assert scope.store is cache and source_io.request_store(scope) is scope
    assert original.calls == 3


def test_known_missing_does_not_set_operational_marker():
    scope = source_io.source_read_scope(
        Store(StorageObjectMissingError("private/source")), factory=lambda: None
    )
    with pytest.raises(ComparisonImportError):
        storage.retained_bodies(DB(), scope, {"sources": [{"sha256": HASH}]}, {HASH})
    scope.raise_if_failed()


def test_known_wrapper_chain_preserves_transport_failure():
    original = timeout()
    inner = SourceFileError("verification failed")
    inner.__cause__ = original
    outer = ComparisonImportError("review failed")
    outer.__cause__ = inner
    assert_busy(lambda: source_io.raise_source_read_error(outer))


def test_wrapper_cycle_fails_safely():
    error = ComparisonImportError("cycle")
    error.__cause__ = error
    assert_busy(lambda: source_io.raise_source_read_error(error))


@pytest.mark.parametrize(
    "error", [timeout(), StorageObjectMissingError("private/source")]
)
def test_setup_failures_are_never_missing_originals(error):
    def factory():
        raise error

    scope = source_io.source_read_scope(factory=factory)
    assert_busy(lambda: reads._availability(DB(), scope, {HASH}))


def test_cached_short_write_is_operational(monkeypatch, tmp_path):
    scope = source_io.source_read_scope(Store(), factory=lambda: None)
    scope.get(ROW.object_key, tmp_path / "initial", max_bytes=len(STORED))
    original = Path.write_bytes
    monkeypatch.setattr(
        Path, "write_bytes", lambda path, body: original(path, body[:-1])
    )
    assert_busy(lambda: reads._availability(DB(), scope, {HASH}))


def test_native_store_short_write_is_operational(monkeypatch):
    import builtins
    from alethical.pipeline.raw_file_store import RawFileStore

    original = builtins.open

    class ShortWriter:
        def __init__(self, file):
            self.file = file

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.file.close()

        def write(self, body):
            return self.file.write(body[:-1])

    def open_file(path, mode="r", *args, **kwargs):
        file = original(path, mode, *args, **kwargs)
        return ShortWriter(file) if mode == "wb" else file

    monkeypatch.setattr(builtins, "open", open_file)
    stream = io.BytesIO(STORED)
    store = RawFileStore(
        SimpleNamespace(
            get_object=lambda **_: {"ContentLength": len(STORED), "Body": stream}
        )
    )
    assert_busy(lambda: reads._availability(DB(), store, {HASH}))
    assert stream.closed


def test_partial_consumer_cannot_hide_small_source_local_io(monkeypatch):
    from alethical.pipeline.election_comparison import read_source

    original = Store()
    row = cast(m.ElectionResultSource, ROW)
    scope = source_io.source_read_scope(original, factory=lambda: None)

    def failed_decode(*args, **kwargs):
        raise OSError("private/source")

    with monkeypatch.context() as patched:
        patched.setattr(gzip, "open", failed_decode)
        with pytest.raises(OSError):
            read_source(scope, row)
    # A partial consumer consumed the original error after a successful GET.
    assert_busy(scope.raise_if_failed)
    fresh = source_io.source_read_scope(original, factory=lambda: None)
    assert read_source(fresh, row) == RAW
    fresh.raise_if_failed()


@pytest.mark.parametrize(
    "cause", [ValueError("bad field"), TypeError("bad type"), KeyError("missing field")]
)
def test_validation_wrapped_malformed_fields_remain_gaps(cause):
    error = ComparisonImportError("Invalid checked source binding")
    error.__cause__ = cause
    source_io.raise_source_read_error(error)


@pytest.mark.parametrize(
    "error",
    [
        StorageObjectMissingError("private/source"),
        ComparisonImportError("invalid bytes"),
    ],
)
def test_source_body_actual_gap_stays_unavailable(monkeypatch, error):
    monkeypatch.setattr(reads.finance_versions, "pin", lambda *_: None)
    monkeypatch.setattr(
        reads, "_published_row", lambda *_: SimpleNamespace(id="generation")
    )
    with pytest.raises(HTTPException) as caught:
        reads.source_body(
            DB(),
            election_key="election",
            generation_id="generation",
            source_hash=HASH,
            store=Store(error),
        )
    assert caught.value.status_code == 503 and not caught.value.headers
    assert "private/source" not in str(caught.value.detail)


def test_source_body_healthy_original_stays_exact(monkeypatch):
    monkeypatch.setattr(reads.finance_versions, "pin", lambda *_: None)
    monkeypatch.setattr(
        reads, "_published_row", lambda *_: SimpleNamespace(id="generation")
    )
    body, metadata, headers = reads.source_body(
        DB(),
        election_key="election",
        generation_id="generation",
        source_hash=HASH,
        store=Store(),
    )
    assert body == RAW and metadata["sha256"] == HASH
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Content-Type"] == "application/octet-stream"


@pytest.mark.parametrize("view", ["context", "candidate", "payments", "bulk"])
@pytest.mark.parametrize("failed", [False, True])
def test_projection_checks_consumed_operational_failure(
    monkeypatch, tmp_path, view, failed
):
    original = Store(timeout() if failed else None)
    scope = source_io.source_read_scope(original, factory=lambda: None)
    if failed:
        with pytest.raises(ReadTimeoutError):
            scope.get(ROW.object_key, tmp_path / "failed", max_bytes=len(STORED))
    generation = {
        "id": "generation",
        "snapshot_id": "snapshot",
        "election_key": "election",
        **dict.fromkeys(
            ["accounts", "authorities", "coverage", "reports", "payments", "sources"],
            [],
        ),
    }
    state = (
        {},
        generation,
        SimpleNamespace(id="race"),
        {"candidate_id": "candidate"},
        [],
        {},
        {},
        scope,
    )

    def context(*args, **kwargs):
        kwargs["cache"]["selected_races"] = {}
        return state

    monkeypatch.setattr(reads, "_context", context)

    def call():
        if view == "context":
            return reads.context(None, election_key="election", store=scope)
        if view == "bulk":
            return reads.bulk_finance(None, election_key="election", store=scope)
        method = (
            reads.candidate_finance if view == "candidate" else reads.payment_records
        )
        return method(
            None,
            election_key="election",
            race_id="race",
            candidate_id="candidate",
            store=scope,
        )

    if failed:
        assert_busy(call)
    else:
        assert isinstance(call(), dict)
