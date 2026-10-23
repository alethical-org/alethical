import copy
import json
import re
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from scripts import railway_deployment_timings as timing


DEPLOYMENT = {
    "id": "deploy-1",
    "projectId": "project-1",
    "environmentId": "env-1",
    "serviceId": "service-1",
    "createdAt": "2026-10-23T00:00:00Z",
    "status": "SUCCESS",
}
EVENT = {
    "id": "event-1",
    "step": "BUILD_IMAGE",
    "createdAt": "2026-10-23T00:00:10Z",
    "completedAt": "2026-10-23T00:01:10Z",
    "payload": {"durationMs": 59000, "attempt": 1, "maxAttempts": 3, "skipped": False},
}


class FakeAPI:
    def __init__(self):
        self.token = {
            "project": {"id": "project-1", "name": "alethical"},
            "environment": {"id": "env-1", "name": "production"},
        }
        self.deployment = copy.deepcopy(DEPLOYMENT)
        self.events = [copy.deepcopy(EVENT)]
        self.calls = []
        self.more = False

    def __call__(self, query, variables):
        self.calls.append((query, variables))
        if query == timing.TOKEN_QUERY:
            return {"projectToken": self.token}
        if query == timing.SERVICE_QUERY:
            return {
                "project": {
                    "services": {
                        "edges": [
                            {"node": {"id": "service-1", "name": "alethical-api"}}
                        ],
                        "pageInfo": {"hasNextPage": False},
                    }
                }
            }
        if query == timing.LATEST_QUERY:
            return {"serviceInstance": {"latestDeployment": self.deployment}}
        if query == timing.DEPLOYMENT_QUERY:
            return {"deployment": self.deployment}
        if query == timing.EVENTS_QUERY:
            return {
                "deploymentEvents": {
                    "edges": [{"node": e} for e in self.events],
                    "pageInfo": {"hasNextPage": self.more, "endCursor": "next"},
                }
            }
        raise AssertionError("unexpected query")


