"""The migration round trip runs only in a new machine-local database."""

import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

from alethical.db.session import get_database_url
from alethical.tests.local_database_guard import assert_local_database


def test_lobbying_registrations_upgrade_downgrade_upgrade():
    source_url = get_database_url()
    assert_local_database(source_url, os.environ.get("ALETHICAL_DATABASE_TARGET"))
    name = f"alethical_lobby_migration_{uuid4().hex[:12]}"
    url = make_url(source_url).set(database=name)
    admin = create_engine(
        make_url(source_url).set(database="postgres"), isolation_level="AUTOCOMMIT"
    )
    isolated = create_engine(url)
    root = Path(__file__).resolve().parents[2]

    def migrate(*args):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", *args],
            cwd=root,
            env={
                **os.environ,
                "DATABASE_URL": url.render_as_string(hide_password=False),
                "ALETHICAL_DATABASE_TARGET": "local",
            },
            text=True,
            capture_output=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr

    with admin.connect() as db:
        db.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        migrate("upgrade", "head")
        tables = {
            "lobbyist_snapshot",
            "lobbyist_row",
            "lobbyist_association",
            "lobbying_release",
            "lobbying_current_release",
        }
        with isolated.connect() as db:
            assert tables <= set(inspect(db).get_table_names())
            assert any(
                key["constrained_columns"] == ["previous_release_id"]
                and key["referred_table"] == "lobbying_release"
                for key in inspect(db).get_foreign_keys("lobbying_release")
            )
            columns = {c["name"] for c in inspect(db).get_columns("lobbyist_row")}
            assert columns == {
                "snapshot_id",
                "registration_number",
                "name",
                "formatted_name",
                "first_name",
                "middle_initial",
                "last_name",
            }
        migrate("downgrade", "0053_cf_refund_summary")
        with isolated.connect() as db:
            assert not tables & set(inspect(db).get_table_names())
            assert "lobbying_expenditure_snapshot" in inspect(db).get_table_names()
        migrate("upgrade", "head")
        with isolated.connect() as db:
            assert tables <= set(inspect(db).get_table_names())
    finally:
        isolated.dispose()
        with admin.connect() as db:
            db.execute(text(f'DROP DATABASE "{name}"'))
        admin.dispose()
