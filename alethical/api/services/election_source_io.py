"""Bound election reader I/O without carrying source availability across requests."""

from collections import OrderedDict, deque
from concurrent.futures import ThreadPoolExecutor, wait
from pathlib import Path
from threading import Lock, RLock, BoundedSemaphore

from alethical.pipeline.election_comparison import ComparisonImportError

# One process budget, not 16 new remote readers for each admitted HTTP request.
SOURCE_WORKERS = 16
_READ_SLOTS = BoundedSemaphore(SOURCE_WORKERS)
_POOL = ThreadPoolExecutor(
    max_workers=SOURCE_WORKERS, thread_name_prefix="election-source"
)


def source_map(check, jobs):
    """Keep at most one window queued per request, preserving input order.

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
            result = pending[0].result()
            pending.popleft()
            yield result
            try:
                pending.append(_POOL.submit(check, next(jobs)))
            except StopIteration:
                pass
    finally:
        for future in pending:
            future.cancel()
        wait(pending)


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
                    Path(path).write_bytes(body)
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
                        raise ComparisonImportError("Source changed while being read")
                    self.entries[key] = body
                    self.size += length


def request_store(store):
    """Preserve an explicitly passed request scope instead of nesting caches."""
    return store if isinstance(store, FreshReadStore) else FreshReadStore(store)


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
