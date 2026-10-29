"""The additive identity confirmation migration can roll back on an isolated local DB."""

import os
from pathlib import Path
import subprocess
import sys

from sqlalchemy import inspect, text
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
TABLES = (
    "identity_entity",
    "identity_confirmation",
    "identity_confirmed_record",
    "identity_event",
)


def test_identity_confirmations_upgrade_downgrade_upgrade():
    with ScratchDatabase(_local_base_url(), "identity_confirmations") as scratch:
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

            migrate("upgrade", "0076_identity_confirmations")
            with engine.connect() as db:
                secured = db.execute(
                    text(
                        "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN"
                        f" ({','.join(repr(table) for table in TABLES)})"
                    )
                ).all()
            assert len(secured) == 4 and all(row.relrowsecurity for row in secured)
            migrate("downgrade", "0075_finance_access_list")
            assert not set(TABLES) & set(inspect(engine).get_table_names())
            migrate("upgrade", "0076_identity_confirmations")
            with engine.connect() as db:
                assert (
                    db.scalar(text("SELECT version_num FROM alembic_version"))
                    == "0076_identity_confirmations"
                )
        finally:
            engine.dispose()
