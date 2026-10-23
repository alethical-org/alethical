"""A successful unrelated or stale runtime job never clears this release."""

import importlib.util
from pathlib import Path
import sys
from datetime import datetime, timezone
import io
import json
import zipfile
from types import SimpleNamespace
import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts/check_pillow_exception.py"
sys.path.insert(0, str(ROOT))
SPEC = importlib.util.spec_from_file_location("pillow_exception", SCRIPT)
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


def fixture():
    now = datetime(2026, 10, 23, tzinfo=timezone.utc).timestamp()
    request = {
        "event": "workflow_run",
        "run_id": "456",
        "run_attempt": "2",
        "head_sha": "b" * 40,
    }
    run = {
        "id": 123,
        "run_attempt": 1,
        "workflow_id": 99,
        "path": CHECK.PATH,
        "head_branch": "main",
        "head_sha": "a" * 40,
        "event": "workflow_run",
        "status": "completed",
        "conclusion": "success",
        "head_repository": {"full_name": CHECK.REPO},
    }
    proof = {
        "schema": 1,
        "issuer_run_id": "123",
        "issuer_run_attempt": "1",
        "issuer_sha": "a" * 40,
        "request": request.copy(),
        "runtime": {
            "schema_version": 1,
            "project_id": "82c4cf9a-9a48-469b-bc71-8afd05339955",
            "environment_id": "2555565c-2352-4cfe-b3ff-8073003c97a1",
            "service_id": "e5d405e3-5d8b-43a0-83e9-780e6627e1ca",
            "saved_pillow_alignment_present": False,
            "pillow_alignment_present": False,
            "pyarrow_importable": False,
            "pyarrow_installed": False,
            "pillow_version": "13.0.0",
            "renderer_sha256": "33a2f50db0ddd2bda981a131a8e6d4d2c27e9b0ebfcd04f03d10201b32533e92",
            "deployed_source_guard_passed": True,
            "app_environment_verified": True,
            "started_at": "2026-10-23T00:00:00Z",
            "checked_at": "2026-10-23T00:00:01Z",
            "deployments": [
                {
                    "deployment_id": "83d992b3-6d98-4f75-965d-840c91a92810",
                    "commit_sha": "c" * 40,
                    "instance_ids": ["820cf286-6972-460e-a685-8b89e5b43ab9"],
                    "configured_replicas": 1,
                }
            ],
        },
    }
    return proof, run, request, 99, now, now + 2


def test_verified_bound_proof():
    CHECK.validate(*fixture())


@pytest.mark.parametrize(
    "key,value",
    [
        ("workflow_id", 2),
        ("path", "fake.yml"),
        ("head_branch", "evil"),
        ("event", "pull_request"),
        ("status", "in_progress"),
        ("conclusion", "failure"),
        ("head_repository", {"full_name": "fork/alethical"}),
    ],
)
def test_other_issuer_is_rejected(key, value):
    args = fixture()
    args[1][key] = value
    with pytest.raises(CHECK.Unavailable):
        CHECK.validate(*args)


@pytest.mark.parametrize(
    "key,value",
    [
        ("issuer_run_id", "124"),
        ("issuer_run_attempt", "2"),
        ("issuer_sha", "b" * 40),
        ("request", {"event": "workflow_dispatch", "nonce": "a" * 32}),
    ],
)
def test_other_request_attempt_or_revision_is_rejected(key, value):
    args = fixture()
    args[0][key] = value
    with pytest.raises(CHECK.Unavailable):
        CHECK.validate(*args)


@pytest.mark.parametrize(
    "key,value",
    [
        ("pillow_alignment_present", True),
        ("saved_pillow_alignment_present", True),
        ("pyarrow_importable", True),
        ("pyarrow_installed", True),
        ("deployed_source_guard_passed", False),
        ("app_environment_verified", False),
        ("pillow_version", "13.0.1"),
        ("renderer_sha256", "f" * 64),
        ("pillow_alignment_present", 0),
        ("started_at", "2026-10-22T23:00:00Z"),
        ("checked_at", "2026-10-23T01:00:00Z"),
    ],
)
def test_runtime_drift_or_invalid_time_is_rejected(key, value):
    args = fixture()
    args[0]["runtime"][key] = value
    with pytest.raises(CHECK.Unavailable):
        CHECK.validate(*args)


def test_old_runtime_is_rejected():
    args = list(fixture())
    args[-1] += 3600
    with pytest.raises(CHECK.Unavailable):
        CHECK.validate(*args)


def test_missing_replica_is_rejected():
    args = fixture()
    args[0]["runtime"]["deployments"][0]["configured_replicas"] = 2
    with pytest.raises(CHECK.Unavailable):
        CHECK.validate(*args)


