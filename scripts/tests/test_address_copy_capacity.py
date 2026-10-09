from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "address_copy_capacity.py"
SPEC = importlib.util.spec_from_file_location("address_copy_capacity", SOURCE)
assert SPEC is not None and SPEC.loader is not None
capacity = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(capacity)
ID = "00000000-0000-0000-0000-000000000001"
PRIVATE = "private-token-and-typed-address"


class CapacityTest(unittest.TestCase):
    def record(self, **changes):
        record = {
            "enabled": False,
            "free_bytes": 3_000_000_000,
            "cgroup_current_bytes": 90_000_000,
            "cgroup_max_bytes": 1_000_000_000,
            "api_process_count": 1,
        }
        record.update(changes)
        return json.dumps(
            {
                "message": capacity.CAPACITY_PREFIX + json.dumps(record),
                "timestamp": "2026-10-09T01:00:00Z",
            }
        ).encode()

    def test_unexpected_command_and_metadata_are_not_returned(self):
        report = capacity.service_report(
            {
                "serviceInstance": {
                    "numReplicas": 1,
                    "startCommand": PRIVATE,
                    "activeDeployments": [
                        {
                            "id": ID,
                            "meta": PRIVATE,
                            "instances": [{"id": ID, "secret": PRIVATE}],
                        }
                    ],
                }
            },
            "known reviewed command",
        )
        self.assertFalse(report["dashboard_start_command_matches_repository"])
        self.assertNotIn(PRIVATE, json.dumps(report))

    def test_missing_or_other_instance_metric_is_unavailable_not_zero(self):
        data = {
            "metrics": [
                {
                    "measurement": "MEMORY_USAGE_GB",
                    "tags": {"deploymentInstanceId": "other"},
                    "values": [{"ts": 1_791_504_000, "value": 10}],
                }
            ]
        }
        report = capacity.metric_report(data, {ID})
        self.assertIsNone(report[0]["measurements"]["MEMORY_USAGE_GB"])

    def test_only_running_instances_are_used_for_metrics(self):
        report = capacity.service_report(
            {
                "serviceInstance": {
                    "numReplicas": 1,
                    "startCommand": "reviewed",
                    "activeDeployments": [
                        {
                            "id": ID,
                            "instances": [
                                {"id": ID, "status": "RUNNING"},
                                {
                                    "id": "00000000-0000-0000-0000-000000000002",
                                    "status": "CRASHED",
                                },
                            ],
                        }
                    ],
                }
            },
            "reviewed",
        )
        self.assertEqual(report["active_deployments"][0]["running_instance_ids"], [ID])

    def test_metrics_keep_time_and_peak_and_ignore_non_numeric_private_values(self):
        data = {
            "metrics": [
                {
                    "measurement": "MEMORY_USAGE_GB",
                    "tags": {"deploymentInstanceId": ID},
                    "values": [
                        {"ts": 1_791_504_000, "value": 0.8},
                        {"ts": 1_791_504_060, "value": 0.3},
                        {"ts": 1_791_504_080, "value": PRIVATE},
                        {"ts": 1_791_504_080, "value": float("nan")},
                    ],
                }
            ]
        }
        report = capacity.metric_report(data, {ID})
        metric = report[0]["measurements"]["MEMORY_USAGE_GB"]
        self.assertEqual(metric["latest"], 0.3)
        self.assertEqual(metric["maximum"], 0.8)
        self.assertEqual(metric["sample_count"], 2)
        self.assertNotIn(PRIVATE, json.dumps(report))

    def test_private_logs_and_unknown_record_fields_are_discarded(self):
        raw = (
            json.dumps({"message": PRIVATE}).encode()
            + b"\n"
            + self.record(private=PRIVATE)
        )
        report = capacity.capacity_record(raw)
        self.assertEqual(report["api_process_count"], 1)
        self.assertNotIn(PRIVATE, json.dumps(report))

    def test_private_value_inside_numeric_or_timestamp_field_is_rejected(self):
        self.assertIsNone(capacity.capacity_record(self.record(free_bytes=PRIVATE)))
        envelope = json.loads(self.record())
        envelope["timestamp"] = PRIVATE
        self.assertIsNone(capacity.capacity_record(json.dumps(envelope).encode()))

    def test_unknown_record_prefix_cannot_be_reported(self):
        self.assertIsNone(
            capacity.capacity_record(
                self.record().replace(
                    capacity.CAPACITY_PREFIX.encode(), b"OTHER_PREFIX "
                )
            )
        )

    def test_unlimited_memory_is_explicit(self):
        self.assertEqual(
            capacity.capacity_record(self.record(cgroup_max_bytes="max"))[
                "cgroup_max_bytes"
            ],
            "max",
        )

    def test_null_capacity_values_stay_unavailable(self):
        report = capacity.capacity_record(
            self.record(
                free_bytes=None,
                cgroup_current_bytes=None,
                cgroup_max_bytes=None,
                api_process_count=None,
            )
        )
        for key in (
            "free_bytes",
            "cgroup_current_bytes",
            "cgroup_max_bytes",
            "api_process_count",
        ):
            self.assertIsNone(report[key])

    def test_missing_capacity_values_become_null_without_losing_other_values(self):
        envelope = json.loads(self.record())
        record = json.loads(envelope["message"][len(capacity.CAPACITY_PREFIX) :])
        del record["cgroup_current_bytes"]
        del record["cgroup_max_bytes"]
        envelope["message"] = capacity.CAPACITY_PREFIX + json.dumps(record)
        report = capacity.capacity_record(json.dumps(envelope).encode())
        self.assertEqual(report["free_bytes"], 3_000_000_000)
        self.assertEqual(report["api_process_count"], 1)
        self.assertIsNone(report["cgroup_current_bytes"])
        self.assertIsNone(report["cgroup_max_bytes"])

    def test_invalid_capacity_values_do_not_become_null(self):
        for key in (
            "free_bytes",
            "cgroup_current_bytes",
            "cgroup_max_bytes",
            "api_process_count",
        ):
            for value in (PRIVATE, True, 0.5, -1):
                with self.subTest(key=key, value=value):
                    self.assertIsNone(
                        capacity.capacity_record(self.record(**{key: value}))
                    )

    def test_wrong_identity_stops_before_any_other_read(self):
        data = {
            "projectToken": {
                "project": {"id": ID, "name": PRIVATE},
                "environment": {"id": ID, "name": "production"},
            }
        }
        with patch.object(capacity, "query", return_value=data) as query:
            with self.assertRaises(capacity.Unavailable):
                capacity.collect("fake-test-token")
        self.assertEqual(query.call_count, 1)

    def test_main_never_echoes_exception_details(self):
        output = io.StringIO()
        with (
            patch.dict(capacity.os.environ, {"RAILWAY_TOKEN": "fake-test-token"}),
            patch.object(capacity, "collect", side_effect=RuntimeError(PRIVATE)),
            contextlib.redirect_stdout(output),
        ):
            self.assertEqual(capacity.main(), 1)
        self.assertNotIn(PRIVATE, output.getvalue())
        self.assertNotIn("fake-test-token", output.getvalue())

    def test_provider_error_body_is_discarded(self):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            {"errors": [{"message": PRIVATE}], "data": {"private": PRIVATE}}
        ).encode()
        with patch.object(capacity.urllib.request, "urlopen", return_value=response):
            with self.assertRaises(capacity.Unavailable) as raised:
                capacity.query(
                    "fake-test-token", "query Test { projectToken { id } }", {}
                )
        self.assertNotIn(PRIVATE, str(raised.exception))

    def test_cli_errors_never_escape(self):
        process = unittest.mock.MagicMock(
            returncode=1, stdout=PRIVATE.encode(), stderr=PRIVATE.encode()
        )
        with patch.object(capacity.subprocess, "run", return_value=process) as run:
            report = capacity.deployment_capacity(
                {"projectId": ID, "environmentId": ID, "serviceId": ID}, ID
            )
        self.assertIsNone(report)
        self.assertTrue(run.call_args.kwargs["capture_output"])
        self.assertIn("--lines", run.call_args.args[0])
        self.assertIn("100", run.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
