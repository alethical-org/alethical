"""Synthetic job records exercise false completion, missing measurements, and history."""

from __future__ import annotations

import copy
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from scripts import agent_job_outcomes as outcomes

SHA = "a" * 40
OTHER_SHA = "b" * 40
START = "2026-01-01T10:00:00+00:00"
CHECKED = "2026-01-01T10:09:00+00:00"
FINISH = "2026-01-01T10:10:00+00:00"


def evidence(kind: str) -> dict:
    return {
        "kind": kind,
        "commit": SHA,
        "checked_at": CHECKED,
        "outcome": "passed",
        "reference": f"synthetic-test-only/{kind}.json",
        "observer": "synthetic-reviewer",
    }


def completed(job_id: str = "synthetic-job") -> dict:
    job = outcomes.template(job_id, "Synthetic test job", "synthetic-agent")
    job.update(
        state="completed",
        started_at=START,
        finished_at=FINISH,
        result_commit=SHA,
        evidence=[evidence("checks"), evidence("review")],
    )
    return job


@pytest.mark.parametrize("kind", ["checks", "review", "browser", "live"])
def test_completion_needs_each_applicable_kind(kind: str):
    job = completed()
    job.update(ui=True, deployable=True, release_commit=SHA)
    job["evidence"] = [evidence(item) for item in outcomes.KINDS if item != kind]
    with pytest.raises(ValueError, match="missing evidence"):
        outcomes.validate(job)


@pytest.mark.parametrize(
    "change", ["failed", "stale_commit", "same_reviewer", "future", "before_start"]
)
def test_contradictory_completion_is_refused(change: str):
    job = completed()
    if change == "failed":
        job["evidence"][0]["outcome"] = "failed"
    elif change == "stale_commit":
        job["evidence"][0]["commit"] = OTHER_SHA
    elif change == "same_reviewer":
        job["evidence"][1]["observer"] = "synthetic-agent"
    elif change == "future":
        job["evidence"][0]["checked_at"] = "2026-01-01T10:11:00+00:00"
    else:
        job["evidence"][0]["checked_at"] = "2026-01-01T09:59:00+00:00"
    with pytest.raises(ValueError):
        outcomes.validate(job)


def test_exact_release_commit_is_the_completion_target():
    job = completed()
    job.update(deployable=True, release_commit=OTHER_SHA)
    job["evidence"].append(evidence("live"))
    with pytest.raises(ValueError, match="exact final commit"):
        outcomes.validate(job)
    for item in job["evidence"]:
        item["commit"] = OTHER_SHA
    outcomes.validate(job)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("human_interventions", -1),
        ("human_interventions", True),
        ("repeats", 1.5),
        ("ai_cost_usd", -0.1),
        ("ai_cost_usd", float("inf")),
        ("ai_cost_usd", float("nan")),
        ("ai_cost_usd", True),
        ("started_at", "2026-01-01T10:00:00"),
        ("finished_at", "2026-01-01T09:00:00+00:00"),
        ("result_commit", "a" * 7),
        ("ui", "false"),
    ],
)
def test_bad_measurements_and_ambiguous_times_fail(field: str, value: object):
    job = completed()
    job[field] = value
    with pytest.raises(ValueError):
        outcomes.validate(job)


def test_timezones_are_compared_as_instants():
    job = completed()
    job["started_at"] = "2026-01-01T05:00:00-05:00"
    outcomes.validate(job)
    assert (
        outcomes.report({job["job_id"]: job})["seconds_to_recorded_working_result"][
            "median"
        ]
        == 600
    )


def test_duplicates_and_failed_updates_leave_history_unchanged(tmp_path: Path):
    ledger = tmp_path / "private" / "jobs.jsonl"
    job = completed()
    outcomes.save_record(ledger, job)
    before = ledger.read_bytes()
    with pytest.raises(ValueError, match="new job_id"):
        outcomes.save_record(ledger, job)
    broken = copy.deepcopy(job)
    broken["evidence"] = []
    with pytest.raises(ValueError):
        outcomes.save_record(ledger, broken, update=True)
    assert ledger.read_bytes() == before
    assert ledger.stat().st_mode & 0o777 == 0o600


def test_registered_start_and_finish_are_one_job(tmp_path: Path):
    ledger = tmp_path / "jobs.jsonl"
    job = outcomes.template("synthetic-job", "Synthetic test job", "synthetic-agent")
    outcomes.save_record(ledger, job)
    job.update(state="in_progress", started_at=START)
    outcomes.save_record(ledger, job, update=True)
    outcomes.save_record(ledger, completed(), update=True)
    history, latest = outcomes.read_ledger(ledger)
    assert len(history) == 3
    assert outcomes.report(latest)["registered_jobs"] == 1
    assert latest["synthetic-job"]["revision"] == 3


def test_update_cannot_reset_elapsed_time(tmp_path: Path):
    ledger = tmp_path / "jobs.jsonl"
    job = completed()
    outcomes.save_record(ledger, job)
    job["started_at"] = "2026-01-01T10:08:00+00:00"
    with pytest.raises(ValueError, match="starting time"):
        outcomes.save_record(ledger, job, update=True)


def test_concurrent_registration_cannot_double_count(tmp_path: Path):
    ledger = tmp_path / "jobs.jsonl"

    def attempt() -> bool:
        try:
            outcomes.save_record(ledger, completed())
            return True
        except ValueError:
            return False

    with ThreadPoolExecutor(max_workers=4) as pool:
        accepted = list(pool.map(lambda _: attempt(), range(4)))
    assert sum(accepted) == 1
    assert len(outcomes.read_ledger(ledger)[0]) == 1