def test_repeated_instance_is_rejected():
    args = fixture()
    d = args[0]["runtime"]["deployments"][0]
    d["instance_ids"] *= 2
    d["configured_replicas"] = 2
    with pytest.raises(CHECK.Unavailable):
        CHECK.validate(*args)


def test_other_ci_workflow_cannot_request_proof(monkeypatch):
    monkeypatch.setattr(CHECK, "api", lambda *args: {"path": "other.yml"})
    with pytest.raises(CHECK.Unavailable):
        CHECK.request(
            {
                "GITHUB_ACTIONS": "true",
                "GITHUB_REPOSITORY": CHECK.REPO,
                "GITHUB_RUN_ID": "1",
                "GITHUB_RUN_ATTEMPT": "1",
            }
        )


def test_local_dispatch_has_fixed_ref_and_unique_nonce(monkeypatch):
    calls = []
    monkeypatch.setattr(CHECK, "api", lambda *args: calls.append(args))
    expected, label, _ = CHECK.request({})
    assert expected == {"event": "workflow_dispatch", "nonce": label}
    assert len(label) == 32
    assert calls == [
        (
            f"repos/{CHECK.REPO}/actions/workflows/pillow-runtime.yml/dispatches",
            {"ref": "main", "inputs": {"nonce": label}},
        )
    ]


def zipped_proof(proof, name="runtime-proof.json"):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(name, json.dumps(proof))
    return output.getvalue()


def artifact_metadata(run, *, attempt=None, identity=321):
    return {
        "id": identity,
        "name": f"pillow-runtime-proof-{run['run_attempt'] if attempt is None else attempt}",
        "expired": False,
        "size_in_bytes": 1000,
        "workflow_run": {"id": run["id"], "head_sha": run["head_sha"]},
    }


