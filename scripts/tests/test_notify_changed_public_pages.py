"""No live submissions or GitHub writes: check events and durable state guards."""

import base64
from copy import deepcopy
from datetime import datetime, timezone
from email.message import Message
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

from scripts import notify_changed_public_pages as notices
from scripts import check_public_search_health as health
from scripts.tests.test_check_public_search_health import html, response, xml, Stream

NOW = datetime(2026, 10, 7, 17, tzinfo=timezone.utc)
PUBLIC = health.ORIGIN + "/privacy"
OTHER = health.ORIGIN + "/terms"
OLDER = "2026-10-01T00:00:00+00:00"
NEWER = "2026-10-06T00:00:00+00:00"
TRUSTED = {"GITHUB_REF": "refs/heads/main", "GITHUB_REPOSITORY": notices.REPOSITORY}


def state(observed=None, pending=None, sent=None):
    return {
        "schema_version": 1,
        "origin": health.ORIGIN,
        "observed": observed or {PUBLIC: OLDER},
        "pending": pending or {},
        "last_sent_at": sent,
    }


class LastmodAndDiffTest(TestCase):
    def test_first_baseline_sends_no_old_inventory(self):
        first = notices.stage_changes(None, {PUBLIC: OLDER, OTHER: None}, NOW)
        self.assertEqual(first["pending"], {})
        self.assertEqual(first["observed"], {PUBLIC: OLDER, OTHER: None})

    def test_only_additions_removals_and_later_valid_dates_become_events(self):
        previous = state({PUBLIC: OLDER, OTHER: None})
        updated = notices.stage_changes(
            previous, {PUBLIC: NEWER, health.ORIGIN + "/about": None}, NOW
        )
        self.assertEqual(
            updated["pending"],
            {PUBLIC: "updated", OTHER: "removed", health.ORIGIN + "/about": "added"},
        )
        self.assertEqual(previous["pending"], {})

    def test_date_format_only_change_missing_dates_and_backwards_dates_send_none(self):
        for old, current in (
            ("2026-10-01", OLDER),
            (None, NEWER),
            (NEWER, None),
            (NEWER, OLDER),
            (OLDER, OLDER),
        ):
            self.assertEqual(
                notices.stage_changes(state({PUBLIC: old}), {PUBLIC: current}, NOW)[
                    "pending"
                ],
                {},
            )

    def test_invalid_or_future_lastmod_fails_closed(self):
        for value in (
            "today",
            "2026-13-01",
            "2026-10-08",
            "2026-10-01T00:00:00",
            "2026-10-01T26:00:00Z",
            1,
            "2026-10-07T18:00:00Z",
        ):
            with self.subTest(value=value), self.assertRaises(health.HealthFailure):
                notices.lastmod(value, NOW)
        self.assertEqual(notices.lastmod("2026-10-01", NOW), OLDER)

    def test_pending_survives_unchanged_inventory_and_reappearing_page_updates_event(
        self,
    ):
        previous = state({PUBLIC: OLDER}, {PUBLIC: "updated", OTHER: "removed"})
        result = notices.stage_changes(previous, {PUBLIC: OLDER, OTHER: None}, NOW)
        self.assertEqual(result["pending"], {PUBLIC: "updated", OTHER: "added"})

    def test_corrupt_state_or_private_addresses_fail_closed(self):
        examples = (
            {},
            {**state(), "origin": "https://example.invalid"},
            state({health.ORIGIN + "/admin/users": None}),
            state(pending={OTHER: "updated"}),
            state(sent=int(NOW.timestamp()) + 1),
        )
        for raw in examples:
            with self.assertRaises(health.HealthFailure):
                notices.validate_state(raw, NOW)

    def test_snapshot_validates_all_children_and_preserves_lastmod(self):
        fetcher = Mock()
        responses = [xml(health.SITEMAPS, index=True)]
        for index in range(7):
            entry = xml([f"{health.ORIGIN}/public-{index}"])
            if index == 1:
                entry.body = entry.body.replace(
                    b"</loc>", b"</loc><lastmod>2026-10-01</lastmod>"
                )
            responses.append(entry)
        fetcher.fetch.side_effect = responses
        result = notices.snapshot(fetcher, NOW)
        self.assertEqual(result[health.ORIGIN + "/public-1"], OLDER)
        self.assertEqual(fetcher.fetch.call_count, 8)
        responses[2].body = responses[2].body.replace(b"2026-10-01", b"2026-13-01")
        fetcher.fetch.side_effect = responses
        with self.assertRaises(health.HealthFailure):
            notices.snapshot(fetcher, NOW)


