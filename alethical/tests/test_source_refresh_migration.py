"""Round-trip only this build's additive operational tables on owned Postgres."""

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from alethical.db.session import get_engine


def test_source_tables_upgrade_downgrade_upgrade(seed_database):
    engine = get_engine()
    config = Config("alembic.ini")
    # Migrations open their own connection. End each inspection transaction
    # before the next migration: concurrent indexes wait for older snapshots.
    # Measure from this build's own head, so a later migration's tables are
    # not mistaken for ones these revisions should have removed.
    command.downgrade(config, "0074_source_refresh")
    with engine.connect() as connection:
        before = set(inspect(connection).get_table_names())
    command.downgrade(config, "0072_campaign_payment_manifest")
    with engine.connect() as connection:
        assert set(inspect(connection).get_table_names()) == before - {
            "source_refresh_state",
            "source_refresh_attempt",
            "source_request_limits",
        }
        assert "file_manifest" in {
            column["name"] for column in inspect(connection).get_columns("cf_release")
        }
    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert "source_refresh_state" in inspect(connection).get_table_names()
        assert "source_request_limits" in inspect(connection).get_table_names()

        secured = connection.execute(
            text(
                "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('source_refresh_state','source_refresh_attempt','source_request_limits')"
            )
        ).all()
        assert len(secured) == 3 and all(row.relrowsecurity for row in secured)
