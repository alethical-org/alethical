#!/usr/bin/env python3
"""Keep one compact inventory of every national FCC political filing's latest state.

The FCC's public-file history answers one whole day per request (``offset=0`` and no
``count``). ``fetch`` stores each day's raw answer in private R2 and records the day in a
ledger only after a valid answer: HTTP 200, ``statusCode`` 200 and a ``history`` list.
An error, a busy answer or a truncated body never counts as an empty day. ``compact``
folds every stored day, plus the optional transfer archive as a reconciliation source,
into 1 row per filing and publishes it behind ``inventory/current.json`` only after the
data and manifest read back intact.

Run from the repository root as ``python -m scripts.national_fcc_history``. The global
``--local-store DIR`` option uses a local folder in place of R2, for dry measurements.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import re
import shutil
import sqlite3
import sys
import tempfile
import time
import zipfile
import zlib
from collections import Counter
from contextlib import closing
from datetime import UTC, date, datetime, timedelta
from pathlib import Path, PurePosixPath
from zoneinfo import ZoneInfo

from scripts.national_fcc_collect import USER_AGENT, retry_after
from scripts.national_fcc_collect import Store as CollectStore

PREFIX = "fcc-national/v1"
HISTORY = f"{PREFIX}/history"
LEDGER = f"{HISTORY}/days.json"
TRANSFER_MANIFEST = f"{HISTORY}/transfer/manifest.json"
INVENTORY = f"{PREFIX}/inventory"
CURRENT = f"{INVENTORY}/current.json"
DAILY_URL = (
    "https://publicfiles.fcc.gov/api/manager/file/history.json"
    "?startDate={day}&endDate={day}&offset=0"
)
FIRST_DAY = date(2012, 1, 1)
# The most recent days are fetched again on every run, because the FCC edits late.
RECHECK_DAYS = 3
# FCC history days follow Eastern time; a day is fetched only once it has ended there.
FCC_ZONE = ZoneInfo("America/New_York")
POLITICAL = "Political Files"
TRANSFER_PAGE = re.compile(
    r"^national-fcc/raw-file-history/(\d{4}-\d{2}-\d{2})/[^/]+\.json\.gz$"
)
YEAR = re.compile(r"^Political Files/(\d{4})(?:/|$)")
ZERO_TIME = "0000-00-00T00:00:00Z"
ATTEMPTS = 6
BATCH = 50_000
LEDGER_FLUSH_SECONDS = 60
# Source bits recorded per filing, so status can show filings only the transfer holds.
FROM_DAILY = 1
FROM_TRANSFER = 2
FIELDS = (
    ("n", "file_name"),
    ("x", "file_extension"),
    ("p", "file_folder_path"),
    ("c", "create_ts"),
    ("u", "last_update_ts"),
    ("h", "history_status"),
    ("cs", "callsign"),
    ("ci", "city"),
    ("st", "state"),
    ("li", "licensee"),
    ("lg", "legalname"),
)


def dumps(value) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def gzip_writer(path: Path):
    # An empty file name and a zero time keep identical content byte-identical.
    return gzip.GzipFile(
        filename="", fileobj=path.open("wb"), mode="wb", mtime=0, compresslevel=6
    )


def file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1 << 20):
            digest.update(block)
    return digest.hexdigest()


def is_political(raw: dict) -> bool:
    return str(raw.get("file_folder_path") or "").startswith(POLITICAL)


def record_key(raw: dict) -> str | None:
    parts = [
        str(raw.get(name) or "")
        for name in ("source_service_code", "entity_id", "file_id")
    ]
    return "|".join(parts) if all(parts) else None


def looks_capped(rows: int) -> bool:
    """A large round count may be a server cap rather than the whole day."""
    return rows >= 10_000 and rows % 1_000 == 0


def last_finished_day(now: datetime) -> date:
    return now.astimezone(FCC_ZONE).date() - timedelta(days=1)


def day_range(first: date, last: date):
    day = first
    while day <= last:
        yield day
        day += timedelta(days=1)


# ---------------------------------------------------------------- storage


class R2Store(CollectStore):
    """The existing private R2 bucket, with content-addressed writes for any file."""

    def get_optional(self, key: str) -> bytes | None:
        from botocore.exceptions import ClientError

        try:
            return self.get(key)
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                return None
            raise

    def put_once(self, key: str, source: Path | bytes, content_type: str) -> str:
        """Write absent content once; R2 checks the SHA-256 before accepting it."""
        from botocore.exceptions import ClientError

        sha = (
            file_sha(source)
            if isinstance(source, Path)
            else hashlib.sha256(source).hexdigest()
        )
        checksum = base64.b64encode(bytes.fromhex(sha)).decode()
        body = source.open("rb") if isinstance(source, Path) else source
        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=body,
                IfNoneMatch="*",
                ContentType=content_type,
                ChecksumSHA256=checksum,
            )
            return sha
        except ClientError as error:
            if error.response["ResponseMetadata"]["HTTPStatusCode"] != 412:
                raise
        finally:
            if isinstance(source, Path):
                body.close()
        head = self.client.head_object(
            Bucket=self.bucket, Key=key, ChecksumMode="ENABLED"
        )
        if head.get("ChecksumSHA256") != checksum:
            with tempfile.TemporaryDirectory() as spool:
                if self.download(key, Path(spool) / "stored") != sha:
                    raise ValueError(f"A different object already holds {key}")
        return sha

    def download(self, key: str, target: Path) -> str:
        digest = hashlib.sha256()
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        with closing(response["Body"]) as body, target.open("wb") as out:
            while block := body.read(1 << 20):
                digest.update(block)
                out.write(block)
        return digest.hexdigest()


class LocalStore:
    """A folder laid out like the R2 keys: for dry measurements and tests."""

    def __init__(self, root: Path):
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        return self.root / key

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def get_optional(self, key: str) -> bytes | None:
        path = self._path(key)
        return path.read_bytes() if path.exists() else None

    def put_small(self, key: str, body: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_name(path.name + ".partial")
        partial.write_bytes(body)
        partial.replace(path)

    def put_once(self, key: str, source: Path | bytes, content_type: str) -> str:
        path = self._path(key)
        if isinstance(source, Path):
            sha = file_sha(source)
        else:
            sha = hashlib.sha256(source).hexdigest()
        if path.exists():
            if file_sha(path) != sha:
                raise ValueError(f"A different object already holds {key}")
            return sha
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_name(path.name + ".partial")
        if isinstance(source, Path):
            shutil.copyfile(source, partial)
        else:
            partial.write_bytes(source)
        partial.replace(path)
        return sha

    def download(self, key: str, target: Path) -> str:
        shutil.copyfile(self._path(key), target)
        return file_sha(target)


def open_store(local: Path | None):
    return LocalStore(local) if local else R2Store()


def load_json(store, key: str):
    body = store.get_optional(key)
    return json.loads(body) if body is not None else None


def load_ledger(store) -> dict:
    ledger = load_json(store, LEDGER) or {"format": 1, "days": {}}
    return ledger


def save_ledger(store, ledger: dict) -> None:
    ledger["days"] = dict(sorted(ledger["days"].items()))
    store.put_small(LEDGER, dumps(ledger).encode(), "application/json")


def contiguous_through(days: dict) -> str | None:
    """The last day before which every day since 2012-01-01 is complete."""
    through = None
    for day in day_range(FIRST_DAY, date.max - timedelta(days=1)):
        if days.get(day.isoformat(), {}).get("status") != "complete":
            return through
        through = day.isoformat()
    return through


# ---------------------------------------------------------------- fetch


class DayFailed(Exception):
    pass


class Pace:
    """At most 1 request per ``interval`` seconds."""

    def __init__(self, interval: float, sleep, clock):
        self.interval = interval
        self.sleep = sleep
        self.clock = clock
        self.next_at = 0.0

    def wait(self):
        now = self.clock()
        if now < self.next_at:
            self.sleep(self.next_at - now)
            now = self.next_at
        self.next_at = now + self.interval


def parse_day(body: bytes) -> dict | None:
    """The payload of a complete answer, or None for anything else."""
    try:
        payload = json.loads(body)
    except ValueError:
        return None
    if not isinstance(payload, dict) or payload.get("statusCode") != 200:
        return None
    history = payload.get("history")
    if not isinstance(history, list) or not all(isinstance(r, dict) for r in history):
        return None
    return payload


def backoff(attempt: int) -> float:
    return min(300.0, 5.0 * 2**attempt)


def fetch_day(
    http, day: str, pace: Pace, sleep, end: str | None = None
) -> tuple[bytes, dict]:
    import httpx

    url = DAILY_URL.format(day=day)
    if end is not None:
        url = url.replace(f"endDate={day}", f"endDate={end}")
    reason = "no answer"
    for attempt in range(ATTEMPTS):
        pace.wait()
        wait = backoff(attempt)
        try:
            response = http.get(url)
        except httpx.TransportError as error:  # timeouts included
            reason = type(error).__name__
        else:
            code = response.status_code
            if code == 200:
                body = response.content
                payload = parse_day(body)
                if payload is not None:
                    return body, payload
                reason = "incomplete answer"
            elif code in (408, 429) or code >= 500:
                reason = f"HTTP {code}"
                if response.headers.get("Retry-After"):
                    wait = retry_after(response.headers["Retry-After"])
            else:
                raise DayFailed(f"HTTP {code}")
        if attempt + 1 < ATTEMPTS:
            sleep(wait)
    raise DayFailed(reason)


def summarize(payload: dict) -> dict:
    political = [r for r in payload["history"] if is_political(r)]
    filings = {key for r in political if (key := record_key(r))}
    return {
        "rows": len(payload["history"]),
        "political": len(political),
        "filings": len(filings),
    }


def store_day(store, day: str, body: bytes, payload: dict, known: dict | None) -> dict:
    stored = gzip.compress(body, compresslevel=6, mtime=0)
    sha = hashlib.sha256(stored).hexdigest()
    key = f"{HISTORY}/daily/{day}/{sha}.json.gz"
    if not known or known.get("key") != key:
        store.put_once(key, stored, "application/gzip")
    counts = summarize(payload)
    return {
        "status": "unverified" if looks_capped(counts["rows"]) else "complete",
        "key": key,
        "sha256": sha,
        "bytes": len(body),
        "stored_bytes": len(stored),
        **counts,
    }


def confirm_round_day(client, day: str, record: dict, pace: Pace, sleep) -> str | None:
    """A round count is the whole day when the 2-day window holds exactly 1 more day.

    The FCC answers a 2-day window with both days' events. When that answer is
    larger than the round count and equals it plus the next day's own count, the
    round count was not a cap.
    """
    following = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
    try:
        _, next_payload = fetch_day(client, following, pace, sleep)
        _, pair = fetch_day(client, day, pace, sleep, end=following)
    except DayFailed:
        return None
    next_rows = len(next_payload["history"])
    pair_rows = len(pair["history"])
    if next_rows > 0 and pair_rows == record["rows"] + next_rows:
        return f"{day}..{following}: {pair_rows} = {record['rows']} + {next_rows}"
    return None


def due_days(ledger_days: dict, first: date, last: date, newest: date, force: bool):
    """Recent days first, newest first; then every other incomplete day, oldest first."""
    recent_from = newest - timedelta(days=RECHECK_DAYS - 1)
    recent, older = [], []
    for day in day_range(first, last):
        if day >= recent_from:
            recent.append(day)
        elif force or ledger_days.get(day.isoformat(), {}).get("status") != "complete":
            older.append(day)
    return sorted(recent, reverse=True) + older


def cmd_fetch(args, store, http=None, sleep=time.sleep, clock=time.monotonic, now=None):
    import httpx

    now = now or datetime.now(UTC)
    newest = last_finished_day(now)
    first = FIRST_DAY if args.backfill else args.from_day
    last = args.to_day or newest
    if first is None:
        raise SystemExit("Give --from or --backfill")
    if last > newest:
        raise SystemExit(
            f"{last} has not ended in Eastern time; the latest is {newest}"
        )
    ledger = load_ledger(store)
    days = due_days(ledger["days"], first, last, newest, args.force)
    started = clock()
    flushed = clock()
    pace = Pace(1.0, sleep, clock)
    tally = Counter()
    failures = {}
    client = http or httpx.Client(
        timeout=httpx.Timeout(180, connect=15), headers={"User-Agent": USER_AGENT}
    )
    try:
        for index, day in enumerate(days):
            if args.max_seconds and clock() - started >= args.max_seconds:
                tally["left_for_next_run"] = len(days) - index
                break
            name = day.isoformat()
            began = clock()
            try:
                body, payload = fetch_day(client, name, pace, sleep)
            except DayFailed as error:
                failures[name] = str(error)
                tally["failed"] += 1
                continue
            known = ledger["days"].get(name)
            record = store_day(store, name, body, payload, known)
            if record["status"] == "unverified":
                confirmed = confirm_round_day(client, name, record, pace, sleep)
                if confirmed:
                    record["status"] = "complete"
                    record["confirmed_by"] = confirmed
            record["seconds"] = round(clock() - began, 2)
            record["fetched_at"] = now.isoformat(timespec="seconds")
            changed = not known or known.get("key") != record["key"]
            tally["changed" if changed else "unchanged"] += 1
            tally[record["status"]] += 1
            ledger["days"][name] = record
            print(dumps({"day": name, **record}), flush=True)
            if clock() - flushed >= LEDGER_FLUSH_SECONDS:
                save_ledger(store, ledger)
                flushed = clock()
    finally:
        save_ledger(store, ledger)
        if http is None:
            client.close()
    summary = {
        "due": len(days),
        **tally,
        "failures": failures,
        "through": contiguous_through(ledger["days"]),
    }
    print(dumps(summary), flush=True)
    return 1 if failures else 0


# ---------------------------------------------------------------- transfer


def transfer_pages(names):
    pages = []
    for name in names:
        match = TRANSFER_PAGE.match(name)
        if match and not PurePosixPath(name).name.startswith("._"):
            pages.append((match[1], name))
    return sorted(pages)


def cmd_transfer(args, store, now=None):
    """Store the archive's political history events as 1 reconciliation part."""
    now = now or datetime.now(UTC)
    windows = {}
    with (
        zipfile.ZipFile(args.zip) as archive,
        tempfile.TemporaryDirectory(dir=args.work_dir) as work,
    ):
        pages = transfer_pages(archive.namelist())
        if not pages:
            raise SystemExit("The archive holds no raw-file-history pages")
        part = Path(work) / "transfer.jsonl.gz"
        with gzip_writer(part) as out:
            for window, name in pages:
                with archive.open(name) as member, gzip.open(member) as page:
                    payload = json.load(page)
                history = payload.get("history") if isinstance(payload, dict) else None
                if not isinstance(history, list):
                    raise ValueError(f"Not a history page: {name}")
                counts = windows.setdefault(window, {"rows": 0, "political": 0})
                counts["rows"] += len(history)
                for raw in history:
                    if is_political(raw):
                        counts["political"] += 1
                        event = {k: v for k, v in raw.items() if v is not None}
                        out.write((dumps({"w": window, "e": event}) + "\n").encode())
        sha = file_sha(part)
        key = f"{HISTORY}/transfer/{sha}.jsonl.gz"
        store.put_once(key, part, "application/gzip")
        manifest = {
            "format": 1,
            "key": key,
            "sha256": sha,
            "bytes": part.stat().st_size,
            "pages": len(pages),
            "rows": sum(w["rows"] for w in windows.values()),
            "political": sum(w["political"] for w in windows.values()),
            "windows": windows,
            "source": Path(args.zip).name,
            "built_at": now.isoformat(timespec="seconds"),
        }
    store.put_small(TRANSFER_MANIFEST, dumps(manifest).encode(), "application/json")
    print(dumps({k: v for k, v in manifest.items() if k != "windows"}))
    return 0


