"""Record pages hydrate their own source fields after complete reconciliation."""

# Existing fixtures keep source proof and transaction setup identical.
# ruff: noqa: F401,F811
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
import pytest
from sqlalchemy import event

from alethical.api.services import election_analytics as reads
from alethical.db import models as m
from alethical.tests.finance_fixtures import finance_db
from alethical.tests.test_committee_finance import Published
from alethical.tests.test_election_analytics import (
    analytics,
    checked_external,
    db,
    external_generation,
    retain_analytics_originals,
)
from alethical.tests.test_election_comparison_reads import KEY, RACE
from alethical.tests.test_election_finance_reads import comparison
from alethical.tests.test_election_outside_spending import spending


def _reference_records(
    db, *, limit=50, offset=0, candidate_id=None, metric=None, resolution=None, **kwargs
):
    # Exact pre-change records path, with default full-field build.
    context, events, races, _, _ = reads._build(db, **kwargs)
    reads._candidate_exists(context, races, candidate_id)
    rows = reads._record_filters(events, candidate_id, metric, resolution)
    context = reads._record_context(context, rows, candidate_id, metric, resolution)
    return {
        **context,
        "rows": rows[offset : offset + limit],
        "page": reads._page(rows, limit, offset),
    }


@pytest.mark.parametrize(
    "scope",
    [
        {},
        {"race_id": RACE},
        {"race_id": RACE, "candidate_id": "a", "metric": "direct_contributions"},
    ],
)
@pytest.mark.parametrize("offset", [0, 1, 1000])
def test_record_page_hydrates_only_returned_board_rows(
    finance_db, analytics, monkeypatch, scope, offset
):
    loaded, formatted, statements = [], [], []
    models = tuple(model for model, _ in reads.DATASETS.values())
    for instance in list(finance_db.identity_map.values()):
        if isinstance(instance, models):
            finance_db.expunge(instance)
    original = reads._event_fields

    def fields(row, dataset):
        formatted.append((dataset, row.row_number))
        return original(row, dataset)

    def load(session, instance):
        if isinstance(instance, models):
            loaded.append((instance.__tablename__, instance.row_number))

    def sql(conn, cursor, statement, parameters, context, many):
        statements.append((" ".join(statement.split()), parameters))

    monkeypatch.setattr(reads, "_event_fields", fields)
    connection = finance_db.connection()
    event.listen(finance_db, "loaded_as_persistent", load)
    event.listen(connection, "before_cursor_execute", sql)
    try:
        answer = reads.records(
            finance_db, election_key=KEY, limit=1, offset=offset, **scope
        )
    finally:
        event.remove(finance_db, "loaded_as_persistent", load)
        event.remove(connection, "before_cursor_execute", sql)
    expected = [
        (row["dataset"], row["row_number"])
        for row in answer["rows"]
        if row.get("source_family") != "external"
    ]
    assert sorted(formatted) == sorted(expected)
    assert set(loaded) == {
        (reads.DATASETS[dataset][0].__tablename__, number)
        for dataset, number in expected
    }
    assert all(row["fields"] for row in answer["rows"])
    assert sum(bucket["record_count"] for bucket in answer["reconciliation"]) > len(
        answer["rows"]
    )
    for dataset, (model, _) in reads.DATASETS.items():
        table = model.__tablename__
        details = [
            (sql, params)
            for sql, params in statements
            if f"FROM {table} " in sql and f"{table}.row_number = ANY" in sql
        ]
        assert len(details) == bool(any(name == dataset for name, _ in expected))
        for sql, params in details:
            assert f"{table}.snapshot_id =" in sql
            assert (
                str(params["snapshot_id_1"])
                == answer["sources"][dataset]["snapshot_id"]
            )


@pytest.mark.parametrize(
    "scope",
    [
        {},
        {"race_id": RACE},
        {"race_id": RACE, "candidate_id": "a"},
        {"race_id": RACE, "funder_id": "registration:40001"},
        {"metric": "direct_contributions"},
        {"resolution": "missing_year"},
        {"q": "nothing matches"},
        {
            "race_id": RACE,
            "start_date": date(2026, 10, 1),
            "end_date": date(2026, 10, 1),
        },
    ],
)
@pytest.mark.parametrize("offset", [0, 1, 1000])
def test_record_pages_keep_entire_old_answer(finance_db, analytics, scope, offset):
    kwargs = dict(election_key=KEY, limit=1, offset=offset, **scope)
    assert reads.records(finance_db, **kwargs) == _reference_records(
        finance_db, **kwargs
    )


