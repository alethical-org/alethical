"""The Confirm identities queue's totals for each exact printed name, added up once
for each saved payment file.

``alethical/api/services/finance_identity_directory.py`` lists every exact printed
spelling of a donor, employer or payee name in the live files, with its records,
signed amount, missing amounts, undated records and period. Grouping about 1.75
million rows on every request took 2.0 to 8.3 seconds on production. This module
writes those per-spelling totals (``cf_identity_name_summary``) inside the publish
transaction, from the rows just loaded, and marks each (file, kind) build complete
(``cf_identity_name_summary_build``) in the same transaction. The queue reads the
summary only where that marker exists, so an absent or partial build is read from
the raw rows and never served as an empty list.

Only figures that cannot change for a saved file are kept here. Which records are
confirmed, by which identity, and how merges and splits stand today are read at
request time, as they are over the raw rows. Every figure keeps rule 12 of
``.claude/rules/grounded-answers.md``: the amount is the signed sum of the amounts
held, with the count of missing amounts beside it; repeated identical rows count as
separate records; a missing date or year is counted, never filled in.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import and_, delete, func, insert, literal, select, tuple_
from sqlalchemy.orm import Session

from alethical.db import models as m

Dataset = m.CampaignFinanceDataset
Summary = m.CampaignFinanceIdentityNameSummary
Build = m.CampaignFinanceIdentityNameSummaryBuild

_Gave = m.CampaignFinanceContributionRow
_Paid = m.CampaignFinanceExpenditureRow
_Independent = m.CampaignFinanceIndependentExpenditureRow


@dataclass(frozen=True)
class NameKind:
    """The file, printed-name column and date column of 1 kind of printed name."""

    dataset: Dataset
    model: type
    name: Any
    date: Any


NAME_KINDS: dict[str, NameKind] = {
    "donor_name": NameKind(
        Dataset.contributions, _Gave, _Gave.contributor, _Gave.receipt_date
    ),
    "employer_name": NameKind(
        Dataset.contributions, _Gave, _Gave.contrib_employer_name, _Gave.receipt_date
    ),
    "payee_name": NameKind(
        Dataset.expenditures, _Paid, _Paid.vendor_name, _Paid.transaction_date
    ),
    "independent_payee_name": NameKind(
        Dataset.independent_expenditures,
        _Independent,
        _Independent.vendor_name,
        _Independent.transaction_date,
    ),
}

# The summary's columns, in the order ``rebuild`` writes them.
SUMMARY_COLUMNS = (
    "snapshot_id",
    "record_kind",
    "name",
    "records",
    "amount",
    "missing_amounts",
    "undated_records",
    "dated_records",
    "yeared_records",
    "first_year",
    "last_year",
    "first_date",
    "last_date",
)


def named(kind: str, snapshot_id: uuid.UUID) -> list:
    """The rows of 1 snapshot that print a name of this kind."""
    spec = NAME_KINDS[kind]
    return [
        spec.model.snapshot_id == snapshot_id,
        spec.name.is_not(None),
        func.btrim(spec.name) != "",
    ]


def kinds_for(dataset: Dataset) -> list[str]:
    return [kind for kind, spec in NAME_KINDS.items() if spec.dataset == dataset]


def rebuild(db: Session, dataset: Dataset, snapshot_id: uuid.UUID) -> int:
    """Replace 1 snapshot's name totals and completion markers; returns the rows.

    Runs inside the caller's transaction, after the rows are loaded and before the
    live pointer moves, so a reader never sees a published snapshot with a
    half-built summary. Each kind's marker is written with its rows, and a fresh
    marker revision names the build, so the list version changes with it.
    """
    written = 0
    for kind in kinds_for(dataset):
        spec = NAME_KINDS[kind]
        model = spec.model
        db.execute(
            delete(Summary).where(
                Summary.snapshot_id == snapshot_id, Summary.record_kind == kind
            )
        )
        db.execute(
            delete(Build).where(
                Build.snapshot_id == snapshot_id, Build.record_kind == kind
            )
        )
        source = (
            select(
                literal(snapshot_id),
                literal(kind),
                spec.name,
                func.count(),
                func.sum(model.amount),
                func.count() - func.count(model.amount),
                func.count().filter(and_(model.year.is_(None), spec.date.is_(None))),
                func.count(spec.date),
                func.count(model.year),
                func.min(model.year),
                func.max(model.year),
                func.min(spec.date),
                func.max(spec.date),
            )
            .where(*named(kind, snapshot_id))
            .group_by(spec.name)
        )
        db.execute(insert(Summary).from_select(list(SUMMARY_COLUMNS), source))
        # Counted, not taken from the driver: an INSERT ... SELECT can report -1.
        rows = (
            db.scalar(
                select(func.count())
                .select_from(Summary)
                .where(Summary.snapshot_id == snapshot_id, Summary.record_kind == kind)
            )
            or 0
        )
        db.add(Build(snapshot_id=snapshot_id, record_kind=kind, row_count=rows))
        db.flush()
        written += rows
    return written


def remove(db: Session, snapshot_id: uuid.UUID) -> int:
    """Delete 1 snapshot's name totals and markers, with its pruned payment rows."""
    db.execute(delete(Build).where(Build.snapshot_id == snapshot_id))
    held = (
        db.scalar(
            select(func.count())
            .select_from(Summary)
            .where(Summary.snapshot_id == snapshot_id)
        )
        or 0
    )
    db.execute(delete(Summary).where(Summary.snapshot_id == snapshot_id))
    return held


def complete(
    db: Session, pairs: Iterable[tuple[uuid.UUID, str]]
) -> set[tuple[uuid.UUID, str]]:
    """Which (snapshot, kind) pairs have a complete build, in 1 statement.

    A complete build with no names is still complete; a pair without a marker
    has no usable summary, whatever rows exist.
    """
    wanted = list(pairs)
    if not wanted:
        return set()
    return {
        (snapshot_id, kind)
        for snapshot_id, kind in db.execute(
            select(Build.snapshot_id, Build.record_kind).where(
                tuple_(Build.snapshot_id, Build.record_kind).in_(wanted)
            )
        )
    }


def held(db: Session, dataset: Dataset, snapshot_ids: Iterable[uuid.UUID]) -> set:
    """Which of these snapshots have every kind of their file built."""
    kinds = kinds_for(dataset)
    wanted = list(snapshot_ids)
    built = complete(db, [(sid, kind) for sid in wanted for kind in kinds])
    return {sid for sid in wanted if all((sid, kind) in built for kind in kinds)}