# ---------------------------------------------------------------- compact


def utc(value) -> str:
    if not value:
        return ""
    try:
        moment = datetime.fromisoformat(str(value))
    except ValueError:
        return ""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=FCC_ZONE)
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def compact_row(event: dict) -> dict | None:
    key = record_key(event)
    if key is None:
        return None
    service, entity, file_id = key.split("|")
    row = {
        "k": key,
        "s": service,
        "e": entity,
        "f": file_id,
        "m": str(event.get("file_manager_id") or "").lower(),
    }
    for short, name in FIELDS:
        value = event.get(name)
        if value not in (None, ""):
            row[short] = value
    try:
        row["z"] = int(event["file_size"])
    except (KeyError, TypeError, ValueError):
        pass
    return row


class Fold:
    """Latest state per filing, folded in an on-disk SQLite scratch file."""

    UPSERT = """
        INSERT INTO latest (k, o, row, src, tw) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (k) DO UPDATE SET
          row = CASE WHEN excluded.o > latest.o THEN excluded.row ELSE latest.row END,
          o = max(latest.o, excluded.o),
          src = latest.src | excluded.src,
          tw = coalesce(min(latest.tw, excluded.tw), latest.tw, excluded.tw)
    """

    def __init__(self, path: Path):
        self.db = sqlite3.connect(path)
        for pragma in (
            "journal_mode=OFF",
            "synchronous=OFF",
            "temp_store=FILE",
            "cache_size=-1000000",
            "locking_mode=EXCLUSIVE",
        ):
            self.db.execute(f"PRAGMA {pragma}")
        self.db.execute(
            "CREATE TABLE ev (k TEXT NOT NULL, h BLOB NOT NULL, t TEXT NOT NULL,"
            " PRIMARY KEY (k, h)) WITHOUT ROWID"
        )
        self.db.execute(
            "CREATE TABLE latest (k TEXT PRIMARY KEY, o TEXT NOT NULL,"
            " row BLOB NOT NULL, src INTEGER NOT NULL, tw TEXT) WITHOUT ROWID"
        )
        self.events = []
        self.states = []
        self.seq = 0
        self.unidentified = 0

    def add(self, raw: dict, source: int, window: str | None = None) -> None:
        """Fold 1 political event; later sources win ties on equal timestamps."""
        self.seq += 1
        event = {k: v for k, v in raw.items() if v is not None}
        row = compact_row(event)
        if row is None:
            self.unidentified += 1
            return
        canonical = json.dumps(event, sort_keys=True, separators=(",", ":"))
        digest = hashlib.blake2b(canonical.encode(), digest_size=16).digest()
        updated = utc(event.get("last_update_ts"))
        created = utc(event.get("create_ts"))
        order = f"{updated or ZERO_TIME}{created or ZERO_TIME}{self.seq:015d}"
        self.events.append((row["k"], digest, updated or created))
        self.states.append(
            (row["k"], order, zlib.compress(dumps(row).encode(), 1), source, window)
        )
        if len(self.states) >= BATCH:
            self.flush()

    def flush(self) -> None:
        self.db.executemany("INSERT OR IGNORE INTO ev VALUES (?, ?, ?)", self.events)
        self.db.executemany(self.UPSERT, self.states)
        self.db.commit()
        self.events, self.states = [], []

    def write(self, target: Path) -> dict:
        self.flush()
        rows = 0
        years = Counter()
        transfer_only = Counter()
        states = self.db.execute("SELECT k, row, src, tw FROM latest ORDER BY k")
        events = self.db.cursor().execute(
            "SELECT k, min(t), max(t), count(*) FROM ev GROUP BY k ORDER BY k"
        )
        with gzip_writer(target) as out:
            for (key, packed, source, window), (other, first, last, count) in zip(
                states, events, strict=True
            ):
                if key != other:
                    raise RuntimeError(f"Fold tables disagree at {key} / {other}")
                row = json.loads(zlib.decompress(packed))
                if first:
                    row["fs"] = first
                    row["ls"] = last
                row["ev"] = count
                out.write((dumps(row) + "\n").encode())
                rows += 1
                year = YEAR.match(row.get("p", ""))
                years[year[1] if year else "none"] += 1
                if source == FROM_TRANSFER:
                    transfer_only[window] += 1
        return {
            "rows": rows,
            "years": dict(sorted(years.items())),
            "transfer_only": dict(sorted(transfer_only.items())),
        }