class RailwayTimingTests(unittest.TestCase):
    def test_selected_fields_and_separate_reported_duration(self):
        api = FakeAPI()
        api.events[0]["payload"]["detail"] = "private text must not escape"
        report = timing.collect(api)
        self.assertEqual(report["events"][0]["elapsed_seconds"], 60)
        self.assertEqual(report["events"][0]["reported_duration_ms"], 59000)
        self.assertIsNone(report["first_public_readiness_at"])
        self.assertNotIn("private text", json.dumps(report))
        for query, _ in api.calls:
            self.assertTrue(query.lstrip().startswith("query "))
            for field in (
                "mutation",
                "meta",
                "config(",
                "variables(",
                "detail",
                "error",
                "reason",
                "logs",
                "displayToken",
            ):
                self.assertNotIn(field, query)

    def test_wrong_token_scope_stops_before_service_read(self):
        for scope in ("project", "environment"):
            api = FakeAPI()
            api.token[scope]["name"] = "another"
            with self.assertRaises(timing.TimingError):
                timing.collect(api)
            self.assertEqual(len(api.calls), 1)

    def test_wrong_deployment_scope_stops_before_events(self):
        for key in ("projectId", "environmentId", "serviceId"):
            api = FakeAPI()
            api.deployment[key] = "another"
            with self.assertRaises(timing.TimingError):
                timing.collect(api, "deploy-1")
            self.assertFalse(any(q == timing.EVENTS_QUERY for q, _ in api.calls))

    def test_truncated_service_inventory_cannot_select_a_deployment(self):
        api = FakeAPI()

        def truncated(query, variables):
            result = api(query, variables)
            if query == timing.SERVICE_QUERY:
                result["project"]["services"]["pageInfo"]["hasNextPage"] = True
            return result

        with self.assertRaisesRegex(timing.TimingError, "Service inventory"):
            timing.collect(truncated)
        self.assertEqual(len(api.calls), 2)

    def test_missing_deployment_is_not_a_zero_duration_report(self):
        api = FakeAPI()
        api.deployment = None
        with self.assertRaises(timing.TimingError):
            timing.collect(api)

    def test_future_step_is_retained_without_an_invented_phase(self):
        event = copy.deepcopy(EVENT)
        event["step"] = "FUTURE_STEP"
        row = timing.event_row(event)
        self.assertEqual(row["phase"], "other")
        self.assertEqual(row["step"], "FUTURE_STEP")

    def test_timing_workflow_is_isolated_from_settings_and_credentials(self):
        source = (
            Path(__file__).resolve().parents[2]
            / ".github/workflows/railway-timings.yml"
        ).read_text()
        jobs = source.split("\njobs:\n", 1)[1]
        parts = re.split(r"(?m)^  ([a-z-]+):\n", jobs)
        blocks = dict(zip(parts[1::2], parts[2::2], strict=True))
        self.assertEqual(set(blocks), {"test-reader", "railway-timing"})
        selected = blocks["railway-timing"]
        self.assertIn("if: github.event_name == 'workflow_dispatch'", selected)
        self.assertIn("needs: test-reader", selected)
        self.assertEqual(re.findall(r"secrets\.([A-Z_]+)", source), ["RAILWAY_TOKEN"])
        self.assertNotIn("secrets.", blocks["test-reader"])
        self.assertIn("persist-credentials: false", selected)
        self.assertNotIn("supabase", source.lower())
        self.assertNotIn("hosted-service-settings", source)
        self.assertNotIn("check_hosted_service_settings.py", source)
        self.assertIn("group: railway-timings-", source)

    def test_missing_and_skipped_times_are_not_zero(self):
        for patch_value, expected in (
            ({"completedAt": None}, "unfinished"),
            ({"completedAt": "2026-10-22T00:00:00Z"}, "invalid_time"),
            ({"payload": {"skipped": True}}, "skipped"),
        ):
            event = copy.deepcopy(EVENT)
            event.update(patch_value)
            row = timing.event_row(event)
            self.assertEqual(row["timing_state"], expected)
            self.assertIsNone(row["elapsed_seconds"])

    def test_attempts_and_overlaps_stay_separate(self):
        api = FakeAPI()
        second = copy.deepcopy(EVENT)
        second["id"] = "event-2"
        second["payload"]["attempt"] = 2
        api.events.append(second)
        report = timing.collect(api)
        self.assertEqual(len(report["events"]), 2)
        self.assertEqual([e["attempt"] for e in report["events"]], [1, 2])
        self.assertNotIn("total_seconds", report)

    def test_pagination_fetches_next_page_and_does_not_hide_missing_phases(self):
        api = FakeAPI()

        def pages(query, variables):
            result = api(query, variables)
            if query == timing.EVENTS_QUERY and variables["after"] is None:
                result["deploymentEvents"]["pageInfo"]["hasNextPage"] = True
                result["deploymentEvents"]["edges"] = []
            return result

        report = timing.collect(pages)
        self.assertEqual(len(report["events"]), 1)
        self.assertIn("HEALTHCHECK", report["unobserved_steps"])
        self.assertEqual(len([q for q, _ in api.calls if q == timing.EVENTS_QUERY]), 2)

    def test_unbounded_or_repeated_pagination_fails(self):
        api = FakeAPI()
        api.more = True
        with self.assertRaises(timing.TimingError):
            timing.collect(api)

    def test_graphql_failure_never_echoes_response(self):
        with self.assertRaisesRegex(
            timing.TimingError, "Railway query failed"
        ) as result:
            timing.response_data({"errors": [{"message": "secret-value"}]})
        self.assertNotIn("secret-value", str(result.exception))

    def test_http_failure_never_echoes_response(self):
        from urllib.error import HTTPError

        with patch.object(
            timing.urllib.request.OpenerDirector,
            "open",
            side_effect=HTTPError("secret-url", 429, "secret-value", {}, None),
        ):
            with self.assertRaisesRegex(timing.TimingError, "Railway request failed"):
                timing.API("test-token")(timing.TOKEN_QUERY, {})

    def test_request_identifies_the_reader_to_railway(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"data": {"projectToken": {}}}'
        with patch.object(
            timing.urllib.request.OpenerDirector, "open", return_value=response
        ) as opened:
            timing.API("test-token")(timing.TOKEN_QUERY, {})
        request = opened.call_args.args[0]
        self.assertEqual(
            request.get_header("User-agent"), "alethical-railway-timings/1"
        )
        self.assertEqual(request.get_header("Project-access-token"), "test-token")


if __name__ == "__main__":
    unittest.main()
