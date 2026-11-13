"""Temporary original-read failures cannot change a successful report's scope."""

from dataclasses import replace
import gzip
import hashlib
import io
import json
from pathlib import Path
from types import SimpleNamespace

from botocore.exceptions import (
    ClientError,
    ConnectTimeoutError,
    EndpointConnectionError,
    ReadTimeoutError,
    ResponseStreamingError,
)
from fastapi import HTTPException
import pytest

from alethical.api.services import election_analytics as reads
from alethical.pipeline import raw_file_store as storage
from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.pipeline.election_source_files import SourceFileLimitError


PRIVATE = "private-bucket/private-key"
RAW = b"%PDF-synthetic checked original\n"
STORED = gzip.compress(RAW, mtime=0)
PROOF = reads._SourceProof(
    PRIVATE,
    "gzip",
    hashlib.sha256(STORED).hexdigest(),
    len(STORED),
    hashlib.sha256(RAW).hexdigest(),
    len(RAW),
    b"%PDF",
)


class Store:
    def __init__(self, *, body=STORED, error=None):
        self.body, self.error, self.calls = body, error, 0

    def get(self, key, path, *, max_bytes):
        self.calls += 1
        assert key == PRIVATE and max_bytes == PROOF.compressed_size
        if self.error is not None:
            raise self.error
        Path(path).write_bytes(self.body)


def client_error(code, status):
    return ClientError(
        {
            "Error": {"Code": code, "Message": PRIVATE},
            "ResponseMetadata": {"HTTPStatusCode": status},
        },
        "GetObject",
    )


def assert_busy(call):
    with pytest.raises(HTTPException) as caught:
        call()
    assert caught.value.status_code == 503
    assert caught.value.headers == {"Retry-After": "1"}
    detail = caught.value.detail
    assert isinstance(detail, dict)
    assert PRIVATE not in json.dumps(detail)
    assert detail["detail"] == "Records are busy"


@pytest.mark.parametrize(
    "error",
    [
        ReadTimeoutError(endpoint_url=PRIVATE, error=PRIVATE),
        ConnectTimeoutError(endpoint_url=PRIVATE, error=PRIVATE),
        EndpointConnectionError(endpoint_url=PRIVATE),
        ResponseStreamingError(error=PRIVATE),
        client_error("SlowDown", 503),
        client_error("InternalError", 500),
        client_error("TooManyRequests", 429),
        client_error("AccessDenied", 403),
        client_error("NoSuchBucket", 404),
        client_error("ExpiredToken", 400),
        SourceFileLimitError(PRIVATE),
        KeyError(PRIVATE),
        RuntimeError(PRIVATE),
        PermissionError(PRIVATE),
        FileNotFoundError(PRIVATE),
    ],
    ids=[
        "read-timeout",
        "connect-timeout",
        "endpoint",
        "stream",
        "slow-down",
        "server-error",
        "throttle",
        "storage-access",
        "missing-bucket",
        "expired-credential",
        "capacity",
        "unexpected-key",
        "unexpected-runtime",
        "permission",
        "file-system-missing",
    ],
)
def test_operational_read_failure_is_retryable_not_missing(error):
    store = Store(error=error)
    assert_busy(lambda: reads._verify_original(store, PROOF))
    assert store.calls == 1


@pytest.mark.parametrize(
    "error",
    [
        client_error("NoSuchKey", 404),
        client_error("404", 404),
        client_error("NotFound", 404),
        storage.StorageObjectMissingError(PRIVATE),
        storage.StorageIntegrityError(PRIVATE),
        ComparisonImportError("Source exceeds retained length"),
    ],
)
def test_confirmed_absence_or_integrity_refusal_stays_unavailable(error):
    assert not reads._verify_original(Store(error=error), PROOF)


def test_missing_local_working_directory_is_not_missing_original(monkeypatch):
    def missing_directory(**_):
        raise FileNotFoundError(PRIVATE)

    monkeypatch.setattr(reads.tempfile, "TemporaryDirectory", missing_directory)
    assert_busy(lambda: reads._verify_original(Store(), PROOF))


@pytest.mark.parametrize(
    "error",
    [
        RuntimeError(PRIVATE),
        FileNotFoundError(PRIVATE),
        storage.StorageIntegrityError(PRIVATE),
        ComparisonImportError(PRIVATE),
    ],
)
def test_required_factory_failure_is_retryable(monkeypatch, error):
    def unavailable():
        raise error

    monkeypatch.setattr(reads, "raw_file_store_from_env", unavailable)
    assert_busy(lambda: reads._source_availability({"example": PROOF}))


@pytest.mark.parametrize("proofs", [{}, {"example": None}])
def test_no_original_required_does_not_create_store(monkeypatch, proofs):
    def forbidden():
        pytest.fail("No original needs a storage client")

    monkeypatch.setattr(reads, "raw_file_store_from_env", forbidden)
    assert reads._source_availability(proofs) == dict.fromkeys(proofs, False)


