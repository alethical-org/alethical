"""Offline contract checks. No production requests, accounts, or database."""

from __future__ import annotations

import contextlib
import copy
from datetime import datetime, timedelta, timezone
from email.message import Message
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

from scripts import check_site_metrics_health as health


NOW = datetime(2026, 9, 7, 16, 45, tzinfo=timezone.utc)
END = NOW.replace(minute=0)


def period(days):
    start = END - timedelta(days=days)
    return {
        "startsAt": start.isoformat(),
        "endsAt": END.isoformat(),
        "previousStartsAt": (start - timedelta(days=days)).isoformat(),
        "previousEndsAt": start.isoformat(),
    }


def fixtures():
    recent = NOW.isoformat()
    periods = {f"periods{days}d": period(days) for days in (7, 30)}
    actions = dict.fromkeys(health.ACTIONS, 0)
    history = {
        key: {"recordingStartedAt": None, **dict.fromkeys(health.COVERAGE_FLAGS, False)}
        for key in health.ACTIONS
    }
    search = {
        **dict.fromkeys(
            (
                "clicks30d",
                "impressions30d",
                "previousClicks30d",
                "previousImpressions30d",
            ),
            0,
        ),
        "periodStartedOn": "2026-08-06",
        "periodEndedOn": "2026-09-04",
        "previousPeriodStartedOn": "2026-07-07",
        "previousPeriodEndedOn": "2026-08-05",
        "fetchedAt": recent,
    }
    breakdown = {
        "destinationPageViews": dict.fromkeys(health.DESTINATIONS, 0),
        **{
            key: {
                "pageViews": 0,
                "differentProfilesViewed": {"count": 0, "cap": 100, "capped": False},
            }
            for key in ("billProfiles", "legislatorProfiles")
        },
    }
    return {
        "traffic": {
            **dict.fromkeys(
                (
                    "pageViews24h",
                    "pageViews7d",
                    "pageViews30d",
                    "estimatedVisitors24h",
                    "estimatedVisitors7d",
                    "estimatedVisitors30d",
                ),
                0,
            ),
            "trafficBreakdown7d": copy.deepcopy(breakdown),
            "trafficBreakdown30d": copy.deepcopy(breakdown),
            "fetchedAt": recent,
            "windowEndedAt": END.isoformat(),
            "countingStartedAt": "2026-08-01T00:00:00Z",
            "teamExclusionConfigured": True,
        },
        "google": copy.deepcopy(search),
        "bing": copy.deepcopy(search),
        "uptime": {
            "websiteAvailability30d": 80,
            "apiAvailability30d": 0,
            "trafficPageAvailability30d": None,
            "fetchedAt": recent,
            "measuredAt": {"website": recent, "api": recent},
            "monitoringStartedAt": {
                "website": "2026-09-01T00:00:00Z",
                "api": "2026-09-01T00:00:00Z",
            },
            "measurementSource": {"website": "status-page", "api": "status-page"},
        },
        "performance": {
            "lcpP75Ms": None,
            "lcpSamples": 12,
            "inpP75Ms": None,
            "inpSamples": 0,
            "clsP75": None,
            "clsSamples": 49,
            "sampleInterval": 1,
            "measurementScope": "document-loads",
            "navigationTypes": list(health.NAVIGATION_TYPES),
            "knownBotsExcluded": True,
            "sampleCountSource": "cloudflare-confidence",
            "minimumSamples": 50,
            "periodStartedOn": "2026-08-08",
            "periodEndedOn": "2026-09-06",
            "fetchedAt": recent,
        },
        "actions": {
            "data": {
                "actions7d": actions.copy(),
                "actions30d": actions.copy(),
                "previousActions7d": dict.fromkeys(actions),
                "previousActions30d": dict.fromkeys(actions),
                **periods,
                "history": history,
                "totalsSinceStart": dict.fromkeys(health.CREATIONS, 0),
                "readers": dict.fromkeys(health.READERS, 0),
                "fetchedAt": recent,
                "teamExclusionConfigured": True,
            }
        },
        "accounts": {
            **dict.fromkeys(health.ACCOUNT_COUNTS, 0),
            **periods,
            "asOf": recent,
            "source": "supabase",
            "scope": "current_surviving_reader_accounts",
            "definition": "Accounts still present, with linked sign-ins counted once.",
            "historyLimitation": "Deleted accounts are not included, so past creation totals can decrease.",
        },
    }


