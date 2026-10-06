"""Replay dangerous recovery edges without deploying or calling outside APIs."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location(
    "website_recovery", SCRIPTS / "website_release_recovery.py"
)
assert spec and spec.loader
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)
HEAD = "b" * 40
SERVED = "a" * 40


def event(**changes):
    run = {
        "name": "Production release missing",
        "path": ".github/workflows/production-release-missing.yml",
        "event": "push",
        "head_branch": "main",
        "head_sha": HEAD,
        "head_repository": {"full_name": recovery.REPOSITORY},
        "status": "completed",
        "conclusion": "failure",
    }
    run.update(changes)
    return {"workflow_run": run}


@pytest.mark.parametrize(
    "changes",
    [
        {"event": "pull_request"},
        {"head_branch": "feature"},
        {"head_sha": SERVED},
        {"head_repository": {"full_name": "attacker/fork"}},
        {"path": ".github/workflows/other.yml"},
        {"conclusion": "success"},
        {"status": "in_progress"},
    ],
)
def test_untrusted_or_stale_runs_never_allow_repair(changes):
    assert not recovery.trusted_source(event(**changes), "workflow_run", HEAD)


def test_trusted_failed_main_alarm():
    assert recovery.trusted_source(event(), "workflow_run", HEAD)


def test_current_website_needs_no_credentials_or_deployment():
    with (
        patch.object(recovery, "current_main"),
        patch.object(recovery.release, "read_release_stamp", return_value=(HEAD, None)),
        patch.object(recovery.release, "known_commit", return_value=True),
        patch.object(recovery, "successful_ci") as ci,
    ):
        assert recovery.eligible(HEAD) == (False, HEAD)
        ci.assert_not_called()


@pytest.mark.parametrize(
    "problem,served", [("no-stamp", None), ("unreadable", None), (None, SERVED)]
)
def test_unknown_evidence_stops_instead_of_deploying(problem, served):
    with (
        patch.object(recovery, "current_main"),
        patch.object(
            recovery.release, "read_release_stamp", return_value=(served, problem)
        ),
        patch.object(recovery.release, "known_commit", return_value=False),
    ):
        with pytest.raises(recovery.StopRecovery):
            recovery.eligible(HEAD)


@pytest.mark.parametrize("verdict", [2])
def test_waiting_or_no_verdict_is_not_a_repair_trigger(verdict):
    with (
        patch.object(recovery, "current_main"),
        patch.object(
            recovery.release, "read_release_stamp", return_value=(SERVED, None)
        ),
        patch.object(recovery.release, "known_commit", return_value=True),
        patch.object(recovery.release, "is_ancestor", return_value=True),
        patch.object(recovery.release, "waiting_commits", return_value=[HEAD]),
        patch.object(recovery.release, "report", return_value=(verdict, "unused")),
        patch.object(recovery, "successful_ci") as ci,
    ):
        with pytest.raises(recovery.StopRecovery):
            recovery.eligible(HEAD)
        ci.assert_not_called()


@pytest.mark.parametrize("side_branch", [True, False])
def test_shared_checker_distinguishes_unknown_arrival_from_restored_inputs(
    tmp_path, side_branch
):
    def git(*args):
        return subprocess.run(
            ["git", *args], cwd=tmp_path, check=True, capture_output=True, text=True
        ).stdout.strip()

    git("init", "-q", "-b", "main")
    git("config", "user.email", "fixture@example.invalid")
    git("config", "user.name", "Synthetic fixture")
    source = tmp_path / "website.txt"
    source.write_text("Original released input")
    git("add", "website.txt")
    git("commit", "-qm", "Synthetic original input")
    served = git("rev-parse", "HEAD")
    if side_branch:
        git("checkout", "-qb", "feature")
    source.write_text("Changed input")
    git("commit", "-qam", "Synthetic changed input")
    changed = git("rev-parse", "HEAD")
    if side_branch:
        served = changed
        git("checkout", "-q", "main")
        git("merge", "--no-ff", "-s", "ours", "-m", "Synthetic ours merge", "feature")
    else:
        git("revert", "--no-edit", changed)
    head = git("rev-parse", "HEAD")
    shared_report = recovery.release.report

    def verdict(*args, **kwargs):
        return shared_report(
            *args,
            **kwargs,
            repo=tmp_path,
            paths=["website.txt"],
            read_arrival=lambda _: (None, "Synthetic unavailable timing"),
        )

    with (
        patch.object(recovery, "ROOT", tmp_path),
        patch.object(recovery, "current_main"),
        patch.object(
            recovery.release, "read_release_stamp", return_value=(served, None)
        ),
        patch.object(recovery.release, "report", side_effect=verdict),
        patch.object(recovery, "successful_ci") as ci,
    ):
        if side_branch:
            assert (
                recovery.release.waiting_commits(
                    tmp_path, served, head, ["website.txt"]
                )
                == []
            )
            with pytest.raises(recovery.StopRecovery, match="no mature verdict"):
                recovery.eligible(head)
        else:
            assert recovery.eligible(head) == (False, served)
        ci.assert_not_called()


def test_duplicate_attempt_consumes_no_provider_calls(monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("GITHUB_REPOSITORY", recovery.REPOSITORY)
    with (
        patch.object(recovery, "github", return_value=[{"id": 12}]),
        patch.object(recovery, "vercel") as provider,
    ):
        with pytest.raises(recovery.StopRecovery, match="already used"):
            recovery.repair(HEAD, {})
        provider.assert_not_called()


@pytest.mark.parametrize("state", sorted(recovery.ACTIVE))
def test_active_provider_release_blocks_repair(state):
    with patch.object(
        recovery,
        "vercel",
        return_value={"deployments": [{"state": state}], "pagination": {"next": None}},
    ):
        with pytest.raises(recovery.StopRecovery, match="running"):
            recovery.idle_provider()


def test_provider_unknown_history_is_not_idle():
    with patch.object(
        recovery, "vercel", return_value={"deployments": [], "pagination": {"next": 1}}
    ):
        with pytest.raises(recovery.StopRecovery, match="incomplete"):
            recovery.idle_provider()


def test_new_main_prevents_promotion():
    with patch.object(recovery, "github", return_value={"sha": SERVED}):
        with pytest.raises(recovery.StopRecovery, match="Main changed"):
            recovery.current_main(HEAD)


def test_failed_cli_never_prints_private_output(capsys):
    with patch.object(
        recovery.subprocess,
        "run",
        return_value=type(
            "Result", (), {"returncode": 1, "stdout": "secret", "stderr": "secret"}
        )(),
    ):
        with pytest.raises(recovery.StopRecovery) as error:
            recovery.command(["fake"])
    assert "secret" not in str(error.value)
    assert "secret" not in capsys.readouterr().out


def test_current_head_requires_latest_successful_main_ci():
    runs = {
        "workflow_runs": [
            {
                "id": 1,
                "head_sha": HEAD,
                "head_branch": "main",
                "status": "completed",
                "conclusion": "success",
            },
            {
                "id": 2,
                "head_sha": HEAD,
                "head_branch": "main",
                "status": "in_progress",
                "conclusion": None,
            },
        ]
    }
    with patch.object(recovery, "github", return_value=runs):
        assert not recovery.successful_ci(HEAD)


def test_workflow_never_loads_triggering_code_or_artifacts():
    workflow = (
        SCRIPTS.parent / ".github/workflows/website-release-recovery.yml"
    ).read_text()
    assert "ref: main" in workflow
    assert "download-artifact" not in workflow
    assert "dry_run:" in workflow and "default: true" in workflow
    assert "group: vercel-production" in workflow
    assert "schedule:" not in workflow


def test_dry_run_writes_safe_evidence_without_mutations(tmp_path, monkeypatch):
    output = tmp_path / "result.json"
    monkeypatch.setattr(sys, "argv", ["recovery", "--report", str(output)])
    with (
        patch.object(recovery.release, "git", return_value=HEAD),
        patch.object(recovery, "eligible", return_value=(True, SERVED)),
        patch.object(recovery, "repair") as repair,
    ):
        assert recovery.main() == 0
    repair.assert_not_called()
    assert json.loads(output.read_text())["decision"] == "eligible_dry_run"


@pytest.mark.parametrize("assignment", [None, False, "true"])
def test_deliberate_rollback_or_unknown_promotion_hold_blocks(assignment):
    with patch.object(
        recovery,
        "vercel",
        return_value={
            "autoAssignCustomDomains": assignment,
            "targets": {"production": {"id": "dpl_previous"}},
        },
    ):
        with pytest.raises(recovery.StopRecovery, match="preserve any rollback"):
            recovery.production_target("project")


@pytest.mark.parametrize(
    "data",
    [
        {"deployments": []},
        {"deployments": [{}], "pagination": {"next": None}},
        {"deployments": [{"state": "NEW_UNKNOWN"}], "pagination": {"next": None}},
    ],
)
def test_missing_or_unknown_provider_evidence_blocks(data):
    with patch.object(recovery, "vercel", return_value=data):
        with pytest.raises(recovery.StopRecovery):
            recovery.idle_provider()


def test_ready_withheld_waiting_release_is_not_automatically_replaced():
    deployment = {
        "state": "READY",
        "meta": {"githubCommitSha": HEAD},
        "url": "candidate.vercel.app",
    }
    with patch.object(
        recovery,
        "vercel",
        return_value={"deployments": [deployment], "pagination": {"next": None}},
    ):
        with pytest.raises(recovery.StopRecovery, match="possible rollback"):
            recovery.idle_provider({HEAD})
        recovery.idle_provider({HEAD}, "https://candidate.vercel.app")


@pytest.mark.parametrize(
    "failure",
    [
        None,
        "main_changed",
        "production_changed",
        "browser_failed",
        "promotion_timeout",
        "build_failed",
    ],
)
def test_full_mutation_sequence_is_bounded_and_preserves_previous(failure, monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("GITHUB_REPOSITORY", recovery.REPOSITORY)
    monkeypatch.setenv("VERCEL_PROJECT_ID", "project")
    monkeypatch.setenv("VERCEL_TOKEN", "FAKE-test-credential")
    calls = []
    snapshots = []
    main_changed = False

    def github(path, payload=None):
        calls.append((path, payload))
        if path.startswith("deployments?"):
            return []
        if path == "deployments":
            assert payload["payload"]["previous_deployment"] == "dpl_previous"
            return {"id": 42}
        return {}

    def command(args, timeout=60):
        calls.append((args, None))
        if "deploy" in args:
            assert "--skip-domain" in args and "--prod" in args
            if failure == "build_failed":
                raise recovery.StopRecovery("build failed")
            return "https://candidate.vercel.app"
        if "promote" in args and failure == "promotion_timeout":
            raise recovery.StopRecovery("promotion result unknown")
        if args[0] == "node" and failure == "browser_failed":
            raise recovery.StopRecovery("browser failed")
        return ""

    def eligible(head):
        nonlocal main_changed
        main_changed = failure == "main_changed"
        return True, SERVED

    def current_main(head):
        if main_changed:
            raise recovery.StopRecovery("Main changed")

    result = {"previous_commit": SERVED}
    with (
        patch.object(recovery, "github", side_effect=github),
        patch.object(recovery, "command", side_effect=command),
        patch.object(recovery, "idle_provider"),
        patch.object(
            recovery,
            "production_target",
            side_effect=[
                "dpl_previous",
                "dpl_changed" if failure == "production_changed" else "dpl_previous",
            ],
        ),
        patch.object(recovery.release, "waiting_commits", return_value=[HEAD]),
        patch.object(recovery.release, "website_paths", return_value=["apps/frontend"]),
        patch.object(recovery, "current_main", side_effect=current_main),
        patch.object(recovery, "eligible", side_effect=eligible),
    ):
        if failure:
            with pytest.raises(recovery.StopRecovery):
                recovery.repair(
                    HEAD, result, checkpoint=lambda: snapshots.append(dict(result))
                )
        else:
            recovery.repair(
                HEAD, result, checkpoint=lambda: snapshots.append(dict(result))
            )
    commands = [item[0] for item in calls if isinstance(item[0], list)]
    assert sum("deploy" in cmd for cmd in commands) == 1
    assert sum("promote" in cmd for cmd in commands) == (
        0 if failure in {"main_changed", "production_changed", "build_failed"} else 1
    )
    assert not any("rollback" in cmd for cmd in commands)
    assert sum(path == "deployments" for path, _ in calls) == 1
    assert snapshots[0]["previous_deployment"] == "dpl_previous"
    assert snapshots[1]["attempt_id"] == 42
    if failure != "build_failed":
        assert any(
            s.get("candidate_url") == "https://candidate.vercel.app" for s in snapshots
        )
    assert calls[-1][1]["state"] == ("failure" if failure else "success")
    if failure is None:
        assert result["decision"] == "recovered"


def test_production_tokens_are_only_on_recovery_step():
    workflow = (
        SCRIPTS.parent / ".github/workflows/website-release-recovery.yml"
    ).read_text()
    before, recovery_step = workflow.split(
        "      - name: Read evidence and make at most 1 recovery attempt"
    )
    assert "VERCEL_TOKEN:" not in before and "GH_TOKEN:" not in before
    assert "VERCEL_TOKEN:" in recovery_step and "GH_TOKEN:" in recovery_step


@pytest.mark.parametrize(
    "alias_request",
    [
        {"type": "promote", "jobStatus": "pending"},
        {"type": "rollback", "jobStatus": "in-progress"},
        {"type": "promote", "jobStatus": "unknown"},
        {},
        "malformed",
    ],
)
def test_pending_or_unknown_domain_changes_block(alias_request):
    data = {
        "autoAssignCustomDomains": True,
        "lastAliasRequest": alias_request,
        "targets": {"production": {"id": "dpl_previous"}},
    }
    with patch.object(recovery, "vercel", return_value=data):
        with pytest.raises(recovery.StopRecovery, match="domain change"):
            recovery.production_target("project")
