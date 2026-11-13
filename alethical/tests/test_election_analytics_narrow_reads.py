"""Narrow analytics keep full evidence and global reconciliation."""

# Imported fixtures are intentionally rebound by pytest.
# ruff: noqa: F401,F811

from copy import deepcopy
from datetime import date
from decimal import Decimal
import json
from types import SimpleNamespace

from fastapi import HTTPException
import pytest
from sqlalchemy import event

from alethical.api.services import election_analytics as reads
from alethical.db import models as m
from alethical.pipeline import election_account_reviews as reviews
from alethical.tests.finance_fixtures import finance_db
from alethical.tests.test_committee_finance import Published
from alethical.tests.test_election_analytics import (
    analytics,
    checked_external,
    db,
    external_generation,
    retain_analytics_originals,
)
from alethical.tests.test_election_comparison_reads import KEY, RACE, SOURCE, _race
from alethical.tests.test_election_finance_reads import comparison
from alethical.tests.test_election_outside_spending import spending


def test_null_write_in_aggregate_keeps_analytics_and_pending_outcome(
    finance_db, analytics, comparison
):
    payload = deepcopy(comparison["race"].payload)
    aggregate = next(c for c in payload["candidates"] if c["is_write_in_aggregate"])
    aggregate["candidate_id"] = None
    comparison["race"].payload = payload
    finance_db.commit()
    context, _, _, _, outcomes, _ = reads._context(finance_db, KEY)
    assert context["version"]
    assert outcomes[RACE]["candidates"][None] == {
        "outcome": None,
        "outcome_status": "pending",
        "evidence": [],
    }
    assert reads.funders(finance_db, election_key=KEY)["funders"]


def test_race_filter_formats_only_related_board_rows(
    finance_db, analytics, monkeypatch
):
    original = reads._event
    events = []

    def record(*args, **kwargs):
        event = original(*args, **kwargs)
        events.append(event)
        return event

    monkeypatch.setattr(reads, "_event", record)
    context, selected, *_ = reads._build(finance_db, election_key=KEY, race_id=RACE)
    unrelated = [event for event in events if not event["related_candidacies"]]
    assert unrelated and all(not event["fields"] for event in unrelated)
    assert selected and all(event["fields"] for event in selected)
    assert sum(bucket["record_count"] for bucket in context["reconciliation"]) == len(
        events
    )


def test_nullable_outcome_version_keeps_ids_values_and_stable_order():
    original = {
        "race": {
            "candidates": {
                "null": {"outcome": "not_elected"},
                None: {"outcome": None},
                "a": {"outcome": "elected"},
            }
        }
    }
    saved = deepcopy(original)
    encoded = json.dumps(reads._outcome_version_state(original), sort_keys=True)
    reordered = deepcopy(original)
    reordered["race"]["candidates"] = dict(
        reversed(list(reordered["race"]["candidates"].items()))
    )
    assert encoded == json.dumps(
        reads._outcome_version_state(reordered), sort_keys=True
    )
    assert original == saved
    entries = reads._outcome_version_state(original)["race"]["candidates"][1]
    assert dict(entries) == original["race"]["candidates"]
    changed = deepcopy(original)
    changed["race"]["candidates"][None]["outcome"] = "not_elected"
    assert encoded != json.dumps(reads._outcome_version_state(changed), sort_keys=True)
    changed = deepcopy(original)
    changed["race"]["candidates"][None], changed["race"]["candidates"]["null"] = (
        changed["race"]["candidates"]["null"],
        changed["race"]["candidates"][None],
    )
    assert encoded != json.dumps(reads._outcome_version_state(changed), sort_keys=True)


def test_string_outcome_version_keeps_existing_json_bytes():
    original = {
        "race": {
            "candidates": {"z": {"outcome": None}, "a": {"outcome": "elected"}},
            "outcome_review": {"checked_on": date(2026, 11, 13), "version": "held"},
        }
    }
    assert json.dumps(
        reads._outcome_version_state(original), sort_keys=True, default=str
    ) == json.dumps(original, sort_keys=True, default=str)


def test_existing_board_pin_is_unchanged(finance_db, analytics, monkeypatch):
    actual = reads._context(finance_db, KEY)[0]
    monkeypatch.setattr(reads, "_outcome_version_state", lambda outcomes: outcomes)
    assert reads._context(finance_db, KEY)[0] == actual


