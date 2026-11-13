"""Bound election reader I/O without carrying source availability across requests."""

from collections import OrderedDict, deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import gzip
from pathlib import Path
from threading import Event, Lock, RLock, BoundedSemaphore
import zlib

from botocore.exceptions import ClientError

from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.pipeline.election_source_files import (
    SourceFileError,
    SourceFileLimitError,
)
from alethical.pipeline.raw_file_store import (
    StorageIntegrityError,
    StorageObjectMissingError,
    StorageReadError,
)

# One process budget, not 32 new remote readers for each admitted HTTP request.
SOURCE_WORKERS = 32
_READ_SLOTS = BoundedSemaphore(SOURCE_WORKERS)
_POOL = ThreadPoolExecutor(
    max_workers=SOURCE_WORKERS, thread_name_prefix="election-source"
)


def source_map(check, jobs, *, ordered=True):
    """Keep at most one window queued per request, ordered by default.

    Hash-keyed collectors can opt into completion order to refill free slots
    while an earlier source is slow. Refill only when the consumer resumes.

    Other requests can join the shared FIFO queue between windows. A failed or
    abandoned iteration cancels pending work and drains started work before its
    owner releases temporary files. Callers must supply already-loaded metadata;
    database sessions and lazy ORM attributes never belong in a worker.
    """
    jobs = iter(jobs)
    pending = deque()
    try:
        for _ in range(SOURCE_WORKERS):
            try:
                pending.append(_POOL.submit(check, next(jobs)))
            except StopIteration:
                break
        while pending:
            if ordered:
                future = pending[0]
            else:
                completed, _ = wait(pending, return_when=FIRST_COMPLETED)
                future = next(iter(completed))
            result = future.result()
            pending.remove(future)
            yield result
            try:
                pending.append(_POOL.submit(check, next(jobs)))
            except StopIteration:
                pass
    finally:
        # An interrupt during cleanup must not release the caller's temp files
        # while a started worker still uses them. Re-raise after every job ends.
        interrupted = None
        while True:
            try:
                for future in pending:
                    future.cancel()
                wait(pending)
                break
            except (KeyboardInterrupt, SystemExit) as error:
                interrupted = error
        if interrupted is not None:
            raise interrupted


class FreshReadStore:
    """Thread-safe, byte-bounded compressed copies belonging to one request.

    Every new instance starts empty. Consumers still verify exact lengths,
    compressed and raw hashes, media and source-role claims. A cached copy never
    supplies an availability or attribution verdict. Concurrent consumers of the
    same key share one fetch, and failed fetches never enter the cache.
    """

    def __init__(self, store, limit=64 * 1024 * 1024):
        self.store, self.limit = store, limit
        self.size = 0
        self.entries = OrderedDict()
        self._lock = RLock()
        self._keys = {}

    def get(self, key, path, *, max_bytes=None):
        with self._lock:
            key_lock = self._keys.setdefault(key, Lock())
        with key_lock:
            with self._lock:
                if key in self.entries:
                    body = self.entries.pop(key)
                    self.entries[key] = body
                    if max_bytes is not None and len(body) > max_bytes:
                        raise ComparisonImportError("Source exceeds retained length")
                    if Path(path).write_bytes(body) != len(body):
                        raise StorageReadError("Cached source write was incomplete")
                    return
            with _READ_SLOTS:
                self.store.get(key, path, max_bytes=max_bytes)
            length = Path(path).stat().st_size
            if max_bytes is not None and length > max_bytes:
                raise ComparisonImportError("Source exceeds retained length")
            if length <= self.limit:
                with self._lock:
                    while self.entries and self.size + length > self.limit:
                        _, old = self.entries.popitem(last=False)
                        self.size -= len(old)
                        del old
                    # Evict before reading the new copy into memory. In-flight
                    # originals remain bounded files owned by their validators.
                    body = Path(path).read_bytes()
                    if len(body) != length:
                        raise StorageReadError("Source changed while being read")
                    self.entries[key] = body
                    self.size += length


def request_store(store):
    """Preserve an explicitly passed request scope instead of nesting caches."""
    return (
        store
        if isinstance(store, (FreshReadStore, SourceReadScope))
        else FreshReadStore(store)
    )