def read_stored_day(store, record: dict, target: Path) -> dict:
    if store.download(record["key"], target) != record["sha256"]:
        raise ValueError(f"Stored day failed verification: {record['key']}")
    payload = parse_day(gzip.decompress(target.read_bytes()))
    if payload is None:
        raise ValueError(f"Stored day is not a complete answer: {record['key']}")
    return payload


def cmd_compact(args, store, now=None):
    now = (now or datetime.now(UTC)).astimezone(UTC)
    ledger = load_ledger(store)
    transfer = load_json(store, TRANSFER_MANIFEST)
    sources = []
    with tempfile.TemporaryDirectory(dir=args.work_dir) as work:
        work = Path(work)
        fold = Fold(work / "fold.sqlite")
        if transfer:
            part = work / "transfer.jsonl.gz"
            if store.download(transfer["key"], part) != transfer["sha256"]:
                raise ValueError("The transfer part failed verification")
            with gzip.open(part, "rt") as lines:
                for line in lines:
                    item = json.loads(line)
                    fold.add(item["e"], FROM_TRANSFER, item["w"])
            part.unlink()
            sources.append(
                {
                    "kind": "transfer",
                    "key": transfer["key"],
                    "sha256": transfer["sha256"],
                }
            )
        for day, record in sorted(ledger["days"].items()):
            payload = read_stored_day(store, record, work / "day.json.gz")
            for raw in payload["history"]:
                if is_political(raw):
                    fold.add(raw, FROM_DAILY)
            sources.append(
                {"kind": "daily", "key": record["key"], "sha256": record["sha256"]}
            )
        data = work / "inventory.jsonl.gz"
        counts = fold.write(data)
        fold.db.close()
        sha = file_sha(data)
        current = load_json(store, CURRENT)
        parent = load_json(store, current["manifest_key"]) if current else None
        if parent and parent["sha256"] == sha:
            print(dumps({"unchanged": parent["inventory_id"], "rows": counts["rows"]}))
            return 0
        object_key = f"{INVENTORY}/sha256/{sha[:2]}/{sha}.jsonl.gz"
        store.put_once(object_key, data, "application/gzip")
        inventory_id = "inv-" + now.strftime("%Y%m%d%H%M")
        unverified = sorted(
            d for d, r in ledger["days"].items() if r["status"] != "complete"
        )
        manifest = {
            "format": 1,
            "inventory_id": inventory_id,
            "object_key": object_key,
            "sha256": sha,
            "bytes": data.stat().st_size,
            "rows": counts["rows"],
            "through": contiguous_through(ledger["days"]),
            "windows": (transfer or {}).get("windows", {}),
            "sources": sources,
            "parent": parent["inventory_id"] if parent else None,
            "built_at": now.isoformat(timespec="seconds"),
            "years": counts["years"],
            "transfer_only": counts["transfer_only"],
            "unverified_days": unverified,
            "unidentified_events": fold.unidentified,
        }
        manifest_key = f"{INVENTORY}/manifests/{inventory_id}.json"
        manifest_body = dumps(manifest).encode()
        store.put_once(manifest_key, manifest_body, "application/json")
        # Read both back before anything points at them.
        if store.download(object_key, work / "check.jsonl.gz") != sha:
            raise ValueError("The stored inventory failed verification")
        if store.get(manifest_key) != manifest_body:
            raise ValueError("The stored manifest failed verification")
    pointer = {"inventory_id": inventory_id, "manifest_key": manifest_key}
    store.put_small(CURRENT, dumps(pointer).encode(), "application/json")
    print(dumps({k: v for k, v in manifest.items() if k not in ("sources", "windows")}))
    return 0