@pytest.mark.parametrize("board_available", [False, True])
def test_null_aggregate_in_composed_authorities_keeps_outcomes_and_pins(
    finance_db, checked_external, monkeypatch, board_available
):
    if board_available:
        retain_analytics_originals(finance_db, Published(finance_db), monkeypatch)
    legacy = reads._context(finance_db, KEY)[0]
    with monkeypatch.context() as reference:
        reference.setattr(reads, "_outcome_version_state", lambda outcomes: outcomes)
        assert reads._context(finance_db, KEY)[0] == legacy
    race = checked_external.race
    payload = deepcopy(race.payload)
    payload["candidates"].append(
        {
            "candidate_id": None,
            "name": "WRITE-IN",
            "is_write_in_aggregate": True,
            "votes": 0,
        }
    )
    race.payload = payload
    finance_db.commit()
    before, _, _, _, outcomes, _ = reads._context(finance_db, KEY)
    assert before["source_scopes"]["mn_cfb"]["status"] == (
        "available" if board_available else "not_published"
    )
    assert outcomes[race.id]["candidates"][None]["outcome"] is None
    assert outcomes[race.id]["candidates"][None]["outcome_status"] == "pending"
    race.payload = {**payload, "candidates": list(reversed(payload["candidates"]))}
    finance_db.commit()
    assert reads._context(finance_db, KEY)[0]["version"] == before["version"]
    changed = deepcopy(outcomes)
    changed[race.id]["candidates"][None]["evidence"] = [{"sha256": "changed"}]
    monkeypatch.setattr(reads, "_outcomes", lambda *args, **kwargs: changed)
    with pytest.raises(HTTPException) as failure:
        reads._context(finance_db, KEY, version=before["version"])
    assert failure.value.status_code == 409


def _all_responses(db, **filters):
    return [
        operation(db, election_key=KEY, **filters)
        for operation in (
            reads.funders,
            reads.candidates,
            reads.records,
            reads.export,
            lambda db, **kwargs: reads.export(db, format="csv", **kwargs),
        )
    ]


def _use_full_annual_reference(monkeypatch):
    original_rows = reads._annual_rows
    original_event = reads._event

    def full_rows(*args, **kwargs):
        return original_rows(*args, **{**kwargs, "full_fields": True})

    def full_fields(*args, **kwargs):
        return original_event(
            *args, **{**kwargs, "race_id": None, "include_fields": True}
        )

    monkeypatch.setattr(reads, "_annual_rows", full_rows)
    monkeypatch.setattr(reads, "_event", full_fields)
    monkeypatch.setattr(reads, "_fill_event_fields", lambda *args: None)


@pytest.mark.parametrize("shared_claim", [False, True])
@pytest.mark.parametrize(
    "filters",
    [
        {},
        {"race_id": RACE},
        {"race_id": RACE, "funder_id": "registration:40001"},
        {"race_id": RACE, "q": "Example fund"},
        {
            "race_id": RACE,
            "start_date": date(2026, 10, 1),
            "end_date": date(2026, 10, 1),
        },
    ],
)
def test_deferred_fields_preserve_full_responses_and_exports(
    finance_db, analytics, comparison, monkeypatch, shared_claim, filters
):
    if shared_claim:
        other = _race(finance_db, race_id="8" * 64)
        other.payload = deepcopy(comparison["race"].payload)
        reviews.record_decision(
            finance_db,
            **{
                **comparison["args"],
                "race_id": other.id,
                "identity": reviews.candidate_identity(
                    other, other.payload["candidates"][0]
                ),
                "compatible_decision_ids": [comparison["decision"].id],
                "evidence": [
                    *comparison["args"]["evidence"],
                    {
                        "kind": "same_person",
                        "sha256": SOURCE,
                        "decision_ids": [comparison["decision"].id],
                    },
                ],
            },
        )
        finance_db.commit()
    actual = _all_responses(finance_db, **filters)
    _use_full_annual_reference(monkeypatch)
    assert actual == _all_responses(finance_db, **filters)


@pytest.mark.parametrize("board_available", [False, True])
def test_deferred_fields_keep_external_and_mixed_authority_responses(
    finance_db, checked_external, monkeypatch, board_available
):
    if board_available:
        retain_analytics_originals(finance_db, Published(finance_db), monkeypatch)
    filters = {"race_id": checked_external.race.id}
    actual = _all_responses(finance_db, **filters)
    _use_full_annual_reference(monkeypatch)
    assert actual == _all_responses(finance_db, **filters)


