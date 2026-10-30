"""Finance identity browsing stays grounded in exact source rows and saved claims."""

# ruff: noqa: F811 -- pytest fixtures arrive as parameters named after the imports

from datetime import date
from decimal import Decimal

from sqlalchemy import text

from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_identity_confirmations import (  # noqa: F401
    BASE,
    DONOR,
    VENDOR,
    board,
    create,
    donor,
    gift,
    prints,
)


def queue(api, **params):
    response = api.get(BASE + "/queue", params=params)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    return response.json()["data"]


def test_queue_keeps_names_and_payment_sources_distinct(finance_api, board):
    data = queue(finance_api, status="all", page_size=2)
    assert (data["total"], data["pages"]) == (4, 2)
    assert [(r["record_kind"], r["name"]) for r in data["rows"]] == [
        ("payee_name", VENDOR),
        ("independent_payee_name", VENDOR),
    ]
    assert [Decimal(r["amount"]) for r in data["rows"]] == [
        Decimal("1200.5"),
        Decimal("900"),
    ]
    assert all(
        row["confirmed"] == 0 and row["source_url"] and row["copied_at"]
        for row in data["rows"]
    )
    second = queue(finance_api, status="all", page_size=2, page=2)
    assert second["rows"][0]["record_key"] == DONOR
    row = second["rows"][0]
    assert (
        row["records"],
        row["first_year"],
        row["last_year"],
        row["first_date"],
        row["last_date"],
    ) == (3, 2025, 2026, "2025-05-01", "2026-03-02")
    assert {
        r["record_kind"]
        for r in queue(finance_api, record_type="payee", status="all")["rows"]
    } == {"payee_name", "independent_payee_name"}
    assert all(
        r["record_kind"] == "donor_name"
        for r in queue(finance_api, record_type="donor")["rows"]
    )


def test_queue_status_counts_only_current_confirmed_records(
    finance_api, finance_db, board
):
    selected = prints(finance_api)
    person = create(finance_api, "person", DONOR, donor(board, [selected[31]]))
    partial = queue(finance_api, q=DONOR)["rows"][0]
    assert (partial["confirmed"], partial["records"]) == (2, 3)
    assert queue(finance_api, q=DONOR, status="confirmed")["rows"] == []
    response = finance_api.post(
        BASE + "/" + person["id"] + "/confirmations", json=donor(board, [selected[32]])
    )
    assert response.status_code == 201
    assert queue(finance_api, q=DONOR)["rows"] == []
    assert queue(finance_api, q=DONOR, status="confirmed")["rows"][0]["confirmed"] == 3
    confirmation = response.json()["data"]["confirmations"][0]
    assert (
        finance_api.post(
            BASE + "/confirmations/" + confirmation["id"] + "/withdraw",
            json={"reason": "Wrong person"},
        ).status_code
        == 200
    )
    assert queue(finance_api, q=DONOR)["rows"][0]["confirmed"] < 3
    finance_db.execute(text("DELETE FROM cf_current_release"))
    finance_db.commit()
    assert finance_api.get(BASE + "/queue").status_code == 503


def test_queue_withholds_incomplete_amounts_and_never_invents_a_period(
    finance_api, finance_db, board
):
    finance_db.add(
        gift(
            board.contributions_snapshot_id,
            101,
            contributor="Incomplete",
            amount=None,
            year=None,
            receipt_date=None,
        )
    )
    finance_db.add(
        gift(
            board.contributions_snapshot_id,
            102,
            contributor="Incomplete",
            amount=Decimal("10"),
            year=None,
            receipt_date=None,
        )
    )
    finance_db.commit()
    row = queue(finance_api, q="Incomplete")["rows"][0]
    assert (
        row["amount"],
        row["missing_amounts"],
        row["first_year"],
        row["last_year"],
        row["first_date"],
        row["last_date"],
    ) == (None, 1, None, None, None, None)
    assert queue(finance_api, q="%")["rows"] == []


def test_entity_search_returns_saved_active_identities_without_private_fields(
    finance_api, board
):
    records = prints(finance_api)
    one = create(finance_api, "person", "Exact Name", donor(board, [records[31]]))
    two = create(
        finance_api, "organization", "Exact Organization", donor(board, [records[32]])
    )
    response = finance_api.get(BASE, params={"q": "Exact", "page_size": 1})
    assert response.status_code == 200
    data = response.json()["data"]
    assert (data["total"], data["pages"]) == (2, 2)
    assert data["rows"] == [{"id": one["id"], "kind": "person", "name": "Exact Name"}]
    response = finance_api.get(BASE, params={"q": "Exact", "kind": "organization"})
    assert response.json()["data"]["rows"] == [
        {"id": two["id"], "kind": "organization", "name": "Exact Organization"}
    ]
    assert finance_api.get(BASE, params={"q": "%"}).json()["data"]["rows"] == []


