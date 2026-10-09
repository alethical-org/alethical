"""One-shot Railway reads with an allowlisted report; never print raw service data."""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path

API = "https://backboard.railway.com/graphql/v2"
ROOT = Path(__file__).resolve().parents[1]
CAPACITY_PREFIX = "ADDRESS_COPY_CAPACITY "
MEASUREMENTS = (
    "MEMORY_USAGE_GB",
    "MEMORY_LIMIT_GB",
    "EPHEMERAL_DISK_USAGE_GB",
    "CPU_USAGE",
    "NETWORK_RX_GB",
    "NETWORK_TX_GB",
)
IDENTITY = """query CapacityIdentity {
  projectToken {
    project { id name services { edges { node { id name } } } }
    environment { id name }
  }
}"""
PLAN = """query CapacityPlan($projectId: String!) {
  project(id: $projectId) { subscriptionType }
}"""
SERVICE = """query CapacityService($environmentId: String!, $serviceId: String!) {
  serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
    numReplicas startCommand
    activeDeployments { id status instances { id status } }
  }
}"""
METRICS = """query CapacityMetrics(
  $environmentId: String!, $serviceId: String!, $startDate: DateTime!,
  $endDate: DateTime!, $measurements: [MetricMeasurement!]!
) {
  metrics(environmentId: $environmentId, serviceId: $serviceId,
    startDate: $startDate, endDate: $endDate, sampleRateSeconds: 60,
    groupBy: [DEPLOYMENT_INSTANCE_ID], measurements: $measurements) {
    measurement tags { deploymentId deploymentInstanceId }
    values { ts value }
  }
}"""


class Unavailable(Exception):
    """A deliberately detail-free failure safe to handle without printing it."""


