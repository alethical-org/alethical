"""A shared Finance credential permits research, never record or account changes."""

from __future__ import annotations

import hashlib
import re
from datetime import timedelta

import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from alethical.api.auth import get_auth_service
from alethical.api.routers import finance_sign_in as routes
from alethical.api.services import finance_research_access as research
from alethical.db.models import (
    FinanceAccessEntry,
    FinanceResearchAccount,
    FinanceResearchSession,
)
from alethical.db.session import get_db, get_engine
from scripts import finance_research_access as script

EMAIL = "research-demo@example.test"
PASSWORD = "test-demo-passphrase"
LOGIN = "/api/v1/finance/sign-in/research"
ACCESS = "/api/v1/finance/access"


@pytest.fixture()
def db(seed_database):
    with get_engine().connect() as connection:
        transaction = connection.begin()
        with Session(
            bind=connection, join_transaction_mode="create_savepoint"
        ) as session:
            research.set_password(session, EMAIL, PASSWORD)
            yield session
        transaction.rollback()


@pytest.fixture()
def api(client, db, monkeypatch):
    monkeypatch.delenv("ALETHICAL_FINANCE_RESEARCH_EMAIL", raising=False)
    client.app.dependency_overrides[get_db] = lambda: db
    # Research sessions work even when the separate Supabase service is absent.
    client.app.dependency_overrides[get_auth_service] = lambda: None
    monkeypatch.setattr(routes, "REFUSAL_SECONDS", 0)
    return client


def login(api, **overrides):
    response = api.post(LOGIN, json={"email": EMAIL, "password": PASSWORD, **overrides})
    assert response.status_code == 200, response.text
    assert "no-store" in response.headers["cache-control"]
    return response.json()["data"]["access_token"]


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_session_is_research_only_and_stores_neither_password_nor_token(api, db):
    token = login(api, email="  RESEARCH-DEMO@EXAMPLE.TEST ")
    response = api.get(ACCESS, headers=bearer(token))
    assert response.status_code == 200
    assert response.json() == {"data": {"allowed": True, "can_edit": False}}
    account = db.scalar(select(FinanceResearchAccount))
    session = db.scalar(select(FinanceResearchSession))
    assert PASSWORD not in account.password_hash
    assert session.token_digest == hashlib.sha256(token.encode()).hexdigest()
    assert session.token_digest != token
    assert session.expires_at - session.created_at == timedelta(days=30)
    assert (
        db.scalar(
            select(func.count())
            .select_from(FinanceAccessEntry)
            .where(FinanceAccessEntry.email == EMAIL)
        )
        == 0
    )


def test_research_can_read_real_finance_data(api):
    token = login(api)
    response = api.get("/api/v1/finance/legislative-committees", headers=bearer(token))
    assert response.status_code == 200, response.text
    assert "data" in response.json()


def test_access_code_uses_configured_account_without_supabase_or_email(
    api, monkeypatch, caplog
):
    monkeypatch.setenv("ALETHICAL_FINANCE_RESEARCH_EMAIL", f"  {EMAIL.upper()} ")

    def unexpected(*args, **kwargs):
        raise AssertionError("Research access must not use Supabase or send email")

    api.app.dependency_overrides[get_auth_service] = unexpected
    monkeypatch.setattr(routes.finance_sign_in, "check_request", unexpected)
    monkeypatch.setattr(routes.finance_sign_in, "schedule_delivery", unexpected)
    monkeypatch.setattr(routes.finance_sign_in, "prove_code", unexpected)
    response = api.post(LOGIN, json={"password": PASSWORD})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["email"] == EMAIL
    api.app.dependency_overrides[get_auth_service] = lambda: None
    assert api.get(ACCESS, headers=bearer(data["access_token"])).status_code == 200
    assert PASSWORD not in caplog.text


