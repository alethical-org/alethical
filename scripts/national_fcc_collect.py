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
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import closing
from pathlib import Path

PREFIX = "fcc-national/v1"
DOWNLOAD = "https://files.fcc.gov/download/{manager}.pdf"
DETAIL = (
    "https://publicfiles.fcc.gov/api/manager/file/id/{file_id}.json?entityId={entity}"
)
USER_AGENT = "Alethical public-record archive (+https://alethical.com)"
UUID_PATTERN = re.compile(r"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
MISSING_STATUS = {401, 403, 404, 410}
CONFIRM_ATTEMPTS = 2
CONFIRM_GAP_SECONDS = 6 * 3600
MAX_FILE_BYTES = 512 * 1024**2
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


def download(http, pace: Pace, url: str, target: Path):
    """Return (status, sha, size). Streams to disk; follows only FCC redirects."""
    for _ in range(5):
        pace.wait()
        with http.stream("GET", url) as response:
            if response.status_code in (429, 503):
                pace.busy(retry_after(response.headers.get("Retry-After")))
                raise Busy(f"HTTP {response.status_code}")
            if response.is_redirect:
                location = response.headers.get("location", "")
                url = str(response.url.join(location))
                if not re.match(r"^https://([a-z0-9-]+\.)*fcc\.gov/", url):
                    return "redirect-away", None, 0
                continue
            if response.status_code != 200:
                if response.status_code >= 500 or response.status_code == 408:
                    raise Busy(f"HTTP {response.status_code}")
                return response.status_code, None, 0
            digest = hashlib.sha256()
            size = 0
            with target.open("wb") as out:
                for chunk in response.iter_bytes(1 << 16):
                    size += len(chunk)
                    if size > MAX_FILE_BYTES:
                        raise Busy("file exceeds the size limit")
                    digest.update(chunk)
                    out.write(chunk)
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


def check(row, http, pace: Pace, store: Store, spool: Path) -> dict:
    result = {"k": row["k"], "t": int(time.time())}
    target = spool / f"{row['k'].replace('|', '_')}.part"
    try:
        manager = row["m"]
        # A filing listed without a download identifier goes straight to its
        # FCC file record, which is the official alternate source.
        status, sha, size = (
            download(http, pace, DOWNLOAD.format(manager=manager), target)
            if manager
            else (404, None, 0)
        )
        if status in MISSING_STATUS:
            alternate = current_manager(http, pace, row)
            if alternate:
                manager = alternate
                result["mg"] = alternate
                status, sha, size = download(
                    http, pace, DOWNLOAD.format(manager=alternate), target
                )
        if status != 200:
            return result | {"o": "missing", "h": status}
        try:
            pages = pdf_pages(target)
        except Exception as error:  # noqa: BLE001 - any parse failure is unreadable
            return result | {
                "o": "unreadable",
                "h": 200,
                "sha": sha,
                "b": size,
                "err": type(error).__name__,
            }
        store.save_pdf(target, sha, size)
        return result | {"o": "saved", "sha": sha, "b": size, "p": pages}
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
        elif row["o"] in ("missing", "unreadable"):
            current["verdicts"].append(row["t"])
    return state


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


def due(entry, now: float) -> bool:
    last = entry["last"]
    if last["o"] == "retry":
        backoff = min(6 * 3600, 120 * 2 ** min(entry["tries"], 8))
        return now >= last["t"] + backoff
    # A refusal is checked again only after the confirmation gap.
    return now >= max(entry["verdicts"]) + CONFIRM_GAP_SECONDS


def load_results(store: Store, prefix: str):
    rows = []
    for key in sorted(store.keys(f"{prefix}/results/")):
        rows.extend(read_gz_lines(store.get(key)))
    return rows


# ---------------------------------------------------------------- commands


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
    store.put_small(
        f"{prefix}/manifest.json", json.dumps(manifest).encode(), "application/json"
    )
    print(json.dumps(manifest))


def cmd_run(args):
    import httpx

    store = Store()
    prefix = run_prefix(args.run_id)
    manifest = json.loads(store.get(f"{prefix}/manifest.json"))
    body = store.get(f"{prefix}/worklist.jsonl.gz")
    if hashlib.sha256(body).hexdigest() != manifest["sha256"]:
        raise ValueError("The stored work list does not match its manifest")
    work = [r for r in read_gz_lines(body) if "held" not in r]
    state = latest_state(load_results(store, prefix))
    now = time.time()
    queue = [
        r
        for r in work
        if r["k"] not in state
        or (settled(state[r["k"]]) is None and due(state[r["k"]], now))
    ]
    # Never-checked filings first, then retries.
    queue.sort(key=lambda r: r["k"] in state)
    started = time.monotonic()
    deadline = started + args.max_seconds
    pace = Pace(args.rate_start, args.rate_max)
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
        key = f"{prefix}/results/{run_tag}-{sequence:05d}.jsonl.gz"
        for attempt in range(5):
            try:
                store.put_small(key, gz_lines(batch), "application/gzip")
                break
            except Exception:  # noqa: BLE001
                if attempt == 4:
                    raise
                time.sleep(10 * (attempt + 1))
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
                "queue": len(queue),
                "settled": sum(1 for e in state.values() if settled(e)),
                "work": len(work),
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
        rows = iter(queue)
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
                running.add(pool.submit(check, row, http, pace, store, spool))
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
                "remaining_queue_estimate": max(0, len(queue) - sum(outcomes.values())),
            }
        ),
        flush=True,
    )


