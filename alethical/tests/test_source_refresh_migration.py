"""Round-trip source-refresh tables in a new database without later revisions."""

import os
from pathlib import Path
import subprocess
import sys

from sqlalchemy import inspect, text

from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]


def test_source_tables_upgrade_downgrade_upgrade():
    # A worker's seeded database may hold committed originals used by sibling
    # tests. Its later migrations correctly refuse a destructive rollback.
    with ScratchDatabase(_local_base_url(), "source_refresh") as scratch:
        engine = scratch.engine()
        try:

            def migrate(direction, revision):
                result = subprocess.run(
                    [
                        sys.executable,
                        "-m",
                        "alembic",
                        "-c",
                        "alembic.ini",
                        direction,
                        revision,
                    ],
                    cwd=ROOT,
                    env={
                        **os.environ,
                        "DATABASE_URL": scratch.url.render_as_string(
                            hide_password=False
                        ),
                        "ALETHICAL_DATABASE_TARGET": "local",
                    },
                    capture_output=True,
                    text=True,
                    check=False,
                )
                assert result.returncode == 0, result.stdout + result.stderr

            # Only these additive revisions are under test. Later migrations,
            # including source-reading decisions, keep their own round trips.
            migrate("upgrade", "0074_source_refresh")
            with engine.connect() as connection:
                before = set(inspect(connection).get_table_names())
            migrate("downgrade", "0072_campaign_payment_manifest")
            with engine.connect() as connection:
                assert set(inspect(connection).get_table_names()) == before - {
                    "source_refresh_state",
                    "source_refresh_attempt",
                    "source_request_limits",
                }
                assert "file_manifest" in {
                    column["name"]
                    for column in inspect(connection).get_columns("cf_release")
                }
            migrate("upgrade", "0074_source_refresh")
            with engine.connect() as connection:
                assert "source_refresh_state" in inspect(connection).get_table_names()
                assert "source_request_limits" in inspect(connection).get_table_names()
                secured = connection.execute(
                    text(
                        "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN "
                        "('source_refresh_state','source_refresh_attempt','source_request_limits')"
                    )
                ).all()
                assert len(secured) == 3 and all(row.relrowsecurity for row in secured)
                assert (
                    connection.scalar(text("SELECT version_num FROM alembic_version"))
                    == "0074_source_refresh"
                )
        finally:
            engine.dispose()
