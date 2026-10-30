"""A graph edge is one held relation, never a chain of money."""

# ruff: noqa: F811
from decimal import Decimal

import pytest
from sqlalchemy import delete, event, insert, select

from alethical.db import models as m
from alethical.db.session import get_db
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_identity_confirmations import (  # noqa: F401
    VENDOR,
    board,
    create,
    committee,
    payee,
    prints,
    gift,
    registered,
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


def test_first_graph_page_builds_only_requested_money_edges(
    finance_api, finance_db, board, monkeypatch
):
    from alethical.api.services import finance_connections as graph

    _pair(finance_db)
    built = []
    build = graph._edge

    def record(relation, *args, **kwargs):
        if relation in {"contributions", "payments"}:
            built.append(kwargs["key"])
        return build(relation, *args, **kwargs)

    monkeypatch.setattr(graph, "_edge", record)
    data = get(finance_api, limit=1)
    assert data["total"] > 1 and len(data["edges"]) == 1
    assert len(built) == 1


def test_graph_counts_and_pages_money_groups_in_one_statement(
    finance_api, finance_db, board
):
    statements = []
    connection = finance_db.connection()

    def record(conn, cursor, statement, parameters, context, executemany):
        if "GROUP BY" in statement and "cf_expenditure_row" in statement:
            statements.append(statement)

    event.listen(connection, "before_cursor_execute", record)
    try:
        data = get(finance_api, relationship="payments", limit=1)
    finally:
        event.remove(connection, "before_cursor_execute", record)
    assert data["total"] > 1 and len(data["edges"]) == 1
    assert len(statements) == 1


@pytest.mark.parametrize("relationship", ["contributions", "payments"])
def test_large_held_filer_set_keeps_graph_statement_bounded(
    finance_api, finance_db, board, monkeypatch, relationship
):
    from alethical.api.services import finance_connections as graph

    numbers = frozenset(str(number) for number in range(100000, 102000))
    monkeypatch.setattr(graph, "linkable_committees", lambda *args: numbers)
    statements = []
    connection = finance_db.connection()
    table = (
        "cf_contribution_row"
        if relationship == "contributions"
        else "cf_expenditure_row"
    )

    def record(conn, cursor, statement, parameters, context, executemany):
        if "GROUP BY" in statement and table in statement:
            statements.append((len(statement), len(parameters)))

    event.listen(connection, "before_cursor_execute", record)
    try:
        data = get(finance_api, relationship=relationship, limit=1)
    finally:
        event.remove(connection, "before_cursor_execute", record)
    assert data["edges"]
    assert statements and all(
        size < 30000 and params < 200 for size, params in statements
    )


def test_graph_reads_payment_years_and_transfer_numbers_in_one_scan(
    finance_api, finance_db, board
):
    statements = []
    connection = finance_db.connection()

    def record(conn, cursor, statement, parameters, context, executemany):
        if (
            "FROM cf_expenditure_row" in statement
            and "GROUP BY" not in statement
            and "graph_keys AS" not in statement
            and "EXISTS" not in statement
            and (
                "affected_committee_reg_num" in statement
                or "cf_expenditure_row.year" in statement
            )
        ):
            statements.append(statement)

    event.listen(connection, "before_cursor_execute", record)
    try:
        data = get(finance_api, relationship="payments", limit=1)
    finally:
        event.remove(connection, "before_cursor_execute", record)
    assert data["years"]
    assert len(statements) == 1


def test_graph_payment_metadata_keeps_all_years_and_only_transfer_numbers(
    finance_api, finance_db, board, monkeypatch
):
    from alethical.api.services import finance_connections as graph

    for row_number, fields in enumerate(
        [
            {"year": 1990},  # No recipient, still part of the year choices.
            {"year": 1991, "type": "Payment", "affected_committee_reg_num": "ordinary"},
            {"year": 1992, "type": "Contribution", "affected_committee_reg_num": "0"},
            {"year": 1993, "type": "Contribution", "affected_committee_name": "Named"},
            {
                "year": 1994,
                "type": "Contribution",
                "affected_committee_reg_num": "held",
            },
            {
                "year": None,
                "type": "Contribution",
                "affected_committee_reg_num": "undated",
            },
        ],
        100,
    ):
        finance_db.add(
            m.CampaignFinanceExpenditureRow(
                snapshot_id=board.expenditures_snapshot_id,
                row_number=row_number,
                committee_reg_num="18135",
                **fields,
            )
        )
    finance_db.commit()
    collected = []

    def linkable(db, release, numbers):
        collected.append(set(numbers))
        return frozenset()

    monkeypatch.setattr(graph, "linkable_committees", linkable)
    result = get(finance_api, relationship="payments", q="No matching name", year=2026)
    assert result["edges"] == []
    assert set(result["years"]) == {1990, 1991, 1992, 1993, 1994, 2026}
    assert collected[0] == {"held", "undated"}

    finance_db.execute(
        delete(m.CampaignFinanceExpenditureRow).where(
            m.CampaignFinanceExpenditureRow.snapshot_id
            == board.expenditures_snapshot_id
        )
    )
    finance_db.commit()
    collected.clear()
    empty = get(finance_api, relationship="payments")
    assert empty["years"] == [2026]  # Independent expenditure still has its year.
    assert collected[0] == set()


def test_committee_transfer_targets_filed_recipient_not_processor(
    finance_api, finance_db, board
):
    # A confirmed processor must not replace the transfer's separately named recipient.
    selected = prints(finance_api, "payee_name", VENDOR)
    create(
        finance_api, "organization", "Confirmed processor", payee(board, [selected[52]])
    )
    original = finance_db.scalar(
        select(m.CampaignFinanceExpenditureRow).where(
            m.CampaignFinanceExpenditureRow.snapshot_id
            == board.expenditures_snapshot_id,
            m.CampaignFinanceExpenditureRow.row_number == 52,
        )
    )
    original.type = "Contribution"
    original.affected_committee_name = "Recipient committee"
    original.affected_committee_reg_num = "99998"
    for number, vendor in ((101, None),):
        finance_db.add(
            m.CampaignFinanceExpenditureRow(
                snapshot_id=board.expenditures_snapshot_id,
                row_number=number,
                committee_reg_num="18135",
                vendor_name=vendor,
                type="Contribution",
                affected_committee_name="Recipient committee",
                affected_committee_reg_num="99998",
                year=2026,
                amount=Decimal("50"),
            )
        )
    finance_db.commit()
    data = get(finance_api, relationship="payments", q="Recipient committee")
    assert data["total"] == 1
    edge = data["edges"][0]
    recipient = next(n for n in data["nodes"] if n["key"] == edge["to"])
    assert recipient["label"] == "Recipient committee"
    assert recipient["kind"] == "printed_name"
    assert recipient["target"] is None  # No filer held for this registration.
    assert edge["record_count"] == 2 and Decimal(edge["amount"]) == Decimal("1250.5")
    finance_db.add(
        gift(board.contributions_snapshot_id, 101, recipient_reg_num="99998")
    )
    finance_db.commit()
    linked = get(finance_api, relationship="payments", q="Recipient committee")
    recipient = next(n for n in linked["nodes"] if n["record_id"] == "99998")
    assert recipient["kind"] == "committee"
    assert recipient["target"] == {"kind": "committee", "id": "99998"}
    assert linked["edges"][0]["record_count"] == 2


def test_graph_pages_match_full_result_for_mixed_case_and_punctuation(
    finance_api, finance_db, board
):
    for number, name in enumerate(["aaaa", "ZZZZ", "____", "zzzz", "AAAA"], 100):
        finance_db.add(
            m.CampaignFinanceExpenditureRow(
                snapshot_id=board.expenditures_snapshot_id,
                row_number=number,
                committee_reg_num="18135",
                vendor_name=name,
                year=2026,
                amount=Decimal("1"),
            )
        )
    finance_db.commit()
    whole = get(finance_api, relationship="payments")["edges"]
    pages = [
        get(finance_api, relationship="payments", limit=1, offset=i)["edges"][0]
        for i in range(len(whole))
    ]
    assert [edge["id"] for edge in pages] == [edge["id"] for edge in whole]


def test_graph_pages_keep_same_identity_with_distinct_roles(
    finance_api, finance_db, board, registered
):
    original = finance_db.get(
        m.CampaignFinanceExpenditureRow, (board.expenditures_snapshot_id, 52)
    )
    original.committee_reg_num = "40100"
    finance_db.commit()
    entity = create(
        finance_api, "organization", "Recipient and vendor", committee(registered)
    )
    selected = prints(finance_api, "payee_name", VENDOR)
    response = finance_api.post(
        f"/api/v1/finance/identities/{entity['id']}/confirmations",
        json=payee(board, [selected[52]]),
    )
    assert response.status_code == 201, response.text
    finance_db.add(
        m.CampaignFinanceExpenditureRow(
            snapshot_id=board.expenditures_snapshot_id,
            row_number=101,
            committee_reg_num="40100",
            type="Contribution",
            affected_committee_name="Example for Senate",
            affected_committee_reg_num="18135",
            year=2026,
            amount=Decimal("50"),
        )
    )
    finance_db.commit()
    filters = {"relationship": "payments", "focus": "identity:" + entity["id"]}
    whole = get(finance_api, **filters)["edges"]
    assert len(whole) == 2
    assert len({(edge["from"], edge["to"]) for edge in whole}) == 1
    assert [Decimal(edge["amount"]) for edge in whole] == [
        Decimal("50"),
        Decimal("1200.5"),
    ]
    pages = [
        get(finance_api, **filters, limit=1, offset=i)["edges"][0]
        for i in range(len(whole))
    ]
    assert [edge["id"] for edge in pages] == [edge["id"] for edge in whole]

    broad = get(finance_api, relationship="payments", limit=200)
    broad_pages = [
        edge
        for i in range(broad["total"])
        for edge in get(finance_api, relationship="payments", limit=1, offset=i)[
            "edges"
        ]
    ]
    assert broad_pages == broad["edges"]
    assert [
        edge for edge in broad_pages if edge["to"] == "identity:" + entity["id"]
    ] == whole


def test_deep_graph_page_is_reachable_without_building_preceding_edges(
    finance_api, finance_db, board, monkeypatch
):
    from alethical.api.services import finance_connections as graph

    finance_db.execute(
        insert(m.CampaignFinanceExpenditureRow),
        [
            {
                "snapshot_id": board.expenditures_snapshot_id,
                "row_number": 100 + number,
                "committee_reg_num": "18135",
                "vendor_name": f"Deep {number:05}",
                "year": 2026,
                "amount": Decimal("1"),
            }
            for number in range(10025)
        ],
    )
    finance_db.commit()
    built = []
    build = graph._edge

    def record(*args, **kwargs):
        built.append(kwargs["key"])
        return build(*args, **kwargs)

    monkeypatch.setattr(graph, "_edge", record)
    data = get(finance_api, relationship="payments", q="Deep", limit=2, offset=10020)
    assert data["total"] == 10025 and data["has_more"]
    assert [edge["to"] for edge in data["edges"]] == [
        "printed_name:vendor:Deep 10020",
        "printed_name:vendor:Deep 10021",
    ]
    assert len(built) == 2
    end = get(finance_api, relationship="payments", q="Deep", limit=2, offset=10024)
    assert len(end["edges"]) == 1 and not end["has_more"]
    past = get(finance_api, relationship="payments", q="Deep", limit=2, offset=10026)
    assert past["total"] == 10025 and not past["edges"] and not past["has_more"]


def test_mixed_deep_page_builds_metrics_only_for_returned_money(
    finance_api, finance_db, board, monkeypatch
):
    from alethical.api.services import finance_connections as graph

    # More other edges than an expanding 10-column VALUES join can safely bind.
    # They sort after these money edges, but must count in the combined total.
    other = [
        graph._edge(
            "lobbying_representation",
            graph._node("principal", str(i), "Principal"),
            graph._node("lobbyist", str(i), "Lobbyist"),
            {"dataset": "lobbyist_register"},
            key=str(i),
        )
        for i in range(6600)
    ]
    monkeypatch.setattr(graph, "_lobbying", lambda *args: (other, True))
    finance_db.execute(
        insert(m.CampaignFinanceExpenditureRow),
        [
            {
                "snapshot_id": board.expenditures_snapshot_id,
                "row_number": 100 + i,
                "committee_reg_num": "18135",
                "vendor_name": f"Deep {i:05}",
                "year": 2026,
                "amount": Decimal("1"),
            }
            for i in range(6700)
        ],
    )
    finance_db.commit()
    built = []
    build = graph._edge

    def record(relation, *args, **kwargs):
        if relation in {"contributions", "payments"}:
            built.append(kwargs["key"])
        return build(relation, *args, **kwargs)

    monkeypatch.setattr(graph, "_edge", record)
    data = get(finance_api, limit=2, offset=6600)
    assert len(data["edges"]) == 2 and data["total"] >= 13300
    assert all(edge["relationship"] == "payments" for edge in data["edges"])
    assert all(Decimal(edge["amount"]) == Decimal("1") for edge in data["edges"])
    assert len(built) == 2

    built.clear()
    metrics = []
    connection = finance_db.connection()

    def record_metrics(conn, cursor, statement, parameters, context, executemany):
        if "money_groups AS" in statement:
            metrics.append(statement)

    event.listen(connection, "before_cursor_execute", record_metrics)
    try:
        last = get(finance_api, limit=2, offset=data["total"] - len(other) + 10)
    finally:
        event.remove(connection, "before_cursor_execute", record_metrics)
    assert len(last["edges"]) == 2 and last["total"] == data["total"]
    assert all(
        edge["relationship"] == "lobbying_representation" for edge in last["edges"]
    )
    assert not built and not metrics


def test_broad_page_keeps_unnumbered_and_zero_number_accounts(
    finance_api, finance_db, board
):
    for i, (number, name) in enumerate(
        [(None, "Account A"), (None, "Account B"), ("0", "Account A")], 100
    ):
        finance_db.add(
            m.CampaignFinanceExpenditureRow(
                snapshot_id=board.expenditures_snapshot_id,
                row_number=i,
                committee_reg_num=number,
                committee_name=name,
                vendor_name="Same vendor",
                year=2026,
                amount=Decimal(str(i)),
            )
        )
    finance_db.commit()
    whole = get(finance_api, relationship="payments", limit=200)
    found = {
        edge["from"]: Decimal(edge["amount"])
        for edge in whole["edges"]
        if edge["to"] == "printed_name:vendor:Same vendor"
    }
    assert found == {
        "printed_name:recipient:Account A": Decimal("100"),
        "printed_name:recipient:Account B": Decimal("101"),
        "committee:0": Decimal("102"),
    }
    pages = [
        edge
        for i in range(whole["total"])
        for edge in get(finance_api, relationship="payments", offset=i, limit=1)[
            "edges"
        ]
    ]
    assert pages == whole["edges"]


def test_broad_page_includes_all_numbers_of_a_merged_account(
    finance_api, finance_db, board, registered
):
    existing = finance_db.get(m.CampaignFinanceFiler, (registered, "18135"))
    finance_db.add(
        m.CampaignFinanceFiler(
            snapshot_id=registered,
            registration_number="40100",
            kind=existing.kind,
            name="Example for Senate",
            is_incumbent=False,
        )
    )
    for i, number in enumerate(("18135", "40100"), 100):
        finance_db.add(
            gift(
                board.contributions_snapshot_id,
                i,
                contributor="Merged account donor",
                recipient_reg_num=number,
                amount=Decimal("20"),
            )
        )
    finance_db.commit()
    a = create(finance_api, "organization", "First account", committee(registered))
    b = create(
        finance_api,
        "organization",
        "Second account",
        committee(registered, key="40100"),
    )
    response = finance_api.post(
        f"/api/v1/finance/identities/{a['id']}/merge",
        json={"into": b["id"], "reason": "Same synthetic organization"},
    )
    assert response.status_code == 200
    whole = get(finance_api, relationship="contributions", limit=200)
    found = [
        edge
        for edge in whole["edges"]
        if edge["from"] == "printed_name:donor:Merged account donor"
    ]
    assert len(found) == 1
    assert found[0]["to"] == "identity:" + b["id"]
    assert found[0]["record_count"] == 2 and Decimal(found[0]["amount"]) == 40
    response = finance_api.post(
        f"/api/v1/finance/identities/confirmations/{a['confirmations'][0]['id']}/withdraw",
        json={"reason": "Undo synthetic association"},
    )
    assert response.status_code == 200
    changed = get(finance_api, relationship="contributions", limit=200)
    found = [
        edge
        for edge in changed["edges"]
        if edge["from"] == "printed_name:donor:Merged account donor"
    ]
    assert {edge["to"] for edge in found} == {"committee:18135", "identity:" + b["id"]}
    assert all(
        edge["record_count"] == 1 and Decimal(edge["amount"]) == 20 for edge in found
    )


def test_missing_station_source_is_unavailable_but_other_edges_remain(
    finance_api, board
):
    missing = get(finance_api, relationship="station_agency")
    assert missing["state"] == "unavailable"
    assert missing["unavailable_sources"] == ["station_file"]
    combined = get(finance_api)
    assert combined["state"] == "partial" and combined["total"] > 0
    assert combined["edges"] and "station_file" in combined["unavailable_sources"]


def test_held_station_files_without_matching_checks_are_known_empty(
    finance_api, held, listed
):
    no_matches = get(finance_api, relationship="station_agency", q="Not in the file")
    assert no_matches["state"] == "not_reported"
    assert no_matches["total"] == 0 and not no_matches["unavailable_sources"]
    for fact in listed.scalars(select(m.TVAdFact)):
        fact.status = "withdrawn"
    listed.commit()
    no_checks = get(finance_api, relationship="station_agency")
    assert no_checks["state"] == "not_reported"
    assert no_checks["total"] == 0 and not no_checks["unavailable_sources"]


def test_graph_pages_merge_money_and_non_money_at_every_boundary(
    finance_api, finance_db, board, held
):
    active, _, _ = _pair(finance_db)
    associations = list(
        finance_db.scalars(
            select(m.LobbyistAssociation)
            .where(m.LobbyistAssociation.snapshot_id == active.id)
            .order_by(
                m.LobbyistAssociation.registration_number,
                m.LobbyistAssociation.position,
            )
        )
    )
    # Keep this boundary matrix small; the source fixture holds 99 associations.
    for association in associations[3:]:
        finance_db.delete(association)
    active.association_count = 3
    member = finance_db.scalar(select(m.Legislator))
    _link(finance_db, member, "18135", m.CommitteeLinkReviewDecision.confirmed)
    finance_db.commit()
    whole = get(finance_api, limit=200)
    assert not whole["unavailable_sources"]
    assert not whole["has_more"]
    assert {edge["source"]["dataset"] for edge in whole["edges"]} == {
        "contributions",
        "expenditures",
        "independent_expenditures",
        "campaign_committee_confirmation",
        "lobbyist_register",
        "station_file",
    }
    for size in (1, 3):
        pages = [
            edge
            for offset in range(0, whole["total"], size)
            for edge in get(finance_api, limit=size, offset=offset)["edges"]
        ]
        assert [edge["id"] for edge in pages] == [edge["id"] for edge in whole["edges"]]
    beyond = get(finance_api, offset=whole["total"] + 5)
    assert beyond["total"] == whole["total"] and not beyond["edges"]


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


def test_donor_number_without_held_filer_stays_a_printed_name(
    finance_api, finance_db, board
):
    finance_db.add(
        gift(
            board.contributions_snapshot_id,
            99,
            contributor="Unresolved numbered donor",
            contrib_reg_num="90001",
            contrib_type="Lobbyist",
        )
    )
    finance_db.commit()
    data = get(finance_api, q="Unresolved numbered")
    node = next(n for n in data["nodes"] if n["label"] == "Unresolved numbered donor")
    assert node["kind"] == "printed_name" and node["role"] == "donor"
    assert node["target"]["kind"] == "printed_name"
    outgoing = get(finance_api, relationship="payments")
    standalone = next(n for n in outgoing["nodes"] if n["record_id"] == "40100")
    assert standalone["target"] is None


def test_campaign_account_year_choices_cover_only_reviewed_intervals(
    finance_api, finance_db
):
    member = finance_db.scalar(select(m.Legislator))
    _link(finance_db, member, "18001", m.CommitteeLinkReviewDecision.confirmed)
    _link(finance_db, member, "18002", m.CommitteeLinkReviewDecision.withdrawn)
    finance_db.flush()
    for row in finance_db.scalars(select(m.LegislatorCampaignCommittee)):
        row.first_year_as_reviewed = (
            "2018" if row.registration_number == "18001" else "2026"
        )
        row.last_year_as_reviewed = (
            "2020" if row.registration_number == "18001" else "2026"
        )
    finance_db.commit()
    data = get(finance_api, relationship="campaign_account")
    assert data["years"] == [2020, 2019, 2018]
    filtered = get(finance_api, relationship="campaign_account", year=2019)
    assert filtered["years"] == data["years"] and filtered["total"] == 1
    assert get(finance_api, relationship="campaign_account", year=2026)["total"] == 0
