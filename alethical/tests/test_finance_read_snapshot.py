"""Finance's real access check leaves each money request free to pin its reads.

The usual Finance fixtures reuse a connection with setup queries already in its
transaction. These tests commit setup, then let the real ``get_db`` dependency
open and close a fresh request session, as production does.
"""

import hashlib
import uuid

import pytest
from sqlalchemy import delete, select, text, update

from alethical.api.auth import get_auth_service
from alethical.api.services import committee_finance, finance_access
from alethical.api.services.auth import AuthenticatedPrincipal
from alethical.db import models as m
from alethical.db.session import get_session_factory


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
