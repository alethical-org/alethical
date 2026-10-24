#!/usr/bin/env python3
"""Let only the first trusted run for a request probe production.

GitHub can start this workflow 2 to 4 times for 1 requesting check. The first
run for a request label probes; later copies finish without probing, so 1
request gets 1 production result.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.request

REPOSITORY = "alethical-org/alethical"
WORKFLOW = "pillow-runtime.yml"
TITLE = "Pillow runtime "
MAX_RESPONSE_BYTES = 1_000_000


def label(value: object) -> str:
    text = str(value)
    if not re.fullmatch(r"[a-f0-9]{32}|[1-9][0-9]{0,19}-[1-9][0-9]{0,4}", text):
        raise ValueError("Invalid request label")
    return text


def is_first(runs: list[dict], request: str, run_id: int) -> bool:
    """True when no earlier main run carries the same request label."""
    same = [
        run["id"]
        for run in runs
        if run.get("display_title") == TITLE + request
        and run.get("head_branch") == "main"
    ]
    if run_id not in same:
        raise ValueError("This run is missing from its own listing")
    return min(same) == run_id


def runs(token: str, event: str) -> list[dict]:
    # 100 full run records exceed 1 MB; copies for 1 request start seconds apart,
    # so the newest 30 always hold them, and a missing own run fails closed.
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}/actions/workflows/{WORKFLOW}"
        f"/runs?event={event}&branch=main&per_page=30",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "alethical-pillow-runtime-claim/1",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError("Oversized run listing")
    listing = json.loads(raw)["workflow_runs"]
    if not isinstance(listing, list):
        raise ValueError("Unreadable run listing")
    return listing


def main(env: dict | None = None) -> int:
    env = dict(os.environ) if env is None else env
    try:
        if env.get("GITHUB_REPOSITORY") != REPOSITORY:
            raise ValueError("Unexpected repository")
        event = env.get("GITHUB_EVENT_NAME")
        if event not in {"workflow_run", "workflow_dispatch"}:
            raise ValueError("Unexpected event")
        run_id = int(env.get("GITHUB_RUN_ID", ""))
        first = is_first(
            runs(env.get("GH_TOKEN", ""), event), label(env.get("REQUEST")), run_id
        )
    except (OSError, ValueError, KeyError, TypeError):
        # Fail closed: a failed copy makes the requester fail, never pass.
        print("Could not establish which run owns this request.", file=sys.stderr)
        return 1
    with open(env["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"first={'true' if first else 'false'}\n")
    print(
        "This run probes production."
        if first
        else "An earlier run owns this request; this copy does not probe."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
