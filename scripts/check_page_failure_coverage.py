#!/usr/bin/env python3
"""Check 24 eligible hourly aggregates without retaining provider or API text."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zipfile import BadZipFile, ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import collect_page_failure_health as health  # noqa: E402

REPOSITORY = "alethical-org/alethical"
WORKFLOW_PATH = ".github/workflows/page-failure-health.yml"
API_ROOT = f"https://api.github.com/repos/{REPOSITORY}"
MAX_ARTIFACTS = 24
MAX_REQUESTS = 76
TOTAL_SECONDS = 180
MAX_JSON_BYTES = 1024 * 1024
MAX_ZIP_BYTES = 1024 * 1024
MAX_REPORT_BYTES = 64 * 1024
FAILURES = {
    "collection-not-started",
    "provider-credentials-missing",
    "command-unavailable",
    "command-timeout",
    "command-output-limit",
    "provider-auth-rejected",
    "provider-temporarily-unavailable",
    "provider-command-failed",
    "provider-shape-changed",
    "provider-row-limit",
    "unexpected-collection-failure",
}
FAMILIES = {
    "admin-or-private",
    "committee",
    "committee-payments",
    "bill",
    "legislator",
    "other",
}


class CoverageFailure(Exception):
    """Only fixed local reasons may reach saved evidence."""


def timestamp(value: object) -> datetime:
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value
    ):
        raise CoverageFailure("aggregate-shape-invalid")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise CoverageFailure("aggregate-shape-invalid") from None


def number(value: object, low: int = 0, high: int = 100) -> bool:
    return type(value) is int and low <= value <= high


def strict_json(raw: bytes) -> object:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate")
            result[key] = value
        return result

    try:
        return json.loads(raw, object_pairs_hook=unique)
    except (ValueError, UnicodeError, RecursionError):
        raise CoverageFailure("aggregate-shape-invalid") from None


def validate_report(report: object) -> tuple[datetime, str]:
    """Validate every public field before using any artifact as coverage."""
    expected = set(
        health.empty_report(
            *health.complete_hour(datetime.now(timezone.utc)), schema_version=1
        )
    )
    if not isinstance(report, dict) or report.get("collection_status") not in (
        "collected",
        "failed",
    ):
        raise CoverageFailure("aggregate-shape-invalid")
    version = report.get("schema_version")
    if type(version) is not int or version not in (1, 2):
        raise CoverageFailure("aggregate-shape-invalid")
    if version == 2:
        expected.add("recovery_collection")
    collected = report["collection_status"] == "collected"
    if set(report) != (expected - {"failure"} if collected else expected):
        raise CoverageFailure("aggregate-shape-invalid")
    window = report["window"]
    if not isinstance(window, dict) or set(window) != {"start", "end"}:
        raise CoverageFailure("aggregate-shape-invalid")
    start, end = timestamp(window["start"]), timestamp(window["end"])
    if start.minute or start.second or end - start != timedelta(hours=1):
        raise CoverageFailure("aggregate-shape-invalid")
    if (
        type(report["schema_version"]) is not int
        or report["schema_version"] not in (1, 2)
        or type(report["limit"]) is not int
        or report["limit"] != 100
        or not number(report["attempt_count"], 0, 2)
        or any(
            not number(report[key])
            for key in ("rows_received", "failures_count", "unclassified_failures")
        )
        or type(report["saturated"]) is not bool
        or report["failures_count"] > report["rows_received"]
        or report["saturated"] != (report["rows_received"] == 100)
    ):
        raise CoverageFailure("aggregate-shape-invalid")
    if not collected and (
        not isinstance(report["failure"], str) or report["failure"] not in FAILURES
    ):
        raise CoverageFailure("aggregate-shape-invalid")
    sums = {}
    for field in (
        "status_counts",
        "minutes",
        "classifications",
        "unclassified_by_family",
    ):
        entries = report[field]
        if not isinstance(entries, list) or len(entries) > 100:
            raise CoverageFailure("aggregate-shape-invalid")
        seen, total = set(), 0
        for entry in entries:
            keys = {
                "status_counts": {"status", "count"},
                "minutes": {"minute", "status", "count"},
                "classifications": {
                    "minute",
                    "phase",
                    "page_family",
                    "source_family",
                    "failure_kind",
                    "timing_bucket",
                    "attempt_count",
                    "upstream_status",
                    "count",
                },
                "unclassified_by_family": {"minute", "family", "count"},
            }[field]
            if (
                not isinstance(entry, dict)
                or set(entry) != keys
                or not number(entry["count"], 1)
            ):
                raise CoverageFailure("aggregate-shape-invalid")
            if "minute" in entry:
                minute = timestamp(entry["minute"])
                if minute.second or not start <= minute < end:
                    raise CoverageFailure("aggregate-shape-invalid")
            if "status" in entry and not number(entry["status"], 500, 599):
                raise CoverageFailure("aggregate-shape-invalid")
            if field == "classifications":
                for key, values in (
                    ("phase", health.PHASES),
                    ("page_family", health.PAGE_FAMILIES),
                    ("source_family", health.SOURCE_FAMILIES),
                    ("failure_kind", health.FAILURE_KINDS),
                    ("timing_bucket", health.TIMING_BUCKETS),
                ):
                    if not isinstance(entry[key], str) or entry[key] not in values:
                        raise CoverageFailure("aggregate-shape-invalid")
                if not number(entry["attempt_count"], 0, 2) or (
                    entry["upstream_status"] is not None
                    and not number(entry["upstream_status"], 100, 599)
                ):
                    raise CoverageFailure("aggregate-shape-invalid")
            if field == "unclassified_by_family" and (
                not isinstance(entry["family"], str) or entry["family"] not in FAMILIES
            ):
                raise CoverageFailure("aggregate-shape-invalid")
            identity = tuple((key, entry[key]) for key in sorted(keys - {"count"}))
            if identity in seen:
                raise CoverageFailure("aggregate-shape-invalid")
            seen.add(identity)
            total += entry["count"]
        sums[field] = total
    if (
        sums["status_counts"] != report["failures_count"]
        or sums["minutes"] != report["failures_count"]
        or sums["unclassified_by_family"] != report["unclassified_failures"]
        or sums["classifications"] + sums["unclassified_by_family"]
        != report["failures_count"]
        or (not collected and (report["rows_received"] or report["failures_count"]))
    ):
        raise CoverageFailure("aggregate-shape-invalid")
    state = "saturated" if report["saturated"] else report["collection_status"]
    if version == 2:
        recovery_state = validate_recovery_report(
            report["recovery_collection"], start, end
        )
        if recovery_state == "saturated" or state == "saturated":
            state = "saturated"
        elif recovery_state == "failed":
            state = "failed"
    return start, state


def validate_recovery_report(report: object, start: datetime, end: datetime) -> str:
    expected = set(health.empty_recovery_report())
    if not isinstance(report, dict) or report.get("collection_status") not in (
        "collected",
        "failed",
    ):
        raise CoverageFailure("aggregate-shape-invalid")
    collected = report["collection_status"] == "collected"
    if set(report) != (expected - {"failure"} if collected else expected):
        raise CoverageFailure("aggregate-shape-invalid")
    if (
        not number(report["limit"], 100, 100)
        or not number(report["attempt_count"], 0, 2)
        or any(
            not number(report[key])
            for key in ("rows_received", "recoveries_count", "unclassified_matches")
        )
        or type(report["saturated"]) is not bool
        or report["saturated"] != (report["rows_received"] == 100)
        or report["recoveries_count"] + report["unclassified_matches"]
        > report["rows_received"]
        or not isinstance(report["classifications"], list)
        or len(report["classifications"]) > 100
    ):
        raise CoverageFailure("aggregate-shape-invalid")
    if not collected and (
        not isinstance(report["failure"], str)
        or report["failure"] not in FAILURES
        or report["rows_received"]
        or report["recoveries_count"]
        or report["unclassified_matches"]
    ):
        raise CoverageFailure("aggregate-shape-invalid")
    total, seen = 0, set()
    for entry in report["classifications"]:
        if (
            not isinstance(entry, dict)
            or set(entry)
            != {"minute", "winner_attempt", "trigger", "timing_bucket", "count"}
            or not number(entry["winner_attempt"], 1, 2)
            or not isinstance(entry["trigger"], str)
            or entry["trigger"] not in ("slow", "network", "http")
            or not isinstance(entry["timing_bucket"], str)
            or entry["timing_bucket"] not in health.TIMING_BUCKETS
            or not number(entry["count"], 1)
        ):
            raise CoverageFailure("aggregate-shape-invalid")
        minute = timestamp(entry["minute"])
        if minute.second or not start <= minute < end:
            raise CoverageFailure("aggregate-shape-invalid")
        identity = tuple(
            entry[key]
            for key in ("minute", "winner_attempt", "trigger", "timing_bucket")
        )
        if identity in seen:
            raise CoverageFailure("aggregate-shape-invalid")
        seen.add(identity)
        total += entry["count"]
    if total != report["recoveries_count"]:
        raise CoverageFailure("aggregate-shape-invalid")
    # A matching request without a usable event leaves the recovery count unknown.
    return (
        "saturated"
        if report["saturated"]
        else "failed"
        if report["unclassified_matches"]
        else report["collection_status"]
    )


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHub:
    def __init__(self, token: str):
        self.token = token
        self.deadline = time.monotonic() + TOTAL_SECONDS
        self.requests = 0
        self.opener = build_opener(NoRedirect)

    def fetch(
        self, url: str, cap: int, *, authenticated: bool = True, redirect: bool = False
    ):
        self.requests += 1
        remaining = self.deadline - time.monotonic()
        if self.requests > MAX_REQUESTS or remaining <= 0:
            raise CoverageFailure("github-request-budget")
        parsed = urlsplit(url)
        storage_host = bool(
            parsed.hostname
            and (
                parsed.hostname.endswith(".blob.core.windows.net")
                or parsed.hostname.endswith(".actions.githubusercontent.com")
            )
        )
        if (
            parsed.scheme != "https"
            or parsed.username
            or parsed.password
            or parsed.port not in (None, 443)
            or parsed.fragment
            or (authenticated and parsed.hostname != "api.github.com")
            or (not authenticated and not storage_host)
        ):
            raise CoverageFailure("github-download-address-invalid")
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "alethical-page-failure-coverage",
        }
        if authenticated:
            headers["Authorization"] = f"Bearer {self.token}"
        try:
            with self.opener.open(
                Request(url, headers=headers), timeout=min(10, remaining)
            ) as response:
                raw = response.read(cap + 1)
                if len(raw) > cap:
                    raise CoverageFailure("github-response-limit")
                return raw
        except HTTPError as error:
            if redirect and error.code == 302:
                location = error.headers.get("Location")
                error.close()
                if not isinstance(location, str):
                    raise CoverageFailure("github-download-address-invalid")
                # The signed address comes from GitHub's authenticated endpoint.
                # Never forward the GitHub token to that storage service.
                return self.fetch(location, cap, authenticated=False)
            code = error.code
            error.close()
            raise CoverageFailure(
                "github-auth-rejected" if code in (401, 403) else "github-read-failed"
            ) from None
        except (URLError, TimeoutError, OSError, ValueError):
            raise CoverageFailure("github-read-failed") from None

    def json(self, suffix: str):
        return strict_json(self.fetch(API_ROOT + suffix, MAX_JSON_BYTES))

    def artifact(self, artifact_id: int):
        raw = self.fetch(
            API_ROOT + f"/actions/artifacts/{artifact_id}/zip",
            MAX_ZIP_BYTES,
            redirect=True,
        )
        try:
            with ZipFile(BytesIO(raw)) as archive:
                entries = archive.infolist()
                if (
                    len(entries) != 1
                    or entries[0].filename != "page-failure-health.json"
                    or entries[0].file_size > MAX_REPORT_BYTES
                    or entries[0].flag_bits & 1
                ):
                    raise CoverageFailure("aggregate-archive-invalid")
                with archive.open(entries[0]) as content:
                    body = content.read(MAX_REPORT_BYTES + 1)
                if len(body) > MAX_REPORT_BYTES:
                    raise CoverageFailure("aggregate-archive-invalid")
                return strict_json(body)
        except (BadZipFile, RuntimeError, OSError, NotImplementedError):
            raise CoverageFailure("aggregate-archive-invalid") from None


def expected_windows(now: datetime, activation: datetime) -> list[datetime]:
    # Daily 17:17 runs before the hourly 17:43 collector. The newest completed
    # hour therefore gets a full extra hour before it can count as missing.
    cutoff = health.complete_hour(now)[1] - timedelta(hours=1)
    return [
        start
        for i in range(24)
        if (start := cutoff - timedelta(hours=24 - i)) >= activation
    ]


def coverage(client: GitHub, now: datetime) -> tuple[dict, int]:
    workflow = client.json("/actions/workflows/page-failure-health.yml")
    if (
        not isinstance(workflow, dict)
        or not number(workflow.get("id"), 1, 10**15)
        or workflow.get("path") != WORKFLOW_PATH
        or workflow.get("state") != "active"
    ):
        raise CoverageFailure("collector-workflow-invalid")
    activation = timestamp(workflow.get("created_at"))
    windows = expected_windows(now, activation)
    query = urlencode(
        {
            "branch": "main",
            "per_page": 100,
            "created": ">=" + health.iso(now - timedelta(hours=27)),
        }
    )
    listing = client.json(f"/actions/workflows/{workflow['id']}/runs?{query}")
    if (
        not isinstance(listing, dict)
        or not isinstance(listing.get("workflow_runs"), list)
        or len(listing["workflow_runs"]) > 100
    ):
        raise CoverageFailure("github-run-shape-invalid")
    trusted = []
    for run in listing["workflow_runs"]:
        if not isinstance(run, dict):
            raise CoverageFailure("github-run-shape-invalid")
        if (
            run.get("workflow_id") == workflow["id"]
            and run.get("head_branch") == "main"
            and run.get("event") in ("schedule", "workflow_dispatch")
            and isinstance(run.get("repository"), dict)
            and run["repository"].get("full_name") == REPOSITORY
            and isinstance(run.get("head_repository"), dict)
            and run["head_repository"].get("full_name") == REPOSITORY
        ):
            if (
                not number(run.get("id"), 1, 10**15)
                or not number(run.get("run_attempt"), 1, 10**6)
                or not isinstance(run.get("head_sha"), str)
                or not re.fullmatch(r"[a-f0-9]{40}", run["head_sha"])
            ):
                raise CoverageFailure("github-run-shape-invalid")
            trusted.append(run)
    trusted.sort(key=lambda run: timestamp(run.get("run_started_at")), reverse=True)
    observed, sampled_hours, downloaded = {}, set(), 0
    failure_only_hours = recovery_collected_hours = 0
    for run in trusted:
        predicted = health.complete_hour(timestamp(run["run_started_at"]))[0]
        if predicted not in windows or predicted in sampled_hours:
            continue
        listing = client.json(f"/actions/runs/{run['id']}/artifacts?per_page=10")
        if (
            not isinstance(listing, dict)
            or not isinstance(listing.get("artifacts"), list)
            or not number(listing.get("total_count"), 0, 10)
        ):
            raise CoverageFailure("github-artifact-shape-invalid")
        named = [
            artifact
            for artifact in listing["artifacts"]
            if isinstance(artifact, dict)
            and artifact.get("name")
            == f"page-failure-health-{run['id']}-{run['run_attempt']}"
        ]
        if not named:
            continue
        if len(named) != 1:
            raise CoverageFailure("github-artifact-shape-invalid")
        artifact = named[0]
        attribution = artifact.get("workflow_run")
        if (
            artifact.get("expired") is not False
            or not number(artifact.get("id"), 1, 10**15)
            or not number(artifact.get("size_in_bytes"), 1, MAX_ZIP_BYTES)
            or not isinstance(attribution, dict)
            or attribution.get("id") != run["id"]
            or attribution.get("head_branch") != "main"
            or attribution.get("head_sha") != run["head_sha"]
        ):
            raise CoverageFailure("github-artifact-attribution-invalid")
        if downloaded >= MAX_ARTIFACTS:
            break
        downloaded += 1
        aggregate = client.artifact(artifact["id"])
        start, status = validate_report(aggregate)
        # Setup may cross an hour boundary. Accept only a window whose end fell
        # during this trusted run, and which is part of the eligible day.
        began = timestamp(run["run_started_at"])
        ended = timestamp(run["updated_at"])
        if not began.replace(minute=0, second=0) <= start + timedelta(hours=1) <= ended:
            raise CoverageFailure("aggregate-run-window-invalid")
        if start in windows and start not in observed:
            observed[start] = status
            sampled_hours.add(start)
            if aggregate["schema_version"] == 1:
                failure_only_hours += 1
            elif (
                validate_recovery_report(
                    aggregate["recovery_collection"], start, start + timedelta(hours=1)
                )
                == "collected"
            ):
                recovery_collected_hours += 1
    counts = {
        state: sum(observed.get(window, "missing") == state for window in windows)
        for state in ("collected", "failed", "saturated", "missing")
    }
    warmup = now - activation < timedelta(hours=24)
    gaps = counts["failed"] + counts["missing"]
    status = (
        "failed"
        if counts["saturated"]
        else "warmup"
        if warmup
        else "failed"
        if gaps >= 3
        else "passed"
    )
    return {
        "schema_version": 2,
        "coverage_status": status,
        "activation": health.iso(activation),
        "eligible_end": health.iso(health.complete_hour(now)[1] - timedelta(hours=1)),
        "expected_hours": len(windows),
        "collected_hours": counts["collected"],
        "failed_hours": counts["failed"],
        "saturated_hours": counts["saturated"],
        "missing_hours": counts["missing"],
        "artifacts_read": downloaded,
        "failure_only_hours": failure_only_hours,
        "recovery_collected_hours": recovery_collected_hours,
        "failure_threshold": 3,
        "saturation_threshold": 1,
    }, 1 if status == "failed" else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=Path("page-failure-coverage.json")
    )
    args = parser.parse_args(argv)
    try:
        token = os.environ.get("GH_TOKEN")
        if not token:
            raise CoverageFailure("github-credentials-missing")
        report, code = coverage(GitHub(token), datetime.now(timezone.utc))
    except Exception as error:
        allowed = {
            "aggregate-shape-invalid",
            "github-request-budget",
            "github-download-address-invalid",
            "github-response-limit",
            "github-auth-rejected",
            "github-read-failed",
            "aggregate-archive-invalid",
            "collector-workflow-invalid",
            "github-run-shape-invalid",
            "github-artifact-shape-invalid",
            "github-artifact-attribution-invalid",
            "aggregate-run-window-invalid",
            "github-credentials-missing",
        }
        reason = (
            str(error)
            if isinstance(error, CoverageFailure) and str(error) in allowed
            else "unexpected-coverage-failure"
        )
        report, code = (
            {"schema_version": 1, "coverage_status": "failed", "failure": reason},
            1,
        )
    args.output.write_text(json.dumps(report, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Page failure coverage: {report['coverage_status']}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
