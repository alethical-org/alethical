"""Finance suggestions and search share matching and echo a request id."""

# ruff: noqa: F811

from __future__ import annotations

import warnings

import pytest
from sqlalchemy import text
from sqlalchemy import select
from sqlalchemy.exc import SAWarning

from alethical.api.auth import get_auth_service
from alethical.api.routers.public import pin_campaign_finance_to_one_view
from alethical.api.services import finance_access, finance_suggestions
from alethical.db.session import get_session_factory
from alethical.db import models as m
from alethical.tests.finance_fixtures import (
    FINANCE_EMAIL,
    FINANCE_SUBJECT,
    FINANCE_TOKEN,
    _ListedAccount,
    finance_api,  # noqa: F401
    finance_db,  # noqa: F401
)
from alethical.tests.test_identity_confirmations import board  # noqa: F401

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


def display_projection(money):
    """Only the fields the dropdown uses to choose rows, labels and links."""
    fields = {
        "person": ("kind", "id", "full_name", "chamber", "district_code"),
        "committee": ("kind", "name", "registration_number", "filer_kind"),
        "payment_name": ("kind", "name", "role"),
        "lobbyist": ("kind", "name", "registration_number"),
        "principal": ("kind", "name", "entity_id"),
    }
    return {
        "state": money["state"],
        "groups": [
            {
                "kind": group["kind"],
                "state": group["state"],
                "reason": group["reason"],
                "results": [
                    {field: row.get(field) for field in fields[row["kind"]]}
                    for row in group["results"]
                ],
            }
            for group in money["groups"]
        ],
    }


def test_suggestions_do_not_calculate_unused_lobbyist_donations(
    finance_api, finance_db, monkeypatch
):
    from alethical.api.services import lobbying
    from alethical.tests.test_lobbying_api import _pair

    _pair(finance_db)
    finance_db.connection()

    def unused(*args, **kwargs):
        raise AssertionError("Suggestions must not calculate annual donations")

    monkeypatch.setattr(lobbying, "annual_donations", unused)
    response = finance_api.get(SUGGEST, params={"q": "kozak", "request_id": "lean"})
    assert response.status_code == 200, response.text
    group = next(
        g
        for g in response.json()["data"]["money"]["groups"]
        if g["kind"] == "lobbyists"
    )
    assert [row["name"] for row in group["results"]] == ["Kozak, Andrew"]


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


@pytest.mark.parametrize("column", ["title", "short_title", "description"])
def test_bill_suggestions_match_literal_fragments_without_expanding_typos(
    finance_api, finance_db, column
):
    bill = finance_db.scalar(select(m.Bill).where(m.Bill.bill_key == "94-2025-SF1832"))
    bill.title = "Unrelated subject"
    bill.short_title = "Unrelated subject"
    bill.description = "Unrelated subject"
    setattr(bill, column, "Dance education")
    finance_db.flush()
    for query, present in [
        ("DANC", True),
        ("DANCH", False),
        ("danc education", True),
        ("danc housing", False),
        ("danc%", False),
        ("danc_", False),
        ("danc\\", False),
    ]:
        result = finance_api.get(SUGGEST, params={"q": query, "request_id": "literal"})
        assert result.status_code == 200, result.text
        ids = [row["id"] for row in result.json()["data"]["bills"]]
        assert (bill.bill_key in ids) is present, (column, query, ids)
    # The separate, complete search keeps its existing spelling suggestions.
    full = finance_api.get("/api/v1/search", params={"q": "DANCH", "types": "bills"})
    assert bill.bill_key in [row["id"] for row in full.json()["data"]["bills"]]


def test_a_short_query_says_so_rather_than_nothing_found(finance_api):  # noqa: F811
    money = finance_api.get(SUGGEST, params={"q": "ab", "request_id": "b"}).json()[
        "data"
    ]["money"]
    assert money["state"] == "unavailable"
    assert {group["reason"] for group in money["groups"]} == {"query_too_short"}


def test_the_money_groups_match_finances_name_search(finance_api):  # noqa: F811
    finance = finance_api.get(SUGGEST, params={"q": "committee", "request_id": "c"})
    public = finance_api.get(
        "/api/v1/finance/name-search", params={"q": "committee", "limit": 3}
    )
    assert display_projection(finance.json()["data"]["money"]) == display_projection(
        public.json()["data"]
    )


@pytest.mark.parametrize("summarized", [False, True])
def test_every_money_kind_keeps_full_search_names_order_and_source_states(
    finance_api, finance_db, board, summarized
):
    from alethical.tests.test_campaign_finance_lists_and_search import _filer, _register
    from alethical.tests.test_finance_similar_names import build_summaries, sync_counts
    from alethical.tests.test_lobbying_api import _pair

    register = _register(finance_db, filer_count=2)
    _filer(finance_db, register, "32110", name="Health Association")
    _filer(finance_db, register, "32109", name="Wealth Partners")
    _pair(finance_db, extra=5)
    sync_counts(finance_db, board)
    if summarized:
        build_summaries(finance_db, board)
    for query in [
        "exmaple",
        "example",
        "health",
        "kozak",
        "test",
        "john",
        "zzzmissing",
        "a%b",
    ]:
        finance_db.connection()
        params = {"q": query, "limit": 3}
        expected = finance_api.get("/api/v1/finance/name-search", params=params)
        actual = finance_api.get(SUGGEST, params={**params, "request_id": "equivalent"})
        assert expected.status_code == actual.status_code == 200
        assert display_projection(actual.json()["data"]["money"]) == display_projection(
            expected.json()["data"]
        ), query
        assert all(
            "total" not in group for group in actual.json()["data"]["money"]["groups"]
        )


