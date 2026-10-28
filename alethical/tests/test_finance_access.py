"""Alethical Finance's access list and the check every Finance endpoint uses."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from alethical.api import finance_access as dependency
from alethical.api.auth import get_auth_service
from alethical.api.services import finance_access
from alethical.api.services.auth import AuthenticatedPrincipal
from alethical.db.session import get_db, get_engine
from scripts import finance_access as script

ACCESS = "/api/v1/finance/access"
CLIENT = "client-reader@example.test"
TEAM = "team-reader@example.test"

# Bearer token -> (Supabase subject, address in Supabase's own records).
ACCOUNTS = {
    "client": (str(uuid.UUID(int=101)), CLIENT),
    "team": (str(uuid.UUID(int=102)), TEAM),
    "unlisted": (str(uuid.UUID(int=103)), "unlisted@example.test"),
}


@pytest.fixture()
def db(seed_database):
    # Route handlers commit or roll back; neither should escape this test.
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
            for subject, email in ACCOUNTS.values():
                session.execute(
                    text("""INSERT INTO auth.users (id, email, email_confirmed_at)
                    VALUES (:id, :email, CURRENT_TIMESTAMP)"""),
                    {"id": subject, "email": email},
                )
            finance_access.grant(session, CLIENT, team=False)
            finance_access.grant(session, TEAM, team=True)
            yield session
        transaction.rollback()


class FakeSupabase:
    def authenticate(self, token):
        if token not in ACCOUNTS:
            raise ValueError("Invalid test token")
        subject, _ = ACCOUNTS[token]
        # The token's own email claim is deliberately wrong: access must come
        # from Supabase's account record, never from the token or a profile.
        return AuthenticatedPrincipal(
            provider="supabase",
            provider_subject=subject,
            email=CLIENT,
            email_verified=True,
        )


@pytest.fixture()
def api(client, db):
    client.app.dependency_overrides[get_db] = lambda: db
    client.app.dependency_overrides[get_auth_service] = lambda: FakeSupabase()
    return client


def bearer(name):
    return {"Authorization": f"Bearer {name}"}


def assert_private(response):
    assert "no-store" in response.headers["cache-control"]
    assert "private" in response.headers["cache-control"]


def assert_no_access(response):
    assert response.status_code == 403, response.text
    assert_private(response)
    payload = response.json()
    assert payload["type"].endswith("finance-no-access")
    assert payload["detail"] == dependency.NO_ACCESS_DETAIL


def test_listed_client_and_team_accounts_get_the_same_answer(api):
    client_response = api.get(ACCESS, headers=bearer("client"))
    team_response = api.get(ACCESS, headers=bearer("team"))
    assert client_response.status_code == team_response.status_code == 200
    assert client_response.json() == team_response.json() == {"data": {"allowed": True}}
    assert_private(client_response)
    assert "team" not in client_response.text.lower()


@pytest.mark.parametrize(
    "headers", [{}, {"Authorization": "Token abc"}, {"Authorization": "Bearer  "}]
)
def test_signed_out_requests_are_asked_to_sign_in(api, headers):
    response = api.get(ACCESS, headers=headers)
    assert response.status_code == 401
    assert_private(response)


def test_an_invalid_token_is_asked_to_sign_in_again(api):
    response = api.get(ACCESS, headers=bearer("forged"))
    assert response.status_code == 401
    assert response.json()["detail"] == "Sign in again to continue."


@pytest.mark.parametrize("error", [KeyError("exp"), TypeError("claims")])
def test_a_token_the_provider_cannot_read_is_asked_to_sign_in_again(api, error):
    def unreadable(token):
        raise error

    api.app.dependency_overrides[get_auth_service] = lambda: SimpleNamespace(
        authenticate=unreadable
    )
    response = api.get(ACCESS, headers=bearer("client"))
    assert response.status_code == 401
    assert response.json()["detail"] == "Sign in again to continue."


def test_a_sign_in_service_outage_is_unavailable(api):
    def down(token):
        raise RuntimeError("Supabase unreachable")

    api.app.dependency_overrides[get_auth_service] = lambda: SimpleNamespace(
        authenticate=down
    )
    response = api.get(ACCESS, headers=bearer("client"))
    assert response.status_code == 503
    assert_private(response)


def test_an_unexpected_failure_stays_private(api, monkeypatch):
    def broken(*args):
        raise TypeError("unexpected")

    monkeypatch.setattr(dependency, "supabase_account_access", broken)
    response = TestClient(api.app, raise_server_exceptions=False).get(
        ACCESS, headers=bearer("client")
    )
    assert response.status_code == 500
    assert_private(response)
    assert response.headers["x-robots-tag"] == "noindex, nofollow"


def test_an_unlisted_account_gets_the_no_access_answer(api):
    assert_no_access(api.get(ACCESS, headers=bearer("unlisted")))


@pytest.mark.parametrize("account", ["client", "team"])
def test_revocation_applies_on_the_next_request(api, db, account):
    _, email = ACCOUNTS[account]
    assert api.get(ACCESS, headers=bearer(account)).status_code == 200
    finance_access.revoke(db, email)
    assert_no_access(api.get(ACCESS, headers=bearer(account)))
    finance_access.grant(db, email, team=account == "team")
    assert api.get(ACCESS, headers=bearer(account)).status_code == 200


@pytest.mark.parametrize(
    "mutation",
    [
        "UPDATE auth.users SET email_confirmed_at = NULL WHERE id = :id",
        "UPDATE auth.users SET deleted_at = CURRENT_TIMESTAMP WHERE id = :id",
        "UPDATE auth.users SET banned_until = CURRENT_TIMESTAMP + interval '1 day'"
        " WHERE id = :id",
        "UPDATE auth.users SET is_anonymous = true WHERE id = :id",
        "UPDATE auth.users SET email = replace(email, '@', '+alias@') WHERE id = :id",
        "UPDATE auth.users SET email = 'someone-else@example.test' WHERE id = :id",
        "DELETE FROM auth.users WHERE id = :id",
    ],
)
@pytest.mark.parametrize("account", ["client", "team"])
def test_an_account_supabase_no_longer_vouches_for_is_refused(
    api, db, mutation, account
):
    # The team flag decides only what alethical.com prints, never a way in.
    db.execute(text(mutation), {"id": ACCOUNTS[account][0]})
    assert_no_access(api.get(ACCESS, headers=bearer(account)))


def test_a_locked_alethical_account_is_refused(api, db):
    user_id = uuid.uuid4()
    db.execute(
        text("INSERT INTO user_account (id, is_active) VALUES (:id, false)"),
        {"id": user_id},
    )
    db.execute(
        text("""INSERT INTO auth_identity (id, user_id, provider, provider_subject)
        VALUES (:id, :user_id, 'supabase', :subject)"""),
        {"id": uuid.uuid4(), "user_id": user_id, "subject": ACCOUNTS["client"][0]},
    )
    assert_no_access(api.get(ACCESS, headers=bearer("client")))


def test_supabase_capitals_still_match_the_stored_address(api, db):
    db.execute(
        text("UPDATE auth.users SET email = upper(email) WHERE id = :id"),
        {"id": ACCOUNTS["client"][0]},
    )
    assert api.get(ACCESS, headers=bearer("client")).status_code == 200


def test_a_subject_that_is_not_a_supabase_account_id_is_refused(db):
    assert finance_access.supabase_account_access(db, "supabase-user-ada") is None


def test_an_unreadable_list_is_unavailable_not_no_access(api, monkeypatch):
    def unreadable(*args):
        raise OperationalError("SELECT", {}, Exception("down"))

    monkeypatch.setattr(dependency, "supabase_account_access", unreadable)
    response = api.get(ACCESS, headers=bearer("client"))
    assert response.status_code == 503
    assert_private(response)


def test_development_identities_never_count_against_production(api, monkeypatch):
    development = AuthenticatedPrincipal(
        provider="demo", provider_subject="ada-demo", email=CLIENT, email_verified=True
    )
    api.app.dependency_overrides[get_auth_service] = lambda: SimpleNamespace(
        authenticate=lambda token: development
    )
    assert api.get(ACCESS, headers=bearer("dev")).status_code == 200
    monkeypatch.setenv("ALETHICAL_DATABASE_TARGET", "production")
    assert_no_access(api.get(ACCESS, headers=bearer("dev")))


@pytest.mark.parametrize(
    ("raw", "stored"),
    [(" Person@Example.TEST ", "person@example.test"), ("a@b.co", "a@b.co")],
)
def test_addresses_are_stored_trimmed_and_lower_cased(raw, stored):
    assert finance_access.normalize_email(raw) == stored


@pytest.mark.parametrize(
    "raw", ["", "person", "person@", "@example.test", "a b@example.test", "a@b"]
)
def test_a_value_that_cannot_be_a_mailbox_is_refused(raw):
    with pytest.raises(ValueError):
        finance_access.normalize_email(raw)


def test_the_database_refuses_an_address_that_skipped_normalizing(db):
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.execute(
                text("INSERT INTO finance_access_entry (id, email) VALUES (:id, :e)"),
                {"id": uuid.uuid4(), "e": "Mixed@Example.test"},
            )


def test_each_address_is_listed_once(db):
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.execute(
                text("INSERT INTO finance_access_entry (id, email) VALUES (:id, :e)"),
                {"id": uuid.uuid4(), "e": CLIENT},
            )


def test_grant_revoke_and_restore_keep_1_row_with_current_dates(db):
    first = finance_access.grant(db, "New@Example.test", team=False)
    assert (first.change, first.email, first.revoked_at) == (
        "granted",
        "new@example.test",
        None,
    )
    assert finance_access.grant(db, "new@example.test", team=False).change == (
        "unchanged"
    )
    assert finance_access.grant(db, "new@example.test", team=True).change == (
        "team flag changed"
    )
    revoked = finance_access.revoke(db, "new@example.test")
    assert revoked.change == "revoked" and revoked.revoked_at is not None
    assert finance_access.revoke(db, "new@example.test").change == "already revoked"
    restored = finance_access.grant(db, "new@example.test", team=False)
    assert restored.change == "restored"
    assert restored.revoked_at is None and restored.is_alethical_team is False
    assert restored.granted_at >= revoked.revoked_at
    assert finance_access.revoke(db, "never-listed@example.test") is None
    count = db.scalar(
        text("SELECT count(*) FROM finance_access_entry WHERE email = :e"),
        {"e": "new@example.test"},
    )
    assert count == 1


def test_the_script_reads_the_address_from_its_arguments_and_reads_back(db):
    def run(*argv):
        return script.run(db, script.parse_args(list(argv)))

    code, message = run("grant", "Script@Example.test", "--team")
    assert code == 0
    assert message.startswith("script@example.test: granted; team; granted ")
    assert message.endswith("revoked active")
    code, message = run("revoke", "script@example.test")
    assert code == 0 and "revoked; team" in message
    assert "revoked active" not in message
    code, message = run("show", "script@example.test")
    assert code == 0 and message.startswith("script@example.test: read; team")
    assert run("show", "absent@example.test") == (
        1,
        "absent@example.test: not on the list",
    )


def test_the_script_reads_back_only_after_committing(db, monkeypatch):
    steps = []
    commit, read = db.commit, finance_access.read_entry
    monkeypatch.setattr(db, "commit", lambda: (steps.append("commit"), commit())[1])
    monkeypatch.setattr(
        finance_access,
        "read_entry",
        lambda *args: (steps.append("read"), read(*args))[1],
    )
    script.run(db, script.parse_args(["grant", "order@example.test", "--client"]))
    assert steps == ["commit", "read"]


@pytest.mark.parametrize(
    "argv",
    [
        ["grant", "a@b.co"],
        ["grant", "a@b.co", "--team", "--client"],
        ["grant", "--file", "list.txt"],
    ],
)
def test_a_grant_names_team_or_client_and_takes_no_file(argv):
    with pytest.raises(SystemExit):
        script.parse_args(argv)


def test_the_script_names_the_database_it_reads(db, monkeypatch, capsys):
    class Engine:
        def dispose(self):
            pass

    monkeypatch.setattr(script, "create_engine", lambda *args, **kwargs: Engine())
    monkeypatch.setattr(script, "Session", lambda engine: _Reuse(db))
    monkeypatch.delenv("ALETHICAL_DATABASE_TARGET", raising=False)
    assert script.main(["show", CLIENT]) == 0
    assert capsys.readouterr().out.startswith("Database: local (")


class _Reuse:
    def __init__(self, session):
        self.session = session

    def __enter__(self):
        return self.session

    def __exit__(self, *exc):
        return False


def test_the_script_refuses_a_bad_address_before_connecting(monkeypatch, capsys):
    def no_connection(*args, **kwargs):
        raise AssertionError("connected")

    monkeypatch.setattr(script, "create_engine", no_connection)
    assert script.main(["grant", "not-an-address", "--client"]) == 2
    assert "Not an email address." in capsys.readouterr().err


def test_dates_are_timezone_aware(db):
    entry = finance_access.read_entry(db, CLIENT)
    assert entry.granted_at.tzinfo is not None
