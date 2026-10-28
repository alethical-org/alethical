"""Finance's emailed codes: sent by Alethical, only to listed addresses, answered alike."""

from __future__ import annotations

import asyncio
import hashlib
import re
import secrets
import threading
import time
from datetime import timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from alethical.api.routers import finance_sign_in as route
from alethical.api.services import finance_access
from alethical.api.services import finance_sign_in
from alethical.db.models import FinanceAccessEntry, FinanceSignInCode
from alethical.db.session import get_db, get_engine, get_session_factory

CODE = "/api/v1/finance/sign-in/code"
VERIFY = "/api/v1/finance/sign-in/verify"
LISTED = "listed-reader@example.test"
REVOKED = "revoked-reader@example.test"
UNLISTED = "unlisted@example.test"
SUPABASE = "https://project.example.test"
BROWSER_CLIENT = Path(__file__).resolve().parents[2] / "apps/finance/src/api/client.ts"
# Kept before any test replaces it, for the tests that need the real threads.
REAL_HAND_OFF = finance_sign_in._hand_off


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
        self.supabase_timeouts: list[httpx.Timeout] = []
        self.token_status = 200

    def post(self, url, **kwargs):
        if url == finance_sign_in.RESEND_URL:
            self.emails.append(kwargs)
            return httpx.Response(200, json={"id": "email-1"})
        self.supabase.append((url, kwargs["headers"], kwargs["json"]))
        self.supabase_timeouts.append(kwargs["timeout"])
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
    # Delivery runs inline here, so each request's email is in before it returns.
    monkeypatch.setattr(finance_sign_in, "_hand_off", lambda work, *args: work(*args))
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


@pytest.fixture()
def committed(services, monkeypatch):
    """A listed address saved for real, for tests that need 2 connections at once."""
    email = "committed-reader@example.test"
    factory = get_session_factory()
    monkeypatch.setattr(finance_sign_in, "_session", factory)
    with factory() as setup:
        finance_access.grant(setup, email, team=False)
        setup.commit()
    yield email
    with factory() as cleanup:
        cleanup.execute(
            delete(FinanceSignInCode).where(FinanceSignInCode.email == email)
        )
        cleanup.execute(
            delete(FinanceAccessEntry).where(FinanceAccessEntry.email == email)
        )
        cleanup.commit()


def ask(api, email, ip="203.0.113.7"):
    return api.post(CODE, json={"email": email}, headers={"X-Forwarded-For": ip})


def challenge_for(api, email):
    answer = ask(api, email)
    assert answer.status_code == 202, answer.text
    return answer.json()["data"]["challenge"]


def prove(api, email, code, challenge, ip="203.0.113.8"):
    body = {"email": email, "code": code}
    if challenge is not None:
        body["challenge"] = challenge
    return api.post(VERIFY, json=body, headers={"X-Forwarded-For": ip})


def wrong(code):
    return "0" * 8 if code != "0" * 8 else "1" * 8


def same_answer(*answers):
    return len({r.text.replace(r.json()["instance"], "") for r in answers}) == 1


def made_earlier(db, age):
    db.execute(update(FinanceSignInCode).values(created_at=func.now() - age))
    db.commit()


def history(db, rows):
    """Earlier code rows, each as (address, how long ago it was made)."""
    for email, age in rows:
        db.add(
            FinanceSignInCode(
                email=email,
                code_hash=finance_sign_in._DECOY,
                challenge_hash=secrets.token_hex(32),
                created_at=func.now() - age,
                expires_at=func.now() - age + finance_sign_in.CODE_LIFETIME,
            )
        )
    db.commit()


def test_every_address_gets_1_answer_and_only_a_listed_one_an_email(api, db, services):
    listed = ask(api, " Listed-Reader@Example.test ")
    unlisted = ask(api, UNLISTED)
    revoked = ask(api, REVOKED)
    answers = [listed, unlisted, revoked]
    assert {r.status_code for r in answers} == {202}
    assert {r.json()["data"]["status"] for r in answers} == {"accepted"}
    assert {tuple(r.json()) for r in answers} == {("data",)}
    challenges = [r.json()["data"]["challenge"] for r in answers]
    assert len(set(challenges)) == 3 and {len(c) for c in challenges} == {43}
    assert "no-store" in unlisted.headers["cache-control"]
    assert [email["json"]["to"] for email in services.emails] == [[LISTED]]
    [code] = services.codes()
    [held] = db.scalars(select(FinanceSignInCode)).all()
    assert held.email == LISTED and code not in held.code_hash
    # Only a hash of the challenge is kept.
    assert held.challenge_hash == hashlib.sha256(challenges[0].encode()).hexdigest()
    assert services.supabase == []