def test_entity_search_hides_merged_and_split_parents(finance_api, board):
    records = prints(finance_api)
    one = create(finance_api, "person", "Old identity", donor(board, [records[31]]))
    two = create(finance_api, "person", "Current identity", donor(board, [records[32]]))
    response = finance_api.post(
        BASE + "/" + one["id"] + "/merge",
        json={"into": two["id"], "reason": "Evidence establishes the same person"},
    )
    assert response.status_code == 200
    data = finance_api.get(BASE).json()["data"]
    assert [r["id"] for r in data["rows"]] == [two["id"]]
    confirmed = finance_api.get(BASE + "/" + two["id"]).json()["data"]["confirmations"]
    response = finance_api.post(
        BASE + "/" + two["id"] + "/split",
        json={
            "reason": "Separate source records",
            "parts": [
                {"name": "First identity", "confirmations": [confirmed[0]["id"]]},
                {"name": "Second identity", "confirmations": [confirmed[1]["id"]]},
            ],
        },
    )
    assert response.status_code == 200
    response = finance_api.get(BASE)
    assert response.headers["cache-control"] == "private, no-store"
    data = response.json()["data"]
    assert {r["name"] for r in data["rows"]} == {"First identity", "Second identity"}
    empty = finance_api.get(BASE, params={"page": 99}).json()["data"]
    assert empty["total"] == 2 and empty["rows"] == []


def test_identity_directory_rejects_unsupported_filters(finance_api, board):
    for params in (
        {"record_type": "employer"},
        {"status": "suggested"},
        {"page": 0},
        {"page_size": 101},
    ):
        assert finance_api.get(BASE + "/queue", params=params).status_code == 422
    assert finance_api.get(BASE, params={"kind": "committee"}).status_code == 422
    missing = queue(finance_api, q="No such printed name", page=99)
    assert missing["total"] == 0 and missing["rows"] == []


def test_a_complete_amount_without_any_record_period_is_withheld(
    finance_api, finance_db, board
):
    finance_db.add(
        gift(
            board.contributions_snapshot_id,
            103,
            contributor="Undated",
            amount=Decimal("10"),
            year=None,
            receipt_date=None,
        )
    )
    finance_db.commit()
    row = queue(finance_api, q="Undated")["rows"][0]
    assert (
        row["amount"] is None
        and row["missing_amounts"] == 0
        and row["undated_records"] == 1
    )


def test_identity_directory_reads_require_finance_access(client):
    assert client.get(BASE).status_code == 401
    assert client.get(BASE + "/queue").status_code == 401


def test_directory_search_refuses_text_the_database_cannot_store(finance_api, board):
    for path in (BASE, BASE + "/queue"):
        response = finance_api.get(path, params={"q": "Name\x00"})
        assert response.status_code == 422
        assert "cannot be saved" in response.json()["detail"]


def test_queue_requires_one_complete_period_basis(finance_api, finance_db, board):
    examples = [
        ("Mixed sparse", 2025, None),
        ("Mixed sparse", None, date(2026, 4, 1)),
        ("Year span", 2025, None),
        ("Year span", 2026, date(2026, 4, 1)),
        ("Date span", None, date(2025, 4, 1)),
        ("Date span", 2026, date(2026, 4, 1)),
        ("Conflicting years", 2025, date(2026, 4, 1)),
        ("Conflicting years", 2024, None),
    ]
    for row_number, (name, year, receipt_date) in enumerate(examples, start=200):
        finance_db.add(
            gift(
                board.contributions_snapshot_id,
                row_number,
                contributor=name,
                amount=Decimal("10"),
                year=year,
                receipt_date=receipt_date,
            )
        )
    finance_db.commit()
    sparse = queue(finance_api, q="Mixed sparse")["rows"][0]
    assert sparse["amount"] is None
    assert sparse["amount_state"] == "incomplete_period"
    assert sparse["period_basis"] is None
    assert sparse["undated_records"] == 0
    years = queue(finance_api, q="Year span")["rows"][0]
    assert Decimal(years["amount"]) == Decimal("20")
    assert (
        years["amount_state"],
        years["period_basis"],
        years["first_year"],
        years["last_year"],
    ) == ("reported", "years", 2025, 2026)
    dates = queue(finance_api, q="Date span")["rows"][0]
    assert Decimal(dates["amount"]) == Decimal("20")
    assert (dates["period_basis"], dates["first_date"], dates["last_date"]) == (
        "dates",
        "2025-04-01",
        "2026-04-01",
    )
    conflicting = queue(finance_api, q="Conflicting years")["rows"][0]
    assert (
        conflicting["period_basis"],
        conflicting["first_year"],
        conflicting["last_year"],
    ) == ("years", 2024, 2025)
    assert conflicting["first_date"] == "2026-04-01"
