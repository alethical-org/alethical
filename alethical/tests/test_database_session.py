"""The real suite must bind imported application code to its selected database."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import make_url

from alethical.db.session import get_database_url, get_engine

# Collection happens before fixtures. This catches exporting the database too late.
COLLECTION_DATABASE_URL = get_database_url()


def test_application_imports_and_fixtures_use_the_same_test_server():
    assert COLLECTION_DATABASE_URL == get_database_url()
    url = make_url(COLLECTION_DATABASE_URL)
    assert get_engine().url == url
    assert url.host in {"localhost", "127.0.0.1"}
    assert url.database == "alethical"
    assert url.port != 54329
    with get_engine().connect() as connection:
        assert (
            connection.execute(text("SELECT current_database()")).scalar()
            == "alethical"
        )
