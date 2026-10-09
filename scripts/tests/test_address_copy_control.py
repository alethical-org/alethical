from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

SCRIPTS = Path(__file__).resolve().parents[1]
with patch.object(sys, "path", [str(SCRIPTS), *sys.path]):
    SPEC = importlib.util.spec_from_file_location(
        "address_copy_control", SCRIPTS / "address_copy_control.py"
    )
    assert SPEC and SPEC.loader
    control = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(control)

OLD = "00000000-0000-0000-0000-000000000001"
NEW = "00000000-0000-0000-0000-000000000002"
INSTANCE = "00000000-0000-0000-0000-000000000003"
IDS = {"projectId": OLD, "environmentId": OLD, "serviceId": OLD}
COMMIT = "a" * 40
PRIVATE = "private-password-and-typed-address"
NOW = datetime(2026, 10, 9, 1, 0, tzinfo=UTC)


def report():
    return {
        "identity": IDS.copy(),
        "plan": "hobby",
        "service": {
            "configured_replicas": 1,
            "dashboard_start_command_matches_repository": True,
            "active_deployments": [{"id": OLD, "running_instance_ids": [INSTANCE]}],
        },
        "startup_capacity": {
            "enabled": False,
            "recorded_at": NOW.isoformat(),
            "free_bytes": 3_000_000_000,
            "api_process_count": 1,
            "cgroup_current_bytes": 100_000_000,
            "cgroup_max_bytes": 1_000_000_000,
        },
        "metrics": [
            {
                "instance_id": INSTANCE,
                "measurements": {
                    "MEMORY_USAGE_GB": {
                        "latest": 0.1,
                        "maximum": 0.5,
                        "latest_timestamp": NOW.timestamp(),
                        "sample_count": 2,
                    },
                    "MEMORY_LIMIT_GB": {
                        "latest": 1.0,
                        "maximum": 1.0,
                        "latest_timestamp": NOW.timestamp(),
                        "sample_count": 2,
                    },
                },
            }
        ],
    }


