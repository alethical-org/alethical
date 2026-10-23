#!/usr/bin/env python3
"""Require current source, upstream and trusted production proof for Pillow."""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid
import zipfile
from datetime import datetime

REPO = "alethical-org/alethical"
WORKFLOW = "pillow-runtime.yml"
PATH = ".github/workflows/" + WORKFLOW
MAX_WAIT = 480
MAX_AGE = 1800
ROOT = Path(__file__).resolve().parents[1]


class Unavailable(Exception):
    """Fixed local messages only; provider output is never printed."""


def read_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON field")
            result[key] = value
        return result

    return json.loads(raw, object_pairs_hook=unique)


def gh(endpoint, body=None):
    command = ["gh", "api", "--hostname", "github.com", endpoint]
    if body is not None:
        command += ["--method", "POST", "--input", "-"]
    try:
        result = subprocess.run(
            command,
            input=json.dumps(body).encode() if body is not None else None,
            capture_output=True,
            timeout=30,
            check=False,
        )
        if result.returncode or len(result.stdout) > 1_000_000:
            raise Unavailable("GitHub evidence request failed.")
        return result.stdout
    except (OSError, subprocess.TimeoutExpired):
        raise Unavailable("GitHub evidence request did not complete.") from None


def api(endpoint, body=None):
    try:
        raw = gh(endpoint, body)
        return read_json(raw) if raw else None
    except (ValueError, UnicodeError):
        raise Unavailable("GitHub evidence response was unreadable.") from None


