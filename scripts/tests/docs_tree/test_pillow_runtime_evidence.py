"""Evidence from another branch, workflow or request cannot satisfy this check."""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "pillow_runtime_evidence", ROOT / "scripts/pillow_runtime_evidence.py"
)
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


def environment():
    return {
        "GITHUB_REPOSITORY": CHECK.REPOSITORY,
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_WORKFLOW_REF": f"{CHECK.REPOSITORY}/{CHECK.WORKFLOW_PATH}@refs/heads/main",
        "GITHUB_RUN_ID": "123",
        "GITHUB_RUN_ATTEMPT": "2",
        "GITHUB_SHA": "a" * 40,
        "GITHUB_EVENT_NAME": "workflow_dispatch",
    }


def test_local_nonce_is_bound_without_interpretation():
    proof = CHECK.binding({"inputs": {"nonce": "a" * 32}}, environment())
    assert proof["request"] == {"event": "workflow_dispatch", "nonce": "a" * 32}
    assert proof["issuer_run_attempt"] == "2"


@pytest.mark.parametrize("nonce", [None, "", "a" * 31, "../main", "$(echo bad)", 1])
def test_invalid_nonce_rejected(nonce):
    with pytest.raises(ValueError):
        CHECK.binding({"inputs": {"nonce": nonce}}, environment())


@pytest.mark.parametrize(
    "key,value",
    [
        ("GITHUB_REPOSITORY", "fork/alethical"),
        ("GITHUB_REF", "refs/heads/untrusted"),
        ("GITHUB_WORKFLOW_REF", "other"),
        ("GITHUB_RUN_ID", "0"),
        ("GITHUB_RUN_ATTEMPT", "-1"),
        ("GITHUB_SHA", "main"),
        ("GITHUB_EVENT_NAME", "pull_request_target"),
    ],
)
def test_untrusted_issuer_rejected(key, value):
    env = environment()
    env[key] = value
    with pytest.raises(ValueError):
        CHECK.binding({"inputs": {"nonce": "a" * 32}}, env)


def ci_event():
    return {
        "action": "in_progress",
        "workflow_run": {
            "repository": {"full_name": CHECK.REPOSITORY},
            "name": "CI",
            "path": ".github/workflows/ci.yml",
            "id": 456,
            "run_attempt": 3,
            "head_sha": "b" * 40,
        },
    }


def test_ci_binding_carries_exact_attempt_and_head():
    env = {**environment(), "GITHUB_EVENT_NAME": "workflow_run"}
    assert CHECK.binding(ci_event(), env)["request"] == {
        "event": "workflow_run",
        "run_id": "456",
        "run_attempt": "3",
        "head_sha": "b" * 40,
    }


@pytest.mark.parametrize(
    "key,value",
    [
        ("name", "Other"),
        ("path", "other.yml"),
        ("id", None),
        ("run_attempt", 0),
        ("head_sha", "main"),
        ("repository", {"full_name": "fork/alethical"}),
    ],
)
def test_other_trigger_cannot_claim_ci_evidence(key, value):
    event = ci_event()
    event["workflow_run"][key] = value
    with pytest.raises(ValueError):
        CHECK.binding(event, {**environment(), "GITHUB_EVENT_NAME": "workflow_run"})
