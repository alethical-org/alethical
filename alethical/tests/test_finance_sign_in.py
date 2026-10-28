"""Finance's emailed codes: sent by Alethical, only to listed addresses, answered alike."""

from __future__ import annotations

import re
import time
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from alethical.api.routers import finance_sign_in as route
from alethical.api.services import finance_access
from alethical.api.services import finance_sign_in
from alethical.db.models import FinanceSignInCode
from alethical.db.session import get_db, get_engine

CODE = "/api/v1/finance/sign-in/code"
VERIFY = "/api/v1/finance/sign-in/verify"
LISTED = "listed-reader@example.test"
REVOKED = "revoked-reader@example.test"
SUPABASE = "https://project.example.test"


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


class _Borrowed:
    """The test's session for the after-the-answer work, which must not close it."""

    def __init__(self, db):
        self._db = db

    def __getattr__(self, name):
        return getattr(self._db, name)

    def close(self):
        pass


class _Services:
    """Stand-ins for Resend and Supabase that record what they were sent."""

    def __init__(self):
        self.emails: list[dict] = []
        self.supabase: list[tuple[str, dict, dict]] = []
        self.token_status = 200

    def post(self, url, **kwargs):
        if url == finance_sign_in.RESEND_URL:
            self.emails.append(kwargs)
            return httpx.Response(200, json={"id": "email-1"})
        self.supabase.append((url, kwargs["headers"], kwargs["json"]))
        if url.endswith("/auth/v1/admin/users"):
            return httpx.Response(422, json={"code": "email_exists"})
        if url.endswith("/auth/v1/admin/generate_link"):
            return httpx.Response(
                self.token_status,
                json={"properties": {"hashed_token": "one-time-token"}},
            )
        raise AssertionError(url)

    def codes(self) -> list[str]:
        return [
            re.search(r"code is (\d{8})", email["json"]["text"]).group(1)
            for email in self.emails
        ]


