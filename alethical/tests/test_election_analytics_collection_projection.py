"""Account evidence needs collection roles, not the full report inventory."""

# Imported fixtures are intentionally rebound by pytest.
# ruff: noqa: F401,F811

from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import InvalidRequestError

from alethical.api.services import election_analytics as reads
from alethical.db import models as m
from alethical.tests.finance_fixtures import finance_db
from alethical.tests.test_election_analytics import analytics
from alethical.tests.test_election_comparison_reads import KEY, RACE, SOURCE
from alethical.tests.test_election_finance_reads import COLLECTION, comparison
from alethical.tests.test_election_outside_spending import spending


def _collection_query(query):
    return query.column_descriptions[0]["entity"] is m.ElectionFinanceCollection


@pytest.mark.parametrize("verify_originals", [False, True])
def test_account_collection_query_omits_report_inventory_and_preserves_output(
    finance_db, analytics, comparison, monkeypatch, verify_originals
):
    statements = []
    loaded = []

    for row in list(finance_db.identity_map.values()):
        if isinstance(row, m.ElectionFinanceCollection):
            finance_db.expunge(row)

    def capture_collection(session, instance):
        if isinstance(instance, m.ElectionFinanceCollection):
            loaded.append(instance)

    def capture(conn, cursor, statement, parameters, context, many):
        if "FROM election_finance_collection" in statement:
            statements.append(" ".join(statement.split()))

    connection = finance_db.connection()
    event.listen(connection, "before_cursor_execute", capture)
    event.listen(finance_db, "loaded_as_persistent", capture_collection)
    try:
        actual = reads._bulk_accounts(
            finance_db, KEY, [comparison["race"]], verify_originals=verify_originals
        )
    finally:
        event.remove(connection, "before_cursor_execute", capture)
        event.remove(finance_db, "loaded_as_persistent", capture_collection)
    assert len(statements) == 1
    projection = statements[0].split(" FROM ", 1)[0]
    for field in ("id", "election_key", "first_published_at", "sources"):
        assert f"election_finance_collection.{field}" in projection
    for field in ("report_index", "coverage", "copied_at", "sealed_at"):
        assert f"election_finance_collection.{field}" not in projection
    assert len(loaded) == 1
    with pytest.raises(InvalidRequestError, match="raiseload=True"):
        _ = loaded[0].report_index

    original_scalars = finance_db.scalars

    def full_collection(query, *args, **kwargs):
        if _collection_query(query):
            query = select(m.ElectionFinanceCollection).where(
                m.ElectionFinanceCollection.id == COLLECTION
            )
        return original_scalars(query, *args, **kwargs)

    monkeypatch.setattr(finance_db, "scalars", full_collection)
    assert actual == reads._bulk_accounts(
        finance_db, KEY, [comparison["race"]], verify_originals=verify_originals
    )
    account = actual[0][(RACE, "a")]["accounts"][0]
    evidence = next(
        e for e in account["evidence"] if e.get("collection_id") == COLLECTION
    )
    url = urlsplit(evidence["retained_source_url"])
    assert url.path == f"/api/v1/finance/elections/{KEY}/finance/sources/{SOURCE}/raw"
    assert parse_qs(url.query) == {"collection_id": [COLLECTION]}


@pytest.mark.parametrize("damage", ["missing", "unpublished", "source_role"])
@pytest.mark.parametrize("verify_originals", [False, True])
def test_projected_collection_still_requires_held_published_source_role(
    finance_db, analytics, comparison, monkeypatch, damage, verify_originals
):
    before = reads._bulk_accounts(
        finance_db, KEY, [comparison["race"]], verify_originals=verify_originals
    )
    collection = finance_db.get(m.ElectionFinanceCollection, COLLECTION)
    projected = SimpleNamespace(
        id=collection.id,
        election_key=collection.election_key,
        first_published_at=None
        if damage == "unpublished"
        else collection.first_published_at,
        sources=[] if damage == "source_role" else collection.sources,
    )
    original_scalars = finance_db.scalars

    def damaged_collection(query, *args, **kwargs):
        if _collection_query(query):
            return [] if damage == "missing" else [projected]
        return original_scalars(query, *args, **kwargs)

    monkeypatch.setattr(finance_db, "scalars", damaged_collection)
    after = reads._bulk_accounts(
        finance_db, KEY, [comparison["race"]], verify_originals=verify_originals
    )
    assert before[0][(RACE, "a")]["accounts"]
    assert after[0][(RACE, "a")]["accounts"] == []
    assert after[0][(RACE, "a")]["gaps"] == [
        {"registration_number": "-101", "state": "sources_unavailable"}
    ]
    if verify_originals:
        assert before[1] != after[1]
    else:
        # Relationship-only planning makes no original-proof claim.
        assert all(
            value is None for _, availability in after[1] for value in availability
        )