def cmd_status(args):
    store = Store()
    prefix = run_prefix(args.run_id)
    manifest = json.loads(store.get(f"{prefix}/manifest.json"))
    work = list(read_gz_lines(store.get(f"{prefix}/worklist.jsonl.gz")))
    state = latest_state(load_results(store, prefix))
    now = time.time()
    tally = Counter()
    saved_bytes = 0
    shas = set()
    for row in work:
        if "held" in row:
            tally["held_" + row["held"]] += 1
            continue
        entry = state.get(row["k"])
        if entry is None:
            tally["not_checked"] += 1
            continue
        verdict = settled(entry)
        if verdict == "saved":
            tally["saved"] += 1
            if entry["final"]["sha"] not in shas:
                shas.add(entry["final"]["sha"])
                saved_bytes += entry["final"]["b"]
        elif verdict == "unavailable":
            tally["confirmed_" + entry["last"]["o"]] += 1
        elif entry["last"]["o"] == "retry":
            tally["retry_waiting"] += 1
        else:
            tally["awaiting_confirmation_" + entry["last"]["o"]] += 1
    print(
        json.dumps(
            {
                "run": manifest["run_id"],
                "work_rows": len(work),
                "filings": dict(tally),
                "distinct_saved_pdfs": len(shas),
                "distinct_saved_bytes": saved_bytes,
                "as_of": int(now),
            },
            indent=2,
        )
    )


def cmd_export(args):
    """Settled outcomes for every filing, for building the Finance index."""
    store = Store()
    prefix = run_prefix(args.run_id)
    work = read_gz_lines(store.get(f"{prefix}/worklist.jsonl.gz"))
    state = latest_state(load_results(store, prefix))
    with gzip.open(args.out, "wt") as out:
        for row in work:
            entry = state.get(row["k"])
            record = {"k": row["k"]}
            if "held" in row:
                record["held"] = row["held"]
                if "mn" in row:
                    record["mn"] = row["mn"]
            elif entry is None:
                record["state"] = "not_checked"
            else:
                verdict = settled(entry)
                record["state"] = verdict or "pending"
                if verdict == "saved":
                    final = entry["final"]
                    record |= {
                        "sha": final["sha"],
                        "b": final["b"],
                        "p": final["p"],
                        "t": final["t"],
                    }
                    if "mg" in final:
                        record["mg"] = final["mg"]
                elif verdict == "unavailable":
                    record["why"] = entry["last"]["o"]
                    record["t"] = max(entry["verdicts"])
            out.write(json.dumps(record, separators=(",", ":")) + "\n")


def cli():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--run-id", default="census-20261119")
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
    p = sub.add_parser("run", help="Check filings until the time limit")
    p.add_argument("--max-seconds", type=int, default=5 * 3600)
    p.add_argument("--workers", type=int, default=16)
    p.add_argument("--rate-start", type=float, default=4.0)
    p.add_argument("--rate-max", type=float, default=8.0)
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
        "run": cmd_run,
        "status": cmd_status,
        "export": cmd_export,
    }[args.command](args)


if __name__ == "__main__":
    main()