class MemoryStore:
    def __init__(self, old):
        self.saved = deepcopy(old)
        self.writes = []

    def read(self):
        return deepcopy(self.saved)

    def save(self, value):
        self.saved = deepcopy(value)
        self.writes.append(deepcopy(value))


class ExecutionSetup:
    def setUp(self):
        self.fetcher = Mock()
        self.fetcher.fetch.side_effect = self.fetch
        self.report = {"passed": False}
        self.inventory = {PUBLIC: NEWER}

    def fetch(self, url):
        if url == notices.KEY_URL:
            return response(notices.KEY + "\n", "text/plain")
        return html(url)

    def execute(self, old, *, apply=True, initialize=False, status=200):
        store = MemoryStore(old)
        with (
            patch.object(notices, "snapshot", return_value=self.inventory),
            patch.object(notices, "submit", return_value=status) as submit,
            patch.dict(notices.os.environ, TRUSTED),
        ):
            notices.run(
                store,
                self.fetcher,
                now=NOW,
                apply=apply,
                initialize=initialize,
                report=self.report,
            )
        return store, submit


class ExecutionTest(ExecutionSetup, TestCase):
    def test_initialization_saves_inventory_and_never_calls_submit(self):
        store, submit = self.execute(None, initialize=True)
        submit.assert_not_called()
        self.assertEqual(store.saved["pending"], {})
        self.assertEqual(self.report["notices_received"], 0)
        self.assertTrue(self.report["passed"])

    def test_missing_state_without_initialization_and_reinitialization_fail(self):
        for old, init in ((None, False), (state(), True)):
            with self.assertRaises(health.HealthFailure):
                self.execute(old, initialize=init)
            self.fetcher.fetch.assert_not_called()

    def test_dry_run_has_no_state_writes_ownership_reads_or_notices(self):
        store, submit = self.execute(state(), apply=False)
        self.assertEqual(store.writes, [])
        submit.assert_not_called()
        self.fetcher.fetch.assert_not_called()
        self.assertEqual(self.report["pending_count"], 1)

    def test_confirmed_receipt_removes_only_received_pending(self):
        old = state(pending={OTHER: "removed"})
        self.fetcher.fetch.side_effect = lambda url: (
            response("gone", status=404) if url == OTHER else self.fetch(url)
        )
        store, submit = self.execute(old)
        self.assertEqual(store.saved["pending"], {})
        self.assertEqual(submit.call_args.args[0], [PUBLIC, OTHER])
        self.assertEqual(self.report["receipt"], "received-not-indexing-proof")

    def test_202_and_rejections_keep_pending_for_retry(self):
        for status in (202, 400, 403, 422, 429, 503, 302):
            store, submit = self.execute(state(), status=status)
            self.assertEqual(store.saved["pending"], {PUBLIC: "updated"})
            self.assertFalse(self.report["passed"])
            self.assertEqual(store.saved["last_sent_at"], int(NOW.timestamp()))

    def test_source_outage_does_not_send_a_false_deletion(self):
        self.inventory = {OTHER: None}
        self.fetcher.fetch.side_effect = lambda url: (
            self.fetch(url)
            if url in (OTHER, notices.KEY_URL)
            else response("temporary outage", status=503)
        )
        store, submit = self.execute(state())
        self.assertEqual(submit.call_args.args[0], [OTHER])
        self.assertEqual(store.saved["pending"], {PUBLIC: "removed"})
        self.assertEqual(self.report["withheld_count"], 1)

    def test_indexability_failure_withholds_new_page_and_preserves_it(self):
        self.fetcher.fetch.side_effect = lambda url: (
            self.fetch(url)
            if url == notices.KEY_URL
            else response('<meta name="robots" content="noindex">')
        )
        store, submit = self.execute(state())
        submit.assert_not_called()
        self.assertEqual(store.saved["pending"], {PUBLIC: "updated"})

    def test_failed_pending_save_prevents_any_external_notice(self):
        store = MemoryStore(state())
        with (
            patch.object(notices, "snapshot", return_value=self.inventory),
            patch.object(notices, "submit") as submit,
            patch.object(
                store, "save", side_effect=health.HealthFailure("save failed")
            ),
            patch.dict(notices.os.environ, TRUSTED),
        ):
            with self.assertRaises(health.HealthFailure):
                notices.run(
                    store,
                    self.fetcher,
                    now=NOW,
                    apply=True,
                    initialize=False,
                    report=self.report,
                )
            submit.assert_not_called()

    def test_ownership_key_mismatch_stops_before_state_writes(self):
        self.fetcher.fetch.return_value = response("wrong key", "text/plain")
        self.fetcher.fetch.side_effect = None
        store = MemoryStore(state())
        with (
            patch.object(notices, "snapshot", return_value=self.inventory),
            patch.dict(notices.os.environ, TRUSTED),
            patch.object(notices, "submit") as submit,
        ):
            with self.assertRaises(health.HealthFailure):
                notices.run(
                    store,
                    self.fetcher,
                    now=NOW,
                    apply=True,
                    initialize=False,
                    report=self.report,
                )
        self.assertEqual(store.writes, [])
        submit.assert_not_called()

    def test_minimum_spacing_defers_without_dropping_pending(self):
        store, submit = self.execute(state(sent=int(NOW.timestamp()) - 100))
        submit.assert_not_called()
        self.assertEqual(store.saved["pending"], {PUBLIC: "updated"})
        self.assertEqual(self.report["receipt"], "deferred-for-minimum-spacing")

    def test_untrusted_branch_prevents_key_read_state_writes_or_notice(self):
        store = MemoryStore(state())
        with (
            patch.object(notices, "snapshot", return_value=self.inventory),
            patch.dict(
                notices.os.environ, {**TRUSTED, "GITHUB_REF": "refs/heads/untrusted"}
            ),
            patch.object(notices, "submit") as submit,
        ):
            with self.assertRaises(health.HealthFailure):
                notices.run(
                    store,
                    self.fetcher,
                    now=NOW,
                    apply=True,
                    initialize=False,
                    report=self.report,
                )
        self.assertEqual(store.writes, [])
        self.fetcher.fetch.assert_not_called()
        submit.assert_not_called()

    def test_batch_bound_keeps_remainder_and_never_sends_inventory(self):
        self.inventory = {
            PUBLIC: OLDER,
            **{f"{health.ORIGIN}/bills/new-{i}": None for i in range(105)},
        }
        store, submit = self.execute(state())
        self.assertEqual(len(submit.call_args.args[0]), notices.MAX_NOTICES)
        self.assertEqual(len(store.saved["pending"]), 5)
        self.assertNotIn(PUBLIC, submit.call_args.args[0])


