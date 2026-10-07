"""Synthetic host events, IDs, repositories, and jobs; no real user content."""

from __future__ import annotations

import io
import json
import sqlite3
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from scripts import agent_job_events as events
from scripts import agent_job_outcomes as outcomes


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    path = tmp_path / "synthetic-repo"
    path.mkdir()
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    return path


def register(
    state: Path,
    repo: Path,
    identity: str = "synthetic-job",
    session: str = "synthetic-session",
    *flags: str,
):
    args = events.parser().parse_args(
        [
            "begin",
            "--state-dir",
            str(state),
            "--job-id",
            identity,
            "--title",
            "Synthetic approved low-risk job",
            "--platform",
            "codex",
            "--session-id",
            session,
            "--repo-root",
            str(repo),
            *flags,
        ]
    )
    return events.begin(args)


def payload(event: str = "PostToolUse", **extra) -> dict:
    return {"hook_event_name": event, "session_id": "synthetic-session", **extra}


def rows(state: Path) -> list[dict]:
    with events.database(state) as connection:
        return [dict(row) for row in connection.execute("SELECT * FROM events")]


def test_actual_start_resume_and_helpers_share_one_job(tmp_path: Path, repo: Path):
    state = tmp_path / "private"
    first = register(
        state, repo, "synthetic-job", "synthetic-session", "--ui", "--deployable"
    )
    before = (state / "jobs.jsonl").read_bytes()
    for command, platform, session in [
        ("resume", "codex", "synthetic-resume"),
        ("bind", "claude", "synthetic-helper"),
    ]:
        args = events.parser().parse_args(
            [
                command,
                "--state-dir",
                str(state),
                "--job-id",
                "synthetic-job",
                "--platform",
                platform,
                "--session-id",
                session,
            ]
        )
        result = events.bind_existing(args)
        assert result["started_at"] == first["started_at"]
        assert events.load_binding(state, platform, session) == "synthetic-job"
    assert (state / "jobs.jsonl").read_bytes() == before
    _, latest = outcomes.read_ledger(state / "jobs.jsonl")
    assert len(latest) == 1
    assert latest["synthetic-job"]["ui"] is True
    assert latest["synthetic-job"]["deployable"] is True
    with pytest.raises(ValueError):
        register(state, repo)
    assert (state / "jobs.jsonl").read_bytes() == before


def test_ledger_only_existing_job_can_be_bound_without_restarting(
    tmp_path: Path, repo: Path
):
    state = tmp_path / "private"
    state.mkdir()
    job = outcomes.template(
        "synthetic-old", "Synthetic ledger-only job", "synthetic-agent"
    )
    job.update(state="blocked", started_at="2026-01-01T10:00:00+00:00", ui=True)
    outcomes.save_record(state / "jobs.jsonl", job)
    before = (state / "jobs.jsonl").read_bytes()
    args = events.parser().parse_args(
        [
            "bind",
            "--state-dir",
            str(state),
            "--job-id",
            "synthetic-old",
            "--platform",
            "claude",
            "--session-id",
            "synthetic-existing",
            "--repo-root",
            str(repo),
        ]
    )
    assert events.bind_existing(args)["started_at"] == job["started_at"]
    assert (state / "jobs.jsonl").read_bytes() == before