def test_recovery_uses_a_fresh_get_and_same_exact_proof():
    store = Store(error=ReadTimeoutError(endpoint_url=PRIVATE, error=PRIVATE))
    assert_busy(lambda: reads._source_availability({"example": PROOF}, store=store))
    store.error = None
    assert reads._source_availability({"example": PROOF}, store=store) == {
        "example": True
    }
    assert store.calls == 2


@pytest.mark.parametrize(
    "change",
    ["stored-hash", "stored-length", "raw-hash", "raw-length", "prefix", "gzip"],
)
def test_invalid_complete_original_does_not_become_retryable(change):
    proof, body = PROOF, STORED
    if change == "stored-hash":
        body = body[:-1] + bytes([body[-1] ^ 1])
    elif change == "stored-length":
        body = body[:-1]
    elif change == "raw-hash":
        proof = replace(proof, raw_hash="0" * 64)
    elif change == "raw-length":
        proof = replace(proof, raw_size=2)
    elif change == "prefix":
        proof = replace(proof, prefix=b"%OTHER")
    elif change == "gzip":
        body = b"x" * len(STORED)
        proof = replace(proof, compressed_hash=hashlib.sha256(body).hexdigest())
    assert not reads._verify_original(Store(body=body), proof)


def test_healthy_source_output_is_exact(tmp_path):
    output = tmp_path / "original.pdf"
    assert reads._verify_original(Store(), PROOF, output)
    assert output.read_bytes() == RAW


@pytest.mark.parametrize("kind", ["oversized", "interrupted"])
def test_raw_store_errors_have_distinct_types_and_close_stream(tmp_path, kind):
    body = io.BytesIO(b"partial")
    client = SimpleNamespace(
        get_object=lambda **_: {"ContentLength": 100, "Body": body}
    )
    store = storage.RawFileStore(client)
    with pytest.raises(RuntimeError) as caught:
        store.get(
            PRIVATE,
            str(tmp_path / "source"),
            max_bytes=10 if kind == "oversized" else 100,
        )
    assert type(caught.value).__name__ == (
        "StorageIntegrityError" if kind == "oversized" else "StorageReadError"
    )
    assert body.closed


def test_native_interrupted_store_read_is_retryable(tmp_path):
    body = io.BytesIO(STORED[:4])
    client = SimpleNamespace(
        get_object=lambda **_: {"ContentLength": len(STORED), "Body": body}
    )
    store = storage.RawFileStore(client)
    assert_busy(lambda: reads._verify_original(store, PROOF))
    assert body.closed


def test_native_oversized_store_read_remains_invalid():
    body = io.BytesIO(STORED)
    client = SimpleNamespace(
        get_object=lambda **_: {"ContentLength": len(STORED) + 1, "Body": body}
    )
    assert not reads._verify_original(storage.RawFileStore(client), PROOF)
    assert body.closed


def test_shared_fake_absence_uses_explicit_object_signal(tmp_path):
    from alethical.tests.test_election_comparison_storage import MemoryStore

    store = MemoryStore()
    with pytest.raises(storage.StorageObjectMissingError):
        store.get(PRIVATE, tmp_path / "original", max_bytes=len(STORED))
    assert not reads._verify_original(store, PROOF)


def test_raw_store_destination_failure_is_not_missing_object(monkeypatch, tmp_path):
    from contextlib import nullcontext

    body = io.BytesIO(STORED)
    store = storage.RawFileStore(
        SimpleNamespace(
            get_object=lambda **_: {"ContentLength": len(STORED), "Body": body}
        )
    )
    # The real store's destination open fails, after a successful object GET.
    monkeypatch.setattr(
        reads.tempfile,
        "TemporaryDirectory",
        lambda **_: nullcontext(str(tmp_path / "absent-directory")),
    )
    assert_busy(lambda: reads._verify_original(store, PROOF))
    assert body.closed


@pytest.mark.parametrize(
    "code,operation", [("NoSuchKey", "HeadBucket"), ("NotFound", "ListObjectsV2")]
)
def test_missing_code_from_other_operation_is_not_object_absence(code, operation):
    error = ClientError(
        {"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": 404}},
        operation,
    )
    assert_busy(lambda: reads._verify_original(Store(error=error), PROOF))


def test_download_short_write_refuses_and_fresh_retry_recovers(monkeypatch, tmp_path):
    output = tmp_path / "download.pdf"
    original = Path.open
    store = Store()

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
        return ShortWriter(file) if path == output and mode == "wb" else file

    with monkeypatch.context() as patched:
        patched.setattr(Path, "open", open_file)
        assert_busy(lambda: reads._verify_original(store, PROOF, output))
    assert reads._verify_original(store, PROOF, output)
    assert output.read_bytes() == RAW and store.calls == 2