class FakeResponse(io.BytesIO):
    def __init__(self, body=b"{}", content_type="application/json"):
        super().__init__(body)
        self.headers = {"Content-Type": content_type}


class ContractsTest(unittest.TestCase):
    def setUp(self):
        self.data = fixtures()

    def check(self, source):
        return health.validate(source, self.data[source], NOW)

    def test_all_sources_accept_zero_counts_and_low_measured_availability(self):
        for source in self.data:
            with self.subTest(source=source):
                self.assertIn(self.check(source), ("healthy", "building sample"))

    def test_missing_required_fields_never_default_to_zero(self):
        for source, field in (
            ("traffic", "pageViews7d"),
            ("google", "impressions30d"),
            ("bing", "previousClicks30d"),
            ("uptime", "measuredAt"),
            ("performance", "sampleCountSource"),
            ("accounts", "currentAccountsCreated"),
        ):
            with self.subTest(source=source):
                del self.data[source][field]
                with self.assertRaises(health.HealthFailure):
                    self.check(source)
        del self.data["actions"]["data"]["history"]
        with self.assertRaises(health.HealthFailure):
            self.check("actions")

    def test_bad_numbers_never_pass_as_counts(self):
        for number in (True, -1, 0.5, "0", None, float("nan"), float("inf")):
            with self.subTest(number=number):
                self.data["traffic"]["pageViews7d"] = number
                with self.assertRaises(health.HealthFailure):
                    self.check("traffic")

    def test_recent_cache_and_clock_tolerance_have_boundaries(self):
        for age, valid in (
            (timedelta(hours=2), True),
            (timedelta(hours=2, seconds=1), False),
            (timedelta(minutes=-1), True),
            (timedelta(minutes=-1, seconds=-1), False),
        ):
            self.data["traffic"]["fetchedAt"] = (NOW - age).isoformat()
            with self.subTest(age=age):
                if valid:
                    self.check("traffic")
                else:
                    with self.assertRaises(health.HealthFailure):
                        self.check("traffic")

    def test_stale_window_fails_even_with_fresh_response(self):
        self.data["traffic"]["windowEndedAt"] = (END - timedelta(hours=3)).isoformat()
        with self.assertRaises(health.HealthFailure):
            self.check("traffic")

    def test_search_accepts_normal_lag_but_not_week_old_data_or_cache(self):
        self.check("google")
        self.data["google"]["fetchedAt"] = (
            NOW - timedelta(hours=48, seconds=1)
        ).isoformat()
        with self.assertRaises(health.HealthFailure):
            self.check("google")
        for key in (
            "periodStartedOn",
            "periodEndedOn",
            "previousPeriodStartedOn",
            "previousPeriodEndedOn",
        ):
            self.data["bing"][key] = (
                (datetime.fromisoformat(self.data["bing"][key]) - timedelta(days=5))
                .date()
                .isoformat()
            )
        with self.assertRaises(health.HealthFailure):
            self.check("bing")

    def test_search_periods_must_be_equal_and_adjacent(self):
        for field in (
            "periodStartedOn",
            "previousPeriodStartedOn",
            "previousPeriodEndedOn",
        ):
            with self.subTest(field=field):
                data = copy.deepcopy(self.data["bing"])
                data[field] = (
                    (datetime.fromisoformat(data[field]) - timedelta(days=1))
                    .date()
                    .isoformat()
                )
                with self.assertRaises(health.HealthFailure):
                    health.validate("bing", data, NOW)

    def test_timezone_and_real_calendar_dates_are_required(self):
        self.data["traffic"]["fetchedAt"] = "2026-09-07T16:45:00"
        self.data["bing"]["periodEndedOn"] = "2026-02-30"
        for source in ("traffic", "bing"):
            with self.assertRaises(health.HealthFailure):
                self.check(source)

    def test_partial_uptime_names_missing_monitor_and_fails(self):
        self.data["uptime"]["apiAvailability30d"] = None
        for key in ("measuredAt", "monitoringStartedAt", "measurementSource"):
            self.data["uptime"][key]["api"] = None
        with self.assertRaisesRegex(
            health.HealthFailure, "degraded: api measurement missing"
        ):
            self.check("uptime")

    def test_uptime_freshness_uses_measurement_not_response_time(self):
        self.data["uptime"]["measuredAt"]["website"] = (
            NOW - timedelta(minutes=21, seconds=1)
        ).isoformat()
        with self.assertRaises(health.HealthFailure):
            self.check("uptime")

    def test_uptime_requires_monitor_start_and_valid_source(self):
        for field, value in (
            ("monitoringStartedAt", "2099-01-01T00:00:00Z"),
            ("measurementSource", "analytics"),
        ):
            with self.subTest(field=field):
                data = copy.deepcopy(self.data["uptime"])
                data[field]["website"] = value
                with self.assertRaises(health.HealthFailure):
                    health.validate("uptime", data, NOW)

    def test_performance_null_only_below_fifty_and_scores_only_at_fifty(self):
        self.assertEqual(self.check("performance"), "building sample")
        for score, count, valid in (
            (None, 0, True),
            (None, 49, True),
            (None, 50, False),
            (64, 12, False),
            (64, 50, True),
            (0, 50, True),
        ):
            self.data["performance"].update(lcpP75Ms=score, lcpSamples=count)
            with self.subTest(score=score, count=count):
                if valid:
                    self.check("performance")
                else:
                    with self.assertRaises(health.HealthFailure):
                        self.check("performance")

    def test_performance_requires_complete_thirty_day_document_scope(self):
        for field, value in (
            ("periodEndedOn", "2026-09-07"),
            ("measurementScope", "all-pages"),
            ("navigationTypes", ["spa"]),
            ("knownBotsExcluded", False),
            ("minimumSamples", 49),
        ):
            data = copy.deepcopy(self.data["performance"])
            data[field] = value
            with self.subTest(field=field), self.assertRaises(health.HealthFailure):
                health.validate("performance", data, NOW)

    def test_new_traffic_destinations_and_exclusions_are_required(self):
        del self.data["traffic"]["trafficBreakdown7d"]["destinationPageViews"]["money"]
        with self.assertRaises(health.HealthFailure):
            self.check("traffic")
        self.data["actions"]["data"]["teamExclusionConfigured"] = False
        with self.assertRaises(health.HealthFailure):
            self.check("actions")

    def test_unknown_history_is_valid_but_cannot_claim_complete_previous_zero(self):
        self.check("actions")
        self.data["actions"]["data"]["previousActions7d"]["newBillWatches"] = 0
        with self.assertRaises(health.HealthFailure):
            self.check("actions")

    def test_account_totals_must_add_up_and_periods_align(self):
        self.data["accounts"]["currentConfirmedAccounts"] = 1
        with self.assertRaises(health.HealthFailure):
            self.check("accounts")
        self.data["accounts"]["currentConfirmedAccounts"] = 0
        self.data["accounts"]["periods7d"]["previousStartsAt"] = "2026-01-01T00:00:00Z"
        with self.assertRaises(health.HealthFailure):
            self.check("accounts")


