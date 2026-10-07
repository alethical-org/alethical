"""Coverage fixtures contain only synthetic credentials and provider data."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from zipfile import ZipFile

from scripts import check_page_failure_coverage as coverage
from scripts import collect_page_failure_health as health

NOW = datetime(2026, 10, 10, 17, 17, tzinfo=timezone.utc)
ACTIVATION = NOW - timedelta(days=3)
SECRET = "synthetic-private-token-and-auth-callback"
SHA = "a" * 40


def report(start, status="collected"):
    value = health.aggregate(b"", start, start + timedelta(hours=1))
    value["attempt_count"] = 1
    if status == "failed":
        value.update(collection_status="failed", failure="command-timeout")
    if status == "saturated":
        value.update(rows_received=100, saturated=True)
    return value


def run(identifier, start, **changes):
    return {
        "id": identifier,
        "workflow_id": 17,
        "run_attempt": 1,
        "head_sha": SHA,
        "head_branch": "main",
        "event": "schedule",
        "repository": {"full_name": coverage.REPOSITORY},
        "head_repository": {"full_name": coverage.REPOSITORY},
        "run_started_at": health.iso(start + timedelta(hours=1, minutes=43)),
        "updated_at": health.iso(start + timedelta(hours=1, minutes=44)),
        **changes,
    }


class FakeGitHub:
    def __init__(self, reports=None, activation=ACTIVATION, overrides=None):
        self.reports = reports or {}
        self.activation = activation
        self.overrides = overrides or {}
        self.windows = coverage.expected_windows(NOW, activation)
        self.runs = [run(i + 1, start) for i, start in enumerate(self.windows)]
        self.downloads = 0

    def json(self, path):
        if path == "/actions/workflows/page-failure-health.yml":
            return {
                "id": 17,
                "path": coverage.WORKFLOW_PATH,
                "state": "active",
                "created_at": health.iso(self.activation),
            }
        if path.startswith("/actions/workflows/17/runs?"):
            return {"workflow_runs": self.runs}
        identifier = int(path.split("/")[3])
        current = next(r for r in self.runs if r["id"] == identifier)
        start = health.complete_hour(coverage.timestamp(current["run_started_at"]))[0]
        if self.reports.get(start) == "missing":
            return {"total_count": 0, "artifacts": []}
        artifact = {
            "id": identifier,
            "name": f"page-failure-health-{identifier}-1",
            "expired": False,
            "size_in_bytes": 500,
            "workflow_run": {"id": identifier, "head_branch": "main", "head_sha": SHA},
        }
        artifact.update(self.overrides)
        return {"total_count": 1, "artifacts": [artifact]}

    def artifact(self, identifier):
        self.downloads += 1
        current = next(r for r in self.runs if r["id"] == identifier)
        start = health.complete_hour(coverage.timestamp(current["run_started_at"]))[0]
        return report(start, self.reports.get(start, "collected"))


class SchemaTest(TestCase):
    def test_accepts_collected_failed_and_saturated_reports(self):
        start = coverage.expected_windows(NOW, ACTIVATION)[0]
        for state in ("collected", "failed", "saturated"):
            self.assertEqual(
                coverage.validate_report(report(start, state)), (start, state)
            )

    def test_every_untrusted_field_is_rejected_before_output(self):
        start = coverage.expected_windows(NOW, ACTIVATION)[0]
        base = report(start)
        for changes in (
            {"private": SECRET},
            {"collection_status": SECRET},
            {"failure": SECRET},
            {"window": {"start": SECRET, "end": SECRET}},
            {"saturated": 1},
            {"rows_received": True},
            {"failures_count": 1},
            {"classifications": [{"private": SECRET}]},
            {
                "unclassified_by_family": [
                    {"minute": health.iso(start), "family": SECRET, "count": 1}
                ]
            },
        ):
            with self.assertRaises(coverage.CoverageFailure) as raised:
                coverage.validate_report({**base, **changes})
            self.assertNotIn(SECRET, str(raised.exception))

    def test_classification_minute_and_counts_must_fit_window(self):
        start = coverage.expected_windows(NOW, ACTIVATION)[0]
        raw = json.dumps(
            {
                "id": "synthetic",
                "timestamp": int(start.timestamp() * 1000),
                "responseStatusCode": 503,
                "requestPath": "/ask?private=" + SECRET,
                "source": "serverless",
                "environment": "production",
                "logs": [],
            }
        ).encode()
        value = health.aggregate(raw, start, start + timedelta(hours=1))
        self.assertEqual(coverage.validate_report(value)[1], "collected")
        value["unclassified_by_family"][0]["minute"] = health.iso(
            start + timedelta(hours=1)
        )
        with self.assertRaises(coverage.CoverageFailure):
            coverage.validate_report(value)

    def test_duplicate_json_keys_are_rejected(self):
        with self.assertRaises(coverage.CoverageFailure):
            coverage.strict_json(b'{"schema_version":1,"schema_version":1}')


class CoverageTest(TestCase):
    def test_daily_run_excludes_newest_completed_hour_and_reads_only_24_artifacts(self):
        client = FakeGitHub()
        result, code = coverage.coverage(client, NOW)
        self.assertEqual(code, 0)
        self.assertEqual(result["eligible_end"], "2026-10-10T16:00:00Z")
        self.assertEqual(result["expected_hours"], 24)
        self.assertEqual(result["collected_hours"], 24)
        self.assertEqual(client.downloads, 24)
        self.assertNotIn(SECRET, json.dumps(result))

    def test_missing_and_failed_hours_need_three_gaps(self):
        windows = coverage.expected_windows(NOW, ACTIVATION)
        client = FakeGitHub(dict(zip(windows[:3], ("missing", "failed", "failed"))))
        result, code = coverage.coverage(client, NOW)
        self.assertEqual(code, 1)
        self.assertEqual(
            (
                result["missing_hours"],
                result["failed_hours"],
                result["saturated_hours"],
            ),
            (1, 2, 0),
        )
        client.reports[windows[0]] = "collected"
        self.assertEqual(coverage.coverage(client, NOW)[1], 0)

    def test_single_saturated_hour_fails_even_during_startup(self):
        for activation in (ACTIVATION, NOW - timedelta(hours=23)):
            client = FakeGitHub(activation=activation)
            client.reports[client.windows[0]] = "saturated"
            result, code = coverage.coverage(client, NOW)
            self.assertEqual(
                (result["saturated_hours"], result["coverage_status"], code),
                (1, "failed", 1),
            )

    def test_warmup_is_fixed_at_creation_and_broken_first_day_then_fails(self):
        client = FakeGitHub(activation=NOW - timedelta(hours=23))
        client.runs = []
        self.assertEqual(coverage.coverage(client, NOW)[0]["coverage_status"], "warmup")
        result, code = coverage.coverage(client, NOW + timedelta(hours=1))
        self.assertEqual(code, 1)
        self.assertEqual(result["coverage_status"], "failed")
        self.assertGreaterEqual(result["missing_hours"], 3)

    def test_green_run_cannot_hide_failed_collection(self):
        client = FakeGitHub()
        client.reports = {window: "failed" for window in client.windows}
        for current in client.runs:
            current["conclusion"] = "success"
        result, code = coverage.coverage(client, NOW)
        self.assertEqual((result["failed_hours"], code), (24, 1))

    def test_fork_nonmain_and_pr_runs_do_not_supply_coverage(self):
        for changes in (
            {"head_branch": "evil"},
            {"event": "pull_request"},
            {"head_repository": {"full_name": "untrusted/fork"}},
            {"workflow_id": 18},
        ):
            client = FakeGitHub()
            for current in client.runs:
                current.update(changes)
            result, code = coverage.coverage(client, NOW)
            self.assertEqual(
                (result["missing_hours"], code, client.downloads), (24, 1, 0)
            )

    def test_wrong_artifact_attribution_is_rejected(self):
        for change in (
            {"expired": True},
            {"size_in_bytes": coverage.MAX_ZIP_BYTES + 1},
            {"workflow_run": {"id": 7, "head_branch": "main", "head_sha": SHA}},
        ):
            with self.assertRaises(coverage.CoverageFailure):
                coverage.coverage(FakeGitHub(overrides=change), NOW)

    def test_duplicate_manual_runs_do_not_use_more_downloads(self):
        client = FakeGitHub()
        client.runs += deepcopy(client.runs)
        self.assertEqual(coverage.coverage(client, NOW)[1], 0)
        self.assertEqual(client.downloads, 24)

    def test_newer_run_without_artifact_does_not_hide_older_complete_hour(self):
        client = FakeGitHub()
        start = client.windows[-1]
        newer = run(
            1000,
            start,
            status="in_progress",
            conclusion=None,
            run_started_at=health.iso(start + timedelta(hours=1, minutes=44)),
        )
        client.runs.append(newer)
        original_json = client.json

        def json_response(path):
            if path.startswith("/actions/runs/1000/artifacts"):
                return {"total_count": 0, "artifacts": []}
            return original_json(path)

        client.json = json_response
        result, code = coverage.coverage(client, NOW)
        self.assertEqual(
            (result["collected_hours"], result["missing_hours"], code), (24, 0, 0)
        )
        self.assertEqual(client.downloads, 24)

    def test_unexpected_private_error_is_never_saved_or_printed(self):
        with (
            TemporaryDirectory() as folder,
            patch.dict(os.environ, {"GH_TOKEN": SECRET}),
            patch.object(coverage, "coverage", side_effect=RuntimeError(SECRET)),
            patch("sys.stdout", new_callable=StringIO) as stdout,
        ):
            output = Path(folder) / "safe.json"
            self.assertEqual(coverage.main(["--output", str(output)]), 1)
            self.assertNotIn(SECRET, output.read_text() + stdout.getvalue())
            self.assertEqual(
                json.loads(output.read_text())["failure"], "unexpected-coverage-failure"
            )


class TransportTest(TestCase):
    def test_redirect_strips_token_and_accepts_only_github_artifact_storage(self):
        client = coverage.GitHub(SECRET)
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b"safe"
        signed = "https://productionresultssa1.blob.core.windows.net/fake?sig=" + SECRET
        redirect = HTTPError(
            coverage.API_ROOT, 302, "private", {"Location": signed}, BytesIO(b"private")
        )
        client.opener.open = Mock(side_effect=[redirect, response])
        self.assertEqual(
            client.fetch(
                coverage.API_ROOT + "/actions/artifacts/1/zip", 100, redirect=True
            ),
            b"safe",
        )
        requests = [call.args[0] for call in client.opener.open.call_args_list]
        self.assertEqual(requests[0].get_header("Authorization"), "Bearer " + SECRET)
        self.assertIsNone(requests[1].get_header("Authorization"))
        for url in (
            "http://productionresultssa1.blob.core.windows.net/x",
            "https://evil.example/x",
            "https://user@productionresultssa1.blob.core.windows.net/x",
            "https://productionresultssa1.blob.core.windows.net.evil.example/x",
        ):
            with self.assertRaises(coverage.CoverageFailure):
                client.fetch(url, 100, authenticated=False)

    def test_zip_never_extracts_paths_and_has_small_decompressed_limit(self):
        for name, body in (
            ("../../private.txt", b"private"),
            ("page-failure-health.json", b"x" * (coverage.MAX_REPORT_BYTES + 1)),
        ):
            raw = BytesIO()
            with ZipFile(raw, "w") as archive:
                archive.writestr(name, body)
            client = coverage.GitHub(SECRET)
            client.fetch = Mock(return_value=raw.getvalue())
            with self.assertRaises(coverage.CoverageFailure):
                client.artifact(1)

    def test_budget_response_limit_and_auth_failure_are_fixed_errors(self):
        client = coverage.GitHub(SECRET)
        client.requests = coverage.MAX_REQUESTS
        with self.assertRaisesRegex(coverage.CoverageFailure, "request-budget"):
            client.fetch(coverage.API_ROOT, 10)
        client = coverage.GitHub(SECRET)
        client.deadline = 0
        with self.assertRaisesRegex(coverage.CoverageFailure, "request-budget"):
            client.fetch(coverage.API_ROOT, 10)
        client = coverage.GitHub(SECRET)
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b"x" * 11
        client.opener.open = Mock(return_value=response)
        with self.assertRaisesRegex(coverage.CoverageFailure, "response-limit"):
            client.fetch(coverage.API_ROOT, 10)
        client = coverage.GitHub(SECRET)
        client.opener.open = Mock(
            side_effect=HTTPError(
                coverage.API_ROOT, 403, SECRET, {}, BytesIO(SECRET.encode())
            )
        )
        with self.assertRaisesRegex(coverage.CoverageFailure, "auth-rejected"):
            client.fetch(coverage.API_ROOT, 10)


class WorkflowTest(TestCase):
    def test_daily_only_token_read_scope_and_retained_evidence(self):
        path = (
            Path(__file__).resolve().parents[2]
            / ".github/workflows/public-search-health.yml"
        )
        text = path.read_text()
        self.assertIn("actions: read", text)
        block = text.split("name: Read daily coverage")[1].split("- name:")[0]
        self.assertIn("github.event_name == 'schedule'", block)
        self.assertIn("if: always()", block)
        self.assertIn("GH_TOKEN: ${{ github.token }}", block)
        self.assertNotIn("secrets.", block)
        self.assertIn("page-failure-coverage.json", text)
