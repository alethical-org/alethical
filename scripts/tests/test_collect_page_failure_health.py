"""Offline collector examples. All secrets and callback values are synthetic."""

from datetime import datetime, timezone, timedelta
from io import StringIO
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from scripts import collect_page_failure_health as health

NOW = datetime(2026, 10, 7, 19, 43, tzinfo=timezone.utc)
START, END = health.complete_hour(NOW)
SECRET = "synthetic-private-callback-and-provider-message"


def row(identifier="row", **values):
    return {
        "id": identifier,
        "timestamp": int(START.timestamp() * 1000),
        "responseStatusCode": 503,
        "requestPath": "/money/committees/example-100",
        "source": "serverless",
        "environment": "production",
        "logs": [],
        "message": SECRET,
        "deploymentId": SECRET,
        "headers": {"secret": SECRET},
        **values,
    }


def diagnostic(**values):
    return json.dumps(
        {
            "event": "page_response_failure",
            "phase": "content",
            "page_family": "moneyCommittee",
            "source_family": "committee-finance",
            "failure_kind": "timeout",
            "elapsed_ms": 5001,
            "attempt_count": 1,
            **values,
        }
    )


def encoded(rows):
    return "\n".join(json.dumps(value) for value in rows).encode()


class AggregateTest(TestCase):
    def test_exact_hour_boundaries_and_deduplication(self):
        result = health.aggregate(
            encoded(
                [
                    row(
                        "before",
                        timestamp=int(
                            (START - timedelta(milliseconds=1)).timestamp() * 1000
                        ),
                    ),
                    row("first"),
                    row("first"),
                    row(
                        "last",
                        timestamp=int(END.timestamp() * 1000) - 1,
                        responseStatusCode=500,
                    ),
                    row("after", timestamp=int(END.timestamp() * 1000)),
                ]
            ),
            START,
            END,
        )
        self.assertEqual(result["failures_count"], 2)
        self.assertEqual(result["rows_received"], 5)
        self.assertEqual(
            result["status_counts"],
            [{"status": 500, "count": 1}, {"status": 503, "count": 1}],
        )
        self.assertEqual(result["minutes"][-1]["minute"], "2026-10-07T18:59:00Z")

    def test_classifies_only_exact_fixed_diagnostic_values(self):
        result = health.aggregate(
            encoded(
                [
                    row("top", message=diagnostic()),
                    row(
                        "nested",
                        logs=[
                            {
                                "message": diagnostic(
                                    phase="shell",
                                    source_family="shell",
                                    upstream_status=200,
                                )
                            }
                        ],
                    ),
                    row(
                        "duplicate",
                        message=diagnostic(),
                        logs=[{"message": diagnostic()}],
                    ),
                ]
            ),
            START,
            END,
        )
        self.assertEqual(result["unclassified_failures"], 0)
        self.assertEqual(sum(r["count"] for r in result["classifications"]), 3)
        self.assertEqual(result["classifications"][0]["timing_bucket"], "5s-10s")

    def test_hostile_fields_and_malformed_diagnostics_never_enter_output(self):
        messages = [
            SECRET,
            '{"event":"page_response_failure",',
            diagnostic(page_family=SECRET),
            diagnostic(source_family=[SECRET]),
            diagnostic(failure_kind={"private": SECRET}),
            diagnostic(extra=SECRET),
            diagnostic(elapsed_ms=float("nan")),
            diagnostic(attempt_count=True),
            diagnostic(upstream_status=SECRET),
            diagnostic().replace(
                '"attempt_count": 1', '"attempt_count": 1, "attempt_count": 1'
            ),
        ]
        result = health.aggregate(
            encoded(
                [
                    row(
                        str(i),
                        message=message,
                        requestPath="/auth/callback?token=" + SECRET,
                        logs=[{"message": SECRET, "stack": SECRET}],
                    )
                    for i, message in enumerate(messages)
                ]
            ),
            START,
            END,
        )
        self.assertEqual(result["unclassified_failures"], len(messages))
        self.assertNotIn(SECRET, json.dumps(result))
        self.assertNotIn("/auth", json.dumps(result))
        self.assertEqual(
            result["unclassified_by_family"],
            [
                {
                    "minute": health.iso(START),
                    "family": "admin-or-private",
                    "count": len(messages),
                }
            ],
        )

    def test_failure_families_keep_their_minute_and_truncated_labels_are_unclassified(
        self,
    ):
        later = int((START + timedelta(minutes=12)).timestamp() * 1000)
        result = health.aggregate(
            encoded(
                [
                    row("reader", message=diagnostic()),
                    row("private", timestamp=later, requestPath="/ask?text=" + SECRET),
                    row(
                        "truncated",
                        timestamp=later,
                        logs=[{"message": diagnostic(), "messageTruncated": True}],
                    ),
                ]
            ),
            START,
            END,
        )
        self.assertEqual(result["classifications"][0]["minute"], health.iso(START))
        self.assertEqual(
            result["unclassified_by_family"][0]["minute"], "2026-10-07T18:12:00Z"
        )
        self.assertEqual(result["unclassified_failures"], 2)

    def test_conflicting_classifications_are_unclassified(self):
        result = health.aggregate(
            encoded(
                [
                    row(
                        message=diagnostic(),
                        logs=[{"message": diagnostic(failure_kind="network")}],
                    )
                ]
            ),
            START,
            END,
        )
        self.assertEqual(result["unclassified_failures"], 1)

    def test_empty_hour_is_distinct_from_failed_collection_and_limit_is_not_complete(
        self,
    ):
        self.assertEqual(
            health.aggregate(b"", START, END)["collection_status"], "collected"
        )
        result = health.aggregate(
            encoded([row(str(i)) for i in range(100)]), START, END
        )
        self.assertTrue(result["saturated"])
        with self.assertRaises(health.CollectionFailure):
            health.aggregate(encoded([row(str(i)) for i in range(101)]), START, END)

    def test_changed_row_shape_or_invalid_json_fails_without_remote_text(self):
        for raw in [
            SECRET.encode(),
            encoded([row(responseStatusCode=200)]),
            encoded([row(source="static")]),
            encoded([row(timestamp=True)]),
            encoded([{"private": SECRET}]),
        ]:
            with self.assertRaises(health.CollectionFailure) as failure:
                health.aggregate(raw, START, END)
            self.assertNotIn(SECRET, str(failure.exception))