def test_privacy_bound_session_follows_job_outside_repository(
    tmp_path: Path, repo: Path
):
    state = tmp_path / "private"
    register(state, repo)
    private = "SYNTHETIC_PRIVATE_VALUE_NEVER_SAVE"
    event = payload(
        "PostToolUse",
        turn_id="synthetic-turn",
        tool_use_id="synthetic-tool",
        agent_id="synthetic-agent",
        cwd=str(tmp_path),
        tool_input={"command": private},
        tool_output=private,
        prompt=private,
        transcript_path=private,
        last_assistant_message=private,
        error=private,
        callback=private,
        environment={"key": private},
        arbitrary=private,
    )
    assert events.hook(state, "codex", event) is None
    saved = rows(state)
    assert len(saved) == 1
    assert set(saved[0]) == {
        "id",
        "job_id",
        "protocol_version",
        "platform",
        "hook_event_name",
        "session_hash",
        "turn_hash",
        "tool_use_hash",
        "agent_hash",
        "received_at",
        "dedupe_key",
    }
    for path in state.iterdir():
        assert private.encode() not in path.read_bytes()
        if path.name == events.DB_NAME:
            for value in (
                "synthetic-session",
                "synthetic-turn",
                "synthetic-tool",
                "synthetic-agent",
                str(tmp_path),
                str(repo),
            ):
                assert value.encode() not in path.read_bytes()
        assert path.stat().st_mode & 0o777 == 0o600
    assert state.stat().st_mode & 0o777 == 0o700


def test_duplicate_identity_and_no_identity_are_distinguished(
    tmp_path: Path, repo: Path
):
    state = tmp_path / "private"
    register(state, repo)
    for _ in range(2):
        events.hook(state, "codex", payload(tool_use_id="synthetic-tool"))
        events.hook(state, "codex", payload("Stop"))
    saved = rows(state)
    assert len(saved) == 3
    assert sum(row["dedupe_key"] is None for row in saved) == 2


def test_concurrent_writers_and_duplicate_begin(tmp_path: Path, repo: Path):
    state = tmp_path / "private"

    def begin_once(_):
        try:
            register(state, repo)
            return True
        except ValueError:
            return False

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(begin_once, range(4))) == 1

    def record(index):
        events.hook(state, "codex", payload(tool_use_id=f"synthetic-tool-{index % 5}"))

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(record, range(20)))
    assert len(rows(state)) == 5
    assert len(outcomes.read_ledger(state / "jobs.jsonl")[0]) == 1


def test_missing_registration_detects_common_git_directory(tmp_path: Path, repo: Path):
    state = tmp_path / "private"
    register(state, repo)
    # A Git subdirectory shares the allowlisted identity without saving its path.
    nested = repo / "nested"
    nested.mkdir()
    before = {path.name: path.read_bytes() for path in state.iterdir()}
    event = payload("SessionStart", session_id="synthetic-unbound", cwd=str(nested))
    response = events.hook(state, "claude", event)
    assert response == events.registration_context(
        "SessionStart", "claude", events.digest("session", "synthetic-unbound")
    )
    assert {path.name: path.read_bytes() for path in state.iterdir()} == before
    assert not rows(state)
    assert events.load_binding(state, "claude", "synthetic-unbound") is None


def test_unrelated_and_unsupported_events_do_not_touch_state(
    tmp_path: Path, repo: Path
):
    absent = tmp_path / "absent"
    assert events.hook(absent, "codex", payload("SessionStart", cwd=str(repo))) is None
    assert not absent.exists()
    state = tmp_path / "private"
    register(state, repo)
    before = {path.name: path.read_bytes() for path in state.iterdir()}
    for event in [
        payload("SessionStart", session_id="synthetic-unrelated", cwd=str(tmp_path)),
        payload("UnknownEvent"),
        payload("SessionStart", session_id=None),
    ]:
        assert events.hook(state, "codex", event) is None
    assert {path.name: path.read_bytes() for path in state.iterdir()} == before


def test_stop_interrupt_and_failures_never_change_outcomes(tmp_path: Path, repo: Path):
    state = tmp_path / "private"
    register(state, repo)
    before = (state / "jobs.jsonl").read_bytes()
    for name in (
        "Stop",
        "StopFailure",
        "Interrupt",
        "SessionEnd",
        "PostToolUseFailure",
    ):
        events.hook(state, "codex", payload(name, turn_id="synthetic-turn"))
    assert (state / "jobs.jsonl").read_bytes() == before
    report = events.status(state)
    assert report["jobs"][0]["state"] == "in_progress"
    assert report["jobs"][0]["finished_at"] is None
    assert report["jobs"][0]["human_interventions"] is None
    assert report["jobs"][0]["repeats"] is None
    assert report["jobs"][0]["ai_cost_usd"] is None
    assert "unknown" in report["coverage"]


