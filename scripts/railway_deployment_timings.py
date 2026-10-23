#!/usr/bin/env python3
"""Read selected Railway deployment event times, without logs or settings values."""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENDPOINT = "https://backboard.railway.com/graphql/v2"
TOKEN_QUERY = """query TimingScope {
  projectToken { project { id name } environment { id name } }
}"""
SERVICE_QUERY = """query TimingService($id: String!) {
  project(id: $id) { services(first: 100) {
    edges { node { id name } } pageInfo { hasNextPage }
  } }
}"""
DEPLOYMENT_FIELDS = "id projectId environmentId serviceId createdAt status"
LATEST_QUERY = (
    """query LatestTiming($environmentId: String!, $serviceId: String!) {
  serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
    latestDeployment { %s }
  }
}"""
    % DEPLOYMENT_FIELDS
)
DEPLOYMENT_QUERY = (
    """query NamedTiming($id: String!) {
  deployment(id: $id) { %s }
}"""
    % DEPLOYMENT_FIELDS
)
EVENTS_QUERY = """query TimingEvents($id: String!, $after: String) {
  deploymentEvents(id: $id, first: 100, after: $after) {
    edges { node {
      id step createdAt completedAt
      payload { durationMs attempt maxAttempts skipped }
    } }
    pageInfo { hasNextPage endCursor }
  }
}"""
STEPS = {
    "WAIT_FOR_DEPENDENCIES": "dependency waiting",
    "BUILD_IMAGE": "build",
    "PUBLISH_IMAGE": "image upload",
    "PRE_DEPLOY_COMMAND": "before-deploy command",
    "CREATE_CONTAINER": "container creation",
    "HEALTHCHECK": "readiness check",
    "SNAPSHOT_CODE": "source snapshot",
    "CONFIGURE_NETWORK": "network setup",
    "MIGRATE_VOLUMES": "volume migration",
    "DRAIN_INSTANCES": "old instance draining",
}


