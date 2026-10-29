"""A graph edge is one held relation, never a chain of money."""

# ruff: noqa: F811
from decimal import Decimal

from sqlalchemy import select

from alethical.db import models as m
from alethical.db.session import get_db
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_identity_confirmations import (  # noqa: F401
    VENDOR,
    board,
    create,
    payee,
    prints,
    gift,
)
from alethical.tests.test_lobbying_api import _pair
from alethical.tests.test_finance_records import _link
from alethical.tests.test_finance_media_buys import (  # noqa: F401
    held,
    listed,
    problems,
    source,
)

BASE = "/api/v1/finance/connections"


def get(api, **params):
    api.app.dependency_overrides[get_db]().connection()
    response = api.get(BASE, params=params)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    return response.json()["data"]


def test_graph_keeps_sources_signs_missing_amounts_and_direct_edges(
    finance_api, finance_db, board
):
    finance_db.add(
        m.CampaignFinanceExpenditureRow(
            snapshot_id=board.expenditures_snapshot_id,
            row_number=53,
            committee_reg_num="18135",
            vendor_name=VENDOR,
            amount=Decimal("-200.5"),
            year=2026,
        )
    )
    finance_db.commit()
    data = get(finance_api, relationship="payments", year=2026)
    assert data["total"] == 2
    assert {(e["source"]["dataset"], e["amount"]) for e in data["edges"]} == {
        ("expenditures", "1000.0000"),
        ("independent_expenditures", "900.0000"),
    }
    assert all(e["relationship"] == "payments" for e in data["edges"])
    expenditure = next(
        e for e in data["edges"] if e["source"]["dataset"] == "expenditures"
    )
    assert expenditure["record_count"] == 2 and expenditure["undated_count"] == 1
    assert expenditure["period_basis"] == "years"
    assert expenditure["first_year"] == expenditure["last_year"] == 2026
    assert expenditure["source"]["url"] and expenditure["source"]["snapshot_id"]
    assert get(finance_api, focus=expenditure["to"])["total"] == 1
    assert get(finance_api, q="%")["total"] == 0
    paged = get(finance_api, relationship="payments", limit=1)
    assert paged["total"] == 2 and paged["has_more"] and len(paged["edges"]) == 1
    finance_db.add(
        m.CampaignFinanceExpenditureRow(
            snapshot_id=board.expenditures_snapshot_id,
            row_number=54,
            committee_reg_num="18135",
            vendor_name=VENDOR,
            amount=None,
            year=2026,
        )
    )
    finance_db.commit()
    row = next(
        e
        for e in get(finance_api, relationship="payments")["edges"]
        if e["source"]["dataset"] == "expenditures"
    )
    assert row["amount"] is None and row["amount_state"] == "incomplete"


def test_graph_resolves_only_confirmed_fingerprints(finance_api, finance_db, board):
    selected = prints(finance_api, "payee_name", VENDOR)
    entity = create(
        finance_api, "organization", "Confirmed firm", payee(board, [selected[52]])
    )
    finance_db.add(
        m.CampaignFinanceExpenditureRow(
            snapshot_id=board.expenditures_snapshot_id,
            row_number=53,
            committee_reg_num="18135",
            vendor_name=VENDOR,
            amount=Decimal("20"),
            year=2026,
        )
    )
    finance_db.commit()
    data = get(finance_api, relationship="payments")
    assert data["total"] == 3
    identified = next(n for n in data["nodes"] if n["kind"] == "organization")
    assert identified["record_id"] == entity["id"]
    assert identified["target"] == {"kind": "identity", "id": entity["id"]}
    edge = next(e for e in data["edges"] if e["to"] == identified["key"])
    assert edge["amount"] == "1200.5000"
    assert any(n["kind"] == "printed_name" for n in data["nodes"])
    assert get(finance_api, focus=identified["key"])["total"] == 1
    confirmation = entity["confirmations"][0]
    assert (
        finance_api.post(
            f"/api/v1/finance/identities/confirmations/{confirmation['id']}/withdraw",
            json={"reason": "Wrong organization"},
        ).status_code
        == 200
    )
    assert get(finance_api, focus=identified["key"])["total"] == 0