class SubmissionAndStateStoreTest(TestCase):
    def test_fixed_endpoint_post_no_auth_and_protocol_payload(self):
        opener = Mock()
        opener.open.return_value = Stream(code=200)
        self.assertEqual(notices.submit([PUBLIC], opener=opener), 200)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, notices.ENDPOINT)
        self.assertEqual(request.method, "POST")
        self.assertIsNone(request.get_header("Authorization"))
        self.assertEqual(json.loads(request.data)["urlList"], [PUBLIC])
        self.assertEqual(json.loads(request.data)["keyLocation"], notices.KEY_URL)

    def test_transport_retry_refuses_redirect_and_does_not_echo_private_response(self):
        for status in (302, 429, 403):
            opener = Mock()
            opener.open.side_effect = HTTPError(
                notices.ENDPOINT, status, "private response", Message(), BytesIO()
            )
            self.assertEqual(notices.submit([PUBLIC], opener=opener), status)
            self.assertEqual(opener.open.call_count, 1)
        opener = Mock()
        opener.open.side_effect = [URLError("private error"), Stream(code=202)]
        with patch.object(notices.time, "sleep"):
            self.assertEqual(notices.submit([PUBLIC], opener=opener), 202)
        self.assertEqual(opener.open.call_count, 2)

    def test_unsafe_url_and_large_batches_never_reach_endpoint(self):
        for urls in ([health.ORIGIN + "/confirm"], [PUBLIC] * 101, []):
            opener = Mock()
            with self.assertRaises(health.HealthFailure):
                notices.submit(urls, opener=opener)
            opener.open.assert_not_called()

    def test_state_updates_compare_blob_sha_and_never_write_main(self):
        store = notices.GitHubState("fake-test-token")
        store.file_sha = "a" * 40
        with patch.object(
            store, "api", return_value={"content": {"sha": "b" * 40}}
        ) as api:
            store.save(state())
        payload = api.call_args.kwargs["data"]
        self.assertEqual(api.call_args.args[0], "contents/state.json")
        self.assertEqual(api.call_count, 1)
        self.assertEqual(payload["branch"], "codex/indexnow-state")
        self.assertEqual(payload["sha"], "a" * 40)
        self.assertEqual(store.file_sha, "b" * 40)
        self.assertEqual(json.loads(base64.b64decode(payload["content"])), state())

    def test_initial_state_is_orphan_with_deployments_disabled_no_force(self):
        store = notices.GitHubState("fake-test-token")
        with patch.object(
            store,
            "api",
            side_effect=[{"sha": "a" * 40}, {"sha": "b" * 40}, {}, {"sha": "c" * 40}],
        ) as api:
            store.save(state())
        tree_payload = api.call_args_list[0].kwargs["data"]
        files = {item["path"]: item["content"] for item in tree_payload["tree"]}
        self.assertEqual(set(files), {"state.json", "vercel.json"})
        self.assertEqual(json.loads(files["state.json"]), state())
        self.assertEqual(
            json.loads(files["vercel.json"]), {"git": {"deploymentEnabled": False}}
        )
        self.assertEqual(api.call_args_list[1].kwargs["data"]["parents"], [])
        self.assertEqual(
            api.call_args_list[2].kwargs["data"]["ref"],
            "refs/heads/codex/indexnow-state",
        )
        self.assertNotIn("force", api.call_args_list[2].kwargs["data"])

    def test_read_uses_immutable_blob_instead_of_response_provided_url(self):
        store = notices.GitHubState()
        encoded = base64.b64encode(json.dumps(state()).encode()).decode()
        with patch.object(
            store,
            "api",
            side_effect=[
                {"ref": "refs/heads/codex/indexnow-state"},
                {"sha": "d" * 40, "size": 40, "type": "file"},
                {
                    "encoding": "base64",
                    "content": base64.b64encode(
                        b'{"git":{"deploymentEnabled":false}}'
                    ).decode(),
                },
                {
                    "sha": "a" * 40,
                    "size": 1000,
                    "type": "file",
                    "download_url": "http://127.0.0.1/",
                },
                {"encoding": "base64", "content": encoded},
            ],
        ) as api:
            self.assertEqual(store.read(), state())
        self.assertEqual(
            api.call_args_list[1].args[0],
            "contents/vercel.json?ref=codex%2Findexnow-state",
        )
        self.assertEqual(api.call_args_list[2].args[0], "git/blobs/" + "d" * 40)
        self.assertEqual(api.call_args_list[4].args[0], "git/blobs/" + "a" * 40)

    def test_existing_state_missing_or_changed_deployment_exclusion_fails_closed(self):
        for config in (
            {},
            {"git": {"deploymentEnabled": True}},
            {"git": {"deploymentEnabled": 0}},
            {"git": {"deploymentEnabled": False}, "extra": True},
            "not json",
        ):
            store = notices.GitHubState("fake-test-token")
            content = config if isinstance(config, str) else json.dumps(config)
            with patch.object(
                store,
                "api",
                side_effect=[
                    {"ref": "refs/heads/codex/indexnow-state"},
                    {"sha": "d" * 40, "size": 40, "type": "file"},
                    {
                        "encoding": "base64",
                        "content": base64.b64encode(content.encode()).decode(),
                    },
                ],
            ) as api:
                with self.assertRaises(health.HealthFailure):
                    store.read()
                self.assertEqual(api.call_count, 3)
                self.assertIsNone(store.file_sha)
        store = notices.GitHubState("fake-test-token")
        with patch.object(
            store,
            "api",
            side_effect=[
                {"ref": "refs/heads/codex/indexnow-state"},
                health.HealthFailure("not found"),
            ],
        ) as api:
            with self.assertRaises(health.HealthFailure):
                store.read()
            self.assertEqual(api.call_count, 2)

    def test_deployment_exclusion_api_is_read_only_on_fixed_branch(self):
        store = notices.GitHubState("fake-test-token")
        for path, method in (
            ("contents/vercel.json", "GET"),
            ("contents/vercel.json?ref=main", "GET"),
            ("contents/vercel.json?ref=codex%2Findexnow-state", "PUT"),
        ):
            with patch.object(store.opener, "open") as opener:
                with self.assertRaises(health.HealthFailure):
                    store.api(path, method=method)
                opener.assert_not_called()

    def test_failed_compare_and_swap_preserves_old_hash(self):
        store = notices.GitHubState("fake-test-token")
        store.file_sha = "a" * 40
        with patch.object(store, "api", side_effect=health.HealthFailure("conflict")):
            with self.assertRaises(health.HealthFailure):
                store.save(state())
        self.assertEqual(store.file_sha, "a" * 40)

    def test_api_policy_disallows_main_arbitrary_host_and_branch(self):
        store = notices.GitHubState("fake-test-token")
        for path in (
            "contents/main.py",
            "git/ref/heads/main",
            "git/refs/heads/main",
            "https://example.invalid/",
            "contents/state.json?ref=untrusted",
        ):
            with patch.object(store.opener, "open") as opener:
                with self.assertRaises(health.HealthFailure):
                    store.api(path)
                opener.assert_not_called()

    def test_public_key_file_matches_protocol_and_workflow_stays_trusted(self):
        root = Path(__file__).resolve().parents[2]
        self.assertEqual(
            (root / f"apps/frontend/public/{notices.KEY}.txt").read_text().strip(),
            notices.KEY,
        )
        text = (root / ".github/workflows/public-change-notices.yml").read_text()
        self.assertNotIn("pull_request:", text)
        self.assertNotIn("pull_request_target:", text)
        self.assertNotIn("secrets.", text)
        self.assertIn("ref: main", text)
        self.assertIn("persist-credentials: false", text)
        self.assertIn("head_repository.full_name == github.repository", text)
        self.assertIn('test "$GITHUB_REF" = refs/heads/main', text)
        self.assertIn("cancel-in-progress: false", text)
        self.assertIn("if: always()", text)
        self.assertIn("default: false", text)
        self.assertIn("github.token", text)

    def test_cli_failure_always_writes_fixed_evidence(self):
        with (
            TemporaryDirectory() as directory,
            patch.object(notices, "run", side_effect=ValueError("private data")),
            patch("builtins.print"),
        ):
            output = Path(directory) / "result.json"
            self.assertEqual(notices.main(["--output", str(output)]), 1)
            data = json.loads(output.read_text())
            self.assertFalse(data["passed"])
            self.assertNotIn("private data", output.read_text())