def test_stale_installation_returns_only_fixed_context(tmp_path: Path, repo: Path):
    state = tmp_path / "private"
    register(state, repo)
    assert events.hook(state, "codex", payload("SessionStart"), 0) == events.context(
        "SessionStart", events.STALE_CONTEXT
    )
    assert len(rows(state)) == 1
    assert events.hook(state, "codex", payload("Stop"), 0) is None


def test_corrupt_state_hook_does_not_leak_or_block(tmp_path: Path, monkeypatch, capsys):
    state = tmp_path / "private"
    state.mkdir()
    private = "SYNTHETIC_PRIVATE_CORRUPTION"
    (state / events.DB_NAME).write_text(private)
    monkeypatch.setattr(
        events.sys, "stdin", io.StringIO(json.dumps(payload("SessionStart")))
    )
    assert events.main(["hook", "--state-dir", str(state), "--platform", "codex"]) == 0
    captured = capsys.readouterr()
    assert json.loads(captured.out) == events.context(
        "SessionStart", events.ERROR_CONTEXT
    )
    assert private not in captured.out + captured.err
    assert "decision" not in captured.out
    assert (state / events.DB_NAME).read_text() == private


@pytest.mark.parametrize(
    "data",
    [
        b"x" * (events.MAX_INPUT_BYTES + 1),
        b"{",
        b"[]",
        b'{"hook_event_name": ["private"]}',
    ],
)
def test_invalid_bounded_input_never_prints_payload(
    tmp_path: Path, monkeypatch, capsys, data: bytes
):
    monkeypatch.setattr(events.sys, "stdin", io.BytesIO(data))
    assert (
        events.main(
            ["hook", "--state-dir", str(tmp_path / "absent"), "--platform", "claude"]
        )
        == 0
    )
    assert capsys.readouterr().out == ""


def test_symlink_state_is_not_written(tmp_path: Path, repo: Path):
    target = tmp_path / "target"
    target.mkdir()
    state = tmp_path / "link"
    state.symlink_to(target, target_is_directory=True)
    with pytest.raises(ValueError):
        register(state, repo)
    assert not list(target.iterdir())


def test_prospective_first_ten_keeps_unfinished_and_excludes_baseline(
    tmp_path: Path, repo: Path
):
    state = tmp_path / "private"
    register(
        state,
        repo,
        "synthetic-baseline",
        "synthetic-baseline-session",
        "--trial-eligible",
    )
    assert events.trial_start(state, 10)["target"] == 10
    register(state, repo, "synthetic-ineligible", "synthetic-ineligible-session")
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(
            pool.map(
                lambda index: register(
                    state,
                    repo,
                    f"synthetic-eligible-{index}",
                    f"synthetic-session-{index}",
                    "--trial-eligible",
                ),
                range(12),
            )
        )
    report = events.trial_report(state)
    assert report["enrolled_jobs"] == 10
    assert [job["position"] for job in report["jobs"]] == list(range(1, 11))
    assert {job["state"] for job in report["jobs"]} == {"in_progress"}
    assert all(job["human_interventions"] is None for job in report["jobs"])
    assert "synthetic-baseline" not in {job["job_id"] for job in report["jobs"]}
    assert "synthetic-ineligible" not in {job["job_id"] for job in report["jobs"]}
    with events.database(state) as connection:
        first = [
            row["job_id"]
            for row in connection.execute(
                "SELECT job_id FROM jobs WHERE job_id LIKE 'synthetic-eligible-%' ORDER BY rowid LIMIT 10"
            )
        ]
    assert [job["job_id"] for job in report["jobs"]] == first
    with pytest.raises(ValueError):
        events.trial_start(state, 10)


def test_sqlite_lock_has_bounded_failure(tmp_path: Path, repo: Path):
    state = tmp_path / "private"
    register(state, repo)
    with events.database(state, write=True):
        with pytest.raises(sqlite3.OperationalError, match="locked"):
            events.hook(state, "codex", payload(tool_use_id="synthetic-locked"))
    assert not rows(state)