def test_station_graph_has_exact_source_checks_and_never_file_money(
    finance_api, held, listed
):
    data = get(finance_api, relationship="station_agency")
    assert data["total"] == 1
    row = data["edges"][0]
    assert row["amount"] is None and row["amount_state"] == "not_applicable"
    assert row["source"]["file_key"] == held["key"]
    assert row["source"]["version_id"] == held["document"].content_hash
    assert row["source"]["page"] == 1 and row["source"]["quote"]
    assert not problems(data)
    fact = listed.scalar(select(m.TVAdFact).where(m.TVAdFact.field == "agency_name"))
    listed.add(
        m.FinanceTVCopyWithdrawal(
            fact_id=fact.id,
            withdrawn_at=fact.checked_at,
            withdrawal_reason="Synthetic withdrawal",
        )
    )
    listed.commit()
    assert get(finance_api, relationship="station_agency")["total"] == 0
    assert get(finance_api, relationship="payments")["state"] == "unavailable"
    finance_api.headers.pop("Authorization")
    assert finance_api.get(BASE).status_code == 401


def test_graph_contributions_exclude_loans_and_keep_each_page_exact(
    finance_api, finance_db, board
):
    finance_db.add(
        gift(
            board.contributions_snapshot_id,
            35,
            receipt_type="Loan Payable",
            amount=Decimal("9000"),
        )
    )
    finance_db.add(gift(board.contributions_snapshot_id, 36, amount=Decimal("-100")))
    finance_db.commit()
    data = get(finance_api, relationship="contributions", year=2026)
    assert data["total"] == 2
    assert sorted(e["amount"] for e in data["edges"]) == ["250.0000", "400.0000"]
    all_edges = get(finance_api)["edges"]
    pages = [
        get(finance_api, limit=1, offset=i)["edges"][0] for i in range(len(all_edges))
    ]
    assert [e["id"] for e in pages] == [e["id"] for e in all_edges]


def test_non_money_relations_do_not_invent_amounts_or_historical_periods(
    finance_api, finance_db
):
    active, _, _ = _pair(finance_db)
    member = finance_db.scalar(select(m.Legislator))
    _link(finance_db, member, "18001", m.CommitteeLinkReviewDecision.confirmed)
    _link(finance_db, member, "18002", m.CommitteeLinkReviewDecision.withdrawn)
    finance_db.commit()
    accounts = get(finance_api, relationship="campaign_account")
    assert accounts["total"] == 1
    assert accounts["edges"][0]["amount_state"] == "not_applicable"
    assert get(finance_api, relationship="campaign_account", year=2026)["total"] == 0
    lobby = get(finance_api, relationship="lobbying_representation")
    assert lobby["total"] == active.association_count
    assert all(e["amount"] is None for e in lobby["edges"])
    assert (
        get(finance_api, relationship="lobbying_representation", year=2001)["total"]
        == 0
    )


def test_graph_withholds_sum_without_complete_period_and_rejects_nul(
    finance_api, finance_db, board
):
    finance_db.add(
        m.CampaignFinanceExpenditureRow(
            snapshot_id=board.expenditures_snapshot_id,
            row_number=99,
            committee_reg_num="18135",
            vendor_name="No period",
            amount=Decimal("30"),
        )
    )
    finance_db.commit()
    edge = get(finance_api, q="No period")["edges"][0]
    assert edge["amount"] is None and edge["amount_state"] == "incomplete_period"
    assert edge["period_basis"] == "unknown"
    for field in ("q", "focus"):
        assert finance_api.get(BASE, params={field: "bad\x00input"}).status_code == 422
