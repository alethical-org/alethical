"""Optional shared copy of Minnesota's public address points, never reader requests.

Off by default. When a host turns it on, every API process on that machine reads
1 shared copy in 1 folder. Only the process holding the folder's refresh lock
downloads and builds a replacement, which is checked before an all-at-once swap.
A missing, expired, unreadable or over-cap copy returns None so the caller asks
the live government service instead. Typing never starts a download.
"""

from __future__ import annotations

from dataclasses import dataclass
from contextlib import closing
import fcntl
import hashlib
from http.cookiejar import DefaultCookiePolicy
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import tempfile
import threading
import time
from collections.abc import Callable

import requests

SOURCE_URL = "https://operations.gis.data.mn.gov/api/publicdownload/download/497/loc_addresses_open.gpkg"
MAX_DOWNLOAD_BYTES = 1_200_000_000
# Source file, new copy and the 2 kept copies, with room to spare.
MIN_FREE_BYTES = 3_000_000_000
TTL_SECONDS = 24 * 60 * 60
REFRESH_SECONDS = 12 * 60 * 60
RETRY_SECONDS = 60 * 60
# How often each process rereads the shared folder's state.
CHECK_SECONDS = 5 * 60
MAX_ROWS = 5000
MANIFEST = "current.json"
LOCK = "refresh.lock"
FAILED = "last-failure.json"
_COPY_NAME = re.compile(r"copy-[0-9a-f]{16}-\d{10,}-[0-9a-f]{8}\.sqlite")
ADDRESS_FIELDS = (
    "anumberpre",
    "anumber",
    "anumbersuf",
    "st_pre_mod",
    "st_pre_dir",
    "st_pre_typ",
    "st_pre_sep",
    "st_name",
    "st_pos_typ",
    "st_pos_dir",
    "st_pos_mod",
    "postcomm",
    "ctu_name",
    "zip",
    "state_code",
    "longitude",
    "latitude",
    "status",
)


class _RejectCookies(DefaultCookiePolicy):
    def set_ok(self, cookie, request):
        return False

    def return_ok(self, cookie, request):
        return False


def _download(destination: Path, stop: threading.Event) -> None:
    started = time.monotonic()
    with requests.Session() as session:
        session.trust_env = False
        session.cookies.set_policy(_RejectCookies())
        with session.get(
            SOURCE_URL,
            stream=True,
            timeout=(3.05, 15),
            allow_redirects=False,
            headers={"Accept-Encoding": "identity"},
        ) as response:
            if response.status_code != 200:
                raise ValueError("Public address download unavailable")
            size = 0
            length = response.headers.get("Content-Length")
            if length is not None and not 0 < int(length) <= MAX_DOWNLOAD_BYTES:
                raise ValueError("Public address download exceeds limit")
            with destination.open("wb") as output:
                while True:
                    # read1 returns available bytes instead of waiting to fill a
                    # chunk. A drip-fed body cannot postpone the deadline check.
                    # Allow 15s for the final socket read within the 180s budget.
                    if stop.is_set() or time.monotonic() - started > 165:
                        raise ValueError("Public address download interrupted")
                    chunk = response.raw.read1(1 << 20)
                    if not chunk:
                        break
                    size += len(chunk)
                    if stop.is_set() or time.monotonic() - started > 180:
                        raise ValueError("Public address download interrupted")
                    if size > MAX_DOWNLOAD_BYTES:
                        raise ValueError("Public address download exceeds limit")
                    output.write(chunk)
            if length is not None and int(length) != size:
                raise ValueError("Public address download incomplete")