def test_tool_deduplication_requires_tool_identity_not_only_turn(
    tmp_path: Path, repo: Path
):
    state = tmp_path / "private"
    register(state, repo)
    events.hook(state, "codex", payload(turn_id="synthetic-turn"))
    events.hook(state, "codex", payload(turn_id="synthetic-turn"))
    events.hook(state, "codex", payload(tool_use_id="synthetic-tool"))
    events.hook(
        state, "codex", payload(tool_use_id="synthetic-tool", turn_id="synthetic-turn")
    )
    assert len(rows(state)) == 3
    assert sum(row["dedupe_key"] is None for row in rows(state)) == 2


def test_linked_worktree_has_same_registered_repository(tmp_path: Path, repo: Path):
    state = tmp_path / "private"
    register(state, repo)
    subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "-c",
            "user.name=Synthetic",
            "-c",
            "user.email=synthetic@example.invalid",
            "commit",
            "--allow-empty",
            "-qm",
            "Synthetic test only",
        ],
        check=True,
    )
    linked = tmp_path / "synthetic-linked"
    subprocess.run(
        ["git", "-C", str(repo), "worktree", "add", "--detach", "-q", str(linked)],
        check=True,
    )
    assert events.repository_hash(linked) == events.repository_hash(repo)
    assert events.hook(
        state,
        "codex",
        payload("UserPromptSubmit", session_id="synthetic-unbound", cwd=str(linked)),
    ) == events.registration_context(
        "UserPromptSubmit", "codex", events.digest("session", "synthetic-unbound")
    )


@pytest.mark.parametrize("terminal_state", ["completed", "failed"])
def test_terminal_job_can_rebind_same_session_preserving_old_activity(
    tmp_path: Path, repo: Path, terminal_state: str
):
    state = tmp_path / "private"
    first = register(state, repo)
    events.hook(state, "codex", payload(tool_use_id="synthetic-old-tool"))
    _, latest = outcomes.read_ledger(state / "jobs.jsonl")
    job = {field: latest["synthetic-job"][field] for field in outcomes.FIELDS}
    job.update(state=terminal_state, finished_at=events.utc_now())
    if terminal_state == "completed":
        job["result_commit"] = "a" * 40
        job["evidence"] = [
            {
                "kind": kind,
                "commit": "a" * 40,
                "checked_at": job["finished_at"],
                "outcome": "passed",
                "reference": "synthetic-test-only",
                "observer": "synthetic-independent",
            }
            for kind in ("checks", "review")
        ]
    outcomes.save_record(state / "jobs.jsonl", job, update=True)
    second = register(state, repo, "synthetic-next", "synthetic-session")
    events.hook(state, "codex", payload(tool_use_id="synthetic-next-tool"))
    assert [row["job_id"] for row in rows(state)] == ["synthetic-job", "synthetic-next"]
    assert events.load_binding(state, "codex", "synthetic-session") == "synthetic-next"
    _, latest = outcomes.read_ledger(state / "jobs.jsonl")
    assert latest["synthetic-job"]["started_at"] == first["started_at"]
    assert latest["synthetic-next"]["started_at"] == second["started_at"]


@pytest.mark.parametrize("unfinished", ["in_progress", "paused", "blocked"])
def test_unfinished_job_cannot_rebind_session(
    tmp_path: Path, repo: Path, unfinished: str
):
    state = tmp_path / "private"
    register(state, repo)
    _, latest = outcomes.read_ledger(state / "jobs.jsonl")
    job = {field: latest["synthetic-job"][field] for field in outcomes.FIELDS}
    job["state"] = unfinished
    outcomes.save_record(state / "jobs.jsonl", job, update=True)
    before = (state / "jobs.jsonl").read_bytes()
    with pytest.raises(ValueError, match="unfinished"):
        register(state, repo, "synthetic-next", "synthetic-session")
    assert (state / "jobs.jsonl").read_bytes() == before


