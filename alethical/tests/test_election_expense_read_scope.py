"""Exact-race reads keep relationship closure without loading unrelated races."""

# ruff: noqa: F401,F811
from copy import deepcopy

import pytest
from fastapi import HTTPException
from sqlalchemy import event, select

from alethical.api.services import election_expense_analytics as reads
from alethical.db import models as m
from alethical.tests.finance_fixtures import finance_db
from alethical.tests.test_election_finance_reads import comparison
from alethical.tests.test_election_outside_spending import spending
from alethical.tests.test_election_comparison_reads import KEY, RACE, _race
from alethical.tests.test_election_expense_analytics import (
    db,
    external,
    own_external,
    retained_read_store,
)


def _responses(db, options):
    data = reads._build(db, _csv=True, **options)
    data["generated_at"] = "2026-11-13T00:00:00+00:00"
    data["filters"]["search_query"] = ""
    return (
        reads.report(db, **options),
        reads.payees(db, **options),
        data,
        reads._csv_body(data),
    )


def test_exact_race_omits_unrelated_races_and_keeps_full_output(
    finance_db, comparison, monkeypatch
):
    unrelated = _race(finance_db, race_id="9" * 64)
    unrelated.payload = deepcopy(comparison["race"].payload)
    store, _, _ = retained_read_store(finance_db, comparison)
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: store)
    actual_bulk = reads._bulk_accounts
    loaded = []

    def capture(db, election_key, races, **kwargs):
        loaded.append({race.id for race in races})
        return actual_bulk(db, election_key, races, **kwargs)

    monkeypatch.setattr(reads, "_bulk_accounts", capture)
    options = dict(election_key=KEY, race_id=RACE, candidate_id="a")
    actual = _responses(finance_db, options)
    assert RACE in loaded[-1]
    assert unrelated.id not in loaded[-1]
    all_ids = list(finance_db.scalars(select(m.ElectionComparisonRace.id)))
    original_load = reads._load

    def complete_race_reference(*args, **kwargs):
        kwargs["external_race_ids"] = all_ids
        return original_load(*args, **kwargs)

    with monkeypatch.context() as reference:
        reference.setattr(reads, "_load", complete_race_reference)
        full = _responses(finance_db, options)
    assert actual == full
    global_result = reads.report(finance_db, election_key=KEY)
    assert unrelated.id in loaded[-1]
    assert (
        global_result["coverage"]["named_candidacies"]
        == actual[0]["coverage"]["named_candidacies"]
    )
    assert (
        global_result["coverage"]["scoped_candidacies"]
        > actual[0]["coverage"]["scoped_candidacies"]
    )


def test_final_identity_checks_do_not_reload_large_snapshot_or_collection_json(
    finance_db, comparison, monkeypatch
):
    store, _, _ = retained_read_store(finance_db, comparison)
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: store)
    statements = []

    def capture(conn, cursor, statement, parameters, context, many):
        statements.append(" ".join(statement.split()))

    connection = finance_db.connection()
    event.listen(connection, "before_cursor_execute", capture)
    try:
        reads.report(finance_db, election_key=KEY, race_id=RACE)
    finally:
        event.remove(connection, "before_cursor_execute", capture)
    for table in ("election_comparison_snapshot", "election_finance_collection"):
        queries = [s for s in statements if f"FROM {table} JOIN" in s]
        assert len(queries) == 2
        assert queries[-1].split(" FROM ", 1)[0] == f"SELECT {table}.id"


@pytest.mark.parametrize(
    "table", ["election_comparison_snapshot", "election_finance_collection"]
)
def test_closing_identity_check_still_refuses_a_missing_published_identity(
    finance_db, comparison, monkeypatch, table
):
    store, _, _ = retained_read_store(finance_db, comparison)
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: store)
    original = finance_db.scalar
    calls = []

    def missing(statement, *args, **kwargs):
        if str(statement).split("\n", 1)[0].strip() == f"SELECT {table}.id":
            calls.append(table)
            return None
        return original(statement, *args, **kwargs)

    monkeypatch.setattr(finance_db, "scalar", missing)
    with pytest.raises(HTTPException) as error:
        reads.report(finance_db, election_key=KEY, race_id=RACE)
    assert error.value.status_code == 404
    assert calls == [table]


def test_external_bulk_race_closure_is_forwarded_before_display_filter(
    db, own_external, monkeypatch
):
    ctx = own_external
    extra = _race(db, snapshot_id=ctx.snapshot.id, race_id="7" * 64)
    unrelated = _race(db, snapshot_id=ctx.snapshot.id, race_id="8" * 64)
    extra.payload = deepcopy(ctx.race.payload)
    unrelated.payload = deepcopy(ctx.race.payload)
    original_bulk = reads.external.bulk_finance
    original_load = reads._load
    loaded = []

    def bulk(*args, **kwargs):
        result = deepcopy(original_bulk(*args, **kwargs))
        # A second authority entry must retain its race even without a Board
        # decision. The normal external tests cover full shared account money.
        result["candidates"].append(
            {
                "race_id": extra.id,
                "candidate_id": extra.payload["candidates"][0]["candidate_id"],
                "accounts": [],
                "account_gaps": [],
                "reports": [],
                "own_payments": [],
                "coverage": {},
            }
        )
        return result

    def capture(*args, **kwargs):
        value = original_load(*args, **kwargs)
        loaded.append({r.id for r in value[1]})
        return value

    monkeypatch.setattr(reads.external, "bulk_finance", bulk)
    monkeypatch.setattr(reads, "_load", capture)
    reads.report(db, election_key=KEY, race_id=ctx.race.id)
    assert {ctx.race.id, extra.id} <= loaded[-1]
    assert unrelated.id not in loaded[-1]
