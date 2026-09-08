"""Give each local pytest invocation its own verified, disposable server."""

from __future__ import annotations

import os
import signal
from contextlib import ExitStack
from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from alethical.db.session import get_engine, get_session_factory, local_database_url
from alethical.tests.local_database_guard import assert_local_database
from scripts.local_checks import CheckError, disposable_postgres


def configure_database(config: pytest.Config, root: Path) -> str:
    """Select a database before test modules import cached application engines.

    GitHub owns a fresh service per job. Everywhere else, including an upload
    snapshot setting CI=true, owns a new Docker server per pytest process.
    Environment flags are a CI execution contract, not proof of server ownership
    on a developer machine; generic CI or GITHUB_ACTIONS alone cannot opt out.
    """
    if get_engine.cache_info().currsize or get_session_factory.cache_info().currsize:
        # Clearing a cache cannot repair engine references another module already
        # holds. Refuse embedded/repeated pytest.main rather than leave those
        # connections pointing at a shared server or a removed previous server.
        raise pytest.UsageError(
            "Application database connections already exist in this Python process. "
            "Run tests in a fresh process with `uv run pytest`."
        )
    if os.environ.get("ALETHICAL_TEST_DATABASE_URL"):
        raise pytest.UsageError(
            "ALETHICAL_TEST_DATABASE_URL is not supported: tests own a temporary "
            "database. Unset the override and run pytest again."
        )
    source = local_database_url()
    assert_local_database(source, os.environ.get("ALETHICAL_DATABASE_TARGET"))
    github_job = (
        os.environ.get("GITHUB_ACTIONS") == "true"
        and os.environ.get("GITHUB_RUN_ID", "").isdigit()
        and Path(os.environ.get("GITHUB_WORKSPACE", "")).resolve() == root.resolve()
        and bool(os.environ.get("GITHUB_WORKSPACE"))
    )
    if github_job:
        url = make_url(source)
        if (
            url.drivername != "postgresql+psycopg"
            or url.host not in {"localhost", "127.0.0.1"}
            or url.port != 5432
            or url.database != "alethical"
            or url.query
        ):
            raise pytest.UsageError(
                "GitHub tests require their job's fresh local PostgreSQL service "
                "on port 5432, database alethical."
            )
        return source

    stack = ExitStack()
    config.add_cleanup(stack.close)
    # pytest unwinds configuration on KeyboardInterrupt, including fixture or
    # collection failure. Translate normal process termination into that path.
    # SIGKILL cannot run Python cleanup; never scan/delete other runs to recover.
    previous_handler = signal.getsignal(signal.SIGTERM)

    def interrupt(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupt)
    stack.callback(signal.signal, signal.SIGTERM, previous_handler)
    try:
        database_url = stack.enter_context(disposable_postgres(root))
    except CheckError as error:
        raise pytest.UsageError(str(error)) from error

    previous_url = os.environ.get("DATABASE_URL")

    def restore_environment():
        if previous_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_url

    stack.callback(restore_environment)
    os.environ["DATABASE_URL"] = database_url
    return database_url
