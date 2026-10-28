"""A signed-in, listed Finance account for endpoint tests.

Supabase's own account table is created in the test's transaction, the account is
listed, and every request through ``finance_api`` carries its token. Nothing
escapes the transaction.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.api.auth import get_auth_service
from alethical.api.services import finance_access
from alethical.api.services.auth import AuthenticatedPrincipal
from alethical.db.session import get_db, get_engine

FINANCE_SUBJECT = str(uuid.UUID(int=201))
FINANCE_EMAIL = "finance-reader@example.test"
FINANCE_TOKEN = "finance-reader-token"


class _ListedAccount:
    def authenticate(self, token):
        if token != FINANCE_TOKEN:
            raise ValueError("Invalid test token")
        return AuthenticatedPrincipal(
            provider="supabase",
            provider_subject=FINANCE_SUBJECT,
            email=FINANCE_EMAIL,
            email_verified=True,
        )


@pytest.fixture()
def finance_db(seed_database):
    with get_engine().connect() as connection:
        transaction = connection.begin()
        with Session(
            bind=connection, join_transaction_mode="create_savepoint"
        ) as session:
            session.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
            session.execute(
                text("""CREATE TABLE IF NOT EXISTS auth.users (
                id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
                deleted_at timestamptz, banned_until timestamptz,
                is_anonymous boolean NOT NULL DEFAULT false)""")
            )
            session.execute(
                text("""INSERT INTO auth.users (id, email, email_confirmed_at)
                VALUES (:id, :email, CURRENT_TIMESTAMP)"""),
                {"id": FINANCE_SUBJECT, "email": FINANCE_EMAIL},
            )
            finance_access.grant(session, FINANCE_EMAIL, team=False)
            yield session
        transaction.rollback()


@pytest.fixture()
def finance_api(client, finance_db):
    client.app.dependency_overrides[get_db] = lambda: finance_db
    client.app.dependency_overrides[get_auth_service] = lambda: _ListedAccount()
    client.headers["Authorization"] = f"Bearer {FINANCE_TOKEN}"
    return client