def test_the_email_carries_the_code_and_no_link(api, services):
    ask(api, LISTED)
    [email] = services.emails
    assert set(email["json"]) == {"from", "to", "subject", "text"}
    assert "http" not in email["json"]["text"].lower()
    assert "www." not in email["json"]["text"].lower()


def test_a_proved_code_returns_a_sign_in_token_once(api, services):
    challenge = challenge_for(api, LISTED)
    [code] = services.codes()
    proved = prove(api, " LISTED-reader@example.test", code, challenge)
    assert proved.status_code == 200, proved.text
    assert proved.json()["data"] == {"token_hash": "one-time-token", "type": "email"}
    assert "no-store" in proved.headers["cache-control"]
    (users_url, headers, account), (token_url, _, request) = services.supabase
    assert users_url == f"{SUPABASE}/auth/v1/admin/users"
    assert account == {"email": LISTED, "email_confirm": True}
    assert token_url == f"{SUPABASE}/auth/v1/admin/generate_link"
    assert request == {"type": "magiclink", "email": LISTED}
    assert headers["apikey"] == "sb_secret_test" and "Authorization" not in headers
    assert prove(api, LISTED, code, challenge).status_code == 400


def test_both_supabase_calls_finish_inside_the_browsers_limit(api, services):
    challenge = challenge_for(api, LISTED)
    [code] = services.codes()
    assert prove(api, LISTED, code, challenge).status_code == 200
    browser_ms = re.search(
        r"REQUEST_TIMEOUT_MS = ([\d_]+);", BROWSER_CLIENT.read_text()
    ).group(1)
    timeouts = services.supabase_timeouts
    assert len(timeouts) == 2
    worst = sum(t.connect + t.read for t in timeouts)
    assert worst < int(browser_ms.replace("_", "")) / 1000


def test_every_refusal_is_the_same_answer(api, db, services):
    challenge = challenge_for(api, LISTED)
    [code] = services.codes()
    never_sent = prove(api, UNLISTED, code, challenge)
    mistyped = prove(api, LISTED, wrong(code), challenge)
    malformed = prove(api, LISTED, "abc", challenge)
    other_challenge = prove(api, LISTED, code, finance_sign_in.new_challenge())
    no_challenge = prove(api, LISTED, code, None)
    db.execute(
        update(FinanceSignInCode).values(
            created_at=func.now() - timedelta(minutes=11),
            expires_at=func.now() - timedelta(minutes=1),
        )
    )
    db.commit()
    expired = prove(api, LISTED, code, challenge)
    answers = [never_sent, mistyped, malformed, other_challenge, no_challenge, expired]
    assert {r.status_code for r in answers} == {400}
    assert same_answer(*answers)
    assert services.supabase == []


@pytest.mark.parametrize(
    "case", ["refused", "malformed", "supabase down", "database error", "busy"]
)
def test_every_answer_but_a_token_waits_out_the_same_floor(
    api, services, monkeypatch, case
):
    challenge = challenge_for(api, LISTED)
    [code] = services.codes()
    email, status = LISTED, 503
    if case == "refused":
        code, status = wrong(code), 400
    elif case == "malformed":
        email, status = "not-an-address", 422
    elif case == "supabase down":
        services.token_status = 500
    elif case == "database error":

        def broken(*args):
            raise OperationalError("SELECT 1", {}, Exception("connection lost"))

        monkeypatch.setattr(finance_sign_in, "prove_code", broken)
    else:
        monkeypatch.setattr(route, "_proofs", asyncio.Semaphore(0))
        status = 429
    monkeypatch.setattr(route, "REFUSAL_SECONDS", 0.3)
    started = time.monotonic()
    assert prove(api, email, code, challenge).status_code == status
    assert time.monotonic() - started >= 0.3


def test_a_full_process_answers_every_address_alike(api, services, monkeypatch):
    challenge = challenge_for(api, LISTED)
    [code] = services.codes()
    monkeypatch.setattr(route, "_proofs", asyncio.Semaphore(0))
    listed = prove(api, LISTED, code, challenge)
    unlisted = prove(api, UNLISTED, code, challenge)
    assert listed.status_code == unlisted.status_code == 429
    assert same_answer(listed, unlisted)
    assert services.supabase == []
    monkeypatch.setattr(route, "_proofs", asyncio.Semaphore(1))
    assert prove(api, LISTED, code, challenge).status_code == 200


def test_5_wrong_tries_use_up_the_code(api, services):
    challenge = challenge_for(api, LISTED)
    [code] = services.codes()
    for _ in range(finance_sign_in.MAX_WRONG_TRIES):
        assert prove(api, LISTED, wrong(code), challenge).status_code == 400
    assert prove(api, LISTED, code, challenge).status_code == 400
    assert services.supabase == []


