"""Manual, bounded address-copy switch. Raw provider replies never reach output.

The parent operator establishes applicable charges before dispatch. This job does
not create resources or change any setting except the existing copy switch.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import UTC, datetime

from scripts import address_copy_capacity as capacity

FLAG = "ALETHICAL_ADDRESS_SUGGESTION_INDEX_ENABLED"
PUBLIC = "https://alethical-api-production.up.railway.app"
KNOWN_ADDRESS = "350 5th Street South, Minneapolis, MN 55415"
KNOWN_QUERY = "350 S 5th St Minneapolis"
ON_WAIT_SECONDS = 480
OFF_WAIT_SECONDS = 240
TOTAL_SECONDS = 840
MIN_FREE = 3_000_000_000
MIN_ROOM = 256 * 1024 * 1024
TERMINAL = ["SUCCESS", "CRASHED", "FAILED", "REMOVED", "SKIPPED"]
REASONS = {
    "public_read_unavailable",
    "another_deployment_or_unknown_state",
    "reviewed_deployment_unavailable",
    "activation_capacity_insufficient_or_unknown",
    "flag_update_unconfirmed",
    "reviewed_release_not_live",
    "reviewed_release_changed",
    "replacement_not_verified",
    "control_unavailable",
    "preflight_read_budget_exceeded",
}
TARGET = """query CopyControlTarget($environmentId: String!, $serviceId: String!) {
  serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
    activeDeployments { id status canRedeploy }
  }
}"""
PENDING = """query CopyControlPending($input: DeploymentListInput!) {
  deployments(first: 100, input: $input) {
    edges { node { id status } }
    pageInfo { hasNextPage }
  }
}"""
REDEPLOY = """mutation CopyControlRedeploy($id: String!) {
  deploymentRedeploy(id: $id) { id }
}"""
STATE = """query CopyControlState($id: String!) {
  deployment(id: $id) { id status projectId environmentId serviceId }
}"""


class Refused(Exception):
    """Fixed reason only; never construct this from provider text."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def public_read(path: str, body: dict | None = None) -> dict:
    if path not in {"/version", "/readyz", "/api/v1/address-suggestions"}:
        raise Refused("public_read_unavailable")
    request = urllib.request.Request(
        PUBLIC + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", "Cache-Control": "no-cache"},
    )
    try:
        with urllib.request.build_opener(NoRedirect).open(
            request, timeout=10
        ) as response:
            raw = response.read(64_001)
        if len(raw) > 64_000:
            raise ValueError
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError
        return result
    except Exception:
        raise Refused("public_read_unavailable") from None


def version_matches(commit: str) -> bool:
    return public_read("/version").get("commit") == commit


def pending_clear(token: str, ids: dict) -> None:
    data = capacity.query(
        token,
        PENDING,
        {"input": {**ids, "status": {"notIn": TERMINAL}}},
    )
    try:
        rows = data["deployments"]
        if rows["pageInfo"]["hasNextPage"] is not False or rows["edges"] != []:
            raise Refused("another_deployment_or_unknown_state")
    except (KeyError, TypeError):
        raise Refused("another_deployment_or_unknown_state") from None


def target(token: str, ids: dict) -> str:
    pending_clear(token, ids)
    data = capacity.query(
        token,
        TARGET,
        {key: ids[key] for key in ("environmentId", "serviceId")},
    )
    try:
        rows = data["serviceInstance"]["activeDeployments"]
        if not isinstance(rows, list) or len(rows) != 1:
            raise Refused("reviewed_deployment_unavailable")
        row = rows[0]
        if row["status"] != "SUCCESS" or row["canRedeploy"] is not True:
            raise Refused("reviewed_deployment_unavailable")
        return capacity.resource_id(row["id"])
    except (KeyError, TypeError):
        raise Refused("reviewed_deployment_unavailable") from None


def recent(timestamp: object, now: datetime, seconds: int) -> bool:
    try:
        stamp = (
            datetime.fromisoformat(timestamp) if isinstance(timestamp, str) else None
        )
        if stamp is None or stamp.tzinfo is None:
            return False
        return 0 <= (now - stamp).total_seconds() <= seconds
    except (ValueError, TypeError, OverflowError):
        return False


