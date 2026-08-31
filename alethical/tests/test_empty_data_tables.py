"""Prove every run starts from the seeded data, not from the last run's leftovers.

Why the guarantee needs a test at all: nothing else asserts a row count, so a test
database that grows every run stays green until some test reads a paginated endpoint
and finds the sample rows pushed off the page it read. That is how both
[#1490](https://github.com/alethical-org/alethical/issues/1490) (backend tests fail on
the second local run) and [#1491](https://github.com/alethical-org/alethical/issues/1491)
(a service-history test fails for good past 20 legislators) were filed, against a test
in a file neither session had touched. CI cannot catch a regression here on its own,
because CI always starts from an empty database -- which makes an explicit test the
only thing standing between the guarantee and its quiet removal. Full account of the
defect: `alethical/tests/empty_data_tables.py`.
"""

from __future__ import annotations

from alethical.tests import empty_data_tables


def test_data_tables_to_empty_covers_our_tables_and_nothing_else() -> None:
    """Only tables the models declare *and* the database has.

    `alembic_version` records the migrations already applied and would leave a
    fully-built database claiming to have none; `someone_elses_table` stands for a
    database that `ALETHICAL_TEST_DATABASE_URL` points at which holds more than ours.
    """
    assert empty_data_tables.data_tables_to_empty(
        declared=["legislator", "bill", "committee"],
        existing=["legislator", "bill", "alembic_version", "someone_elses_table"],
    ) == ["bill", "legislator"]


def test_every_run_starts_from_an_emptied_database(seed_database: None) -> None:
    """The session fixture must empty the data tables before it re-seeds.

    Without that, `scripts/load_sample_data.py` is idempotent per row but not
    authoritative for a table, so rows a test committed and never removed survive into
    every later run and accumulate without bound.
    """
    assert empty_data_tables.EMPTIED_TABLES is not None, (
        "seed_database did not empty the data tables, so this run inherited "
        "whatever the previous run left behind (issue #1490)"
    )
    assert "legislator" in empty_data_tables.EMPTIED_TABLES
    assert "alembic_version" not in empty_data_tables.EMPTIED_TABLES