class CommandTest(TestCase):
    def test_both_pipes_are_capped_in_memory(self):
        command = [
            sys.executable,
            "-c",
            "import sys;sys.stderr.write('x'*10000);print('raw-secret')",
        ]
        with patch.object(health, "MAX_BYTES", 100):
            with self.assertRaisesRegex(health.CollectionFailure, "output-limit"):
                health.run_command(command)

    def test_command_timeout_kills_only_its_process(self):
        with patch.object(health, "COMMAND_SECONDS", 0.03):
            with self.assertRaisesRegex(health.CollectionFailure, "timeout") as failure:
                health.run_command([sys.executable, "-c", "import time;time.sleep(3)"])
        self.assertTrue(failure.exception.transient)

    def test_error_classes_never_return_stderr(self):
        for text, reason, transient in [
            ("504 " + SECRET, "provider-temporarily-unavailable", True),
            ("403 " + SECRET, "provider-auth-rejected", False),
            (SECRET, "provider-command-failed", False),
        ]:
            command = [
                sys.executable,
                "-c",
                "import sys;sys.stderr.write(sys.argv[1]);sys.exit(1)",
                text,
            ]
            with self.assertRaises(health.CollectionFailure) as failure:
                health.run_command(command)
            self.assertEqual(str(failure.exception), reason)
            self.assertEqual(failure.exception.transient, transient)

    @patch.dict(
        os.environ,
        {
            "VERCEL_TOKEN": SECRET,
            "VERCEL_ORG_ID": "fake-org",
            "VERCEL_PROJECT_ID": "fake-project",
        },
    )
    def test_retry_has_two_attempts_and_exact_project_wide_filters(self):
        with patch.object(
            health,
            "run_command",
            side_effect=[
                health.CollectionFailure(
                    "provider-temporarily-unavailable", transient=True
                ),
                encoded([row()]),
            ],
        ) as command:
            result, code = health.collect("vercel", NOW)
        self.assertEqual(code, 0)
        self.assertEqual(result["attempt_count"], 2)
        args = command.call_args[0][0]
        for expected in [
            "--no-branch",
            "--json",
            "--environment",
            "production",
            "--source",
            "serverless",
            "--status-code",
            "5xx",
            "--limit",
            "100",
            "2026-10-07T18:00:00Z",
            "2026-10-07T19:00:00Z",
        ]:
            self.assertIn(expected, args)
        self.assertNotIn(SECRET, json.dumps(result))

    @patch.dict(
        os.environ,
        {
            "VERCEL_TOKEN": SECRET,
            "VERCEL_ORG_ID": "fake-org",
            "VERCEL_PROJECT_ID": "fake-project",
        },
    )
    def test_repeated_transient_failure_is_saved_but_does_not_send_hourly_failure(self):
        with patch.object(
            health,
            "run_command",
            side_effect=health.CollectionFailure("command-timeout", transient=True),
        ) as command:
            result, code = health.collect("vercel", NOW)
        self.assertEqual(command.call_count, 2)
        self.assertEqual(code, 0)
        self.assertEqual(result["collection_status"], "failed")

    @patch.dict(
        os.environ,
        {
            "VERCEL_TOKEN": SECRET,
            "VERCEL_ORG_ID": "fake-org",
            "VERCEL_PROJECT_ID": "fake-project",
        },
    )
    def test_auth_and_shape_fail_without_retry(self):
        for effect in [
            health.CollectionFailure("provider-auth-rejected"),
            b"private invalid output",
        ]:
            with patch.object(health, "run_command", side_effect=[effect]) as command:
                result, code = health.collect("vercel", NOW)
            self.assertEqual(code, 1)
            self.assertEqual(command.call_count, 1)
            self.assertEqual(result["collection_status"], "failed")

    def test_unexpected_error_still_writes_only_safe_failure(self):
        with (
            TemporaryDirectory() as folder,
            patch.object(health, "collect", side_effect=RuntimeError(SECRET)),
            patch("sys.stdout", new_callable=StringIO) as stdout,
        ):
            output = Path(folder) / "result.json"
            self.assertEqual(health.main(["--output", str(output)]), 1)
            self.assertNotIn(SECRET, output.read_text() + stdout.getvalue())
            self.assertEqual(
                json.loads(output.read_text())["failure"],
                "unexpected-collection-failure",
            )


class WorkflowTest(TestCase):
    def test_only_trusted_main_receives_secrets_after_pinned_install(self):
        path = (
            Path(__file__).resolve().parents[2]
            / ".github/workflows/page-failure-health.yml"
        )
        text = path.read_text()
        self.assertNotIn("pull_request:", text)
        self.assertIn("43 * * * *", text)
        self.assertIn("github.ref == 'refs/heads/main'", text)
        self.assertIn("contents: read", text)
        self.assertIn("timeout-minutes: 8", text)
        self.assertNotIn("issues: write", text)
        self.assertIn("vercel@56.3.2", text)
        self.assertIn("--ignore-scripts", text)
        install = text.split("name: Install")[1].split("name: Collect")[0]
        self.assertNotIn("secrets.", install)
        self.assertIn("retention-days: 35", text)
        self.assertIn("if: always()", text)
