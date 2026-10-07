#!/usr/bin/env python3
"""Bounded production failure counts. Provider text never leaves memory.

The aggregate is safe for a public artifact. A failed collection is a coverage
gap, not proof of a healthy hour. Transient failures return zero so the daily
coverage check, rather than hourly email, reports persistent gaps.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import time

MAX_ROWS = 100
MAX_BYTES = 4 * 1024 * 1024
COMMAND_SECONDS = 75
# Exact routes whose handlers requireSiteMetricsAdmin before serving data.
ADMIN_API_PATHS = {
    "/api/traffic",
    "/api/traffic-performance",
    "/api/traffic-uptime",
    "/api/traffic-google",
    "/api/traffic-bing",
}
PHASES = {"content", "shell"}
FAILURE_KINDS = {"timeout", "network", "http", "json", "payload", "unknown"}
SOURCE_FAMILIES = {
    "committee-finance",
    "committee-confirmation",
    "committee-notices",
    "committee-disclosures",
    "committee-payments",
    "bills",
    "legislators",
    "campaign-finance",
    "lobbying",
    "candidates",
    "public-api",
    "shell",
    "none",
}
PAGE_FAMILIES = {
    "tab",
    "bill",
    "legislator",
    "bills",
    "legislators",
    "findMyLegislator",
    "candidates",
    "candidateProfile",
    "candidateClaim",
    "candidateManage",
    "adminCandidateClaims",
    "moneyLanding",
    "emailPreferences",
    "unsubscribe",
    "commentEmails",
    "lobbyingLanding",
    "lobbyingPrincipals",
    "lobbyingLobbyists",
    "lobbyingPrincipal",
    "lobbyingLobbyist",
    "read",
    "readResearch",
    "readGuides",
    "readSet",
    "shortPosts",
    "readTopic",
    "research",
    "guide",
    "moneyCommittee",
    "moneyCommitteePayments",
    "moneyCommitteeList",
    "moneyByRace",
    "moneyRaceGroup",
    "moneySearch",
    "paymentsUnderName",
    "outsideSpending",
    "privacy",
    "adminUsers",
    "adminSiteMetrics",
    "siteMetrics",
    "terms",
    "aboutUs",
    "services",
    "contactUs",
    "confirmEmail",
    "resetPassword",
    "chatSession",
    "ask",
    "notFound",
    "unknown",
}
TIMING_BUCKETS = ("under-100ms", "100ms-1s", "1s-5s", "5s-10s", "10s-or-more")


class CollectionFailure(Exception):
    def __init__(self, reason: str, *, transient: bool = False):
        super().__init__(reason)
        self.transient = transient


def stop_process(process: subprocess.Popen) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def iso(value: datetime) -> str:
    return (
        value.astimezone(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def complete_hour(now: datetime) -> tuple[datetime, datetime]:
    end = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return end - timedelta(hours=1), end


def empty_report(start: datetime, end: datetime, *, schema_version: int = 2) -> dict:
    report = {
        "schema_version": schema_version,
        "window": {"start": iso(start), "end": iso(end)},
        "collection_status": "failed",
        "failure": "collection-not-started",
        "attempt_count": 0,
        "limit": MAX_ROWS,
        "rows_received": 0,
        "failures_count": 0,
        "unclassified_failures": 0,
        "saturated": False,
        "status_counts": [],
        "minutes": [],
        "classifications": [],
        "unclassified_by_family": [],
    }

    if schema_version == 2:
        report["recovery_collection"] = empty_recovery_report()
    return report


def empty_recovery_report() -> dict:
    return {
        "collection_status": "failed",
        "failure": "collection-not-started",
        "attempt_count": 0,
        "limit": MAX_ROWS,
        "rows_received": 0,
        "recoveries_count": 0,
        "unclassified_matches": 0,
        "saturated": False,
        "classifications": [],
    }


def run_command(command: list[str]) -> bytes:
    """Drain both pipes with a combined byte cap and an actual process deadline."""
    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError:
        raise CollectionFailure("command-unavailable") from None
    output = {"stdout": bytearray(), "stderr": bytearray()}
    deadline = time.monotonic() + COMMAND_SECONDS
    failure = None
    with selectors.DefaultSelector() as selector:
        for stream, name in ((process.stdout, "stdout"), (process.stderr, "stderr")):
            selector.register(stream, selectors.EVENT_READ, name)
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                failure = CollectionFailure("command-timeout", transient=True)
                break
            for key, _ in selector.select(min(remaining, 0.2)):
                chunk = os.read(key.fileobj.fileno(), 65_536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                if sum(map(len, output.values())) + len(chunk) > MAX_BYTES:
                    failure = CollectionFailure("command-output-limit")
                    break
                output[key.data].extend(chunk)
            if failure:
                break
    if failure:
        stop_process(process)
    try:
        code = process.wait(timeout=max(0.1, deadline - time.monotonic()))
    except subprocess.TimeoutExpired:
        stop_process(process)
        process.wait()
        failure = CollectionFailure("command-timeout", transient=True)
        code = -1
    finally:
        process.stdout.close()
        process.stderr.close()
    if failure:
        raise failure
    if code:
        # Match fixed classes in memory, never retain or print the provider text.
        message = bytes(output["stderr"]).decode("utf-8", errors="replace").lower()
        if re.search(
            r"\b(?:401|403)\b|unauthorized|forbidden|invalid token|authentication",
            message,
        ):
            raise CollectionFailure("provider-auth-rejected")
        transient = bool(
            re.search(
                r"\b(?:408|429|500|502|503|504)\b|timeout|timed out|econnreset|etimedout|fetch failed|temporarily unavailable",
                message,
            )
        )
        raise CollectionFailure(
            "provider-temporarily-unavailable"
            if transient
            else "provider-command-failed",
            transient=transient,
        )
    return bytes(output["stdout"])


def diagnostic(message: object) -> tuple | None:
    if not isinstance(message, str):
        return None
    try:
        data = json.loads(message, object_pairs_hook=unique_object)
    except (ValueError, RecursionError):
        return None
    required = {
        "event",
        "phase",
        "page_family",
        "source_family",
        "failure_kind",
        "elapsed_ms",
        "attempt_count",
    }
    if not isinstance(data, dict) or set(data) not in (
        required,
        required | {"upstream_status"},
    ):
        return None
    if any(
        type(data[key]) is not str
        for key in ("event", "phase", "page_family", "source_family", "failure_kind")
    ):
        return None
    if (
        data["event"] != "page_response_failure"
        or data["phase"] not in PHASES
        or data["page_family"] not in PAGE_FAMILIES
        or data["source_family"] not in SOURCE_FAMILIES
        or data["failure_kind"] not in FAILURE_KINDS
        or type(data["attempt_count"]) is not int
        or not 0 <= data["attempt_count"] <= 2
    ):
        return None
    elapsed = data["elapsed_ms"]
    status = data.get("upstream_status")
    if (
        type(elapsed) not in (int, float)
        or not math.isfinite(elapsed)
        or not 0 <= elapsed <= 300_000
    ):
        return None
    if status is not None and (type(status) is not int or not 100 <= status <= 599):
        return None
    bucket = TIMING_BUCKETS[
        next(
            (i for i, limit in enumerate((100, 1000, 5000, 10000)) if elapsed < limit),
            4,
        )
    ]
    return (
        data["phase"],
        data["page_family"],
        data["source_family"],
        data["failure_kind"],
        bucket,
        data["attempt_count"],
        status,
    )


def unique_object(pairs: list[tuple]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def request_family(path: str) -> str:
    # Values become only these fixed labels; never output a decoded or raw path.
    bare = path.split("?", 1)[0].lower()
    if bare in ADMIN_API_PATHS:
        return "admin-or-private"
    if any(
        part
        in {
            "admin",
            "auth",
            "ask",
            "confirm",
            "reset",
            "email-preferences",
            "unsubscribe",
            "comment-emails",
            "me",
            "account",
            "claim",
            "manage",
        }
        for part in bare.split("/")
    ):
        return "admin-or-private"
    if bare.startswith("/money/committees/"):
        return "committee-payments" if bare.endswith("/payments") else "committee"
    if bare.startswith("/bills/"):
        return "bill"
    if bare.startswith("/legislators/"):
        return "legislator"
    return "other"


def aggregate(raw: bytes, start: datetime, end: datetime) -> dict:
    if len(raw) > MAX_BYTES:
        raise CollectionFailure("command-output-limit")
    try:
        lines = [line for line in raw.decode("utf-8").splitlines() if line.strip()]
        rows = [json.loads(line, object_pairs_hook=unique_object) for line in lines]
    except (UnicodeError, ValueError, RecursionError):
        raise CollectionFailure("provider-shape-changed") from None
    if len(rows) > MAX_ROWS:
        raise CollectionFailure("provider-row-limit")
    report = empty_report(start, end, schema_version=1)
    report.update(
        collection_status="collected",
        rows_received=len(rows),
        saturated=len(rows) == MAX_ROWS,
    )
    report.pop("failure")
    statuses, minutes, classifications, unclassified = (
        Counter(),
        Counter(),
        Counter(),
        Counter(),
    )
    seen = set()
    for row in rows:
        if (
            not isinstance(row, dict)
            or any(
                type(row.get(key)) is not kind
                for key, kind in {
                    "id": str,
                    "timestamp": int,
                    "responseStatusCode": int,
                    "requestPath": str,
                    "logs": list,
                }.items()
            )
            or row.get("source") != "serverless"
            or row.get("environment") != "production"
            or not 500 <= row["responseStatusCode"] <= 599
        ):
            raise CollectionFailure("provider-shape-changed")
        if row["id"] in seen:
            continue
        seen.add(row["id"])
        timestamp = row["timestamp"]
        if not int(start.timestamp() * 1000) <= timestamp < int(end.timestamp() * 1000):
            continue
        minute = iso(
            datetime.fromtimestamp(timestamp / 1000, timezone.utc).replace(
                second=0, microsecond=0
            )
        )
        status = row["responseStatusCode"]
        statuses[status] += 1
        minutes[(minute, status)] += 1
        messages = [
            row.get("message") if row.get("messageTruncated") is not True else None
        ] + [
            entry.get("message")
            for entry in row["logs"]
            if isinstance(entry, dict) and entry.get("messageTruncated") is not True
        ]
        known = {
            value for message in messages if (value := diagnostic(message)) is not None
        }
        if len(known) == 1:
            classifications[(minute, *next(iter(known)))] += 1
        else:
            unclassified[(minute, request_family(row["requestPath"]))] += 1
    report.update(
        failures_count=sum(statuses.values()),
        unclassified_failures=sum(unclassified.values()),
        status_counts=[
            {"status": status, "count": count}
            for status, count in sorted(statuses.items())
        ],
        minutes=[
            {"minute": minute, "status": status, "count": count}
            for (minute, status), count in sorted(minutes.items())
        ],
        classifications=[
            dict(
                zip(
                    (
                        "minute",
                        "phase",
                        "page_family",
                        "source_family",
                        "failure_kind",
                        "timing_bucket",
                        "attempt_count",
                        "upstream_status",
                    ),
                    key,
                ),
                count=count,
            )
            for key, count in sorted(
                classifications.items(), key=lambda item: str(item[0])
            )
        ],
        unclassified_by_family=[
            {"minute": minute, "family": family, "count": count}
            for (minute, family), count in sorted(unclassified.items())
        ],
    )
    return report


def recovery_diagnostic(message: object) -> tuple | None:
    if not isinstance(message, str):
        return None
    try:
        data = json.loads(message, object_pairs_hook=unique_object)
    except (ValueError, RecursionError):
        return None
    if (
        not isinstance(data, dict)
        or set(data)
        != {
            "event",
            "source_family",
            "attempt_count",
            "winner_attempt",
            "trigger",
            "elapsed_ms",
        }
        or data["event"] != "page_read_recovery"
        or data["source_family"] != "committee-finance"
        or type(data["attempt_count"]) is not int
        or data["attempt_count"] != 2
        or type(data["winner_attempt"]) is not int
        or data["winner_attempt"] not in (1, 2)
        or not isinstance(data["trigger"], str)
        or data["trigger"] not in ("slow", "network", "http")
        or type(data["elapsed_ms"]) is not int
        or not 0 <= data["elapsed_ms"] <= 300_000
    ):
        return None
    bucket = TIMING_BUCKETS[
        next(
            (
                i
                for i, limit in enumerate((100, 1000, 5000, 10000))
                if data["elapsed_ms"] < limit
            ),
            4,
        )
    ]
    return data["winner_attempt"], data["trigger"], bucket


def aggregate_recoveries(raw: bytes, start: datetime, end: datetime) -> dict:
    if len(raw) > MAX_BYTES:
        raise CollectionFailure("command-output-limit")
    try:
        rows = [
            json.loads(line, object_pairs_hook=unique_object)
            for line in raw.decode("utf-8").splitlines()
            if line.strip()
        ]
    except (UnicodeError, ValueError, RecursionError):
        raise CollectionFailure("provider-shape-changed") from None
    if len(rows) > MAX_ROWS:
        raise CollectionFailure("provider-row-limit")
    report = empty_recovery_report()
    report.update(
        collection_status="collected",
        rows_received=len(rows),
        saturated=len(rows) == MAX_ROWS,
    )
    report.pop("failure")
    seen, classifications = set(), Counter()
    total = unclassified = 0
    for row in rows:
        if (
            not isinstance(row, dict)
            or any(
                type(row.get(key)) is not kind
                for key, kind in {
                    "id": str,
                    "timestamp": int,
                    "responseStatusCode": int,
                    "logs": list,
                }.items()
            )
            or row.get("source") != "serverless"
            or row.get("environment") != "production"
            or row["responseStatusCode"] != 200
        ):
            raise CollectionFailure("provider-shape-changed")
        if row["id"] in seen:
            continue
        seen.add(row["id"])
        timestamp = row["timestamp"]
        if not int(start.timestamp() * 1000) <= timestamp < int(end.timestamp() * 1000):
            continue
        total += 1
        messages = [
            row.get("message") if row.get("messageTruncated") is not True else None
        ] + [
            entry.get("message")
            for entry in row["logs"]
            if isinstance(entry, dict) and entry.get("messageTruncated") is not True
        ]
        known = {
            value
            for message in messages
            if (value := recovery_diagnostic(message)) is not None
        }
        if len(known) != 1:
            unclassified += 1
            continue
        minute = iso(
            datetime.fromtimestamp(timestamp / 1000, timezone.utc).replace(
                second=0, microsecond=0
            )
        )
        classifications[(minute, *next(iter(known)))] += 1
    report.update(
        recoveries_count=total - unclassified,
        unclassified_matches=unclassified,
        classifications=[
            dict(
                zip(("minute", "winner_attempt", "trigger", "timing_bucket"), key),
                count=count,
            )
            for key, count in sorted(classifications.items())
        ],
    )
    return report


def collect(cli: str, now: datetime) -> tuple[dict, int]:
    start, end = complete_hour(now)
    report = empty_report(start, end)
    credentials = [
        os.environ.get(name)
        for name in ("VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID")
    ]
    if not all(credentials):
        report["failure"] = "provider-credentials-missing"
        report["recovery_collection"]["failure"] = "provider-credentials-missing"
        return report, 1
    token, org, project = credentials
    command = [
        cli,
        "logs",
        "--project",
        project,
        "--scope",
        org,
        "--token",
        token,
        "--environment",
        "production",
        "--no-branch",
        "--source",
        "serverless",
        "--since",
        iso(start),
        "--until",
        iso(end),
        "--json",
        "--limit",
        str(MAX_ROWS),
        "--non-interactive",
    ]

    def channel(filters, initial, parser):
        for attempt in range(1, 3):
            initial["attempt_count"] = attempt
            try:
                result = parser(run_command(command + filters), start, end)
                result["attempt_count"] = attempt
                return result, 0
            except CollectionFailure as error:
                initial["failure"] = str(error)
                if error.transient and attempt == 1:
                    continue
                return initial, 0 if error.transient else 1
        return initial, 1

    failures, failure_code = channel(
        ["--status-code", "5xx"], empty_report(start, end, schema_version=1), aggregate
    )
    # Server-side filtering is essential: do not enumerate every successful request.
    recoveries, recovery_code = channel(
        ["--status-code", "200", "--query", "page_read_recovery"],
        empty_recovery_report(),
        aggregate_recoveries,
    )
    report = {**failures, "schema_version": 2, "recovery_collection": recoveries}
    return report, max(failure_code, recovery_code)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", default="vercel")
    parser.add_argument("--output", type=Path, default=Path("page-failure-health.json"))
    args = parser.parse_args(argv)
    now = datetime.now(timezone.utc)
    try:
        report, code = collect(args.cli, now)
    except Exception:
        report = empty_report(*complete_hour(now))
        report["failure"] = "unexpected-collection-failure"
        code = 1
    args.output.write_text(
        json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"Page failure collection: {report['collection_status']}")
    print(
        f"Page recovery collection: {report['recovery_collection']['collection_status']}"
    )
    return code


if __name__ == "__main__":
    raise SystemExit(main())
