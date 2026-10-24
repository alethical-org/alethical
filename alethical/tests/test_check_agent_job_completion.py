"""Synthetic attestations and fake remote responses; no live network calls."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from scripts import check_agent_job_completion as completion

ORIGINAL_GITHUB_JSON = completion.github_json

SHA = "a" * 40
OTHER = "b" * 40
START = "2026-01-01T10:00:00+00:00"
CHECKED = "2026-01-01T10:01:00+00:00"


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Synthetic tests must not contact a real service")

    monkeypatch.setattr(completion, "github_json", forbidden)
    monkeypatch.setattr(completion.urllib.request, "build_opener", forbidden)


def setup_job(tmp_path: Path, *, ui=False, deployable=False):
    state = tmp_path / "private"
    state.mkdir()
    job = completion.outcomes.template(
        "synthetic-job", "Synthetic job", "synthetic-author"
    )
    job.update(state="in_progress", started_at=START, ui=ui, deployable=deployable)
    completion.outcomes.save_record(state / "jobs.jsonl", job)
    candidate = copy.deepcopy(job)
    candidate.update(
        state="completed",
        finished_at=CHECKED,
        result_commit=SHA,
        release_commit=SHA if deployable else None,
    )
    root = state / "evidence"
    root.mkdir()
    for kind in (
        ["review"] + (["browser"] if ui else []) + (["live"] if deployable else [])
    ):
        entry = {
            "kind": kind,
            "commit": SHA,
            "checked_at": CHECKED,
            "outcome": "passed",
            "observer": "synthetic-independent",
            "reference": f"{kind}.json",
        }
        candidate["evidence"].append(entry)
        document = {key: value for key, value in entry.items() if key != "reference"}
        document["observations"] = ["SYNTHETIC_PRIVATE_OBSERVATION_NEVER_COPY"]
        if kind == "live":
            document["service"] = "website"
        (root / f"{kind}.json").write_text(json.dumps(document))
    return state, candidate


def run(
    name, identity, *, app=11, conclusion="success", status="completed", commit=SHA
):
    return {
        "name": name,
        "id": identity,
        "head_sha": commit,
        "app": {"id": app},
        "status": status,
        "conclusion": conclusion,
        "output": {"text": "SYNTHETIC_PRIVATE_API_OUTPUT"},
        "details_url": "https://example.invalid/private",
    }


def fake_github(monkeypatch, runs=None, required=None):
    required = (
        required
        if required is not None
        else [
            {"context": "changes", "app_id": 11},
            {"context": "description-checks", "app_id": 11},
            {"context": "backend", "app_id": 11},
            {"context": "frontend", "app_id": 11},
        ]
    )
    runs = (
        runs
        if runs is not None
        else [
            run(
                name,
                index + 1,
                conclusion="skipped" if name in {"backend", "frontend"} else "success",
            )
            for index, name in enumerate(
                ["changes", "description-checks", "backend", "frontend"]
            )
        ]
    )
    calls = []

    def fetch(endpoint):
        calls.append(endpoint)
        if endpoint == completion.PROTECTION:
            return {
                "contexts": [item["context"] for item in required],
                "checks": required,
            }
        page = int(endpoint.rsplit("=", 1)[1])
        return {
            "total_count": len(runs),
            "check_runs": runs[(page - 1) * 100 : page * 100],
        }

    monkeypatch.setattr(completion, "github_json", fetch)
    return calls


class Response:
    def __init__(self, data, url, status=200):
        self.data, self.url, self.status = data, url, status

    def read(self, limit):
        return self.data[:limit]

    def geturl(self):
        return self.url

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None


def fake_release(monkeypatch, data=None, service="website", url=None, status=200):
    fixed = completion.RELEASE_URLS[service]
    data = (
        data
        if data is not None
        else f'<meta name="alethical-release-commit" content="{SHA}">'.encode()
    )

    class Opener:
        def open(self, request, timeout):
            assert request.full_url == fixed
            assert timeout == 20
            return Response(data, url or fixed, status)

    monkeypatch.setattr(
        completion.urllib.request, "build_opener", lambda *args: Opener()
    )


def test_read_only_checks_and_skips_are_reported_without_private_content(
    tmp_path: Path, monkeypatch
):
    state, candidate = setup_job(tmp_path, ui=True, deployable=True)
    calls = fake_github(monkeypatch)
    fake_release(monkeypatch)
    before = {
        path.relative_to(state): path.read_bytes()
        for path in state.rglob("*")
        if path.is_file()
    }
    record, receipt, revision = completion.verify(state, candidate)
    assert revision == 1
    assert record["finished_at"] != candidate["finished_at"]
    assert record["started_at"] == START
    checks = receipt["machine_fetched"]["checks"]["required_checks"]
    assert {
        item["execution"]
        for item in checks
        if item["context"] in {"backend", "frontend"}
    } == {"skipped_not_executed"}
    assert receipt["machine_fetched"]["release"]["commit"] == SHA
    assert all(
        len(item["artifact_sha256"]) == 64 for item in receipt["attested_artifacts"]
    )
    assert "SYNTHETIC_PRIVATE" not in json.dumps(receipt)
    assert "example.invalid" not in json.dumps(receipt)
    assert all(
        "attested" in item["observer_identity"]
        for item in receipt["attested_artifacts"]
    )
    assert len(calls) == 2
    assert {
        path.relative_to(state): path.read_bytes()
        for path in state.rglob("*")
        if path.is_file()
    } == before


def test_write_uses_fetched_receipt_and_private_permissions(
    tmp_path: Path, monkeypatch
):
    state, candidate = setup_job(tmp_path)
    fake_github(monkeypatch)
    record, receipt, revision = completion.verify(state, candidate)
    saved = completion.write_completion(state, record, receipt, revision)
    assert saved["state"] == "completed"
    assert saved["revision"] == 2
    assert saved["human_interventions"] is None
    assert saved["repeats"] is None
    assert saved["ai_cost_usd"] is None
    reference = saved["evidence"][0]["reference"]
    path = state / "evidence" / reference
    assert json.loads(path.read_text()) == receipt
    assert path.stat().st_mode & 0o777 == 0o600
    assert path.parent.stat().st_mode & 0o777 == 0o700
    assert saved["evidence"][0]["observer"] == "github-api"


@pytest.mark.parametrize(
    "mutation", ["title", "agent", "started_at", "ui", "deployable"]
)
def test_registered_identity_start_and_obligations_are_preserved(
    tmp_path: Path, mutation: str
):
    state, candidate = setup_job(tmp_path, ui=True, deployable=True)
    if mutation in {"ui", "deployable"}:
        candidate[mutation] = False
    elif mutation == "started_at":
        candidate[mutation] = CHECKED
    else:
        candidate[mutation] = "synthetic-change"
    with pytest.raises(ValueError):
        completion.verify(state, candidate)


def test_unregistered_job_is_refused_before_api(tmp_path: Path):
    state, candidate = setup_job(tmp_path)
    candidate["job_id"] = "synthetic-unknown"
    with pytest.raises(ValueError, match="registered"):
        completion.verify(state, candidate)


@pytest.mark.parametrize(
    "protection",
    [
        {},
        {"contexts": [], "checks": []},
        {"contexts": ["changes"], "checks": [{"context": "changes"}]},
        {"contexts": ["changes"], "checks": [{"context": "changes", "app_id": "11"}]},
        {"contexts": "changes", "checks": []},
    ],
)
def test_missing_or_malformed_required_policy_refuses(protection):
    with pytest.raises(ValueError):
        completion.required_checks(protection)


@pytest.mark.parametrize(
    "change",
    [
        "missing",
        "wrong_app",
        "stale",
        "pending",
        "failure",
        "skip_changes",
        "skip_description",
        "newer_failure",
    ],
)
def test_check_failures_refuse_completion(monkeypatch, change: str):
    runs = [
        run(name, index + 1)
        for index, name in enumerate(
            ["changes", "description-checks", "backend", "frontend"]
        )
    ]
    if change == "missing":
        runs.pop()
    elif change == "wrong_app":
        runs[0]["app"]["id"] = 12
    elif change == "stale":
        runs[0]["head_sha"] = OTHER
    elif change == "pending":
        runs[0].update(status="in_progress", conclusion=None)
    elif change == "failure":
        runs[0]["conclusion"] = "failure"
    elif change == "skip_changes":
        runs[0]["conclusion"] = "skipped"
    elif change == "skip_description":
        runs[1]["conclusion"] = "skipped"
    else:
        runs.append(run("changes", 100, conclusion="failure"))
    fake_github(monkeypatch, runs)
    with pytest.raises(ValueError):
        completion.fetched_checks(SHA)


def test_paginated_exact_app_matching_uses_latest_run(monkeypatch):
    runs = [run("unrequired", index + 1) for index in range(100)]
    runs.extend(
        [
            run("changes", 101, conclusion="failure"),
            run("changes", 102),
            run("changes", 103, app=12, conclusion="failure"),
        ]
    )
    calls = fake_github(monkeypatch, runs, [{"context": "changes", "app_id": 11}])
    checks = completion.fetched_checks(SHA)["required_checks"]
    assert checks[0]["run_id"] == 102
    assert checks[0]["observed_app_id"] == 11
    assert len(calls) == 3


@pytest.mark.parametrize(
    "change",
    [
        "escape",
        "absolute",
        "symlink",
        "mismatch",
        "empty",
        "extra",
        "oversize",
        "wrong_observer",
        "wrong_service",
    ],
)
def test_artifact_errors_refuse(tmp_path: Path, change: str):
    state, candidate = setup_job(tmp_path, deployable=change == "wrong_service")
    entry = candidate["evidence"][0]
    path = state / "evidence" / entry["reference"]
    document = json.loads(path.read_text())
    if change == "escape":
        entry["reference"] = "../private.json"
    elif change == "absolute":
        entry["reference"] = str(path)
    elif change == "symlink":
        moved = state / "synthetic-outside.json"
        path.rename(moved)
        path.symlink_to(moved)
    elif change == "oversize":
        path.write_bytes(b"x" * (completion.MAX_BYTES + 1))
    elif change == "wrong_service":
        entry = candidate["evidence"][-1]
        path = state / "evidence" / entry["reference"]
        document = json.loads(path.read_text())
        document["service"] = "https://example.invalid/private"
        path.write_text(json.dumps(document))
    else:
        if change == "mismatch":
            document["commit"] = OTHER
        elif change == "empty":
            document["observations"] = []
        elif change == "extra":
            document["prompt"] = "synthetic-private"
        else:
            document["observer"] = "synthetic-wrong"
        path.write_text(json.dumps(document))
    with pytest.raises(ValueError):
        completion.artifact(state, entry)


@pytest.mark.parametrize("service", ["website", "api"])
def test_fixed_live_release_identity(monkeypatch, service: str):
    data = json.dumps({"commit": SHA}).encode() if service == "api" else None
    fake_release(monkeypatch, data, service)
    assert completion.fetched_release(service, SHA)["commit"] == SHA


@pytest.mark.parametrize(
    "change", ["redirect", "oversize", "mismatch", "missing", "duplicate", "status"]
)
def test_bad_live_release_is_refused(monkeypatch, change: str):
    data, url, status = None, None, 200
    if change == "redirect":
        url = "https://example.invalid/private"
    elif change == "oversize":
        data = b"x" * (completion.MAX_BYTES + 1)
    elif change == "mismatch":
        data = f'<meta name="alethical-release-commit" content="{OTHER}">'.encode()
    elif change == "missing":
        data = b"<html></html>"
    elif change == "duplicate":
        data = (f'<meta name="alethical-release-commit" content="{SHA}">' * 2).encode()
    else:
        status = 503
    fake_release(monkeypatch, data, url=url, status=status)
    with pytest.raises(ValueError):
        completion.fetched_release("website", SHA)


def test_redirect_handler_never_follows_destination():
    with pytest.raises(ValueError):
        completion.NoRedirect().redirect_request(
            None, None, 302, None, {}, "https://example.invalid/private"
        )


def test_pause_during_probe_prevents_even_read_only_completion(
    tmp_path: Path, monkeypatch
):
    state, candidate = setup_job(tmp_path)
    fake_github(monkeypatch)
    original = completion.github_json

    def fetch(endpoint):
        result = original(endpoint)
        if endpoint != completion.PROTECTION:
            _, latest = completion.outcomes.read_ledger(state / "jobs.jsonl")
            changed = {
                key: latest["synthetic-job"][key] for key in completion.outcomes.FIELDS
            }
            changed["state"] = "paused"
            completion.outcomes.save_record(state / "jobs.jsonl", changed, update=True)
        return result

    monkeypatch.setattr(completion, "github_json", fetch)
    with pytest.raises(ValueError, match="changed"):
        completion.verify(state, candidate)
    assert (
        completion.outcomes.read_ledger(state / "jobs.jsonl")[1]["synthetic-job"][
            "state"
        ]
        == "paused"
    )


def test_pause_after_probe_is_atomically_preserved_on_write(
    tmp_path: Path, monkeypatch
):
    state, candidate = setup_job(tmp_path)
    fake_github(monkeypatch)
    record, receipt, revision = completion.verify(state, candidate)
    _, latest = completion.outcomes.read_ledger(state / "jobs.jsonl")
    changed = {key: latest["synthetic-job"][key] for key in completion.outcomes.FIELDS}
    changed["state"] = "paused"
    completion.outcomes.save_record(state / "jobs.jsonl", changed, update=True)
    before = (state / "jobs.jsonl").read_bytes()
    with pytest.raises(ValueError, match="changed"):
        completion.write_completion(state, record, receipt, revision)
    assert (state / "jobs.jsonl").read_bytes() == before


def test_cli_api_error_never_echoes_exception_or_private_content(
    tmp_path: Path, monkeypatch, capsys
):
    state, candidate = setup_job(tmp_path)
    source = tmp_path / "candidate.json"
    source.write_text(json.dumps(candidate))

    def fail(endpoint):
        raise OSError("SYNTHETIC_PRIVATE_TOKEN_NEVER_PRINT")

    monkeypatch.setattr(completion, "github_json", fail)
    assert completion.main(["--state-dir", str(state), "--input", str(source)]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.strip() == completion.SAFE_ERROR
    assert "SYNTHETIC_PRIVATE" not in captured.err


def test_repeated_completion_cannot_move_original_finish(tmp_path: Path, monkeypatch):
    state, candidate = setup_job(tmp_path)
    fake_github(monkeypatch)
    record, receipt, revision = completion.verify(state, candidate)
    completion.write_completion(state, record, receipt, revision)
    before = (state / "jobs.jsonl").read_bytes()
    with pytest.raises(ValueError, match="explicitly reopened"):
        completion.verify(state, candidate)
    assert (state / "jobs.jsonl").read_bytes() == before
    _, latest = completion.outcomes.read_ledger(state / "jobs.jsonl")
    assert latest["synthetic-job"]["finished_at"] == record["finished_at"]
    assert completion.outcomes.report(latest)["registered_jobs"] == 1


def test_github_transport_pins_absolute_host_tool(tmp_path: Path, monkeypatch):
    from unittest.mock import Mock

    # No network or real command runs; selector reads an empty synthetic pipe.
    import os

    read_fd, write_fd = os.pipe()
    os.write(write_fd, b'{"contexts": [], "checks": []}')
    os.close(write_fd)
    process = Mock()
    process.stdout = os.fdopen(read_fd, "rb")
    process.wait.return_value = 0
    process.poll.return_value = 0
    captured = []

    def start(command, **kwargs):
        captured.append(command)
        return process

    monkeypatch.setattr(completion.subprocess, "Popen", start)
    monkeypatch.setenv("PATH", str(tmp_path))
    # Call the actual transport saved before this module's no-network fixture.
    assert ORIGINAL_GITHUB_JSON(completion.PROTECTION) == {"contexts": [], "checks": []}
    assert captured[0][0] in completion.GH_PATHS
    assert captured[0][1:4] == ["api", "--hostname", "github.com"]