@pytest.fixture()
def services(db, monkeypatch):
    stand_ins = _Services()
    monkeypatch.setattr(finance_sign_in.httpx, "post", stand_ins.post)
    monkeypatch.setattr(finance_sign_in, "_session", lambda: _Borrowed(db))
    monkeypatch.setattr(route, "REFUSAL_SECONDS", 0.0)
    for name, value in {
        "ALETHICAL_FINANCE_SIGN_IN_CODE_ENABLED": "1",
        "ALETHICAL_EMAIL_ENABLED": "1",
        "ALETHICAL_EMAIL_TRANSPORT": "resend",
        "RESEND_API_KEY": "re_test",
        "SUPABASE_URL": SUPABASE + "/",
        "SUPABASE_SECRET_KEY": "sb_secret_test",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("ALETHICAL_EMAIL_ALLOWLIST", raising=False)
    return stand_ins


@pytest.fixture()
def api(client, db, services):
    client.app.dependency_overrides[get_db] = lambda: db
    return client


def ask(api, email, ip="203.0.113.7"):
    return api.post(CODE, json={"email": email}, headers={"X-Forwarded-For": ip})


def prove(api, email, code, ip="203.0.113.8"):
    return api.post(
        VERIFY, json={"email": email, "code": code}, headers={"X-Forwarded-For": ip}
    )


def test_every_address_gets_1_answer_and_only_a_listed_one_an_email(api, db, services):
    listed = ask(api, " Listed-Reader@Example.test ")
    unlisted = ask(api, "unlisted@example.test")
    revoked = ask(api, REVOKED)
    assert listed.status_code == unlisted.status_code == revoked.status_code == 202
    assert listed.json() == unlisted.json() == revoked.json()
    assert "no-store" in unlisted.headers["cache-control"]
    assert [email["json"]["to"] for email in services.emails] == [[LISTED]]
    [code] = services.codes()
    [held] = db.scalars(select(FinanceSignInCode)).all()
    assert held.email == LISTED and code not in held.code_hash
    assert services.supabase == []


def test_a_proved_code_returns_a_sign_in_token_once(api, services):
    ask(api, LISTED)
    [code] = services.codes()
    proved = prove(api, " LISTED-reader@example.test", code)
    assert proved.status_code == 200, proved.text
    assert proved.json()["data"] == {
        "token_hash": "one-time-token",
        "type": "magiclink",
    }
    assert "no-store" in proved.headers["cache-control"]
    (users_url, headers, account), (token_url, _, request) = services.supabase
    assert users_url == f"{SUPABASE}/auth/v1/admin/users"
    assert account == {"email": LISTED, "email_confirm": True}
    assert token_url == f"{SUPABASE}/auth/v1/admin/generate_link"
    assert request == {"type": "magiclink", "email": LISTED}
    assert headers["apikey"] == "sb_secret_test" and "Authorization" not in headers
    assert prove(api, LISTED, code).status_code == 400


def test_every_refusal_is_the_same_answer(api, db, services):
    ask(api, LISTED)
    [code] = services.codes()
    wrong = "0" * 8 if code != "0" * 8 else "1" * 8
    never_sent = prove(api, "unlisted@example.test", code)
    mistyped = prove(api, LISTED, wrong)
    malformed = prove(api, LISTED, "abc")
    db.execute(
        update(FinanceSignInCode).values(
            created_at=func.now() - timedelta(minutes=11),
            expires_at=func.now() - timedelta(minutes=1),
        )
    )
    db.commit()
    expired = prove(api, LISTED, code)
    answers = [never_sent, mistyped, malformed, expired]
    assert {r.status_code for r in answers} == {400}
    assert len({r.text.replace(r.json()["instance"], "") for r in answers}) == 1


def test_a_refusal_takes_the_same_minimum_time(api, services, monkeypatch):
    monkeypatch.setattr(route, "REFUSAL_SECONDS", 0.3)
    started = time.monotonic()
    assert prove(api, "unlisted@example.test", "12345678").status_code == 400
    assert time.monotonic() - started >= 0.3


def test_5_wrong_tries_use_up_the_code(api, services):
    ask(api, LISTED)
    [code] = services.codes()
    wrong = "0" * 8 if code != "0" * 8 else "1" * 8
    for _ in range(finance_sign_in.MAX_WRONG_TRIES):
        assert prove(api, LISTED, wrong).status_code == 400
    assert prove(api, LISTED, code).status_code == 400
    assert services.supabase == []


def test_a_repeat_inside_the_wait_sends_nothing_more(api, services):
    assert ask(api, LISTED).status_code == 202
    assert ask(api, LISTED).status_code == 202
    assert len(services.emails) == 1


def test_a_new_code_replaces_the_earlier_one(api, db, services):
    ask(api, LISTED)
    db.execute(
        update(FinanceSignInCode).values(created_at=func.now() - timedelta(minutes=2))
    )
    db.commit()
    ask(api, LISTED)
    first, second = services.codes()
    if first != second:
        assert prove(api, LISTED, first).status_code == 400
    assert prove(api, LISTED, second).status_code == 200


def test_an_address_revoked_after_its_code_was_sent_is_refused(api, db, services):
    ask(api, LISTED)
    [code] = services.codes()
    finance_access.revoke(db, LISTED)
    assert prove(api, LISTED, code).status_code == 400
    assert services.supabase == []


def test_a_supabase_failure_keeps_the_code_for_another_try(api, services):
    ask(api, LISTED)
    [code] = services.codes()
    services.token_status = 500
    assert prove(api, LISTED, code).status_code == 503
    services.token_status = 200
    assert prove(api, LISTED, code).status_code == 200


def test_a_legacy_service_role_key_is_also_sent_as_the_bearer(
    api, services, monkeypatch
):
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "eyJlegacy.service.role")
    ask(api, LISTED)
    [code] = services.codes()
    assert prove(api, LISTED, code).status_code == 200
    _, headers, _ = services.supabase[0]
    assert headers["Authorization"] == "Bearer eyJlegacy.service.role"


@pytest.mark.parametrize(
    "missing",
    [
        "ALETHICAL_FINANCE_SIGN_IN_CODE_ENABLED",
        "SUPABASE_SECRET_KEY",
        "RESEND_API_KEY",
        "ALETHICAL_EMAIL_ENABLED",
    ],
)
def test_nothing_is_sent_or_proved_until_configured(
    api, services, monkeypatch, missing
):
    monkeypatch.delenv(missing)
    assert ask(api, LISTED).status_code == 503
    assert ask(api, "unlisted@example.test").status_code == 503
    assert prove(api, LISTED, "12345678").status_code == 503
    assert services.emails == []


def test_the_test_allowlist_holds_back_other_addresses(api, services, monkeypatch):
    monkeypatch.setenv("ALETHICAL_EMAIL_ALLOWLIST", "someone-else@example.test")
    assert ask(api, LISTED).status_code == 202
    assert services.emails == []


def test_a_failed_email_never_reaches_the_caller(api, monkeypatch):
    def down(url, **kwargs):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(finance_sign_in.httpx, "post", down)
    assert ask(api, LISTED).status_code == 202


def test_a_value_that_cannot_be_an_address_is_refused_for_everyone(api, services):
    assert ask(api, "not-an-address").status_code == 422
    assert prove(api, "not-an-address", "12345678").status_code == 422
    assert services.emails == []


def test_requests_from_1_address_are_limited(api, services):
    for _ in range(10):
        assert ask(api, "unlisted@example.test", ip="203.0.113.9").status_code == 202
    assert ask(api, "unlisted@example.test", ip="203.0.113.9").status_code == 429
