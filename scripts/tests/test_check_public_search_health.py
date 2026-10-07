"""Offline response examples and transport failures; no real network or records."""

from datetime import date
from email.message import Message
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlsplit
from urllib.robotparser import RobotFileParser

from scripts import check_public_search_health as health


def response(body, content_type="text/html", status=200, **headers):
    return health.Response(
        status, {"Content-Type": content_type, **headers}, body.encode()
    )


def xml(urls, *, index=False):
    name, entry = ("sitemapindex", "sitemap") if index else ("urlset", "url")
    from xml.sax.saxutils import escape

    body = (
        f'<{name} xmlns="{health.NAMESPACE}">'
        + "".join(f"<{entry}><loc>{escape(url)}</loc></{entry}>" for url in urls)
        + f"</{name}>"
    )
    return response(body, "application/xml")


def html(url, content="A short useful explanation", *, anchor="/money", extra=""):
    return response(
        f"<html><head><title>A useful subject | Alethical</title>"
        f'<link rel="canonical" href="{url}">{extra}</head>'
        f"<body><nav>Home and navigation</nav><main><h1>A subject</h1>"
        f'<p>{content}</p><a href="{anchor}">Open records</a></main></body></html>'
    )


def robots(lines=None):
    parsed = RobotFileParser()
    parsed.parse(
        lines or ["User-agent: *", "Allow: /", f"Sitemap: {health.ORIGIN}/sitemap.xml"]
    )
    return parsed


class AddressSafetyTest(TestCase):
    def test_canonical_public_urls_and_only_numbered_query_are_allowed(self):
        for path in (
            "/privacy",
            "/bills/94-2025-HF719",
            "/bills?page=2",
            "/blog/topics/campaign-finance?page=3",
        ):
            self.assertEqual(
                health.safe_url(health.ORIGIN + path), health.ORIGIN + path
            )

    def test_no_off_host_private_auth_or_unbounded_query_can_escape(self):
        bad = (
            "http://www.alethical.com/",
            "https://alethical.com/",
            "https://www.alethical.com:443/",
            "https://www.alethical.com@127.0.0.1/",
            "https://www.alethical.com.evil.invalid/",
            "https://127.0.0.1/",
            health.ORIGIN + "/confirm",
            health.ORIGIN + "/%61dmin/users",
            health.ORIGIN + "/%2561dmin/users",
            health.ORIGIN + "/candidates/id/manage",
            health.ORIGIN + "/bills?q=a",
            health.ORIGIN + "/bills?page=2&page=3",
            health.ORIGIN + "/bills?page=02",
            health.ORIGIN + "/bills?page=2#fragment",
            health.ORIGIN + "/bills?code=private",
            health.ORIGIN + "//admin",
            health.ORIGIN + "/bills/../confirm",
            health.ORIGIN + "/bills\\evil",
        )
        for url in bad:
            with self.subTest(url=url), self.assertRaises(health.HealthFailure):
                health.safe_url(url)

    def test_private_read_exception_is_only_two_fixed_credential_free_paths(self):
        for path in health.PRIVATE_CHECKS:
            self.assertEqual(
                health.safe_url(health.ORIGIN + path, private_check=True),
                health.ORIGIN + path,
            )
        for path in (
            "/confirm",
            "/auth/callback",
            "/admin/users",
            "/email-preferences?token=secret",
        ):
            with self.assertRaises(health.HealthFailure):
                health.safe_url(health.ORIGIN + path, private_check=True)


