"""The drift check has to FAIL on drift, not merely pass on a clean repo (#100).

A guard that never fires is indistinguishable from no guard, and that is exactly
how the drift in ``docs/operations/production-database-schema-drift.md`` survived:
every gate was green the whole time. So these tests introduce each kind of
difference the check exists to catch and assert it is reported.

The diff engine is exercised directly against snapshots rather than by building
databases per test -- ``scripts/check_schema_drift.py`` builds two throwaway
databases per run and that is a CI step, not something to do fourteen times inside
a unit test. The one test that does build databases is the end-to-end one, and it
is the same call CI makes.
"""

from __future__ import annotations

import dataclasses
import json

import pytest

from scripts import check_schema_drift
from scripts.check_schema_drift import (
    IGNORED_TABLES,
    MIGRATION_ONLY_INDEXES,
    OWNED_EXTENSIONS,
    Snapshot,
    TRANSITIONAL_MIGRATION_ONLY_COLUMNS,
    _filter_transitional_model_gaps,
    diff_snapshots,
    run_migrations_vs_models,
)


def _snapshot(label: str = "left") -> Snapshot:
    """A minimal but realistic pair of tables to mutate one field at a time."""
    return Snapshot(
        label=label,
        extensions={"vector", "pg_trgm"},
        enums={"chamber_type": ("house", "senate", "joint")},
        tables={"bill", "legislator"},
        columns={
            "bill.id": "uuid NOT NULL",
            "bill.title": "character varying(500) NULL",
            "legislator.id": "uuid NOT NULL",
        },
        constraints={"bill.pk_bill": "PRIMARY KEY (id)"},
        indexes={"bill.ix_bill_title": "CREATE INDEX ix_bill_title ON public.bill"},
    )


def _mutated(**changes: object) -> Snapshot:
    return dataclasses.replace(_snapshot("right"), **changes)


def _keys(differences: list) -> set[str]:
    return {d.key for d in differences}


def test_identical_snapshots_report_no_drift() -> None:
    assert diff_snapshots(_snapshot(), _snapshot("right")) == []


def test_a_dropped_table_is_reported() -> None:
    differences = diff_snapshots(_snapshot(), _mutated(tables={"bill"}))
    assert _keys(differences) == {"legislator"}
    assert differences[0].category == "table"


def test_a_new_column_is_reported() -> None:
    columns = {**_snapshot().columns, "bill.summary": "text NULL"}
    differences = diff_snapshots(_snapshot(), _mutated(columns=columns))
    assert _keys(differences) == {"bill.summary"}


def test_a_changed_column_type_is_reported() -> None:
    columns = {**_snapshot().columns, "bill.title": "text NULL"}
    differences = diff_snapshots(_snapshot(), _mutated(columns=columns))
    (difference,) = differences
    assert difference.category == "column"
    assert difference.left == "character varying(500) NULL"
    assert difference.right == "text NULL"


def test_a_changed_nullability_is_reported() -> None:
    columns = {**_snapshot().columns, "bill.title": "character varying(500) NOT NULL"}
    assert _keys(diff_snapshots(_snapshot(), _mutated(columns=columns))) == {
        "bill.title"
    }


def test_an_added_server_default_is_reported() -> None:
    """Audit finding D8 was exactly this and nothing noticed for months."""
    columns = {**_snapshot().columns, "bill.title": "character varying(500) NULL"}
    columns["bill.title"] += " DEFAULT 'untitled'::text"
    assert _keys(diff_snapshots(_snapshot(), _mutated(columns=columns))) == {
        "bill.title"
    }


def test_a_renamed_constraint_is_reported_as_two_differences() -> None:
    """Audit finding D7: same columns, different name, on the two sides."""
    differences = diff_snapshots(
        _snapshot(), _mutated(constraints={"bill.bill_pkey": "PRIMARY KEY (id)"})
    )
    assert _keys(differences) == {"bill.pk_bill", "bill.bill_pkey"}


def test_a_missing_index_is_reported() -> None:
    """Audit finding D6: production's partial unique index, declared nowhere."""
    differences = diff_snapshots(_snapshot(), _mutated(indexes={}))
    assert _keys(differences) == {"bill.ix_bill_title"}


def test_a_changed_enum_is_reported() -> None:
    enums = {"chamber_type": ("house", "senate")}
    assert _keys(diff_snapshots(_snapshot(), _mutated(enums=enums))) == {"chamber_type"}


def test_a_missing_owned_extension_is_reported() -> None:
    differences = diff_snapshots(_snapshot(), _mutated(extensions={"vector"}))
    assert _keys(differences) == {"pg_trgm"}


