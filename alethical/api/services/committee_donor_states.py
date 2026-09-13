"""Individual cash by ZIP-derived state for one checked candidate committee-year.

These are the current bulk file's calendar-year rows, like the named donor list.
They are not a reconstruction of the particular report used for the split check.
The reference maps ZIPs, not people: a printed name can occur in multiple states.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline.campaign_finance_reader import Release
from alethical.api.services.zip_state_reference import load_zip_state_reference


@dataclass(frozen=True)
class DonorStateAmounts:
    names: int
    cash_total: Decimal


@dataclass(frozen=True)
class DonorStateRow(DonorStateAmounts):
    state: str


@dataclass(frozen=True)
class DonorStateSummary:
    minnesota: DonorStateAmounts
    other_states: DonorStateAmounts
    unknown: DonorStateAmounts


@dataclass(frozen=True)
class DonorStates:
    state: str
    year: int
    rows: tuple[DonorStateRow, ...]
    summary: DonorStateSummary
    reference: dict[str, str]


def donor_states(
    db: Session, release: Release, registration_number: str, year: int
) -> DonorStates | None:
    """Withhold the block without a current agreeing check or a usable reference."""
    reference = load_zip_state_reference()
    if reference is None:
        return None
    params = {
        "snapshot": release.contributions.snapshot_id,
        "registration": registration_number,
        "year": year,
    }
    eligible = db.execute(
        text("""
            SELECT 1
              FROM cf_filing_current current_copy
              JOIN cf_filing filing ON filing.snapshot_id = current_copy.snapshot_id
              JOIN cf_stated_split verdict
                ON verdict.filings_snapshot_id = filing.snapshot_id
               AND verdict.registration_number = filing.registration_number
               AND verdict.filing_year = filing.filing_year
             WHERE current_copy.id IS TRUE
               AND filing.registration_number = :registration
               AND filing.filing_year = :year
               AND filing.filer_kind = 'candidate_committee'
               AND extract(year FROM filing.reported_through) = :year
               AND verdict.snapshot_id = :snapshot
               AND verdict.status = 'agrees'
               AND verdict.cut_off_date = filing.reported_through
               AND NOT EXISTS (
                   SELECT 1 FROM cf_filing_report report
                    WHERE report.snapshot_id = filing.snapshot_id
                      AND report.registration_number = filing.registration_number
                      AND report.filing_year = filing.filing_year
                      AND report.special_election IS TRUE
               )
        """),
        params,
    ).first()
    if eligible is None:
        return None
    rows = db.execute(
        text("""
            SELECT contributor, contrib_zip,
                   coalesce(sum(amount) FILTER (WHERE lower(in_kind) = 'no'), 0) AS cash,
                   count(*) FILTER (
                       WHERE lower(coalesce(in_kind, '')) NOT IN ('yes', 'no')
                          OR (lower(in_kind) = 'no' AND amount IS NULL)
                   ) AS unreadable
              FROM cf_contribution_row
             WHERE snapshot_id = :snapshot
               AND recipient_reg_num = :registration
               AND year = :year
               AND contrib_type = 'Individual'
               AND receipt_type = 'Contribution'
             GROUP BY contributor, contrib_zip
        """),
        params,
    ).all()
    if not rows:
        reader._refuse_if_rows_are_gone(db, release, reader.Dataset.contributions)
    cash: dict[str, Decimal] = {"unknown": Decimal(0)}
    names: dict[str, set[str]] = {"unknown": set()}
    summary_cash = dict.fromkeys(("minnesota", "other_states", "unknown"), Decimal(0))
    summary_names: dict[str, set[str]] = {key: set() for key in summary_cash}
    for row in rows:
        if row.unreadable:
            return None
        state = reference.state_for(row.contrib_zip) or "unknown"
        category = (
            "minnesota"
            if state == "MN"
            else ("unknown" if state == "unknown" else "other_states")
        )
        cash[state] = cash.get(state, Decimal(0)) + row.cash
        summary_cash[category] += row.cash
        state_names = names.setdefault(state, set())
        if row.contributor is not None:
            state_names.add(row.contributor)
            summary_names[category].add(row.contributor)
    return DonorStates(
        state="reported",
        year=year,
        rows=tuple(
            DonorStateRow(len(names[state]), cash[state], state)
            for state in sorted(cash, key=lambda state: (state == "unknown", state))
        ),
        summary=DonorStateSummary(
            **{
                category: DonorStateAmounts(len(summary_names[category]), total)
                for category, total in summary_cash.items()
            }
        ),
        reference=reference.public_metadata(),
    )
