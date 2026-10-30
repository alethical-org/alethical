"""Finance's real access check leaves each money request free to pin its reads.

The usual Finance fixtures reuse a connection with setup queries already in its
transaction. These tests commit setup, then let the real ``get_db`` dependency
open and close a fresh request session, as production does.
"""

import hashlib
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import delete, event, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from alethical.api.auth import get_auth_service
from alethical.api.services import (
    committee_finance,
    finance_access,
    finance_connections,
)
from alethical.api.services.auth import AuthenticatedPrincipal
from alethical.db import models as m
from alethical.db.session import get_engine, get_session_factory
from alethical.tests.test_campaign_finance_landing_reads import _published_release
from alethical.tests.test_identity_confirmations import gift


@pytest.fixture()
def committed_snapshot_access(client, monkeypatch):
    """Only synthetic rows are committed; cleanup removes those exact rows."""
    subject = uuid.uuid4()
    snapshot_id = uuid.uuid4()
    email = f"snapshot-{subject.hex}@example.test"
    digest = hashlib.sha256(snapshot_id.bytes).hexdigest()
    factory = get_session_factory()
    try:
        with factory.begin() as db:
            db.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
            db.execute(
                text("""CREATE TABLE IF NOT EXISTS auth.users (
                    id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
                    deleted_at timestamptz, banned_until timestamptz,
                    is_anonymous boolean NOT NULL DEFAULT false)""")
            )
            db.execute(
                text("""INSERT INTO auth.users (id, email, email_confirmed_at)
                        VALUES (:id, :email, CURRENT_TIMESTAMP)"""),
                {"id": subject, "email": email},
            )
            finance_access.grant(db, email, team=False)
            db.add(
                m.CampaignFinanceSnapshot(
                    id=snapshot_id,
                    dataset=m.CampaignFinanceDataset.contributions,
                    download_id="-1811203041",
                    source_url="https://cfb.mn.gov/reports/synthetic-snapshot.csv",
                    content_hash=digest,
                    byte_size=1,
                    row_count=1,
                    status=m.CampaignFinanceSnapshotStatus.loaded,
                )
            )

        class Provider:
            def authenticate(self, token):
                if token != "snapshot-test-token":
                    raise ValueError("Invalid test token")
                # The real access check must use auth.users, not this token's
                # untrusted address or its absent email confirmation.
                return AuthenticatedPrincipal(
                    provider="supabase",
                    provider_subject=str(subject),
                    email="unlisted@example.test",
                    email_verified=False,
                )

        monkeypatch.setitem(
            client.app.dependency_overrides, get_auth_service, lambda: Provider()
        )
        yield snapshot_id
    finally:
        with factory.begin() as db:
            db.execute(
                delete(m.CampaignFinanceSnapshot).where(
                    m.CampaignFinanceSnapshot.id == snapshot_id
                )
            )
            db.execute(
                delete(m.FinanceAccessEntry).where(m.FinanceAccessEntry.email == email)
            )
            db.execute(text("DELETE FROM auth.users WHERE id = :id"), {"id": subject})


@pytest.mark.parametrize(
    ("path", "params"),
    [
        ("/api/v1/finance/employers", {"q": "Example"}),
        ("/api/v1/finance/connections", {"relationship": "contributions"}),
    ],
    ids=("employers", "connections"),
)
def test_finance_read_pins_after_access_and_ends_its_transaction(
    client, committed_snapshot_access, monkeypatch, path, params
):
    snapshot_id = committed_snapshot_access
    factory = get_session_factory()
    source_value = select(m.CampaignFinanceSnapshot.row_count).where(
        m.CampaignFinanceSnapshot.id == snapshot_id
    )
    observations = []
    request_sessions = []

    def probe_release(db):
        # Replace only the source read. The route, access check, request session
        # and pin all run normally. Scalar queries avoid an ORM identity cache
        # accidentally making an unpinned transaction look stable.
        request_sessions.append(db)
        isolation = db.scalar(text("SHOW transaction_isolation"))
        before = db.scalar(source_value)
        with factory.begin() as publisher:
            publisher.execute(
                update(m.CampaignFinanceSnapshot)
                .where(m.CampaignFinanceSnapshot.id == snapshot_id)
                .values(row_count=2)
            )
        after = db.scalar(source_value)
        observations.append((isolation, before, after))
        return None

    monkeypatch.setattr(committee_finance, "current_release", probe_release)
    response = client.get(
        path, params=params, headers={"Authorization": "Bearer snapshot-test-token"}
    )
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert observations == [("repeatable read", 1, 1)]
    assert len(request_sessions) == 1
    assert not request_sessions[0].in_transaction()
    with factory() as next_request:
        assert (
            next_request.scalar(text("SHOW transaction_isolation")) == "read committed"
        )
        assert next_request.scalar(source_value) == 2


