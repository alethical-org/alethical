"""File-only checks; no DB, network, renderer or accepted source facts."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import gzip
import hashlib
import inspect
from pathlib import Path
import stat
from threading import Event
from types import SimpleNamespace

import pytest

from alethical.pipeline import election_source_files as files


class Store:
    def __init__(self):
        self.objects = {}
        self.calls = []

    def get(self, key, path, *, max_bytes=None):
        self.calls.append((key, Path(path), max_bytes))
        body = self.objects[key]
        if max_bytes is not None and len(body) > max_bytes:
            raise ValueError("Synthetic store honored its byte bound")
        Path(path).write_bytes(body)


def source(
    store,
    body=b"%PDF-1.7\nexact synthetic original\n",
    *,
    compression="gzip",
    media_type="application/pdf",
):
    stored = gzip.compress(body, mtime=0) if compression == "gzip" else body
    h = hashlib.sha256(body).hexdigest()
    store.objects[h] = stored
    return dict(
        content_hash=h,
        object_key=h,
        byte_size=len(body),
        compressed_hash=hashlib.sha256(stored).hexdigest(),
        compressed_byte_size=len(stored),
        compression=compression,
        media_type=media_type,
    )


@pytest.fixture(autouse=True)
def isolated_budget_and_owned_directory(monkeypatch, tmp_path):
    budget = files._Budget()
    monkeypatch.setattr(files, "_BUDGET", budget)
    temporary = files.tempfile.TemporaryDirectory
    monkeypatch.setattr(
        files.tempfile,
        "TemporaryDirectory",
        lambda **kwargs: temporary(dir=tmp_path, **kwargs),
    )
    yield
    assert budget.snapshot() == (0, 0, 0)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("compression", ["raw", "gzip"])
def test_exact_original_has_owned_read_seek_path_and_closes_every_open_handle(
    compression,
):
    store = Store()
    body = b"%PDF-1.7\n" + bytes(range(256)) * 20
    metadata = source(store, body, compression=compression)
    with files.verified_source_files(
        store, [metadata], required_types={metadata["content_hash"]: "pdf"}
    ) as proved:
        proof = proved[metadata["content_hash"]]
        path = proof.path
        handle = proof.open()
        assert proof.content_hash == metadata[
            "content_hash"
        ] and proof.byte_size == len(body)
        assert handle.read(5) == body[:5]
        handle.seek(100)
        assert handle.read(80) == body[100:180]
        assert path.read_bytes() == body
        assert not stat.S_IMODE(path.stat().st_mode) & 0o222
        assert files._BUDGET.snapshot()[0] == 1
        assert store.calls[0][2] == metadata["compressed_byte_size"]
        with pytest.raises(TypeError):
            proved["invented"] = proof
    assert handle.closed and not path.exists()
    for operation in [
        proof.open,
        lambda: proof.path,
        lambda: proof.content_hash,
        lambda: proof.byte_size,
    ]:
        with pytest.raises(files.SourceFileError, match="owning context"):
            operation()


def test_duplicate_originals_share_one_get_but_never_cross_context_availability_cache():
    store = Store()
    metadata = source(store)
    for _ in range(2):
        with files.verified_source_files(
            store, [metadata, deepcopy(metadata), SimpleNamespace(**metadata)]
        ) as proved:
            assert len(proved) == 1
    assert len(store.calls) == 2


@pytest.mark.parametrize(
    "change",
    [
        {"content_hash": "A" * 64},
        {"compressed_hash": "not a hash"},
        {"byte_size": True},
        {"byte_size": -1},
        {"byte_size": files.MAX_ORIGINAL_BYTES + 1},
        {"compressed_byte_size": False},
        {"compressed_byte_size": -1},
        {"compressed_byte_size": files.MAX_COMPRESSED_BYTES + 1},
        {"compression": "deflate"},
        {"compression": []},
        {"compression": None},
        {"object_key": ""},
        {"object_key": "bad\x00key"},
        {"media_type": []},
    ],
)
def test_bad_metadata_never_fetches(change):
    store = Store()
    metadata = source(store) | change
    with pytest.raises(files.SourceFileError):
        with files.verified_source_files(store, [metadata]):
            pytest.fail("Bad metadata created a proof")
    assert store.calls == []


def test_conflicting_duplicate_original_metadata_fails_before_get():
    store = Store()
    metadata = source(store)
    other = {**metadata, "object_key": "another retained object"}
    with pytest.raises(files.SourceFileError, match="conflicting"):
        with files.verified_source_files(store, [metadata, other]):
            pytest.fail("Conflicting original accepted")
    assert store.calls == []


def test_raw_storage_identity_must_be_self_consistent_before_get():
    store = Store()
    metadata = source(store, compression="raw") | {"compressed_hash": "0" * 64}
    with pytest.raises(files.SourceFileError, match="conflicting"):
        with files.verified_source_files(store, [metadata]):
            pytest.fail("Conflicting raw metadata accepted")
    assert store.calls == []


def test_scaled_original_and_unique_closure_boundaries(monkeypatch):
    monkeypatch.setattr(files, "MAX_ORIGINAL_BYTES", 32)
    monkeypatch.setattr(files, "MAX_CLOSURE_BYTES", 64)
    store = Store()
    first, second = source(store, b"a" * 32), source(store, b"b" * 32)
    with files.verified_source_files(store, [first, second, first]) as proved:
        assert len(proved) == 2
    before = len(store.calls)
    third = source(store, b"c")
    with pytest.raises(files.SourceFileError, match="closure"):
        with files.verified_source_files(store, [first, second, third]):
            pytest.fail("Oversized aggregate accepted")
    assert len(store.calls) == before
    too_large = source(store, b"x" * 33)
    with pytest.raises(files.SourceFileError, match="bounds"):
        with files.verified_source_files(store, [too_large]):
            pytest.fail("Oversized original accepted")


def test_source_count_bound_is_on_one_unique_closure(monkeypatch):
    monkeypatch.setattr(files, "MAX_CLOSURE_SOURCES", 2)
    store = Store()
    sources = [source(store, bytes([number])) for number in range(3)]
    with files.verified_source_files(store, [sources[0]] * 10) as proved:
        assert len(proved) == 1
    before = len(store.calls)
    with pytest.raises(files.SourceFileError, match="unique members"):
        with files.verified_source_files(store, sources):
            pytest.fail("Unbounded source members accepted")
    assert len(store.calls) == before


@pytest.mark.parametrize(
    "kinds",
    [[], {"0" * 64: "pdf"}, {"replace": "json"}, {"replace": {}}, {"replace": True}],
)
def test_bad_type_requirements_never_fetch(kinds):
    store = Store()
    metadata = source(store)
    if isinstance(kinds, dict) and "replace" in kinds:
        kinds = {metadata["content_hash"]: kinds["replace"]}
    with pytest.raises(files.SourceFileError):
        with files.verified_source_files(store, [metadata], required_types=kinds):
            pytest.fail("Bad type requirement accepted")
    assert store.calls == []


@pytest.mark.parametrize("compression", ["raw", "gzip"])
def test_pdf_type_is_verified_from_original_bytes(compression):
    store = Store()
    metadata = source(store, b"<html>not a PDF</html>", compression=compression)
    with pytest.raises(files.SourceFileError, match="not PDF"):
        with files.verified_source_files(
            store, [metadata], required_types={metadata["content_hash"]: "pdf"}
        ):
            pytest.fail("Wrong original type accepted")


def test_small_html_requires_actual_html_declared_type_and_explicit_limit():
    store = Store()
    body = b"\xef\xbb\xbf\n<!doctype html><html>literal source</html>"
    metadata = source(store, body, media_type="text/html; charset=utf-8")
    with files.verified_source_files(
        store, [metadata], required_types={metadata["content_hash"]: "html"}
    ) as proved:
        proof = proved[metadata["content_hash"]]
        assert proof.read_small_html(max_bytes=len(body)) == body
        for limit in [len(body) - 1, 0, -1, True, files.MAX_SMALL_HTML_BYTES + 1]:
            with pytest.raises(files.SourceFileError, match="bounded"):
                proof.read_small_html(max_bytes=limit)
    with files.verified_source_files(store, [metadata]) as proved:
        with pytest.raises(files.SourceFileError, match="verified HTML"):
            proved[metadata["content_hash"]].read_small_html(max_bytes=1024)
    pdf = source(store)
    with files.verified_source_files(
        store, [pdf], required_types={pdf["content_hash"]: "pdf"}
    ) as proved:
        with pytest.raises(files.SourceFileError, match="verified HTML"):
            proved[pdf["content_hash"]].read_small_html(max_bytes=1024)


@pytest.mark.parametrize(
    "body,media_type",
    [
        (b"%PDF-1.7\nnot HTML", "text/html"),
        (b"<html>\x00</html>", "text/html"),
        (b"<html>actual</html>", "application/json"),
    ],
)
def test_html_type_or_media_mismatch_cannot_use_small_body_access(body, media_type):
    store = Store()
    metadata = source(store, body, media_type=media_type)
    with pytest.raises(files.SourceFileError, match="HTML"):
        with files.verified_source_files(
            store, [metadata], required_types={metadata["content_hash"]: "html"}
        ):
            pytest.fail("Wrong HTML type accepted")


@pytest.mark.parametrize(
    "failure",
    [
        "truncated",
        "crc",
        "extra_zero",
        "extra_garbage",
        "extra_member",
        "not_gzip",
        "short_raw",
        "long_raw",
        "raw_hash",
        "compressed_hash",
    ],
)
def test_gzip_corruption_lengths_or_trailing_data_never_prove(failure):
    store = Store()
    metadata = source(store)
    key = metadata["object_key"]
    packed = store.objects[key]
    if failure == "truncated":
        packed = packed[:-1]
    elif failure == "crc":
        packed = packed[:-8] + bytes([packed[-8] ^ 1]) + packed[-7:]
    elif failure == "extra_zero":
        packed += b"\x00"
    elif failure == "extra_garbage":
        packed += b"unrelated"
    elif failure == "extra_member":
        packed += gzip.compress(b"", mtime=0)
    elif failure == "not_gzip":
        packed = b"not gzip"
    elif failure == "short_raw":
        metadata["byte_size"] -= 1
    elif failure == "long_raw":
        metadata["byte_size"] += 1
    elif failure == "raw_hash":
        metadata["content_hash"] = "0" * 64
    store.objects[key] = packed
    metadata.update(
        compressed_byte_size=len(packed),
        compressed_hash=hashlib.sha256(packed).hexdigest(),
    )
    if failure == "compressed_hash":
        metadata["compressed_hash"] = "0" * 64
    with pytest.raises(files.SourceFileError):
        with files.verified_source_files(store, [metadata]):
            pytest.fail("Corrupt stored original accepted")


def test_expansion_stops_at_declared_bound_in_fixed_output_chunks(monkeypatch):
    monkeypatch.setattr(files, "CHUNK_BYTES", 16)
    store = Store()
    metadata = source(store, b"%PDF-1.7\n" + b"x" * 256_000)
    metadata["byte_size"] = 20
    with pytest.raises(files.SourceFileError, match="byte bound"):
        with files.verified_source_files(store, [metadata]):
            pytest.fail("Expansion beyond declared original accepted")


@pytest.mark.parametrize("partial", ["short", "extra", "raise"])
def test_partial_or_extra_store_writes_clean_up_and_release_reservation(
    partial, monkeypatch
):
    store = Store()
    metadata = source(store)
    packed = store.objects[metadata["object_key"]]

    def get(key, path, *, max_bytes=None):
        Path(path).write_bytes(
            packed + b"x" if partial == "extra" else packed[: len(packed) // 2]
        )
        if partial == "raise":
            raise OSError("Synthetic interrupted store write")

    monkeypatch.setattr(store, "get", get)
    with pytest.raises(files.SourceFileError):
        with files.verified_source_files(store, [metadata]):
            pytest.fail("Partial or extra stored copy accepted")
    assert files._BUDGET.snapshot() == (0, 0, 0)


def test_short_raw_spool_write_cannot_create_proof(monkeypatch):
    store = Store()
    metadata = source(store, compression="raw")
    real_open = Path.open

    class ShortWriter:
        def __init__(self, handle):
            self.handle = handle

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.handle.close()

        def write(self, value):
            return self.handle.write(value[:-1])

    def open_path(path, mode="r", *args, **kwargs):
        handle = real_open(path, mode, *args, **kwargs)
        return ShortWriter(handle) if mode == "xb" else handle

    monkeypatch.setattr(Path, "open", open_path)
    with pytest.raises(files.SourceFileError, match="write was incomplete"):
        with files.verified_source_files(store, [metadata]):
            pytest.fail("Short spool write accepted")


def test_source_loss_corruption_and_recovery_never_use_successful_cache():
    store = Store()
    metadata = source(store)
    key = metadata["object_key"]
    body = store.objects[key]
    for state in ["valid", "missing", "corrupt", "valid"]:
        if state == "missing":
            del store.objects[key]
        else:
            store.objects[key] = b"bad" if state == "corrupt" else body
        if state == "valid":
            with files.verified_source_files(store, [metadata]):
                pass
        else:
            with pytest.raises(files.SourceFileError):
                with files.verified_source_files(store, [metadata]):
                    pytest.fail("Unavailable source accepted")
    assert len(store.calls) == 4


def test_consumer_failure_preserves_its_error_but_closes_handles_and_files():
    store = Store()
    metadata = source(store)
    with pytest.raises(RuntimeError, match="Synthetic consumer"):
        with files.verified_source_files(store, [metadata]) as proved:
            proof = proved[metadata["content_hash"]]
            handle, path = proof.open(), proof.path
            raise RuntimeError("Synthetic consumer failure")
    assert handle.closed and not path.exists()


@pytest.mark.parametrize("resource", ["worker", "raw", "compressed"])
def test_process_wide_reservation_rejects_parallel_work_before_second_get(
    monkeypatch, resource
):
    store = Store()
    metadata = source(store)
    budget = files._Budget(
        workers=1 if resource == "worker" else 4,
        raw_bytes=metadata["byte_size"] if resource == "raw" else 1024,
        compressed_bytes=metadata["compressed_byte_size"]
        if resource == "compressed"
        else 1024,
    )
    monkeypatch.setattr(files, "_BUDGET", budget)
    started, resume = Event(), Event()
    ordinary_get = store.get

    def blocked_get(*args, **kwargs):
        started.set()
        assert resume.wait(3), "Test did not release the reserved source worker"
        return ordinary_get(*args, **kwargs)

    monkeypatch.setattr(store, "get", blocked_get)

    def first():
        with files.verified_source_files(store, [metadata]) as proved:
            assert proved[metadata["content_hash"]].path.exists()

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(first)
        try:
            assert started.wait(3)
            with pytest.raises(files.SourceFileLimitError, match="process budget"):
                with files.verified_source_files(store, [metadata]):
                    pytest.fail("Concurrent reservation exceeded resource budget")
            assert store.calls == []
        finally:
            resume.set()
        future.result(timeout=3)
    assert budget.snapshot() == (0, 0, 0)
    with files.verified_source_files(store, [metadata]):
        pass
    assert len(store.calls) == 2 and budget.snapshot() == (0, 0, 0)


def test_raw_file_proof_cannot_be_minted_from_caller_data_or_caller_path():
    with pytest.raises(files.SourceFileError, match="exact-byte"):
        files.VerifiedSourceFile({}, Path("/caller/path"), None, "pdf", _seal=True)
    with pytest.raises(TypeError):
        inspect.signature(files.verified_source_files).bind(
            Store(), [], directory="/caller/path"
        )


def test_stored_symlink_is_not_accepted_as_an_owned_original(tmp_path, monkeypatch):
    store = Store()
    metadata = source(store)
    other = tmp_path / "outside-original"
    other.write_bytes(store.objects[metadata["object_key"]])

    def get(key, path, *, max_bytes=None):
        Path(path).symlink_to(other)

    monkeypatch.setattr(store, "get", get)
    try:
        with pytest.raises(files.SourceFileError, match="regular file"):
            with files.verified_source_files(store, [metadata]):
                pytest.fail("Foreign symlink accepted")
        assert other.exists()
    finally:
        other.unlink()


def test_restoration_reads_and_writes_only_fixed_chunks(monkeypatch):
    monkeypatch.setattr(files, "CHUNK_BYTES", 64)
    store = Store()
    body = b"%PDF-1.7\n" + bytes(range(256)) * 200
    metadata = source(store, body)
    real_open = Path.open
    reads, writes = [], []

    class BoundedHandle:
        def __init__(self, handle):
            self.handle = handle

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.handle.close()

        def __getattr__(self, key):
            return getattr(self.handle, key)

        def read(self, size=-1):
            assert 0 < size <= 64, "Original was read without a fixed chunk bound"
            reads.append(size)
            return self.handle.read(size)

        def write(self, value):
            assert len(value) <= 64, "Decompression buffered the whole original"
            writes.append(len(value))
            return self.handle.write(value)

    def bounded_open(path, mode="r", *args, **kwargs):
        handle = real_open(path, mode, *args, **kwargs)
        return BoundedHandle(handle) if mode in {"rb", "xb"} else handle

    monkeypatch.setattr(Path, "open", bounded_open)
    monkeypatch.setattr(
        Path, "read_bytes", lambda *args: pytest.fail("Whole-body path copy")
    )
    with files.verified_source_files(store, [metadata]) as proved:
        hasher = hashlib.sha256()
        with proved[metadata["content_hash"]].open() as handle:
            while chunk := handle.read(64):
                hasher.update(chunk)
        assert hasher.hexdigest() == metadata["content_hash"]
    assert len(reads) > 2 and len(writes) > 2


def test_later_missing_member_removes_already_proved_member_and_releases_budget():
    store = Store()
    first = source(store)
    second = source(store, b"%PDF-1.7\nsecond original")
    del store.objects[second["object_key"]]
    with pytest.raises(files.SourceFileError):
        with files.verified_source_files(store, [first, second]):
            pytest.fail("Partial closure produced verified files")
    assert len(store.calls) == 2 and files._BUDGET.snapshot() == (0, 0, 0)


@pytest.mark.parametrize("compression", ["raw", "gzip"])
def test_empty_bytes_are_not_a_pdf_or_a_fabricated_zero(compression):
    store = Store()
    metadata = source(store, b"", compression=compression)
    with files.verified_source_files(store, [metadata]) as proved:
        with proved[metadata["content_hash"]].open() as handle:
            assert handle.read(1) == b""
    with pytest.raises(files.SourceFileError, match="not PDF"):
        with files.verified_source_files(
            store, [metadata], required_types={metadata["content_hash"]: "pdf"}
        ):
            pytest.fail("An empty source supplied a PDF")


def test_concurrent_handle_open_cannot_escape_context_cleanup(monkeypatch):
    store = Store()
    metadata = source(store)
    manager = files.verified_source_files(store, [metadata])
    proved = manager.__enter__()
    proof = proved[metadata["content_hash"]]
    path = proof.path
    opening, resume, closing = Event(), Event(), Event()
    real_open = Path.open

    def delayed_open(target, mode="r", *args, **kwargs):
        if target == path and mode == "rb":
            opening.set()
            assert resume.wait(3)
        return real_open(target, mode, *args, **kwargs)

    def close_context():
        closing.set()
        manager.__exit__(None, None, None)

    monkeypatch.setattr(Path, "open", delayed_open)
    with ThreadPoolExecutor(max_workers=2) as pool:
        opener = pool.submit(proof.open)
        try:
            assert opening.wait(3)
            closer = pool.submit(close_context)
            assert closing.wait(3)
        finally:
            resume.set()
        handle = opener.result(timeout=3)
        closer.result(timeout=3)
    assert handle.closed and not path.exists()