def activation_gate(report: dict, ids: dict, deployment_id: str, now: datetime) -> None:
    """Unknown or multiple containers cannot stand in for measured capacity."""
    try:
        if any(report["identity"][key] != value for key, value in ids.items()):
            raise ValueError
        if report["plan"] not in {"hobby", "pro"}:
            raise ValueError
        service = report["service"]
        if (
            type(service["configured_replicas"]) is not int
            or service["configured_replicas"] != 1
            or service["dashboard_start_command_matches_repository"] is not True
        ):
            raise ValueError
        deployments = service["active_deployments"]
        if len(deployments) != 1 or deployments[0]["id"] != deployment_id:
            raise ValueError
        instances = deployments[0]["running_instance_ids"]
        if len(instances) != 1:
            raise ValueError
        startup = report["startup_capacity"]
        if (
            startup["enabled"] is not False
            or type(startup["api_process_count"]) is not int
            or startup["api_process_count"] != 1
            or not recent(startup["recorded_at"], now, 30 * 60)
        ):
            raise ValueError
        for key in ("free_bytes", "cgroup_current_bytes", "cgroup_max_bytes"):
            if type(startup[key]) is not int or not 0 <= startup[key] <= 10**16:
                raise ValueError
        if startup["free_bytes"] < MIN_FREE:
            raise ValueError
        metrics = report["metrics"]
        if len(metrics) != 1 or metrics[0]["instance_id"] != instances[0]:
            raise ValueError
        measurements = metrics[0]["measurements"]
        usage, limit = (
            measurements["MEMORY_USAGE_GB"],
            measurements["MEMORY_LIMIT_GB"],
        )
        for metric in (usage, limit):
            if type(metric["sample_count"]) is not int or metric["sample_count"] < 1:
                raise ValueError
            for key in ("latest", "maximum", "latest_timestamp"):
                if capacity.number(metric[key]) is None:
                    raise ValueError
            age = now.timestamp() - metric["latest_timestamp"]
            if not 0 <= age <= 5 * 60:
                raise ValueError
        # Use the smaller limit and larger usage. These conversions are also
        # conservative across decimal GB and binary GiB provider presentation.
        maximum = min(startup["cgroup_max_bytes"], limit["latest"] * 1_000_000_000)
        used = max(startup["cgroup_current_bytes"], usage["maximum"] * 1024**3)
        if maximum - used < MIN_ROOM:
            raise ValueError
    except (KeyError, TypeError, ValueError, IndexError):
        raise Refused("activation_capacity_insufficient_or_unknown") from None


def set_flag(ids: dict, enabled: bool) -> None:
    command = [
        "npx",
        "--yes",
        "@railway/cli@5.41.2",
        "variable",
        "set",
        f"{FLAG}={'true' if enabled else 'false'}",
        "--project",
        ids["projectId"],
        "--environment",
        ids["environmentId"],
        "--service",
        ids["serviceId"],
        "--skip-deploys",
        "--json",
    ]
    try:
        process = subprocess.run(command, capture_output=True, timeout=90, check=False)
        if process.returncode != 0 or len(process.stdout) > 64_000:
            raise ValueError
        result = json.loads(process.stdout)
        if result.get("keys") != [FLAG] or result.get("set") is not True:
            raise ValueError
    except Exception:
        raise Refused("flag_update_unconfirmed") from None


def redeploy(token: str, deployment_id: str) -> str:
    data = capacity.query(token, REDEPLOY, {"id": deployment_id})
    return capacity.resource_id(data["deploymentRedeploy"]["id"])


def active_matches(token: str, ids: dict, new_id: str) -> bool:
    data = capacity.query(
        token,
        TARGET,
        {key: ids[key] for key in ("environmentId", "serviceId")},
    )
    try:
        rows = data["serviceInstance"]["activeDeployments"]
        return (
            isinstance(rows, list)
            and len(rows) == 1
            and rows[0]["id"] == new_id
            and rows[0]["status"] == "SUCCESS"
        )
    except (KeyError, TypeError):
        return False


