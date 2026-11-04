"""Saved graph groups preserve exact filed positions without changing totals."""

# ruff: noqa: F811
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from alethical.db import models as m
from alethical.pipeline import campaign_finance_graph_summary as summary
from alethical.tests.finance_fixtures import finance_db  # noqa: F401
from alethical.tests.test_identity_confirmations import board, gift  # noqa: F401


def test_summary_keeps_exact_positions_separate_and_preserves_all_money(
    finance_db, board
):
    snapshot = board.independent_expenditures_snapshot_id
    values = [
        ("For Example, Jordan", Decimal("20")),
        ("For Example, Jordan", Decimal("-5")),
        ("Against Example, Jordan", Decimal("8")),
        (" For Example, Jordan ", Decimal("3")),
        (None, None),
    ]
    finance_db.add_all(
        m.CampaignFinanceIndependentExpenditureRow(
            snapshot_id=snapshot,
            row_number=100 + index,
            spender_reg_num="40100",
            vendor_name="Position fixture vendor",
            for_against=position,
            amount=amount,
            transaction_date=date(2026, 5, 1),
            year=2026,
        )
        for index, (position, amount) in enumerate(values)
    )
    finance_db.flush()
    summary.rebuild(
        finance_db, m.CampaignFinanceDataset.independent_expenditures, snapshot
    )
    rows = finance_db.scalars(
        select(summary.Summary).where(
            summary.Summary.snapshot_id == snapshot,
            summary.Summary.printed_name == "Position fixture vendor",
        )
    ).all()
    # These were one group before position was saved, irreversibly hiding its values.
    assert len(rows) == 4
    assert {row.position: row.record_count for row in rows} == {
        "For Example, Jordan": 2,
        "Against Example, Jordan": 1,
        " For Example, Jordan ": 1,
        None: 1,
    }
    assert sum(row.record_count for row in rows) == 5
    assert sum(row.amount_sum or Decimal(0) for row in rows) == Decimal("26")
    assert sum(row.missing_amount_count for row in rows) == 1


def test_other_files_never_borrow_a_position(finance_db, board):
    snapshot = board.contributions_snapshot_id
    finance_db.add(
        gift(snapshot, 102, contributor="Position fixture donor", amount=Decimal("12"))
    )
    finance_db.flush()
    summary.rebuild(finance_db, m.CampaignFinanceDataset.contributions, snapshot)
    rows = finance_db.scalars(
        select(summary.Summary).where(summary.Summary.snapshot_id == snapshot)
    ).all()
    assert rows
    assert all(row.position is None for row in rows)
