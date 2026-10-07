#!/usr/bin/env python3
"""Notify IndexNow only about new, removed, or dated changed sitemap addresses.

Read-only without --apply. The first explicit --initialize stores a baseline and
sends nothing. Durable state lives on codex/indexnow-state, never main. A missing
or corrupt baseline fails closed. A 200 proves receipt, never search indexing;
202 is retained for retry while key validation is pending. Source outages do not
become deletion notices: removed addresses must actually return 404 or 410.

Protocol: https://www.indexnow.org/documentation and https://www.indexnow.org/faq
"""

from __future__ import annotations

import argparse
import base64
from bisect import bisect_right
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from http.client import HTTPException
import json
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener
from xml.etree import ElementTree

from scripts import check_public_search_health as health

REPOSITORY = "alethical-org/alethical"
STATE_BRANCH = "codex/indexnow-state"
STATE_FILE = "state.json"
STATE_DEPLOYMENT_CONFIG = {"git": {"deploymentEnabled": False}}
KEY = "bba181e14e3741348fe3e03e995e7fab"
KEY_URL = f"{health.ORIGIN}/{KEY}.txt"
ENDPOINT = "https://api.indexnow.org/indexnow"
MAX_NOTICES = 100
MAX_STATE_BYTES = 6 * 1024 * 1024
MAX_API_BYTES = 9 * 1024 * 1024
MAX_ENTRIES = 100_000
MIN_SECONDS_BETWEEN_SENDS = 300


def sha(value) -> str:
    health.require(
        isinstance(value, str) and bool(health.SHA.fullmatch(value)),
        "state has an invalid Git hash",
    )
    return value


def lastmod(value, now: datetime) -> str | None:
    if value is None:
        return None
    health.require(
        isinstance(value, str)
        and bool(
            re.fullmatch(
                r"\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?",
                value,
            )
        ),
        "sitemap lastmod is malformed",
    )
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        parsed = parsed.astimezone(timezone.utc)
        health.require(parsed <= now, "sitemap lastmod is in the future")
        return parsed.isoformat()
    except ValueError:
        raise health.HealthFailure("sitemap lastmod is malformed") from None


def snapshot(fetcher: health.Fetcher, now: datetime) -> dict[str, str | None]:
    health.xml_urls(fetcher.fetch(health.ORIGIN + "/sitemap.xml"), index=True)
    observed = {}
    seen = set()
    for section, url in zip(health.SECTIONS, health.SITEMAPS, strict=True):
        response = fetcher.fetch(url)
        urls = health.xml_urls(response, index=False)
        root = ElementTree.fromstring(response.body)
        for address, entry in zip(urls, root, strict=True):
            health.require(
                health.discovery_key(address) not in seen,
                "address appears in more than 1 sitemap child",
            )
            seen.add(health.discovery_key(address))
            dates = entry.findall(f"{{{health.NAMESPACE}}}lastmod")
            health.require(len(dates) <= 1, "sitemap has duplicate lastmod values")
            health.require(not dates or bool(dates[0].text), "sitemap lastmod is empty")
            observed[address] = lastmod(dates[0].text if dates else None, now)
    health.require(
        0 < len(observed) <= MAX_ENTRIES, "sitemap inventory is outside bounds"
    )
    return observed


def validate_state(raw, now: datetime) -> dict:
    health.require(
        isinstance(raw, dict)
        and raw.get("schema_version") == 1
        and raw.get("origin") == health.ORIGIN,
        "baseline shape or origin is invalid",
    )
    observed, pending = raw.get("observed"), raw.get("pending")
    health.require(
        isinstance(observed, dict)
        and 0 < len(observed) <= MAX_ENTRIES
        and isinstance(pending, dict)
        and len(pending) <= MAX_ENTRIES,
        "baseline inventory or pending queue is invalid",
    )
    for url, stamp in observed.items():
        health.safe_url(url)
        lastmod(stamp, now)
    for url, kind in pending.items():
        health.safe_url(url)
        health.require(
            kind in ("added", "updated", "removed"), "baseline pending event is invalid"
        )
        health.require(
            (url not in observed) == (kind == "removed"),
            "pending event contradicts baseline inventory",
        )
    all_urls = set(observed) | set(pending)
    health.require(
        len({health.discovery_key(url) for url in all_urls}) == len(all_urls),
        "baseline has semantically duplicate addresses",
    )
    cursor = raw.get("selection_cursor")
    if cursor is not None:
        health.safe_url(cursor)
    retry_at = raw.get("next_send_at")
    health.require(
        retry_at is None or (type(retry_at) is int and 0 <= retry_at <= 2**53 - 1),
        "baseline retry time is invalid",
    )
    sent = raw.get("last_sent_at")
    health.require(
        sent is None or (type(sent) is int and 0 <= sent <= int(now.timestamp())),
        "baseline send time is invalid",
    )
    return raw


