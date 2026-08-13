"""Empty this app's own tables before re-seeding, so the seeder is authoritative.

Removes the defect in [#1490](https://github.com/alethical-org/alethical/issues/1490)
(backend tests fail on the second local run) and the growth behind
[#1491](https://github.com/alethical-org/alethical/issues/1491) (a service-history
test fails for good once a worktree database passes 20 legislators).

The defect. `scripts/load_sample_data.py` inserts what is missing and updates what
it finds, which makes it idempotent per row but never authoritative for a table: it
cannot know about rows it did not create. Test modules commit legislators, bills and
sessions into the seeded data and do not remove them -- `_vote_reconciliation_fixture`
in `test_votes_backfill.py` leaves 42 legislators behind per run -- and each worktree's
test database persists between runs (issues
[#898](https://github.com/alethical-org/alethical/issues/898), one database per
worktree, and [#840](https://github.com/alethical-org/alethical/issues/840),
self-healing a stale migration stamp). So every run started from a larger database
than the last: measured 7 legislators after a seed, 54 after one full run, 140 after
three.

Nothing asserts a row count, so that growth stayed invisible until a test read a
paginated endpoint. `GET /api/v1/legislators` defaults to 20 rows ordered by
`sort_name`, and once the leftovers filled that page the two sample members
`test_legislator_detail_returns_ordered_service_history` is about were no longer in
it. The test then failed for good, in a file the failing session had not touched, and
CI could not reproduce it because CI always starts from an empty database -- so `main`
stayed green while a local full-suite run was red. That shape cost two sessions about
45 minutes between them and produced two issues with two different diagnoses.

Its own module rather than living in `conftest.py`, for the same reason
`database_name.py` and `local_database_guard.py` are separate: pytest imports
`conftest.py` under its own module name, so a test that imported it would get a second
copy of this module's state and could not see what the fixture recorded. Testing it
directly is the point -- when this guarantee breaks, every suite stays green and the
only symptom is another session's mystery failure weeks later.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import create_engine, text

# The tables the last call emptied, or None if it never ran. Read by
# `test_empty_data_tables.py`, so that removing the call from the seed fixture fails a
# named test instead of quietly restoring the defect described above.
EMPTIED_TABLES: list[str] | None = None


def data_tables_to_empty(declared: Iterable[str], existing: Iterable[str]) -> list[str]:
    """The tables this app's own models declare, and only those.

    Restricted to declared tables rather than everything in the `public` schema,
    because `ALETHICAL_TEST_DATABASE_URL` can point the suite at a local database
    that also holds tables belonging to something else. Emptying those would destroy
    data this suite has no business touching, and would fail outright where the test
    role does not own them.

    Two things follow from the restriction, both wanted. `alembic_version` is excluded
    by construction, because Alembic owns that table and the models never declare it --
    and emptying it would leave a fully-built database claiming to have no migrations
    applied. And a table left behind by some other branch's migration keeps its rows,
    which is harmless: no model maps it, so no test can read it.

    Intersected with what exists, so a table the models declare but this database has
    not got yet cannot make the `TRUNCATE` fail.
    """
    return sorted(set(declared) & set(existing))


def empty_data_tables(url: str) -> list[str]:
    """Empty this app's tables in `url`, and return the names emptied.

    One `TRUNCATE` rather than dropping and recreating the database, because dropping
    would make every run pay a migrate-from-empty; this costs a single statement. All
    the tables are named in that one statement, which is what lets Postgres empty
    tables that reference each other without leaving a foreign key pointing at a row
    that is gone.

    Deliberately **not** `CASCADE`, which would defeat the restriction in
    `data_tables_to_empty` above: `CASCADE` empties every table holding a foreign key
    into a named one, recursively, so a table belonging to something else would be
    emptied after all -- silently, and precisely in the case the restriction promises
    to protect. Without it, such a table makes this statement fail instead, naming
    itself in the error. A loud failure is the right answer there, because the
    alternative is destroying data this suite does not own.
    """
    global EMPTIED_TABLES
    # Imported here, not at module scope: `conftest.py` imports this module before it
    # settles DATABASE_URL in the environment, and nothing in the seeding path should
    # depend on when the models happen to be first imported.
    from alethical.db.models import Base

    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            names = data_tables_to_empty(
                Base.metadata.tables,
                (
                    row[0]
                    for row in connection.execute(
                        text(
                            "SELECT tablename FROM pg_tables "
                            "WHERE schemaname = 'public'"
                        )
                    )
                ),
            )
            if names:
                quoted = ", ".join(f'"{name}"' for name in names)
                connection.exec_driver_sql(f"TRUNCATE {quoted} RESTART IDENTITY")
    finally:
        engine.dispose()
    EMPTIED_TABLES = names
    return names