class SitemapTest(TestCase):
    def test_exact_seven_child_index_and_xml_urls(self):
        self.assertEqual(
            health.xml_urls(xml(health.SITEMAPS, index=True), index=True),
            list(health.SITEMAPS),
        )
        urls = [health.ORIGIN + "/bills?page=2", health.ORIGIN + "/privacy"]
        self.assertEqual(health.xml_urls(xml(urls), index=False), urls)

    def test_rejects_duplicates_missing_children_and_wrong_host(self):
        for payload, index in (
            (xml([health.SITEMAPS[0]] * 7, index=True), True),
            (xml(health.SITEMAPS[:-1], index=True), True),
            (xml([health.ORIGIN + "/privacy"] * 2), False),
            (xml(["https://api.alethical.com/private"]), False),
            (xml([health.ORIGIN + "/admin/users"]), False),
            (xml([]), False),
        ):
            with self.assertRaises(health.HealthFailure):
                health.xml_urls(payload, index=index)

    def test_rejects_malformed_xml_entities_wrong_root_and_double_location(self):
        bodies = (
            "<html>outage</html>",
            '<urlset xmlns="wrong"/>',
            "<urlset>",
            '<!DOCTYPE urlset [<!ENTITY leak "unsafe">]><urlset/>',
            f'<urlset xmlns="{health.NAMESPACE}"><url><loc>{health.ORIGIN}/privacy</loc><loc>{health.ORIGIN}/terms</loc></url></urlset>',
        )
        for body in bodies:
            with self.assertRaises(health.HealthFailure):
                health.xml_urls(response(body, "application/xml"), index=False)
        with self.assertRaises(health.HealthFailure):
            health.xml_urls(response("{}", "application/json"), index=False)


def seeded_html(base, key, payload):
    return html(
        base,
        extra='<script type="application/json" id="alethical-page-data">'
        + json.dumps([{"key": key, "payload": payload}])
        + "</script>",
    )


