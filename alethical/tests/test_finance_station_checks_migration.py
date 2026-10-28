"""Finance's station-file check tables migrate both ways, lock out browser roles,
and refuse every change but 1 withdrawal, and every delete."""

import os
from pathlib import Path
import subprocess
import sys

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import DBAPIError

from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0076_finance_station_checks"
TABLES = ("finance_tv_fact", "finance_tv_connection")


def test_finance_station_checks_upgrade_downgrade_upgrade():
    with ScratchDatabase(_local_base_url(), "finance_station_checks") as scratch:
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
            _append_only(engine)
            migrate("downgrade", "0075_finance_access_list")
            names = set(inspect(engine).get_table_names())
            assert not names & set(TABLES)
            with engine.connect() as db:
                assert not db.scalar(
                    text(
                        "SELECT count(*) FROM pg_proc"
                        " WHERE proname = 'finance_tv_check_append_only'"
                    )
                )
            migrate("upgrade", HEAD)
            with engine.connect() as db:
                assert (
                    db.scalar(text("SELECT version_num FROM alembic_version")) == HEAD
                )
        finally:
            engine.dispose()


def _append_only(engine):
    """1 withdrawal is the only change a check accepts, and none is deleted."""
    digest = "a" * 64
    with engine.begin() as db:
        db.execute(
            text("""INSERT INTO fcc_source_body (content_hash, object_key, byte_size,
            compressed_hash, compressed_byte_size, compression)
            VALUES (:h, 'fcc/x', 1, :h, 1, 'gzip')"""),
            {"h": digest},
        )
        db.execute(
            text("""INSERT INTO fcc_document (facility_id, file_id, content_hash,
            call_sign, folder_id, folder_path, name, url)
            VALUES ('28010', 'file-1', :h, 'KSTP-TV', 'folder-1', 'political-files',
            'Original', 'https://files.fcc.gov/x.pdf')"""),
            {"h": digest},
        )
        db.execute(
            text("""INSERT INTO finance_tv_fact (id, facility_id, file_id, content_hash,
            page, quote, evidence, made_by_alethical_team, field, value)
            VALUES (gen_random_uuid(), '28010', 'file-1', :h, 1, 'Agency: Example.',
            'Read', false, 'agency_name', 'Example')"""),
            {"h": digest},
        )

    def refused(statement):
        with pytest.raises(DBAPIError, match="Finance station-file check"):
            with engine.begin() as db:
                db.execute(text(statement))

    refused("UPDATE finance_tv_fact SET value = 'Changed'")
    refused("UPDATE finance_tv_fact SET withdrawn_at = now()")
    refused("DELETE FROM finance_tv_fact")
    with engine.begin() as db:
        db.execute(
            text(
                "UPDATE finance_tv_fact"
                " SET withdrawn_at = now(), withdrawal_reason = 'Wrong page'"
            )
        )
    refused("UPDATE finance_tv_fact SET withdrawal_reason = 'Another reason'")
    refused("DELETE FROM finance_tv_fact")
    with engine.begin() as db:
        assert db.scalar(text("SELECT withdrawal_reason FROM finance_tv_fact")) == (
            "Wrong page"
        )
