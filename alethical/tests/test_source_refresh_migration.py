"""Round-trip only this build's additive operational tables on owned Postgres."""

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from alethical.db.session import get_engine


def test_source_tables_upgrade_downgrade_upgrade(seed_database):
    engine = get_engine()
    config = Config("alembic.ini")
    with engine.connect() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "0066_candidate_lookup")
        assert "source_refresh_state" not in inspect(connection).get_table_names()
        command.upgrade(config, "head")
        assert "source_refresh_state" in inspect(connection).get_table_names()
        assert "source_request_limits" in inspect(connection).get_table_names()
