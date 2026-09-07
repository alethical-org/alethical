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


def test_site_metric_history_upgrade_downgrade_upgrade():
    source_url = get_database_url()
    assert_local_database(source_url, os.environ.get("ALETHICAL_DATABASE_TARGET"))
    name = f"alethical_metric_migration_{uuid4().hex[:12]}"
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
        with isolated.begin() as db:
            assert db.scalar(text("SELECT count(*) FROM site_metric_coverage")) == 0
            assert db.scalar(text("SELECT count(*) FROM site_metric_hourly_count")) == 0
            db.execute(
                text(
                    "INSERT INTO site_metric_event(id,event_kind) VALUES (:old,'bill_search_with_results'),(:new,'money_search_with_results')"
                ),
                {"old": uuid4(), "new": uuid4()},
            )
        migrate("downgrade", "0051_tracked_committee")
        with isolated.connect() as db:
            assert "site_metric_hourly_count" not in inspect(db).get_table_names()
            assert db.scalar(text("SELECT count(*) FROM site_metric_event")) == 1
        migrate("upgrade", "head")
        with isolated.connect() as db:
            assert db.scalar(text("SELECT count(*) FROM site_metric_coverage")) == 0
            assert db.scalar(text("SELECT count(*) FROM site_metric_hourly_count")) == 0
            assert db.scalar(text("SELECT count(*) FROM site_metric_event")) == 1
    finally:
        isolated.dispose()
        with admin.connect() as db:
            db.execute(text(f'DROP DATABASE "{name}"'))
        admin.dispose()