def stage_changes(previous: dict | None, observed: dict, now: datetime) -> dict:
    if previous is None:
        return {
            "schema_version": 1,
            "origin": health.ORIGIN,
            "observed": observed,
            "pending": {},
            "last_sent_at": None,
            "selection_cursor": None,
            "next_send_at": None,
        }
    validate_state(previous, now)
    old = previous["observed"]
    pending = dict(previous["pending"])
    for url in set(old) | set(observed):
        if url not in observed:
            if url in old:
                pending[url] = "removed"
        elif url not in old:
            pending[url] = "added"
        elif (
            old[url] is not None
            and observed[url] is not None
            and (lastmod(observed[url], now) or "") > (lastmod(old[url], now) or "")
        ):
            pending[url] = "updated"
    # A removed page that reappears before its notice is accepted is now an
    # addition. An addition removed before acceptance remains a removal notice.
    for url in pending:
        if url not in observed:
            pending[url] = "removed"
        elif pending[url] == "removed":
            pending[url] = "added"
    return {**previous, "observed": observed, "pending": pending}


class GitHubState:
    """Only state.json on the fixed state branch can be updated.

    Updates use the saved file's blob hash (GitHub contents API compare-and-swap).
    Initialization makes an orphan branch with state and a fixed Vercel deployment
    exclusion. No main code or workflow is copied there. Existing branches must
    retain that exclusion. Never check out or force-update the state branch.
    """

    def __init__(self, token: str | None = None):
        self.token = token
        self.file_sha = None
        self.opener = build_opener(ProxyHandler({}), health.NoRedirect())
        self.requests = 0

    def api(self, path: str, *, method="GET", data=None, missing=False):
        health.require(self.requests < 20, "GitHub state request budget exhausted")
        health.require(
            bool(
                re.fullmatch(
                    r"(?:contents/(?:state\.json(?:\?ref=codex%2Findexnow-state)?|vercel\.json\?ref=codex%2Findexnow-state)|git/(?:ref/heads/codex/indexnow-state|refs(?:/heads/codex/indexnow-state)?|blobs(?:/[0-9a-f]{40})?|trees|commits))",
                    path,
                )
            ),
            "GitHub state path is outside policy",
        )
        health.require(
            method in ("GET", "POST", "PUT"), "GitHub state method is outside policy"
        )
        health.require(
            not path.startswith("contents/vercel.json") or method == "GET",
            "existing deployment exclusion is read-only",
        )
        headers = {
            "Accept": "application/vnd.github.object+json"
            if path.startswith("contents/") and method == "GET"
            else "application/vnd.github+json",
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "Alethical-public-change-notices/1",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        payload = (
            json.dumps(data, separators=(",", ":")).encode()
            if data is not None
            else None
        )
        if payload is not None:
            headers["Content-Type"] = "application/json"
        self.requests += 1
        request = Request(
            f"https://api.github.com/repos/{REPOSITORY}/{path}",
            data=payload,
            headers=headers,
            method=method,
        )
        try:
            with self.opener.open(request, timeout=15) as response:
                body = response.read(MAX_API_BYTES + 1)
                health.require(
                    len(body) <= MAX_API_BYTES, "GitHub state response exceeds bounds"
                )
                return json.loads(body)
        except HTTPError as error:
            status = error.code
            error.close()
            if missing and status == 404:
                return None
            raise health.HealthFailure(
                f"GitHub state request returned HTTP {status}; state not advanced"
            ) from None
        except (URLError, OSError, HTTPException, ValueError):
            raise health.HealthFailure(
                "GitHub state request failed; state not advanced"
            ) from None

    def read(self):
        reference = self.api("git/ref/heads/codex/indexnow-state", missing=True)
        if reference is None:
            return None
        health.require(
            reference.get("ref") == f"refs/heads/{STATE_BRANCH}",
            "GitHub state branch is wrong",
        )
        protection = self.api("contents/vercel.json?ref=codex%2Findexnow-state")
        health.require(
            protection.get("type") == "file" and protection.get("size", 1025) <= 1024,
            "state branch deployment exclusion is missing or oversized",
        )
        blob = self.api(f"git/blobs/{sha(protection.get('sha'))}")
        try:
            health.require(
                blob.get("encoding") == "base64",
                "state branch deployment exclusion encoding is invalid",
            )
            content = base64.b64decode(blob["content"].replace("\n", ""), validate=True)
            health.require(len(content) <= 1024, "deployment exclusion exceeds bounds")
            config = json.loads(content)
            health.require(
                config == STATE_DEPLOYMENT_CONFIG
                and config["git"]["deploymentEnabled"] is False,
                "state branch must explicitly disable Vercel deployments",
            )
        except (KeyError, ValueError, TypeError):
            raise health.HealthFailure(
                "state branch deployment exclusion is corrupt"
            ) from None
        metadata = self.api("contents/state.json?ref=codex%2Findexnow-state")
        self.file_sha = sha(metadata.get("sha"))
        health.require(
            metadata.get("type") == "file"
            and metadata.get("size", MAX_STATE_BYTES + 1) <= MAX_STATE_BYTES,
            "GitHub state file is outside bounds",
        )
        # Read by immutable blob SHA, never a response-provided URL or a second
        # mutable-branch read. Concurrent changes make the later CAS fail safely.
        blob = self.api(f"git/blobs/{self.file_sha}")
        health.require(
            blob.get("encoding") == "base64", "GitHub state encoding is invalid"
        )
        try:
            body = base64.b64decode(blob["content"].replace("\n", ""), validate=True)
            health.require(
                len(body) <= MAX_STATE_BYTES, "GitHub state file exceeds bounds"
            )
            return json.loads(body)
        except (KeyError, ValueError):
            raise health.HealthFailure("GitHub baseline is corrupt") from None

    def save(self, state):
        health.require(bool(self.token), "GitHub state write access is unavailable")
        content = json.dumps(state, sort_keys=True, separators=(",", ":")) + "\n"
        health.require(
            len(content.encode()) <= MAX_STATE_BYTES,
            "baseline exceeds stored size limit",
        )
        if self.file_sha is not None:
            result = self.api(
                "contents/state.json",
                method="PUT",
                data={
                    "message": "Save public page change queue",
                    "branch": STATE_BRANCH,
                    "sha": self.file_sha,
                    "content": base64.b64encode(content.encode()).decode(),
                },
            )
            self.file_sha = sha(result.get("content", {}).get("sha"))
            return
        tree = self.api(
            "git/trees",
            method="POST",
            data={
                "tree": [
                    {
                        "path": STATE_FILE,
                        "mode": "100644",
                        "type": "blob",
                        "content": content,
                    },
                    {
                        "path": "vercel.json",
                        "mode": "100644",
                        "type": "blob",
                        "content": json.dumps(STATE_DEPLOYMENT_CONFIG) + "\n",
                    },
                ]
            },
        )
        commit = self.api(
            "git/commits",
            method="POST",
            data={
                "message": "Initialize public page change baseline without submissions",
                "tree": sha(tree.get("sha")),
                "parents": [],
            },
        )
        # Creating a fixed new ref is safe only when absent. A conflicting ref
        # returns failure; it is never deleted, replaced, or forced.
        self.api(
            "git/refs",
            method="POST",
            data={"ref": f"refs/heads/{STATE_BRANCH}", "sha": sha(commit.get("sha"))},
        )
        metadata = self.api("contents/state.json?ref=codex%2Findexnow-state")
        self.file_sha = sha(metadata.get("sha"))


def retry_after_at(value: str | None, now: datetime) -> int:
    minimum = int(now.timestamp()) + MIN_SECONDS_BETWEEN_SENDS
    if not isinstance(value, str) or len(value) > 128:
        return minimum
    value = value.strip()
    if re.fullmatch(r"[0-9]{1,12}", value):
        return max(minimum, int(now.timestamp()) + int(value))
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            return minimum
        return max(minimum, int(parsed.timestamp()))
    except (ValueError, OverflowError, TypeError):
        return minimum


def submit(
    urls: list[str],
    *,
    opener=None,
    now: datetime | None = None,
    record: dict | None = None,
) -> int:
    started = time.monotonic()
    health.require(
        0 < len(urls) <= MAX_NOTICES and len(set(urls)) == len(urls),
        "notice batch is outside bounds",
    )
    for url in urls:
        health.safe_url(url)
    opener = opener or build_opener(ProxyHandler({}), health.NoRedirect())
    payload = json.dumps(
        {
            "host": "www.alethical.com",
            "key": KEY,
            "keyLocation": KEY_URL,
            "urlList": urls,
        },
        separators=(",", ":"),
    ).encode()
    request = Request(
        ENDPOINT,
        data=payload,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "Alethical-public-change-notices/1",
        },
        method="POST",
    )
    for attempt in range(2):
        try:
            with opener.open(request, timeout=10) as response:
                # A successful endpoint response is a receipt, not proof of
                # crawling or indexing. Never record its body or headers.
                return response.code
        except HTTPError as error:
            status = error.code
            if status == 429 and record is not None:
                received_at = (
                    now + timedelta(seconds=time.monotonic() - started)
                    if now is not None
                    else datetime.now(timezone.utc)
                )
                record["retry_after_at"] = retry_after_at(
                    error.headers.get("Retry-After"), received_at
                )
            error.close()
            if status >= 500 and attempt == 0:
                time.sleep(1)
                continue
            return status
        except (URLError, OSError, HTTPException):
            if attempt:
                raise health.HealthFailure(
                    "IndexNow network request failed after 1 retry"
                ) from None
            time.sleep(1)
    raise health.HealthFailure("IndexNow submission failed")


