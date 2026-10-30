"""Finance-only copy withdrawals migrate both ways and lock out browser roles."""

import os
from pathlib import Path
import subprocess
import sys

from sqlalchemy import inspect, text

from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0079_finance_copy_withdrawal"
TABLES = ("finance_tv_copy_withdrawal",)


def test_finance_copy_withdrawal_upgrade_downgrade_upgrade():
    with ScratchDatabase(_local_base_url(), "finance_copy_withdrawal") as scratch:
        engine = scratch.engine()
        try:

            def migrate(direction, revision):
                result = subprocess.run(
                    [sys.executable, "-m", "alembic", "-c", "alembic.ini"]
                    + [direction, revision],
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

            migrate("upgrade", HEAD)
            assert set(TABLES) <= set(inspect(engine).get_table_names())
            with engine.connect() as db:
                for table in TABLES:
                    assert db.scalar(
                        text("SELECT relrowsecurity FROM pg_class WHERE relname = :t"),
                        {"t": table},
                    )
                    assert not db.scalar(
                        text("SELECT has_table_privilege('public', :t, 'SELECT')"),
                        {"t": table},
                    )
            migrate("downgrade", "0078_finance_station_checks")
            names = set(inspect(engine).get_table_names())
            assert not names & set(TABLES)
            with engine.connect() as db:
                assert not db.scalar(
                    text(
                        "SELECT count(*) FROM pg_proc"
                        " WHERE proname = 'finance_tv_copy_withdrawal_immutable'"
                    )
                )
            migrate("upgrade", HEAD)
            with engine.connect() as db:
                assert (
                    db.scalar(text("SELECT version_num FROM alembic_version")) == HEAD
                )
        finally:
            engine.dispose()