@pytest.fixture()
def committed_graph(committed_snapshot_access):
    factory = get_session_factory()
    with factory() as db:
        previous = db.scalar(text("SELECT release_id FROM cf_current_release"))
        release = _published_release(db)
        release_id = release.id
        snapshots = [
            release.contributions_snapshot_id,
            release.expenditures_snapshot_id,
            release.independent_expenditures_snapshot_id,
        ]
        db.add(gift(snapshots[0], 1, amount=Decimal("250")))
        db.execute(
            update(m.CampaignFinanceSnapshot)
            .where(m.CampaignFinanceSnapshot.id == snapshots[0])
            .values(row_count=1)
        )
        db.commit()
    try:
        yield snapshots[0]
    finally:
        with factory.begin() as db:
            db.execute(
                text("UPDATE cf_current_release SET release_id = :id"), {"id": previous}
            )
            db.execute(
                delete(m.CampaignFinanceContributionRow).where(
                    m.CampaignFinanceContributionRow.snapshot_id == snapshots[0]
                )
            )
            db.execute(
                delete(m.CampaignFinanceRelease).where(
                    m.CampaignFinanceRelease.id == release_id
                )
            )
            db.execute(
                delete(m.CampaignFinanceSnapshot).where(
                    m.CampaignFinanceSnapshot.id.in_(snapshots)
                )
            )


def test_graph_keys_and_amounts_survive_source_pruning_in_one_request(
    client, committed_graph, monkeypatch
):
    original = finance_connections._money_page
    observations = []

    def prune_then_total(db, *args, **kwargs):
        observations.append(db.scalar(text("SHOW transaction_isolation")))
        with get_session_factory().begin() as publisher:
            publisher.execute(
                delete(m.CampaignFinanceContributionRow).where(
                    m.CampaignFinanceContributionRow.snapshot_id == committed_graph
                )
            )
        return original(db, *args, **kwargs)

    monkeypatch.setattr(finance_connections, "_money_page", prune_then_total)
    headers = {"Authorization": "Bearer snapshot-test-token"}
    params = {"relationship": "contributions"}
    response = client.get("/api/v1/finance/connections", params=params, headers=headers)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert observations == ["repeatable read"]
    assert data["total"] == len(data["edges"]) == 1
    assert Decimal(data["edges"][0]["amount"]) == Decimal("250")
    assert data["edges"][0]["source"]["snapshot_id"] == str(committed_graph)
    later = client.get("/api/v1/finance/connections", params=params, headers=headers)
    assert later.status_code == 200
    assert later.json()["data"]["state"] == "unavailable"
    assert later.json()["data"]["edges"] == []


def test_graph_second_query_failure_releases_budget_on_same_connection(
    committed_graph, monkeypatch
):
    original = finance_connections._money_page
    settings = text(
        "SELECT current_setting('work_mem'), current_setting('hash_mem_multiplier'), current_setting('max_parallel_workers_per_gather')"
    )
    lock = text("SELECT pg_try_advisory_xact_lock(4606286, 1)")
    keys = []

    def observe(conn, cursor, statement, parameters, context, executemany):
        if "graph_keys AS" in statement:
            keys.append(True)

    def fail_metrics(db, *args, **kwargs):
        assert keys == [True]
        db.execute(text("SELECT 1 / 0"))

    with get_engine().connect() as connection:
        previous = connection.execute(settings).one()
        connection.rollback()
        event.listen(connection, "before_cursor_execute", observe)
        monkeypatch.setattr(finance_connections, "_money_page", fail_metrics)
        try:
            with Session(bind=connection) as db:
                with pytest.raises(DBAPIError) as failure:
                    finance_connections.connections(db, relationship="contributions")
                assert failure.value.orig.sqlstate == "22012"
                db.rollback()
        finally:
            event.remove(connection, "before_cursor_execute", observe)
        with Session(bind=connection) as fresh:
            assert fresh.execute(settings).one() == previous
        with get_engine().connect() as competing:
            assert competing.scalar(lock)
        monkeypatch.setattr(finance_connections, "_money_page", original)
        with Session(bind=connection) as fresh:
            data = finance_connections.connections(fresh, relationship="contributions")
            assert data["total"] == len(data["edges"]) == 1
            assert Decimal(data["edges"][0]["amount"]) == Decimal("250")
            assert fresh.execute(settings).one() == previous