def test_isolated_python_can_load_installed_sibling(tmp_path: Path):
    script = Path(events.__file__).resolve()
    result = subprocess.run(
        ["python3", "-I", str(script), "--help"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "trial-report" in result.stdout


def test_session_hash_registration_uses_actual_hash_without_hashing_again(
    tmp_path: Path, repo: Path
):
    state = tmp_path / "private"
    hashed = events.digest("session", "synthetic-session")
    args = events.parser().parse_args(
        [
            "begin",
            "--state-dir",
            str(state),
            "--job-id",
            "synthetic-hash-job",
            "--title",
            "Synthetic hash registration",
            "--platform",
            "claude",
            "--session-hash",
            hashed,
            "--repo-root",
            str(repo),
        ]
    )
    events.begin(args)
    assert (
        events.load_binding(state, "claude", "synthetic-session")
        == "synthetic-hash-job"
    )
    events.hook(
        state, "claude", payload("UserPromptSubmit", prompt_id="synthetic-prompt")
    )
    assert rows(state)[0]["turn_hash"] == events.digest("turn", "synthetic-prompt")
    assert events.status(state)["jobs"][0]["host_events_by_platform"] == {
        "claude": {"UserPromptSubmit": 1},
        "codex": {},
    }
    args.session_hash = "NOT_A_HASH"
    with pytest.raises(ValueError, match="hash"):
        events.begin(args)


def test_terminal_prompt_requests_new_job_without_attaching_future_activity(
    tmp_path: Path, repo: Path
):
    state = tmp_path / "private"
    register(state, repo)
    _, latest = outcomes.read_ledger(state / "jobs.jsonl")
    job = {field: latest["synthetic-job"][field] for field in outcomes.FIELDS}
    job.update(state="failed", finished_at=events.utc_now())
    outcomes.save_record(state / "jobs.jsonl", job, update=True)
    for name in ("SessionStart", "UserPromptSubmit"):
        response = events.hook(state, "codex", payload(name))
        assert response == events.registration_context(
            name, "codex", events.digest("session", "synthetic-session"), terminal=True
        )
    assert not rows(state)
    events.hook(state, "codex", payload("SessionEnd"))
    assert rows(state)[0]["job_id"] == "synthetic-job"


def test_hostile_path_cannot_execute_checkout_git(tmp_path: Path, repo: Path):
    import os

    state = tmp_path / "private"
    register(state, repo)
    hostile = tmp_path / "hostile"
    hostile.mkdir()
    marker = tmp_path / "SYNTHETIC_EXECUTION_MARKER"
    fake = hostile / "git"
    fake.write_text(f"#!/bin/sh\ntouch '{marker}'\nexit 0\n")
    fake.chmod(0o700)
    environment = dict(os.environ, PATH=str(hostile), PYTHONPATH=str(hostile))
    result = subprocess.run(
        [
            "/usr/bin/python3",
            "-I",
            str(Path(events.__file__).resolve()),
            "hook",
            "--state-dir",
            str(state),
            "--platform",
            "claude",
        ],
        input=json.dumps(
            payload("SessionStart", session_id="synthetic-unbound", cwd=str(repo))
        ),
        capture_output=True,
        text=True,
        env=environment,
        cwd=hostile,
        check=False,
    )
    assert result.returncode == 0
    assert not marker.exists()
    assert "Session hash:" in result.stdout


@pytest.mark.parametrize("event", ["Stop", "SubagentStop", "StopFailure", "Interrupt"])
def test_stop_observations_never_assume_turn_or_helper_is_invocation_id(
    tmp_path, repo, event
):
    state = tmp_path / "private"
    register(state, repo)
    for turn in ("synthetic-turn-1", "synthetic-turn-2", "synthetic-turn-2"):
        events.hook(
            state, "codex", payload(event, agent_id="synthetic-agent", turn_id=turn)
        )
    assert len(rows(state)) == 3
    assert all(row["dedupe_key"] is None for row in rows(state))