class GateTests(unittest.TestCase):
    def test_known_single_paid_container_passes(self):
        control.activation_gate(report(), IDS, OLD, NOW)

    def reject(self, value):
        with self.assertRaises(control.Refused) as raised:
            control.activation_gate(value, IDS, OLD, NOW)
        self.assertEqual(
            str(raised.exception), "activation_capacity_insufficient_or_unknown"
        )
        self.assertNotIn(PRIVATE, str(raised.exception))

    def test_free_trial_unknown_plan_refused(self):
        for plan in ("free", "trial", None, PRIVATE):
            value = report()
            value["plan"] = plan
            self.reject(value)

    def test_multiple_unknown_replicas_deployments_instances_refused(self):
        for key, replacement in (
            ("configured_replicas", 2),
            ("configured_replicas", None),
            ("configured_replicas", True),
            ("dashboard_start_command_matches_repository", False),
            ("active_deployments", []),
            ("active_deployments", [{"id": OLD, "running_instance_ids": []}]),
            ("active_deployments", [{"id": NEW, "running_instance_ids": [INSTANCE]}]),
            (
                "active_deployments",
                [{"id": OLD, "running_instance_ids": [INSTANCE, NEW]}],
            ),
            (
                "active_deployments",
                [{"id": OLD, "running_instance_ids": [INSTANCE]}] * 2,
            ),
        ):
            with self.subTest(key=key, replacement=replacement):
                value = report()
                value["service"][key] = replacement
                self.reject(value)

    def test_bad_missing_unlimited_startup_facts_refused(self):
        for key, bad in (
            ("free_bytes", None),
            ("free_bytes", 2_999_999_999),
            ("cgroup_current_bytes", None),
            ("cgroup_max_bytes", "max"),
            ("cgroup_max_bytes", None),
            ("api_process_count", None),
            ("api_process_count", 2),
            ("api_process_count", True),
            ("enabled", True),
            ("recorded_at", PRIVATE),
            ("recorded_at", "2026-10-09T00:29:59+00:00"),
            ("recorded_at", "2026-10-09T01:00:01+00:00"),
        ):
            value = report()
            value["startup_capacity"][key] = bad
            self.reject(value)
        value = report()
        del value["startup_capacity"]["free_bytes"]
        self.reject(value)

    def test_missing_other_instance_stale_or_private_metrics_refused(self):
        for name in ("MEMORY_USAGE_GB", "MEMORY_LIMIT_GB"):
            value = report()
            value["metrics"][0]["measurements"][name] = None
            self.reject(value)
            for key, bad in (
                ("maximum", PRIVATE),
                ("latest", float("nan")),
                ("latest_timestamp", NOW.timestamp() - 301),
                ("latest_timestamp", NOW.timestamp() + 1),
                ("sample_count", 0),
            ):
                value = report()
                value["metrics"][0]["measurements"][name][key] = bad
                self.reject(value)
        value = report()
        value["metrics"][0]["instance_id"] = NEW
        self.reject(value)
        value = report()
        value["metrics"] = []
        self.reject(value)

    def test_peak_and_startup_usage_both_constrain_memory(self):
        for source in ("startup", "peak"):
            value = report()
            if source == "startup":
                value["startup_capacity"]["cgroup_current_bytes"] = 900_000_000
            else:
                value["metrics"][0]["measurements"]["MEMORY_USAGE_GB"]["maximum"] = 0.9
            self.reject(value)

    def test_smaller_observed_memory_limit_controls_gate(self):
        value = report()
        value["metrics"][0]["measurements"]["MEMORY_LIMIT_GB"]["latest"] = 0.6
        self.reject(value)

    def test_identity_changed_during_report_refused(self):
        value = report()
        value["identity"]["serviceId"] = NEW
        self.reject(value)


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.query = self.stack.enter_context(patch.object(control.capacity, "query"))
        self.stack.enter_context(
            patch.object(control.capacity, "identity", return_value=IDS)
        )
        self.collect = self.stack.enter_context(
            patch.object(control.capacity, "collect", return_value=report())
        )
        self.version = self.stack.enter_context(
            patch.object(control, "version_matches", return_value=True)
        )
        self.target = self.stack.enter_context(
            patch.object(control, "target", return_value=OLD)
        )
        self.pending = self.stack.enter_context(patch.object(control, "pending_clear"))
        self.set_flag = self.stack.enter_context(patch.object(control, "set_flag"))
        self.redeploy = self.stack.enter_context(
            patch.object(control, "redeploy", return_value=NEW)
        )
        self.ready = self.stack.enter_context(
            patch.object(control, "replacement_ready", return_value=True)
        )
        self.gate = self.stack.enter_context(patch.object(control, "activation_gate"))

    def test_on_deploys_exact_reviewed_active_id(self):
        result = control.control("fake-token", True, COMMIT)
        self.assertEqual(result["status"], "verified")
        self.set_flag.assert_called_once_with(IDS, True)
        self.redeploy.assert_called_once_with("fake-token", OLD)
        self.assertEqual(
            self.ready.call_args.args, ("fake-token", IDS, NEW, COMMIT, True)
        )
        self.assertIn("end_by", self.ready.call_args.kwargs)

    def test_off_bypasses_capacity_plan_process_and_memory_gate(self):
        self.collect.side_effect = RuntimeError(PRIVATE)
        self.gate.side_effect = RuntimeError(PRIVATE)
        result = control.control("fake-token", False, COMMIT)
        self.assertEqual(result["status"], "verified")
        self.collect.assert_not_called()
        self.gate.assert_not_called()
        self.set_flag.assert_called_once_with(IDS, False)

    def test_capacity_failure_performs_no_mutation(self):
        self.gate.side_effect = control.Refused(
            "activation_capacity_insufficient_or_unknown"
        )
        result = control.control("fake-token", True, COMMIT)
        self.assertEqual(result["status"], "refused")
        self.set_flag.assert_not_called()
        self.redeploy.assert_not_called()

    def test_wrong_release_target_changed_or_busy_performs_no_mutation(self):
        for mode in ("version", "changed", "busy"):
            self.version.return_value = mode != "version"
            self.target.side_effect = [OLD, NEW] if mode == "changed" else None
            if mode == "busy":
                self.target.side_effect = control.Refused(
                    "another_deployment_or_unknown_state"
                )
            result = control.control("fake-token", True, COMMIT)
            self.assertEqual(result["status"], "refused")
            self.set_flag.assert_not_called()

    def test_failed_new_deployment_restores_false_and_same_reviewed_code(self):
        self.ready.side_effect = [False, True]
        result = control.control("fake-token", True, COMMIT)
        self.assertEqual(result["rollback"], "off_verified")
        self.assertEqual(
            self.set_flag.call_args_list,
            [unittest.mock.call(IDS, True), unittest.mock.call(IDS, False)],
        )
        self.assertEqual(
            self.redeploy.call_args_list, [unittest.mock.call("fake-token", OLD)] * 2
        )

    def test_lost_set_response_also_attempts_restore_false(self):
        self.set_flag.side_effect = [RuntimeError(PRIVATE), None]
        result = control.control("fake-token", True, COMMIT)
        self.assertEqual(result["rollback"], "off_verified")
        self.assertNotIn(PRIVATE, json.dumps(result))
        self.assertEqual(
            self.set_flag.call_args_list[-1], unittest.mock.call(IDS, False)
        )

    def test_failed_restore_is_reported_without_private_error(self):
        self.set_flag.side_effect = RuntimeError(PRIVATE)
        result = control.control("fake-token", True, COMMIT)
        self.assertEqual(result["rollback"], "off_flag_unconfirmed")
        self.assertNotIn(PRIVATE, json.dumps(result))

    def test_pending_deployment_prevents_rollback_deploy_but_false_is_saved(self):
        self.ready.return_value = False
        self.target.side_effect = [
            OLD,
            OLD,
            OLD,
            control.Refused("another_deployment_or_unknown_state"),
        ]
        result = control.control("fake-token", True, COMMIT)
        self.assertEqual(result["rollback"], "off_flag_saved_deployment_unconfirmed")
        self.assertEqual(
            self.set_flag.call_args_list[-1], unittest.mock.call(IDS, False)
        )
        self.redeploy.assert_called_once()

    def test_other_operator_replacement_is_not_overwritten_during_restore(self):
        self.ready.return_value = False
        self.target.side_effect = [OLD, OLD, OLD, INSTANCE]
        result = control.control("fake-token", True, COMMIT)
        self.assertEqual(result["rollback"], "off_flag_saved_deployment_unconfirmed")
        self.redeploy.assert_called_once()
        self.assertEqual(
            self.set_flag.call_args_list[-1], unittest.mock.call(IDS, False)
        )

    def test_unexpected_refusal_text_never_reaches_report(self):
        self.target.side_effect = control.Refused(PRIVATE)
        result = control.control("fake-token", True, COMMIT)
        self.assertEqual(result["reason"], "control_unavailable")
        self.assertNotIn(PRIVATE, json.dumps(result))

    def test_invalid_inputs_make_no_provider_call(self):
        for enabled, commit in (
            ("true", COMMIT),
            (True, PRIVATE),
            (True, None),
            (False, "A" * 40),
        ):
            result = control.control("fake-token", enabled, commit)
            self.assertEqual(result["reason"], "invalid_control_inputs")
        self.query.assert_not_called()


