"""Keep the test suite off any database that is not on this machine (#716).

Roughly 50 call sites in these tests commit(), and the ingestion write paths
delete before they insert. Nothing used to check where those writes landed:
`get_session_factory()` resolves whatever DATABASE_URL is set to, so sessions
that ran pytest with it pointed at Supabase committed a fixture bill straight
into production, where it stayed publicly reachable.

conftest.pytest_configure calls assert_local_database() before any fixture opens
a connection. It lives in its own module rather than inside conftest.py so the
tests in test_db_session.py can import and exercise it -- a broken guard is
otherwise invisible, since the suite stays green either way and the only symptom
is the next fixture row landing in production.
"""

from __future__ import annotations

import pytest
from sqlalchemy.engine import make_url

LOCAL_DATABASE_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def assert_local_database(url: str, target: str | None = None) -> None:
    """Raise pytest.UsageError unless `url` is local and `target` is not remote."""
    if target not in (None, "", "local"):
        raise pytest.UsageError(
            f"Refusing to run the test suite with ALETHICAL_DATABASE_TARGET={target!r}. "
            "The suite writes and deletes rows, so it may only run against a local "
            "database. Unset it (or set it to 'local') and re-run."
        )
    host = make_url(url).host
    if host not in LOCAL_DATABASE_HOSTS:
        raise pytest.UsageError(
            f"Refusing to run the test suite against database host {host!r}. "
            "The suite writes and deletes rows, so it may only run against a local "
            f"database ({', '.join(sorted(LOCAL_DATABASE_HOSTS))}). Point DATABASE_URL "
            "at the local Postgres (port 54329) and re-run."
        )