def test_a_missing_table_does_not_also_report_its_columns() -> None:
    """One missing table produced 33 of the audit's 39 raw differences.

    Reporting a table's every column on top of the table itself buries the
    finding that matters under the ones that follow from it, which is why the
    audit had to collapse 39 differences into 11 by hand.
    """
    right = _mutated(
        tables={"bill"},
        columns={k: v for k, v in _snapshot().columns.items() if k != "legislator.id"},
    )
    right.columns["bill.id"] = "uuid NOT NULL"
    differences = diff_snapshots(_snapshot(), right)
    assert _keys(differences) == {"legislator"}


def test_the_ignore_sets_stay_small_and_deliberate() -> None:
    """Each ignored object is a decision recorded in the audit, not a catch-all.

    A check earns its keep only while its exceptions are few enough to read. If
    this fails, the honest move is to ask whether the new exception is a finding
    rather than to raise the number.
    """
    assert IGNORED_TABLES == {
        "alembic_version",
        "oban_jobs",
        "oban_leaders",
        "oban_producers",
    }
    assert OWNED_EXTENSIONS == {"vector", "pg_trgm"}
    # 9 since alembic 0033 added ix_bill_short_title_trgm. Asked the question this
    # docstring asks: it is not a finding, it is a fourth member of the trigram
    # search group already listed here, created the same way for the same reason.
    # A gin_trgm_ops index cannot move onto the models without pg_trgm existing
    # before create_all runs, which is why that whole group sits in this set.
    assert len(MIGRATION_ONLY_INDEXES) == 9
    assert TRANSITIONAL_MIGRATION_ONLY_COLUMNS == {
        "auth_identity.last_used_at": "timestamp with time zone NULL",
        "user_account.last_signed_in_at": "timestamp with time zone NULL",
    }


def test_only_the_exact_transition_columns_are_filtered() -> None:
    differences = [
        check_schema_drift.Difference(
            "column",
            "auth_identity.last_used_at",
            "timestamp with time zone NULL",
            None,
        ),
        check_schema_drift.Difference(
            "column",
            "bill.unexpected",
            "text NULL",
            None,
        ),
        check_schema_drift.Difference(
            "column",
            "user_account.last_signed_in_at",
            None,
            "timestamp with time zone NULL",
        ),
        check_schema_drift.Difference(
            "column",
            "user_account.last_signed_in_at",
            "text NULL",
            None,
        ),
        check_schema_drift.Difference(
            "column",
            "user_account.last_signed_in_at",
            "timestamp with time zone NOT NULL",
            None,
        ),
        check_schema_drift.Difference(
            "column",
            "user_account.last_signed_in_at",
            "timestamp with time zone NULL DEFAULT now()",
            None,
        ),
    ]

    filtered = _filter_transitional_model_gaps(differences)

    assert [
        (difference.key, difference.left, difference.right) for difference in filtered
    ] == [
        ("bill.unexpected", "text NULL", None),
        (
            "user_account.last_signed_in_at",
            None,
            "timestamp with time zone NULL",
        ),
        ("user_account.last_signed_in_at", "text NULL", None),
        (
            "user_account.last_signed_in_at",
            "timestamp with time zone NOT NULL",
            None,
        ),
        (
            "user_account.last_signed_in_at",
            "timestamp with time zone NULL DEFAULT now()",
            None,
        ),
    ]


@pytest.mark.parametrize(
    "argv, mode",
    [
        (["--against-production", "--json"], "production-vs-migrations"),
        (["--json"], "migrations-vs-models"),
    ],
)
def test_json_output_is_only_json_when_there_is_drift(
    argv: list[str], mode: str, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    """``--json`` has to stay parseable in the case that matters: drift found.

    Both modes end by printing advice written for a person at a terminal. Printed
    under ``--json`` it lands after the closing brace, so stdout stops being JSON
    at exactly the moment there is something to read -- and it is invisible on a
    clean repo, because the advice only prints when there are differences. The
    caller this breaks is the post-deploy production check in
    ``.github/workflows/migrate.yml``, which parses this output to decide whether
    to file an issue.
    """
    left, right = _snapshot("production"), _mutated(tables={"bill"})
    differences = diff_snapshots(left, right)
    assert differences, "the fixture must actually differ or this proves nothing"
    monkeypatch.setattr(
        check_schema_drift,
        "run_production_vs_migrations",
        lambda: (left, right, differences),
    )
    monkeypatch.setattr(
        check_schema_drift,
        "run_migrations_vs_models",
        lambda: (left, right, differences),
    )

    check_schema_drift.main(argv)

    payload = json.loads(capsys.readouterr().out)
    assert payload["mode"] == mode
    assert payload["differences"], "the drift has to survive into the JSON"


@pytest.mark.usefixtures("seed_database")
def test_the_migrations_build_what_the_models_declare() -> None:
    """The real check, against real Postgres -- the same call CI makes.

    Slow (it creates and drops two databases), and worth it: everything above
    tests the comparison, and only this tests the thing being compared.
    """
    _, _, differences = run_migrations_vs_models()
    assert differences == [], "\n".join(
        d.render("migrations", "models.py") for d in differences
    )