def replacement_ready(
    token: str,
    ids: dict,
    new_id: str,
    commit: str,
    enabled: bool,
    end_by: float | None = None,
) -> bool:
    """Wait at most 8 minutes for ON or 4 minutes for OFF, checking every 10s.

    ON needs time for deployment, the downloader's 180s ceiling, and the measured
    11.6s copy build. The caller can shorten this window to reserve restoration
    time inside the 15-minute job. No measured production-copy duration exists
    before first activation. Each read reserves its own timeout before starting;
    at most 1 bounded private log read is made for this replacement.
    """
    startup = None
    logs_read = False
    wait_seconds = ON_WAIT_SECONDS if enabled else OFF_WAIT_SECONDS
    deadline = time.monotonic() + wait_seconds
    if end_by is not None:
        deadline = min(deadline, end_by)
    for attempt in range(wait_seconds // 10 + 1):
        if time.monotonic() + 30 > deadline:
            return False
        try:
            row = capacity.query(token, STATE, {"id": new_id})["deployment"]
            if (
                row["id"] != new_id
                or any(row[key] != value for key, value in ids.items())
                or row["status"] in {"CRASHED", "FAILED", "REMOVED", "SKIPPED"}
            ):
                return False
            if row["status"] == "SUCCESS":
                if not logs_read:
                    if time.monotonic() + 90 > deadline:
                        return False
                    logs_read = True
                    startup = capacity.deployment_capacity(ids, new_id)
                if (
                    not startup
                    or startup.get("enabled") is not enabled
                    or not recent(
                        startup.get("recorded_at"), datetime.now(UTC), wait_seconds + 90
                    )
                ):
                    return False
                if (
                    time.monotonic() + 60 <= deadline
                    and active_matches(token, ids, new_id)
                    and time.monotonic() + 30 <= deadline
                    and version_matches(commit)
                    and time.monotonic() + 20 <= deadline
                    and public_read("/readyz").get("status") == "ready"
                ):
                    if not enabled:
                        return True
                    suggestions = (
                        public_read(
                            "/api/v1/address-suggestions",
                            {"address_text": KNOWN_QUERY},
                        )
                        .get("data", {})
                        .get("suggestions", [])
                    )
                    if any(
                        isinstance(item, dict)
                        and isinstance(item.get("matched_address"), str)
                        and " ".join(item["matched_address"].casefold().split())
                        == KNOWN_ADDRESS.casefold()
                        and item.get("requires_location_check") is True
                        for item in suggestions
                    ):
                        return True
        except Exception:
            pass
        if attempt < wait_seconds // 10:
            time.sleep(max(0, min(10, deadline - time.monotonic())))
    return False


def restore_off(
    token: str,
    ids: dict,
    reviewed_id: str,
    commit: str,
    requested_id: str | None,
    end_by: float | None = None,
) -> str:
    if end_by is not None and time.monotonic() + 90 > end_by:
        return "off_flag_unconfirmed"
    try:
        set_flag(ids, False)
    except Exception:
        return "off_flag_unconfirmed"
    try:
        if end_by is not None and time.monotonic() + 100 > end_by:
            return "off_flag_saved_deployment_unconfirmed"
        # Never overwrite another operator's replacement while restoring off.
        if target(token, ids) not in {reviewed_id, requested_id} or not version_matches(
            commit
        ):
            return "off_flag_saved_deployment_unconfirmed"
        new_id = redeploy(token, reviewed_id)
        if replacement_ready(token, ids, new_id, commit, False, end_by=end_by):
            return "off_verified"
        return "off_flag_saved_deployment_unconfirmed"
    except Exception:
        return "off_flag_saved_deployment_unconfirmed"


def control(token: str, enabled: bool, commit: str) -> dict:
    if (
        type(enabled) is not bool
        or not isinstance(commit, str)
        or not re.fullmatch(r"[0-9a-f]{40}", commit)
    ):
        return {"status": "refused", "reason": "invalid_control_inputs"}
    attempted = False
    ids = None
    reviewed_id = None
    requested_id = None
    started = time.monotonic()
    try:
        ids = capacity.identity(capacity.query(token, capacity.IDENTITY, {}))
        if not version_matches(commit):
            raise Refused("reviewed_release_not_live")
        reviewed_id = target(token, ids)
        if enabled:
            activation_gate(
                capacity.collect(token), ids, reviewed_id, datetime.now(UTC)
            )
        # The report may take time. Refuse if the target changed during that read.
        if target(token, ids) != reviewed_id or not version_matches(commit):
            raise Refused("reviewed_release_changed")
        if time.monotonic() - started > 180:
            raise Refused("preflight_read_budget_exceeded")
        attempted = True  # A lost CLI response may still have saved the setting.
        set_flag(ids, enabled)
        if target(token, ids) != reviewed_id or not version_matches(commit):
            raise Refused("reviewed_release_changed")
        requested_id = redeploy(token, reviewed_id)
        # ON gets at most the first 8 minutes of this job; the remaining
        # 6 minutes are reserved for bounded OFF restoration if it fails.
        end_by = started + (ON_WAIT_SECONDS if enabled else TOTAL_SECONDS)
        if not replacement_ready(
            token, ids, requested_id, commit, enabled, end_by=end_by
        ):
            raise Refused("replacement_not_verified")
        return {
            "status": "verified",
            "enabled": enabled,
            "deployment_id": requested_id,
            "commit": commit,
        }
    except Exception as error:
        reason = str(error) if isinstance(error, Refused) else "control_unavailable"
        if reason not in REASONS:
            reason = "control_unavailable"
        result = {"status": "failed" if attempted else "refused", "reason": reason}
        if enabled and attempted and ids and reviewed_id:
            result["rollback"] = restore_off(
                token,
                ids,
                reviewed_id,
                commit,
                requested_id,
                end_by=started + TOTAL_SECONDS,
            )
        elif attempted:
            result["rollback"] = "off_request_unconfirmed"
        return result


def main() -> int:
    # Fixed public inputs are passed through env so bad strings never reach a
    # shell, argparse error, traceback, or provider command.
    enabled = os.environ.get("ADDRESS_COPY_ENABLED")
    commit = os.environ.get("ADDRESS_COPY_RELEASE_COMMIT", "")
    token = os.environ.get("RAILWAY_TOKEN")
    if enabled not in {"true", "false"} or not re.fullmatch(r"[0-9a-f]{40}", commit):
        result = {"status": "refused", "reason": "invalid_control_inputs"}
    elif not token:
        result = {"status": "refused", "reason": "missing_required_secret"}
    else:
        try:
            result = control(token, enabled == "true", commit)
        except Exception:
            result = {"status": "failed", "reason": "control_unavailable"}
    print(json.dumps(result, allow_nan=False))
    return 0 if result["status"] == "verified" else 1


if __name__ == "__main__":
    sys.exit(main())
