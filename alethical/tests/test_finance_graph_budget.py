"""Broad graph reads share one bounded database budget, never another request's."""

# ruff: noqa: F811
from datetime import UTC, datetime

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from alethical.api.services import finance_connections as graph
from alethical.db.session import get_engine
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_identity_confirmations import board  # noqa: F401

BASE = "/api/v1/finance/connections"
LOCK = "SELECT pg_try_advisory_xact_lock(4606286, 1)"
SETTINGS = "SELECT current_setting('work_mem'), current_setting('hash_mem_multiplier'), current_setting('max_parallel_workers_per_gather')"


def test_success_keeps_its_existing_timestamp_encoding_and_response_schema(
    finance_api, monkeypatch
):
    monkeypatch.setattr(
        graph,
        "connections",
        lambda *args, **kwargs: {"copied_at": datetime(2026, 10, 29, tzinfo=UTC)},
    )
    response = finance_api.get(BASE)
    assert response.status_code == 200
    assert response.json() == {"data": {"copied_at": "2026-10-29T00:00:00Z"}}
    success = finance_api.app.openapi()["paths"][BASE]["get"]["responses"]["200"]
    assert success["content"]["application/json"]["schema"]["type"] == "object"


def test_competing_broad_graph_is_private_busy_and_retries_after_release(
    finance_api, finance_db, board, monkeypatch
):
    reports = []
    monkeypatch.setattr(
        "alethical.api.problems.capture_operational_error",
        lambda *args, **kwargs: reports.append(args),
    )
    finance_db.connection()
    with get_engine().connect() as owner:
        assert owner.scalar(text(LOCK))
        response = finance_api.get(BASE, params={"q": "  ", "focus": ""})
        assert response.status_code == 503
        assert response.headers["retry-after"] == "10"
        assert "private" in response.headers["cache-control"]
        assert "no-store" in response.headers["cache-control"]
        assert "Authorization" in response.headers["vary"]
        assert response.json()["type"].endswith("/service-busy")
        assert "data" not in response.json()
        assert not reports
        owner.rollback()
    # The fixture keeps setup in an outer transaction; reconnect the request
    # session after access-check cleanup, as the existing graph helper does.
    finance_db.connection()
    response = finance_api.get(BASE)
    assert response.status_code == 200 and response.json()["data"]["edges"]


@pytest.mark.parametrize(
    "params",
    [
        {"q": "Example"},
        {"focus": "committee:90001"},
        {"year": 2026},
        {"relationship": "lobbying_representation"},
    ],
)
def test_filtered_and_nonmoney_reads_do_not_wait_for_broad_graph(
    finance_api, finance_db, board, params
):
    previous = finance_db.execute(text(SETTINGS)).one()
    with get_engine().connect() as owner:
        assert owner.scalar(text(LOCK))
        assert finance_api.get(BASE, params=params).status_code == 200
    assert finance_db.execute(text(SETTINGS)).one() == previous


@pytest.mark.parametrize(
    "finish", ["commit", "rollback", "sql_failure", "python_failure"]
)
def test_transaction_end_releases_budget_and_connection_settings(seed_database, finish):
    # Reuse one real database connection across two request sessions, so a reset
    # cannot pass merely because the pool handed the next request another one.
    with get_engine().connect() as connection:
        original = connection.execute(text(SETTINGS)).one()
        connection.rollback()
        with Session(bind=connection) as db:
            if finish == "sql_failure":
                with pytest.raises(DBAPIError) as failure:
                    with graph._hash_budget(db, True):
                        db.execute(text("SELECT 1 / 0"))
                assert failure.value.orig.sqlstate == "22012"
                db.rollback()
            elif finish == "python_failure":
                with pytest.raises(ValueError, match="render failure"):
                    with graph._hash_budget(db, True):
                        raise ValueError("render failure")
                assert db.execute(text(SETTINGS)).one() == original
                db.rollback()
            else:
                with graph._hash_budget(db, True):
                    assert (
                        db.scalar(text("SELECT current_setting('hash_mem_multiplier')"))
                        == "8"
                    )
                    with get_engine().connect() as competing:
                        assert not competing.scalar(text(LOCK))
                assert db.execute(text(SETTINGS)).one() == original
                getattr(db, finish)()
        with Session(bind=connection) as next_request:
            assert next_request.execute(text(SETTINGS)).one() == original
        with get_engine().connect() as competing:
            assert competing.scalar(text(LOCK))


@pytest.mark.parametrize(
    "work,workers,expected",
    [("4MB", "2", ("3500kB", "8", "1")), ("1MB", "0", ("1MB", "8", "0"))],
)
def test_budget_is_capped_during_query_and_restored_afterward(
    finance_api, finance_db, board, work, workers, expected
):
    finance_db.execute(
        text(
            "SELECT set_config('work_mem',:work,true),"
            "set_config('hash_mem_multiplier','2',true),"
            "set_config('max_parallel_workers_per_gather',:workers,true)"
        ),
        {"work": work, "workers": workers},
    )
    previous = finance_db.execute(text(SETTINGS)).one()
    connection = finance_db.connection()
    observed = []

    def inspect_budget(conn, cursor, statement, parameters, context, executemany):
        if "money_groups AS" in statement:
            observed.append(tuple(conn.execute(text(SETTINGS)).one()))

    event.listen(connection, "before_cursor_execute", inspect_budget)
    try:
        response = finance_api.get(BASE)
    finally:
        event.remove(connection, "before_cursor_execute", inspect_budget)
    assert response.status_code == 200
    assert observed == [expected]
    assert finance_db.execute(text(SETTINGS)).one() == previous
