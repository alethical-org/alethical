#!/usr/bin/env python3
"""Check every indexed national FCC filing for an obtainable original PDF.

The work list and every outcome live in private R2, so a run can stop at any time
and the next run continues where it left off. A run downloads public PDFs at a
paced, adaptive rate, verifies each one, stores identical bytes once under their
SHA-256 and appends compact outcome files. No command changes Finance data.

Outcomes per attempt:

* ``saved``: a readable PDF whose stored bytes R2 verified by SHA-256.
* ``missing``: the download address refused the file and the FCC file record has
  no other download address. A filing is confirmed unavailable only after
  ``CONFIRM_ATTEMPTS`` such answers at least ``CONFIRM_GAP_SECONDS`` apart.
* ``unreadable``: the FCC returned bytes that are not a readable PDF. Confirmed
  the same way as ``missing``.
* ``retry``: a timeout, busy answer, server error or storage failure. It proves
  nothing about the filing and is always tried again.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import io
import json
import os
import random
import re
import sqlite3
import sys
import tempfile
import threading
import time
from array import array
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import closing, contextmanager
from pathlib import Path

PREFIX = "fcc-national/v1"
DOWNLOAD = "https://files.fcc.gov/download/{manager}.pdf"
DETAIL = (
    "https://publicfiles.fcc.gov/api/manager/file/id/{file_id}.json?entityId={entity}"
)
USER_AGENT = "Alethical public-record archive (+https://alethical.com)"
UUID_PATTERN = re.compile(r"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
# 401 is how files.fcc.gov answers for a missing file. 403 also answers a blocked
# client (a default Python client gets 403 for a file that downloads normally), so it
# is a retry, never a refusal.
MISSING_STATUS = {401, 404, 410}
CONFIRM_ATTEMPTS = 2
CONFIRM_GAP_SECONDS = 6 * 3600
MAX_FILE_BYTES = 512 * 1024**2
OVERSIZE_MAX_BYTES = 8 * 1024**3
# Outcome rows written by this version. Earlier unreadable rows skipped the
# alternate address and earlier missing rows could hold unexpected statuses;
# both are read as retries so they are checked again.
OUTCOME_VERSION = 2
FLUSH_ROWS = 2000
FLUSH_SECONDS = 300


def run_prefix(run_id: str) -> str:
    if not re.fullmatch(r"[a-z0-9-]{3,40}", run_id):
        raise ValueError("Run IDs use 3 to 40 lowercase letters, digits or dashes")
    return f"{PREFIX}/recovery/{run_id}"


def original_key(sha: str) -> str:
    return f"{PREFIX}/originals/sha256/{sha[:2]}/{sha}.pdf"


def gz_lines(rows) -> bytes:
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0) as out:
        for row in rows:
            out.write(json.dumps(row, separators=(",", ":")).encode() + b"\n")
    return buffer.getvalue()


def read_gz_lines(body: bytes):
    with gzip.GzipFile(fileobj=io.BytesIO(body)) as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


# ---------------------------------------------------------------- work list


def build_worklist(inventory: Path, prior_catalog: Path, minnesota: Path):
    """Every inventory filing, marked when we already hold its original."""
    prior = {}
    with closing(sqlite3.connect(inventory_uri(prior_catalog), uri=True)) as db:
        for key, meta in db.execute(
            "SELECT record_key, metadata_json FROM documents WHERE status='downloaded'"
        ):
            prior[key] = json.loads(meta)
    held_mn = {}
    for line in minnesota.read_text().splitlines():
        row = json.loads(line)
        held_mn[row["record_key"]] = row
    counts = Counter()
    with closing(sqlite3.connect(inventory_uri(inventory), uri=True)) as db:
        for key, file_id, service, entity, manager, size in db.execute(
            "SELECT record_key, file_id, service, entity_id, file_manager_id, source_bytes"
            " FROM files ORDER BY rowid"
        ):
            manager = (manager or "").lower()
            row = {
                "k": key,
                "s": service,
                "e": entity,
                "f": file_id,
                "m": manager,
                "n": int(size or 0),
            }
            if key in prior:
                row["held"] = "archive"
            elif key in held_mn:
                row["held"] = "minnesota"
                row["mn"] = held_mn[key]["content_hash"]
            elif not UUID_PATTERN.fullmatch(manager):
                row["m"] = ""
            counts[row.get("held", "check")] += 1
            yield row
    print(json.dumps({"worklist": dict(counts)}), file=sys.stderr)


def inventory_uri(path: Path) -> str:
    return path.resolve().as_uri() + "?mode=ro"


# ---------------------------------------------------------------- storage


class Store:
    def __init__(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from alethical.db.session import load_dotenv_if_present
        from alethical.pipeline.raw_file_store import mirror_file_store_from_env

        load_dotenv_if_present()
        store = mirror_file_store_from_env()
        self.client = store._client
        self.bucket = store.bucket

    def get(self, key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        with closing(response["Body"]) as body:
            return body.read()

    def put_small(self, key: str, body: bytes, content_type: str) -> None:
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
            ChecksumSHA256=base64.b64encode(hashlib.sha256(body).digest()).decode(),
        )

    def get_optional(self, key: str) -> bytes | None:
        from botocore.exceptions import ClientError

        try:
            return self.get(key)
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                return None
            raise

    def download(self, key: str, path: Path) -> None:
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        with closing(response["Body"]) as body, path.open("wb") as out:
            while block := body.read(1 << 20):
                out.write(block)

    def put_file(self, key: str, path: Path, content_type: str) -> None:
        checksum = base64.b64encode(bytes.fromhex(file_sha256(path))).decode()
        with path.open("rb") as body:
            self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=body,
                ContentType=content_type,
                ChecksumSHA256=checksum,
            )

    def keys(self, prefix: str):
        token = None
        while True:
            kwargs = {"Bucket": self.bucket, "Prefix": prefix}
            if token:
                kwargs["ContinuationToken"] = token
            page = self.client.list_objects_v2(**kwargs)
            for item in page.get("Contents", []):
                yield item["Key"]
            if not page.get("IsTruncated"):
                return
            token = page["NextContinuationToken"]

    def save_pdf(self, path: Path, sha: str, size: int) -> str:
        """Write absent content once. R2 checks the SHA-256 before accepting it."""
        from botocore.exceptions import ClientError

        key = original_key(sha)
        checksum = base64.b64encode(bytes.fromhex(sha)).decode()
        with path.open("rb") as body:
            try:
                self.client.put_object(
                    Bucket=self.bucket,
                    Key=key,
                    Body=body,
                    IfNoneMatch="*",
                    ContentType="application/pdf",
                    ChecksumSHA256=checksum,
                    Metadata={"sha256": sha},
                )
                return key
            except ClientError as error:
                if error.response["ResponseMetadata"]["HTTPStatusCode"] != 412:
                    raise
        head = self.client.head_object(
            Bucket=self.bucket, Key=key, ChecksumMode="ENABLED"
        )
        if head["ContentLength"] != size:
            raise ValueError(f"Stored size differs: {key}")
        if head.get("ChecksumSHA256") == checksum:
            return key
        # An object written earlier without a server checksum is read back in full.
        actual = hashlib.sha256()
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        with closing(response["Body"]) as stored:
            while block := stored.read(1 << 20):
                actual.update(block)
        if actual.hexdigest() != sha:
            raise ValueError(f"Stored bytes failed verification: {key}")
        return key


# ---------------------------------------------------------------- pacing


class Pace:
    """A shared request clock that speeds up while the FCC answers normally."""

    def __init__(self, start: float, maximum: float):
        self.rate = start
        self.maximum = maximum
        self.next_at = 0.0
        self.pause_until = 0.0
        self.calm = 0
        self.lock = threading.Lock()

    def wait(self):
        while True:
            with self.lock:
                now = time.monotonic()
                start = max(self.next_at, self.pause_until)
                if start <= now:
                    self.next_at = now + 1 / self.rate
                    return
            time.sleep(min(start - now, 5))

    def ok(self):
        with self.lock:
            self.calm += 1
            if self.calm >= 400 and self.rate < self.maximum:
                self.rate = min(self.maximum, self.rate * 1.25)
                self.calm = 0

    def busy(self, seconds: float):
        with self.lock:
            self.rate = max(0.5, self.rate / 2)
            self.calm = 0
            self.pause_until = max(self.pause_until, time.monotonic() + max(5, seconds))


# ---------------------------------------------------------------- checking


class Busy(Exception):
    pass


def retry_after(value) -> float:
    try:
        return min(3600.0, max(1.0, float(value)))
    except (TypeError, ValueError):
        return 60.0


class Oversize(Exception):
    def __init__(self, size):
        super().__init__(f"file larger than {size} bytes")
        self.size = size


def download(http, pace: Pace, url: str, target: Path, limit: int = MAX_FILE_BYTES):
    """Return (status, sha, size). Streams to disk; follows only FCC redirects.

    Busy covers every answer that says nothing about the filing: busy or failing
    servers, timeouts, unexpected statuses, redirects away from the FCC and web
    pages served in place of a file (a challenge or error page).
    """
    for _ in range(5):
        pace.wait()
        with http.stream("GET", url) as response:
            code = response.status_code
            if code in (429, 503):
                pace.busy(retry_after(response.headers.get("Retry-After")))
                raise Busy(f"HTTP {code}")
            if response.is_redirect:
                url = str(response.url.join(response.headers.get("location", "")))
                if not re.match(r"^https://([a-z0-9-]+\.)*fcc\.gov/", url):
                    raise Busy("redirect away from the FCC")
                continue
            if code in MISSING_STATUS:
                return code, None, 0
            if code != 200:
                raise Busy(f"unexpected HTTP {code}")
            kind = (
                response.headers.get("content-type", "").split(";")[0].strip().lower()
            )
            if kind in ("text/html", "application/xhtml+xml"):
                raise Busy("web page instead of a file")
            declared = int(response.headers.get("content-length") or 0)
            if declared > limit:
                raise Oversize(declared)
            digest = hashlib.sha256()
            size = 0
            with target.open("wb") as out:
                for chunk in response.iter_bytes(1 << 16):
                    size += len(chunk)
                    if size > limit:
                        raise Oversize(size)
                    digest.update(chunk)
                    out.write(chunk)
            if declared and size != declared:
                raise Busy("download ended early")
            pace.ok()
            return 200, digest.hexdigest(), size
    raise Busy("too many redirects")


def pdf_pages(path: Path) -> int:
    import logging

    from pypdf import PdfReader

    logging.getLogger("pypdf").setLevel(logging.ERROR)

    with path.open("rb") as stream:
        if not re.search(rb"%PDF-\d\.\d", stream.read(1024)):
            raise ValueError("no PDF header")
    reader = PdfReader(str(path))
    if reader.is_encrypted and not reader.decrypt(""):
        raise ValueError("password required")
    pages = len(reader.pages)
    if pages < 1:
        raise ValueError("no pages")
    return pages


def current_manager(http, pace: Pace, row) -> str | None:
    """The FCC file record's own download identifier, if it differs."""
    pace.wait()
    response = http.get(DETAIL.format(file_id=row["f"], entity=row["e"]))
    if response.status_code in (429, 503) or response.status_code >= 500:
        pace.busy(retry_after(response.headers.get("Retry-After")))
        raise Busy(f"detail HTTP {response.status_code}")
    try:
        detail = response.json().get("file") or {}
    except ValueError:
        return None
    manager = str(detail.get("file_manager_id") or "").lower()
    if detail.get("file_id") != row["f"] or not UUID_PATTERN.fullmatch(manager):
        return None
    return None if manager == row["m"] else manager


