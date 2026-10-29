"""The additive Finance sign-in codes migration can roll back on an isolated local DB."""

import os
from pathlib import Path
import subprocess
import sys

from sqlalchemy import inspect, text
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]


def test_finance_sign_in_codes_upgrade_downgrade_upgrade():
    with ScratchDatabase(_local_base_url(), "finance_sign_in_codes") as scratch:
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

            migrate("upgrade", "0077_finance_sign_in_codes")
            columns = {
                column["name"]: column
                for column in inspect(engine).get_columns("finance_sign_in_code")
            }
            assert not columns["code_hash"]["nullable"]
            challenges = {
                column["name"]: column
                for column in inspect(engine).get_columns("finance_sign_in_challenge")
            }
            assert not challenges["challenge_hash"]["nullable"]
            assert not challenges["code_id"]["nullable"]
            assert [
                constraint["column_names"]
                for constraint in inspect(engine).get_unique_constraints(
                    "finance_sign_in_challenge"
                )
            ] == [["challenge_hash"]]
            [code_link] = inspect(engine).get_foreign_keys("finance_sign_in_challenge")
            assert code_link["referred_table"] == "finance_sign_in_code"
            assert code_link["options"]["ondelete"] == "CASCADE"
            assert not columns["expires_at"]["nullable"]
            assert columns["used_at"]["nullable"]
            with engine.connect() as db:
                assert db.scalars(
                    text(
                        "SELECT relrowsecurity FROM pg_class WHERE relname IN"
                        " ('finance_sign_in_code', 'finance_sign_in_challenge')"
                    )
                ).all() == [True, True]
            migrate("downgrade", "0076_identity_confirmations")
            tables = inspect(engine).get_table_names()
            assert "finance_sign_in_code" not in tables
            assert "finance_sign_in_challenge" not in tables
            migrate("upgrade", "0077_finance_sign_in_codes")
            with engine.connect() as db:
                assert (
                    db.scalar(text("SELECT version_num FROM alembic_version"))
                    == "0077_finance_sign_in_codes"
                )
        finally:
            engine.dispose()