class FairRetryAndCorruptionTest(ExecutionSetup, TestCase):
    def test_first_100_unavailable_pages_cannot_starve_101st_healthy_page(self):
        urls = [f"{health.ORIGIN}/bills/new-{i:03}" for i in range(101)]
        self.inventory = {PUBLIC: OLDER, **{url: None for url in urls}}
        self.fetcher.fetch.side_effect = lambda url: (
            self.fetch(url)
            if url in (notices.KEY_URL, urls[-1])
            else response("source unavailable", "text/plain", 503)
        )
        store, submit = self.execute(state())
        submit.assert_not_called()
        self.assertEqual(len(store.saved["pending"]), 101)
        self.assertEqual(store.saved["selection_cursor"], urls[99])
        self.report = {"passed": False}
        second, submit = self.execute(store.saved)
        self.assertEqual(submit.call_args.args[0], [urls[-1]])
        self.assertEqual(len(second.saved["pending"]), 100)
        self.assertNotIn(urls[-1], second.saved["pending"])

    def test_budget_stop_does_not_skip_unexamined_pages_in_next_rotation(self):
        urls = [f"{health.ORIGIN}/bills/new-{i:03}" for i in range(101)]
        self.inventory = {PUBLIC: OLDER, **{url: None for url in urls}}
        examined = []

        def bounded_fetch(url):
            if url == notices.KEY_URL:
                return self.fetch(url)
            examined.append(url)
            if len(examined) > 2:
                raise health.HealthFailure("time budget exhausted")
            return response("unavailable", "text/plain", 503)

        self.fetcher.fetch.side_effect = bounded_fetch
        first, _ = self.execute(state())
        self.assertEqual(first.saved["selection_cursor"], urls[1])
        self.fetcher.fetch.side_effect = self.fetch
        second, submit = self.execute(first.saved)
        self.assertEqual(submit.call_args.args[0][0], urls[2])
        self.assertEqual(len(second.saved["pending"]), 1)

    def test_alias_duplicates_in_observed_or_pending_state_fail_closed(self):
        for raw in (
            state(
                {
                    health.ORIGIN + "/bills/abc": None,
                    health.ORIGIN + "/bills/a%62c": None,
                }
            ),
            state(
                {health.ORIGIN + "/bills/abc": None},
                {health.ORIGIN + "/bills/a%62c": "removed"},
            ),
        ):
            with self.assertRaisesRegex(health.HealthFailure, "semantically duplicate"):
                notices.validate_state(raw, NOW)

    def test_empty_present_lastmod_and_cross_child_semantic_duplicates_fail(self):
        fetcher = Mock()
        first = xml([health.ORIGIN + "/bills/abc"])
        first.body = first.body.replace(b"</loc>", b"</loc><lastmod/>")
        fetcher.fetch.side_effect = [xml(health.SITEMAPS, index=True), first]
        with self.assertRaisesRegex(health.HealthFailure, "empty"):
            notices.snapshot(fetcher, NOW)
        fetcher.fetch.side_effect = [
            xml(health.SITEMAPS, index=True),
            xml([health.ORIGIN + "/bills/abc"]),
            xml([health.ORIGIN + "/bills/a%62c"]),
        ]
        with self.assertRaisesRegex(health.HealthFailure, "more than 1 sitemap"):
            notices.snapshot(fetcher, NOW)

    def test_http_client_error_is_retried_once(self):
        from http.client import RemoteDisconnected

        opener = Mock()
        opener.open.side_effect = [
            RemoteDisconnected("private response"),
            Stream(code=200),
        ]
        with patch.object(notices.time, "sleep"):
            self.assertEqual(notices.submit([PUBLIC], opener=opener), 200)
        self.assertEqual(opener.open.call_count, 2)