class PublicVariantTest(TestCase):
    today = date(2026, 10, 7)
    committee = health.ORIGIN + "/money/committees/example-100"

    def test_variants_are_separate_from_strict_sitemap_discovery(self):
        paths = (
            "/money/committees/example-100?year=2015",
            "/money/committees/example-100?tab=filings&year=2026",
            "/money/committees/example-100/payments?tab=spent&year=2025",
            "/money/committees/example-100/payments?tab=gave",
            "/legislators/a-member?tab=money&year=2025",
            "/money/races/house-1a?year=2025",
            "/bills/94-2025-HF2771?tab=text",
        )
        for path in paths:
            url = health.ORIGIN + path
            with self.subTest(path=path):
                self.assertEqual(health.safe_variant_url(url), url)
                with self.assertRaises(health.HealthFailure):
                    health.safe_url(url)
                with self.assertRaises(health.HealthFailure):
                    health.xml_urls(xml([url]), index=False)

    def test_variants_reject_credentials_unknown_duplicate_and_encoded_parameters(self):
        paths = (
            "/money/committees/example-100?year=2025&year=2024",
            "/money/committees/example-100?tab=filings&token=secret",
            "/money/committees/example-100?year=2025%26token%3Dsecret",
            "/money/committees/example-100?%79ear=2025",
            "/money/committees/example-100?year=2025#fragment",
            "/money/committees/example-100?year=02025",
            "/money/committees/example-100?year=garbage",
            "/money/committees/example-100?year=9999",
            "/money/committees/example-100?tab=unknown",
            "/money/committees/example-100/payments?tab=filings",
            "/money/committees/example-100/claim?year=2025",
            "/money/committees/%65xample-100?year=2025",
            "/money/committees/example-100?year=2025\n",
            "/money/races?year=2025",
            "/legislators/a-member?year=2025",
            "/bills/94-2025-HF2771?tab=text&year=2025",
            "/ask?q=synthetic-private-query",
        )
        for path in paths:
            with self.subTest(path=path), self.assertRaises(health.HealthFailure):
                health.safe_variant_url(health.ORIGIN + path)
        with self.assertRaises(health.HealthFailure):
            health.safe_variant_url("https://other.invalid" + paths[0])

    def test_year_validation_checks_exact_data_not_arbitrary_visible_years(self):
        url = self.committee + "?year=2025"
        key = ["committee-money", "100", 2025]
        good = seeded_html(self.committee, key, {"year": 2025})
        page = health.validate_page(
            url, good, robots(), mode="variant", today=self.today
        )
        self.assertEqual(page.variant_year_check, "payload")
        for payload in (
            {"year": 2024, "note": "2025"},
            {"note": "2025"},
        ):
            with self.assertRaises(health.HealthFailure):
                health.validate_page(
                    url,
                    seeded_html(self.committee, key, payload),
                    robots(),
                    mode="variant",
                    today=self.today,
                )
        with self.assertRaises(health.HealthFailure):
            health.validate_page(
                url,
                html(self.committee, "The year is 2025"),
                robots(),
                mode="variant",
                today=self.today,
            )
        with self.assertRaises(health.HealthFailure):
            health.validate_page(
                url,
                seeded_html(
                    self.committee, ["committee-money", "999", 2025], {"year": 2025}
                ),
                robots(),
                mode="variant",
                today=self.today,
            )

    def test_no_filing_still_answers_requested_year_without_inventing_figures(self):
        url = self.committee + "?year=2015"
        payload = {"year": 2015, "money_in": {"state": "not_reported"}}
        health.validate_page(
            url,
            seeded_html(self.committee, ["committee-money", "100", 2015], payload),
            robots(),
            mode="variant",
            today=self.today,
        )

    def test_default_year_and_app_malformed_year_fallback_are_explicit(self):
        for raw, expected in (
            (None, 2026),
            ("bad", 2026),
            ("2014", 2026),
            ("2027", 2026),
            ("2025", 2025),
            ("2025extra", 2025),
        ):
            self.assertEqual(health.campaign_money_year(raw, self.today), expected)
        url = self.committee + "?tab=gave"
        health.validate_page(
            url,
            seeded_html(
                self.committee, ["committee-money", "100", 2026], {"year": 2026}
            ),
            robots(),
            mode="variant",
            today=self.today,
        )

    def test_bill_variant_keeps_bare_canonical_and_all_public_guards(self):
        base = health.ORIGIN + "/bills/94-2025-HF2771"
        url = base + "?tab=text"
        health.validate_page(
            url, html(base), robots(), mode="variant", today=self.today
        )
        for example in (
            html(url),
            html(base, extra='<meta name="robots" content="noindex">'),
            html(base, "Loading…"),
            response("outage", status=503),
        ):
            with self.assertRaises(health.HealthFailure):
                health.validate_page(
                    url, example, robots(), mode="variant", today=self.today
                )

    def test_special_session_bill_text_is_a_supported_public_variant(self):
        base = health.ORIGIN + "/bills/94-2025s1-SF12"
        health.validate_page(
            base + "?tab=text", html(base), robots(), mode="variant", today=self.today
        )
        for suffix in ("s0", "s100", "special", "s1%2Fprivate"):
            with self.assertRaises(health.HealthFailure):
                health.safe_variant_url(
                    health.ORIGIN + f"/bills/94-2025{suffix}-SF12?tab=text"
                )

    def test_optional_legislator_seed_absence_is_not_claimed_as_year_proof(self):
        base = health.ORIGIN + "/legislators/a-member"
        url = base + "?tab=money&year=2025"
        page = health.validate_page(
            url, html(base), robots(), mode="variant", today=self.today
        )
        self.assertEqual(page.variant_year_check, "not-served")
        with self.assertRaises(health.HealthFailure):
            health.validate_page(
                url,
                seeded_html(
                    base,
                    ["legislator-campaign-money", "a-member", 2025],
                    {"year": 2024},
                ),
                robots(),
                mode="variant",
                today=self.today,
            )

    def test_payments_direction_key_and_race_year_are_checked(self):
        base = self.committee + "/payments"
        url = base + "?tab=spent&year=2025"
        good = seeded_html(
            base,
            ["committee-payments-list", "100", "made", 2025],
            {"state": "reported"},
        )
        page = health.validate_page(
            url, good, robots(), mode="variant", today=self.today
        )
        self.assertEqual(page.variant_year_check, "key-only")
        self.assertEqual(page.variant_direction_check, "key-only")
        with self.assertRaises(health.HealthFailure):
            health.validate_page(
                url,
                seeded_html(
                    base,
                    ["committee-payments-list", "100", "received", 2025],
                    {"state": "reported"},
                ),
                robots(),
                mode="variant",
                today=self.today,
            )
        race = health.ORIGIN + "/money/races/house-1a"
        health.validate_page(
            race + "?year=2025",
            seeded_html(race, ["campaign-finance-races", 2025, "all"], {"year": 2025}),
            robots(),
            mode="variant",
            today=self.today,
        )

    def test_unserved_payment_source_and_malformed_data_are_distinct(self):
        base = self.committee + "/payments"
        url = base + "?tab=spent&year=2025"
        page = health.validate_page(
            url,
            html(base, "We could not load the payment records"),
            robots(),
            mode="variant",
            today=self.today,
        )
        self.assertEqual(page.variant_year_check, "not-served")
        self.assertEqual(page.variant_direction_check, "not-served")
        for extra in (
            '<script type="application/json" id="alethical-page-data">private malformed text</script>',
            '<script type="application/json" id="alethical-page-data">{}</script>',
            '<script type="application/json" id="alethical-page-data">[]</script>' * 2,
        ):
            with self.assertRaises(health.HealthFailure) as failure:
                health.validate_page(
                    url,
                    html(base, extra=extra),
                    robots(),
                    mode="variant",
                    today=self.today,
                )
            self.assertNotIn("private malformed text", str(failure.exception))

    @patch.object(health.time, "sleep")
    def test_variant_transport_uses_same_retry_and_global_budgets(self, sleep):
        url = self.committee + "?year=2025"
        fetcher = health.Fetcher()
        with patch.object(
            fetcher.opener, "open", side_effect=[Stream(code=503), Stream(b"ok")]
        ):
            self.assertEqual(fetcher.fetch(url, variant=True).body, b"ok")
            self.assertEqual(fetcher.requests, 2)
        for field, value in (("requests", health.MAX_REQUESTS), ("deadline", 0)):
            fetcher = health.Fetcher()
            setattr(fetcher, field, value)
            with patch.object(fetcher.opener, "open") as opener:
                with self.assertRaises(health.HealthFailure):
                    fetcher.fetch(url, variant=True)
                opener.assert_not_called()
        fetcher = health.Fetcher()
        with (
            patch.object(health, "MAX_BYTES", 10),
            patch.object(fetcher.opener, "open", return_value=Stream(b"x" * 11)),
        ):
            with self.assertRaisesRegex(health.HealthFailure, "size limit"):
                fetcher.fetch(url, variant=True)

    def test_variant_transport_still_refuses_redirects_and_unsafe_urls(self):
        fetcher = health.Fetcher()
        with patch.object(
            fetcher.opener, "open", return_value=Stream(code=302)
        ) as opener:
            with self.assertRaisesRegex(health.HealthFailure, "redirect refused"):
                fetcher.fetch(self.committee + "?year=2025", variant=True)
            self.assertEqual(opener.call_count, 1)
        with patch.object(fetcher.opener, "open") as opener:
            with self.assertRaises(health.HealthFailure):
                fetcher.fetch(self.committee + "?token=synthetic-secret", variant=True)
            opener.assert_not_called()