@pytest.mark.parametrize("configured", [None, "", "bad-address", "a" * 321])
def test_access_code_without_valid_account_config_is_unavailable(
    api, db, monkeypatch, caplog, configured
):
    if configured is not None:
        monkeypatch.setenv("ALETHICAL_FINANCE_RESEARCH_EMAIL", configured)
    response = api.post(LOGIN, json={"password": PASSWORD})
    assert response.status_code == 503
    assert response.json()["type"].endswith("service-unavailable")
    assert PASSWORD not in response.text
    assert PASSWORD not in caplog.text
    assert db.scalar(select(func.count()).select_from(FinanceResearchSession)) == 0


def test_wrong_access_code_is_refused_without_session(api, db, monkeypatch):
    monkeypatch.setenv("ALETHICAL_FINANCE_RESEARCH_EMAIL", EMAIL)
    response = api.post(LOGIN, json={"password": "wrong-test-code"})
    assert response.status_code == 401
    assert response.json()["type"].endswith("finance-credentials-not-accepted")
    assert db.scalar(select(func.count()).select_from(FinanceResearchSession)) == 0


def test_explicit_email_remains_compatible_with_a_different_default(api, monkeypatch):
    monkeypatch.setenv("ALETHICAL_FINANCE_RESEARCH_EMAIL", "another@example.test")
    token = login(api)
    assert api.get(ACCESS, headers=bearer(token)).status_code == 200


def test_access_code_input_is_bounded_without_email(api, monkeypatch):
    monkeypatch.setenv("ALETHICAL_FINANCE_RESEARCH_EMAIL", EMAIL)
    assert api.post(LOGIN, json={"password": "a" * 1025}).status_code == 422


def test_every_finance_mutation_refuses_research_before_processing_its_body(api):
    token = login(api)
    tested = []
    for path, operations in api.app.openapi()["paths"].items():
        if not path.startswith("/api/v1/finance/") or path.startswith(
            "/api/v1/finance/sign-in/"
        ):
            continue
        for method in operations:
            if method not in {"post", "put", "patch", "delete"}:
                continue
            address = re.sub(r"\{[^}]+\}", "00000000-0000-0000-0000-000000000001", path)
            response = api.request(method, address, json={}, headers=bearer(token))
            assert response.status_code == 403, (method, path, response.text)
            assert response.json()["type"].endswith("finance-read-only")
            assert "no-store" in response.headers["cache-control"]
            tested.append((method, path))
    assert len(tested) >= 9


@pytest.mark.parametrize(
    "changes",
    [
        {"password": "wrong-password"},
        {"email": "absent@example.test"},
        {"email": "bad"},
        {"password": ""},
    ],
)
def test_bad_credentials_have_one_refusal_without_a_session(api, db, changes):
    response = api.post(LOGIN, json={"email": EMAIL, "password": PASSWORD, **changes})
    assert response.status_code == 401
    assert response.json()["type"].endswith("finance-credentials-not-accepted")
    assert response.json()["detail"] == "That email or password is not right."
    assert db.scalar(select(func.count()).select_from(FinanceResearchSession)) == 0


def test_password_and_address_input_are_bounded(api):
    for changes in ({"password": "a" * 1025}, {"email": "a" * 321}, {"extra": True}):
        response = api.post(
            LOGIN, json={"email": EMAIL, "password": PASSWORD, **changes}
        )
        assert response.status_code == 422


def test_invalid_and_expired_sessions_are_signed_out(api, db):
    for token in (research.TOKEN_PREFIX + "a" * 43, research.TOKEN_PREFIX + "short"):
        assert api.get(ACCESS, headers=bearer(token)).status_code == 401
    token = login(api)
    db.execute(
        update(FinanceResearchSession).values(
            expires_at=func.now() - text("interval '1 second'")
        )
    )
    assert api.get(ACCESS, headers=bearer(token)).status_code == 401


def test_rotation_ends_every_session_and_rejects_old_password(api, db):
    first, second = login(api), login(api)
    research.set_password(db, EMAIL, "replacement-demo-password")
    db.commit()
    for token in (first, second):
        assert api.get(ACCESS, headers=bearer(token)).status_code == 401
    assert (
        api.post(LOGIN, json={"email": EMAIL, "password": PASSWORD}).status_code == 401
    )
    token = login(api, password="replacement-demo-password")
    assert api.get(ACCESS, headers=bearer(token)).status_code == 200


