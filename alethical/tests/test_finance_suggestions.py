"""Finance's grouped suggestions reuse alethical.com's searches and echo a request id."""

from __future__ import annotations

import warnings
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.exc import SAWarning

from alethical.api.auth import get_auth_service
from alethical.api.routers import finance as finance_router
from alethical.api.routers.public import pin_campaign_finance_to_one_view
from alethical.api.services import finance_access
from alethical.db.session import get_session_factory
from alethical.tests.finance_fixtures import (
    FINANCE_EMAIL,
    FINANCE_SUBJECT,
    FINANCE_TOKEN,
    _ListedAccount,
    finance_api,  # noqa: F401
    finance_db,  # noqa: F401
)

SUGGEST = "/api/v1/finance/suggestions"
MONEY_GROUPS = [
    "people",
    "committees",
    "gave",
    "got_paid",
    "got_paid_independent",
    "lobbyists",
    "principals",
]


def test_the_reply_carries_its_request_id_and_every_money_group(finance_api):  # noqa: F811
    response = finance_api.get(SUGGEST, params={"q": "1832", "request_id": "r-7"})
    assert response.status_code == 200, response.text
    assert "no-store" in response.headers["cache-control"]
    data = response.json()["data"]
    assert data["request_id"] == "r-7"
    assert data["q"] == "1832"
    assert [group["kind"] for group in data["money"]["groups"]] == MONEY_GROUPS
    assert isinstance(data["bills"], list)


def test_a_bill_number_finds_its_bill(finance_api):  # noqa: F811
    data = finance_api.get(SUGGEST, params={"q": "SF 1832", "request_id": "a"}).json()
    assert [bill["id"] for bill in data["data"]["bills"]] == ["94-2025-SF1832"]


def test_a_short_query_says_so_rather_than_nothing_found(finance_api):  # noqa: F811
    money = finance_api.get(SUGGEST, params={"q": "ab", "request_id": "b"}).json()[
        "data"
    ]["money"]
    assert money["state"] == "unavailable"
    assert {group["reason"] for group in money["groups"]} == {"query_too_short"}


def test_the_money_groups_match_alethical_coms_own_search(finance_api):  # noqa: F811
    finance = finance_api.get(SUGGEST, params={"q": "committee", "request_id": "c"})
    public = finance_api.get(
        "/api/v1/campaign-finance/search", params={"q": "committee", "limit": 3}
    )
    strip = lambda data: {  # noqa: E731
        key: value for key, value in data.items() if key != "current_claim_validated_at"
    }
    assert strip(finance.json()["data"]["money"]) == strip(public.json()["data"])


def test_a_request_id_must_be_a_plain_token(finance_api):  # noqa: F811
    for bad in ["", "has space", "x" * 65, "<script>"]:
        response = finance_api.get(SUGGEST, params={"q": "abc", "request_id": bad})
        assert response.status_code == 422


def test_suggestions_need_finance_access(client):
    response = client.get(SUGGEST, params={"q": "abc", "request_id": "d"})
    assert response.status_code == 401


def test_a_blank_or_short_query_suggests_no_bills(finance_api):  # noqa: F811
    for q in ["   ", "SF", " ab "]:
        data = finance_api.get(SUGGEST, params={"q": q, "request_id": "e"}).json()
        assert data["data"]["bills"] == []
        assert data["data"]["money"]["state"] == "unavailable"


def test_query_and_limit_bounds_are_enforced(finance_api):  # noqa: F811
    assert (
        finance_api.get(SUGGEST, params={"q": "x" * 201, "request_id": "f"}).status_code
        == 422
    )
    for limit in ("0", "11"):
        response = finance_api.get(
            SUGGEST, params={"q": "abc", "request_id": "f", "limit": limit}
        )
        assert response.status_code == 422
    data = finance_api.get(
        SUGGEST, params={"q": "committee", "request_id": "g", "limit": 1}
    ).json()["data"]
    assert all(len(group["results"]) <= 1 for group in data["money"]["groups"])


def test_an_unlisted_account_gets_no_suggestions(finance_api, finance_db):  # noqa: F811
    finance_access.revoke(finance_db, FINANCE_EMAIL)
    response = finance_api.get(SUGGEST, params={"q": "abc", "request_id": "h"})
    assert response.status_code == 403


@pytest.fixture()
def committed_listed_account(client, seed_database):
    """A listed account written for real, so requests use their own sessions."""
    factory = get_session_factory()
    with factory() as session:
        session.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
        session.execute(
            text("""CREATE TABLE IF NOT EXISTS auth.users (
            id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
            deleted_at timestamptz, banned_until timestamptz,
            is_anonymous boolean NOT NULL DEFAULT false)""")
        )
        session.execute(
            text("""INSERT INTO auth.users (id, email, email_confirmed_at)
            VALUES (:id, :email, CURRENT_TIMESTAMP) ON CONFLICT (id) DO NOTHING"""),
            {"id": FINANCE_SUBJECT, "email": FINANCE_EMAIL},
        )
        finance_access.grant(session, FINANCE_EMAIL, team=False)
        session.commit()
    client.app.dependency_overrides[get_auth_service] = lambda: _ListedAccount()
    client.headers["Authorization"] = f"Bearer {FINANCE_TOKEN}"
    yield client
    with factory() as session:
        session.execute(
            text("DELETE FROM finance_access_entry WHERE email = :e"),
            {"e": FINANCE_EMAIL},
        )
        session.execute(
            text("DELETE FROM auth.users WHERE id = :id"), {"id": FINANCE_SUBJECT}
        )
        session.commit()


def test_the_money_search_keeps_its_single_instant_read(
    committed_listed_account, monkeypatch
):
    # The access check reads the list first; the money search must still get
    # its own REPEATABLE READ transaction, as it does on alethical.com.
    def probe(q, limit, db):
        pin_campaign_finance_to_one_view(db)
        level = db.execute(text("SHOW transaction_isolation")).scalar()
        return SimpleNamespace(data={"isolation": level})

    monkeypatch.setattr(finance_router, "campaign_finance_search", probe)
    with warnings.catch_warnings():
        warnings.simplefilter("error", SAWarning)
        response = committed_listed_account.get(
            SUGGEST, params={"q": "committee", "request_id": "i"}
        )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["money"] == {"isolation": "repeatable read"}