def test_each_request_has_its_own_code_and_challenge(api, db, services):
    first_challenge = challenge_for(api, LISTED)
    made_earlier(db, timedelta(minutes=2))
    second_challenge = challenge_for(api, LISTED)
    first, second = services.codes()
    assert len(db.scalars(select(FinanceSignInCode)).all()) == 2
    if first != second:
        assert prove(api, LISTED, first, second_challenge).status_code == 400
    assert prove(api, LISTED, second, second_challenge).status_code == 200
    assert prove(api, LISTED, first, first_challenge).status_code == 200


def test_a_strangers_requests_and_wrong_tries_never_use_up_your_code(api, db, services):
    yours = challenge_for(api, LISTED)
    made_earlier(db, timedelta(minutes=2))
    # A stranger asks for your address: a new code reaches you, with their challenge.
    theirs = challenge_for(api, LISTED)
    your_code, their_code = services.codes()
    for _ in range(finance_sign_in.MAX_WRONG_TRIES):
        assert prove(api, LISTED, wrong(your_code), theirs).status_code == 400
    assert prove(api, LISTED, your_code, None).status_code == 400
    # Their 5 wrong tries used up their own code, never yours.
    assert prove(api, LISTED, their_code, theirs).status_code == 400
    yours_row = db.scalar(
        select(FinanceSignInCode).where(
            FinanceSignInCode.challenge_hash
            == hashlib.sha256(yours.encode()).hexdigest()
        )
    )
    assert yours_row.wrong_tries == 0
    assert prove(api, LISTED, your_code, yours).status_code == 200


def test_a_repeat_inside_the_wait_sends_nothing_more(api, services):
    first = ask(api, LISTED)
    repeat = ask(api, LISTED)
    assert first.status_code == repeat.status_code == 202
    assert set(first.json()["data"]) == set(repeat.json()["data"])
    assert len(services.emails) == 1


@pytest.mark.parametrize(
    ("earlier", "sent"),
    [
        pytest.param([(LISTED, timedelta(seconds=30))], False, id="1 a minute"),
        pytest.param([(LISTED, timedelta(seconds=61))], True, id="after a minute"),
        pytest.param(
            [
                (LISTED, timedelta(minutes=2 + n))
                for n in range(finance_sign_in.CODES_PER_ADDRESS_PER_HOUR)
            ],
            False,
            id="5 an hour",
        ),
        pytest.param(
            [
                (LISTED, timedelta(minutes=2 + n))
                for n in range(finance_sign_in.CODES_PER_ADDRESS_PER_HOUR - 1)
            ],
            True,
            id="4 in the hour",
        ),
        pytest.param(
            [
                (LISTED, timedelta(hours=2 + n))
                for n in range(finance_sign_in.CODES_PER_ADDRESS_PER_DAY)
            ],
            False,
            id="10 a day",
        ),
        pytest.param(
            [
                (LISTED, timedelta(hours=2 + n))
                for n in range(finance_sign_in.CODES_PER_ADDRESS_PER_DAY - 1)
            ],
            True,
            id="9 in the day",
        ),
        pytest.param(
            [
                (f"reader-{n}@example.test", timedelta(hours=2))
                for n in range(finance_sign_in.FINANCE_CODES_PER_DAY)
            ],
            False,
            id="40 a day for everyone",
        ),
        pytest.param(
            [
                (f"reader-{n}@example.test", timedelta(hours=2))
                for n in range(finance_sign_in.FINANCE_CODES_PER_DAY - 1)
            ],
            True,
            id="39 in the day for everyone",
        ),
        pytest.param(
            [(LISTED, timedelta(hours=25))] * finance_sign_in.CODES_PER_ADDRESS_PER_DAY,
            True,
            id="older than a day",
        ),
    ],
)
def test_each_sending_cap_holds_back_the_email_and_never_changes_the_answer(
    api, db, services, earlier, sent
):
    history(db, earlier)
    answer = ask(api, LISTED)
    unlisted = ask(api, UNLISTED)
    assert answer.status_code == unlisted.status_code == 202
    assert answer.json()["data"]["status"] == unlisted.json()["data"]["status"]
    assert len(services.emails) == (1 if sent else 0)


def test_old_rows_go_only_when_a_code_is_made(api, db, services):
    history(
        db,
        [(LISTED, timedelta(days=3)), ("reader-1@example.test", timedelta(days=1.5))],
    )
    ask(api, UNLISTED)
    assert len(db.scalars(select(FinanceSignInCode)).all()) == 2
    ask(api, LISTED)
    ages = db.scalars(
        select(func.now() - FinanceSignInCode.created_at).order_by(
            FinanceSignInCode.created_at
        )
    ).all()
    assert len(ages) == 2 and ages[0] == timedelta(days=1.5)


