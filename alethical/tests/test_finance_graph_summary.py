"""The graph reads a publish-time money summary and answers exactly as from raw rows.

``cf_graph_money_summary`` holds each saved file's groups, written when a release
publishes. These tests hold the graph to 1 answer whichever source it reads, payload
for payload, across broad, offset, filtered, focused and deep pages, with duplicate
rows, refunds, missing amounts, dates and years, outgoing transfers, unnumbered
accounts, a partly confirmed printed name and a confirmed identifier. They also pin
what the summary buys: the first admitted broad request reads no raw payment table.
"""

# ruff: noqa: F811
import hashlib
import json
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import event, func, select

from alethical.api.services import finance_connections as graph
from alethical.db import models as m
from alethical.pipeline import campaign_finance_graph_summary as summary
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_finance_connections import get
from alethical.tests.test_identity_confirmations import (  # noqa: F401
    DONOR,
    VENDOR,
    board,
    committee,
    create,
    donor,
    gift,
    payee,
    prints,
    registered,
)

Dataset = m.CampaignFinanceDataset
Summary = m.CampaignFinanceGraphMoneySummary
RAW_TABLES = (
    "cf_contribution_row",
    "cf_expenditure_row",
    "cf_independent_expenditure_row",
)
NO_SUMMARY = {}


def snapshots(board):
    return {
        Dataset.contributions: board.contributions_snapshot_id,
        Dataset.expenditures: board.expenditures_snapshot_id,
        Dataset.independent_expenditures: board.independent_expenditures_snapshot_id,
    }


def build(db, board, datasets=tuple(Dataset)):
    for dataset in datasets:
        summary.rebuild(db, dataset, snapshots(board)[dataset])
    db.commit()


