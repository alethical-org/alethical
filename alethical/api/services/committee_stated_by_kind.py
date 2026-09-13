"""The 5 filed contribution lines beside matching named cash, for one committee.

An agreeing comparison must belong to both currently read source copies. Its cutoff
also bounds the cash rows: later donations cannot be subtracted from an earlier
filing. Undated rows remain included, as in the stored stated-split comparison.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline.campaign_finance_reader import Release


@dataclass(frozen=True)
class StatedKindLine:
    line_key: str
    label_as_filed: str
    stated_total: Decimal
    itemized_cash_total: Decimal
    difference: Decimal


@dataclass(frozen=True)
class StatedByKind:
    state: str
    reported_through: date
    lines: tuple[StatedKindLine, ...] = ()


# This is the filing's schedule mapping, not the donor-list display grouping.
# A terminating candidate committee belongs on the party-unit filing line.
_SOURCE_KINDS = {
    "Individual": "individuals_contributions",
    # The held report for 19492/2026 lists its Self cash on A1 - IND.
    "Self": "individuals_contributions",
    "Lobbyist": "lobbyist_contributions",
    "Political Committee/Fund": "committee_fund_contributions",
    "Party Unit": "party_unit_contributions",
    "Candidate Committee": "party_unit_contributions",
    "Other": "other_contributions",
}
_LINE_ORDER = tuple(dict.fromkeys(_SOURCE_KINDS.values()))


def stated_by_kind(
    db: Session, release: Release, registration_number: str, year: int
) -> StatedByKind | None:
    """Omit an unproved comparison; a negative difference returns no figures.

    The caller pins its whole request to a repeatable database view. The join below
    then requires the verdict to name that contribution copy and the current filings
    copy, so replacing either input retires the old permission to subtract.
    """
    params = {
        "contributions": release.contributions.snapshot_id,
        "registration": registration_number,
        "year": year,
    }
    figures = db.execute(
        text(
            """
            SELECT figure.line_key, figure.label_as_served, figure.amount,
                   filing.reported_through
              FROM cf_filing_current current_copy
              JOIN cf_filing filing ON filing.snapshot_id = current_copy.snapshot_id
              JOIN cf_stated_split verdict
                ON verdict.filings_snapshot_id = filing.snapshot_id
               AND verdict.registration_number = filing.registration_number
               AND verdict.filing_year = filing.filing_year
              JOIN cf_filing_figure figure ON figure.filing_id = filing.id
             WHERE current_copy.id IS TRUE
               AND filing.registration_number = :registration
               AND filing.filing_year = :year
               AND filing.filer_kind = 'candidate_committee'
               AND extract(year FROM filing.reported_through) = :year
               AND verdict.snapshot_id = :contributions
               AND verdict.status = 'agrees'
               AND verdict.cut_off_date = filing.reported_through
               AND NOT EXISTS (
                   SELECT 1 FROM cf_filing_report report
                    WHERE report.snapshot_id = filing.snapshot_id
                      AND report.registration_number = filing.registration_number
                      AND report.filing_year = filing.filing_year
                      AND report.special_election IS TRUE
               )
            """
        ),
        params,
    ).all()
    filed = {row.line_key: row for row in figures if row.line_key in _LINE_ORDER}
    if len(filed) != len(_LINE_ORDER):
        return None
    through = filed[_LINE_ORDER[0]].reported_through
    cash_rows = db.execute(
        text(
            """
            SELECT contrib_type,
                   coalesce(sum(amount), 0) AS cash,
                   count(*) FILTER (
                       WHERE amount IS NULL OR lower(coalesce(in_kind, '')) <> 'no'
                   ) AS unreadable
              FROM cf_contribution_row
             WHERE snapshot_id = :contributions
               AND recipient_reg_num = :registration
               AND year = :year
               AND receipt_type = 'Contribution'
               AND lower(coalesce(in_kind, '')) <> 'yes'
               AND (receipt_date IS NULL OR receipt_date <= :through)
             GROUP BY contrib_type
            """
        ),
        {**params, "through": through},
    ).all()
    if not cash_rows:
        try:
            reader._refuse_if_rows_are_gone(db, release, reader.Dataset.contributions)
        except reader.ReleaseNoLongerHeld:
            return None
    cash = dict.fromkeys(_LINE_ORDER, Decimal(0))
    for row in cash_rows:
        key = _SOURCE_KINDS.get(row.contrib_type)
        # A blank/unknown kind cannot be silently assigned to Other. Nor can a
        # missing amount or in-kind marker become a cash zero.
        if key is None or row.unreadable:
            return None
        cash[key] += row.cash
    lines = tuple(
        StatedKindLine(
            key,
            filed[key].label_as_served,
            filed[key].amount,
            cash[key],
            filed[key].amount - cash[key],
        )
        for key in _LINE_ORDER
    )
    if any(line.difference < 0 for line in lines):
        return StatedByKind("sources_disagree", through)
    return StatedByKind("reported", through, lines)
