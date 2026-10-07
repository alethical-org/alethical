"""Grouped public alerts stay quiet until meaning changes and never expose bodies."""

from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts import report_source_refresh_health as report


@pytest.fixture(autouse=True)
def clean_workflow_results(monkeypatch):
    for stage in ("PLAN", "COLLECT"):
        monkeypatch.delenv(f"SOURCE_REFRESH_{stage}_RESULT", raising=False)


def row(name="maps", **changes):
    return {
        "name": name,
        "status": "review_required",
        "overdue": False,
        "running": False,
        "source": "https://gis.lcc.mn.gov/html/download.html",
        "last_checked_at": "2026-10-07T12:00:00Z",
        "finding": {
            "checked_at": "2026-10-07T12:00:00Z",
            "results": [
                {
                    "source": "district-map-house",
                    "status": "review_required",
                    "detail": "Official map bytes changed; review before importing",
                    "finding_key": "map-version-a",
                }
            ],
        },
    } | changes


def test_repeated_checks_and_runtime_timestamps_do_not_change_fingerprint():
    before = row()
    after = deepcopy(before)
    after["last_checked_at"] = "2026-10-08T12:00:00Z"
    after["last_started_at"] = "2026-10-08T11:00:00Z"
    after["next_due_at"] = "2026-10-15T12:00:00Z"
    after["finding"]["checked_at"] = "2026-10-08T12:00:00Z"
    assert report.packet([before])[1] == report.packet([after])[1]


def test_meaningful_source_change_updates_fingerprint():
    before = row()
    after = deepcopy(before)
    after["finding"]["results"][0]["finding_key"] = "map-version-b"
    assert report.packet([before])[1] != report.packet([after])[1]


def test_new_official_session_changes_fingerprint():
    before = row("calendar", finding={"unreviewed_session_codes": ["0952027"]})
    after = row(
        "calendar", finding={"unreviewed_session_codes": ["0952027", "0952028"]}
    )
    assert report.packet([before])[1] != report.packet([after])[1]


def test_input_order_does_not_create_another_notification():
    rows = [row(), row("candidates")]
    assert report.packet(rows)[1] == report.packet(list(reversed(rows)))[1]


def test_review_required_is_actionable_without_claiming_collection_failed():
    body, _, needs_attention = report.packet([row()])
    assert needs_attention
    maps_line = next(line for line in body.splitlines() if "**maps**" in line)
    assert "review" in maps_line.lower()
    assert "failed" not in maps_line.lower()
    assert "Official map bytes changed" in body


def test_private_evidence_and_raw_response_fields_never_enter_public_issue():
    finding = deepcopy(row()["finding"])
    finding.update(
        object_key="private/review-bundle.tar.gz",
        access_token="private-test-token",
        raw_body="unreviewed donor names and amounts",
        collection={"response": "private source response"},
    )
    finding["results"][0]["evidence"] = {
        "raw_body": "unreviewed nested source body",
        "url": "https://example.invalid/?token=private-url-token",
    }
    finding["results"][0]["detail"] = "private error containing database password"
    body, _, _ = report.packet([row(finding=finding)])
    for secret in (
        "private/review-bundle.tar.gz",
        "private-test-token",
        "unreviewed donor names and amounts",
        "private source response",
        "unreviewed nested source body",
        "private-url-token",
        "private error containing database password",
    ):
        assert secret not in body


def test_recovered_source_clears_previous_review_details():
    body, _, needs_attention = report.packet([row(status="succeeded")])
    assert not needs_attention
    assert "Official map bytes changed" not in body


@pytest.mark.parametrize("status", ["failed", "interrupted", "never_completed"])
def test_failed_or_missed_work_requires_attention(status):
    assert report.packet([row(status=status, overdue=True, finding=None)])[2]


def test_active_first_attempt_does_not_claim_a_completed_check():
    body, _, _ = report.packet(
        [
            row(
                status="never_completed",
                running=True,
                overdue=True,
                last_checked_at=None,
            )
        ]
    )
    assert "has a completed check" not in body


def fake_environment(monkeypatch, rows, issues):
    calls = []
    engine = SimpleNamespace(dispose=lambda: None)

    class Session:
        def __init__(self, _engine):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

    def gh(*arguments):
        body = None
        if "--body-file" in arguments:
            body = Path(arguments[arguments.index("--body-file") + 1]).read_text()
        calls.append((arguments, body))
        return json.dumps(issues) if arguments[:2] == ("issue", "list") else ""

    monkeypatch.setattr(report, "create_engine", lambda *args, **kwargs: engine)
    monkeypatch.setattr(report, "database_url_for_target", lambda _: "unused")
    monkeypatch.setattr(report, "Session", Session)
    monkeypatch.setattr(report, "health", lambda _: rows)
    monkeypatch.setattr(report, "gh", gh)
    return calls


