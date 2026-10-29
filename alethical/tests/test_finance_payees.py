"""Payee directories keep each source and confirmation's covered records separate."""

# ruff: noqa: F811
from datetime import date
from decimal import Decimal

from alethical.db import models as m
from alethical.db.session import get_db
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_identity_confirmations import (  # noqa: F401
    board,
    create,
    payee,
    prints,
    VENDOR,
)

BASE = "/api/v1/finance/payees"


def get(api, **params):
    # This fixture owns an outer transaction; acquire its connection before the
    # production pin, which runs before any data read on real request sessions.
    api.app.dependency_overrides[get_db]().connection()
    response = api.get(BASE, params=params)
    assert response.status_code == 200, response.text
    assert "no-store" in response.headers["cache-control"]
    return response.json()["data"]


def test_payees_preserve_signed_amounts_sources_missing_and_period(
    finance_api, finance_db, board
):
    finance_db.add_all(
        [
            m.CampaignFinanceExpenditureRow(
                snapshot_id=board.expenditures_snapshot_id,
                row_number=53,
                committee_reg_num="18135",
                vendor_name=VENDOR,
                amount=Decimal("-200.5"),
                transaction_date=date(2026, 4, 2),
                year=2026,
                type="Refund",
            ),
            m.CampaignFinanceExpenditureRow(
                snapshot_id=board.expenditures_snapshot_id,
                row_number=54,
                committee_reg_num="18135",
                vendor_name="Missing amount",
                amount=None,
                transaction_date=None,
                year=2026,
            ),
        ]
    )
    finance_db.commit()
    data = get(finance_api, q="Example Media", year=2026)
    rows = data["rows"]
    assert data["total"] == 2 and data["payment_count"] == 3
    assert {(r["dataset"], r["amount"], r["payment_count"]) for r in rows} == {
        ("expenditures", "1000.0000", 2),
        ("independent_expenditures", "900.0000", 1),
    }
    assert all(
        r["identity"] is None and r["record_kind"] == "printed_name" for r in rows
    )
    assert all(r["source_url"] and r["snapshot_id"] for r in rows)
    row = next(r for r in rows if r["role"] == "vendor")
    assert (row["first_payment_on"], row["last_payment_on"]) == (
        "2026-04-01",
        "2026-04-02",
    )
    missing = get(finance_api, q="Missing")["rows"][0]
    assert missing["amount"] is None and missing["amount_state"] == "incomplete"
    assert missing["undated_payment_count"] == 1
    refund = get(finance_api, payment_type="Refund")["rows"][0]
    assert refund["amount"] == "-200.5000"
    assert get(finance_api, q="Example Media", offset=100)["total"] == 2


def test_payees_confirm_only_selected_current_fingerprints_and_follow_withdrawal(
    finance_api, finance_db, board
):
    fingerprints = prints(finance_api, "payee_name", VENDOR)
    entity = create(
        finance_api, "organization", "Confirmed firm", payee(board, [fingerprints[52]])
    )
    finance_db.add(
        m.CampaignFinanceExpenditureRow(
            snapshot_id=board.expenditures_snapshot_id,
            row_number=53,
            committee_reg_num="18135",
            vendor_name=VENDOR,
            amount=Decimal("20"),
            transaction_date=date(2026, 4, 2),
            year=2026,
        )
    )
    finance_db.commit()
    confirmed = get(finance_api, tab="confirmed")
    assert confirmed["total"] == 1
    assert confirmed["counts"] == {"all": 3, "confirmed": 1, "printed": 2}
    assert confirmed["rows"][0]["identity"]["id"] == entity["id"]
    assert confirmed["rows"][0]["amount"] == "1200.5000"
    assert confirmed["rows"][0]["payment_count"] == 1
    printed = get(finance_api, q="Example Media", tab="printed")
    assert printed["counts"] == {"all": 2, "confirmed": 0, "printed": 2}
    assert {(r["role"], r["amount"]) for r in printed["rows"]} == {
        ("vendor", "20.0000"),
        ("independent_vendor", "900.0000"),
    }
    confirmation = entity["confirmations"][0]
    response = finance_api.post(
        f"/api/v1/finance/identities/confirmations/{confirmation['id']}/withdraw",
        json={"reason": "Wrong firm"},
    )
    assert response.status_code == 200, response.text
    assert get(finance_api, tab="confirmed")["total"] == 0
    assert get(finance_api, q="Example Media", tab="printed")["payment_count"] == 3


def test_payees_require_access_and_keep_unavailable_distinct(finance_api, finance_db):
    data = get(finance_api)
    assert data["state"] == "unavailable" and data["total"] is None
    finance_api.headers.pop("Authorization")
    assert finance_api.get(BASE).status_code == 401


def test_payees_merge_follows_identity_and_name_search_is_literal(
    finance_api, finance_db, board
):
    fingerprints = prints(finance_api, "payee_name", VENDOR)
    entity = create(
        finance_api, "organization", "Original firm", payee(board, [fingerprints[52]])
    )
    # A separate row supports the destination identity. Equal names alone do not.
    finance_db.add(
        m.CampaignFinanceExpenditureRow(
            snapshot_id=board.expenditures_snapshot_id,
            row_number=53,
            committee_reg_num="18135",
            vendor_name="Other Media LLC",
            amount=Decimal("10"),
            transaction_date=date(2026, 4, 3),
            year=2026,
        )
    )
    finance_db.commit()
    fingerprints = prints(finance_api, "payee_name", "Other Media LLC")
    confirmation = {
        **payee(board, [fingerprints[53]]),
        "record_key": "Other Media LLC",
        "evidence_locator": 53,
        "evidence_quote": "Other Media LLC",
    }
    other = create(finance_api, "organization", "Other firm", confirmation)
    response = finance_api.post(
        f"/api/v1/finance/identities/{entity['id']}/merge",
        json={"into": other["id"], "reason": "Same organization"},
    )
    assert response.status_code == 200, response.text
    data = get(finance_api, tab="confirmed")
    assert data["total"] == 1
    assert data["rows"][0]["identity"]["id"] == other["id"]
    assert data["rows"][0]["amount"] == "1210.5000"
    assert get(finance_api, q="%")["total"] == 0


def test_confirmed_people_are_people_in_all_recipients_never_vendors(
    finance_api, board
):
    fingerprints = prints(finance_api, "payee_name", VENDOR)
    entity = create(
        finance_api, "person", "Confirmed person", payee(board, [fingerprints[52]])
    )
    data = get(finance_api)
    assert data["counts"] == {"all": 2, "confirmed": 0, "printed": 1}
    person = next(row for row in data["rows"] if row["identity"])
    assert person["record_kind"] == "confirmed_person"
    assert person["identity"] == {
        "id": entity["id"],
        "name": "Confirmed person",
        "kind": "person",
    }
    assert person["amount"] == "1200.5000"
    assert get(finance_api, tab="confirmed")["total"] == 0
    printed = get(finance_api, tab="printed")
    assert printed["total"] == 1
    assert printed["counts"] == data["counts"]