def run(store, fetcher, *, now: datetime, apply: bool, initialize: bool, report: dict):
    started = time.monotonic()
    old = store.read()
    if old is not None:
        validate_state(old, now)
    health.require(
        old is not None or initialize,
        "baseline missing; explicit first initialization required, no notices sent",
    )
    health.require(
        not initialize or old is None,
        "initialization refused because a baseline already exists",
    )
    observed = snapshot(fetcher, now)
    state = stage_changes(old, observed, now)
    report.update(
        {
            "inventory_count": len(observed),
            "pending_count": len(state["pending"]),
            "mode": "apply" if apply else "dry-run",
            "initialized": old is None,
            "receipt": "not-sent",
            "notices_received": 0,
        }
    )
    if not apply:
        report["passed"] = True
        return
    health.require(
        os.environ.get("GITHUB_REF") == "refs/heads/main"
        and os.environ.get("GITHUB_REPOSITORY") == REPOSITORY,
        "live notices require trusted main in the owning repository",
    )
    key_response = fetcher.fetch(KEY_URL)
    health.require(
        key_response.status == 200 and key_response.text().strip() == KEY,
        "public ownership key is unavailable or mismatched",
    )
    # Persist discovered changes before any external notification. If this
    # fails, no notices are sent and the previous baseline remains authoritative.
    if old != state:
        store.save(state)
    if old is None or not state["pending"]:
        report["passed"] = True
        return
    next_send = state.get("next_send_at")
    if next_send is not None and now.timestamp() < next_send:
        report.update(
            {
                "receipt": "deferred-for-server-retry-after",
                "next_send_at": next_send,
                "passed": True,
            }
        )
        return
    last_sent = state["last_sent_at"]
    if (
        last_sent is not None
        and now.timestamp() - last_sent < MIN_SECONDS_BETWEEN_SENDS
    ):
        report.update({"receipt": "deferred-for-minimum-spacing", "passed": True})
        return
    selected = []
    failed = 0
    queue = sorted(state["pending"])
    cursor = state.get("selection_cursor")
    start = bisect_right(queue, cursor) % len(queue) if cursor is not None else 0
    batch = (queue[start:] + queue[:start])[:MAX_NOTICES]
    for url in batch:
        kind = state["pending"][url]
        try:
            response = fetcher.fetch(url)
            if kind == "removed":
                health.require(
                    response.status in (404, 410),
                    "removed page is still present or unavailable",
                )
            else:
                health.require(
                    response.status == 200, "new or changed page is unavailable"
                )
                page = health.PageHTML()
                page.feed(response.text())
                directives = health.tokens(
                    page.robots + [response.headers.get("X-Robots-Tag", "")]
                )
                health.require(
                    page.canonicals == [url]
                    and not directives.intersection({"noindex", "none"}),
                    "new or changed page is not publicly indexable at its own address",
                )
            selected.append(url)
        except health.HealthFailure as error:
            if str(error) in ("request budget exhausted", "time budget exhausted"):
                # Advance only across pages actually examined. Skipping the
                # unexamined tail would create a second starvation path.
                report["public_budget_exhausted"] = True
                break
            failed += 1
        state["selection_cursor"] = url
    report["withheld_count"] = failed
    if not selected:
        store.save(state)  # Fair retry must also advance when every page failed.
        report.update({"receipt": "no-pages-ready", "passed": False})
        return
    # Record the attempt before sending to enforce minimum spacing even if a
    # response or the following state save is interrupted. Retry remains durable.
    attempt_now = now + timedelta(seconds=time.monotonic() - started)
    state["last_sent_at"] = int(attempt_now.timestamp())
    store.save(state)
    send_now = now + timedelta(seconds=time.monotonic() - started)
    status = submit(selected, now=send_now, record=report)
    report["http_status"] = status
    if status == 200:
        state["next_send_at"] = None
        state["pending"] = {
            url: kind for url, kind in state["pending"].items() if url not in selected
        }
        store.save(state)
        report.update(
            {
                "receipt": "received-not-indexing-proof",
                "notices_received": len(selected),
                "pending_count": len(state["pending"]),
                "passed": failed == 0,
            }
        )
    elif status == 202:
        report.update(
            {
                "receipt": "received-key-validation-pending-retry-retained",
                "notices_received": len(selected),
                "passed": False,
            }
        )
    else:
        if status == 429:
            state["next_send_at"] = report.get(
                "retry_after_at", int(send_now.timestamp()) + MIN_SECONDS_BETWEEN_SENDS
            )
            store.save(state)
            report["next_send_at"] = state["next_send_at"]
        report.update({"receipt": "not-accepted-retry-retained", "passed": False})


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--initialize", action="store_true")
    parser.add_argument(
        "--baseline", type=Path, help="Local baseline for a read-only dry run"
    )
    parser.add_argument(
        "--output", type=Path, default=Path("public-change-notices-results.json")
    )
    args = parser.parse_args(argv)
    report = {
        "schema_version": 1,
        "passed": False,
        "scope": "IndexNow changed sitemap address receipts; no guaranteed crawling or indexing",
    }
    fetcher = health.Fetcher()
    try:
        health.require(
            not (args.apply and args.baseline),
            "live submission cannot use a local baseline",
        )
        if args.baseline:

            class LocalBaseline:
                def read(self):
                    if not args.baseline.exists():
                        return None
                    health.require(
                        args.baseline.stat().st_size <= MAX_STATE_BYTES,
                        "local baseline exceeds bounds",
                    )
                    return json.loads(args.baseline.read_text())

            store = LocalBaseline()
        else:
            store = GitHubState(os.environ.get("GH_TOKEN"))
        run(
            store,
            fetcher,
            now=datetime.now(timezone.utc),
            apply=args.apply,
            initialize=args.initialize,
            report=report,
        )
    except health.HealthFailure as error:
        report["failure"] = str(error)
    except Exception:
        report["failure"] = (
            "unexpected change-notice failure; pending state must be retained"
        )
    finally:
        report["public_request_count"] = fetcher.requests
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n"
        )
    print(json.dumps(report, sort_keys=True))
    return int(not report["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
