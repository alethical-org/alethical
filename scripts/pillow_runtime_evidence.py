#!/usr/bin/env python3
"""Bind trusted runtime evidence to one requesting check; never run its code."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

REPOSITORY = "alethical-org/alethical"
WORKFLOW_PATH = ".github/workflows/pillow-runtime.yml"


def positive_id(value: object) -> str:
    text = str(value)
    if not re.fullmatch(r"[1-9][0-9]{0,19}", text):
        raise ValueError("Invalid run identity")
    return text


def commit(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{40}", value):
        raise ValueError("Invalid source revision")
    return value


def binding(event: dict, env: dict) -> dict:
    if (
        env.get("GITHUB_REPOSITORY") != REPOSITORY
        or env.get("GITHUB_REF") != "refs/heads/main"
        or env.get("GITHUB_WORKFLOW_REF")
        != f"{REPOSITORY}/{WORKFLOW_PATH}@refs/heads/main"
    ):
        raise ValueError("Evidence must originate from the trusted main workflow")
    result = {
        "schema": 1,
        "issuer_run_id": positive_id(env.get("GITHUB_RUN_ID")),
        "issuer_run_attempt": positive_id(env.get("GITHUB_RUN_ATTEMPT")),
        "issuer_sha": commit(env.get("GITHUB_SHA")),
    }
    if env.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
        nonce = event.get("inputs", {}).get("nonce")
        if not isinstance(nonce, str) or not re.fullmatch(r"[a-f0-9]{32}", nonce):
            raise ValueError("Invalid local request nonce")
        result["request"] = {"event": "workflow_dispatch", "nonce": nonce}
    elif env.get("GITHUB_EVENT_NAME") == "workflow_run":
        run = event.get("workflow_run", {})
        if (
            event.get("action") != "in_progress"
            or run.get("repository", {}).get("full_name") != REPOSITORY
            or (run.get("name"), run.get("path"))
            not in {
                ("CI", ".github/workflows/ci.yml"),
                ("Review technology health", ".github/workflows/technology-health.yml"),
            }
        ):
            raise ValueError("Unexpected requesting workflow")
        result["request"] = {
            "event": "workflow_run",
            "run_id": positive_id(run.get("id")),
            "run_attempt": positive_id(run.get("run_attempt")),
            "head_sha": commit(run.get("head_sha")),
        }
    else:
        raise ValueError("Unexpected evidence event")
    return result


def main() -> int:
    try:
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
        proof = binding(event, dict(os.environ))
        raw = Path("runtime.json").read_bytes()
        if len(raw) > 32_768:
            raise ValueError("Oversized runtime proof")
        proof["runtime"] = json.loads(raw)
        Path("runtime-proof.json").write_text(json.dumps(proof, sort_keys=True) + "\n")
    except (OSError, KeyError, ValueError, TypeError):
        print("Runtime evidence could not be bound to the trusted request.")
        return 1
    print("Production security evidence is bound to this request.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