def query(token: str, statement: str, variables: dict) -> dict:
    request = urllib.request.Request(
        API,
        data=json.dumps({"query": statement, "variables": variables}).encode(),
        headers={
            "Project-Access-Token": token,
            "Content-Type": "application/json",
            "User-Agent": "alethical-address-copy-capacity/1",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise Unavailable
        result = json.loads(raw)
        if not isinstance(result, dict) or result.get("errors"):
            raise Unavailable
        data = result.get("data")
        if not isinstance(data, dict):
            raise Unavailable
        return data
    except Exception:
        raise Unavailable from None


def resource_id(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(
        r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", value
    ):
        raise Unavailable
    return value


def identity(data: dict) -> dict:
    try:
        token = data["projectToken"]
        project, environment = token["project"], token["environment"]
        if project["name"] != "alethical" or environment["name"] != "production":
            raise Unavailable
        matches = [
            edge["node"]
            for edge in project["services"]["edges"]
            if edge["node"]["name"] == "alethical-api"
        ]
        if len(matches) != 1:
            raise Unavailable
        return {
            "projectId": resource_id(project["id"]),
            "environmentId": resource_id(environment["id"]),
            "serviceId": resource_id(matches[0]["id"]),
        }
    except (KeyError, TypeError, Unavailable):
        raise Unavailable from None


def number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0 or value > 10**16:
        return None
    return float(value)


def service_report(data: dict, expected_command: str) -> dict:
    instance = data.get("serviceInstance")
    if not isinstance(instance, dict):
        raise Unavailable
    replicas = instance.get("numReplicas")
    result = {
        "configured_replicas": replicas
        if type(replicas) is int and 0 <= replicas <= 1000
        else None,
        "dashboard_start_command_matches_repository": instance.get("startCommand")
        == expected_command,
        "active_deployments": [],
    }
    for deployment in instance.get("activeDeployments") or []:
        # Read only IDs, not private deployment metadata or command strings.
        deployment_id = resource_id(deployment.get("id"))
        instances = [
            resource_id(row.get("id"))
            for row in deployment.get("instances", [])
            if row.get("status") == "RUNNING"
        ]
        result["active_deployments"].append(
            {"id": deployment_id, "running_instance_ids": instances}
        )
    return result


def metric_report(data: dict, active_ids: set[str]) -> list[dict]:
    series = data.get("metrics")
    if not isinstance(series, list):
        raise Unavailable
    report = []
    for instance_id in sorted(active_ids):
        measurements = {}
        for measurement in MEASUREMENTS:
            points = []
            for row in series:
                if not isinstance(row, dict) or row.get("measurement") != measurement:
                    continue
                tags = row.get("tags") or {}
                if (
                    not isinstance(tags, dict)
                    or tags.get("deploymentInstanceId") != instance_id
                ):
                    continue
                for point in row.get("values") or []:
                    if not isinstance(point, dict):
                        continue
                    timestamp, value = (
                        number(point.get("ts")),
                        number(point.get("value")),
                    )
                    if timestamp is not None and value is not None:
                        points.append((timestamp, value))
            if not points:
                measurements[measurement] = None
                continue
            points.sort()
            measurements[measurement] = {
                "latest_timestamp": points[-1][0],
                "latest": points[-1][1],
                "maximum": max(point[1] for point in points),
                "sample_count": len(points),
            }
        report.append({"instance_id": instance_id, "measurements": measurements})
    return report


def capacity_record(raw: bytes) -> dict | None:
    """Discard every ordinary log line and every unknown field before reporting."""
    latest = None
    for line in raw.splitlines():
        try:
            envelope = json.loads(line)
            message = envelope.get("message")
            if not isinstance(message, str) or not message.startswith(CAPACITY_PREFIX):
                continue
            record = json.loads(message[len(CAPACITY_PREFIX) :])
            if type(record.get("enabled")) is not bool:
                continue
            safe = {"enabled": record["enabled"]}
            for key in ("free_bytes", "cgroup_current_bytes", "api_process_count"):
                value = record.get(key)
                if value is not None and (
                    type(value) is not int or value < 0 or value > 10**16
                ):
                    raise ValueError
                safe[key] = value
            maximum = record.get("cgroup_max_bytes")
            if (
                maximum is not None
                and maximum != "max"
                and (type(maximum) is not int or maximum < 0 or maximum > 10**16)
            ):
                continue
            safe["cgroup_max_bytes"] = maximum
            # Railway timestamps may be strings. Normalize them; never echo arbitrary text.
            timestamp = envelope.get("timestamp")
            if isinstance(timestamp, str):
                safe["recorded_at"] = (
                    datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                    .astimezone(UTC)
                    .isoformat()
                )
            latest = safe
        except (ValueError, TypeError, AttributeError, OverflowError):
            continue
    return latest


def deployment_capacity(ids: dict, deployment_id: str) -> dict | None:
    # Both output streams remain private in Python memory. Never echo CLI errors.
    command = [
        "npx",
        "--yes",
        "@railway/cli@5.41.2",
        "logs",
        deployment_id,
        "--project",
        ids["projectId"],
        "--environment",
        ids["environmentId"],
        "--service",
        ids["serviceId"],
        "--deployment",
        "--json",
        "--lines",
        "100",
        "--filter",
        '"' + CAPACITY_PREFIX.strip() + '"',
    ]
    try:
        process = subprocess.run(command, capture_output=True, timeout=90, check=False)
        if process.returncode != 0 or len(process.stdout) > 2_000_000:
            return None
        return capacity_record(process.stdout)
    except (OSError, subprocess.SubprocessError):
        return None


def collect(token: str) -> dict:
    ids = identity(query(token, IDENTITY, {}))
    report = {
        "identity": {
            "project": "alethical",
            "environment": "production",
            "service": "alethical-api",
            **ids,
        }
    }
    try:
        plan = query(token, PLAN, {"projectId": ids["projectId"]})["project"].get(
            "subscriptionType"
        )
        report["plan"] = plan if plan in {"free", "trial", "hobby", "pro"} else None
    except (Unavailable, KeyError, TypeError):
        report["plan"] = None
    arguments = {key: ids[key] for key in ("environmentId", "serviceId")}
    expected = json.loads((ROOT / "railway.json").read_text())["deploy"]["startCommand"]
    try:
        report["service"] = service_report(query(token, SERVICE, arguments), expected)
    except (Unavailable, TypeError, AttributeError):
        report["service"] = None
    deployments = (report.get("service") or {}).get("active_deployments", [])
    active_ids = {
        instance for row in deployments for instance in row["running_instance_ids"]
    }
    end = datetime.now(UTC)
    start = end - timedelta(hours=24)
    report["metrics_window"] = {"start": start.isoformat(), "end": end.isoformat()}
    try:
        data = query(
            token,
            METRICS,
            {
                **arguments,
                "startDate": start.isoformat(),
                "endDate": end.isoformat(),
                "measurements": list(MEASUREMENTS),
            },
        )
        report["metrics"] = metric_report(data, active_ids)
    except (Unavailable, TypeError, AttributeError):
        report["metrics"] = None
    # Single active deployment is required so a record cannot come from an old release.
    report["startup_capacity"] = (
        deployment_capacity(ids, deployments[0]["id"])
        if len(deployments) == 1
        else None
    )
    report["limits"] = [
        "Metrics are sampled usage, not actual filesystem free space",
        "Startup capacity is a dated snapshot, not current free space",
        "Dashboard command matching does not establish the running process count",
        "Null means unavailable, not zero",
        "Published rates are not an account invoice or special pricing",
    ]
    return report


def main() -> int:
    token = os.environ.get("RAILWAY_TOKEN")
    if not token:
        print(
            json.dumps({"status": "unavailable", "reason": "missing_required_secret"})
        )
        return 1
    try:
        result = collect(token)
    except Exception:
        print(
            json.dumps(
                {"status": "unavailable", "reason": "identity_or_report_unavailable"}
            )
        )
        return 1
    print(json.dumps(result, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
