"""Finance's code request sends only to listed addresses and answers alike."""

from __future__ import annotations

import httpx
import pytest
from sqlalchemy.orm import Session

from alethical.api.services import finance_access
from alethical.api.services import finance_sign_in
from alethical.db.session import get_db, get_engine

CODE = "/api/v1/finance/sign-in/code"
LISTED = "listed-reader@example.test"
REVOKED = "revoked-reader@example.test"
RETURN = "https://finance.example.test/auth/confirm?source=email"


@pytest.fixture()
def db(seed_database):
    with get_engine().connect() as connection:
        transaction = connection.begin()
        with Session(
            bind=connection, join_transaction_mode="create_savepoint"
        ) as session:
            finance_access.grant(session, LISTED, team=False)
            finance_access.grant(session, REVOKED, team=False)
            finance_access.revoke(session, REVOKED)
            yield session
        transaction.rollback()


@pytest.fixture()
def sent(monkeypatch):
    calls = []
    monkeypatch.setattr(finance_sign_in, "RECENT", finance_sign_in._RecentRequests())
    monkeypatch.setattr(finance_sign_in, "_send", lambda *args: calls.append(args))
    monkeypatch.setenv("SUPABASE_URL", "https://project.example.test/")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setenv("ALETHICAL_FINANCE_SIGN_IN_RETURN_URL", RETURN)
    return calls


@pytest.fixture()
def api(client, db, sent):
    client.app.dependency_overrides[get_db] = lambda: db
    return client


def ask(api, email, ip="203.0.113.7"):
    return api.post(CODE, json={"email": email}, headers={"X-Forwarded-For": ip})


def test_a_listed_address_gets_a_code_request_and_an_unlisted_one_does_not(api, sent):
    listed = ask(api, " Listed-Reader@Example.test ")
    unlisted = ask(api, "unlisted@example.test")
    revoked = ask(api, REVOKED)
    assert listed.status_code == unlisted.status_code == revoked.status_code == 202
    assert listed.json() == unlisted.json() == revoked.json()
    assert "no-store" in unlisted.headers["cache-control"]
    assert sent == [
        ("https://project.example.test", "sb_publishable_test", RETURN, LISTED)
    ]


def test_a_repeat_inside_the_resend_wait_sends_nothing_more(api, sent):
    assert ask(api, LISTED).status_code == 202
    assert ask(api, LISTED).status_code == 202
    assert len(sent) == 1


def test_a_value_that_cannot_be_an_address_is_refused_for_everyone(api, sent):
    response = ask(api, "not-an-address")
    assert response.status_code == 422
    assert sent == []


@pytest.mark.parametrize(
    "return_url", ["", "http://finance.example.test/", "ftp://finance.example.test/"]
)
def test_without_a_safe_return_address_no_code_is_sent_to_anyone(
    api, sent, monkeypatch, return_url
):
    monkeypatch.setenv("ALETHICAL_FINANCE_SIGN_IN_RETURN_URL", return_url)
    assert ask(api, LISTED).status_code == 503
    assert ask(api, "unlisted@example.test").status_code == 503
    assert sent == []


def test_a_local_return_address_works_for_development(api, sent, monkeypatch):
    monkeypatch.setenv(
        "ALETHICAL_FINANCE_SIGN_IN_RETURN_URL", "http://localhost:5174/auth/confirm"
    )
    assert ask(api, LISTED).status_code == 202
    assert len(sent) == 1


def test_requests_from_1_address_are_limited(api, sent):
    for _ in range(10):
        assert ask(api, "unlisted@example.test").status_code == 202
    assert ask(api, "unlisted@example.test").status_code == 429


def test_the_supabase_request_asks_for_a_code_and_never_raises(monkeypatch):
    captured = {}

    def post(url, **kwargs):
        captured.update(url=url, **kwargs)
        return httpx.Response(500)

    monkeypatch.setattr(finance_sign_in.httpx, "post", post)
    finance_sign_in._send("https://project.example.test", "key", RETURN, LISTED)
    assert captured["url"] == "https://project.example.test/auth/v1/otp"
    assert captured["params"] == {"redirect_to": RETURN}
    assert captured["headers"]["apikey"] == "key"
    assert captured["json"] == {"email": LISTED, "create_user": True}

    def unreachable(url, **kwargs):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(finance_sign_in.httpx, "post", unreachable)
    finance_sign_in._send("https://project.example.test", "key", RETURN, LISTED)
