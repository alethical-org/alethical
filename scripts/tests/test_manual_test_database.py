"""Database lifecycle tests with every server mocked; safe without PostgreSQL."""

from __future__ import annotations

import os
import signal
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

from alethical.tests import database_session


class ManualTestDatabaseTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[2]
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.config = Mock()
        self.cleanups = []
        self.config.add_cleanup.side_effect = self.cleanups.append
        self.addCleanup(self.cleanup)
        self.events = []

        @contextmanager
        def server(root):
            self.events.append(("start", root))
            try:
                yield "postgresql+psycopg://alethical:alethical@127.0.0.1:49152/alethical"
            finally:
                self.events.append(("stop", root))

        self.server = patch.object(database_session, "disposable_postgres", server)
        self.server.start()
        self.addCleanup(self.server.stop)

    def cleanup(self):
        while self.cleanups:
            self.cleanups.pop()()

    def test_manual_run_ignores_shared_local_address_and_restores_environment(self):
        shared = "postgresql+psycopg://alethical:alethical@localhost:54329/alethical"
        os.environ["DATABASE_URL"] = shared
        result = database_session.configure_database(self.config, self.root)
        self.assertIn(":49152/", result)
        self.assertEqual(os.environ["DATABASE_URL"], result)
        self.cleanup()
        self.assertEqual(os.environ["DATABASE_URL"], shared)
        self.assertEqual(self.events, [("start", self.root), ("stop", self.root)])

    def test_missing_environment_is_restored_after_cleanup(self):
        database_session.configure_database(self.config, self.root)
        self.cleanup()
        self.assertNotIn("DATABASE_URL", os.environ)

    def test_generic_ci_flag_cannot_select_shared_database(self):
        os.environ["CI"] = "true"
        database_session.configure_database(self.config, self.root)
        self.assertEqual(self.events, [("start", self.root)])

    def test_github_flag_alone_cannot_select_shared_database(self):
        os.environ["GITHUB_ACTIONS"] = "true"
        database_session.configure_database(self.config, self.root)
        self.assertEqual(self.events, [("start", self.root)])

    def github_environment(self):
        os.environ.update(
            GITHUB_ACTIONS="true",
            GITHUB_RUN_ID="123456",
            GITHUB_WORKSPACE=str(self.root),
            DATABASE_URL="postgresql+psycopg://alethical:alethical@localhost:5432/alethical",
        )

    def test_github_job_uses_its_fresh_service_without_starting_another(self):
        self.github_environment()
        result = database_session.configure_database(self.config, self.root)
        self.assertIn(":5432/", result)
        self.assertEqual(self.events, [])

    def test_github_job_rejects_wrong_service_address(self):
        self.github_environment()
        os.environ["DATABASE_URL"] = (
            "postgresql://alethical:alethical@localhost:54329/alethical"
        )
        with self.assertRaises(pytest.UsageError):
            database_session.configure_database(self.config, self.root)
        self.assertEqual(self.events, [])

    def test_github_job_rejects_connection_query_overrides(self):
        self.github_environment()
        os.environ["DATABASE_URL"] += "?host=example.invalid&port=6543"
        with self.assertRaises(pytest.UsageError):
            database_session.configure_database(self.config, self.root)
        self.assertEqual(self.events, [])

    def test_explicit_database_override_is_rejected_before_startup(self):
        os.environ["ALETHICAL_TEST_DATABASE_URL"] = "postgresql://localhost/shared"
        with self.assertRaises(pytest.UsageError):
            database_session.configure_database(self.config, self.root)
        self.assertEqual(self.events, [])

    def test_remote_target_is_rejected_before_startup(self):
        os.environ["ALETHICAL_DATABASE_TARGET"] = "production"
        with self.assertRaises(pytest.UsageError):
            database_session.configure_database(self.config, self.root)
        self.assertEqual(self.events, [])

    def test_remote_database_is_rejected_before_startup(self):
        os.environ["DATABASE_URL"] = "postgresql://example.invalid/private"
        with self.assertRaises(pytest.UsageError):
            database_session.configure_database(self.config, self.root)
        self.assertEqual(self.events, [])

    def test_start_failure_never_exports_a_database_or_falls_back(self):
        with patch.object(
            database_session,
            "disposable_postgres",
            side_effect=database_session.CheckError("unavailable"),
        ):
            with self.assertRaisesRegex(pytest.UsageError, "unavailable"):
                database_session.configure_database(self.config, self.root)
        self.assertNotIn("DATABASE_URL", os.environ)

    def test_termination_raises_interrupt_and_cleanup_restores_handler(self):
        original = signal.getsignal(signal.SIGTERM)
        database_session.configure_database(self.config, self.root)
        handler = signal.getsignal(signal.SIGTERM)
        with self.assertRaises(KeyboardInterrupt):
            handler(signal.SIGTERM, None)
        self.cleanup()
        self.assertEqual(signal.getsignal(signal.SIGTERM), original)
        self.assertEqual(self.events[-1], ("stop", self.root))

    def test_each_configuration_starts_a_separate_server(self):
        database_session.configure_database(self.config, self.root)
        database_session.configure_database(self.config, self.root)
        self.assertEqual(self.events.count(("start", self.root)), 2)
        self.cleanup()
        self.assertEqual(self.events.count(("stop", self.root)), 2)

    def test_preexisting_application_engine_stops_before_starting_a_server(self):
        from alethical.db.session import get_engine, get_session_factory

        # Creating an Engine is lazy: no database/network connection is opened.
        engine = get_engine()
        try:
            with self.assertRaisesRegex(pytest.UsageError, "fresh process"):
                database_session.configure_database(self.config, self.root)
            self.assertEqual(self.events, [])
            self.assertNotIn("DATABASE_URL", os.environ)
        finally:
            engine.dispose()
            get_engine.cache_clear()
            get_session_factory.cache_clear()

    def test_preexisting_session_factory_alone_stops_before_startup(self):
        from alethical.db.session import get_engine, get_session_factory

        factory = get_session_factory()
        engine = factory.kw["bind"]
        get_engine.cache_clear()
        try:
            with self.assertRaisesRegex(pytest.UsageError, "fresh process"):
                database_session.configure_database(self.config, self.root)
            self.assertEqual(self.events, [])
        finally:
            engine.dispose()
            get_engine.cache_clear()
            get_session_factory.cache_clear()


if __name__ == "__main__":
    unittest.main()