class PageTest(TestCase):
    def test_short_useful_page_does_not_fail_a_word_count(self):
        url = health.ORIGIN + "/privacy"
        health.validate_page(
            url, html(url, "We protect your data", anchor=""), robots()
        )

    def test_navigation_scripts_title_and_hidden_copy_are_not_main_content(self):
        url = health.ORIGIN + "/privacy"
        bodies = (
            "",
            "Loading…",
            "<script>Long script with many words</script>",
            "<span hidden>Readable-looking private text</span>",
            '<span style="display: none">Hidden main text</span>',
            '<span aria-hidden="true">Hidden text</span>',
        )
        for body in bodies:
            with (
                self.subTest(body=body),
                self.assertRaisesRegex(health.HealthFailure, "meaningful"),
            ):
                health.validate_page(url, html(url, body), robots())

    def test_correct_title_canonical_robots_and_status_are_required(self):
        url = health.ORIGIN + "/privacy"
        examples = (
            html(url, extra='<meta name="robots" content="noindex">'),
            html(url, extra='<meta name="googlebot" content="none">'),
            html(url, extra='<link rel="canonical" href="https://www.alethical.com/">'),
            html(health.ORIGIN + "/"),
            html(url, extra='<base href="https://example.invalid/">'),
            response("temporary outage", "text/plain", 503),
            response(
                "<title>Alethical</title><main><h1>Privacy</h1><p>Your data</p></main>"
            ),
        )
        for payload in examples:
            with self.assertRaises(health.HealthFailure):
                health.validate_page(url, payload, robots())
        with self.assertRaises(health.HealthFailure):
            health.validate_page(
                url, html(url), robots(["User-agent: Googlebot", "Disallow: /"])
            )

    def test_directories_need_real_record_anchors_not_onclick_or_navigation(self):
        url = health.ORIGIN + "/bills"
        for anchor in ("", "#", "/money", "javascript:open()", "/bills?q=private"):
            with self.assertRaises(health.HealthFailure):
                health.validate_page(url, html(url, anchor=anchor), robots())
        health.validate_page(url, html(url, anchor="/bills/94-2025-HF719"), robots())

    def test_missing_record_and_private_checks_require_safe_exclusion(self):
        url = health.ORIGIN + health.MISSING_PATHS[0]
        missing = response(
            '<title>Not found | Alethical</title><meta name="robots" content="noindex">',
            status=404,
        )
        health.validate_page(url, missing, robots(), mode="missing")
        with self.assertRaises(health.HealthFailure):
            health.validate_page(
                url, response("missing", status=200), robots(), mode="missing"
            )
        private = response(
            '<meta name="robots" content="noindex,nofollow">',
            **{"Cache-Control": "private, no-store"},
        )
        health.validate_page(
            health.ORIGIN + "/email-preferences", private, robots(), mode="private"
        )
        private.headers["Cache-Control"] = "public, max-age=60"
        with self.assertRaises(health.HealthFailure):
            health.validate_page(
                health.ORIGIN + "/email-preferences", private, robots(), mode="private"
            )

    def test_release_stamp_only_retains_full_hash(self):
        url = health.ORIGIN + "/privacy"
        for raw, expected in (("a" * 40, "a" * 40), ("private text", None)):
            page = health.validate_page(
                url,
                html(
                    url, extra=f'<meta name="alethical-release-commit" content="{raw}">'
                ),
                robots(),
            )
            self.assertEqual(page.release, expected)