def test_transport_pins_github_host_and_never_logs_provider_text(monkeypatch):
    calls = []

    def invoke(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(returncode=0, stdout=b"{}")

    monkeypatch.setattr(CHECK.subprocess, "run", invoke)
    assert CHECK.gh("repos/example/repo", {"ref": "main"}) == b"{}"
    command, kwargs = calls[0]
    assert command == [
        "gh",
        "api",
        "--hostname",
        "github.com",
        "repos/example/repo",
        "--method",
        "POST",
        "--input",
        "-",
    ]
    assert json.loads(kwargs["input"]) == {"ref": "main"}
    assert kwargs["capture_output"] and kwargs["timeout"] == 30


@pytest.mark.parametrize("kind", ["exit", "oversized", "timeout"])
def test_transport_failures_are_closed_and_sanitized(monkeypatch, kind):
    def invoke(*args, **kwargs):
        if kind == "timeout":
            raise CHECK.subprocess.TimeoutExpired("private", 30)
        return SimpleNamespace(
            returncode=1 if kind == "exit" else 0,
            stdout=b"x" * (1_000_001 if kind == "oversized" else 10),
        )

    monkeypatch.setattr(CHECK.subprocess, "run", invoke)
    with pytest.raises(CHECK.Unavailable) as failure:
        CHECK.gh("repos/example/repo")
    assert "private" not in str(failure.value)


def test_rerun_selects_only_current_attempt_artifact(monkeypatch):
    proof, run, *_ = fixture()
    run["run_attempt"] = 2
    proof["issuer_run_attempt"] = "2"
    rows = [artifact_metadata(run, attempt=1, identity=320), artifact_metadata(run)]
    downloads = []
    monkeypatch.setattr(CHECK, "api", lambda endpoint: {"artifacts": rows})

    def download(endpoint):
        downloads.append(endpoint)
        return zipped_proof(proof)

    monkeypatch.setattr(CHECK, "gh", download)
    assert CHECK.artifact(run) == proof
    assert downloads == [f"repos/{CHECK.REPO}/actions/artifacts/321/zip"]


def test_old_attempt_artifact_alone_never_satisfies_rerun(monkeypatch):
    _, run, *_ = fixture()
    run["run_attempt"] = 2
    monkeypatch.setattr(
        CHECK,
        "api",
        lambda endpoint: {"artifacts": [artifact_metadata(run, attempt=1)]},
    )

    def forbidden(*_):
        pytest.fail("An old attempt must not be downloaded")

    monkeypatch.setattr(CHECK, "gh", forbidden)
    with pytest.raises(CHECK.Unavailable):
        CHECK.artifact(run)


@pytest.mark.parametrize(
    "kind", ["missing", "duplicate", "expired", "oversized", "wrong_run", "wrong_sha"]
)
def test_missing_or_invalid_artifact_rejected_before_download(monkeypatch, kind):
    _, run, *_ = fixture()
    row = artifact_metadata(run)
    rows = [row]
    if kind == "missing":
        rows = []
    elif kind == "duplicate":
        rows.append(dict(row))
    elif kind == "expired":
        row["expired"] = True
    elif kind == "oversized":
        row["size_in_bytes"] = 65536
    elif kind == "wrong_run":
        row["workflow_run"]["id"] += 1
    elif kind == "wrong_sha":
        row["workflow_run"]["head_sha"] = "f" * 40
    monkeypatch.setattr(CHECK, "api", lambda endpoint: {"artifacts": rows})

    def forbidden(*_):
        pytest.fail("Invalid metadata must not be downloaded")

    monkeypatch.setattr(CHECK, "gh", forbidden)
    with pytest.raises(CHECK.Unavailable):
        CHECK.artifact(run)


@pytest.mark.parametrize(
    "kind",
    [
        "not_zip",
        "wrong_member",
        "oversized_member",
        "extra_member",
        "duplicate_json",
        "invalid_json",
    ],
)
def test_unexpected_archive_content_rejected(monkeypatch, kind):
    proof, run, *_ = fixture()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        name = "wrong.json" if kind == "wrong_member" else "runtime-proof.json"
        payload = json.dumps(proof)
        if kind == "oversized_member":
            payload = "x" * 32769
        elif kind == "duplicate_json":
            payload = '{"schema":1,"schema":1}'
        elif kind == "invalid_json":
            payload = "{"
        archive.writestr(name, payload)
        if kind == "extra_member":
            archive.writestr("extra.txt", "ignored")
    raw = b"not a zip" if kind == "not_zip" else output.getvalue()
    monkeypatch.setattr(
        CHECK, "api", lambda endpoint: {"artifacts": [artifact_metadata(run)]}
    )
    monkeypatch.setattr(CHECK, "gh", lambda endpoint: raw)
    with pytest.raises(CHECK.Unavailable):
        CHECK.artifact(run)


def test_poll_waits_then_validates_current_success(monkeypatch):
    proof, run, expected, workflow_id, earliest, now = fixture()
    label = "456-2"
    run["display_title"] = "Pillow runtime " + label
    monkeypatch.setattr(CHECK, "request", lambda env: (expected, label, earliest))
    listings = iter([[], [{**run, "status": "in_progress", "conclusion": None}], [run]])

    def api(endpoint):
        if "/runs?" in endpoint:
            return {"workflow_runs": next(listings)}
        return {"path": CHECK.PATH, "id": workflow_id, "state": "active"}

    monkeypatch.setattr(CHECK, "api", api)
    monkeypatch.setattr(
        CHECK,
        "artifact",
        lambda selected: proof if selected == run else pytest.fail("wrong issuer"),
    )
    monkeypatch.setattr(CHECK.time, "time", lambda: now)
    monkeypatch.setattr(CHECK.time, "sleep", lambda _: None)
    CHECK.runtime_check({})


def test_failed_latest_issuer_cannot_fall_back_to_old_success(monkeypatch):
    _, run, expected, workflow_id, earliest, _ = fixture()
    label = "456-2"
    run["display_title"] = "Pillow runtime " + label
    newest = {**run, "id": run["id"] + 1, "conclusion": "failure"}
    monkeypatch.setattr(CHECK, "request", lambda env: (expected, label, earliest))
    monkeypatch.setattr(
        CHECK,
        "api",
        lambda endpoint: (
            {"workflow_runs": [run, newest]}
            if "/runs?" in endpoint
            else {"path": CHECK.PATH, "id": workflow_id, "state": "active"}
        ),
    )
    monkeypatch.setattr(
        CHECK, "artifact", lambda _: pytest.fail("No failed issuer may supply proof")
    )
    with pytest.raises(CHECK.Unavailable):
        CHECK.runtime_check({})


def test_poll_times_out_without_reusing_other_title(monkeypatch):
    _, run, expected, workflow_id, earliest, _ = fixture()
    run["display_title"] = "Pillow runtime other-request"
    monkeypatch.setattr(CHECK, "request", lambda env: (expected, "456-2", earliest))
    monkeypatch.setattr(
        CHECK,
        "api",
        lambda endpoint: (
            {"workflow_runs": [run]}
            if "/runs?" in endpoint
            else {"path": CHECK.PATH, "id": workflow_id, "state": "active"}
        ),
    )
    ticks = iter([0, 1, CHECK.MAX_WAIT + 1])
    monkeypatch.setattr(CHECK.time, "monotonic", lambda: next(ticks))
    monkeypatch.setattr(CHECK.time, "sleep", lambda _: None)
    with pytest.raises(CHECK.Unavailable, match="Timed out"):
        CHECK.runtime_check({})
