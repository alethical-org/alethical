"""Recurring collection keeps gaps honest and continues safe recovery phases."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from unittest.mock import Mock

import pytest

from alethical.pipeline import fcc_refresh
from scripts import fcc_political_files as cli


def test_github_problem_report_lifecycle():
    root = Path(__file__).resolve().parents[2]
    subprocess.run(
        ["node", "--test", ".github/scripts/fcc-refresh-report.test.cjs"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )


@pytest.fixture()
def phases(monkeypatch):
    results = {
        "collect": {"status": "complete", "listed_files": 4507},
        "mirror_bodies": {},
        "extract_pending": {},
        "status": {"bodies_without_second_copy": 0},
        "gaps": {"unread_documents": 0},
    }
    mocks = {}
    for name, result in results.items():
        mocks[name] = Mock(return_value=result)
        monkeypatch.setattr(fcc_refresh.archive, name, mocks[name])
    return mocks


def test_complete_refresh_has_fixed_three_station_scope(phases):
    result = fcc_refresh.refresh(Mock(), Mock(), Mock())
    assert result["status"] == "current"
    assert result["needs_attention"] is False
    assert result["stations"] == ["KSTP-TV", "KARE", "KMSP-TV"]
    assert phases["collect"].call_args.kwargs["incremental"] is True
    assert len(phases["collect"].call_args.kwargs["stations"]) == 3


def test_source_refusals_keep_coverage_incomplete_without_inventing_job_failure(phases):
    phases["collect"].return_value.update(status="incomplete", files_unavailable=9)
    result = fcc_refresh.refresh(Mock(), Mock(), Mock())
    assert result["status"] == "current_with_gaps"
    assert result["collection"]["status"] == "incomplete"
    assert result["source_gaps"] == 9
    assert result["needs_attention"] is False


@pytest.mark.parametrize(
    "phase", ["collect", "mirror_bodies", "extract_pending", "status", "gaps"]
)
def test_phase_failure_is_sanitized_and_does_not_skip_remaining_work(phases, phase):
    phases[phase].side_effect = RuntimeError("private connection secret")
    db = Mock()
    result = fcc_refresh.refresh(db, Mock(), Mock())
    assert result["needs_attention"] is True
    assert "private connection secret" not in json.dumps(result)
    for run in phases.values():
        run.assert_called_once()
    db.rollback.assert_called_once()


@pytest.mark.parametrize(
    ("phase", "key"),
    [
        ("collect", "folders_failed"),
        ("collect", "files_failed"),
        ("collect", "files_deferred"),
        ("mirror_bodies", "failed"),
        ("extract_pending", "failed"),
        ("status", "bodies_without_second_copy"),
        ("status", "reading_operational_failures"),
        ("gaps", "unread_documents"),
    ],
)
def test_errors_and_unfinished_work_remain_actionable(phases, phase, key):
    phases[phase].return_value[key] = 1
    assert fcc_refresh.refresh(Mock(), Mock(), Mock())["needs_attention"] is True


def test_incomplete_saved_readings_remain_visible_past_the_gap_list_limit(phases):
    phases["status"].return_value["readings"] = {
        "pending_review": 500,
        "partial": 200,
        "limit_exceeded": 4,
    }
    result = fcc_refresh.refresh(Mock(), Mock(), Mock())
    assert result["reading_gaps"] == 204
    assert result["status"] == "current_with_gaps"
    assert result["needs_attention"] is False


def test_refresh_dry_run_has_no_connections_or_writes(monkeypatch, capsys, tmp_path):
    connect = Mock(side_effect=AssertionError("must not connect"))
    monkeypatch.setattr(cli, "database_url_for_target", connect)
    destination = tmp_path / "report.json"
    assert (
        cli.main(
            ["refresh", "--target", "prod", "--dry-run", "--summary", str(destination)]
        )
        == 0
    )
    result = json.loads(capsys.readouterr().out)
    assert [s["call_sign"] for s in result["stations"]] == [
        "KSTP-TV",
        "KARE",
        "KMSP-TV",
    ]
    assert result["incremental"] is True
    assert result["max_files"] == result["extract_limit"] == 1000
    assert result["mirror_limit"] == 2500
    connect.assert_not_called()
    assert not destination.exists()


@pytest.mark.parametrize("option", ["--max-files", "--extract-limit", "--mirror-limit"])
def test_refresh_rejects_unbounded_work_before_connecting(monkeypatch, option):
    connect = Mock(side_effect=AssertionError("must not connect"))
    monkeypatch.setattr(cli, "database_url_for_target", connect)
    assert cli.main(["refresh", option, "10000", "--dry-run"]) == 1
    connect.assert_not_called()
