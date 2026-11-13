"""Expense routes must work with the fresh sessions real requests receive."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from alethical.api.finance_access import require_finance_access
from alethical.api.main import create_app
from alethical.db.session import get_db, get_engine


@pytest.mark.parametrize(
    ("suffix", "params"),
    [
        ("", {}),
        ("", {"view": "payees"}),
        ("/payees", {}),
        ("/payments", {}),
        ("/export", {"format": "json"}),
        ("/export", {"format": "csv"}),
    ],
)
def test_expense_routes_pin_a_fresh_request_before_reading(
    seed_database, suffix, params
):
    app = create_app()
    levels = []

    def request_db():
        with Session(get_engine()) as db:
            assert not db.in_transaction()
            try:
                yield db
            finally:
                levels.append(db.connection().get_isolation_level())

    app.dependency_overrides[get_db] = request_db
    app.dependency_overrides[require_finance_access] = lambda: object()
    if suffix:
        params = {"snapshot_id": "a" * 64, "version": "b" * 16, **params}
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/finance/elections/mn-2026-11-03-general/analytics/expenses"
            + suffix,
            params=params,
        )
    # This fresh database has no election. A normal missing-record answer must
    # not become a 503 because an earlier query opened READ COMMITTED.
    assert response.status_code == 404, response.text
    assert levels == ["REPEATABLE READ"]
