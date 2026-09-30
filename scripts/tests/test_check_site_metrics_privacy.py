"""No live requests: prove the scheduled privacy check accepts only denial."""

from email.message import Message
from unittest import TestCase
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from scripts import check_site_metrics_privacy as privacy


class PrivateAccessCheckTest(TestCase):
    def test_covers_every_feed_and_previously_cached_query_variants(self):
        self.assertEqual(len(privacy.READ_URLS), 11)
        self.assertIn(
            ("google-default", "https://www.alethical.com/api/traffic-google"),
            privacy.READ_URLS,
        )
        self.assertIn(
            ("actions-v1", "https://api.alethical.com/api/v1/site-metrics?version=1"),
            privacy.READ_URLS,
        )

    def test_only_explicit_denial_passes(self):
        for status, expected in ((401, True), (403, True), (404, False), (503, False)):
            with self.subTest(status=status):
                error = HTTPError(
                    "https://example.invalid", status, "", Message(), None
                )
                with patch.object(privacy, "build_opener") as opener:
                    opener.return_value.open.side_effect = error
                    self.assertEqual(
                        privacy.denies_unsigned_read("https://example.invalid"),
                        expected,
                    )

    def test_open_response_or_network_failure_is_not_private(self):
        with patch.object(privacy, "build_opener") as opener:
            opener.return_value.open.return_value.__enter__.return_value = object()
            self.assertFalse(privacy.denies_unsigned_read("https://example.invalid"))
            opener.return_value.open.side_effect = URLError("offline")
            self.assertFalse(privacy.denies_unsigned_read("https://example.invalid"))