def readable(target: Path):
    try:
        return pdf_pages(target), None
    except Exception as error:  # noqa: BLE001 - any parse failure is unreadable
        return None, type(error).__name__


def check(
    row, http, pace: Pace, store: Store, spool: Path, limit: int = MAX_FILE_BYTES
) -> dict:
    result = {"k": row["k"], "t": int(time.time()), "v": OUTCOME_VERSION}
    target = spool / f"{row['k'].replace('|', '_')}.part"
    try:
        manager = row["m"]
        # A filing listed without a download identifier goes straight to its
        # FCC file record, which is the official alternate source.
        status, sha, size = (
            download(http, pace, DOWNLOAD.format(manager=manager), target, limit)
            if manager
            else (404, None, 0)
        )
        pages, problem = readable(target) if status == 200 else (None, None)
        if status in MISSING_STATUS or problem:
            alternate = current_manager(http, pace, row)
            if alternate:
                result["mg"] = alternate
                status, sha, size = download(
                    http, pace, DOWNLOAD.format(manager=alternate), target, limit
                )
                pages, problem = readable(target) if status == 200 else (None, None)
        if status in MISSING_STATUS:
            return result | {"o": "missing", "h": status}
        if problem:
            return result | {
                "o": "unreadable",
                "h": 200,
                "sha": sha,
                "b": size,
                "err": problem,
            }
        store.save_pdf(target, sha, size)
        return result | {"o": "saved", "sha": sha, "b": size, "p": pages}
    except Oversize as error:
        return result | {"o": "oversize", "b": error.size}
    except Busy as error:
        return result | {"o": "retry", "err": str(error)[:120]}
    except Exception as error:  # noqa: BLE001 - recorded, retried, never a verdict
        return result | {"o": "retry", "err": type(error).__name__}
    finally:
        target.unlink(missing_ok=True)


