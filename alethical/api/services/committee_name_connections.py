"""Other candidate registrations under exactly the same printed individual name.

Counts describe rows in one held contributions copy and calendar year, not people.
No amounts, cross-year totals, or inferred identities are returned.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.api.services.committee_finance import _empty_state
from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline.campaign_finance_reader import Release


@dataclass(frozen=True)
class NameConnectionBucket:
    other_committees: str
    names: int


@dataclass(frozen=True)
class ConnectedName:
    name: str
    other_committees: int


@dataclass(frozen=True)
class NameConnections:
    state: str
    year: int
    matching: str = "exact_printed_name"
    numerator: int | None = None
    denominator: int | None = None
    distribution: tuple[NameConnectionBucket, ...] = ()
    top_names: tuple[ConnectedName, ...] = ()


def name_connections(
    db: Session, release: Release, registration_number: str, year: int
) -> NameConnections:
    """Keep spellings separate; repeated payments to one PCC count once."""
    rows = db.execute(
        text("""
            WITH selected_names AS (
                SELECT DISTINCT contributor
                  FROM cf_contribution_row
                 WHERE snapshot_id = :snapshot
                   AND recipient_reg_num = :registration
                   AND year = :year
                   AND contrib_type = 'Individual'
                   AND receipt_type = 'Contribution'
                   AND contributor IS NOT NULL
            )
            SELECT selected.contributor AS name,
                   count(DISTINCT other.recipient_reg_num) AS other_committees
              FROM selected_names selected
              LEFT JOIN cf_contribution_row other
                ON other.snapshot_id = :snapshot
               AND other.contributor = selected.contributor
               AND other.year = :year
               AND other.contrib_type = 'Individual'
               AND other.receipt_type = 'Contribution'
               AND other.recipient_type = 'PCC'
               AND other.recipient_reg_num <> :registration
             GROUP BY selected.contributor
             ORDER BY other_committees DESC, selected.contributor COLLATE "C"
        """),
        {
            "snapshot": release.contributions.snapshot_id,
            "registration": registration_number,
            "year": year,
        },
    ).all()
    if not rows:
        reader._refuse_if_rows_are_gone(db, release, reader.Dataset.contributions)
        return NameConnections(
            state=_empty_state(db, release, reader.Dataset.contributions, year),
            year=year,
        )
    buckets = [0] * 5
    for row in rows:
        buckets[min(row.other_committees, 4)] += 1
    return NameConnections(
        state="reported",
        year=year,
        numerator=len(rows) - buckets[0],
        denominator=len(rows),
        distribution=tuple(
            NameConnectionBucket(str(index) if index < 4 else "4+", count)
            for index, count in enumerate(buckets)
        ),
        top_names=tuple(
            ConnectedName(row.name, row.other_committees) for row in rows[:5]
        ),
    )