def date(value):
    if not isinstance(value, str):
        raise Unavailable("Missing evidence timestamp.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
        return parsed.timestamp()
    except ValueError:
        raise Unavailable("Invalid evidence timestamp.") from None


def positive(value):
    return (
        isinstance(value, (str, int))
        and re.fullmatch("[1-9][0-9]{0,19}", str(value)) is not None
    )


def request(env):
    if env.get("GITHUB_ACTIONS") == "true":
        if (
            env.get("GITHUB_REPOSITORY") != REPO
            or not positive(env.get("GITHUB_RUN_ID"))
            or not positive(env.get("GITHUB_RUN_ATTEMPT"))
        ):
            raise Unavailable("Unrecognized requesting repository or run.")
        run = api(
            f"repos/{REPO}/actions/runs/{env['GITHUB_RUN_ID']}/attempts/{env['GITHUB_RUN_ATTEMPT']}"
        )
        if run.get("path") not in {
            ".github/workflows/ci.yml",
            ".github/workflows/technology-health.yml",
        }:
            raise Unavailable("Unsupported requesting workflow.")
        expected = {
            "event": "workflow_run",
            "run_id": str(run["id"]),
            "run_attempt": str(run["run_attempt"]),
            "head_sha": run["head_sha"],
        }
        return (
            expected,
            f"{run['id']}-{run['run_attempt']}",
            date(run["run_started_at"]),
        )
    nonce = uuid.uuid4().hex
    started = time.time()
    api(
        f"repos/{REPO}/actions/workflows/{WORKFLOW}/dispatches",
        {"ref": "main", "inputs": {"nonce": nonce}},
    )
    return {"event": "workflow_dispatch", "nonce": nonce}, nonce, started


def valid_runtime(runtime, earliest, now):
    from scripts.pillow_source_guard import PINNED_FILES, RENDERER

    if not isinstance(runtime, dict):
        raise Unavailable("Missing runtime proof.")
    expected = {
        "schema_version": 1,
        "project_id": "82c4cf9a-9a48-469b-bc71-8afd05339955",
        "environment_id": "2555565c-2352-4cfe-b3ff-8073003c97a1",
        "service_id": "e5d405e3-5d8b-43a0-83e9-780e6627e1ca",
        "saved_pillow_alignment_present": False,
        "pillow_alignment_present": False,
        "pyarrow_importable": False,
        "pyarrow_installed": False,
        "pillow_version": "13.0.0",
        "renderer_sha256": PINNED_FILES[RENDERER],
        "deployed_source_guard_passed": True,
        "app_environment_verified": True,
    }
    if set(runtime) != set(expected) | {"started_at", "checked_at", "deployments"}:
        raise Unavailable("Runtime proof fields changed.")
    for key, value in expected.items():
        if type(runtime[key]) is not type(value) or runtime[key] != value:
            raise Unavailable("A reviewed runtime condition changed.")
    start, end = date(runtime["started_at"]), date(runtime["checked_at"])
    if start < earliest - 30 or end < start or end > now + 30 or now - end > MAX_AGE:
        raise Unavailable("Runtime evidence is stale or predates this request.")
    deployments = runtime["deployments"]
    if not isinstance(deployments, list) or not 1 <= len(deployments) <= 10:
        raise Unavailable("Missing runtime instance coverage.")
    identities = set()
    for deployment in deployments:
        if not isinstance(deployment, dict) or set(deployment) != {
            "deployment_id",
            "commit_sha",
            "instance_ids",
            "configured_replicas",
        }:
            raise Unavailable("Invalid deployment evidence.")
        if not isinstance(deployment["commit_sha"], str) or not re.fullmatch(
            "[a-f0-9]{40}", deployment["commit_sha"]
        ):
            raise Unavailable("Invalid deployed revision.")
        instances = deployment["instance_ids"]
        if (
            not isinstance(instances, list)
            or type(deployment["configured_replicas"]) is not int
            or not 1 <= len(instances) == deployment["configured_replicas"] <= 100
        ):
            raise Unavailable("Incomplete runtime instance coverage.")
        for identity in [deployment["deployment_id"], *instances]:
            if (
                not isinstance(identity, str)
                or not re.fullmatch(
                    "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", identity
                )
                or identity in identities
            ):
                raise Unavailable("Invalid or repeated deployment identity.")
            identities.add(identity)


def validate(proof, run, expected, workflow_id, earliest, now):
    if not isinstance(run, dict) or (
        run.get("workflow_id") != workflow_id
        or run.get("path") != PATH
        or run.get("head_branch") != "main"
        or run.get("event") != expected["event"]
        or run.get("status") != "completed"
        or run.get("conclusion") != "success"
        or run.get("head_repository", {}).get("full_name") != REPO
    ):
        raise Unavailable(
            "Evidence did not come from the successful trusted main workflow."
        )
    if (
        not isinstance(proof, dict)
        or set(proof)
        != {
            "schema",
            "issuer_run_id",
            "issuer_run_attempt",
            "issuer_sha",
            "request",
            "runtime",
        }
        or type(proof.get("schema")) is not int
        or proof.get("schema") != 1
    ):
        raise Unavailable("Invalid evidence envelope.")
    if (
        proof["issuer_run_id"] != str(run["id"])
        or proof["issuer_run_attempt"] != str(run["run_attempt"])
        or proof["issuer_sha"] != run["head_sha"]
        or proof["request"] != expected
    ):
        raise Unavailable(
            "Runtime evidence belongs to a different request, attempt or revision."
        )
    valid_runtime(proof["runtime"], earliest, now)


def artifact(run):
    data = api(f"repos/{REPO}/actions/runs/{run['id']}/artifacts?per_page=100")
    name = f"pillow-runtime-proof-{run['run_attempt']}"
    matches = [a for a in data["artifacts"] if a.get("name") == name]
    if len(matches) != 1:
        raise Unavailable("Missing or ambiguous runtime evidence artifact.")
    item = matches[0]
    if (
        item.get("expired") is not False
        or not 0 < item.get("size_in_bytes", 0) < 65536
        or item.get("workflow_run", {}).get("id") != run["id"]
        or item.get("workflow_run", {}).get("head_sha") != run["head_sha"]
    ):
        raise Unavailable("Invalid runtime artifact provenance.")
    raw = gh(f"repos/{REPO}/actions/artifacts/{item['id']}/zip")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            if (
                len(infos) != 1
                or infos[0].filename != "runtime-proof.json"
                or infos[0].file_size > 32768
            ):
                raise Unavailable("Unexpected runtime artifact contents.")
            return read_json(archive.read(infos[0]))
    except (ValueError, zipfile.BadZipFile, UnicodeError):
        raise Unavailable("Runtime artifact could not be read.") from None


def runtime_check(env):
    expected, label, earliest = request(env)
    workflow = api(f"repos/{REPO}/actions/workflows/{WORKFLOW}")
    if workflow.get("path") != PATH or workflow.get("state") != "active":
        raise Unavailable("Trusted runtime workflow is unavailable.")
    deadline = time.monotonic() + MAX_WAIT
    while time.monotonic() < deadline:
        listing = api(
            f"repos/{REPO}/actions/workflows/{WORKFLOW}/runs?event={expected['event']}&per_page=100"
        )
        matches = [
            r
            for r in listing["workflow_runs"]
            if r.get("display_title") == "Pillow runtime " + label
            and r.get("head_branch") == "main"
        ]
        if matches:
            run = max(matches, key=lambda r: r["id"])
            if run.get("status") == "completed":
                if run.get("conclusion") != "success":
                    raise Unavailable(
                        "Trusted production security check failed; inspect its GitHub run."
                    )
                validate(
                    artifact(run), run, expected, workflow["id"], earliest, time.time()
                )
                return
        time.sleep(10)
    raise Unavailable(
        "Timed out waiting for this request’s trusted production security check."
    )


def check(root=ROOT):
    from scripts import check_pillow_advisory, pillow_source_guard

    problems = pillow_source_guard.validate(root) + check_pillow_advisory.check()
    if problems:
        return problems
    try:
        runtime_check(dict(os.environ))
    except Unavailable as error:
        return [str(error)]
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return ["Production security evidence was incomplete or unreadable."]
    print(
        "Pillow exception: reviewed source, unchanged upstream warning and fresh trusted production evidence passed."
    )
    return []


if __name__ == "__main__":
    findings = check()
    for finding in findings:
        print(finding)
    raise SystemExit(bool(findings))
