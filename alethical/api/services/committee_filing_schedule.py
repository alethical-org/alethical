"""When a committee's next money report is due, keyed on its registration number.

Net: hand this a committee's registration number and a year and it says whether that
committee is on the state's election-year filing calendar or its not-on-the-ballot one,
and when its next report is due. That is what lets a money page reading "Not reported"
for a whole year add the sentence that makes it honest -- nothing is due until 1 Feb
2027 -- instead of leaving a blank that looks like concealment
([#1375](https://github.com/alethical-org/alethical/issues/1375)).

**Keyed on the registration number and never on a legislator**, matching
``alethical/api/services/committee_finance.py``: Minnesota identifies a campaign
committee by a number and never says whose it is, so a number needs no human
confirmation while a *legislator's* schedule waits on someone confirming which committee
is theirs (``docs/architecture/campaign-finance-system-design.md`` §5, Identity, and
[#1354](https://github.com/alethical-org/alethical/issues/1354)). The
``legislator_campaign_committee`` table held **0 confirmed links** when this was
written, so this is deliberately the committee-shaped layer underneath that
confirmation. A page joins through the link when one exists; nothing here re-derives a
committee from a name.

**Computed on read, not stored, and that is a correctness decision rather than a
shortcut.** The answer is a function of the day it is asked: "the next report due"
changes the moment a deadline passes, so a stored due date is silently wrong from the
following morning and nothing about the snapshot it was derived from would look stale.
Every input is already stored -- the Board's report catalogue in ``cf_filing_report``,
the registration and its termination date in ``cf_filer``
([#1408](https://github.com/alethical-org/alethical/issues/1408)) -- and the calendars
ship in the repo, so there is nothing here a table would add except a second thing to
keep in step. No migration.

**All 3 unknown states are separate facts and none of them is a schedule.** No filings
snapshot published, this committee not in the snapshot, and the schedule not
establishable are 3 different sentences, and the first 2 are about us rather than about
the committee (rule 12 of ``.claude/rules/grounded-answers.md``). Every one arrives
carrying a ``reason``, so a surface never has to invent wording for a missing date.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.pipeline.campaign_finance_filing_calendars import (
    CataloguedReport,
    Determination,
    ScheduleClass,
    classify,
)
from alethical.pipeline.campaign_finance_filings import live_filings_snapshot

#: No filings snapshot is published at all, so nothing can be said about any committee's
#: schedule. A fact about us, not about the committee.
NO_SNAPSHOT = "no_snapshot"
#: A snapshot is published and does not carry this registration number. Ordinary for a
#: committee registered since the last run, and still not a schedule.
FILER_NOT_IN_SNAPSHOT = "filer_not_in_snapshot"


@dataclass(frozen=True)
class ScheduleUnavailable:
    """Why no determination could be attempted, distinct from one that came out unknown.

    Separated from ``Determination`` on purpose. "We hold no filings at all" and "we
    hold this committee's filings and still cannot place it" would render as the same
    empty date if they shared a type, and they are different claims -- the first is
    about our data and the second is about the state's.
    """

    registration_number: str
    year: int
    state: str
    reason: str


def filing_schedule(
    db: Session,
    registration_number: str,
    *,
    year: int,
    as_of: Optional[date] = None,
) -> Determination | ScheduleUnavailable:
    """One committee's filing schedule for ``year``, as of a given day.

    ``as_of`` defaults to today and is a parameter so a test can pin a day and a caller
    can ask what a page said last week. It is the *only* clock in this path; the pure
    logic never reads one.
    """
    as_of = as_of or date.today()
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return ScheduleUnavailable(
            registration_number=registration_number,
            year=year,
            state=NO_SNAPSHOT,
            reason=(
                "no campaign-finance filings have been published yet, so we cannot say "
                "when this committee's next report is due"
            ),
        )

    filer = db.execute(
        select(
            schema.CampaignFinanceFiler.office,
            schema.CampaignFinanceFiler.termination_date,
        ).where(
            schema.CampaignFinanceFiler.snapshot_id == snapshot.id,
            schema.CampaignFinanceFiler.registration_number == registration_number,
        )
    ).first()
    if filer is None:
        return ScheduleUnavailable(
            registration_number=registration_number,
            year=year,
            state=FILER_NOT_IN_SNAPSHOT,
            reason=(
                "the state's registered-filer list as we last read it does not carry "
                f"committee {registration_number}, so we cannot say when its next "
                "report is due"
            ),
        )
    office, termination_date = filer

    return classify(
        registration_number=registration_number,
        year=year,
        catalogued=_catalogued_reports(db, snapshot.id, registration_number, year),
        office=office,
        termination_date=termination_date,
        as_of=as_of,
    )


def _catalogued_reports(
    db: Session, snapshot_id, registration_number: str, year: int
) -> list[CataloguedReport]:
    """The reports the Board has scheduled for this committee in ``year``.

    Scoped to the year in the query rather than in the caller, unlike the fetch that
    populated the table: one *request* to the Board returns a filer's whole history
    (§9.6), but a read of our own rows has an index on
    ``(snapshot, registration, year)`` and no reason to load 28 rows to look at 3.
    """
    rows = db.execute(
        select(
            schema.CampaignFinanceFilingReport.filing_year,
            schema.CampaignFinanceFilingReport.report_name,
            schema.CampaignFinanceFilingReport.special_election,
        ).where(
            schema.CampaignFinanceFilingReport.snapshot_id == snapshot_id,
            schema.CampaignFinanceFilingReport.registration_number
            == registration_number,
            schema.CampaignFinanceFilingReport.filing_year == year,
        )
    ).all()
    return [
        CataloguedReport(
            filing_year=filing_year,
            report_name=report_name or "",
            special_election=bool(special_election),
        )
        for filing_year, report_name, special_election in rows
    ]


@dataclass(frozen=True)
class ScheduleCoverage:
    """How many committees in a population could be placed on a calendar, and how many
    could not.

    Exists because [#1375](https://github.com/alethical-org/alethical/issues/1375) asks
    for the residual to be reported honestly rather than implied by whatever a page
    happens to render, and because a share that moves between runs is the signal that
    the Board changed something. Counts are evidence, never requirements (§8).
    """

    year: int
    as_of: date
    filing_for_office: int
    not_filing_for_office: int
    terminated: int
    unknown: int
    # Committees a page can print an actual next-due date for. Counted separately from
    # the classes above because knowing *which* calendar a committee is on is not the
    # same as being able to name its next report: a committee on the ballot for a
    # statewide seat is classified and still has no date, because that seat's calendar
    # is not transcribed. This is the number a "Not reported" state depends on.
    with_next_due_date: int
    unknown_reasons: tuple[tuple[str, str], ...]

    @property
    def total(self) -> int:
        return (
            self.filing_for_office
            + self.not_filing_for_office
            + self.terminated
            + self.unknown
        )

    @property
    def answered(self) -> int:
        """Committees a page can say something true and specific about: a next due date,
        or a closed registration that owes nothing further."""
        return self.with_next_due_date + self.terminated


def schedule_coverage(
    db: Session,
    registration_numbers: Iterable[str],
    *,
    year: int,
    as_of: Optional[date] = None,
) -> ScheduleCoverage:
    """Classify a whole population at once, and count what could not be placed.

    One query for the whole population rather than one per committee, because the only
    caller sweeps every sitting legislator's committee and a per-committee read would
    be 200 round trips to answer one question.
    """
    as_of = as_of or date.today()
    wanted = list(dict.fromkeys(registration_numbers))
    counts = {member: 0 for member in ScheduleClass}
    with_date = 0
    reasons: list[tuple[str, str]] = []
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return ScheduleCoverage(
            year=year,
            as_of=as_of,
            filing_for_office=0,
            not_filing_for_office=0,
            terminated=0,
            unknown=len(wanted),
            with_next_due_date=0,
            unknown_reasons=tuple(
                (registration, "no campaign-finance filings have been published yet")
                for registration in wanted
            ),
        )

    filers = {
        registration: (office, termination)
        for registration, office, termination in db.execute(
            select(
                schema.CampaignFinanceFiler.registration_number,
                schema.CampaignFinanceFiler.office,
                schema.CampaignFinanceFiler.termination_date,
            ).where(
                schema.CampaignFinanceFiler.snapshot_id == snapshot.id,
                schema.CampaignFinanceFiler.registration_number.in_(wanted),
            )
        ).all()
    }
    catalogued: dict[str, list[CataloguedReport]] = {}
    for registration, filing_year, report_name, special in db.execute(
        select(
            schema.CampaignFinanceFilingReport.registration_number,
            schema.CampaignFinanceFilingReport.filing_year,
            schema.CampaignFinanceFilingReport.report_name,
            schema.CampaignFinanceFilingReport.special_election,
        ).where(
            schema.CampaignFinanceFilingReport.snapshot_id == snapshot.id,
            schema.CampaignFinanceFilingReport.registration_number.in_(wanted),
            schema.CampaignFinanceFilingReport.filing_year == year,
        )
    ).all():
        catalogued.setdefault(registration, []).append(
            CataloguedReport(
                filing_year=filing_year,
                report_name=report_name or "",
                special_election=bool(special),
            )
        )

    for registration in wanted:
        if registration not in filers:
            counts[ScheduleClass.unknown] += 1
            reasons.append(
                (
                    registration,
                    "the state's registered-filer list as we last read it does not "
                    "carry this committee",
                )
            )
            continue
        office, termination = filers[registration]
        determination = classify(
            registration_number=registration,
            year=year,
            catalogued=catalogued.get(registration, []),
            office=office,
            termination_date=termination,
            as_of=as_of,
        )
        counts[determination.schedule_class] += 1
        if determination.has_next_report:
            with_date += 1
        if determination.schedule_class is ScheduleClass.unknown:
            reasons.append((registration, determination.reason))

    return ScheduleCoverage(
        year=year,
        as_of=as_of,
        filing_for_office=counts[ScheduleClass.filing_for_office],
        not_filing_for_office=counts[ScheduleClass.not_filing_for_office],
        terminated=counts[ScheduleClass.terminated],
        unknown=counts[ScheduleClass.unknown],
        with_next_due_date=with_date,
        unknown_reasons=tuple(reasons),
    )