@pytest.mark.parametrize("board_available", [False, True])
def test_record_pages_keep_native_and_mixed_fields(
    finance_db, checked_external, monkeypatch, board_available
):
    if board_available:
        retain_analytics_originals(finance_db, Published(finance_db), monkeypatch)
    kwargs = dict(election_key=KEY, race_id=checked_external.race.id, limit=1)
    actual = reads.records(finance_db, **kwargs)
    assert actual == _reference_records(finance_db, **kwargs)
    assert actual["rows"] and all(row["fields"] for row in actual["rows"])


def test_record_page_missing_detail_refuses(finance_db, analytics, monkeypatch):
    original = finance_db.scalars

    def missing(query, *args, **kwargs):
        rows = original(query, *args, **kwargs)
        if query.column_descriptions[0]["entity"] is m.CampaignFinanceContributionRow:
            return iter(())
        return rows

    monkeypatch.setattr(finance_db, "scalars", missing)
    with pytest.raises(HTTPException) as error:
        reads.records(finance_db, election_key=KEY, limit=1)
    assert error.value.status_code == 503


@pytest.mark.parametrize(
    "dataset", ["contributions", "independent_expenditures", "expenditures"]
)
def test_empty_page_still_checks_all_source_originals(finance_db, analytics, dataset):
    before = reads.records(finance_db, election_key=KEY, limit=1, offset=1000)
    analytics.retained_store.objects.pop(analytics.retained_keys[dataset])
    for pinned, status in [(False, 503), (True, 409)]:
        with pytest.raises(HTTPException) as error:
            reads.records(
                finance_db,
                election_key=KEY,
                limit=1,
                offset=1000,
                **({"version": before["version"]} if pinned else {}),
            )
        assert error.value.status_code == status


def test_record_page_exact_money_and_export_complete(finance_db, analytics):
    row = finance_db.get(
        m.CampaignFinanceContributionRow, (analytics.contributions.id, 1)
    )
    row.amount = Decimal("99999999999999.9999")
    finance_db.commit()
    expected = _reference_records(finance_db, election_key=KEY)
    actual = reads.records(finance_db, election_key=KEY, limit=1)
    assert actual["rows"] == expected["rows"][:1]
    assert actual["rows"][0]["fields"]["Amount"] == "99999999999999.9999"
    full = reads.export(finance_db, election_key=KEY)
    assert len(expected["rows"]) > len(actual["rows"])
    assert len(__import__("json").loads(full[0])["rows"]) == len(expected["rows"])


def test_missing_off_page_row_still_fails_global_guard(finance_db, analytics):
    row = finance_db.get(
        m.CampaignFinanceContributionRow, (analytics.contributions.id, 2)
    )
    finance_db.delete(row)
    finance_db.commit()
    with pytest.raises(HTTPException) as error:
        reads.records(finance_db, election_key=KEY, limit=1, offset=1000)
    assert error.value.status_code == 503


def test_record_page_retains_fresh_source_checks(finance_db, analytics, monkeypatch):
    store = analytics.retained_store
    original = store.get
    calls = []

    def get(key, path, *, max_bytes=None):
        calls.append((key, max_bytes))
        return original(key, path, max_bytes=max_bytes)

    monkeypatch.setattr(store, "get", get)
    first = reads.records(finance_db, election_key=KEY, limit=1)
    assert len(calls) == len({key for key, _ in calls}) == 5
    assert all(cap is not None and cap > 0 for _, cap in calls)
    calls.clear()
    reads.records(
        finance_db,
        election_key=KEY,
        version=first["version"],
        snapshot_id=first["snapshot_id"],
        limit=1,
        offset=1000,
    )
    assert len(calls) == len({key for key, _ in calls}) == 5


def test_record_page_does_not_refresh_source_pointer_for_fields(
    finance_db, analytics, monkeypatch
):
    original = reads._build

    def build(*args, **kwargs):
        result = original(*args, **kwargs)

        def refreshed(*args, **kwargs):
            pytest.fail("Page fields looked up a new current release")

        monkeypatch.setattr(reads.committee_finance, "current_release", refreshed)
        return result

    monkeypatch.setattr(reads, "_build", build)
    answer = reads.records(finance_db, election_key=KEY, limit=1)
    assert answer["rows"][0]["source"]["snapshot_id"] == str(analytics.contributions.id)
    assert answer["rows"][0]["fields"]


def test_record_page_keeps_complete_json_and_csv_export(finance_db, analytics):
    before = [
        reads.export(finance_db, election_key=KEY, format=format)
        for format in ("json", "csv")
    ]
    reads.records(finance_db, election_key=KEY, race_id=RACE, limit=1)
    assert before == [
        reads.export(finance_db, election_key=KEY, format=format)
        for format in ("json", "csv")
    ]