# ---------------------------------------------------------------- state


def latest_state(results):
    """Fold outcome rows into one state per filing."""
    state = {}
    for row in results:
        current = state.setdefault(row["k"], {"tries": 0, "verdicts": []})
        current["tries"] += 1
        current["last"] = row
        if row["o"] == "saved":
            current["final"] = row
        elif counts_as_refusal(row):
            current["verdicts"].append(row["t"])
    return state


def counts_as_refusal(row) -> bool:
    """Only a clear refusal or unreadable bytes, from this version, counts."""
    if row["o"] == "missing":
        return row.get("h") in MISSING_STATUS
    return row["o"] == "unreadable" and row.get("v", 1) >= OUTCOME_VERSION


def settled(entry) -> str | None:
    if "final" in entry:
        return "saved"
    verdicts = sorted(entry["verdicts"])
    if (
        len(verdicts) >= CONFIRM_ATTEMPTS
        and verdicts[-1] - verdicts[0] >= CONFIRM_GAP_SECONDS
    ):
        return "unavailable"
    return None


def due(entry, now: float, oversize_lane: bool = False) -> bool:
    last = entry["last"]
    if last["o"] == "oversize":
        return oversize_lane
    if oversize_lane:
        return False
    if not entry["verdicts"]:
        # Retries, and older outcomes that no longer count as refusals.
        backoff = min(6 * 3600, 120 * 2 ** min(entry["tries"], 8))
        return now >= last["t"] + backoff
    # A refusal is checked again only after the confirmation gap.
    return now >= max(entry["verdicts"]) + CONFIRM_GAP_SECONDS


# ---------------------------------------------------------------- scratch state
#
# The functions above state the outcome rules for one filing. ``Census`` applies
# the same rules in SQL over an on-disk SQLite scratch database, so memory stays
# bounded however many filings and outcomes a run holds. The tests hold the two
# equal on the same rows.

SCHEMA_VERSION = 1
INSERT_BATCH = 50_000
QUEUE_BATCH = 5000
UUID_GLOB = "-".join("[0-9a-f]" * n for n in (8, 4, 4, 4, 12))
INVENTORY_POINTER = f"{PREFIX}/inventory/current.json"

SCHEMA_SQL = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE work (id INTEGER PRIMARY KEY, part INTEGER, k TEXT, s, e, f, m TEXT, n,
                   held TEXT, mn TEXT, upd);
CREATE TABLE results (id INTEGER PRIMARY KEY, k TEXT, o TEXT, t, v, h, sha TEXT, b, p,
                      mg TEXT);