def test_revocation_blocks_sessions_and_new_sign_in_until_operator_restores(api, db):
    token = login(api)
    research.revoke(db, EMAIL)
    db.commit()
    assert api.get(ACCESS, headers=bearer(token)).status_code == 401
    assert (
        api.post(LOGIN, json={"email": EMAIL, "password": PASSWORD}).status_code == 401
    )
    research.set_password(db, EMAIL, PASSWORD)
    db.commit()
    restored = login(api)
    assert api.get(ACCESS, headers=bearer(restored)).status_code == 200
    assert api.get(ACCESS, headers=bearer(token)).status_code == 401


def test_sign_out_ends_only_the_callers_session_and_is_repeatable(api):
    first, second = login(api), login(api)
    for _ in range(2):
        response = api.post(LOGIN + "/sign-out", headers=bearer(first))
        assert response.status_code == 200
    assert api.get(ACCESS, headers=bearer(first)).status_code == 401
    assert api.get(ACCESS, headers=bearer(second)).status_code == 200


def test_research_session_is_not_a_public_site_identity(api):
    token = login(api)

    class RejectingAuth:
        def authenticate(self, value):
            assert value == token
            raise ValueError("Not a Supabase token")

    api.app.dependency_overrides[get_auth_service] = lambda: RejectingAuth()
    response = api.get("/api/v1/me", headers=bearer(token))
    assert response.status_code == 401


def test_database_failure_is_unavailable_without_issuing_a_session(api, monkeypatch):
    def failed(*args):
        raise OperationalError("SELECT", {}, Exception("unavailable"))

    monkeypatch.setattr(research, "sign_in", failed)
    assert (
        api.post(LOGIN, json={"email": EMAIL, "password": PASSWORD}).status_code == 503
    )
    monkeypatch.setattr(research, "session_account", failed)
    token = research.TOKEN_PREFIX + "a" * 43
    assert api.get(ACCESS, headers=bearer(token)).status_code == 503


def test_sign_in_is_rate_limited(api):
    api.app.state.finance_sign_in_limiter.max_requests = 1
    login(api)
    response = api.post(LOGIN, json={"email": EMAIL, "password": PASSWORD})
    assert response.status_code == 429
    assert response.headers["retry-after"]


def test_sign_out_revokes_session_after_sign_in_limit_is_exhausted(api):
    api.app.state.finance_sign_in_limiter.max_requests = 1
    token = login(api)
    for path, payload in (
        (LOGIN, {"email": EMAIL, "password": PASSWORD}),
        ("/api/v1/finance/sign-in/code", {"email": EMAIL}),
        ("/api/v1/finance/sign-in/verify", {"email": EMAIL, "code": "123456"}),
    ):
        assert api.post(path, json=payload).status_code == 429
    assert api.get(ACCESS, headers=bearer(token)).status_code == 200

    response = api.post(LOGIN + "/sign-out", headers=bearer(token))
    assert response.status_code == 200
    assert api.get(ACCESS, headers=bearer(token)).status_code == 401


def test_password_hashes_are_salted_and_constant_parameters():
    one, two = research.hash_password(PASSWORD), research.hash_password(PASSWORD)
    assert one != two
    assert research.verify_password(PASSWORD, one)
    assert not research.verify_password("wrong-password", one)
    assert not research.verify_password(PASSWORD, "malformed")


def test_operator_script_sets_reads_and_revokes_without_printing_secrets(db):
    args = script.parse_args(["set-password", EMAIL])
    code, message = script.run(db, args, PASSWORD)
    assert code == 0 and "active; research only" in message
    assert PASSWORD not in message
    token = research.sign_in(db, EMAIL, PASSWORD)["access_token"]
    code, message = script.run(db, script.parse_args(["revoke", EMAIL]))
    assert code == 0 and "revoked" in message
    assert research.session_account(db, token) is None
    with pytest.raises(SystemExit):
        script.parse_args(["set-password", EMAIL, "--password", PASSWORD])