@pytest.mark.parametrize("query", ["", "No matching funder"])
def test_race_read_loads_full_source_columns_only_for_selected_rows(
    finance_db, analytics, query
):
    models = (
        m.CampaignFinanceContributionRow,
        m.CampaignFinanceIndependentExpenditureRow,
    )
    for row in list(finance_db.identity_map.values()):
        if isinstance(row, models):
            finance_db.expunge(row)
    loaded, statements, annual_batches = [], [], []

    def capture_row(session, instance):
        if isinstance(instance, models):
            loaded.append((instance.__tablename__, instance.row_number))

    def capture_sql(conn, cursor, statement, parameters, context, many):
        sql = " ".join(statement.split())
        statements.append(sql)
        if ".year IS NULL" in sql and "ORDER BY" in sql:
            annual_batches.append(context.execution_options.get("yield_per"))

    connection = finance_db.connection()
    event.listen(finance_db, "loaded_as_persistent", capture_row)
    event.listen(connection, "before_cursor_execute", capture_sql)
    try:
        context, selected, *_ = reads._build(
            finance_db, election_key=KEY, race_id=RACE, q=query
        )
    finally:
        event.remove(finance_db, "loaded_as_persistent", capture_row)
        event.remove(connection, "before_cursor_execute", capture_sql)
    expected = {
        (reads.DATASETS[row["dataset"]][0].__tablename__, row["row_number"])
        for row in selected
    }
    assert set(loaded) == expected
    assert annual_batches == [10000, 10000]
    assert all(row["fields"] for row in selected)
    assert sum(bucket["record_count"] for bucket in context["reconciliation"]) > len(
        selected
    )
    for model, omitted in (
        (models[0], "contrib_employer_name"),
        (models[1], "vendor_name"),
    ):
        table = model.__tablename__
        annual = [
            sql
            for sql in statements
            if f"FROM {table} " in sql
            and f"{table}.year IS NULL" in sql
            and f"ORDER BY {table}.row_number" in sql
        ]
        assert len(annual) == 1
        assert f"{table}.{omitted}" not in annual[0].split(" FROM ", 1)[0]
        details = [
            sql
            for sql in statements
            if f"FROM {table} " in sql
            and f"{table}.{omitted}" in sql.split(" FROM ", 1)[0]
        ]
        assert len(details) == bool(any(name == table for name, _ in expected))
        if details:
            assert f"{table}.snapshot_id =" in details[0]
            assert f"{table}.row_number = ANY" in details[0]


def test_missing_selected_source_row_fails_closed(finance_db, analytics, monkeypatch):
    original = finance_db.scalars

    def missing_detail(query, *args, **kwargs):
        rows = original(query, *args, **kwargs)
        if query.column_descriptions[0]["entity"] is m.CampaignFinanceContributionRow:
            return (row for row in rows if row.row_number != 1)
        return rows

    monkeypatch.setattr(finance_db, "scalars", missing_detail)
    with pytest.raises(HTTPException) as failure:
        reads.records(finance_db, election_key=KEY, race_id=RACE)
    assert failure.value.status_code == 503


def test_unfiltered_read_keeps_single_full_annual_query(finance_db, analytics):
    statements = []

    def capture(conn, cursor, statement, parameters, context, many):
        statements.append(" ".join(statement.split()))

    connection = finance_db.connection()
    event.listen(connection, "before_cursor_execute", capture)
    try:
        _, selected, *_ = reads._build(finance_db, election_key=KEY)
    finally:
        event.remove(connection, "before_cursor_execute", capture)
    assert selected and all(row["fields"] for row in selected)
    for table, detail in (
        ("cf_contribution_row", "contrib_employer_name"),
        ("cf_independent_expenditure_row", "vendor_name"),
    ):
        annual = [
            sql
            for sql in statements
            if f"FROM {table} " in sql
            and f"{table}.year IS NULL" in sql
            and f"ORDER BY {table}.row_number" in sql
        ]
        assert len(annual) == 1
        assert f"{table}.{detail}" in annual[0].split(" FROM ", 1)[0]
        assert not any(f"{table}.row_number = ANY" in sql for sql in statements)


def test_two_stage_read_preserves_largest_source_amount(
    finance_db, analytics, monkeypatch
):
    amount = Decimal("99999999999999.9999")
    row = finance_db.get(
        m.CampaignFinanceContributionRow, (analytics.contributions.id, 1)
    )
    row.amount = amount
    finance_db.commit()
    actual = _all_responses(finance_db, race_id=RACE)
    record = next(
        row
        for row in actual[2]["rows"]
        if row["dataset"] == "contributions" and row["row_number"] == 1
    )
    assert record["amount"] == record["fields"]["Amount"] == str(amount)
    _use_full_annual_reference(monkeypatch)
    assert actual == _all_responses(finance_db, race_id=RACE)


def test_board_detail_fetch_excludes_external_dataset_aliases():
    def unexpected(*args, **kwargs):
        pytest.fail("External rows entered a Board source query")

    reads._fill_event_fields(
        SimpleNamespace(scalars=unexpected),
        SimpleNamespace(file_for=unexpected),
        [{"dataset": "contributions", "source_family": "external", "row_number": 1}],
    )