@pytest.mark.parametrize("summarized", [False, True])
def test_direct_name_shortcut_keeps_abbreviation_eligibility(
    finance_api, finance_db, board, summarized
):
    from alethical.tests.test_finance_similar_names import (
        add_names,
        build_summaries,
        sync_counts,
    )

    add_names(
        finance_db, board, "donor", ["Health Coalition", "Health Company", "Health Co"]
    )
    sync_counts(finance_db, board)
    if summarized:
        build_summaries(finance_db, board)
    finance_db.connection()
    params = {"q": "co health", "limit": 3}
    expected = finance_api.get("/api/v1/finance/name-search", params=params).json()[
        "data"
    ]
    actual = finance_api.get(
        SUGGEST, params={**params, "request_id": "abbreviation"}
    ).json()["data"]["money"]
    assert display_projection(actual) == display_projection(expected)


def test_partial_payment_source_and_missing_lobbying_rows_stay_unavailable(
    finance_api, finance_db, board
):
    from alethical.tests.test_finance_similar_names import build_summaries, sync_counts
    from alethical.tests.test_lobbying_api import _pair

    active, _, _ = _pair(finance_db)
    sync_counts(finance_db, board)
    build_summaries(finance_db, board)
    finance_db.execute(text("DELETE FROM cf_contribution_row WHERE row_number=31"))
    finance_db.execute(
        text("DELETE FROM lobbyist_row WHERE snapshot_id=:id"), {"id": active.id}
    )
    finance_db.commit()
    finance_db.connection()
    params = {"q": "example", "limit": 3}
    expected = finance_api.get("/api/v1/finance/name-search", params=params).json()[
        "data"
    ]
    actual = finance_api.get(
        SUGGEST, params={**params, "request_id": "partial"}
    ).json()["data"]["money"]
    assert display_projection(actual) == display_projection(expected)
    groups = {group["kind"]: group for group in actual["groups"]}
    assert groups["gave"]["reason"] == "incomplete_source"
    assert groups["got_paid"]["results"]
    assert groups["lobbyists"]["reason"] == "no_lobbying_release"


def test_people_with_service_history_appear_once_with_the_current_seat(
    finance_api, finance_db
):
    from alethical.tests.test_finance_people import service_member

    member = service_member(finance_db, "suggestion-history")
    member.full_name = "Suggestion History"
    older = member.service_periods[0]
    member.service_periods.append(
        m.LegislatorServicePeriod(
            session_id=older.session_id,
            chamber_id=older.chamber_id,
            district_id=older.district_id,
            period_sequence=2,
            is_current=True,
        )
    )
    finance_db.flush()
    params = {"q": "suggestion", "limit": 3}
    expected = finance_api.get("/api/v1/finance/name-search", params=params).json()[
        "data"
    ]
    actual = finance_api.get(
        SUGGEST, params={**params, "request_id": "history"}
    ).json()["data"]["money"]
    assert display_projection(actual) == display_projection(expected)
    people = next(group for group in actual["groups"] if group["kind"] == "people")
    assert [row["id"] for row in people["results"]] == [str(member.id)]


def test_replaced_register_stays_unavailable(finance_api, finance_db):
    from alethical.tests.test_campaign_finance_lists_and_search import _register

    _register(finance_db, filer_count=2)
    finance_db.connection()
    params = {"q": "committee", "limit": 3}
    expected = finance_api.get("/api/v1/finance/name-search", params=params).json()[
        "data"
    ]
    actual = finance_api.get(
        SUGGEST, params={**params, "request_id": "register"}
    ).json()["data"]["money"]
    assert display_projection(actual) == display_projection(expected)
    group = next(group for group in actual["groups"] if group["kind"] == "committees")
    assert group["state"] == "unavailable"


@pytest.mark.parametrize("query", ["SF 1832", "health", "zzznothing"])
def test_bill_suggestions_keep_the_full_search_order_title_and_links(
    finance_api, query
):
    expected = finance_api.get(
        "/api/v1/search", params={"q": query, "types": "bills", "limit": 3}
    ).json()["data"]["bills"]
    actual = finance_api.get(SUGGEST, params={"q": query, "request_id": "bill"}).json()[
        "data"
    ]["bills"]

    def shown(rows):
        return [
            (
                row["id"],
                row.get("file_type"),
                row.get("file_number"),
                (row.get("ai_analysis") or {}).get("short_title"),
            )
            for row in rows
        ]

    assert shown(actual) == shown(expected)
    assert all("chief_sponsors" not in row for row in actual)


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
    def probe(db, q, limit):
        pin_campaign_finance_to_one_view(db)
        level = db.execute(text("SHOW transaction_isolation")).scalar()
        return {"isolation": level}

    monkeypatch.setattr(finance_suggestions, "money", probe)
    with warnings.catch_warnings():
        warnings.simplefilter("error", SAWarning)
        response = committed_listed_account.get(
            SUGGEST, params={"q": "committee", "request_id": "i"}
        )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["money"] == {"isolation": "repeatable read"}
