"""Bounded exact-byte proofs in request-owned files, separate from approval.

The store keeps its existing get(key, destination, max_bytes=...) interface.
Neither metadata nor a verified file establishes candidate identity or approves
source facts. No original availability survives the owning context.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
import hashlib
from pathlib import Path
import re
import stat
import tempfile
from threading import Lock
from types import MappingProxyType
from typing import BinaryIO
import zlib

from alethical.pipeline.raw_file_store import StorageReadError

CHUNK_BYTES = 1024 * 1024
MAX_ORIGINAL_BYTES = 64 * 1024 * 1024
MAX_CLOSURE_BYTES = 64 * 1024 * 1024
MAX_COMPRESSED_BYTES = 128 * 1024 * 1024
MAX_SMALL_HTML_BYTES = 2 * 1024 * 1024
MAX_CLOSURE_SOURCES = 256
_PROOF_SEAL = object()


class SourceFileError(ValueError):
    """An exact retained original could not be proved."""


class SourceFileLimitError(SourceFileError):
    """A bounded source closure cannot currently reserve file resources."""


def _require(condition, message):
    if not condition:
        raise SourceFileError(message)


@dataclass(frozen=True, slots=True)
class _Metadata:
    content_hash: str
    object_key: str
    byte_size: int
    compressed_hash: str
    compressed_byte_size: int
    compression: str
    media_type: str | None


def _metadata(source):
    def field(name, default=None):
        return (
            source.get(name, default)
            if isinstance(source, Mapping)
            else getattr(source, name, default)
        )

    value = _Metadata(**{name: field(name) for name in _Metadata.__dataclass_fields__})
    _require(
        all(
            isinstance(h, str) and re.fullmatch(r"[a-f0-9]{64}", h)
            for h in (value.content_hash, value.compressed_hash)
        )
        and isinstance(value.object_key, str)
        and bool(value.object_key.strip())
        and len(value.object_key) <= 1024
        and not any(ord(c) < 32 for c in value.object_key)
        and type(value.byte_size) is int
        and 0 <= value.byte_size <= MAX_ORIGINAL_BYTES
        and type(value.compressed_byte_size) is int
        and 0 <= value.compressed_byte_size <= MAX_COMPRESSED_BYTES
        and isinstance(value.compression, str)
        and value.compression in {"gzip", "raw"}
        and (
            value.media_type is None
            or isinstance(value.media_type, str)
            and len(value.media_type) <= 256
            and "\x00" not in value.media_type
        ),
        "Retained source metadata is invalid or exceeds file bounds",
    )
    _require(
        value.compression != "raw"
        or (
            value.compressed_byte_size == value.byte_size
            and value.compressed_hash == value.content_hash
        ),
        "Raw source metadata has conflicting stored and original identity",
    )
    _require(
        value.compression != "gzip" or value.compressed_byte_size > 0,
        "Gzip source needs nonempty retained bytes",
    )
    return value


class _Budget:
    def __init__(
        self, workers=4, raw_bytes=128 * 1024 * 1024, compressed_bytes=256 * 1024 * 1024
    ):
        self.workers, self.raw_limit, self.compressed_limit = (
            workers,
            raw_bytes,
            compressed_bytes,
        )
        self.active = self.raw = self.compressed = 0
        self.lock = Lock()

    def acquire(self, raw, compressed):
        with self.lock:
            if (
                self.active + 1 > self.workers
                or self.raw + raw > self.raw_limit
                or self.compressed + compressed > self.compressed_limit
            ):
                raise SourceFileLimitError(
                    "Retained source file resources are busy or exceed the process budget"
                )
            self.active += 1
            self.raw += raw
            self.compressed += compressed

    def release(self, raw, compressed):
        with self.lock:
            self.active -= 1
            self.raw -= raw
            self.compressed -= compressed

    def snapshot(self):
        with self.lock:
            return self.active, self.raw, self.compressed


_BUDGET = _Budget()


class _Owner:
    def __init__(self):
        self.active = True
        self.handles = ExitStack()
        self.lock = Lock()

    def check(self):
        with self.lock:
            _require(self.active, "Verified source file is outside its owning context")

    def open(self, path):
        with self.lock:
            _require(self.active, "Verified source file is outside its owning context")
            return self.handles.enter_context(path.open("rb"))

    def close(self):
        with self.lock:
            self.active = False
            self.handles.close()


class VerifiedSourceFile:
    """Server-created proof, usable only while its owned context remains open."""

    __slots__ = ("_metadata", "_path", "_owner", "_required_type")

    def __init__(self, metadata, path, owner, required_type, *, _seal=None):
        _require(
            _seal is _PROOF_SEAL,
            "Verified source files require exact-byte verification",
        )
        self._metadata, self._path, self._owner, self._required_type = (
            metadata,
            path,
            owner,
            required_type,
        )

    @property
    def content_hash(self):
        self._owner.check()
        return self._metadata.content_hash

    @property
    def byte_size(self):
        self._owner.check()
        return self._metadata.byte_size

    @property
    def path(self) -> Path:
        self._owner.check()
        return self._path

    def open(self) -> BinaryIO:
        return self._owner.open(self._path)

    def read_small_html(self, *, max_bytes: int) -> bytes:
        self._owner.check()
        _require(
            self._required_type == "html"
            and _is_html(self._metadata.media_type)
            and type(max_bytes) is int
            and 0 < max_bytes <= MAX_SMALL_HTML_BYTES
            and self.byte_size <= max_bytes,
            "Small HTML access needs verified HTML and an explicit bounded size",
        )
        with self.open() as handle:
            body = handle.read(self.byte_size + 1)
        _require(len(body) == self.byte_size, "Verified HTML file changed")
        return body


def _is_html(media_type):
    return isinstance(media_type, str) and media_type.split(";", 1)[
        0
    ].strip().lower() in {"text/html", "application/xhtml+xml"}


def _stored_identity(path, metadata):
    _require(
        stat.S_ISREG(path.lstat().st_mode)
        and not path.is_symlink()
        and path.stat().st_size == metadata.compressed_byte_size,
        "Stored source is not an exact bounded regular file",
    )
    total, hasher = 0, hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK_BYTES):
            total += len(chunk)
            _require(
                total <= metadata.compressed_byte_size,
                "Stored source grew while being verified",
            )
            hasher.update(chunk)
    _require(
        total == metadata.compressed_byte_size
        and hasher.hexdigest() == metadata.compressed_hash,
        "Stored source length or fingerprint differs",
    )


def _restore(stored, raw, metadata, required_type):
    total, stored_total = 0, 0
    raw_hash, stored_hash = hashlib.sha256(), hashlib.sha256()
    prefix = bytearray()
    decoder = (
        zlib.decompressobj(16 + zlib.MAX_WBITS)
        if metadata.compression == "gzip"
        else None
    )
    with stored.open("rb") as source, raw.open("xb") as target:

        def write(chunk):
            nonlocal total
            total += len(chunk)
            _require(
                total <= metadata.byte_size and total <= MAX_ORIGINAL_BYTES,
                "Original exceeds its declared or hard byte bound",
            )
            raw_hash.update(chunk)
            if len(prefix) < 4096:
                prefix.extend(chunk[: 4096 - len(prefix)])
            if target.write(chunk) != len(chunk):
                raise StorageReadError("Original spool write was incomplete")

        while chunk := source.read(CHUNK_BYTES):
            stored_total += len(chunk)
            _require(
                stored_total <= metadata.compressed_byte_size,
                "Stored source grew during restoration",
            )
            stored_hash.update(chunk)
            if decoder is None:
                write(chunk)
                continue
            _require(not decoder.eof, "Gzip source has trailing bytes or extra members")
            pending = chunk
            while pending:
                write(
                    decoder.decompress(
                        pending, min(CHUNK_BYTES, metadata.byte_size - total + 1)
                    )
                )
                pending = decoder.unconsumed_tail
                _require(
                    not decoder.unused_data,
                    "Gzip source has trailing bytes or extra members",
                )
        _require(decoder is None or decoder.eof, "Gzip source is truncated")
    _require(
        stored_total == metadata.compressed_byte_size
        and stored_hash.hexdigest() == metadata.compressed_hash
        and total == metadata.byte_size
        and raw.stat().st_size == total
        and raw_hash.hexdigest() == metadata.content_hash,
        "Restored source length or fingerprint differs",
    )
    if required_type == "pdf":
        _require(prefix.startswith(b"%PDF-"), "Required original is not PDF")
    elif required_type == "jpeg":
        _require(prefix.startswith(b"\xff\xd8\xff"), "Required original is not JPEG")
    elif required_type == "html":
        _require(
            bytes(prefix).removeprefix(b"\xef\xbb\xbf").lstrip().startswith(b"<")
            and b"\x00" not in prefix,
            "Required original is not supported HTML",
        )
    raw.chmod(0o400)


@contextmanager
def verified_source_files(
    store, sources: Iterable, *, required_types: Mapping[str, str] | None = None
):
    """Prove one bounded unique closure; no path or successful cache is reused.

    Resource admission is fail-fast and process-wide. Each member's compressed
    copy is removed before fetching the next; all raw files live until exit.
    """
    metadata = {}
    for source in sources:
        value = _metadata(source)
        previous = metadata.get(value.content_hash)
        _require(
            previous is None or previous == value,
            "One original has conflicting retained metadata",
        )
        metadata[value.content_hash] = value
        _require(
            len(metadata) <= MAX_CLOSURE_SOURCES,
            "Source closure has too many unique members",
        )
    _require(bool(metadata), "Source file closure is empty")
    raw_size = sum(value.byte_size for value in metadata.values())
    _require(
        raw_size <= MAX_CLOSURE_BYTES,
        "Unique original closure exceeds its raw byte bound",
    )
    _require(
        required_types is None or isinstance(required_types, Mapping),
        "Source type requirements must be a mapping",
    )
    kinds = dict(required_types or {})
    _require(
        set(kinds) <= metadata.keys()
        and all(
            isinstance(kind, str) and kind in {"pdf", "html", "jpeg"}
            for kind in kinds.values()
        ),
        "Source type requirement is unsupported or outside its closure",
    )
    _require(
        all(
            kind != "html" or _is_html(metadata[h].media_type)
            for h, kind in kinds.items()
        ),
        "HTML source requires its retained HTML media type",
    )
    _require(
        all(
            kind != "jpeg"
            or metadata[h].media_type is None
            or metadata[h].media_type.split(";", 1)[0].strip().lower() == "image/jpeg"
            for h, kind in kinds.items()
        ),
        "JPEG source has conflicting retained media type",
    )
    compressed_size = max(value.compressed_byte_size for value in metadata.values())
    budget = _BUDGET
    budget.acquire(raw_size, compressed_size)
    owner = _Owner()
    yielded = False
    try:
        with tempfile.TemporaryDirectory(prefix="election-source-files-") as directory:
            files = {}
            try:
                for index, value in enumerate(metadata.values()):
                    stored = Path(directory) / "stored"
                    raw = Path(directory) / f"original-{index}"
                    store.get(
                        value.object_key,
                        str(stored),
                        max_bytes=value.compressed_byte_size,
                    )
                    _stored_identity(stored, value)
                    _restore(stored, raw, value, kinds.get(value.content_hash))
                    stored.unlink()
                    files[value.content_hash] = VerifiedSourceFile(
                        value,
                        raw,
                        owner,
                        kinds.get(value.content_hash),
                        _seal=_PROOF_SEAL,
                    )
                yielded = True
                yield MappingProxyType(files)
            finally:
                owner.close()
    except SourceFileError:
        raise
    except Exception as error:
        record_failure = getattr(store, "record_failure", None)
        if callable(record_failure):
            record_failure(error)
        if yielded:
            raise
        raise SourceFileError(
            "Could not verify or clean up retained source files"
        ) from error
    finally:
        budget.release(raw_size, compressed_size)