class TimingError(Exception):
    """A safe-to-print failure without provider response text."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise TimingError("Railway request redirected; no credentials forwarded")


def response_data(value):
    if (
        not isinstance(value, dict)
        or value.get("errors")
        or not isinstance(value.get("data"), dict)
    ):
        raise TimingError("Railway query failed; response text withheld")
    return value["data"]


class API:
    def __init__(self, token):
        if not token:
            raise TimingError("RAILWAY_TOKEN is missing")
        self.token = token

    def __call__(self, query, variables):
        request = urllib.request.Request(
            ENDPOINT,
            data=json.dumps({"query": query, "variables": variables}).encode(),
            headers={
                "Content-Type": "application/json",
                "Project-Access-Token": self.token,
                "User-Agent": "alethical-railway-timings/1",
            },
            method="POST",
        )
        try:
            with urllib.request.build_opener(NoRedirect()).open(
                request, timeout=30
            ) as response:
                raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise TimingError("Railway response exceeded the read limit")
            return response_data(json.loads(raw))
        except urllib.error.HTTPError as exc:
            raise TimingError(
                f"Railway request failed (HTTP {exc.code}); response text withheld; retry later"
            ) from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise TimingError(
                "Railway request failed; response text withheld; retry later"
            ) from None


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else None
    except ValueError:
        return None


def event_row(event):
    payload = event.get("payload") or {}
    start, end = timestamp(event.get("createdAt")), timestamp(event.get("completedAt"))
    elapsed = None
    if payload.get("skipped") is True:
        state = "skipped"
    elif event.get("completedAt") is None:
        state = "unfinished"
    elif start is None or end is None or end < start:
        state = "invalid_time"
    else:
        state = "measured"
        elapsed = (end - start).total_seconds()
    return {
        "id": event["id"],
        "step": event["step"],
        "phase": STEPS.get(event["step"], "other"),
        "created_at": event.get("createdAt"),
        "completed_at": event.get("completedAt"),
        "elapsed_seconds": elapsed,
        "timing_state": state,
        "reported_duration_ms": payload.get("durationMs"),
        "attempt": payload.get("attempt"),
        "max_attempts": payload.get("maxAttempts"),
        "skipped": payload.get("skipped"),
    }


def collect(api, deployment_id=""):
    scope = api(TOKEN_QUERY, {})["projectToken"]
    project, environment = scope["project"], scope["environment"]
    if project["name"] != "alethical" or environment["name"] != "production":
        raise TimingError("Railway token does not target Alethical production")
    service_page = api(SERVICE_QUERY, {"id": project["id"]})["project"]["services"]
    if service_page["pageInfo"]["hasNextPage"] is not False:
        raise TimingError("Service inventory exceeded the read limit")
    edges = service_page["edges"]
    services = [
        edge["node"] for edge in edges if edge["node"]["name"] == "alethical-api"
    ]
    if len(services) != 1:
        raise TimingError("Expected exactly one production API service")
    expected = {
        "projectId": project["id"],
        "environmentId": environment["id"],
        "serviceId": services[0]["id"],
    }
    if deployment_id:
        deployment = api(DEPLOYMENT_QUERY, {"id": deployment_id})["deployment"]
    else:
        deployment = api(
            LATEST_QUERY, {key: expected[key] for key in ("environmentId", "serviceId")}
        )["serviceInstance"]["latestDeployment"]
    if not deployment or any(
        deployment.get(key) != value for key, value in expected.items()
    ):
        raise TimingError("Deployment does not belong to the production API")
    if deployment_id and deployment["id"] != deployment_id:
        raise TimingError("Railway returned a different deployment")
    rows, seen, cursors = [], set(), set()
    after = None
    for _ in range(10):
        page = api(EVENTS_QUERY, {"id": deployment["id"], "after": after})[
            "deploymentEvents"
        ]
        for edge in page["edges"]:
            event = edge["node"]
            if event["id"] in seen:
                raise TimingError(
                    "Repeated event identity; timing inventory is incomplete"
                )
            seen.add(event["id"])
            rows.append(event_row(event))
        info = page["pageInfo"]
        if info["hasNextPage"] is False:
            break
        after = info["endCursor"]
        if not after or after in cursors:
            raise TimingError("Event pagination did not advance")
        cursors.add(after)
    else:
        raise TimingError(
            "Event pagination exceeded the read limit; timing inventory is incomplete"
        )
    return {
        "schema_version": 1,
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "deployment": {key: deployment.get(key) for key in DEPLOYMENT_FIELDS.split()},
        "events": rows,
        "unobserved_steps": sorted(set(STEPS) - {row["step"] for row in rows}),
        "first_public_readiness_at": None,
        "limits": [
            "Event durations may overlap; they are not summed into deployment wall time.",
            "Dependency waiting excludes any unreported queue or approval wait.",
            "Before-deploy time does not isolate database migration time; effective commands are not read.",
            "Container creation is not exact application startup time.",
            "Healthcheck events do not establish the first successful public readiness response.",
            "Missing steps, unfinished events and skipped events are not zero-duration work.",
            "Events may change during pagination; provider-omitted history is not detectable and this is not an atomic snapshot.",
            "No commit is inferred from deployment dates or untyped metadata.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--deployment", default="")
    args = parser.parse_args()
    try:
        report = collect(API(os.environ.get("RAILWAY_TOKEN", "")), args.deployment)
        Path(args.output).write_text(json.dumps(report, indent=2) + "\n")
    except TimingError as exc:
        print(f"Railway timing unavailable: {exc}")
        return 1
    except (KeyError, TypeError, AttributeError, OSError):
        print(
            "Railway timing unavailable: missing access, unexpected response, or incomplete events. No provider response text retained."
        )
        return 1
    print(
        f"Retained {len(report['events'])} deployment events; unobserved phases remain unknown."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