def test_report_includes_unsuccessful_jobs_and_unknowns():
    success = completed("success")
    success.update(human_interventions=0, repeats=2, ai_cost_usd=1.25)
    unknown = completed("unknown")
    jobs = {job["job_id"]: job for job in (success, unknown)}
    for state in ("failed", "blocked", "in_progress", "paused", "planned"):
        job = outcomes.template(state, "Synthetic unfinished job", "synthetic-agent")
        job["state"] = state
        if state != "planned":
            job["started_at"] = START
        if state == "failed":
            job["finished_at"] = FINISH
        outcomes.validate(job)
        jobs[state] = job
    summary = outcomes.report(jobs)
    assert summary["started_jobs"] == 6
    assert summary["recorded_completion_rate"] == 2 / 6
    assert summary["completion_without_intervention_rate_all_started"] == 1 / 6
    assert summary["completed_with_unknown_interventions"] == 1
    assert summary["known_intervention_completion_coverage"] == 0.5
    assert summary["metrics_all_started_jobs"]["ai_cost_usd"] == {
        "known_total": 1.25,
        "known_jobs": 1,
        "unknown_jobs": 5,
    }
    assert "attested" in summary["evidence_basis"]


def test_no_known_spending_is_unknown_not_free():
    summary = outcomes.report({"unknown": completed()})
    assert summary["metrics_all_started_jobs"]["ai_cost_usd"]["known_total"] is None
    assert outcomes.report({})["recorded_completion_rate"] is None


def test_truncated_or_duplicate_history_is_rejected(tmp_path: Path):
    ledger = tmp_path / "jobs.jsonl"
    outcomes.save_record(ledger, completed())
    row = ledger.read_text()
    ledger.write_text(row + row)
    with pytest.raises(ValueError, match="duplicate or missing revision"):
        outcomes.read_ledger(ledger)
    ledger.write_text(row + '{"private":"do-not-print"')
    with pytest.raises(ValueError, match="invalid ledger line 2") as error:
        outcomes.read_ledger(ledger)
    assert "do-not-print" not in str(error.value)


def test_cli_register_update_and_report(tmp_path: Path, capsys):
    ledger = tmp_path / "jobs.jsonl"
    source = tmp_path / "job.json"
    source.write_text(json.dumps(completed()))
    assert (
        outcomes.main(["record", "--ledger", str(ledger), "--input", str(source)]) == 0
    )
    assert outcomes.main(["report", "--ledger", str(ledger)]) == 0
    assert '"recorded_completed_jobs": 1' in capsys.readouterr().out
    assert (
        outcomes.main(["record", "--ledger", str(ledger), "--input", str(source)]) == 1
    )
    assert "new job_id" in capsys.readouterr().err


def test_fields_cannot_claim_external_verification():
    job = completed()
    job["evidence"][0]["externally_verified"] = True
    with pytest.raises(ValueError, match="evidence fields"):
        outcomes.validate(job)


@pytest.mark.parametrize("flag", ["ui", "deployable"])
def test_completion_cannot_drop_started_obligations(tmp_path: Path, flag: str):
    ledger = tmp_path / "jobs.jsonl"
    job = outcomes.template("synthetic-job", "Synthetic test job", "synthetic-agent")
    job.update(state="in_progress", started_at=START)
    job[flag] = True
    outcomes.save_record(ledger, job)
    with pytest.raises(ValueError, match="obligations"):
        outcomes.save_record(ledger, completed(), update=True)


def test_atomic_publish_failure_keeps_prior_record(tmp_path: Path, monkeypatch):
    ledger = tmp_path / "jobs.jsonl"
    job = completed()
    outcomes.save_record(ledger, job)
    before = ledger.read_bytes()

    def fail_replace(*args):
        raise OSError("synthetic disk failure")

    monkeypatch.setattr(outcomes.os, "replace", fail_replace)
    job["repeats"] = 3
    with pytest.raises(OSError, match="synthetic disk failure"):
        outcomes.save_record(ledger, job, update=True)
    assert ledger.read_bytes() == before
    assert not list(tmp_path.glob(".jobs.jsonl.*"))


def test_failed_job_can_be_reopened_without_losing_wait_time(tmp_path: Path):
    ledger = tmp_path / "jobs.jsonl"
    job = completed()
    outcomes.save_record(ledger, job)
    job.update(state="blocked", finished_at=None)
    outcomes.save_record(ledger, job, update=True)
    _, latest = outcomes.read_ledger(ledger)
    summary = outcomes.report(latest)
    assert summary["recorded_completed_jobs"] == 0
    assert summary["started_jobs"] == 1
    assert latest["synthetic-job"]["started_at"] == START


def test_expected_revision_refuses_stale_completion(tmp_path: Path):
    ledger = tmp_path / "jobs.jsonl"
    outcomes.save_record(ledger, completed())
    changed = completed()
    changed.update(state="paused", finished_at=None)
    outcomes.save_record(ledger, changed, update=True)
    before = ledger.read_bytes()
    with pytest.raises(ValueError, match="changed during verification"):
        outcomes.save_record(ledger, completed(), update=True, expected_revision=1)
    assert ledger.read_bytes() == before
    saved = outcomes.save_record(ledger, completed(), update=True, expected_revision=2)
    assert saved["revision"] == 3