def test_unchanged_open_issue_is_not_edited(monkeypatch):
    rows = [row()]
    body, _, _ = report.packet(rows)
    calls = fake_environment(
        monkeypatch, rows, [{"number": 1, "body": body, "state": "OPEN"}]
    )
    assert report.main() == 0
    assert len(calls) == 1


def test_recovery_closes_our_issue_and_removes_old_findings(monkeypatch):
    old_body, _, _ = report.packet([row()])
    calls = fake_environment(
        monkeypatch,
        [row(status="succeeded")],
        [{"number": 1, "body": old_body, "state": "OPEN"}],
    )
    assert report.main() == 0
    assert any(args[:3] == ("issue", "close", "1") for args, _ in calls)
    edited = next(body for args, body in calls if args[:2] == ("issue", "edit"))
    assert "Official map bytes changed" not in edited


def test_changed_finding_reopens_owned_closed_issue(monkeypatch):
    body, _, _ = report.packet([row()])
    calls = fake_environment(
        monkeypatch, [row()], [{"number": 1, "body": body, "state": "CLOSED"}]
    )
    assert report.main() == 0
    assert any(args[:3] == ("issue", "reopen", "1") for args, _ in calls)


def test_matching_title_without_ownership_marker_is_never_changed(monkeypatch):
    calls = fake_environment(
        monkeypatch,
        [row()],
        [{"number": 99, "body": "Someone else's report", "state": "OPEN"}],
    )
    assert report.main() == 0
    assert any(args[:2] == ("issue", "create") for args, _ in calls)
    assert not any(
        args[:2] in (("issue", "edit"), ("issue", "close")) for args, _ in calls
    )


def test_healthy_jobs_do_not_create_an_issue(monkeypatch):
    calls = fake_environment(monkeypatch, [row(status="succeeded")], [])
    assert report.main() == 0
    assert len(calls) == 1


def test_donor_bundle_alert_tracks_evidence_not_collection_time_or_private_filename():
    finding = {
        "finding_key": "semantic-evidence-a",
        "audit_hash": "timestamp-sensitive-audit-a",
        "release_id": "release-a",
        "filings_snapshot_id": "filings-a",
        "object_key": "private/bundle-a.tar.gz",
    }
    before = row("donor-proof-preparation", finding=finding)
    after = deepcopy(before)
    after["finding"].update(
        audit_hash="timestamp-sensitive-audit-b", object_key="private/bundle-b.tar.gz"
    )
    body, fingerprint, attention = report.packet([before])
    assert attention
    assert "private donor-evidence bundle is ready for review" in body
    assert "semantic-evidence" not in body
    assert "private/bundle" not in body
    assert report.packet([after])[1] == fingerprint
    after["finding"]["finding_key"] = "semantic-evidence-b"
    assert report.packet([after])[1] != fingerprint


@pytest.mark.parametrize("field", ["release_id", "filings_snapshot_id"])
def test_donor_bundle_source_generation_change_changes_alert(field):
    before = row("donor-proof-preparation", finding={"finding_key": "same", field: "a"})
    after = deepcopy(before)
    after["finding"][field] = "b"
    assert report.packet([before])[1] != report.packet([after])[1]


@pytest.mark.parametrize("stage", ["PLAN", "COLLECT"])
@pytest.mark.parametrize("status", ["failure", "cancelled"])
def test_failed_workflow_setup_is_visible_even_when_database_looks_healthy(
    monkeypatch, stage, status
):
    calls = fake_environment(monkeypatch, [row(status="succeeded")], [])
    monkeypatch.setenv(f"SOURCE_REFRESH_{stage}_RESULT", status)
    assert report.main() == 0
    body = next(body for args, body in calls if args[:2] == ("issue", "create"))
    assert f"workflow-{stage.lower()}" in body


@pytest.mark.parametrize("failure_at", ["create_engine", "health"])
def test_unreadable_database_creates_safe_grouped_warning(monkeypatch, failure_at):
    calls = fake_environment(monkeypatch, [], [])

    def unavailable(*args, **kwargs):
        # Assemble a deliberately fake credential only at runtime so secret scans
        # do not mistake this redaction fixture for a committed database password.
        fake_credentials = ":".join(("private-user", "private-password"))
        raise RuntimeError(
            f"postgresql://{fake_credentials}@example.invalid/database RAW PRIVATE BODY"
        )

    monkeypatch.setattr(report, failure_at, unavailable)
    assert report.main() == 0
    body = next(body for args, body in calls if args[:2] == ("issue", "create"))
    assert "source-health-unavailable" in body
    assert "private-password" not in body
    assert "PRIVATE BODY" not in body


def test_skipped_collection_with_successful_plan_is_not_a_failure(monkeypatch):
    calls = fake_environment(monkeypatch, [row(status="succeeded")], [])
    monkeypatch.setenv("SOURCE_REFRESH_PLAN_RESULT", "success")
    monkeypatch.setenv("SOURCE_REFRESH_COLLECT_RESULT", "skipped")
    assert report.main() == 0
    assert len(calls) == 1