def test_the_answer_never_waits_for_the_email(api, services, monkeypatch):
    futures = []
    monkeypatch.setattr(
        finance_sign_in,
        "_hand_off",
        lambda work, *args: futures.append(REAL_HAND_OFF(work, *args)),
    )
    reached, release = threading.Event(), threading.Event()

    def slow_resend(url, **kwargs):
        if url == finance_sign_in.RESEND_URL:
            reached.set()
            release.wait(2)
        return services.post(url, **kwargs)

    monkeypatch.setattr(finance_sign_in.httpx, "post", slow_resend)
    try:
        answer = ask(api, LISTED)
        emailed_when_answered = len(services.emails)
        assert reached.wait(5)
    finally:
        release.set()
    for future in futures:
        future.result(5)
    assert answer.status_code == 202 and emailed_when_answered == 0
    assert len(services.emails) == 1


def test_simultaneous_requests_for_1_address_make_1_email(
    committed, services, monkeypatch
):
    real_hash = finance_sign_in._hash

    def slow_hash(code, salt):
        # The first request is still making its code when the second checks the caps.
        time.sleep(0.3)
        return real_hash(code, salt)

    monkeypatch.setattr(finance_sign_in, "_hash", slow_hash)
    start = threading.Barrier(2)

    def request():
        start.wait(5)
        challenge = finance_sign_in.new_challenge()
        finance_sign_in.deliver_code(
            committed, finance_sign_in._challenge_hash(challenge)
        )

    threads = [threading.Thread(target=request) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)
    assert len(services.emails) == 1


def test_a_code_another_proof_is_checking_is_refused_at_once(committed, services):
    challenge = finance_sign_in.new_challenge()
    finance_sign_in.deliver_code(committed, finance_sign_in._challenge_hash(challenge))
    [code] = services.codes()
    factory = get_session_factory()
    with factory() as holder, factory() as prover:
        holder.execute(
            select(FinanceSignInCode.id)
            .where(FinanceSignInCode.email == committed)
            .with_for_update()
        )
        # A proof that waited for the lock would fail here with a lock timeout.
        prover.execute(text("SET LOCAL lock_timeout = '2s'"))
        started = time.monotonic()
        with pytest.raises(finance_sign_in.CodeNotAccepted):
            finance_sign_in.prove_code(prover, committed, code, challenge)
        assert time.monotonic() - started < 1.0
        holder.rollback()
    with factory() as again:
        token = finance_sign_in.prove_code(again, committed, code, challenge)
    assert token == {"token_hash": "one-time-token", "type": "email"}


def test_an_address_revoked_after_its_code_was_sent_is_refused(api, db, services):
    challenge = challenge_for(api, LISTED)
    [code] = services.codes()
    finance_access.revoke(db, LISTED)
    assert prove(api, LISTED, code, challenge).status_code == 400
    assert services.supabase == []


def test_a_supabase_failure_keeps_the_code_for_another_try(api, services):
    challenge = challenge_for(api, LISTED)
    [code] = services.codes()
    services.token_status = 500
    assert prove(api, LISTED, code, challenge).status_code == 503
    services.token_status = 200
    assert prove(api, LISTED, code, challenge).status_code == 200


def test_a_legacy_service_role_key_is_also_sent_as_the_bearer(
    api, services, monkeypatch
):
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "eyJlegacy.service.role")
    challenge = challenge_for(api, LISTED)
    [code] = services.codes()
    assert prove(api, LISTED, code, challenge).status_code == 200
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
    assert ask(api, UNLISTED).status_code == 503
    challenge = finance_sign_in.new_challenge()
    assert prove(api, LISTED, "12345678", challenge).status_code == 503
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
    challenge = finance_sign_in.new_challenge()
    assert prove(api, "not-an-address", "12345678", challenge).status_code == 422
    assert services.emails == []


def test_requests_from_1_address_are_limited(api, services):
    for _ in range(10):
        assert ask(api, UNLISTED, ip="203.0.113.9").status_code == 202
    assert ask(api, UNLISTED, ip="203.0.113.9").status_code == 429


def test_proofs_from_1_address_are_limited(api, services):
    challenge = finance_sign_in.new_challenge()
    for _ in range(10):
        assert prove(api, UNLISTED, "12345678", challenge).status_code == 400
    assert prove(api, UNLISTED, "12345678", challenge).status_code == 429


def test_requests_and_proofs_share_1_limit(api, services):
    challenge = finance_sign_in.new_challenge()
    for _ in range(5):
        assert ask(api, UNLISTED).status_code == 202
    for _ in range(5):
        assert prove(api, UNLISTED, "12345678", challenge).status_code == 400
    assert prove(api, UNLISTED, "12345678", challenge).status_code == 429
    assert ask(api, UNLISTED).status_code == 429