class Stream(BytesIO):
    def __init__(self, body=b"response", code=200):
        super().__init__(body)
        self.code = code
        self.headers = Message()
        self.headers["Content-Type"] = "text/html"


class TransportTest(TestCase):
    @patch.object(health.time, "sleep")
    def test_retries_network_and_server_failure_once(self, sleep):
        for first in (URLError("secret should not be printed"), Stream(code=503)):
            fetcher = health.Fetcher()
            with patch.object(
                fetcher.opener, "open", side_effect=[first, Stream(b"ok")]
            ) as opener:
                self.assertEqual(fetcher.fetch(health.ORIGIN + "/privacy").body, b"ok")
                self.assertEqual(opener.call_count, 2)
                self.assertEqual(fetcher.requests, 2)

    def test_redirect_is_refused_without_requesting_destination(self):
        fetcher = health.Fetcher()
        headers = Message()
        headers["Location"] = "http://127.0.0.1/confirm?private=secret"
        redirect = HTTPError(health.ORIGIN, 302, "", headers, BytesIO())
        with patch.object(fetcher.opener, "open", side_effect=redirect) as opener:
            with self.assertRaisesRegex(health.HealthFailure, "redirect refused"):
                fetcher.fetch(health.ORIGIN + "/privacy")
            self.assertEqual(opener.call_count, 1)
        self.assertIsNone(
            health.NoRedirect().redirect_request(
                None, None, 302, "", headers, headers["Location"]
            )
        )

    def test_time_request_and_size_bounds_stop(self):
        for field, value in (("requests", health.MAX_REQUESTS), ("deadline", 0)):
            fetcher = health.Fetcher()
            setattr(fetcher, field, value)
            with patch.object(fetcher.opener, "open") as opener:
                with self.assertRaises(health.HealthFailure):
                    fetcher.fetch(health.ORIGIN + "/privacy")
                opener.assert_not_called()
        fetcher = health.Fetcher()
        with (
            patch.object(health, "MAX_BYTES", 10),
            patch.object(fetcher.opener, "open", return_value=Stream(b"x" * 11)),
        ):
            with self.assertRaisesRegex(health.HealthFailure, "size limit"):
                fetcher.fetch(health.ORIGIN + "/privacy")

    def test_invalid_discovered_address_never_reaches_network(self):
        fetcher = health.Fetcher()
        with patch.object(fetcher.opener, "open") as opener:
            with self.assertRaises(health.HealthFailure):
                fetcher.fetch("https://example.invalid/secret")
            opener.assert_not_called()


