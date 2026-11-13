"""Bounded, replayable collection of explicitly listed election source URLs.

Capturing a page establishes neither filing coverage nor candidate identity. Links
are discovery leads only. Bodies are content-addressed; every attempt is retained.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from threading import Lock
from urllib.parse import urljoin, urlsplit, urlunsplit

import requests

_BODY_LOCK = Lock()


class CaptureError(ValueError):
    pass


def public_url(url: str, allowed_hosts: set[str]) -> str:
    """Only operator-listed public authority hosts; no credentials or custom port."""
    parsed = urlsplit(url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.hostname.lower() not in allowed_hosts
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in {None, 80 if parsed.scheme == "http" else 443}
        or any(ord(c) < 32 for c in url)
    ):
        raise CaptureError("URL is outside the declared source hosts")
    return urlunsplit(parsed._replace(fragment=""))


class _Links(HTMLParser):
    def __init__(self, base: str):
        super().__init__()
        self.base = base
        self.links: list[dict] = []
        self.current: dict | None = None

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "a" and values.get("href"):
            target = urljoin(self.base, values["href"])
            parsed = urlsplit(target)
            if parsed.scheme in {"http", "https"} and not (
                parsed.username or parsed.password
            ):
                self.current = {"url": target, "text": ""}

    def handle_data(self, data):
        if self.current is not None:
            self.current["text"] += data

    def handle_endtag(self, tag):
        if tag == "a" and self.current is not None:
            self.current["text"] = " ".join(self.current["text"].split())
            self.links.append(self.current)
            self.current = None


def page_links(body: bytes, url: str, encoding: str = "utf-8") -> list[dict]:
    parser = _Links(url)
    parser.feed(body.decode(encoding, errors="replace"))
    return parser.links


def capture(
    spec: dict,
    directory: Path,
    *,
    get=requests.get,
    max_bytes: int = 20_000_000,
) -> dict:
    """Keep one attempt; a failed route is never a no-filing finding.

    This is an operator CLI primitive, not a visitor-provided URL fetch endpoint.
    Redirects to hosts absent from the explicit manifest require review first.
    """
    if not isinstance(spec.get("id"), str) or not spec["id"].strip():
        raise CaptureError("Source needs an inventory ID")
    hosts = spec.get("allowed_hosts")
    if (
        not isinstance(hosts, list)
        or not hosts
        or any(
            not isinstance(h, str)
            or not re.fullmatch(r"[a-z0-9][a-z0-9.-]*\.[a-z]{2,}", h)
            or h.endswith((".local", ".internal", ".localhost"))
            for h in hosts
        )
    ):
        raise CaptureError("Source needs explicit public authority host names")
    url = public_url(spec["url"], set(hosts))
    receipt = {
        "id": spec["id"],
        "requested_url": url,
        "fetched_at": datetime.now(UTC).isoformat(),
        "state": "fetch_failed",
        "redirects": [],
        "identity_confirmed": False,
        "filing_coverage_confirmed": False,
    }
    try:
        for _ in range(6):
            with get(
                url,
                timeout=(5, 25),
                stream=True,
                allow_redirects=False,
                headers={
                    "User-Agent": "AlethicalElectionSources/1.0 (+https://alethical.com)"
                },
            ) as response:
                receipt["http_status"] = response.status_code
                receipt["final_url"] = url
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("Location", "")
                    if not location:
                        raise CaptureError("Redirect has no destination")
                    target = urljoin(url, location)
                    receipt["redirects"].append({"from": url, "to": target})
                    url = public_url(target, set(hosts))
                    continue
                if response.status_code != 200:
                    raise CaptureError(f"Source returned HTTP {response.status_code}")
                body = bytearray()
                start = time.monotonic()
                for chunk in response.iter_content(65536):
                    body.extend(chunk)
                    if len(body) > max_bytes or time.monotonic() - start > 60:
                        raise CaptureError("Source exceeds the collection limit")
                if not body:
                    raise CaptureError("Source returned an empty body")
                original = bytes(body)
                fingerprint = hashlib.sha256(original).hexdigest()
                directory.mkdir(parents=True, exist_ok=True)
                path = directory / f"{fingerprint}.body"
                with _BODY_LOCK:
                    if path.exists():
                        if path.read_bytes() != original:
                            raise CaptureError(
                                "Retained bytes differ from their fingerprint"
                            )
                    else:
                        with path.open("xb") as handle:
                            handle.write(original)
                content_type = response.headers.get("Content-Type", "")
                receipt.update(
                    state="captured",
                    sha256=fingerprint,
                    bytes=len(original),
                    file=path.name,
                    content_type=content_type,
                    links=page_links(original, url, response.encoding or "utf-8")
                    if "html" in content_type.lower()
                    else [],
                )
                return receipt
        raise CaptureError("Too many redirects")
    except (requests.RequestException, CaptureError) as error:
        # Request exceptions can include credentials or internal request objects.
        receipt["error"] = (
            str(error) if isinstance(error, CaptureError) else type(error).__name__
        )
    return receipt


def collect(manifest: list[dict], directory: Path, *, workers: int = 4) -> dict:
    """Resume successful verified units; keep each failed attempt for retry.

    At most four requests globally and one per host, including redirect targets.
    No body parsing, filing approval, database write or publication occurs here.
    """
    ids = [item.get("id") for item in manifest]
    if any(not isinstance(value, str) or not value.strip() for value in ids):
        raise CaptureError("Each source needs a nonempty inventory ID")
    if type(workers) is not int or not 1 <= workers <= 4:
        raise CaptureError("Use one to four collection workers")
    if len(ids) != len(set(ids)):
        raise CaptureError("Duplicate source inventory IDs")
    directory.mkdir(parents=True, exist_ok=True)
    ledger = directory / "attempts.jsonl"
    previous = {}
    if ledger.exists():
        for line in ledger.read_text().splitlines():
            item = json.loads(line)
            previous[item["id"]] = item
    results, pending = {}, []
    for spec in manifest:
        old = previous.get(spec["id"])
        if old and old["state"] == "captured" and old["requested_url"] == spec["url"]:
            name = old.get("file", "")
            if Path(name).name != name or not re.fullmatch(r"[a-f0-9]{64}\.body", name):
                raise CaptureError("Invalid retained source path")
            body = (directory / name).read_bytes()
            if (
                hashlib.sha256(body).hexdigest() != old["sha256"]
                or len(body) != old["bytes"]
            ):
                raise CaptureError(
                    "Retained source has changed; keep it for investigation"
                )
            results[spec["id"]] = old
            continue
        pending.append(spec)
    locks = {}
    lock_guard = Lock()

    @contextmanager
    def limited_get(url, **kwargs):
        with lock_guard:
            lock = locks.setdefault(urlsplit(url).hostname, Lock())
        with lock:
            try:
                with requests.get(url, **kwargs) as response:
                    yield response
            finally:
                time.sleep(0.25)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(capture, spec, directory, get=limited_get): spec
            for spec in pending
        }
        for future in as_completed(futures):
            spec = futures[future]
            try:
                receipt = future.result()
            except Exception as error:
                # One malformed directory entry must not discard other completed
                # captures. Keep unexpected faults visible for investigation.
                try:
                    parsed = urlsplit(spec.get("url", ""))
                    safe_url = urlunsplit(parsed._replace(netloc=parsed.hostname or ""))
                except (TypeError, ValueError):
                    safe_url = None
                receipt = {
                    "id": spec["id"],
                    "requested_url": safe_url,
                    "fetched_at": datetime.now(UTC).isoformat(),
                    "state": "fetch_failed",
                    "error": str(error)
                    if isinstance(error, CaptureError)
                    else type(error).__name__,
                    "collector_error": not isinstance(error, CaptureError),
                    "identity_confirmed": False,
                    "filing_coverage_confirmed": False,
                }
            with ledger.open("a") as handle:
                handle.write(json.dumps(receipt, ensure_ascii=False) + "\n")
            results[receipt["id"]] = receipt
    ordered = [results[identifier] for identifier in ids]
    return {
        "expected": len(manifest),
        "captured": sum(row["state"] == "captured" for row in ordered),
        "failed": sum(row["state"] != "captured" for row in ordered),
        "identity_confirmed": False,
        "filing_coverage_confirmed": False,
        "sources": ordered,
    }
