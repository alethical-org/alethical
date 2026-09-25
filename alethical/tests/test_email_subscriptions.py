"""Consent, account isolation, retries and conflicting requests against PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import logging
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select

from alethical.api.services import email_subscriptions as service
from alethical.db.models import (
    AuthIdentity,
    EmailPreferenceMutation,
    EmailSubscription,
    EmailSubscriptionIntent,
    EmailUnsubscribeToken,
    UserAccount,
)
from alethical.db.session import get_session_factory
from alethical.logging import PrivacySafeFormatter

HEADERS = {"Authorization": "Bearer test-supabase-token"}
OTHER = {"Authorization": "Bearer test-supabase-token-grace"}
PREFS = "/api/v1/me/email-preferences"
PUBLIC = "/api/v1/email-subscriptions"


@pytest.fixture(autouse=True)
def clean_subscriptions(seed_database):
    with get_session_factory()() as db:
        for model in (
            EmailPreferenceMutation,
            EmailUnsubscribeToken,
            EmailSubscriptionIntent,
            EmailSubscription,
        ):
            db.execute(delete(model))
        db.commit()


def payload(client, version=0, **choices):
    state = read(client)
    return {
        "expected_account_id": state["account_id"],
        "expected_email": state["email"],
        "expected_version": version,
        "idempotency_key": str(uuid.uuid4()),
        "source": "preferences",
        **choices,
    }


def read(client, headers=HEADERS):
    response = client.get(PREFS, headers=headers)
    assert response.status_code == 200
    return response.json()["data"]


def token_for(client):
    user_id = uuid.UUID(read(client)["account_id"])
    with get_session_factory()() as db:
        token = service.issue_unsubscribe_token(db, user_id)
        db.commit()
    return token


def test_preferences_require_account_and_do_not_subscribe_on_read(client):
    assert client.get(PREFS).status_code == 401
    assert client.post(PREFS, json=payload(client, research=True)).status_code == 401
    state = read(client)
    assert (
        state["research"] is None
        and state["features"] is None
        and state["version"] == 0
    )
    assert state["email"] == "ada@example.com"
    response = client.get(PREFS, headers=HEADERS)
    assert "no-store" in response.headers["cache-control"]


def test_choices_are_independent_and_accounts_are_isolated(client):
    result = client.post(PREFS, headers=HEADERS, json=payload(client, features=True))
    assert result.status_code == 200
    state = result.json()["data"]
    assert state["features"] is True and state["research"] is None
    subscribed = client.post(
        PREFS,
        headers=HEADERS,
        json={
            **payload(client, state["version"], research=True),
            "source": "confirmation",
        },
    )
    assert subscribed.status_code == 200
    assert subscribed.json()["data"]["features"] is True
    assert read(client, OTHER)["research"] is None
    assert read(client, OTHER)["features"] is None
    with get_session_factory()() as db:
        row = db.get(EmailSubscription, uuid.UUID(state["account_id"]))
        assert row.research_source == "confirmation"
        assert row.features_source == "preferences"
        assert row.research_changed_at and row.features_changed_at


def test_exact_retry_never_replays_consent_after_stop(client):
    request = payload(client, research=True, features=True)
    assert client.post(PREFS, headers=HEADERS, json=request).status_code == 200
    assert (
        client.post(PREFS, headers=HEADERS, json=request).json()["data"]["version"] == 1
    )
    token = token_for(client)
    assert (
        client.post(
            f"{PUBLIC}/unsubscribe", json={"token": token, "action": "research"}
        ).status_code
        == 200
    )
    retried = client.post(PREFS, headers=HEADERS, json=request)
    assert retried.json()["data"]["research"] is False
    assert retried.json()["data"]["features"] is True
    assert retried.json()["data"]["version"] == 2
    conflicting = {**request, "features": False}
    assert client.post(PREFS, headers=HEADERS, json=conflicting).status_code == 409


def test_stale_save_cannot_undo_stop_but_fresh_consent_can(client):
    stale = payload(client, research=True)
    token = token_for(client)
    client.post(f"{PUBLIC}/unsubscribe", json={"token": token, "action": "research"})
    response = client.post(PREFS, headers=HEADERS, json=stale)
    assert response.status_code == 409
    assert "no-store" in response.headers["cache-control"]
    assert read(client)["research"] is False
    assert (
        client.post(
            PREFS,
            headers=HEADERS,
            json=payload(client, read(client)["version"], research=True),
        ).status_code
        == 200
    )
    assert read(client)["research"] is True


def test_link_inspection_is_private_and_read_only_repeat_stops_work(client):
    client.post(
        PREFS, headers=HEADERS, json=payload(client, research=True, features=True)
    )
    token = token_for(client)
    response = client.post(f"{PUBLIC}/unsubscribe/inspect", json={"token": token})
    assert response.json() == {"data": {"valid": True}}
    assert "no-store" in response.headers["cache-control"]
    assert read(client)["research"] is True
    assert client.get(f"{PUBLIC}/one-click/{token}").status_code == 405
    assert read(client)["research"] is True
    for _ in range(2):
        stopped = client.post(
            f"{PUBLIC}/unsubscribe", json={"token": token, "action": "all"}
        )
        assert stopped.json() == {"data": {"unsubscribed": True, "action": "all"}}
    assert read(client)["research"] is False and read(client)["features"] is False
    assert client.get("/api/v1/me", headers=HEADERS).status_code == 200


def test_one_click_requires_explicit_post_and_stops_only_research(client):
    client.post(
        PREFS, headers=HEADERS, json=payload(client, research=True, features=True)
    )
    token = token_for(client)
    url = f"{PUBLIC}/one-click/{token}"
    assert client.post(url).status_code == 400
    assert read(client)["research"] is True
    assert (
        client.post(
            url,
            content="List-Unsubscribe=One-Click",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        ).status_code
        == 200
    )
    assert read(client)["research"] is False and read(client)["features"] is True


def test_invalid_and_revoked_links_do_not_write(client):
    token = token_for(client)
    with get_session_factory()() as db:
        db.get(EmailUnsubscribeToken, service.digest(token)).revoked_at = datetime.now(
            timezone.utc
        )
        db.commit()
    for link in (token, "x" * 43):
        assert (
            client.post(
                f"{PUBLIC}/unsubscribe/inspect", json={"token": link}
            ).status_code
            == 404
        )
        assert (
            client.post(
                f"{PUBLIC}/unsubscribe", json={"token": link, "action": "all"}
            ).status_code
            == 404
        )
    assert read(client)["research"] is None


def test_intent_needs_browser_and_account_and_never_sets_consent(client):
    browser_key = "b" * 43
    created = client.post(f"{PUBLIC}/intent", json={"browser_key": browser_key})
    assert created.status_code == 200
    item = created.json()["data"]
    assert item["return_to"] == "/money"
    data = {"reference": item["reference"], "browser_key": browser_key}
    url = "/api/v1/me/email-subscription-intent/complete"
    assert client.post(url, json=data).status_code == 401
    assert (
        client.post(
            url, headers=HEADERS, json={**data, "browser_key": "a" * 43}
        ).status_code
        == 410
    )
    for _ in range(2):
        response = client.post(url, headers=HEADERS, json=data)
        assert response.json()["data"] == {
            "show_confirmation": True,
            "return_to": "/money",
        }
    assert client.post(url, headers=OTHER, json=data).status_code == 410
    assert read(client)["research"] is None
    with get_session_factory()() as db:
        row = db.get(EmailSubscriptionIntent, service.digest(item["reference"]))
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert client.post(url, headers=HEADERS, json=data).status_code == 410
    assert (
        client.post(
            f"{PUBLIC}/intent",
            json={"browser_key": browser_key, "return_to": "https://bad.example"},
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    "choice", [{}, {"research": None}, {"features": "yes"}, {"research": 1}]
)
def test_only_explicit_boolean_choices_are_accepted(client, choice):
    assert (
        client.post(PREFS, headers=HEADERS, json=payload(client, **choice)).status_code
        == 422
    )


def test_simultaneous_save_and_stop_end_unsubscribed(client):
    user_id = uuid.UUID(read(client)["account_id"])
    token = token_for(client)
    request = payload(client, research=True)

    def save():
        with get_session_factory()() as db:
            try:
                service.save_preferences(db, user_id, request)
                return 200
            except HTTPException as exc:
                return exc.status_code

    def stop():
        with get_session_factory()() as db:
            service.unsubscribe(db, token, "research")

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(save)
        second = pool.submit(stop)
        assert first.result(timeout=10) in (200, 409)
        second.result(timeout=10)
    assert read(client)["research"] is False


def test_new_subscription_tables_are_additive_and_tokens_are_hashed(client):
    token = token_for(client)
    with get_session_factory()() as db:
        row = db.scalar(select(EmailUnsubscribeToken))
        assert row.token_digest == service.digest(token) and row.token_digest != token
        account = db.get(UserAccount, row.user_id)
        assert account.is_active


def test_one_click_credentials_are_redacted_from_logs():
    record = logging.LogRecord(
        "test",
        logging.INFO,
        "",
        0,
        "POST /api/v1/email-subscriptions/one-click/secret-value HTTP/1.1",
        (),
        None,
    )
    rendered = PrivacySafeFormatter().format(record)
    assert "secret-value" not in rendered and "[redacted-token]" in rendered


def test_subscription_migration_round_trip_preserves_accounts(client):
    import os
    import subprocess
    import sys
    from sqlalchemy import inspect
    from alethical.db.session import get_engine

    account_id = uuid.UUID(read(client)["account_id"])
    # This pytest process owns its disposable server. No shared database is used.
    for target in ("0063_cf_statement_report_period", "head"):
        direction = "downgrade" if target != "head" else "upgrade"
        subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", direction, target],
            check=True,
            capture_output=True,
            env=os.environ.copy(),
        )
    assert "email_subscription" in inspect(get_engine()).get_table_names()
    with get_session_factory()() as db:
        assert db.get(UserAccount, account_id).primary_email == "ada@example.com"


def test_one_click_accepts_multipart_extensions_and_rejects_duplicate_action(client):
    client.post(
        PREFS, headers=HEADERS, json=payload(client, research=True, features=True)
    )
    token = token_for(client)
    url = f"{PUBLIC}/one-click/{token}"
    rejected = client.post(
        url,
        files=[
            ("List-Unsubscribe", (None, "One-Click")),
            ("List-Unsubscribe", (None, "Other")),
        ],
    )
    assert rejected.status_code == 400
    assert read(client)["research"] is True
    accepted = client.post(
        url, files={"List-Unsubscribe": (None, "One-Click"), "extra": (None, "x")}
    )
    assert accepted.status_code == 200
    assert read(client)["research"] is False and read(client)["features"] is True


def test_loaded_account_and_email_must_match_at_save(client):
    request = payload(client, research=True)
    switched = client.post(PREFS, headers=OTHER, json=request)
    assert switched.status_code == 409
    assert switched.json()["type"].endswith("email-preferences-account-changed")
    with get_session_factory()() as db:
        user = db.get(UserAccount, uuid.UUID(request["expected_account_id"]))
        original = user.primary_email
        user.primary_email = "changed@example.invalid"
        db.commit()
    try:
        response = client.post(PREFS, headers=HEADERS, json=request)
        assert response.status_code == 409
        assert read(client)["research"] is None
    finally:
        with get_session_factory()() as db:
            db.get(
                UserAccount, uuid.UUID(request["expected_account_id"])
            ).primary_email = original
            db.commit()


def test_unconfirmed_email_cannot_subscribe_but_can_stop(client):
    request = payload(client, research=True)
    user_id = uuid.UUID(request["expected_account_id"])
    with get_session_factory()() as db:
        rows = list(
            db.scalars(select(AuthIdentity).where(AuthIdentity.user_id == user_id))
        )
        originals = [(row.id, row.email_verified_at) for row in rows]
        for row in rows:
            row.email_verified_at = None
        db.commit()
    try:
        # Use the service directly: sign-in sync can confirm the identity again.
        with get_session_factory()() as db:
            with pytest.raises(HTTPException) as error:
                service.save_preferences(db, user_id, request)
            assert error.value.status_code == 422
        with get_session_factory()() as db:
            result = service.save_preferences(
                db, user_id, {**request, "research": False}
            )
            assert result["research"] is False
    finally:
        with get_session_factory()() as db:
            for identity_id, timestamp in originals:
                db.get(AuthIdentity, identity_id).email_verified_at = timestamp
            db.commit()


def test_one_click_form_type_is_case_insensitive(client):
    client.post(PREFS, headers=HEADERS, json=payload(client, research=True))
    token = token_for(client)
    response = client.post(
        f"{PUBLIC}/one-click/{token}",
        content="List-Unsubscribe=One-Click&extra=ok\n",
        headers={"Content-Type": "Application/X-WWW-Form-Urlencoded"},
    )
    assert response.status_code == 200
    assert read(client)["research"] is False