class SamplingAndEvidenceTest(TestCase):
    def test_variant_sample_is_fixed_plus_bounded_rotating_known_records(self):
        sections = {
            "committees": [
                health.ORIGIN + f"/money/committees/filer-{i}" for i in range(100, 200)
            ],
            "bills": [health.ORIGIN + f"/bills/94-2025-HF{i}" for i in range(1, 100)],
            "legislators": [
                health.ORIGIN + f"/legislators/member-{i}" for i in range(1, 100)
            ],
            "races": [
                health.ORIGIN + f"/money/races/house-{i}a" for i in range(1, 100)
            ],
        }
        first = health.select_variants(sections, date(2026, 10, 7), broader=False)
        self.assertEqual(
            first, health.select_variants(sections, date(2026, 10, 8), broader=False)
        )
        self.assertNotEqual(
            first, health.select_variants(sections, date(2026, 10, 14), broader=False)
        )
        self.assertEqual(len(first), 9)
        self.assertTrue(
            all(url.endswith("?year=2026") for url in first if "/money/races/" in url)
        )
        self.assertLessEqual(
            len(health.select_variants(sections, date(2026, 10, 7), broader=True)), 14
        )
        for path in health.VARIANT_REGRESSIONS:
            self.assertIn(health.ORIGIN + path, first)
        for url in first:
            health.safe_variant_url(url)
            self.assertNotIn("/ask", url)
        with self.assertRaises(health.HealthFailure):
            health.select_variants(
                {"committees": [health.ORIGIN + "/confirm?token=synthetic"]},
                date(2026, 10, 7),
                broader=False,
            )

    def test_samples_are_bounded_stable_and_rotate_without_fetching_every_record(self):
        sections = {
            name: [f"{health.ORIGIN}/bills/example-{i}" for i in range(100)]
            for name in health.SECTIONS
            if name != "pages"
        }
        first = health.select_samples(sections, date(2026, 10, 7), broader=False)
        self.assertEqual(
            first, health.select_samples(sections, date(2026, 10, 8), broader=False)
        )
        self.assertNotEqual(
            first, health.select_samples(sections, date(2026, 10, 14), broader=False)
        )
        self.assertLessEqual(len(first), 22)
        for path in health.FIXED_PATHS + health.CANDIDATES:
            self.assertIn(health.ORIGIN + path, first)

    def test_always_writes_compact_failure_json_without_exception_text(self):
        with TemporaryDirectory() as directory:
            output = Path(directory) / "result.json"
            with (
                patch.object(
                    health,
                    "run_checks",
                    side_effect=RuntimeError("private remote response"),
                ),
                patch("builtins.print"),
            ):
                self.assertEqual(health.main(["--output", str(output)]), 1)
            data = json.loads(output.read_text())
            self.assertFalse(data["passed"])
            self.assertEqual(data["failure"], "unexpected checker failure")
            self.assertNotIn("private remote response", output.read_text())

    def test_bad_hash_still_writes_failure_and_does_not_start_requests(self):
        with (
            TemporaryDirectory() as directory,
            patch.object(health, "Fetcher") as fetcher,
            patch("builtins.print"),
        ):
            output = Path(directory) / "result.json"
            self.assertEqual(
                health.main(["--output", str(output), "--checked-commit", "private"]), 1
            )
            fetcher.assert_not_called()
            self.assertEqual(
                json.loads(output.read_text())["failure"],
                "checked commit is not a full hash",
            )

    def test_partial_evidence_survives_unexpected_work_failure(self):
        report = {}
        fetcher = health.Fetcher()
        with patch.object(
            fetcher,
            "fetch",
            side_effect=[health.HealthFailure("offline"), RuntimeError("private")],
        ):
            with self.assertRaises(RuntimeError):
                health.run_checks(
                    fetcher,
                    today=date(2026, 10, 7),
                    broader=False,
                    checked_commit=None,
                    report=report,
                )
        self.assertEqual(report["checks"][0]["failure"], "offline")
        self.assertFalse(report["passed"])


