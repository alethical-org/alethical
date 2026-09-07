"""Exercise the production account SQL against an isolated real Postgres database."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.api.routers.admin import administrator_access
from alethical.api.services.admin_accounts import load_reader_accounts
from alethical.api.services.auth import AuthenticatedPrincipal
from scripts.check_schema_drift import ScratchDatabase, _local_base_url


@pytest.fixture(scope="module", autouse=True)
def seed_database():
    """This module owns its scratch database and never seeds the worktree database."""


def test_current_account_sql_excludes_ineligible_and_linked_team_accounts(monkeypatch):
    now = datetime.now(timezone.utc)
    admin_id, reader_id, linked_id, pending_id, team_id = [uuid4() for _ in range(5)]
    monkeypatch.setenv("ALETHICAL_ADMIN_ACCOUNT_IDS", str(admin_id))
    monkeypatch.delenv("TRAFFIC_EXCLUDED_ACCOUNT_IDS", raising=False)
    monkeypatch.delenv("ALETHICAL_TEST_ACCOUNT_IDS", raising=False)

    class VerifiedToken:
        def authenticate(self, token):
            return AuthenticatedPrincipal("supabase", str(admin_id))

        def resolve_confirmed_email(self, token, principal):
            return AuthenticatedPrincipal(
                "supabase", str(admin_id), "eug@alethical.com", True
            )

    with ScratchDatabase(_local_base_url(), "admin_account_queries") as scratch:
        engine = scratch.engine()
        try:
            with engine.begin() as conn:
                for ddl in (
                    "CREATE SCHEMA auth",
                    """CREATE TABLE auth.users (
                        id uuid PRIMARY KEY, email text, created_at timestamptz,
                        email_confirmed_at timestamptz, banned_until timestamptz,
                        deleted_at timestamptz, is_anonymous boolean DEFAULT false)""",
                    "CREATE TABLE auth.identities (user_id uuid, provider text)",
                    """CREATE TABLE public.user_account (
                        id uuid PRIMARY KEY, primary_email text, is_active boolean)""",
                    """CREATE TABLE public.auth_identity (
                        user_id uuid, provider text, provider_subject text, email text)""",
                ):
                    conn.execute(text(ddl))
                data = [
                    (admin_id, "eug@alethical.com", now, now),
                    (reader_id, "reader@public.test", now - timedelta(days=8), now),
                    (linked_id, "reader@public.test", now, now),
                    (pending_id, "pending@public.test", now, None),
                    (team_id, "angel+preview@alethical.com", now, now),
                ]
                conn.execute(
                    text("""INSERT INTO auth.users
                        (id,email,created_at,email_confirmed_at) VALUES (:id,:email,:created,:confirmed)"""),
                    [
                        {
                            "id": ident,
                            "email": email,
                            "created": created,
                            "confirmed": confirmed,
                        }
                        for ident, email, created, confirmed in data
                    ],
                )
                conn.execute(
                    text("INSERT INTO public.user_account VALUES (:id,:email,true)"),
                    [
                        {"id": admin_id, "email": "eug@alethical.com"},
                        {"id": reader_id, "email": "reader@public.test"},
                    ],
                )
                conn.execute(
                    text(
                        "INSERT INTO public.auth_identity VALUES (:user_id,'supabase',:subject,:email)"
                    ),
                    [
                        {
                            "user_id": admin_id,
                            "subject": str(admin_id),
                            "email": "eug@alethical.com",
                        },
                        {
                            "user_id": reader_id,
                            "subject": str(reader_id),
                            "email": "reader@public.test",
                        },
                        {
                            "user_id": reader_id,
                            "subject": str(linked_id),
                            "email": "reader@public.test",
                        },
                    ],
                )
                conn.execute(
                    text(
                        "INSERT INTO auth.identities VALUES (:id,'google'),(:linked,'email')"
                    ),
                    {"id": reader_id, "linked": linked_id},
                )
                db = Session(bind=conn)
                assert administrator_access(
                    "Bearer fake-signed-token", VerifiedToken(), db
                )
                readers = load_reader_accounts(db)
                assert {row.id for row in readers} == {str(reader_id), str(pending_id)}
                reader = next(row for row in readers if row.id == str(reader_id))
                assert reader.created_at == now - timedelta(days=8)
                assert reader.sign_in_methods == ("email", "google")

                # Every current-state disqualifier independently revokes a formerly
                # valid token. No token is created or used against a live provider.
                for assignment in (
                    "banned_until = CURRENT_TIMESTAMP + interval '1 day'",
                    "deleted_at = CURRENT_TIMESTAMP",
                    "is_anonymous = true",
                    "email_confirmed_at = NULL",
                    "email = 'changed@public.test'",
                ):
                    with conn.begin_nested() as checkpoint:
                        conn.execute(
                            text(f"UPDATE auth.users SET {assignment} WHERE id=:id"),
                            {"id": admin_id},
                        )
                        assert not administrator_access(
                            "Bearer fake-signed-token", VerifiedToken(), db
                        )
                        checkpoint.rollback()
                conn.execute(
                    text("UPDATE public.user_account SET is_active=false WHERE id=:id"),
                    {"id": admin_id},
                )
                assert not administrator_access(
                    "Bearer fake-signed-token", VerifiedToken(), db
                )

                # A team identity hides its entire product account, including an
                # otherwise ordinary linked address and all its login methods.
                conn.execute(
                    text(
                        "INSERT INTO public.auth_identity VALUES (:user_id,'supabase',:subject,:email)"
                    ),
                    {
                        "user_id": reader_id,
                        "subject": str(team_id),
                        "email": "angel+preview@alethical.com",
                    },
                )
                assert [row.id for row in load_reader_accounts(db)] == [str(pending_id)]
        finally:
            engine.dispose()
