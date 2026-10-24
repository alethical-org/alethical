"""The additive payment evidence migration can roll back on an isolated local DB."""

import os
from pathlib import Path
import subprocess
import sys

from sqlalchemy import inspect, text
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]


def test_payment_evidence_upgrade_downgrade_upgrade():
    with ScratchDatabase(_local_base_url(), "payment_manifest") as scratch:
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

            migrate("upgrade", "0072_campaign_payment_manifest")
            columns = {
                column["name"]: column
                for column in inspect(engine).get_columns("cf_release")
            }
            assert not columns["file_manifest"]["nullable"]
            assert "{}" in columns["file_manifest"]["default"]
            for table in ("cf_stated_split", "cf_stated_spending"):
                fields = {
                    column["name"]: column
                    for column in inspect(engine).get_columns(table)
                }
                assert fields["reader_identity"]["nullable"]
            migrate("downgrade", "0071_private_search_measurements")
            assert "file_manifest" not in {
                column["name"] for column in inspect(engine).get_columns("cf_release")
            }
            assert "reader_identity" not in {
                column["name"]
                for column in inspect(engine).get_columns("cf_stated_split")
            }
            migrate("upgrade", "0072_campaign_payment_manifest")
            with engine.connect() as db:
                assert (
                    db.scalar(text("SELECT version_num FROM alembic_version"))
                    == "0072_campaign_payment_manifest"
                )
        finally:
            engine.dispose()