class RateLimitTest(ExecutionSetup, TestCase):
    def test_retry_wait_starts_after_public_checks_and_state_save(self):
        store = MemoryStore(state())

        def limited_submit(urls, **kwargs):
            kwargs["record"]["retry_after_at"] = notices.retry_after_at(
                "3600", kwargs["now"]
            )
            return 429

        with (
            patch.object(notices, "snapshot", return_value=self.inventory),
            patch.object(notices, "submit", side_effect=limited_submit),
            patch.object(notices.time, "monotonic", side_effect=[0, 120, 125]),
            patch.dict(notices.os.environ, TRUSTED),
        ):
            notices.run(
                store,
                self.fetcher,
                now=NOW,
                apply=True,
                initialize=False,
                report=self.report,
            )
        self.assertEqual(store.saved["last_sent_at"], int(NOW.timestamp()) + 120)
        self.assertEqual(store.saved["next_send_at"], int(NOW.timestamp()) + 125 + 3600)

    def test_retry_wait_starts_at_endpoint_receipt(self):
        headers = Message()
        headers["Retry-After"] = "3600"
        opener = Mock()
        opener.open.side_effect = HTTPError(
            notices.ENDPOINT, 429, "private response", headers, BytesIO()
        )
        record = {}
        with patch.object(notices.time, "monotonic", side_effect=[0, 90]):
            self.assertEqual(
                notices.submit([PUBLIC], opener=opener, now=NOW, record=record), 429
            )
        self.assertEqual(record["retry_after_at"], int(NOW.timestamp()) + 90 + 3600)

    def test_delta_and_http_date_retries_are_bounded_and_at_least_5_minutes(self):
        from email.utils import format_datetime
        from datetime import timedelta

        for raw, seconds in (
            ("3600", 3600),
            (" \t3600 \t", 3600),
            (format_datetime(NOW + timedelta(hours=2), usegmt=True), 7200),
            ("0", 300),
            ("-1", 300),
            ("unknown", 300),
            ("9" * 200, 300),
        ):
            self.assertEqual(
                notices.retry_after_at(raw, NOW), int(NOW.timestamp()) + seconds
            )

    def test_429_persists_retry_after_and_stops_releases_before_expiry(self):
        from datetime import timedelta

        store = MemoryStore(state())

        def limited_submit(urls, **kwargs):
            kwargs["record"]["retry_after_at"] = int(NOW.timestamp()) + 3600
            return 429

        with (
            patch.object(notices, "snapshot", return_value=self.inventory),
            patch.object(notices, "submit", side_effect=limited_submit),
            patch.dict(notices.os.environ, TRUSTED),
        ):
            notices.run(
                store,
                self.fetcher,
                now=NOW,
                apply=True,
                initialize=False,
                report=self.report,
            )
        self.assertEqual(store.saved["next_send_at"], int(NOW.timestamp()) + 3600)
        self.assertEqual(store.saved["pending"], {PUBLIC: "updated"})
        with (
            patch.object(notices, "snapshot", return_value=self.inventory),
            patch.object(notices, "submit", return_value=200) as submit,
            patch.dict(notices.os.environ, TRUSTED),
        ):
            self.report = {"passed": False}
            notices.run(
                store,
                self.fetcher,
                now=NOW + timedelta(minutes=10),
                apply=True,
                initialize=False,
                report=self.report,
            )
            submit.assert_not_called()
            self.assertEqual(self.report["receipt"], "deferred-for-server-retry-after")
            notices.run(
                store,
                self.fetcher,
                now=NOW + timedelta(hours=1),
                apply=True,
                initialize=False,
                report=self.report,
            )
            submit.assert_called_once()
        self.assertEqual(store.saved["pending"], {})
        self.assertIsNone(store.saved["next_send_at"])

    def test_actual_429_header_is_parsed_without_retaining_raw_header(self):
        opener = Mock()
        headers = Message()
        headers["Retry-After"] = "3600"
        opener.open.side_effect = HTTPError(
            notices.ENDPOINT, 429, "private message", headers, BytesIO()
        )
        record = {}
        self.assertEqual(
            notices.submit([PUBLIC], opener=opener, now=NOW, record=record), 429
        )
        self.assertEqual(record, {"retry_after_at": int(NOW.timestamp()) + 3600})
        self.assertEqual(opener.open.call_count, 1)