class WholeRunTest(TestCase):
    def setUp(self):
        self.sections = {
            "pages": [health.ORIGIN + path for path in health.FIXED_PATHS],
            "bills": [health.ORIGIN + "/bills/94-2025-HF719"],
            "legislators": [health.ORIGIN + "/legislators/a-real-member"],
            "committees": [health.ORIGIN + "/money/committees/a-real-committee-100"],
            "races": [health.ORIGIN + "/money/races/house-1a"],
            "lobbying-principals": [
                health.ORIGIN + "/money/lobbying/principals/a-real-principal-100"
            ],
            "lobbying-lobbyists": [
                health.ORIGIN + "/money/lobbying/lobbyists/a-real-lobbyist-100"
            ],
        }
        self.fetcher = health.Fetcher()

    def fetch(self, url, **kwargs):
        self.fetcher.requests += 1
        if kwargs.get("variant"):
            base = url.split("?", 1)[0]
            path = urlsplit(base).path
            params = dict(parse_qsl(urlsplit(url).query))
            year = health.campaign_money_year(params.get("year"), date(2026, 10, 7))
            if path.startswith("/money/committees/"):
                registration = path.split("/")[3].rsplit("-", 1)[1]
                key = ["committee-money", registration, year]
            elif path.startswith("/money/races/"):
                key = ["campaign-finance-races", year, "all"]
            elif path.startswith("/legislators/"):
                key = ["legislator-campaign-money", path.split("/")[2], year]
            else:
                return html(base)
            return seeded_html(base, key, {"year": year})
        if url == health.ORIGIN + "/robots.txt":
            return response(
                f"User-agent: *\nAllow: /\nSitemap: {health.ORIGIN}/sitemap.xml",
                "text/plain",
            )
        if url == health.ORIGIN + "/sitemap.xml":
            return xml(health.SITEMAPS, index=True)
        for name, sitemap in zip(health.SECTIONS, health.SITEMAPS, strict=True):
            if url == sitemap:
                return xml(self.sections[name])
        if url.removeprefix(health.ORIGIN) in health.MISSING_PATHS:
            return response('<meta name="robots" content="noindex">', status=404)
        if url.removeprefix(health.ORIGIN) in health.PRIVATE_CHECKS:
            return response(
                '<meta name="robots" content="noindex,nofollow">',
                **{"Cache-Control": "private, no-store"},
            )
        anchors = {
            "/bills": "/bills/94-2025-HF719",
            "/legislators": "/legislators/a-real-member",
        }
        return html(
            url,
            anchor=anchors.get(url.removeprefix(health.ORIGIN), "/bills"),
            extra='<meta name="alethical-release-commit" content="' + "a" * 40 + '">',
        )

    def run_fixture(self):
        with patch.object(self.fetcher, "fetch", side_effect=self.fetch):
            return health.run_checks(
                self.fetcher,
                today=date(2026, 10, 7),
                broader=False,
                checked_commit="b" * 40,
            )

    def test_complete_healthy_run_records_actual_served_sha_without_claiming_match(
        self,
    ):
        report = self.run_fixture()
        self.assertTrue(report["passed"], report["checks"])
        self.assertEqual(report["served_commit"], "a" * 40)
        self.assertEqual(report["release_match"], "not-compared")
        self.assertLess(report["request_count"], health.MAX_REQUESTS)
        variant_checks = [
            row for row in report["checks"] if row["name"].startswith("variant:")
        ]
        self.assertTrue(variant_checks)
        self.assertTrue(all("year_check" in row for row in variant_checks))

    def test_variant_outage_is_recorded_without_loosening_discovery(self):
        original_fetch = self.fetch

        def failing_fetch(url, **kwargs):
            if kwargs.get("variant") and url.endswith("?tab=text"):
                return response("outage", status=503)
            return original_fetch(url, **kwargs)

        with patch.object(self.fetcher, "fetch", side_effect=failing_fetch):
            report = health.run_checks(
                self.fetcher,
                today=date(2026, 10, 7),
                broader=False,
                checked_commit=None,
            )
        failures = [row for row in report["checks"] if not row["passed"]]
        self.assertFalse(report["passed"])
        self.assertTrue(all(row["name"].startswith("variant:") for row in failures))
        self.assertTrue(all(row["status"] == 503 for row in failures))

    def test_variant_selection_failure_does_not_skip_private_or_missing_checks(self):
        with patch.object(
            health,
            "select_variants",
            side_effect=health.HealthFailure(
                "variant record or parameters are not allowed"
            ),
        ):
            report = self.run_fixture()
        failures = [row["name"] for row in report["checks"] if not row["passed"]]
        self.assertEqual(failures, ["variant-selection"])
        completed = {row["name"] for row in report["checks"] if row["passed"]}
        for path in health.MISSING_PATHS:
            self.assertIn("missing:" + path, completed)
        for path in health.PRIVATE_CHECKS:
            self.assertIn("private:" + path, completed)

    def test_duplicate_across_sitemaps_and_missing_fixed_route_fail(self):
        self.sections["pages"].append(self.sections["bills"][0])
        self.sections["pages"].remove(health.ORIGIN + "/privacy")
        report = self.run_fixture()
        failures = {
            row["name"]: row.get("failure")
            for row in report["checks"]
            if not row["passed"]
        }
        self.assertIn("sitemap:bills", failures)
        self.assertIn("discovery:/privacy", failures)

    def test_missing_candidate_lookup_is_a_discovery_failure(self):
        self.sections["pages"].remove(health.ORIGIN + "/candidates")
        report = self.run_fixture()
        self.assertIn(
            "discovery:/candidates",
            [row["name"] for row in report["checks"] if not row["passed"]],
        )

    def test_wrong_family_in_child_fails_before_sample(self):
        self.sections["bills"] = self.sections["legislators"]
        report = self.run_fixture()
        self.assertIn(
            "sitemap:bills",
            [row["name"] for row in report["checks"] if not row["passed"]],
        )

    def test_useful_article_links_are_meaningful_main_body(self):
        url = health.ORIGIN + "/blog/guides"
        payload = response(
            f'<title>Guides | Alethical</title><link rel="canonical" href="{url}"><main><h1>Guides</h1><ol><li><a href="/blog/guides/a-guide">How the records work</a></li></ol></main>'
        )
        health.validate_page(url, payload, robots())

    def test_semantic_duplicate_encoded_urls_fail(self):
        with self.assertRaisesRegex(health.HealthFailure, "duplicate"):
            health.xml_urls(
                xml([health.ORIGIN + "/bills/abc", health.ORIGIN + "/bills/a%62c"]),
                index=False,
            )


class WorkflowSafetyTest(TestCase):
    def test_only_trusted_main_runs_no_secrets_and_evidence_survives_failure(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / ".github/workflows/public-search-health.yml").read_text()
        self.assertNotIn("pull_request:", workflow)
        self.assertNotIn("pull_request_target:", workflow)
        self.assertNotIn("secrets.", workflow)
        self.assertIn('test "$GITHUB_REF" = refs/heads/main', workflow)
        self.assertIn("ref: main", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertIn("head_repository.full_name == github.repository", workflow)
        self.assertIn("contents: read", workflow)
        self.assertIn("if: always()", workflow)
        self.assertIn("timeout-minutes: 8", workflow)
        self.assertNotIn("issues: write", workflow)
