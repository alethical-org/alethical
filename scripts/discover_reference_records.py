#!/usr/bin/env python3
"""Cheap official reference signals queue checked collection, never publication."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import requests  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS  # noqa: E402
from alethical.pipeline.record_refresh import (  # noqa: E402
    load_progress,
    save_progress,
    request_refresh,
)
from alethical.pipeline.request_limits import DatabaseRequestLimiter, RateLimitedSession  # noqa: E402
from alethical.pipeline.roster_pdf import DEFAULT_ROSTER_PDF_URL  # noqa: E402
from alethical.pipeline.supporting_source_checks import MAP_INDEX, current_map_links  # noqa: E402
from alethical.pipeline import lobbying_expenditures as spending  # noqa: E402


def bounded_body(response, limit):
    response.raise_for_status()
    result = bytearray()
    for part in response.iter_content(65536):
        result.extend(part)
        if len(result) > limit:
            raise ValueError("Official discovery response exceeded its byte budget")
    if not result:
        raise ValueError("Official discovery response was empty")
    return bytes(result)


def fingerprint(source, http, previous):
    if source == "roster":
        headers = {}
        if previous.get("etag"):
            headers["If-None-Match"] = previous["etag"]
        elif previous.get("last_modified"):
            headers["If-Modified-Since"] = previous["last_modified"]
        with http.get(
            DEFAULT_ROSTER_PDF_URL, headers=headers, timeout=(5, 30), stream=True
        ) as response:
            if response.status_code == 304:
                if not headers or not previous.get("sha256"):
                    raise ValueError(
                        "Roster validator has no held discovery fingerprint"
                    )
                return previous
            body = bounded_body(response, 5_000_000)
            if not body.startswith(b"%PDF-"):
                raise ValueError("Official roster discovery did not return a PDF")
            return {
                "sha256": hashlib.sha256(body).hexdigest(),
                "etag": response.headers.get("ETag"),
                "last_modified": response.headers.get("Last-Modified"),
            }
    if source == "maps":
        with http.get(MAP_INDEX, timeout=(5, 30), stream=True) as response:
            links = current_map_links(bounded_body(response, 2_000_000))
        result = {}
        for chamber, url in sorted(links.items()):
            with http.head(url, timeout=(5, 30)) as response:
                response.raise_for_status()
                etag, modified = (
                    response.headers.get("ETag"),
                    response.headers.get("Last-Modified"),
                )
                if not etag and not modified:
                    raise ValueError(
                        "Map release metadata is unavailable; full byte reconciliation remains due"
                    )
                result[chamber] = {
                    "url": url,
                    "etag": etag,
                    "last_modified": modified,
                    "length": response.headers.get("Content-Length"),
                }
        return result
    if source == "lobbying":
        with http.get(spending.LANDING_PAGE, timeout=(5, 30), stream=True) as response:
            body = bounded_body(response, 2_000_000)
            held = requests.Response()
            held.status_code = 200
            held._content = body
            held.encoding = response.encoding
            # Resolve both precise labels from the same response. The loader
            # still rereads both full files because they supply no validators.
            cached = type("Landing", (), {"get": lambda self, *a, **k: held})()
            active = spending.resolve_download(
                cached,
                spending.LANDING_PAGE,
                heading="lobbyist information",
                row_label="active lobbyists",
            )
            totals = spending.resolve_download(cached, spending.LANDING_PAGE)
        return {"active": active.url, "spending": totals.url}
    raise ValueError("Unknown reference discovery source")


def run(engine, *, source, name, token):
    progress = load_progress(engine, name, token)
    previous = progress.get("source_fingerprint", {})
    session = requests.Session()
    session.headers["User-Agent"] = (
        "Alethical source discovery (+https://alethical.com)"
    )
    http = RateLimitedSession(session, DatabaseRequestLimiter(engine))
    try:
        observed = fingerprint(source, http, previous)
    finally:
        http.close()
    changed = observed != previous
    if source == "roster" and previous:
        changed = observed.get("sha256") != previous.get("sha256")
    if changed:
        with Session(engine) as db:
            from datetime import UTC, datetime

            request_refresh(db, source, now=datetime.now(UTC))
            db.commit()
    progress["source_fingerprint"] = observed
    save_progress(engine, name, token, progress)
    return {
        "status": "complete",
        "scope": "official release signal only",
        "collection_requested": changed,
        "publication": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), required=True)
    parser.add_argument(
        "--source", choices=("roster", "maps", "lobbying"), required=True
    )
    args = parser.parse_args()
    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    try:
        result = run(
            engine,
            source=args.source,
            name=os.environ["ALETHICAL_REFRESH_JOB_NAME"],
            token=os.environ["ALETHICAL_REFRESH_JOB_TOKEN"],
        )
        print(json.dumps(result, sort_keys=True))
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
