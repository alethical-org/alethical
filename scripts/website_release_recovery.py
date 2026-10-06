#!/usr/bin/env python3
"""Read-only by default; 1 guarded website repair per trusted main commit."""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import os
import re
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# The shared watch is a repository script, not an installed package. Load its
# exact sibling instead of relying on a caller's working folder or import path.
_spec = importlib.util.spec_from_file_location(
    "release_watch", ROOT / "scripts/check_production_release_reached_readers.py"
)
assert _spec and _spec.loader
release = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(release)
REPOSITORY = "alethical-org/alethical"
ENVIRONMENT = "website-release-recovery"
ACTIVE = {"QUEUED", "INITIALIZING", "BUILDING"}
TERMINAL = {"READY", "ERROR", "CANCELED"}


class StopRecovery(Exception):
    """A fixed, public explanation, never raw command output or credentials."""


def command(args: list[str], timeout: int = 60) -> str:
    try:
        result = subprocess.run(
            args, cwd=ROOT, capture_output=True, text=True, timeout=timeout, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise StopRecovery(
            "A required command did not finish; stop without retry"
        ) from exc
    if result.returncode:
        raise StopRecovery("A required command failed; stop without retry")
    return result.stdout.strip()


def github(path: str, payload: dict | None = None):
    args = ["gh", "api", f"repos/{REPOSITORY}/{path}"]
    if payload is None:
        return json.loads(command(args))
    # Keep request data out of shell expansion and preserve real JSON types.
    result = subprocess.run(
        [*args, "--method", "POST", "--input", "-"],
        input=json.dumps(payload),
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode:
        raise StopRecovery("GitHub could not save the attempt; stop without retry")
    return json.loads(result.stdout)


def vercel(path: str):
    token = os.environ.get("VERCEL_TOKEN")
    team = os.environ.get("VERCEL_ORG_ID")
    if not token or not team or not os.environ.get("VERCEL_PROJECT_ID"):
        raise StopRecovery("Vercel access is unavailable; no repair was started")
    separator = "&" if "?" in path else "?"
    request = urllib.request.Request(
        "https://api.vercel.com"
        + path
        + separator
        + urllib.parse.urlencode({"teamId": team}),
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except Exception as exc:
        raise StopRecovery(
            "Vercel release state is unavailable; no promotion allowed"
        ) from exc


def trusted_source(event: dict, event_name: str, head: str) -> bool:
    if event_name == "workflow_dispatch":
        return os.environ.get("GITHUB_REF") == "refs/heads/main"
    run = event.get("workflow_run", {})
    return (
        event_name == "workflow_run"
        and run.get("name") == "Production release missing"
        and run.get("path") == ".github/workflows/production-release-missing.yml"
        and run.get("event") in {"push", "workflow_dispatch"}
        and run.get("head_branch") == "main"
        and run.get("head_sha") == head
        and run.get("head_repository", {}).get("full_name") == REPOSITORY
        and run.get("status") == "completed"
        and run.get("conclusion") == "failure"
    )


def successful_ci(head: str) -> bool:
    runs = github(
        f"actions/workflows/ci.yml/runs?head_sha={head}&branch=main&event=push&per_page=100"
    )
    matching = [
        r
        for r in runs["workflow_runs"]
        if r["head_sha"] == head and r["head_branch"] == "main"
    ]
    if not matching:
        return False
    run = max(matching, key=lambda r: r["id"])
    if run["status"] != "completed" or run["conclusion"] != "success":
        return False
    jobs = github(f"actions/runs/{run['id']}/jobs?per_page=100")["jobs"]
    by_name = {job["name"]: job for job in jobs}
    return all(
        name in by_name
        and by_name[name]["status"] == "completed"
        and by_name[name]["conclusion"] in allowed
        for name, allowed in {
            "changes": {"success"},
            "backend": {"success", "skipped"},
            "frontend": {"success", "skipped"},
        }.items()
    )


def current_main(head: str):
    if github("commits/main")["sha"] != head:
        raise StopRecovery("Main changed; leave the newer release to its own checks")


def idle_provider(waiting: set[str] | None = None, own_url: str | None = None):
    project = os.environ.get("VERCEL_PROJECT_ID", "")
    cursor = None
    for _ in range(10):
        query = {"projectId": project, "target": "production", "limit": 100}
        if cursor is not None:
            query["until"] = cursor
        data = vercel("/v6/deployments?" + urllib.parse.urlencode(query))
        if (
            not isinstance(data.get("deployments"), list)
            or not isinstance(data.get("pagination"), dict)
            or "next" not in data["pagination"]
        ):
            raise StopRecovery(
                "Vercel release history is incomplete; do not assume it is idle"
            )
        for deployment in data["deployments"]:
            state = deployment.get("state", deployment.get("readyState"))
            if state not in ACTIVE | TERMINAL:
                raise StopRecovery(
                    "Vercel release state is unknown; do not assume it is idle"
                )
            if state in ACTIVE:
                raise StopRecovery(
                    "A Vercel production release is running; do not race it"
                )
            if (
                waiting
                and state == "READY"
                and deployment.get("meta", {}).get("githubCommitSha") in waiting
                and (
                    not own_url
                    or deployment.get("url") != urllib.parse.urlsplit(own_url).hostname
                )
            ):
                raise StopRecovery(
                    "A waiting commit already has a ready release; preserve a possible rollback or promotion hold"
                )
        cursor = data["pagination"]["next"]
        if cursor is None:
            return
    raise StopRecovery("Vercel release history is incomplete; do not assume it is idle")


def production_target(project: str) -> str:
    data = vercel(f"/v9/projects/{project}")
    alias_request = data.get("lastAliasRequest")
    if alias_request is not None and (
        not isinstance(alias_request, dict)
        or alias_request.get("type") not in {"promote", "rollback"}
        or alias_request.get("jobStatus") not in {"failed", "skipped", "succeeded"}
    ):
        raise StopRecovery(
            "A production domain change is pending or unknown; do not race it"
        )
    if data.get("autoAssignCustomDomains") is not True:
        raise StopRecovery(
            "Production promotion is held or unknown; preserve any rollback"
        )
    previous = data.get("targets", {}).get("production", {}).get("id")
    if not previous or not re.fullmatch(r"dpl_[A-Za-z0-9]+", previous):
        raise StopRecovery(
            "The previous production deployment is unknown; no reversible promotion"
        )
    return previous


def eligible(head: str) -> tuple[bool, str]:
    current_main(head)
    served, problem = release.read_release_stamp(release.WEBSITE.url)
    if problem or not served or not release.known_commit(ROOT, served):
        raise StopRecovery(
            "The live website cannot prove its saved commit; no automatic repair"
        )
    if served == head:
        return False, served
    if not release.is_ancestor(ROOT, served, head):
        raise StopRecovery(
            "The live release is outside the expected history; no automatic repair"
        )
    status, _ = release.report(
        head,
        release.WEBSITE.url,
        10,
        dt.datetime.now(dt.UTC),
        read_stamp=lambda _: (served, None),
    )
    if status == release.REACHED:
        return False, served
    if status != release.NOT_REACHED:
        raise StopRecovery(
            "The missing-release check has no mature verdict; no automatic repair"
        )
    if not successful_ci(head):
        raise StopRecovery("Current-main tests are not successful; no automatic repair")
    return True, served


def repair(head: str, result: dict, checkpoint=lambda: None):
    # GITHUB_ACTIONS is an accident guard, not an authorization boundary.
    # Workflow selection and trusted-main checkout are the boundary.
    if (
        os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("GITHUB_REPOSITORY") != REPOSITORY
    ):
        raise StopRecovery(
            "Automatic repair runs only in Alethical's trusted GitHub workflow"
        )
    if github(f"deployments?sha={head}&environment={ENVIRONMENT}&per_page=1"):
        raise StopRecovery("This commit already used its 1 recovery attempt")
    waiting = set(
        release.waiting_commits(
            ROOT, result["previous_commit"], head, release.website_paths()
        )
    )
    idle_provider(waiting)
    project = urllib.parse.quote(os.environ["VERCEL_PROJECT_ID"], safe="")
    previous = production_target(project)
    result.update(previous_deployment=previous, phase="reserving_attempt")
    checkpoint()
    current_main(head)
    reservation = github(
        "deployments",
        {
            "ref": head,
            "environment": ENVIRONMENT,
            "auto_merge": False,
            "required_contexts": [],
            "description": "1 bounded website repair attempt",
            "transient_environment": True,
            "production_environment": False,
            "payload": {
                "previous_deployment": previous,
                "previous_commit": result["previous_commit"],
            },
        },
    )
    attempt = reservation["id"]
    result.update(
        attempt_id=attempt, previous_deployment=previous, decision="attempted"
    )
    checkpoint()
    github(
        f"deployments/{attempt}/statuses",
        {"state": "in_progress", "auto_inactive": False},
    )
    succeeded = False
    try:
        token = os.environ["VERCEL_TOKEN"]
        cli = ["npx", "--yes", "vercel@54.4.1"]
        result["phase"] = "building_without_live_domain"
        checkpoint()
        # Build with production settings, but preserve the working domain until
        # all post-build guards pass. Vercel retains previous for rollback.
        deployed = command(
            [
                *cli,
                "deploy",
                "--prod",
                "--skip-domain",
                "--yes",
                "--archive=tgz",
                "--build-env",
                f"ALETHICAL_COMMIT_SHA={head}",
                "--meta",
                f"githubCommitSha={head}",
                "--token",
                token,
            ],
            timeout=900,
        )
        if not re.fullmatch(r"https://[a-zA-Z0-9-]+\.vercel\.app", deployed):
            raise StopRecovery(
                "Vercel did not return a safe deployment address; no promotion"
            )
        result.update(candidate_url=deployed, phase="checking_before_promotion")
        checkpoint()
        ready, _ = eligible(head)
        if not ready:
            raise StopRecovery(
                "Readers caught up during the build; no promotion needed"
            )
        # Live/CI reads finish before final short guards. Vercel has no
        # transaction spanning GitHub main and its domain assignment.
        idle_provider(waiting, own_url=deployed)
        if production_target(project) != previous:
            raise StopRecovery(
                "Production changed during the build; preserve that release"
            )
        current_main(head)
        result["phase"] = "promoting"
        checkpoint()
        command(
            [*cli, "promote", deployed, "--timeout", "3m", "--token", token],
            timeout=240,
        )
        result["phase"] = "checking_live_reader_paths"
        checkpoint()
        # Browser reads also check the exact served stamp. Failure retains the
        # previous deployment ID, but never automatically rolls back newer work.
        command(
            [
                "node",
                "apps/frontend/scripts/reader-completion-checks.mjs",
                "--base-url",
                release.WEBSITE.url,
                "--expected-commit",
                head,
                "--release-wait-seconds",
                "120",
                "--output",
                "reader-completion.json",
            ],
            timeout=300,
        )
        result["decision"] = "recovered"
        result["phase"] = "completed"
        checkpoint()
        succeeded = True
    finally:
        github(
            f"deployments/{attempt}/statuses",
            {
                "state": "success" if succeeded else "failure",
                "auto_inactive": False,
                "description": "Live reader checks passed"
                if succeeded
                else "Stopped; inspect saved recovery evidence",
            },
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--report", type=Path, default=Path("website-recovery.json"))
    args = parser.parse_args()
    result = {
        "schema_version": 1,
        "started_at": dt.datetime.now(dt.UTC).isoformat(),
        "execute": args.execute,
        "decision": "stopped",
    }
    status = 0
    try:
        head = release.git(ROOT, "rev-parse", "HEAD")
        result["commit"] = head
        if args.execute:
            event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
            if not trusted_source(event, os.environ.get("GITHUB_EVENT_NAME", ""), head):
                raise StopRecovery(
                    "The trigger is not a trusted current-main release alarm"
                )
        ready, served = eligible(head)
        result["previous_commit"] = served
        if not ready:
            result.update(
                decision="not_needed",
                reason="Readers already have the intended website changes",
            )
        elif args.execute:
            repair(
                head,
                result,
                checkpoint=lambda: args.report.write_text(
                    json.dumps(result, indent=2) + "\n"
                ),
            )
        else:
            result.update(
                decision="eligible_dry_run",
                reason="Missing website changes and successful main checks; no deployment attempted",
            )
    except (
        StopRecovery,
        KeyError,
        ValueError,
        TypeError,
        AttributeError,
        OSError,
        subprocess.SubprocessError,
    ):
        import sys

        error = sys.exception()
        result["reason"] = (
            str(error)
            if isinstance(error, StopRecovery)
            else "Required evidence is incomplete; stop without retry"
        )
        status = 1
    result["finished_at"] = dt.datetime.now(dt.UTC).isoformat()
    args.report.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    return status


if __name__ == "__main__":
    raise SystemExit(main())
