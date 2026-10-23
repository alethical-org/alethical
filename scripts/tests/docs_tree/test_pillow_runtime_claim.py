"""Only the first trusted run for a request may probe production."""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "pillow_runtime_claim", ROOT / "scripts/pillow_runtime_claim.py"
)
CLAIM = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLAIM)

LABEL = "39992218510-1"


def run(run_id, label=LABEL, branch="main"):
    return {
        "id": run_id,
        "display_title": "Pillow runtime " + label,
        "head_branch": branch,
    }


def test_earliest_copy_owns_the_request():
    runs = [run(30), run(10), run(20), run(5, label="other-1"), run(1, branch="x")]
    assert CLAIM.is_first(runs, LABEL, 10) is True
    assert CLAIM.is_first(runs, LABEL, 20) is False
    assert CLAIM.is_first(runs, LABEL, 30) is False


def test_a_run_missing_from_its_own_listing_fails():
    with pytest.raises(ValueError):
        CLAIM.is_first([run(10)], LABEL, 11)


@pytest.mark.parametrize(
    "value", ["", "0-1", "12-0", "abc", "a" * 31, "A" * 32, "12-1; rm -rf /", None]
)
def test_only_known_request_labels_are_accepted(value):
    with pytest.raises(ValueError):
        CLAIM.label(value)


@pytest.mark.parametrize("value", ["a" * 32, "0123456789abcdef" * 2, "1-1", LABEL])
def test_request_labels_from_both_triggers_are_accepted(value):
    assert CLAIM.label(value) == value


def environment(tmp_path, **overrides):
    env = {
        "GITHUB_REPOSITORY": CLAIM.REPOSITORY,
        "GITHUB_EVENT_NAME": "workflow_run",
        "GITHUB_RUN_ID": "20",
        "GITHUB_OUTPUT": str(tmp_path / "output"),
        "GH_TOKEN": "fake-token",
        "REQUEST": LABEL,
    }
    env.update(overrides)
    return env


@pytest.mark.parametrize("run_id,first", [("10", "true"), ("20", "false")])
def test_main_writes_only_the_decision(monkeypatch, tmp_path, run_id, first):
    monkeypatch.setattr(CLAIM, "runs", lambda token, event: [run(10), run(20)])
    assert CLAIM.main(environment(tmp_path, GITHUB_RUN_ID=run_id)) == 0
    assert (tmp_path / "output").read_text() == f"first={first}\n"


@pytest.mark.parametrize(
    "overrides",
    [
        {"GITHUB_REPOSITORY": "someone/else"},
        {"GITHUB_EVENT_NAME": "pull_request"},
        {"GITHUB_RUN_ID": "not-a-number"},
        {"REQUEST": "bad label"},
    ],
)
def test_unexpected_context_fails_closed(monkeypatch, tmp_path, overrides, capsys):
    monkeypatch.setattr(CLAIM, "runs", lambda token, event: [run(20)])
    assert CLAIM.main(environment(tmp_path, **overrides)) == 1
    assert not (tmp_path / "output").exists()
    assert "fake-token" not in "".join(capsys.readouterr())


def test_unreadable_listing_fails_closed(monkeypatch, tmp_path):
    def unavailable(token, event):
        raise OSError("private network detail")

    monkeypatch.setattr(CLAIM, "runs", unavailable)
    assert CLAIM.main(environment(tmp_path)) == 1
    assert not (tmp_path / "output").exists()


def test_workflow_probes_only_in_the_claimed_run():
    workflow = (ROOT / ".github/workflows/pillow-runtime.yml").read_text()
    claim, verify = workflow.split("  claim:\n", 1)[1].split("  verify:\n", 1)
    assert "environment:" not in claim
    assert "secrets." not in claim
    assert "python3 scripts/pillow_runtime_claim.py" in claim
    assert "needs: claim" in verify
    assert "needs.claim.outputs.first == 'true'" in verify
    assert "environment: pillow-security-runtime" in verify


def test_every_deadline_nests_inside_the_one_that_waits_for_it():
    runtime_spec = importlib.util.spec_from_file_location(
        "pillow_runtime_deadlines", ROOT / "scripts/check_pillow_runtime.py"
    )
    runtime = importlib.util.module_from_spec(runtime_spec)
    runtime_spec.loader.exec_module(runtime)
    exception_spec = importlib.util.spec_from_file_location(
        "pillow_exception_deadlines", ROOT / "scripts/check_pillow_exception.py"
    )
    exception = importlib.util.module_from_spec(exception_spec)
    exception_spec.loader.exec_module(exception)
    workflow = (ROOT / ".github/workflows/pillow-runtime.yml").read_text()
    verify = workflow.split("  verify:\n", 1)[1]
    job_seconds = int(verify.split("timeout-minutes: ", 1)[1].split()[0]) * 60
    scanner = (ROOT / "scripts/check_technology_health.py").read_text()
    call = scanner.split('"scripts.check_pillow_exception"]', 1)[1]
    scanner_seconds = int(call.split("timeout=", 1)[1].split(",", 1)[0])
    proof_seconds = runtime.SETTLE_SECONDS + runtime.PROOF_SECONDS
    # Runner startup, the claim job and artifact upload sit between each level.
    assert proof_seconds + 60 <= job_seconds
    assert job_seconds <= exception.MAX_WAIT
    assert exception.MAX_WAIT + 60 <= scanner_seconds
