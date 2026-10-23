"""Independent retention never relies on provider access and prints no private errors."""

from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import TestCase
from unittest.mock import MagicMock, patch

from scripts import prune_search_measurements as cleanup


class RetentionCommandTests(TestCase):
    def test_sweep_is_read_back_from_a_separate_transaction(self):
        writer, reader = MagicMock(), MagicMock()
        writer_db = writer.__enter__.return_value
        reader_db = reader.__enter__.return_value
        saved = {
            "status": "current",
            "lastSuccessAt": "2099-01-01T00:00:00+00:00",
            "expiredRawAwaitingDeletion": 0,
            "expiredSummariesAwaitingDeletion": 0,
        }
        with (
            patch.object(cleanup, "Session", side_effect=[writer, reader]) as sessions,
            patch.object(cleanup, "sweep_retention") as sweep,
            patch.object(cleanup, "retention_status", return_value=saved) as status,
        ):
            result = cleanup.run_sweep(object())
        self.assertEqual(result, saved)
        self.assertEqual(sessions.call_count, 2)
        sweep.assert_called_once()
        self.assertIs(sweep.call_args.args[0], writer_db)
        status.assert_called_once()
        self.assertIs(status.call_args.args[0], reader_db)
        writer_db.begin.assert_called_once()

    def test_stale_or_unverified_sweep_fails(self):
        for state, raw, summaries in (
            ("missing", 0, 0),
            ("stale", 0, 0),
            ("current", 1, 0),
            ("current", 0, 1),
        ):
            saved = {
                "status": state,
                "lastSuccessAt": "2099-01-01T00:00:00+00:00",
                "expiredRawAwaitingDeletion": raw,
                "expiredSummariesAwaitingDeletion": summaries,
            }
            with (
                patch.object(cleanup, "Session", return_value=MagicMock()),
                patch.object(cleanup, "sweep_retention"),
                patch.object(cleanup, "retention_status", return_value=saved),
                self.assertRaises(RuntimeError),
            ):
                cleanup.run_sweep(object())

    def test_failure_does_not_print_credentials_or_provider_data(self):
        output = StringIO()
        engine = MagicMock()
        with (
            patch("sys.argv", ["cleanup", "--target", "production"]),
            patch.object(
                cleanup,
                "database_url_for_target",
                return_value="PRIVATE DATABASE CREDENTIAL",
            ) as resolve,
            patch.object(cleanup, "create_engine", return_value=engine),
            patch.object(
                cleanup,
                "run_sweep",
                side_effect=RuntimeError("PRIVATE DATABASE AND QUERY DETAILS"),
            ),
            redirect_stdout(output),
        ):
            result = cleanup.main()
        self.assertEqual(result, 1)
        self.assertNotIn("PRIVATE", output.getvalue())
        resolve.assert_called_once_with("production")
        engine.dispose.assert_called_once()

    def test_daily_job_runs_trusted_main_without_provider_credentials(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / ".github/workflows/private-search-retention.yml").read_text()
        self.assertIn('cron: "23 8 * * *"', workflow)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)
        self.assertIn("ref: main", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertIn("--target production", workflow)
        self.assertNotIn("pull_request", workflow)
        self.assertNotIn("CRON_SECRET", workflow)
        self.assertNotIn("GOOGLE_SEARCH", workflow)
        self.assertNotIn("BING_WEBMASTER", workflow)
        self.assertNotIn("upload-artifact", workflow)
