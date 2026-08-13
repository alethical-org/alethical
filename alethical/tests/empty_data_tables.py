"""Empty every data table before re-seeding, so the seeder is authoritative (#1490).

The defect this removes. `scripts/load_sample_data.py` inserts what is missing
and updates what it finds, which makes it idempotent per row but never
authoritative for a table: it cannot know about rows it did not create. Test
modules commit legislators, bills and sessions into the seeded data and do not
remove them -- `_vote_reconciliation_fixture` in `test_votes_backfill.py` leaves
42 legislators behind per run -- and each worktree's test database persists
between runs (#898, #840). So every run started from a larger database than the
last: measured 7 legislators after a seed, 54 after one full run, 140 after three.

Nothing asserts a row count, so that growth stayed invisible until a test read a
paginated endpoint. `GET /api/v1/legislators` defaults to 20 rows ordered by
`sort_name`, and once the leftovers filled that page the two sample members
`test_legislator_detail_returns_ordered_service_history` is about were no longer
in it. The test then failed for good, in a file the failing session had not
touched, and CI could not reproduce it because CI always starts from an empty
database -- so `main` stayed green while a local full-suite run was red. That
shape cost two sessions about 45 minutes between them and produced two issues
with two different diagnoses (#1491, #1490).

Its own module rather than living in `conftest.py`, for the same reason
`database_name.py` and `local_database_guard.py` are separate: pytest imports
`conftest.py` under its own module name, so a test that imported it would get a
second copy of this module's state and could not see what the fixture recorded.
Testing it directly is the point -- when this guarantee breaks, every suite stays
green and the only symptom is another session's mystery failure weeks later.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import create_engine, text

# Alembic's bookkeeping table, and the one table this must never touch: it records
# which migrations the database has had applied, so emptying it would discard the
# state `alembic upgrade head` just established and leave a fully-built database
# claiming to have no migrations at all.
ALEMBIC_VERSION_TABLE = "alembic_version"

# The tables the last call emptied, or None if it never ran. Read by
# `test_empty_data_tables.py`, so that removing the call from the seed fixture
# fails a named test instead of quietly restoring the bug described above.
EMPTIED_TABLES: list[str] | None = None


def data_tables_to_empty(existing: Iterable[str]) -> list[str]:
    """Every table the seeder is responsible for -- all of them but the stamp."""
    return sorted(name for name in existing if name != ALEMBIC_VERSION_TABLE)


def empty_data_tables(url: str) -> list[str]:
    """Empty every data table in `url`, and return the names emptied.

    One `TRUNCATE` rather than dropping and recreating the database, because
    dropping would make every run pay a migrate-from-empty; this costs a single
    statement. `CASCADE` because the tables reference each other, and truncating
    them in one statement means no foreign key is ever left dangling.
    """
    global EMPTIED_TABLES
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            names = data_tables_to_empty(
                row[0]
                for row in connection.execute(
                    text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
                )
            )
            if names:
                quoted = ", ".join(f'"{name}"' for name in names)
                connection.exec_driver_sql(
                    f"TRUNCATE {quoted} RESTART IDENTITY CASCADE"
                )
    finally:
        engine.dispose()
    EMPTIED_TABLES = names
    return names
