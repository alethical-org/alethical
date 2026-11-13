"""Unreleased election migrations preserve named constraints and source guards."""

import os
from pathlib import Path
import subprocess
import sys

from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from alethical.db.models import Base
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
TABLES = (
    "election_outcome_source",
    "election_outcome_decision",
    "election_external_finance_generation",
    "election_external_finance_report",
    "election_external_finance_payment",
    "election_external_finance_current",
)


def test_election_migrations_match_model_names_and_restore_identical_guards():
    with ScratchDatabase(_local_base_url(), "election_constraint_names") as scratch:
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

            def constraints():
                with engine.connect() as db:
                    return set(
                        db.execute(
                            text(
                                "SELECT c.relname, con.conname FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE c.relname = ANY(:tables)"
                            ),
                            {"tables": list(TABLES)},
                        )
                    )

            def guards():
                with engine.connect() as db:
                    return list(
                        db.execute(
                            text(
                                "SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid), pg_get_functiondef(t.tgfoid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname = ANY(:tables) ORDER BY c.relname, t.tgname"
                            ),
                            {"tables": list(TABLES)},
                        )
                    )

            migrate("upgrade", "0095_external_election_finance")
            dialect = postgresql.dialect()
            expected = {
                (name, dialect.identifier_preparer.format_constraint(constraint))
                for name in TABLES
                for constraint in Base.metadata.tables[name].constraints
            }
            assert constraints() == expected
            original_guards = guards()
            assert len(original_guards) == 7
            assert any("FOR UPDATE" in row[3] for row in original_guards)
            assert any("append-only" in row[3] for row in original_guards)
            migrate("downgrade", "0093_election_comparison")
            assert constraints() == set() and guards() == []
            migrate("upgrade", "head")
            assert constraints() == expected
            assert guards() == original_guards
        finally:
            engine.dispose()