CREATE TABLE loaded (name TEXT PRIMARY KEY);
"""

# Each line is bound as ?1 and read with SQLite's JSON operators, which keep JSON
# integers as integers and strings as text, as Python's json module does.
WORK_INSERT = (
    "INSERT INTO work (part, k, s, e, f, m, n, held, mn, upd) SELECT ?2, j->>'k',"
    " j->>'s', j->>'e', j->>'f', j->>'m', j->>'n', j->>'held', j->>'mn', j->>'update'"
    " FROM (SELECT ?1 AS j)"
)
RESULT_INSERT = (
    "INSERT INTO results (k, o, t, v, h, sha, b, p, mg) SELECT j->>'k', j->>'o',"
    " j->>'t', j->>'v', j->>'h', j->>'sha', j->>'b', j->>'p', j->>'mg'"
    " FROM (SELECT ?1 AS j)"
)
INVENTORY_INSERT = (
    "INSERT OR IGNORE INTO inv.filings (k, s, e, f, m, n) SELECT j->>'k', j->>'s',"
    " j->>'e', j->>'f', CASE WHEN lower(j->>'m') GLOB ?2 THEN lower(j->>'m') ELSE ''"
    " END, COALESCE(j->>'z', 0) FROM (SELECT ?1 AS j)"
)
# A later part's newer download id replaces the one a filing was listed with.
APPLY_UPDATES = """
UPDATE work SET m = (SELECT u.m FROM work u WHERE u.upd IS NOT NULL AND u.k = work.k
                     ORDER BY u.id DESC LIMIT 1)
WHERE upd IS NULL AND k IN (SELECT k FROM work WHERE upd IS NOT NULL)
"""

# counts_as_refusal, settled and due, as SQL.
REFUSAL_SQL = (
    f"COALESCE((o = 'missing' AND h IN ({','.join(map(str, sorted(MISSING_STATUS)))}))"
    f" OR (o = 'unreadable' AND COALESCE(v, 1) >= {OUTCOME_VERSION}), 0)"
)
STATE_SQL = f"""
CREATE TABLE state AS
WITH agg AS (
  SELECT k, COUNT(*) AS tries, MAX(id) AS last_id,
         MAX(CASE WHEN o = 'saved' THEN id END) AS final_id,
         SUM(ref) AS vcount,
         MIN(CASE WHEN ref THEN t END) AS vmin,
         MAX(CASE WHEN ref THEN t END) AS vmax
  FROM (SELECT id, k, o, t, {REFUSAL_SQL} AS ref FROM results)
  GROUP BY k)
SELECT agg.k, tries, final_id, vcount, vmin, vmax, l.o AS last_o, l.t AS last_t,
       CASE WHEN final_id IS NOT NULL THEN 'saved'
            WHEN vcount >= {CONFIRM_ATTEMPTS}
                 AND vmax - vmin >= {CONFIRM_GAP_SECONDS} THEN 'unavailable'
       END AS verdict
FROM agg JOIN results l ON l.id = agg.last_id
"""
DUE_SQL = (
    "CASE WHEN s.last_o = 'oversize' THEN :lane WHEN :lane THEN 0"
    " WHEN s.vcount = 0 THEN"
    f" :now >= s.last_t + MIN({6 * 3600}, 120 * (1 << MIN(s.tries, 8)))"
    f" ELSE :now >= s.vmax + {CONFIRM_GAP_SECONDS} END"
)
QUEUE_COLUMNS = ("k", "s", "e", "f", "m", "n")
NEVER_CHECKED_SQL = """
SELECT w.id, w.k, w.s, w.e, w.f, w.m, w.n FROM work w
WHERE w.id > :after AND w.held IS NULL
  AND NOT EXISTS (SELECT 1 FROM state s WHERE s.k = w.k)
ORDER BY w.id LIMIT :limit
"""
DUE_RETRY_SQL = f"""
SELECT w.id, w.k, w.s, w.e, w.f, w.m, w.n FROM work w JOIN state s ON s.k = w.k
WHERE w.id > :after AND w.held IS NULL AND s.verdict IS NULL AND ({DUE_SQL})
ORDER BY w.id LIMIT :limit
"""
STATUS_SQL = """
SELECT CASE
  WHEN w.held IS NOT NULL THEN 'held_' || w.held
  WHEN s.k IS NULL THEN 'not_checked'
  WHEN s.verdict = 'saved' THEN 'saved'
  WHEN s.verdict = 'unavailable' THEN 'confirmed_' || s.last_o
  WHEN s.last_o = 'oversize' THEN 'oversize_waiting'
  WHEN s.vcount = 0 THEN 'retry_waiting'
  ELSE 'awaiting_confirmation_' || s.last_o END AS bucket, COUNT(*)
FROM work w LEFT JOIN state s ON s.k = w.k GROUP BY bucket
"""
# Distinct saved PDFs; each digest's size comes from its first filing in work order.
SAVED_SQL = """
SELECT COUNT(*), COALESCE(SUM(b), 0) FROM (
  SELECT f.sha, f.b, MIN(w.id) FROM work w JOIN state s ON s.k = w.k
  JOIN results f ON f.id = s.final_id WHERE w.held IS NULL GROUP BY f.sha)
"""
EXPORT_SQL = """
SELECT w.k, w.held, w.mn, s.k IS NOT NULL, s.verdict, f.sha, f.b, f.p, f.t, f.mg,
       s.last_o, s.vmax