class RequestsTest(unittest.TestCase):
    def fetch(self, outcomes):
        opener = Mock()
        opener.open.side_effect = outcomes
        with (
            patch.object(health, "build_opener", return_value=opener),
            patch.object(health.time, "sleep") as sleep,
        ):
            result = health.fetch_json(health.SOURCES[0][1])
        return result, opener, sleep

    def test_get_is_cached_unauthenticated_and_bounded(self):
        result, opener, sleep = self.fetch([FakeResponse()])
        self.assertEqual(result, {})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertIsNone(request.data)
        self.assertEqual(request.full_url, health.SOURCES[0][1])
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 10)
        self.assertFalse(
            any(
                key.lower() in ("authorization", "cookie", "cache-control")
                for key in request.headers
            )
        )
        sleep.assert_not_called()

    def test_network_and_server_errors_retry_once(self):
        for error in (
            URLError("PRIVATE"),
            TimeoutError("PRIVATE"),
            HTTPError("PRIVATE", 503, "PRIVATE", Message(), None),
        ):
            with self.subTest(error=type(error).__name__):
                _, opener, sleep = self.fetch([error, FakeResponse()])
                self.assertEqual(opener.open.call_count, 2)
                sleep.assert_called_once_with(1)

    def test_repeated_failure_is_bounded_and_never_prints_remote_error(self):
        opener = Mock()
        opener.open.side_effect = URLError("PRIVATE")
        with (
            patch.object(health, "build_opener", return_value=opener),
            patch.object(health.time, "sleep"),
        ):
            with self.assertRaises(health.HealthFailure) as raised:
                health.fetch_json(health.SOURCES[0][1])
        self.assertEqual(opener.open.call_count, 2)
        self.assertNotIn("PRIVATE", str(raised.exception))

    def test_client_errors_redirects_bad_json_and_large_bodies_do_not_retry(self):
        for outcome in (
            HTTPError("PRIVATE", 401, "PRIVATE", Message(), None),
            HTTPError("PRIVATE", 302, "PRIVATE", Message(), None),
            FakeResponse(b"PRIVATE"),
            FakeResponse(b"NaN"),
            FakeResponse(b"x" * (health.MAX_BYTES + 1)),
            FakeResponse(b"{}", "text/html"),
        ):
            opener = Mock()
            opener.open.side_effect = (
                [outcome] if isinstance(outcome, Exception) else None
            )
            opener.open.return_value = outcome
            with (
                self.subTest(outcome=type(outcome).__name__),
                patch.object(health, "build_opener", return_value=opener),
                patch.object(health.time, "sleep") as sleep,
            ):
                with self.assertRaises(health.HealthFailure) as raised:
                    health.fetch_json(health.SOURCES[0][1])
                self.assertNotIn("PRIVATE", str(raised.exception))
                self.assertEqual(opener.open.call_count, 1)
                sleep.assert_not_called()

    def test_redirect_handler_does_not_follow_location(self):
        self.assertIsNone(
            health.NoRedirect().redirect_request(
                None, None, 302, "PRIVATE", {}, "https://private.invalid"
            )
        )

    def test_cli_visits_each_fixed_source_and_reports_no_payload(self):
        data = fixtures()
        by_url = {url: data[name] for name, url in health.SOURCES}
        by_url[health.SOURCES[1][1]] = {"private_email": "PRIVATE"}
        fetch = Mock(side_effect=lambda url: by_url[url])
        out = io.StringIO()
        with (
            tempfile.TemporaryDirectory() as tmp,
            patch.object(health, "fetch_json", fetch),
            contextlib.redirect_stdout(out),
        ):
            summary = Path(tmp) / "summary.md"
            self.assertEqual(health.main(["--summary", str(summary)], now=NOW), 1)
            self.assertNotIn("PRIVATE", summary.read_text())
            self.assertIn("google", summary.read_text())
        self.assertEqual(fetch.call_count, 7)
        self.assertNotIn("PRIVATE", out.getvalue())
        self.assertNotIn("private_email", out.getvalue())
        self.assertIn("accounts: healthy", out.getvalue())

    def test_workflow_is_free_read_only_daily_and_manual(self):
        workflow = (
            Path(__file__).resolve().parents[2]
            / ".github/workflows/site-metrics-health.yml"
        ).read_text()
        for required in (
            "schedule:",
            "workflow_dispatch:",
            "contents: read",
            "timeout-minutes:",
            "python -m unittest",
            "python scripts/check_site_metrics_health.py",
        ):
            self.assertIn(required, workflow)
        for forbidden in (
            "workflow_run:",
            "pull_request:",
            "secrets.",
            "issues: write",
            "pip install",
            "uv run",
        ):
            self.assertNotIn(forbidden, workflow)


if __name__ == "__main__":
    unittest.main()
