"""Check a registered job's completion against narrow independent sources.

CLI: --state-dir DIR --input candidate.json [--write]. Default is read-only.
Candidate JSON has exactly agent_job_outcomes.FIELDS and state completed. Its
checks entry is replaced by fetched evidence. Other evidence references are
relative to DIR/evidence (for example review.json), never external paths or URLs.
Artifacts have exactly kind, commit, checked_at, outcome, observer, observations;
live also has service website|api. Observations are a nonempty list of nonempty
strings. All artifact metadata must match the candidate entry. Observation text
is inspected for presence, never copied into the receipt. Observer identities are
attested, not externally authenticated. Artifacts are at most 1 MiB with no symlink
components or containment escape.

GitHub calls use only gh api --hostname github.com for alethical-org/alethical:
branches/main/protection/required_status_checks and commits/<exact SHA>/check-runs
(filter=all, per_page=100, at most 20 pages). App identity is respected; app_id
null/-1 means any app as in GitHub's legacy protection policy. Highest run ID is
the latest matching run. backend/frontend may be skipped under GitHub policy,
and the receipt labels that skipped_not_executed. changes/description-checks and
all other required contexts must succeed. Missing protection/checks fail closed.

Deployable jobs also probe a fixed website release meta tag
(https://www.alethical.com/, alethical-release-commit), or fixed API JSON commit
(https://api.alethical.com/version), as selected by their live artifact. Redirects,
oversize responses, or different commits refuse completion. This machine-fetched
release identity does not replace attested observations of working behavior.

On --write, a private receipt is saved under DIR/evidence/completion-receipts,
then the ledger uses atomic expected_revision comparison. A pause or other update
during probes therefore cannot be overwritten. Receipt presence alone never
completes a job. The actual finishing time is recorded after probes. No arbitrary
commands, URLs, transcripts, schedules, AI calls, retries, or continuation occur.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import re
import selectors
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "agent_job_outcomes", Path(__file__).resolve().parent / "agent_job_outcomes.py"
)
if _spec is None or _spec.loader is None:
    raise RuntimeError("Job outcome helper is unavailable")
outcomes = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = outcomes
_spec.loader.exec_module(outcomes)

MAX_BYTES = 1024 * 1024
MAX_PAGES = 20
GH_PATHS = ("/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh")
REPOSITORY = "repos/alethical-org/alethical"
PROTECTION = f"{REPOSITORY}/branches/main/protection/required_status_checks"
RELEASE_URLS = {
    "website": "https://www.alethical.com/",
    "api": "https://api.alethical.com/version",
}
DEFAULT_STATE_DIR = Path.home() / ".local/state/alethical-agent-jobs"
ARTIFACT_FIELDS = {
    "kind",
    "commit",
    "checked_at",
    "outcome",
    "observer",
    "observations",
}
SAFE_ERROR = "Completion refused: required evidence is missing, invalid, unavailable, or the job changed."


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def bounded_json(data: bytes) -> dict:
    if len(data) > MAX_BYTES:
        raise ValueError("oversized evidence")
    value = json.loads(data)
    if not isinstance(value, dict):
        raise ValueError("invalid evidence")
    return value


def read_file(path: Path) -> bytes:
    with path.open("rb") as handle:
        data = handle.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("oversized evidence")
    return data


def github_json(endpoint: str) -> dict:
    """Read only approved API paths; bound pipe bytes, time, and captured content."""
    check_path = re.fullmatch(
        rf"{REPOSITORY}/commits/[0-9a-f]{{40}}/check-runs\?filter=all&per_page=100&page=([1-9][0-9]*)",
        endpoint,
    )
    if endpoint != PROTECTION and (
        check_path is None or int(check_path[1]) > MAX_PAGES
    ):
        raise ValueError("unsupported API endpoint")
    executable = next(
        (
            candidate
            for candidate in GH_PATHS
            if Path(candidate).is_file() and os.access(candidate, os.X_OK)
        ),
        None,
    )
    if executable is None:
        raise ValueError("trusted GitHub tool is unavailable")
    process = subprocess.Popen(
        [executable, "api", "--hostname", "github.com", endpoint],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    data = bytearray()
    try:
        assert process.stdout is not None
        deadline = time.monotonic() + 20
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not selector.select(remaining):
                    raise ValueError("API timeout")
                chunk = os.read(
                    process.stdout.fileno(), min(65536, MAX_BYTES + 1 - len(data))
                )
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > MAX_BYTES:
                    raise ValueError("oversized API response")
        if process.wait(timeout=max(0.01, deadline - time.monotonic())) != 0:
            raise ValueError("API unavailable")
        return bounded_json(bytes(data))
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        if process.stdout:
            process.stdout.close()


def required_checks(protection: dict) -> list[tuple[str, int | None]]:
    contexts = protection.get("contexts")
    checks = protection.get("checks")
    if not isinstance(contexts, list) or not isinstance(checks, list):
        raise ValueError("missing required checks policy")
    if any(
        not isinstance(name, str) or not name or len(name) > 256 for name in contexts
    ):
        raise ValueError("invalid context")
    required = []
    for entry in checks:
        if not isinstance(entry, dict) or not {"context", "app_id"} <= entry.keys():
            raise ValueError("invalid required check")
        name, app_id = entry.get("context"), entry.get("app_id")
        if (
            not isinstance(name, str)
            or not name
            or len(name) > 256
            or (app_id is not None and (type(app_id) is not int or app_id < -1))
        ):
            raise ValueError("invalid required check")
        required.append((name, None if app_id in (None, -1) else app_id))
    checked_names = {name for name, _ in required}
    required.extend((name, None) for name in contexts if name not in checked_names)
    if not required:
        raise ValueError("empty required checks policy")
    return sorted(set(required), key=lambda item: (item[0], item[1] or -1))


def fetched_checks(commit: str) -> dict:
    required = required_checks(github_json(PROTECTION))
    runs = []
    total = None
    for page in range(1, MAX_PAGES + 1):
        answer = github_json(
            f"{REPOSITORY}/commits/{commit}/check-runs?filter=all&per_page=100&page={page}"
        )
        current = answer.get("check_runs")
        count = answer.get("total_count")
        if (
            not isinstance(current, list)
            or len(current) > 100
            or type(count) is not int
            or not 0 <= count <= MAX_PAGES * 100
        ):
            raise ValueError("invalid check response")
        if total is not None and count != total:
            raise ValueError("check pagination changed")
        total = count
        for run in current:
            if (
                not isinstance(run, dict)
                or type(run.get("id")) is not int
                or run["id"] < 0
                or run.get("head_sha") != commit
                or not isinstance(run.get("name"), str)
                or not isinstance(run.get("app"), dict)
                or type(run["app"].get("id")) is not int
            ):
                raise ValueError("invalid or stale check run")
        runs.extend(current)
        if len(runs) >= total or len(current) < 100:
            break
    if len(runs) != total or len({run["id"] for run in runs}) != len(runs):
        raise ValueError("incomplete check pagination")
    receipts = []
    for name, app_id in required:
        matches = [
            run
            for run in runs
            if run["name"] == name and (app_id is None or run["app"]["id"] == app_id)
        ]
        if not matches:
            raise ValueError("required check is missing")
        latest = max(matches, key=lambda run: run["id"])
        conclusion = latest.get("conclusion")
        allowed_skip = name in {"backend", "frontend"} and conclusion == "skipped"
        if latest.get("status") != "completed" or (
            conclusion != "success" and not allowed_skip
        ):
            raise ValueError("required check is not successful")
        receipts.append(
            {
                "context": name,
                "required_app_id": app_id,
                "observed_app_id": latest["app"]["id"],
                "run_id": latest["id"],
                "commit": commit,
                "conclusion": conclusion,
                "execution": "skipped_not_executed"
                if allowed_skip
                else "executed_successfully",
            }
        )
    return {
        "source": "GitHub required checks API",
        "repository": "alethical-org/alethical",
        "branch": "main",
        "commit": commit,
        "required_checks": receipts,
        "checked_at": utc_now(),
    }


def contained_artifact(state_dir: Path, reference: str) -> Path:
    if (
        state_dir.is_symlink()
        or not isinstance(reference, str)
        or not reference
        or len(reference) > 4096
    ):
        raise ValueError("invalid artifact location")
    root = state_dir / "evidence"
    relative = Path(reference)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("invalid artifact location")
    path = root / relative
    if root.is_symlink() or any(
        item.is_symlink() for item in (path, *path.parents) if item != state_dir.parent
    ):
        raise ValueError("symlink artifact location")
    if not path.resolve(strict=True).is_relative_to(root.resolve(strict=True)):
        raise ValueError("artifact escaped evidence directory")
    return path


def artifact(state_dir: Path, entry: dict) -> tuple[dict, dict]:
    data = read_file(contained_artifact(state_dir, entry["reference"]))
    document = bounded_json(data)
    expected = ARTIFACT_FIELDS | ({"service"} if entry["kind"] == "live" else set())
    if (
        set(document) != expected
        or any(
            document.get(key) != entry[key]
            for key in ("kind", "commit", "checked_at", "outcome", "observer")
        )
        or document["outcome"] != "passed"
    ):
        raise ValueError("artifact does not match attestation")
    observations = document["observations"]
    if (
        not isinstance(observations, list)
        or not observations
        or any(not isinstance(item, str) or not item.strip() for item in observations)
    ):
        raise ValueError("artifact lacks behavior observations")
    if entry["kind"] == "live" and document["service"] not in RELEASE_URLS:
        raise ValueError("unknown live service")
    receipt = {
        "kind": entry["kind"],
        "commit": entry["commit"],
        "checked_at": entry["checked_at"],
        "artifact_sha256": sha256(data),
        "observer_identity": "attested_not_authenticated",
        "observation_count": len(observations),
    }
    return document, receipt


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("release redirects are not accepted")


class ReleaseMeta(HTMLParser):
    def __init__(self):
        super().__init__()
        self.commits: list[str | None] = []

    def handle_starttag(self, tag, attrs):
        fields = dict(attrs)
        if tag.lower() == "meta" and fields.get("name") == "alethical-release-commit":
            self.commits.append(fields.get("content"))


def fetched_release(service: str, commit: str) -> dict:
    url = RELEASE_URLS[service]
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; AlethicalJobCompletion/1.0; +https://www.alethical.com)"
        },
    )
    with urllib.request.build_opener(NoRedirect()).open(
        request, timeout=20
    ) as response:
        if response.status != 200 or response.geturl() != url:
            raise ValueError("unexpected release response")
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("oversized release response")
    if service == "api":
        observed = bounded_json(data).get("commit")
    else:
        page = ReleaseMeta()
        page.feed(data.decode("utf-8"))
        observed = page.commits[0] if len(page.commits) == 1 else None
    if observed != commit:
        raise ValueError("live release does not match")
    return {
        "source": "Fixed deployed release identity",
        "service": service,
        "url": url,
        "commit": commit,
        "checked_at": utc_now(),
        "behavior": "attested separately, not established by release identity",
    }


def verify(state_dir: Path, candidate: dict) -> tuple[dict, dict, int]:
    if (
        not isinstance(candidate, dict)
        or set(candidate) != outcomes.FIELDS
        or candidate.get("state") != "completed"
        or not isinstance(candidate.get("job_id"), str)
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", candidate["job_id"])
    ):
        raise ValueError("invalid completion candidate")
    _, latest = outcomes.read_ledger(state_dir / "jobs.jsonl")
    previous = latest.get(candidate["job_id"])
    if previous is None or previous["started_at"] is None:
        raise ValueError("registered started job is required")
    if previous["state"] == "completed":
        raise ValueError(
            "completed job must be explicitly reopened before new completion"
        )
    revision = previous["revision"]
    record = copy.deepcopy(candidate)
    outcomes.validate_update(record, previous)
    outcomes.commit_field(record["result_commit"], "result_commit")
    target = (
        record["release_commit"] if record["deployable"] else record["result_commit"]
    )
    outcomes.commit_field(target, "target")
    # Checks are fetched below; a candidate cannot supply its own passing check.
    if not isinstance(record["evidence"], list):
        raise ValueError("invalid evidence")
    record["evidence"] = [
        entry
        for entry in record["evidence"]
        if not isinstance(entry, dict) or entry.get("kind") != "checks"
    ]
    provisional = copy.deepcopy(record)
    provisional.update(state="in_progress", finished_at=None)
    outcomes.validate(provisional)
    required = (
        {"review"}
        | ({"browser"} if record["ui"] else set())
        | ({"live"} if record["deployable"] else set())
    )
    by_kind = {entry["kind"]: entry for entry in record["evidence"]}
    if not required <= by_kind.keys():
        raise ValueError("required behavior evidence is missing")
    attestations = []
    live_service = None
    for kind in sorted(by_kind):
        entry = by_kind[kind]
        if entry["commit"] != target or entry["outcome"] != "passed":
            raise ValueError("attestation is not for final commit")
        document, receipt = artifact(state_dir, entry)
        attestations.append(receipt)
        if kind == "live":
            live_service = document["service"]
    checks = fetched_checks(target)
    release = fetched_release(live_service, target) if live_service else None
    finish = utc_now()
    receipt = {
        "schema_version": 1,
        "job_id": record["job_id"],
        "expected_revision": revision,
        "target_commit": target,
        "checked_at": finish,
        "machine_fetched": {"checks": checks, "release": release},
        "attested_artifacts": attestations,
        "limitations": "Observer identities and behavior observations are attested; event coverage, help, repeats and cost are not inferred",
    }
    reference = f"completion-receipts/{record['job_id']}-{sha256(json.dumps(receipt, sort_keys=True).encode())}.json"
    record["evidence"].insert(
        0,
        {
            "kind": "checks",
            "commit": target,
            "checked_at": checks["checked_at"],
            "outcome": "passed",
            "reference": reference,
            "observer": "github-api",
        },
    )
    record["finished_at"] = finish
    outcomes.validate(record)
    # Read-only verification also refuses a changed record, without writing.
    _, current = outcomes.read_ledger(state_dir / "jobs.jsonl")
    if current[record["job_id"]]["revision"] != revision:
        raise ValueError("job changed during verification")
    return record, receipt, revision


def write_completion(
    state_dir: Path, record: dict, receipt: dict, revision: int
) -> dict:
    if state_dir.is_symlink():
        raise ValueError("unsafe state location")
    directory = state_dir / "evidence" / "completion-receipts"
    if (state_dir / "evidence").is_symlink() or directory.is_symlink():
        raise ValueError("unsafe receipt location")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(state_dir, 0o700)
    os.chmod(state_dir / "evidence", 0o700)
    os.chmod(directory, 0o700)
    path = directory / Path(record["evidence"][0]["reference"]).name
    data = json.dumps(receipt, sort_keys=True, allow_nan=False).encode()
    descriptor = os.open(
        path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
    )
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    return outcomes.save_record(
        state_dir / "jobs.jsonl", record, update=True, expected_revision=revision
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE_DIR)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args(argv)
    try:
        record, receipt, revision = verify(
            args.state_dir, bounded_json(read_file(args.input))
        )
        if args.write:
            saved = write_completion(args.state_dir, record, receipt, revision)
            output = {
                "job_id": saved["job_id"],
                "state": saved["state"],
                "revision": saved["revision"],
                "receipt": receipt,
            }
        else:
            output = {"write_performed": False, "candidate": record, "receipt": receipt}
        print(json.dumps(output, sort_keys=True, allow_nan=False))
        return 0
    except (
        OSError,
        ValueError,
        TypeError,
        KeyError,
        subprocess.SubprocessError,
        RecursionError,
    ):
        print(SAFE_ERROR, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