FROM work w LEFT JOIN state s ON s.k = w.k LEFT JOIN results f ON f.id = s.final_id
ORDER BY w.id
"""


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1 << 20):
            digest.update(block)
    return digest.hexdigest()


def manifest_parts(manifest) -> list[dict]:
    """The work list's parts in order. A manifest without a parts list describes
    1 part, ``worklist.jsonl.gz``, with its top-level digest."""
    if manifest.get("parts"):
        return manifest["parts"]
    return [
        {
            "key": "worklist.jsonl.gz",
            "sha256": manifest["sha256"],
            "bytes": manifest["bytes"],
            "rows": manifest["rows"],
        }
    ]


def default_scratch() -> Path:
    return Path(
        os.environ.get("FCC_CENSUS_SCRATCH")
        or Path(tempfile.gettempdir()) / "fcc-census"
    )


class Census:
    """A run's work list and outcomes in an on-disk SQLite scratch database.

    Rows stream from gzip into SQLite in batches and every selection is a query.
    Downloaded work-list parts and outcome files are cached by name in the scratch
    directory, so a later command in the same job reads only what is new.
    """

    def __init__(self, store, run_id: str, scratch: Path):
        self.store = store
        self.run_id = run_id
        self.prefix = run_prefix(run_id)
        self.root = Path(scratch) / run_id
        for sub in ("parts", "results"):
            (self.root / sub).mkdir(parents=True, exist_ok=True)
        self.path = self.root / "census.sqlite"
        self.db = self._open()

    # -------------------------------------------------------- database

    def _open(self):
        if self.path.exists():
            try:
                with closing(sqlite3.connect(self.path)) as db:
                    meta = dict(db.execute("SELECT key, value FROM meta"))
            except sqlite3.DatabaseError:
                meta = {}
            # An interrupted change or an older layout is rebuilt from the cache.
            if meta.get("schema") != str(SCHEMA_VERSION) or "dirty" in meta:
                self.path.unlink()
        fresh = not self.path.exists()
        db = sqlite3.connect(self.path, isolation_level=None)
        db.execute("PRAGMA journal_mode=OFF")
        db.execute("PRAGMA synchronous=OFF")
        db.execute("PRAGMA cache_size=-262144")
        if fresh:
            db.executescript(SCHEMA_SQL)
            db.execute("INSERT INTO meta VALUES ('schema', ?)", (str(SCHEMA_VERSION),))
        return db

    def close(self):
        self.db.close()

    def reset(self):
        self.db.close()
        self.path.unlink(missing_ok=True)
        self.db = self._open()

    def meta(self, key: str, default=None):
        row = self.db.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row[0] if row else default

    def set_meta(self, key: str, value: str):
        self.db.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (key, value))

    @contextmanager
    def changing(self):
        """Marks the database unfinished until the change completes."""
        self.set_meta("dirty", "1")
        self.db.execute("BEGIN")
        yield
        self.db.execute("COMMIT")
        self.db.execute("DELETE FROM meta WHERE key = 'dirty'")

    def _insert_lines(self, sql: str, path: Path, *extra) -> int:
        count = 0
        batch = []
        with gzip.open(path, "rb") as stream:
            for line in stream:
                if not line.strip():
                    continue
                batch.append((line.decode(), *extra))
                count += 1
                if len(batch) >= INSERT_BATCH:
                    self.db.executemany(sql, batch)
                    batch.clear()
        if batch:
            self.db.executemany(sql, batch)
        return count

    def _has_table(self, name: str) -> bool:
        return bool(
            self.db.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
            ).fetchone()
        )

    # -------------------------------------------------------- objects

    def fetch(self, key: str, path: Path, sha256: str) -> Path:
        """A local copy of an object whose bytes match the digest its manifest names."""
        if path.exists() and file_sha256(path) == sha256:
            return path
        partial = path.with_name(path.name + ".part")
        self.store.download(key, partial)
        if file_sha256(partial) != sha256:
            partial.unlink()
            raise ValueError(f"{key} does not match the digest its manifest names")
        partial.replace(path)
        return path

    def _result_path(self, name: str) -> Path:
        return self.root / "results" / name.replace("/", "__")

    def remember(self, name: str, body: bytes):
        """Caches an outcome file this job wrote or read, by its object name."""
        path = self._result_path(name)
        partial = path.with_name(path.name + ".part")
        partial.write_bytes(body)
        partial.replace(path)

    def manifest(self) -> dict:
        return json.loads(self.store.get(f"{self.prefix}/manifest.json"))

    # -------------------------------------------------------- loading

    def load(self, manifest: dict):
        self.load_work(manifest)
        self.load_results()

    def load_work(self, manifest: dict):
        parts = manifest_parts(manifest)
        digests = [part["sha256"] for part in parts]
        loaded = json.loads(self.meta("parts", "[]"))
        if digests[: len(loaded)] != loaded:
            self.reset()
            loaded = []
        if len(loaded) == len(digests):
            return
        paths = [
            self.fetch(
                f"{self.prefix}/{part['key']}",
                self.root / "parts" / f"{part['sha256']}.jsonl.gz",
                part["sha256"],
            )
            for part in parts[len(loaded) :]
        ]
        with self.changing():
            self.db.execute("DROP INDEX IF EXISTS work_k")
            for number, path in enumerate(paths, start=len(loaded) + 1):
                self._insert_lines(WORK_INSERT, path, number)
            self.db.execute("CREATE INDEX work_k ON work(k)")
            self.db.execute(APPLY_UPDATES)
            self.db.execute("DELETE FROM work WHERE upd IS NOT NULL")
            self.set_meta("parts", json.dumps(digests))

    def load_results(self):
        base = f"{self.prefix}/results/"
        names = sorted(key[len(base) :] for key in self.store.keys(base))
        loaded = [name for (name,) in self.db.execute("SELECT name FROM loaded")]
        loaded.sort()
        known = set(loaded)
        fresh = [name for name in names if name not in known]
        if loaded and (not known <= set(names) or (fresh and fresh[0] < loaded[-1])):
            # A new file that sorts among those already read changes the order of
            # outcomes, so every file is read again from the cache.
            with self.changing():
                self.db.execute("DELETE FROM results")
                self.db.execute("DELETE FROM loaded")
                self.db.execute("DROP TABLE IF EXISTS state")
            fresh = names
        missing = [name for name in fresh if not self._result_path(name).exists()]

        def download(name):
            self.remember(name, self.store.get(base + name))

        with ThreadPoolExecutor(16) as pool:
            list(pool.map(download, missing))
        if not fresh and self._has_table("state"):
            return
        with self.changing():
            for name in fresh:
                self._insert_lines(RESULT_INSERT, self._result_path(name))
                self.db.execute("INSERT INTO loaded VALUES (?)", (name,))
            self.db.execute("DROP TABLE IF EXISTS state")
            self.db.execute(STATE_SQL)
            self.db.execute("CREATE UNIQUE INDEX state_k ON state(k)")

    # -------------------------------------------------------- questions

    def to_check(self) -> int:
        return self.db.execute(
            "SELECT COUNT(*) FROM work WHERE held IS NULL"
        ).fetchone()[0]

    def settled_count(self) -> int:
        return self.db.execute(
            "SELECT COUNT(*) FROM state WHERE verdict IS NOT NULL"
        ).fetchone()[0]

    def queue_size(self, now: float, oversize_lane: bool = False) -> int:
        params = {"now": now, "lane": int(oversize_lane), "after": 0, "limit": -1}
        total = 0
        for sql in self._queue_sql(oversize_lane):
            total += self.db.execute(
                f"SELECT COUNT(*) FROM ({sql})", params
            ).fetchone()[0]
        return total

    @staticmethod
    def _queue_sql(oversize_lane: bool):
        return [DUE_RETRY_SQL] if oversize_lane else [NEVER_CHECKED_SQL, DUE_RETRY_SQL]

    def queue(self, now: float, oversize_lane: bool = False, batch=QUEUE_BATCH):
        """Never-checked filings in work-list order (oldest part first), then due
        retries in the same order, selected batch by batch."""
        for sql in self._queue_sql(oversize_lane):
            after = 0
            while True:
                rows = self.db.execute(
                    sql,
                    {
                        "now": now,
                        "lane": int(oversize_lane),
                        "after": after,
                        "limit": batch,
                    },
                ).fetchall()
                if not rows:
                    break
                for row in rows:
                    yield dict(zip(QUEUE_COLUMNS, row[1:]))
                after = rows[-1][0]

    def status(self) -> dict:
        tally = dict(self.db.execute(STATUS_SQL).fetchall())
        distinct, size = self.db.execute(SAVED_SQL).fetchone()
        return {
            "work_rows": self.db.execute("SELECT COUNT(*) FROM work").fetchone()[0],
            "filings": dict(sorted(tally.items())),
            "distinct_saved_pdfs": distinct,
            "distinct_saved_bytes": size,
        }

    def export_rows(self):
        for (
            k,
            held,
            mn,
            checked,
            verdict,
            sha,
            b,
            p,
            t,
            mg,
            last_o,
            vmax,
        ) in self.db.execute(EXPORT_SQL):
            record = {"k": k}
            if held is not None:
                record["held"] = held
                if mn is not None:
                    record["mn"] = mn
            elif not checked:
                record["state"] = "not_checked"
            else:
                record["state"] = verdict or "pending"
                if verdict == "saved":
                    record |= {"sha": sha, "b": b, "p": p, "t": t}
                    if mg is not None:
                        record["mg"] = mg
                elif verdict == "unavailable":
                    record["why"] = last_o
                    record["t"] = vmax
            yield record

    # -------------------------------------------------------- inventory

    def sync_inventory(self) -> dict:
        """Appends 1 work-list part with every inventory filing no part holds yet,
        plus newer download ids for listed filings still to be checked."""
        pointer = self.store.get_optional(INVENTORY_POINTER)
        if pointer is None:
            return {"sync": "skipped", "reason": "no inventory pointer yet"}
        pointer = json.loads(pointer)
        inventory = json.loads(self.store.get(pointer["manifest_key"]))
        if inventory["inventory_id"] != pointer["inventory_id"]:
            raise ValueError("The inventory pointer and its manifest disagree")
        manifest = self.manifest()
        if manifest.get("synced_inventory") == inventory["inventory_id"]:
            return {"sync": "current", "inventory_id": inventory["inventory_id"]}
        cache = self.root.parent / "inventory"
        cache.mkdir(exist_ok=True)
        data = self.fetch(
            inventory["object_key"],
            cache / f"{inventory['sha256']}.jsonl.gz",
            inventory["sha256"],
        )
        self.load_work(manifest)
        parts = manifest_parts(manifest)
        number = len(parts) + 1
        scratch = self.root / "inventory.sqlite"
        scratch.unlink(missing_ok=True)
        self.db.execute("ATTACH ? AS inv", (str(scratch),))
        try:
            self.db.execute("PRAGMA inv.journal_mode=OFF")
            self.db.execute("PRAGMA inv.synchronous=OFF")
            self.db.execute(
                "CREATE TABLE inv.filings (k TEXT PRIMARY KEY, s, e, f, m TEXT, n)"
            )
            self.db.execute("CREATE TABLE inv.ord (pos INTEGER PRIMARY KEY, rid)")
            self.db.execute("BEGIN")
            lines = self._insert_lines(INVENTORY_INSERT, data, UUID_GLOB)
            if lines != inventory["rows"]:
                raise ValueError(
                    f"The inventory holds {lines} rows; its manifest says {inventory['rows']}"
                )
            # Filings no part holds, in key order, then the fixed shuffle.
            fresh = array(
                "q",
                (
                    rid
                    for (rid,) in self.db.execute(
                        "SELECT i.rowid FROM inv.filings i WHERE NOT EXISTS"
                        " (SELECT 1 FROM main.work w WHERE w.k = i.k) ORDER BY i.k"
                    )
                ),
            )
            random.Random(f"{self.run_id}-{number}").shuffle(fresh)
            for start in range(0, len(fresh), INSERT_BATCH):
                self.db.executemany(
                    "INSERT INTO inv.ord VALUES (?, ?)",
                    enumerate(fresh[start : start + INSERT_BATCH], start=start),
                )
            del fresh
            self.db.execute("COMMIT")
            counts = Counter()
            path = self.root / "parts" / f"new-{number}.jsonl.gz"
            with gzip.GzipFile(path, "wb", compresslevel=6, mtime=0) as out:
                for row in self.db.execute(
                    "SELECT i.k, i.s, i.e, i.f, i.m, i.n FROM inv.ord o"
                    " JOIN inv.filings i ON i.rowid = o.rid ORDER BY o.pos"
                ):
                    out.write(_line(dict(zip(QUEUE_COLUMNS, row))))
                    counts["new"] += 1
                # Newer download ids for listed filings that are still checked.
                for k, m in self.db.execute(
                    "SELECT i.k, i.m FROM inv.filings i JOIN main.work w ON w.k = i.k"
                    " WHERE w.held IS NULL AND i.m != '' AND i.m != COALESCE(w.m, '')"
                    " GROUP BY i.k ORDER BY i.k"
                ):
                    out.write(_line({"k": k, "m": m, "update": 1}))
                    counts["updates"] += 1
        finally:
            if self.db.in_transaction:
                self.db.execute("COMMIT")
            self.db.execute("DETACH inv")
            scratch.unlink(missing_ok=True)
        summary = {
            "inventory_id": inventory["inventory_id"],
            "part": number,
            "new": counts["new"],
            "updates": counts["updates"],
        }
        if counts:
            sha = file_sha256(path)
            key = f"worklist-{number}.jsonl.gz"
            path = path.replace(self.root / "parts" / f"{sha}.jsonl.gz")
            self.store.put_file(f"{self.prefix}/{key}", path, "application/gzip")
            manifest["parts"] = [
                *parts,
                {
                    "key": key,
                    "sha256": sha,
                    "bytes": path.stat().st_size,
                    "rows": counts["new"],
                    "updates": counts["updates"],
                    "inventory_id": inventory["inventory_id"],
                    "through": inventory.get("through"),
                    "synced_at": int(time.time()),
                },
            ]
        else:
            path.unlink(missing_ok=True)
            summary["part"] = None
        manifest["synced_inventory"] = inventory["inventory_id"]
        self.store.put_small(
            f"{self.prefix}/manifest.json",
            json.dumps(manifest).encode(),
            "application/json",
        )
        for old in cache.iterdir():
            if old != data:
                old.unlink()
        return {"sync": "appended" if counts else "nothing new"} | summary


def _line(row) -> bytes:
    return json.dumps(row, separators=(",", ":")).encode() + b"\n"


# ---------------------------------------------------------------- commands


def open_census(args) -> Census:
    return Census(Store(), args.run_id, args.scratch)


def cmd_worklist(args):
    store = Store()
    prefix = run_prefix(args.run_id)
    rows = list(build_worklist(args.inventory, args.prior_catalog, args.minnesota))
    # A fixed shuffle spreads every service and year across each run's progress.
    random.Random(args.run_id).shuffle(rows)
    if args.sample:
        rows = [r for r in rows if "held" not in r][: args.sample]
    body = gz_lines(rows)
    key = f"{prefix}/worklist.jsonl.gz"
    store.put_small(key, body, "application/gzip")
    manifest = {
        "run_id": args.run_id,
        "rows": len(rows),
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "held": dict(Counter(r.get("held", "check") for r in rows)),
    }
    manifest["parts"] = manifest_parts(manifest)
    store.put_small(
        f"{prefix}/manifest.json", json.dumps(manifest).encode(), "application/json"
    )
    print(json.dumps(manifest))


def cmd_sync(args):
    census = open_census(args)
    print(json.dumps(census.sync_inventory()), flush=True)


def cmd_run(args):
    import httpx

    census = open_census(args)
    store = census.store
    prefix = census.prefix
    census.load(census.manifest())
    now = time.time()
    queued = census.queue_size(now, args.oversize)
    rows = census.queue(now, args.oversize)
    started = time.monotonic()
    deadline = started + args.max_seconds
    pace = Pace(args.rate_start, args.rate_max)
    limit = OVERSIZE_MAX_BYTES if args.oversize else MAX_FILE_BYTES
    outcomes = Counter()
    pending = []
    flushed_at = time.monotonic()
    sequence = 0
    run_tag = f"{int(time.time())}-{os.getpid()}"
    lock = threading.Lock()

    def flush(final=False):
        nonlocal pending, flushed_at, sequence
        with lock:
            batch, pending = pending, []
            flushed_at = time.monotonic()
        if not batch:
            return
        sequence += 1
        name = f"{run_tag}-{sequence:05d}.jsonl.gz"
        body = gz_lines(batch)
        for attempt in range(5):
            try:
                store.put_small(f"{prefix}/results/{name}", body, "application/gzip")
                break
            except Exception:  # noqa: BLE001
                if attempt == 4:
                    raise
                time.sleep(10 * (attempt + 1))
        census.remember(name, body)
        print(
            json.dumps(
                {
                    "flushed": len(batch),
                    "outcomes": dict(outcomes),
                    "rate": round(pace.rate, 2),
                    "elapsed": int(time.monotonic() - started),
                }
            ),
            flush=True,
        )

    print(
        json.dumps(
            {
                "queue": queued,
                "settled": census.settled_count(),
                "work": census.to_check(),
            }
        ),
        flush=True,
    )
    with (
        tempfile.TemporaryDirectory() as spool_dir,
        httpx.Client(
            timeout=httpx.Timeout(60, connect=10),
            follow_redirects=False,
            headers={"User-Agent": USER_AGENT},
            limits=httpx.Limits(
                max_connections=args.workers, max_keepalive_connections=args.workers
            ),
        ) as http,
        ThreadPoolExecutor(args.workers) as pool,
    ):
        spool = Path(spool_dir)
        running = set()
        stop = False
        while True:
            while not stop and len(running) < args.workers * 2:
                if time.monotonic() >= deadline:
                    stop = True
                    break
                row = next(rows, None)
                if row is None:
                    stop = True
                    break
                running.add(pool.submit(check, row, http, pace, store, spool, limit))
            if not running:
                break
            done, running = wait(running, timeout=30, return_when=FIRST_COMPLETED)
            for future in done:
                result = future.result()
                outcomes[result["o"]] += 1
                with lock:
                    pending.append(result)
            if (
                len(pending) >= FLUSH_ROWS
                or time.monotonic() - flushed_at >= FLUSH_SECONDS
            ):
                flush()
        flush(final=True)
    print(
        json.dumps(
            {
                "finished": dict(outcomes),
                "remaining_queue_estimate": max(0, queued - sum(outcomes.values())),
            }
        ),
        flush=True,
    )


def cmd_status(args):
    census = open_census(args)
    manifest = census.manifest()
    census.load(manifest)
    print(
        json.dumps(
            {"run": manifest["run_id"]} | census.status() | {"as_of": int(time.time())},
            indent=2,
        )
    )


def cmd_export(args):
    """Settled outcomes for every filing, for building the Finance index."""
    census = open_census(args)
    census.load(census.manifest())
    with gzip.open(args.out, "wb") as out:
        for record in census.export_rows():
            out.write(_line(record))


def cli():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--run-id", default="census-20261119")
    parser.add_argument(
        "--scratch",
        type=Path,
        default=default_scratch(),
        help="Local scratch directory for the run's SQLite state and cached files",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser(
        "worklist", help="Store the work list built from the held inventory"
    )
    p.add_argument("--inventory", type=Path, required=True)
    p.add_argument("--prior-catalog", type=Path, required=True)
    p.add_argument("--minnesota", type=Path, required=True)
    p.add_argument(
        "--sample", type=int, help="Store only this many unchecked rows (pilot)"
    )
    p = sub.add_parser(
        "sync", help="Append inventory filings that no work-list part holds yet"
    )
    p.add_argument(
        "--inventory-current",
        action="store_true",
        required=True,
        help="Read the current compact inventory; skip quietly when none exists",
    )
    p = sub.add_parser("run", help="Check filings until the time limit")
    p.add_argument("--max-seconds", type=int, default=5 * 3600)
    p.add_argument("--workers", type=int, default=16)
    p.add_argument("--rate-start", type=float, default=4.0)
    p.add_argument("--rate-max", type=float, default=8.0)
    p.add_argument(
        "--oversize",
        action="store_true",
        help="Only the files too large for the main run, up to 8 GiB each",
    )
    sub.add_parser("status", help="Summarize settled and outstanding filings")
    p = sub.add_parser("export", help="Write each filing's settled outcome")
    p.add_argument("--out", type=Path, required=True)
    return parser


def main():
    args = cli().parse_args()
    if getattr(args, "rate_max", 1) > 8 or getattr(args, "workers", 1) > 32:
        raise SystemExit("Keep FCC requests at or below 8 per second and 32 workers")
    {
        "worklist": cmd_worklist,
        "sync": cmd_sync,
        "run": cmd_run,
        "status": cmd_status,
        "export": cmd_export,
    }[args.command](args)


if __name__ == "__main__":
    main()