class ProviderTests(unittest.TestCase):
    def setUp(self):
        # No readiness fixture may sleep or depend on the machine's clock,
        # including a fixture that becomes a failure during a later edit.
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(control.time, "sleep"))
        self.stack.enter_context(
            patch.object(control.time, "monotonic", return_value=0)
        )

    def test_actual_public_origin_query_label_and_long_copy_wait(self):
        seconds = [0.0]

        def sleep(amount):
            seconds[0] += amount

        def query(token, statement, variables):
            self.assertEqual(statement, control.STATE)
            return {
                "deployment": {
                    "id": NEW,
                    "status": "SUCCESS" if seconds[0] >= 170 else "BUILDING",
                    **IDS,
                }
            }

        def read(path, body=None):
            if path == "/readyz":
                return {"status": "ready"}
            self.assertEqual(path, "/api/v1/address-suggestions")
            self.assertEqual(body, {"address_text": "350 S 5th St Minneapolis"})
            return {
                "data": {
                    "suggestions": [
                        {
                            "matched_address": "350 5th Street South, Minneapolis, MN 55415",
                            "requires_location_check": seconds[0] >= 170 + 180 + 11.6,
                        }
                    ]
                }
            }

        startup = dict(report()["startup_capacity"], enabled=True)
        raw = json.dumps(
            {
                "message": control.capacity.CAPACITY_PREFIX + json.dumps(startup),
                "timestamp": datetime.now(UTC).isoformat(),
            }
        ).encode()
        parsed = control.capacity.capacity_record(raw)
        with (
            patch.object(control.time, "monotonic", side_effect=lambda: seconds[0]),
            patch.object(control.time, "sleep", side_effect=sleep),
            patch.object(control.capacity, "query", side_effect=query),
            patch.object(
                control.capacity, "deployment_capacity", return_value=parsed
            ) as logs,
            patch.object(control, "active_matches", return_value=True),
            patch.object(control, "version_matches", return_value=True),
            patch.object(control, "public_read", side_effect=read),
        ):
            self.assertTrue(
                control.replacement_ready(
                    "fake-token", IDS, NEW, COMMIT, True, end_by=480
                )
            )
        self.assertEqual(seconds[0], 370)
        logs.assert_called_once_with(IDS, NEW)

    def test_fixed_origin_is_used_for_every_public_request(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b"{}"
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(control.urllib.request, "build_opener", return_value=opener):
            for path in ("/version", "/readyz", "/api/v1/address-suggestions"):
                control.public_read(path)
                request = opener.open.call_args.args[0]
                self.assertEqual(
                    request.full_url,
                    "https://alethical-api-production.up.railway.app" + path,
                )

    def test_on_timeout_leaves_restoration_budget_inside_job_limit(self):
        seconds = [0.0]

        def sleep(amount):
            seconds[0] += amount

        row = {"deployment": {"id": NEW, "status": "BUILDING", **IDS}}
        with (
            patch.object(control.time, "monotonic", side_effect=lambda: seconds[0]),
            patch.object(control.time, "sleep", side_effect=sleep),
            patch.object(control.capacity, "query", return_value=row),
        ):
            self.assertFalse(
                control.replacement_ready(
                    "fake-token", IDS, NEW, COMMIT, True, end_by=control.ON_WAIT_SECONDS
                )
            )
        self.assertLessEqual(seconds[0], 480)
        self.assertGreaterEqual(control.TOTAL_SECONDS - seconds[0], 360)
        self.assertLess(control.TOTAL_SECONDS, 15 * 60)

    def test_replacement_must_be_the_only_active_successful_deployment(self):
        for rows, expected in (
            ([{"id": NEW, "status": "SUCCESS"}], True),
            ([{"id": OLD, "status": "SUCCESS"}], False),
            ([{"id": NEW, "status": "DEPLOYING"}], False),
            ([{"id": NEW, "status": "SUCCESS"}] * 2, False),
            ([], False),
        ):
            with patch.object(
                control.capacity,
                "query",
                return_value={"serviceInstance": {"activeDeployments": rows}},
            ):
                self.assertIs(control.active_matches("fake-token", IDS, NEW), expected)

    def test_public_errors_and_large_responses_are_private(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b"x" * 64_001
        opener = MagicMock()
        opener.open.return_value = response
        for error in (None, RuntimeError(PRIVATE)):
            opener.open.side_effect = error
            with patch.object(
                control.urllib.request, "build_opener", return_value=opener
            ):
                with self.assertRaises(control.Refused) as raised:
                    control.public_read("/version")
                self.assertEqual(str(raised.exception), "public_read_unavailable")
                self.assertNotIn(PRIVATE, str(raised.exception))

    def test_unknown_public_path_never_opens_a_request(self):
        with patch.object(control.urllib.request, "build_opener") as opener:
            with self.assertRaises(control.Refused):
                control.public_read("/" + PRIVATE)
        opener.assert_not_called()

    def test_unknown_suggestion_does_not_prove_copy_ready_and_reads_are_bounded(self):
        row = {"deployment": {"id": NEW, "status": "SUCCESS", **IDS}}
        record = {"enabled": True, "recorded_at": datetime.now(UTC).isoformat()}

        def read(path, body=None):
            if path == "/readyz":
                return {"status": "ready"}
            return {
                "data": {
                    "suggestions": [
                        {"matched_address": PRIVATE, "requires_location_check": True}
                    ]
                }
            }

        with (
            patch.object(control.capacity, "query", return_value=row) as query,
            patch.object(
                control.capacity, "deployment_capacity", return_value=record
            ) as logs,
            patch.object(control, "version_matches", return_value=True),
            patch.object(control, "active_matches", return_value=True),
            patch.object(control, "public_read", side_effect=read),
            patch.object(control.time, "sleep"),
        ):
            self.assertFalse(
                control.replacement_ready("fake-token", IDS, NEW, COMMIT, True)
            )
        self.assertEqual(query.call_count, control.ON_WAIT_SECONDS // 10 + 1)
        logs.assert_called_once()

    def test_off_readiness_needs_no_address_request(self):
        row = {"deployment": {"id": NEW, "status": "SUCCESS", **IDS}}
        record = {"enabled": False, "recorded_at": datetime.now(UTC).isoformat()}
        with (
            patch.object(control.capacity, "query", return_value=row),
            patch.object(control.capacity, "deployment_capacity", return_value=record),
            patch.object(control, "version_matches", return_value=True),
            patch.object(control, "active_matches", return_value=True),
            patch.object(
                control, "public_read", return_value={"status": "ready"}
            ) as read,
        ):
            self.assertTrue(
                control.replacement_ready("fake-token", IDS, NEW, COMMIT, False)
            )
        read.assert_called_once_with("/readyz")

    def test_only_one_flag_and_skip_deploys_are_sent(self):
        result = MagicMock(
            returncode=0,
            stdout=json.dumps({"keys": [control.FLAG], "set": True}).encode(),
            stderr=PRIVATE.encode(),
        )
        with patch.object(control.subprocess, "run", return_value=result) as run:
            control.set_flag(IDS, True)
        command = run.call_args.args[0]
        self.assertIn(control.FLAG + "=true", command)
        self.assertIn("--skip-deploys", command)
        self.assertIn("@railway/cli@5.41.2", command)
        self.assertEqual(command[3:5], ["variable", "set"])
        self.assertTrue(run.call_args.kwargs["capture_output"])
        self.assertNotIn("delete", command)
        self.assertNotIn("list", command)

    def test_cli_errors_and_invalid_success_are_private(self):
        for result in (
            MagicMock(returncode=1, stdout=PRIVATE.encode(), stderr=PRIVATE.encode()),
            MagicMock(
                returncode=0,
                stdout=json.dumps({"keys": [PRIVATE], "set": True}).encode(),
                stderr=b"",
            ),
        ):
            with patch.object(control.subprocess, "run", return_value=result):
                with self.assertRaises(control.Refused) as raised:
                    control.set_flag(IDS, False)
                self.assertEqual(str(raised.exception), "flag_update_unconfirmed")

    def test_redeploy_operation_sends_exact_id_without_source_or_values(self):
        with patch.object(
            control.capacity,
            "query",
            return_value={"deploymentRedeploy": {"id": NEW, "private": PRIVATE}},
        ) as query:
            self.assertEqual(control.redeploy("fake-token", OLD), NEW)
        query.assert_called_once_with("fake-token", control.REDEPLOY, {"id": OLD})
        self.assertNotIn("meta", control.REDEPLOY)
        self.assertNotIn("variables", control.REDEPLOY)

    def test_pending_unknown_or_incomplete_deployment_list_refuses(self):
        for result in (
            {},
            {"deployments": {"edges": [], "pageInfo": {"hasNextPage": True}}},
            {
                "deployments": {
                    "edges": [{"node": {"id": OLD, "status": PRIVATE}}],
                    "pageInfo": {"hasNextPage": False},
                }
            },
        ):
            with patch.object(control.capacity, "query", return_value=result):
                with self.assertRaises(control.Refused):
                    control.pending_clear("fake-token", IDS)

    def test_replacement_requires_new_record_version_ready_and_known_suggestion(self):
        row = {"deployment": {"id": NEW, "status": "SUCCESS", **IDS}}
        record = {"enabled": True, "recorded_at": datetime.now(UTC).isoformat()}
        with (
            patch.object(control.capacity, "query", return_value=row),
            patch.object(
                control.capacity, "deployment_capacity", return_value=record
            ) as logs,
            patch.object(control, "version_matches", return_value=True),
            patch.object(control, "active_matches", return_value=True),
            patch.object(
                control,
                "public_read",
                side_effect=[
                    {"status": "ready"},
                    {
                        "data": {
                            "suggestions": [
                                {
                                    "matched_address": "350 5th Street South, Minneapolis, MN 55415",
                                    "requires_location_check": True,
                                    "private": PRIVATE,
                                }
                            ]
                        }
                    },
                ],
            ),
        ):
            self.assertTrue(
                control.replacement_ready("fake-token", IDS, NEW, COMMIT, True)
            )
        logs.assert_called_once_with(IDS, NEW)

    def test_wrong_new_deployment_record_or_target_never_verifies(self):
        row = {"deployment": {"id": NEW, "status": "SUCCESS", **IDS}}
        for record in (
            None,
            {"enabled": False, "recorded_at": datetime.now(UTC).isoformat()},
            {"enabled": True, "recorded_at": PRIVATE},
        ):
            with (
                patch.object(control.capacity, "query", return_value=row),
                patch.object(
                    control.capacity, "deployment_capacity", return_value=record
                ),
            ):
                self.assertFalse(
                    control.replacement_ready("fake-token", IDS, NEW, COMMIT, True)
                )
        row["deployment"]["serviceId"] = INSTANCE
        with patch.object(control.capacity, "query", return_value=row):
            self.assertFalse(
                control.replacement_ready("fake-token", IDS, NEW, COMMIT, True)
            )

    def test_main_discards_unexpected_errors_and_private_input(self):
        for enabled, commit in (("true", COMMIT), (PRIVATE, PRIVATE)):
            output = io.StringIO()
            with (
                patch.dict(
                    control.os.environ,
                    {
                        "RAILWAY_TOKEN": "fake-token",
                        "ADDRESS_COPY_ENABLED": enabled,
                        "ADDRESS_COPY_RELEASE_COMMIT": commit,
                    },
                ),
                patch.object(control, "control", side_effect=RuntimeError(PRIVATE)),
                contextlib.redirect_stdout(output),
            ):
                self.assertEqual(control.main(), 1)
            self.assertNotIn(PRIVATE, output.getvalue())
            self.assertNotIn("fake-token", output.getvalue())


if __name__ == "__main__":
    unittest.main()
