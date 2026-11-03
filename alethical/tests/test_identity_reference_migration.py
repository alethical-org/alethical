"""Existing identities get references oldest first, and the migration reverses cleanly."""

import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import inspect, text

from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0082_identity_source_reference"
PARENT = "0081_cf_graph_money_summary"


def test_identity_references_backfill_in_creation_order_and_reverse():
    with ScratchDatabase(_local_base_url(), "identity_reference") as scratch:
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

            migrate("upgrade", PARENT)
            start = datetime(2026, 11, 1, tzinfo=UTC)
            # Inserted out of creation order on purpose.
            made = [
                ("later person", "person", start + timedelta(hours=2)),
                ("first organization", "organization", start + timedelta(hours=1)),
                ("first person", "person", start),
                # 2 parts of 1 split share created_at; their first event decides.
                ("split part b", "person", start + timedelta(hours=3)),
                ("split part a", "person", start + timedelta(hours=3)),
            ]
            first_event = {
                "split part a": start + timedelta(hours=3, seconds=1),
                "split part b": start + timedelta(hours=3, seconds=2),
            }
            ids = {}
            with engine.begin() as db:
                for name, kind, created in made:
                    # Part b's id sorts first, so ordering by id alone would be wrong.
                    ids[name] = {
                        "split part b": UUID(int=1),
                        "split part a": UUID(int=2),
                    }.get(name, uuid4())
                    db.execute(
                        text(
                            "INSERT INTO identity_entity (id, kind, name, made_by_alethical_team, created_at)"
                            " VALUES (:id, :kind, :name, false, :created)"
                        ),
                        {
                            "id": ids[name],
                            "kind": kind,
                            "name": name,
                            "created": created,
                        },
                    )
                    if name in first_event:
                        db.execute(
                            text(
                                "INSERT INTO identity_event (id, entity_id, action,"
                                " detail, made_by_alethical_team, created_at)"
                                " VALUES (:id, :entity, 'created', '{}', false, :at)"
                            ),
                            {
                                "id": uuid4(),
                                "entity": ids[name],
                                "at": first_event[name],
                            },
                        )

            def references():
                with engine.connect() as db:
                    return dict(
                        db.execute(
                            text("SELECT name, reference FROM identity_entity")
                        ).all()
                    )

            expected = {
                "first person": "PER-0001",
                "later person": "PER-0002",
                "split part a": "PER-0003",
                "split part b": "PER-0004",
                "first organization": "ORG-0001",
            }
            migrate("upgrade", HEAD)
            assert references() == expected
            with engine.connect() as db:
                assert (
                    db.scalar(text("SELECT nextval('identity_person_reference_seq')"))
                    == 5
                )
                db.rollback()
            columns = {
                c["name"] for c in inspect(engine).get_columns("identity_confirmation")
            }
            assert {"source", "withdrawal_source"} <= columns

            migrate("downgrade", PARENT)
            inspector = inspect(engine)
            assert "reference" not in {
                c["name"] for c in inspector.get_columns("identity_entity")
            }
            assert not {"source", "withdrawal_source"} & {
                c["name"] for c in inspector.get_columns("identity_confirmation")
            }
            with engine.connect() as db:
                assert (
                    db.scalar(
                        text("SELECT to_regclass('identity_person_reference_seq')")
                    )
                    is None
                )
                assert db.scalar(text("SELECT count(*) FROM identity_entity")) == 5

            migrate("upgrade", HEAD)
            assert references() == expected
        finally:
            engine.dispose()