def _read_only(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
    connection.execute("PRAGMA trusted_schema=OFF")
    return connection


def _write_json(path: Path, value: dict) -> None:
    """Replace a small state file all at once, so a reader never sees half of it."""
    handle, temporary = tempfile.mkstemp(prefix=".state-", dir=path.parent)
    try:
        with os.fdopen(handle, "w") as output:
            json.dump(value, output)
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


@dataclass(frozen=True)
class _Snapshot:
    path: Path
    expires_at: float
    source_hash: str
    count: int


class AddressSuggestionIndex:
    def __init__(
        self,
        *,
        enabled: bool = False,
        directory: Path | None = None,
        clock: Callable[[], float] = time.time,
        downloader: Callable[[Path, threading.Event], None] = _download,
        min_source_rows: int = 1_000_000,
        max_source_rows: int = 4_000_000,
    ) -> None:
        self.enabled = enabled
        # Every process on a machine shares this folder, so it is a fixed path.
        self._root = directory or Path(tempfile.gettempdir()) / "alethical-address-copy"
        # Wall-clock time: processes compare 1 saved download time.
        self._clock = clock
        self._downloader = downloader
        self._min_rows = min_source_rows
        self._max_rows = max_source_rows
        self._lock = threading.Lock()
        self._refresh_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._manifest_stamp: tuple[int, int, int] | None = None
        self._snapshot: _Snapshot | None = None
        self._unreadable: Path | None = None

    def start(self) -> None:
        """Start explicitly; constructing or querying never starts a download."""
        with self._lock:
            if not self.enabled or self._stop.is_set() or self._thread is not None:
                return
            self._thread = threading.Thread(
                target=self._run, name="public-address-copy", daemon=True
            )
            self._thread.start()

    def stop(self) -> None:
        """Stop this process's refresher. The shared copy stays for other processes."""
        self._stop.set()
        with self._lock:
            thread = self._thread
        if thread is not None:
            # The bounded socket read or SQLite progress callback must unwind
            # before shutdown returns, or process exit can strand a large file.
            thread.join()

    def _run(self) -> None:
        while not self._stop.is_set():
            if self.refresh_due():
                self.refresh()
            self._stop.wait(CHECK_SECONDS)

    def refresh_due(self) -> bool:
        """True when the shared copy is missing, old, unreadable, and no retry waits."""
        if not self.enabled:
            return False
        now = self._clock()
        snapshot = self._current()
        if (
            snapshot is not None
            and snapshot.path != self._unreadable
            and now < snapshot.expires_at - TTL_SECONDS + REFRESH_SECONDS
        ):
            return False
        try:
            failed_at = json.loads((self._root / FAILED).read_text())["failed_at"]
        except (OSError, ValueError, KeyError, TypeError):
            return True
        return not (
            isinstance(failed_at, int | float) and 0 <= now - failed_at < RETRY_SECONDS
        )

    def refresh(self) -> bool:
        """Build and publish a complete new copy; any failure keeps the old one."""
        if not self.enabled or self._stop.is_set():
            return False
        if not self._refresh_lock.acquire(blocking=False):
            return False
        try:
            self._root.mkdir(mode=0o700, parents=True, exist_ok=True)
            with open(self._root / LOCK, "a") as lock_file:
                try:
                    fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError:
                    # Another process on this machine is already building one.
                    return False
                try:
                    published = self._build_and_publish()
                except Exception:
                    # Source and SQLite exceptions can contain URLs or address
                    # values. No queries, exception strings or rows are logged.
                    published = False
                if not published and not self._stop.is_set():
                    try:
                        _write_json(self._root / FAILED, {"failed_at": self._clock()})
                    except OSError:
                        pass
                return published
        except OSError:
            return False
        finally:
            self._refresh_lock.release()

    def _build_and_publish(self) -> bool:
        for leftover in self._root.glob("pending-*"):
            # Only a lock holder builds, so these belong to an interrupted build.
            shutil.rmtree(leftover, ignore_errors=True)
        if shutil.disk_usage(self._root).free < MIN_FREE_BYTES:
            return False
        pending = Path(tempfile.mkdtemp(prefix="pending-", dir=self._root))
        try:
            source = pending / "source.gpkg"
            self._downloader(source, self._stop)
            downloaded_at = self._clock()
            built = pending / "addresses.sqlite"
            digest, count = self._project(source, built)
            source.unlink()
            if self._stop.is_set():
                return False
            # Unique per build, so a rebuild never reuses a damaged copy's path.
            name = f"copy-{digest[:16]}-{int(downloaded_at):010d}-{secrets.token_hex(4)}.sqlite"
            os.replace(built, self._root / name)
            previous = self._current()
            _write_json(
                self._root / MANIFEST,
                {
                    "file": name,
                    "downloaded_at": downloaded_at,
                    "source_hash": digest,
                    "count": count,
                },
            )
            (self._root / FAILED).unlink(missing_ok=True)
            keep = {name, previous.path.name if previous else None}
            for old in self._root.glob("copy-*.sqlite"):
                # Readers open each query fresh; an open file survives removal.
                if old.name not in keep:
                    old.unlink(missing_ok=True)
            return True
        finally:
            shutil.rmtree(pending, ignore_errors=True)

    def _project(self, source: Path, output: Path) -> tuple[str, int]:
        size = source.stat().st_size
        with source.open("rb") as handle:
            header = handle.read(100)
            if len(header) != 100 or header[:16] != b"SQLite format 3\0":
                raise ValueError("Invalid public address file")
            page_size = int.from_bytes(header[16:18], "big")
            page_size = 65536 if page_size == 1 else page_size
            if size > MAX_DOWNLOAD_BYTES or size != page_size * int.from_bytes(
                header[28:32], "big"
            ):
                raise ValueError("Incomplete public address file")
            handle.seek(0)
            hasher = hashlib.sha256()
            while True:
                if self._stop.is_set():
                    raise ValueError("Public address build interrupted")
                chunk = handle.read(1 << 20)
                if not chunk:
                    break
                hasher.update(chunk)
            digest = hasher.hexdigest()
        with (
            closing(_read_only(source)) as incoming,
            closing(sqlite3.connect(output)) as outgoing,
        ):
            incoming.set_progress_handler(lambda: int(self._stop.is_set()), 10000)
            outgoing.set_progress_handler(lambda: int(self._stop.is_set()), 10000)
            if incoming.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise ValueError("Corrupt public address file")
            schema = {
                row[1]: row[2].upper()
                for row in incoming.execute("PRAGMA table_info(loc_addresses_open)")
            }
            required = ("objectid", *ADDRESS_FIELDS)
            if not all(field in schema for field in required):
                raise ValueError("Public address fields missing")
            for field in required:
                expected = (
                    "INT"
                    if field in ("objectid", "anumber")
                    else "REAL"
                    if field in ("longitude", "latitude")
                    else "TEXT"
                )
                if expected not in schema[field]:
                    raise ValueError("Public address field type changed")
            count = incoming.execute(
                "SELECT COUNT(*) FROM loc_addresses_open"
            ).fetchone()[0]
            if not self._min_rows <= count <= self._max_rows:
                raise ValueError("Public address count outside bounds")
            columns = ",".join(required)
            outgoing.execute(
                f"CREATE TABLE addresses ({columns}, street_upper TEXT, suffix_upper TEXT)"
            )
            placeholders = ",".join("?" for _ in range(len(required) + 2))
            cursor = incoming.execute(f"SELECT {columns} FROM loc_addresses_open")
            while rows := cursor.fetchmany(5000):
                if self._stop.is_set():
                    raise ValueError("Public address build interrupted")
                values = []
                for row in rows:
                    attributes = dict(zip(required, row))
                    if not isinstance(attributes["objectid"], int):
                        raise ValueError("Invalid public address identity")
                    for field in ADDRESS_FIELDS:
                        value = attributes[field]
                        kinds = (
                            (int,)
                            if field == "anumber"
                            else (int, float)
                            if field in ("longitude", "latitude")
                            else (str,)
                        )
                        if value is not None and not isinstance(value, kinds):
                            raise ValueError("Public address field value changed")
                    for field in ("st_name", "anumbersuf"):
                        value = attributes[field]
                        if value is not None and any(
                            ord(char) < 32 or ord(char) >= 127 for char in value
                        ):
                            raise ValueError("Public address matching encoding changed")
                    values.append(
                        (
                            *row,
                            (attributes["st_name"] or "").upper(),
                            (attributes["anumbersuf"] or "").upper(),
                        )
                    )
                outgoing.executemany(
                    f"INSERT INTO addresses VALUES ({placeholders})", values
                )
            outgoing.execute(
                "CREATE UNIQUE INDEX source_identity ON addresses(objectid)"
            )
            outgoing.execute(
                "CREATE INDEX house_street ON addresses(anumber, street_upper)"
            )
            if (
                outgoing.execute("SELECT COUNT(*) FROM addresses").fetchone()[0]
                != count
            ):
                raise ValueError("Incomplete public address projection")
            if outgoing.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise ValueError("Invalid public address projection")
            outgoing.commit()
        return digest, count

    def _current(self) -> _Snapshot | None:
        """The published copy, reread only when the shared state file changes."""
        manifest = self._root / MANIFEST
        try:
            stat = manifest.stat()
        except OSError:
            return None
        stamp = (stat.st_ino, stat.st_mtime_ns, stat.st_size)
        with self._lock:
            if stamp == self._manifest_stamp:
                return self._snapshot
        snapshot = None
        try:
            value = json.loads(manifest.read_text())
            name, downloaded_at = value["file"], value["downloaded_at"]
            if (
                isinstance(name, str)
                and _COPY_NAME.fullmatch(name)
                and isinstance(downloaded_at, int | float)
                # A copy dated in the future would never expire on this clock.
                and downloaded_at <= self._clock() + 300
            ):
                snapshot = _Snapshot(
                    self._root / name,
                    downloaded_at + TTL_SECONDS,
                    str(value["source_hash"]),
                    int(value["count"]),
                )
        except (OSError, ValueError, KeyError, TypeError):
            snapshot = None
        with self._lock:
            self._manifest_stamp, self._snapshot = stamp, snapshot
        return snapshot

    def status(self) -> dict:
        snapshot = self._current() if self.enabled else None
        return {
            "ready": bool(
                snapshot
                and self._clock() < snapshot.expires_at
                and snapshot.path != self._unreadable
            ),
            "expires_at": snapshot.expires_at if snapshot else None,
            "source_hash": snapshot.source_hash if snapshot else None,
            "count": snapshot.count if snapshot else 0,
        }

    def suggestions(
        self,
        *,
        house_number: int,
        street_names: tuple[str, ...],
        house_suffix: str | None = None,
    ) -> list[object] | None:
        if (
            not self.enabled
            or self._stop.is_set()
            or not street_names
            or any(not name or not name.isascii() for name in street_names)
        ):
            return None
        snapshot = self._current()
        if (
            snapshot is None
            or self._clock() >= snapshot.expires_at
            or snapshot.path == self._unreadable
        ):
            return None
        clauses = ["anumber = ?"]
        arguments: list[object] = [house_number]
        # ASCII prefix ranges use the compound index without LIKE wildcards.
        clauses.append(
            "("
            + " OR ".join(
                "(street_upper >= ? AND street_upper < ?)" for _ in street_names
            )
            + ")"
        )
        for name in street_names:
            prefix = name.upper()
            arguments.extend((prefix, prefix + "\x7f"))
        if house_suffix:
            clauses.append("suffix_upper = ?")
            arguments.append(house_suffix.upper())
        try:
            with closing(_read_only(snapshot.path)) as connection:
                rows = connection.execute(
                    f"SELECT {','.join(ADDRESS_FIELDS)} FROM addresses WHERE {' AND '.join(clauses)} ORDER BY objectid LIMIT ?",
                    (*arguments, MAX_ROWS + 1),
                ).fetchall()
        except sqlite3.DatabaseError:
            # A damaged copy is skipped until a rebuild replaces it.
            self._unreadable = snapshot.path
            return None
        except (OSError, sqlite3.Error):
            return None
        if len(rows) > MAX_ROWS:
            return None
        if self._clock() >= snapshot.expires_at:
            return None
        return [{"attributes": dict(zip(ADDRESS_FIELDS, row))} for row in rows]


_default_index: AddressSuggestionIndex | None = None
_default_lock = threading.Lock()


def get_address_suggestion_index() -> AddressSuggestionIndex:
    """Configuration creates an idle service; the host owns start and stop."""
    global _default_index
    with _default_lock:
        if _default_index is None or _default_index._stop.is_set():
            directory = os.environ.get("ALETHICAL_ADDRESS_SUGGESTION_INDEX_DIRECTORY")
            _default_index = AddressSuggestionIndex(
                enabled=os.environ.get(
                    "ALETHICAL_ADDRESS_SUGGESTION_INDEX_ENABLED", ""
                ).lower()
                in {"1", "true", "on"},
                directory=Path(directory).resolve() if directory else None,
            )
        return _default_index
