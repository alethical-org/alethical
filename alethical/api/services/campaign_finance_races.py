"""Money by race: every candidate committee, grouped by the seat it registered for.

The read behind ``GET /campaign-finance/races`` and the `/money/races` page
([#1954](https://github.com/alethical-org/alethical/issues/1954)). The Board's own
register gives every candidate committee an office and most of them a district, with
no person-checked link involved, so a contest is a grouping the state already made
rather than one we infer: 778 committees, 222 contests on the live register, 23 of them
with a single committee and the Governor's race one statewide group of 28.

Three constraints are the whole design, and each has a test written to fail on the
attempt rather than on the harm (``alethical/tests/test_campaign_finance_races.py``):

* **No per-contest total, ever.** A sum across several committees is forbidden
  everywhere in this product (``.claude/rules/grounded-answers.md`` rule 12;
  ``docs/architecture/campaign-finance-system-design.md`` §7). A contest heading
  carries a COUNT of committees and nothing is added up. Every money figure leaves
  here as a ``CommitteeAmount`` tagged with the committee that reported it, so adding
  2 of them raises instead of answering (``committee_amount.py``).
* **Never ordered by amount.** Print no total and still sort biggest-first, and the page
  becomes the ranking the rules forbid. The order is office, then district, then the
  filed name, and ``ordered_by`` names it so the page prints the order rather than
  leaving a reader to infer one from the amounts.
* **Every figure carries its own dates.** Each committee's reported total carries the
  period its own filing states, and its named-donations figure carries the dates of
  the payments we hold. One contest usually shares a filing calendar, which is what
  makes the list honest; where 2 committees in one contest report over different
  periods, ``periods_differ`` is set so the page says so above the rows.

The figures are the same 2 the committee page's money-in card shows as its reported
total and its "Donations with a donor's name" line, read the same way: the reported
total from the filer's own report (``campaign_finance_filings.filings_context``), kept
only when its coverage end falls inside the year asked for (§7's guard against the
totals route answering a year with the previous year's report) and never for a
special-election filer-year; the named figure from the contribution download's
``Contribution`` rows for that filer-year. A missing figure is ``None`` and a page
prints the words "Not reported", never a zero.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from alethical.api.services.campaign_finance_register import (
    REPORTED,
    UNAVAILABLE,
    register_summary,
)
from alethical.api.services.committee_amount import reported_by
from alethical.api.services.committee_finance import NOT_REPORTED
from alethical.db.schema import load_schema
from alethical.pipeline import campaign_finance_filings as filings
from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline.campaign_finance_filing_calendars import (
    printed_period_start_for_end,
)

schema = load_schema()

#: The one order this list is served in, printed on the page so it is never inferred.
ORDERED_BY_DISTRICT_THEN_NAME = "district_then_name"

#: The register's offices in the order the page lists them: the 2 legislative
#: chambers, then the statewide offices, then the courts. An office the register adds
#: later sorts after these, alphabetically, rather than being dropped.
OFFICE_ORDER: tuple[str, ...] = (
    "House",
    "Senate",
    "Governor",
    "Attorney General",
    "Secretary of State",
    "State Auditor",
    "Supreme Court",
    "Appellate Court",
    "District Court",
)


@dataclass(frozen=True)
class NamedDonations:
    """The named-donations figure for one committee-year, with the dates it covers.

    ``state`` is the committee page's own vocabulary: ``reported`` with a figure,
    ``not_reported`` when the download covers the year and holds no row for this
    committee (silence, never a zero), ``unavailable`` when we hold nothing that can
    speak for the year at all, or hold rows we cannot add up.
    """

    state: str
    total: Optional[Decimal]
    payments: Optional[int]
    first_payment_on: Optional[date]
    last_payment_on: Optional[date]


@dataclass(frozen=True)
class RaceCommittee:
    """One candidate committee in a contest, with its own 2 figures and their dates."""

    registration_number: str
    name: str
    is_closed: bool
    termination_date: Optional[date]
    #: The filer's own reported contribution total for the year, tagged with the
    #: committee that reported it, or ``None`` where no filing speaks for the year.
    reported_total: Optional[Decimal]
    reported_through: Optional[date]
    reported_period_start: Optional[date]
    named: NamedDonations


@dataclass(frozen=True)
class Contest:
    """One office-and-district grouping of candidate committees.

    Carries a count and never a sum. ``periods_differ`` is True when 2 or more of its
    committees' reported totals cover different periods, so the page can say so above
    the rows rather than setting one period silently against another.
    """

    office: str
    district: Optional[str]
    #: A stable fragment for linking one contest: ``house-12a``, ``governor``.
    anchor: str
    committees: tuple[RaceCommittee, ...]
    periods_differ: bool

    @property
    def committee_count(self) -> int:
        return len(self.committees)


@dataclass(frozen=True)
class RacesPage:
    state: str
    ordered_by: str
    year: int
    office: Optional[str]
    contests: tuple[Contest, ...]
    #: Every office on the register with its committee count, unfiltered, so the
    #: office chips label themselves from it whatever filter is applied.
    offices: tuple[tuple[str, int], ...]
    committee_count: Optional[int]
    as_of: Optional[date]
    snapshot_id: Optional[UUID]
    release_id: Optional[UUID]
    #: When the download release behind ``named`` was copied from the Board: the one
    #: labelled freshness date the page prints (rule 12, #861). ``None`` with no release.
    fetched_at: Optional[datetime]
    reason: Optional[str]


_CHUNK = re.compile(r"(\d+)|(\D+)")


def district_sort_key(district: Optional[str]) -> tuple:
    """Order districts the way a person reads them: 2 before 10, 12A before 12B.

    The register's districts are strings of several shapes -- ``10A`` for the House,
    ``1``..``67`` for the Senate, ``2-14`` (judicial district, seat) for a district
    court, ``Chief`` for the chief justice -- so a plain string sort would put 10
    before 2. Each run of digits compares as a number and each run of letters as
    text; a district with no digits sorts after every numbered one, and a statewide
    office (no district) comes first in its office.
    """
    if district is None:
        return ((0,),)
    parts: list[tuple[int, int, str]] = []
    for digits, letters in _CHUNK.findall(district):
        if digits:
            parts.append((1, int(digits), ""))
        else:
            parts.append((2, 0, letters.strip().lower()))
    return tuple(parts) or ((3, 0, district.lower()),)


def office_sort_key(office: str) -> tuple[int, str]:
    try:
        return (OFFICE_ORDER.index(office), "")
    except ValueError:
        return (len(OFFICE_ORDER), office.lower())


def contest_anchor(office: str, district: Optional[str]) -> str:
    """``house-12a``, ``senate-41``, ``governor``, ``district-court-2-14``."""
    raw = office if district is None else f"{office} {district}"
    slug = re.sub(r"[^a-z0-9]+", "-", raw.lower()).strip("-")
    return slug


def _named_donations(
    db: Session, release, year: int
) -> tuple[dict[str, NamedDonations], bool]:
    """Every filer's named contributions for one year, in one statement.

    Mirrors ``campaign_finance_reader.money_in`` -- the file's own ``Year`` column,
    ``Receipt type = 'Contribution'`` only, blanks counted rather than summed as 0 --
    but for the whole file at once, because 778 single-committee reads would be 778
    round trips for one page. Returns the per-filer figures and whether the download
    holds any row at all for the year, which decides what an absent filer means.
    """
    rows = db.execute(
        text(
            "SELECT recipient_reg_num, count(*), coalesce(sum(amount), 0), "
            "       count(*) - count(amount), min(receipt_date), max(receipt_date) "
            "  FROM cf_contribution_row "
            " WHERE snapshot_id = :snapshot AND year = :year "
            "   AND receipt_type = :contribution AND recipient_reg_num IS NOT NULL "
            " GROUP BY recipient_reg_num"
        ),
        {
            "snapshot": release.contributions.snapshot_id,
            "year": year,
            "contribution": reader.CONTRIBUTION_RECEIPT,
        },
    ).all()
    covers_year = (
        db.scalar(
            select(schema.CampaignFinanceContributionRow.row_number)
            .where(
                schema.CampaignFinanceContributionRow.snapshot_id
                == release.contributions.snapshot_id,
                schema.CampaignFinanceContributionRow.year == year,
            )
            .limit(1)
        )
        is not None
    )
    named: dict[str, NamedDonations] = {}
    for reg_num, count, total, missing, first_on, last_on in rows:
        if missing:
            # Rows we hold and cannot add up: a gap in our copy, never a zero and
            # never a figure (rule 12, #1442).
            named[reg_num] = NamedDonations(UNAVAILABLE, None, None, None, None)
            continue
        named[reg_num] = NamedDonations(
            REPORTED, reported_by(reg_num, total), int(count), first_on, last_on
        )
    return named, covers_year


def _absent_named(covers_year: bool) -> NamedDonations:
    return NamedDonations(
        NOT_REPORTED if covers_year else UNAVAILABLE, None, None, None, None
    )


def races(
    db: Session, *, year: int, office: Optional[str] = None, release=None
) -> RacesPage:
    """Every candidate committee on the register, grouped by office and district.

    Ordered by office, then district, then the filed name, and by nothing else: there
    is no parameter that orders by money, in either direction. ``office`` narrows to
    one of the register's own office values; an office the register does not hold
    yields no contests rather than an error, and ``offices`` still lists every real
    one so a caller can offer the right chips.

    Refuses rather than describing an empty register in the same cases as
    ``campaign_finance_register.committees``: no filings snapshot published, or a
    register whose rows were replaced under this read.
    """
    summary = register_summary(db)
    if summary.state != REPORTED:
        return RacesPage(
            state=summary.state,
            ordered_by=ORDERED_BY_DISTRICT_THEN_NAME,
            year=year,
            office=office,
            contests=(),
            offices=(),
            committee_count=None,
            as_of=summary.as_of,
            snapshot_id=summary.snapshot_id,
            release_id=None,
            fetched_at=None,
            reason=summary.reason,
        )
    filer = schema.CampaignFinanceFiler
    rows = db.execute(
        select(
            filer.registration_number,
            filer.name,
            filer.office,
            filer.district,
            filer.termination_date,
        ).where(
            filer.snapshot_id == summary.snapshot_id,
            filer.kind == schema.CampaignFinanceFilerKind.candidate_committee,
            filer.office.is_not(None),
        )
    ).all()

    office_counts: dict[str, int] = {}
    for _, _, row_office, _, _ in rows:
        office_counts[row_office] = office_counts.get(row_office, 0) + 1
    offices = tuple(
        (name, office_counts[name])
        for name in sorted(office_counts, key=office_sort_key)
    )

    context = filings.filings_context(db)
    if release is not None:
        named, covers_year = _named_donations(db, release, year)
    else:
        named, covers_year = {}, False

    grouped: dict[tuple[str, Optional[str]], list[RaceCommittee]] = {}
    for reg_num, name, row_office, district, terminated in rows:
        if office is not None and row_office != office:
            continue
        reported_total: Optional[Decimal] = None
        through: Optional[date] = None
        start: Optional[date] = None
        if context is not None:
            key = (reg_num, year)
            total = context.reported_contributions.get(key)
            end = context.reported_through.get(key)
            # §7's coverage-end guard: a figure whose period end falls outside the
            # year asked for is last year's money under this year's heading, and a
            # special-election filer-year's regular series is not the year either.
            if (
                total is not None
                and end is not None
                and end.year == year
                and key not in context.special_election_filer_years
            ):
                reported_total = reported_by(reg_num, total)
                through = end
                start = printed_period_start_for_end(end)
        grouped.setdefault((row_office, district), []).append(
            RaceCommittee(
                registration_number=reg_num,
                name=name,
                is_closed=terminated is not None,
                termination_date=terminated,
                reported_total=reported_total,
                reported_through=through,
                reported_period_start=start,
                named=named.get(reg_num, _absent_named(covers_year)),
            )
        )

    contests: list[Contest] = []
    for (row_office, district), committees in sorted(
        grouped.items(),
        key=lambda item: (office_sort_key(item[0][0]), district_sort_key(item[0][1])),
    ):
        ordered = tuple(sorted(committees, key=lambda c: c.name.casefold()))
        periods = {
            (c.reported_period_start, c.reported_through)
            for c in ordered
            if c.reported_total is not None
        }
        contests.append(
            Contest(
                office=row_office,
                district=district,
                anchor=contest_anchor(row_office, district),
                committees=ordered,
                periods_differ=len(periods) > 1,
            )
        )

    return RacesPage(
        state=REPORTED,
        ordered_by=ORDERED_BY_DISTRICT_THEN_NAME,
        year=year,
        office=office,
        contests=tuple(contests),
        offices=offices,
        committee_count=len(rows),
        as_of=summary.as_of,
        snapshot_id=summary.snapshot_id,
        release_id=getattr(release, "id", None),
        fetched_at=getattr(release, "fetched_at", None),
        reason=None,
    )