def _operational_source_error(error, *, decoding=False):
    """Unwrap only known validation wrappers; never inspect private error text."""
    seen = set()
    wrapped = False
    while isinstance(error, (ComparisonImportError, SourceFileError)):
        if isinstance(error, SourceFileLimitError) or id(error) in seen:
            return True
        seen.add(id(error))
        if error.__cause__ is None:
            return False
        wrapped = True
        error = error.__cause__
    if isinstance(error, (StorageObjectMissingError, StorageIntegrityError)):
        return False
    if isinstance(error, ClientError):
        code = error.response.get("Error", {}).get("Code")
        status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        return not (
            error.operation_name == "GetObject"
            and (code == "NoSuchKey" or (code in {"404", "NotFound"} and status == 404))
        )
    if decoding and isinstance(error, (gzip.BadGzipFile, EOFError, zlib.error)):
        return False
    if decoding and wrapped and isinstance(error, (ValueError, TypeError, KeyError)):
        # A validator's malformed-field refusal remains a gap. The request flag
        # separately records these exceptions if they actually came from GET.
        return False
    return True


def raise_source_read_error(error):
    """Keep proved evidence gaps distinct from a failed read operation."""
    if _operational_source_error(error, decoding=True):
        from alethical.api.problems import problem_exception

        raise problem_exception(
            503,
            "Service Unavailable",
            "Records are busy",
            headers={"Retry-After": "1"},
        ) from None


class SourceReadScope:
    """Remember failed operations if a partial validator consumes their errors.

    This flag lives only for the request and supplies no source verdict or bytes.
    The existing request store remains the single compressed-byte cache.
    """

    def __init__(self, store):
        self.store = request_store(store)
        self._failed = Event()

    def get(self, key, path, *, max_bytes=None):
        try:
            return self.store.get(key, path, max_bytes=max_bytes)
        except Exception as error:
            self.record_failure(error, decoding=False)
            raise

    def record_failure(self, error, *, decoding=True):
        if _operational_source_error(error, decoding=decoding):
            self._failed.set()

    def raise_if_failed(self):
        if self._failed.is_set():
            raise_source_read_error(StorageReadError("Source operation failed"))


def source_read_scope(store=None, *, factory):
    if isinstance(store, SourceReadScope):
        return store

    def create_store():
        try:
            return factory()
        except Exception as error:
            raise StorageReadError("Source storage setup failed") from error

    return SourceReadScope(
        store if store is not None else lazy_request_store(create_store)
    )


class _LazySourceStore:
    def __init__(self, factory):
        self.factory, self.store, self.lock = factory, None, Lock()

    def get(self, key, path, *, max_bytes=None):
        with self.lock:
            if self.store is None:
                self.store = self.factory()
            store = self.store
        return store.get(key, path, max_bytes=max_bytes)


def lazy_request_store(factory):
    """A fresh read scope that creates its client only when a source is needed."""
    return request_store(_LazySourceStore(factory))


def outcome_map(db, *, snapshot_id, race_ids=None, store=None):
    """Share bytes while preserving operational failures through partial checks."""
    from alethical.api.problems import problem_exception
    from alethical.pipeline import election_outcomes
    from alethical.pipeline.election_source_files import SourceFileLimitError

    scope = source_read_scope(store, factory=reader_store_from_env)
    try:
        result = election_outcomes.applicable_outcomes(
            db, snapshot_id=snapshot_id, race_ids=race_ids, store=scope
        )
        scope.raise_if_failed()
        return result
    except SourceFileLimitError:
        raise problem_exception(
            503,
            "Service Unavailable",
            "Records are busy",
            headers={"Retry-After": "1"},
        ) from None


def reader_store_from_env():
    """Match the checked reader budget without changing ingestion clients.

    Reads fail closed when an original cannot be fetched. A failed request can
    retry from a fresh source scope, rather than multiplying SDK retries across
    every original in a report.
    """
    from botocore.config import Config

    from alethical.pipeline.raw_file_store import raw_file_store_from_env

    return raw_file_store_from_env(
        client_config=Config(
            connect_timeout=10,
            read_timeout=30,
            retries={"total_max_attempts": 1},
            max_pool_connections=SOURCE_WORKERS,
        )
    )