# ---------------------------------------------------------------- status


def cmd_status(args, store, now=None):
    now = now or datetime.now(UTC)
    ledger = load_ledger(store)["days"]
    newest = last_finished_day(now)
    missing = [
        d.isoformat()
        for d in day_range(FIRST_DAY, newest)
        if d.isoformat() not in ledger
    ]
    current = load_json(store, CURRENT)
    manifest = load_json(store, current["manifest_key"]) if current else None
    status = {
        "inventory_id": manifest and manifest["inventory_id"],
        "rows": manifest and manifest["rows"],
        "through": manifest and manifest["through"],
        "years": manifest and manifest["years"],
        "transfer_only_filings_by_window": manifest and manifest["transfer_only"],
        "days": {
            "expected": (newest - FIRST_DAY).days + 1,
            "complete": sum(1 for r in ledger.values() if r["status"] == "complete"),
            "unverified": sorted(
                d for d, r in ledger.items() if r["status"] != "complete"
            ),
            "missing": len(missing),
            "first_missing": missing[:10],
            "latest_finished": newest.isoformat(),
            "ledger_through": contiguous_through(ledger),
        },
    }
    print(json.dumps(status, indent=2))
    return 0


# ---------------------------------------------------------------- command line


def iso_day(value: str) -> date:
    return date.fromisoformat(value)


def cli():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--local-store",
        type=Path,
        help="Use this folder in place of private R2 (dry measurements)",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("fetch", help="Store whole FCC history days")
    p.add_argument("--from", dest="from_day", type=iso_day)
    p.add_argument("--to", dest="to_day", type=iso_day)
    p.add_argument("--backfill", action="store_true", help="Every day since 2012-01-01")
    p.add_argument("--force", action="store_true", help="Fetch complete days again")
    p.add_argument("--max-seconds", type=int, default=0)
    p = sub.add_parser("transfer", help="Store the archive's history as reconciliation")
    p.add_argument("--zip", type=Path, required=True)
    p.add_argument("--work-dir", type=Path)
    p = sub.add_parser("compact", help="Fold every stored day into the inventory")
    p.add_argument("--work-dir", type=Path)
    sub.add_parser("status", help="Summarize the inventory and the stored days")
    return parser


def main(argv=None):
    args = cli().parse_args(argv)
    store = open_store(args.local_store)
    command = {
        "fetch": cmd_fetch,
        "transfer": cmd_transfer,
        "compact": cmd_compact,
        "status": cmd_status,
    }[args.command]
    return command(args, store)


if __name__ == "__main__":
    sys.exit(main())
