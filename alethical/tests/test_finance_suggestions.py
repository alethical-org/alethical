"""Finance's grouped suggestions reuse alethical.com's searches and echo a request id."""

from __future__ import annotations

from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401

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