def test_research_credentials_and_sessions_have_no_browser_database_access(db):
    for table in ("finance_research_account", "finance_research_session"):
        assert (
            db.scalar(
                text(
                    "SELECT relrowsecurity FROM pg_class WHERE oid = CAST(:name AS regclass)"
                ),
                {"name": table},
            )
            is True
        )
        policies = db.scalar(
            text(
                "SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = :name"
            ),
            {"name": table},
        )
        assert policies == 0
        grants = db.scalar(
            text(
                "SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name = :name AND grantee IN ('PUBLIC', 'anon', 'authenticated')"
            ),
            {"name": table},
        )
        assert grants == 0


def test_busy_password_proofs_are_refused_without_hashing(api, monkeypatch):
    import asyncio

    monkeypatch.setattr(routes, "_proofs", asyncio.Semaphore(0))

    def should_not_hash(*args):
        raise AssertionError("No hashing capacity")

    monkeypatch.setattr(research, "sign_in", should_not_hash)
    assert (
        api.post(LOGIN, json={"email": EMAIL, "password": PASSWORD}).status_code == 429
    )


def test_login_racing_password_rotation_cannot_leave_an_old_session(
    seed_database, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    import threading
    import time
    from queue import Queue
    from uuid import uuid4
    from sqlalchemy import delete

    email = f"race-{uuid4()}@example.test"
    engine = get_engine()
    with Session(engine) as db:
        account = research.set_password(db, email, PASSWORD)
        account_id = account.id
        db.commit()
    hashing = threading.Event()
    release = threading.Event()
    rotation_pid: Queue[int] = Queue()
    original_verify = research.verify_password

    def paused_verify(*args):
        # sign_in already holds the account row lock here.
        hashing.set()
        assert release.wait(10)
        return original_verify(*args)

    monkeypatch.setattr(research, "verify_password", paused_verify)

    def signing_in():
        with Session(engine) as db:
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            token = research.sign_in(db, email, PASSWORD)["access_token"]
            db.commit()
            return token

    def rotating():
        with Session(engine) as db:
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            rotation_pid.put(db.execute(select(func.pg_backend_pid())).scalar_one())
            research.set_password(db, email, "replacement-race-password")
            db.commit()

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            login_result = executor.submit(signing_in)
            assert hashing.wait(5)
            rotation_result = executor.submit(rotating)
            try:
                pid = rotation_pid.get(timeout=5)
                deadline = time.monotonic() + 4
                blocked = False
                # Observe the actual database wait, not merely a started thread:
                # rotation must be waiting on the account row held by login.
                with engine.connect().execution_options(
                    isolation_level="AUTOCOMMIT"
                ) as monitor:
                    while time.monotonic() < deadline:
                        blocked = (
                            monitor.execute(
                                text(
                                    "SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid = :pid"
                                ),
                                {"pid": pid},
                            ).scalar_one_or_none()
                            is True
                        )
                        if blocked:
                            break
                        time.sleep(0.01)
                assert blocked, "Rotation did not wait for the in-flight login row lock"
            finally:
                release.set()
            token = login_result.result(timeout=10)
            rotation_result.result(timeout=10)
        with Session(engine) as db:
            assert research.session_account(db, token) is None
            assert (
                db.scalar(
                    select(func.count())
                    .select_from(FinanceResearchSession)
                    .where(FinanceResearchSession.account_id == account_id)
                )
                == 0
            )
            with pytest.raises(research.CredentialsNotAccepted):
                research.sign_in(db, email, PASSWORD)
    finally:
        release.set()
        with Session(engine) as db:
            db.execute(
                delete(FinanceResearchAccount).where(
                    FinanceResearchAccount.id == account_id
                )
            )
            db.commit()