def digest(data):
    return hashlib.sha256(
        json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def recorded(finance_db):
    """Every SQL statement the next requests run, with its parameters."""
    statements = []
    connection = finance_db.connection()

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append((statement, parameters))

    event.listen(connection, "before_cursor_execute", record)
    return statements, lambda: event.remove(connection, "before_cursor_execute", record)


def raw_read(finance_api, monkeypatch, **params):
    """The same read with the summary ignored: every file grouped from raw rows."""
    with monkeypatch.context() as patch:
        patch.setattr(graph, "_summaries", lambda db, release: NO_SUMMARY)
        return get(finance_api, **params)


@pytest.fixture()
def varied(finance_db, board):
    """Rows exercising every figure rule the summary must keep."""
    gave = board.contributions_snapshot_id
    paid = board.expenditures_snapshot_id
    spent = board.independent_expenditures_snapshot_id
    payment = m.CampaignFinanceExpenditureRow
    outside = m.CampaignFinanceIndependentExpenditureRow
    casey = dict(contributor="Example, Casey")
    finance_db.add_all(
        [
            # 2 identical gifts stay 2 records; a refund keeps its sign.
            gift(
                gave, 41, amount=Decimal("50"), receipt_date=date(2026, 3, 3), **casey
            ),
            gift(
                gave, 42, amount=Decimal("50"), receipt_date=date(2026, 3, 3), **casey
            ),
            gift(
                gave, 43, amount=Decimal("-20"), receipt_date=date(2026, 4, 1), **casey
            ),
            # A missing amount withholds the sum; a missing date keeps the year basis.
            gift(gave, 44, contributor="Example, Dana", amount=None, year=2025),
            gift(
                gave,
                45,
                contributor="Example, Dana",
                amount=Decimal("10"),
                receipt_date=None,
                year=2025,
            ),
            # No year and no date: the period is unknown.
            gift(gave, 46, contributor="Example, Eli", receipt_date=None, year=None),
            # A recipient printed by name only.
            gift(
                gave,
                47,
                recipient_reg_num=None,
                recipient="Unregistered Fund",
                amount=Decimal("75"),
                **casey,
            ),
            # A donor with a registration that files rows, and one that does not.
            gift(
                gave,
                48,
                contributor="Example Committee",
                contrib_reg_num="18135",
                amount=Decimal("500"),
            ),
            gift(
                gave,
                49,
                contributor="Unknown Committee",
                contrib_reg_num="99999",
                amount=Decimal("5"),
            ),
            # Not a contribution: never in the graph, still one of the file's years.
            gift(
                gave,
                50,
                receipt_type="Loan Payable",
                amount=Decimal("1000"),
                receipt_date=date(1999, 1, 1),
                year=1999,
                **casey,
            ),
            payment(
                snapshot_id=paid,
                row_number=61,
                committee_reg_num="18135",
                vendor_name=VENDOR,
                amount=Decimal("99.5"),
                transaction_date=date(2025, 2, 2),
                year=2025,
            ),
            payment(
                snapshot_id=paid,
                row_number=62,
                committee_reg_num="18135",
                vendor_name="Example Print Shop",
                amount=Decimal("40"),
            ),
            # An outgoing contribution with no vendor, to a number no filer holds.
            payment(
                snapshot_id=paid,
                row_number=63,
                committee_reg_num="18135",
                type="Contribution",
                affected_committee_reg_num="40100",
                affected_committee_name="Example Fund",
                amount=Decimal("250"),
                transaction_date=date(2026, 7, 7),
                year=2026,
            ),
            # A processor on an outgoing contribution to a name with a "0" number.
            payment(
                snapshot_id=paid,
                row_number=64,
                committee_reg_num="18135",
                vendor_name="Example Processor",
                type="Contribution",
                affected_committee_reg_num="0",
                affected_committee_name="Named Only PAC",
                amount=Decimal("-60"),
                transaction_date=date(2026, 8, 8),
                year=2026,
            ),
            payment(
                snapshot_id=paid,
                row_number=65,
                committee_reg_num="18135",
                vendor_name="Example Print Shop",
                amount=None,
                transaction_date=date(2026, 9, 9),
                year=2026,
            ),
            payment(
                snapshot_id=paid,
                row_number=66,
                committee_name="Unregistered Spender",
                vendor_name="Example Print Shop",
                amount=Decimal("12"),
                transaction_date=date(2026, 9, 10),
                year=2026,
            ),
            # An outgoing contribution to a committee that files rows (18135).
            payment(
                snapshot_id=paid,
                row_number=67,
                committee_reg_num="20010",
                committee_name="Example Party Unit",
                type="Contribution",
                affected_committee_reg_num="18135",
                affected_committee_name="Example for Senate",
                amount=Decimal("1000"),
                transaction_date=date(2026, 1, 15),
                year=2026,
            ),
            # Identical to the fixture's row 7: 2 records, 1 group.
            outside(
                snapshot_id=spent,
                row_number=8,
                spender_reg_num="40100",
                vendor_name=VENDOR,
                amount=Decimal(900),
                transaction_date=date(2026, 5, 1),
                year=2026,
            ),
            outside(
                snapshot_id=spent,
                row_number=9,
                spender="Outside Group",
                vendor_name="Example Mailers",
                year=2024,
            ),
        ]
    )
    # The file's measured years, as a publish records them for every row.
    for dataset, snapshot_id in snapshots(board).items():
        table = summary.GRAPH_INPUTS[dataset].model
        years = finance_db.execute(
            select(table.year, func.count())
            .where(table.snapshot_id == snapshot_id, table.year.is_not(None))
            .group_by(table.year)
        ).all()
        snapshot = finance_db.get(m.CampaignFinanceSnapshot, snapshot_id)
        snapshot.rows_by_year = {str(year): count for year, count in years}
    finance_db.commit()
    return board


def identities(finance_api, board, registered):
    """A committee confirmed whole, and 2 printed names confirmed for some records."""
    create(finance_api, "organization", "Example Senate Org", committee(registered))
    vendor_rows = prints(finance_api, "payee_name", VENDOR)
    create(
        finance_api, "organization", "Confirmed firm", payee(board, [vendor_rows[52]])
    )
    donor_rows = prints(finance_api)
    create(finance_api, "person", DONOR, donor(board, [donor_rows[32]]))


READS = [
    {"limit": 200},
    {"limit": 3, "offset": 2},
    {"limit": 5, "offset": 10},
    {"relationship": "payments", "limit": 50},
    {"relationship": "contributions", "limit": 2, "offset": 1},
    {"q": "example", "limit": 100},
    {"q": "print shop"},
    {"year": 2026, "limit": 100},
    {"year": 2025, "relationship": "contributions"},
    {"focus": "printed_name:recipient:Unregistered Fund"},
    {"focus": "printed_name:vendor:Example Print Shop", "year": 2026},
]


@pytest.mark.parametrize("confirmed", [False, True], ids=["plain", "identities"])
@pytest.mark.parametrize("params", READS, ids=[json.dumps(r) for r in READS])
def test_summary_and_raw_rows_answer_every_read_alike(
    finance_api, finance_db, varied, registered, monkeypatch, params, confirmed
):
    if confirmed:
        identities(finance_api, varied, registered)
    build(finance_db, varied)
    from_summary = get(finance_api, **params)
    from_rows = raw_read(finance_api, monkeypatch, **params)
    assert from_summary["total"] == from_rows["total"] > 0
    assert digest(from_summary) == digest(from_rows)
    assert from_summary["years"] == from_rows["years"]
    # The loan's year is a contributions year; a payments read lists none of them.
    assert (1999 in from_summary["years"]) == (params.get("relationship") != "payments")


def test_summary_rows_add_up_each_group_exactly(finance_db, varied):
    build(finance_db, varied)
    rows = finance_db.scalars(
        select(Summary).where(
            Summary.snapshot_id == varied.contributions_snapshot_id,
            Summary.printed_name.in_(
                ["Example, Casey", "Example, Dana", "Example, Eli"]
            ),
        )
    ).all()
    by_name = {}
    for row in rows:
        by_name.setdefault(row.printed_name, []).append(row)
    [casey_fund] = [r for r in by_name["Example, Casey"] if r.account_number is None]
    [casey] = [r for r in by_name["Example, Casey"] if r.account_number == "18135"]
    assert (casey.record_count, casey.amount_sum, casey.missing_amount_count) == (
        3,
        Decimal("80"),
        0,
    )
    assert (casey.first_date, casey.last_date, casey.undated_count, casey.year) == (
        date(2026, 3, 3),
        date(2026, 4, 1),
        0,
        2026,
    )
    assert (casey_fund.account_name, casey_fund.record_count) == (
        "Unregistered Fund",
        1,
    )
    [dana] = by_name["Example, Dana"]
    assert (dana.record_count, dana.amount_sum, dana.missing_amount_count) == (
        2,
        Decimal("10"),
        1,
    )
    assert (dana.first_date, dana.last_date, dana.undated_count, dana.year) == (
        date(2026, 3, 2),
        date(2026, 3, 2),
        1,
        2025,
    )
    [eli] = by_name["Example, Eli"]
    assert (eli.year, eli.undated_count, eli.record_count) == (None, 1, 1)
    # The loan is not a contribution, so it is nowhere in the summary.
    assert not finance_db.scalar(
        select(func.count()).select_from(Summary).where(Summary.year == 1999)
    )
    # An outgoing contribution with no vendor still forms its group.
    [transfer] = finance_db.scalars(
        select(Summary).where(
            Summary.snapshot_id == varied.expenditures_snapshot_id,
            Summary.transfer_number == "40100",
        )
    ).all()
    assert (transfer.printed_name, transfer.payment_type, transfer.amount_sum) == (
        None,
        "Contribution",
        Decimal("250"),
    )


def test_first_admitted_broad_request_reads_only_the_summary(
    finance_api, finance_db, varied
):
    build(finance_db, varied)
    statements, stop = recorded(finance_db)
    try:
        data = get(finance_api)
    finally:
        stop()
    assert data["total"] > 0
    heavy = [
        (statement, parameters)
        for statement, parameters in statements
        if "graph_key_inputs" in statement or "money_groups" in statement
    ]
    assert len(heavy) == 2
    for statement, parameters in heavy:
        assert "cf_graph_money_summary" in statement
        assert not any(table in statement for table in RAW_TABLES)
        plan = (
            finance_db.connection()
            .exec_driver_sql("EXPLAIN (FORMAT JSON) " + statement, parameters)
            .scalar()
        )
        relations = set()

        def walk(node):
            if "Relation Name" in node:
                relations.add(node["Relation Name"])
            for child in node.get("Plans", []):
                walk(child)

        walk(plan[0]["Plan"])
        assert "cf_graph_money_summary" in relations
        assert not relations & set(RAW_TABLES)
    # Year choices come from the files' measured years, not a scan of the rows.
    assert not any(
        "DISTINCT cf_contribution_row.year" in statement for statement, _ in statements
    )
    assert data["years"] == sorted({2026, 2025, 1999, 2024}, reverse=True)


def test_a_confirmed_printed_name_reads_its_raw_rows_and_the_rest_the_summary(
    finance_api, finance_db, varied, registered, monkeypatch
):
    identities(finance_api, varied, registered)
    build(finance_db, varied)
    statements, stop = recorded(finance_db)
    try:
        data = get(finance_api, relationship="payments", limit=50)
    finally:
        stop()
    [keys] = [s for s, _ in statements if "graph_key_inputs" in s]
    assert "cf_graph_money_summary" in keys
    assert "cf_expenditure_row" in keys and "cf_contribution_row" not in keys
    assert "identity_confirmed_record" in keys
    assert digest(data) == digest(
        raw_read(finance_api, monkeypatch, relationship="payments", limit=50)
    )


def test_a_file_without_summary_rows_reads_its_raw_rows(
    finance_api, finance_db, varied, monkeypatch
):
    build(finance_db, varied, [Dataset.contributions])
    statements, stop = recorded(finance_db)
    try:
        data = get(finance_api, limit=200)
    finally:
        stop()
    [keys] = [s for s, _ in statements if "graph_key_inputs" in s]
    assert "cf_graph_money_summary" in keys and "cf_contribution_row" not in keys
    assert "cf_expenditure_row" in keys and "cf_independent_expenditure_row" in keys
    assert digest(data) == digest(raw_read(finance_api, monkeypatch, limit=200))


def test_confirmations_change_the_graph_without_rebuilding_the_summary(
    finance_api, finance_db, varied
):
    build(finance_db, varied)
    before = get(finance_api, relationship="payments")
    assert not any(n["kind"] == "organization" for n in before["nodes"])
    selected = prints(finance_api, "payee_name", VENDOR)
    entity = create(
        finance_api, "organization", "Confirmed firm", payee(varied, [selected[52]])
    )
    after = get(finance_api, relationship="payments")
    identified = next(n for n in after["nodes"] if n["kind"] == "organization")
    assert identified["record_id"] == entity["id"]
    edge = next(e for e in after["edges"] if e["to"] == identified["key"])
    assert (edge["amount"], edge["record_count"]) == ("1200.5000", 1)
    remainder = next(
        e
        for e in after["edges"]
        if e["to"] == f"printed_name:vendor:{VENDOR}"
        and e["source"]["dataset"] == "expenditures"
    )
    assert (remainder["amount"], remainder["record_count"]) == ("99.5000", 1)
    confirmation = entity["confirmations"][0]
    assert (
        finance_api.post(
            f"/api/v1/finance/identities/confirmations/{confirmation['id']}/withdraw",
            json={"reason": "Wrong organization"},
        ).status_code
        == 200
    )
    assert digest(get(finance_api, relationship="payments")) == digest(before)


def test_a_rebuilt_summary_replaces_the_old_rows(finance_db, varied):
    build(finance_db, varied)
    count = finance_db.scalar(select(func.count()).select_from(Summary))
    assert count > 0
    build(finance_db, varied)
    assert finance_db.scalar(select(func.count()).select_from(Summary)) == count
    assert summary.held(finance_db, snapshots(varied).values()) == set(
        snapshots(varied).values()
    )
    assert summary.remove(finance_db, varied.contributions_snapshot_id) > 0
    assert summary.held(finance_db, snapshots(varied).values()) == {
        varied.expenditures_snapshot_id,
        varied.independent_expenditures_snapshot_id,
    }
