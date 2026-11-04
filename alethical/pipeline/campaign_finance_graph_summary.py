"""The Finance money graph's groups, added up once for each saved payment file.

``alethical/api/services/finance_connections.py`` groups payment rows by the
inputs that form a graph edge's 2 nodes. This module names those inputs for each
of the 3 files (``GRAPH_INPUTS``), so the graph and the summary cannot disagree
about which rows join the graph, and it writes the summary rows
(``cf_graph_money_summary``) inside the publish transaction from the rows just
loaded. The graph reads the summary when a snapshot has one and the raw rows
when it does not, so a snapshot loaded before this table existed still answers.

Nothing here resolves an identity: identity confirmations and registered-filer
checks are applied when the graph is read, over these inputs, as they are over
the raw rows. Every figure keeps rule 12 of ``.claude/rules/grounded-answers.md``:
the amount is the signed sum of the amounts held, with a count of the records
whose amount is missing beside it; repeated identical rows count as separate
records; a missing date or year is counted, never filled in.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Optional

from sqlalchemy import cast, delete, func, insert, literal, null, or_, select
from sqlalchemy.orm import Session

from alethical.db import models as m

Dataset = m.CampaignFinanceDataset
Summary = m.CampaignFinanceGraphMoneySummary

_Gave = m.CampaignFinanceContributionRow
_Paid = m.CampaignFinanceExpenditureRow
_Independent = m.CampaignFinanceIndependentExpenditureRow


@dataclass(frozen=True)
class GraphInputs:
    """Which columns of 1 payment file form the graph's node inputs.

    ``account_number`` and ``account_name`` name the filer: the recipient of a
    contribution, the paying committee of an expenditure, the spender of an
    independent expenditure. ``printed_name`` is the other side as printed.
    The 4 optional columns exist on 1 file each and are ``None`` elsewhere.
    """

    dataset: Dataset
    model: type
    account_number: Any
    account_name: Any
    printed_name: Any
    amount: Any
    date: Any
    year: Any
    donor_number: Optional[Any] = None
    payment_type: Optional[Any] = None
    transfer_number: Optional[Any] = None
    transfer_name: Optional[Any] = None
    position: Optional[Any] = None

    def eligible(self) -> list:
        """The rows that can form a graph edge: an account on 1 side, a name on the other.

        Contributions keep only the file's ``Contribution`` receipt type, as the
        money pages do. An expenditure with no vendor still joins the graph when it
        is an outgoing contribution naming its recipient (a ``0`` number is none).
        """
        model = self.model
        other_side = self.printed_name.is_not(None)
        if self.dataset == Dataset.expenditures:
            other_side = or_(
                other_side,
                (model.type == "Contribution")
                & or_(
                    model.affected_committee_name.is_not(None),
                    func.nullif(model.affected_committee_reg_num, "0").is_not(None),
                ),
            )
        conditions = [
            other_side,
            or_(self.account_number.is_not(None), self.account_name.is_not(None)),
        ]
        if self.dataset == Dataset.contributions:
            conditions.append(model.receipt_type == "Contribution")
        return conditions

    def optional(self, column):
        return null() if column is None else column


GRAPH_INPUTS: dict[Dataset, GraphInputs] = {
    Dataset.contributions: GraphInputs(
        Dataset.contributions,
        _Gave,
        _Gave.recipient_reg_num,
        _Gave.recipient,
        _Gave.contributor,
        _Gave.amount,
        _Gave.receipt_date,
        _Gave.year,
        donor_number=_Gave.contrib_reg_num,
    ),
    Dataset.expenditures: GraphInputs(
        Dataset.expenditures,
        _Paid,
        _Paid.committee_reg_num,
        _Paid.committee_name,
        _Paid.vendor_name,
        _Paid.amount,
        _Paid.transaction_date,
        _Paid.year,
        payment_type=_Paid.type,
        transfer_number=_Paid.affected_committee_reg_num,
        transfer_name=_Paid.affected_committee_name,
    ),
    Dataset.independent_expenditures: GraphInputs(
        Dataset.independent_expenditures,
        _Independent,
        _Independent.spender_reg_num,
        _Independent.spender,
        _Independent.vendor_name,
        _Independent.amount,
        _Independent.transaction_date,
        _Independent.year,
        position=_Independent.for_against,
    ),
}

# The summary's columns, in the order ``rebuild`` writes them.
SUMMARY_COLUMNS = (
    "snapshot_id",
    "dataset",
    "account_number",
    "account_name",
    "printed_name",
    "donor_number",
    "payment_type",
    "transfer_number",
    "transfer_name",
    "position",
    "year",
    "record_count",
    "amount_sum",
    "missing_amount_count",
    "first_date",
    "last_date",
    "undated_count",
)


def rebuild(db: Session, dataset: Dataset, snapshot_id: uuid.UUID) -> int:
    """Replace 1 snapshot's summary rows from its loaded rows; returns how many.

    Runs inside the caller's transaction, after the rows are loaded and before
    the live pointer moves, so a reader never sees a published snapshot with a
    half-built summary. Grouped by every node input and the filing year, so a
    year-filtered read uses the same rows and an all-years read adds them up.
    """
    inputs = GRAPH_INPUTS[dataset]
    model = inputs.model
    db.execute(delete(Summary).where(Summary.snapshot_id == snapshot_id))
    columns = [
        inputs.account_number,
        inputs.account_name,
        inputs.printed_name,
        inputs.donor_number,
        inputs.payment_type,
        inputs.transfer_number,
        inputs.transfer_name,
        inputs.position,
        inputs.year,
    ]
    group = [inputs.optional(column) for column in columns]
    source = (
        select(
            literal(snapshot_id),
            cast(literal(dataset.value), Summary.__table__.c.dataset.type),
            *group,
            func.count(),
            func.sum(inputs.amount),
            func.count() - func.count(inputs.amount),
            func.min(inputs.date),
            func.max(inputs.date),
            func.count() - func.count(inputs.date),
        )
        .select_from(model)
        .where(model.snapshot_id == snapshot_id, *inputs.eligible())
        # A file without 1 of the optional columns writes NULL for it, which
        # Postgres refuses as a GROUP BY term, so only the held columns group.
        .group_by(*(column for column in columns if column is not None))
        # Written in the order the snapshot/year index reads them, so a read walks
        # the snapshot's pages in sequence rather than revisiting them.
        .order_by(inputs.year, inputs.account_number)
    )
    db.execute(insert(Summary).from_select(list(SUMMARY_COLUMNS), source))
    return (
        db.scalar(
            select(func.count())
            .select_from(Summary)
            .where(Summary.snapshot_id == snapshot_id)
        )
        or 0
    )


def remove(db: Session, snapshot_id: uuid.UUID) -> int:
    """Delete 1 snapshot's summary rows, with its pruned payment rows."""
    return db.execute(
        delete(Summary).where(Summary.snapshot_id == snapshot_id)
    ).rowcount


def held(db: Session, snapshot_ids: Iterable[uuid.UUID]) -> set[uuid.UUID]:
    """Which of these snapshots have summary rows, in 1 statement."""
    wanted = list(snapshot_ids)
    if not wanted:
        return set()
    return set(
        db.scalars(
            select(Summary.snapshot_id)
            .where(Summary.snapshot_id.in_(wanted))
            .group_by(Summary.snapshot_id)
        )
    )
