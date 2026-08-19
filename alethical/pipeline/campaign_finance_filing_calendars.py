"""Which of Minnesota's filing calendars a committee is on, and what it owes next.

Net: a sitting legislator who is not on this year's ballot files nothing covering this
year's money until a year-end report due the following February, so their money page
reads "Not reported" for a whole year. This module works out *which* calendar a
committee is on and *when* its next report is due, so that blank year can say something
true instead of looking like concealment. A committee whose calendar cannot be
established is reported as unknown and never defaulted onto one
([#1375](https://github.com/alethical-org/alethical/issues/1375)).

Two halves, and the split is the point:

* ``CALENDARS`` is the Board's own annual disclosure calendars, hand-transcribed from
  the PDFs it publishes. 4 short documents a year, produced once in July and not
  revised, so next year's update is an edit to this file rather than an investigation.
  ``SOURCE_URLS`` and ``TRANSCRIBED_ON`` record where each was read from and when.
* ``classify`` decides which calendar a committee is on, from the Board's own record of
  what it has already scheduled for that committee. It writes nothing, reads no
  database and no clock; the caller hands it rows and a date.

**Why the calendars have to be transcribed at all**, given that the Board serves a
release date per report (``docs/architecture/campaign-finance-system-design.md`` §9.4,
Report PDFs are a fallback, not a route): because both served signals only speak for
reports the Board has *already* catalogued, and it catalogues a report when that
report's filing period opens, not a year ahead. Measured against the live filings
snapshot on 12 Aug 2026: 1,261 filers carry a catalogued 2026 pre-primary report and
**not one filer of any kind carries a 2026 pre-general**, though it is due 26 Oct 2026.
So nothing served can name the next report for the very population this exists for.

**What the classification rests on: the catalogue is a schedule, not a filing record.**
It lists a report from the moment that report's period opens, filed or not. Filer
18767's 2026 pre-primary is catalogued with a 20 Jul cut-off and no amendment record at
all, which is what an unfiled report looks like; 7 of the 1,261 catalogued 2026
pre-primary reports were unfiled at snapshot time. So a live committee carrying no
election report for a year, once that year's first election report has come due, is a
committee the Board never scheduled one for. Before that due date passes, absence means
nothing and this module says unknown.

**The transcription and the served data confirm each other**, which is the check worth
having on a hand-transcription. Every period end printed on the party-unit and
committee-or-fund calendars matches the ``CutOffDate`` the Board serves for the report
of that name, on all 5 of 2026's periodic reports: first 31 Mar, second 31 May,
third/pre-primary 20 Jul, fourth 15 Sep, fifth/pre-general 19 Oct. ``test_campaign_
finance_filing_calendars.py`` pins the 3 of those that the candidate calendars share.

**Four things deliberately not claimed here.**

* **Never that a report is late.** The absent amendment record that marks an unfiled
  report is only readable that way in the current year: 3,036 of 36,655 catalogued
  reports carry none, and 2,140 of those are from 2002 to 2007, where §9.4 (Report PDFs
  are a fallback, not a route) establishes
  documents are not served at all. Calling one of those late would put "late" on a
  20-year-old filing, and telling a reader a named politician missed a deadline they do
  not have is the worst thing this surface can do.
* **Never a period start we did not read off a document.** ``docs/architecture/campaign-finance-system-design.md``
  §7 (Display rules) forbids hardcoding
  1 January precisely because a special-election filer's period does not start there.
  Every start below is printed on the calendar it came from -- including the 2025
  year-end report's ``1/1/2025``, which is the one most likely to be assumed.
* **Never a schedule for a special-election filer.** They file a whole second report
  series whose period starts §9.9 (Checks this design asks for that were not run) records
  as confirmed on one filer-year, so they are
  reported unknown rather than placed on a calendar built for the regular series.
* **Never a no-activity rule.** None of the 4 calendars says what a committee with no
  activity owes; searched for "activit", "even if", "zero", "no receipts" and "nothing"
  across all 4, with no match in any. If a surface ever needs that rule it has to come
  from the statute or a Board instruction page and be cited there, not here.

**What the calendars carry that this module deliberately leaves out**, so the boundary
is a decision rather than a gap. Each calendar also prints election dates, late-fee
start dates, the legislative-session contribution ban, public-subsidy milestones, a
statement of economic interest (legislative candidates, due 16 Jun 2026) and, on 2 of
the 4, a next-business-day notice for large contributions. The notices are the
interesting exclusion: they print a window in the date column and **no due date at
all** ("by the end of the next business day after receipt"), so there is no due date to
store for one without inventing it. Everything here is a periodic report of receipts
and expenditures with a printed period and a printed due date, which is what the
"Not reported" state needs.
"""

from __future__ import annotations

import enum
import re
from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional, Sequence


class CalendarKey(enum.Enum):
    """One of the Board's 4 annual disclosure calendars.

    Named for the population each covers rather than for its filename, because the
    filenames are not promised to be stable across years while the population is what
    decides which calendar a committee is on.
    """

    legislative_candidate_filing_for_office = "legislative_candidate_filing_for_office"
    candidate_not_filing_for_office = "candidate_not_filing_for_office"
    state_party_or_legislative_caucus = "state_party_or_legislative_caucus"
    political_committee_or_fund = "political_committee_or_fund"


# Where each calendar was read from. The Board links these from
# https://cfb.mn.gov/reports-and-data/self-help/data-downloads/ under Disclosure
# Publications -> Calendars. All 4 URLs verified resolving on 12 Aug 2026.
SOURCE_URLS: dict[CalendarKey, str] = {
    CalendarKey.legislative_candidate_filing_for_office: (
        "https://cfb.mn.gov/pdf/calendars/2026_senate_house_district_court.pdf"
    ),
    CalendarKey.candidate_not_filing_for_office: (
        "https://cfb.mn.gov/pdf/calendars/2026_candidates_not_running.pdf"
    ),
    CalendarKey.state_party_or_legislative_caucus: (
        "https://cfb.mn.gov/pdf/calendars/2026_state_parties_leg_caucuses.pdf"
    ),
    CalendarKey.political_committee_or_fund: (
        "https://cfb.mn.gov/pdf/calendars/2026_PCF.pdf"
    ),
}

# When these documents were read and typed in. Not a version the Board publishes: none
# of the 4 prints a version, revision or "current as of" line anywhere on its face, so
# our own reading date is the only provenance available. Their unprinted file metadata
# says all 4 were produced from Word in July 2025.
TRANSCRIBED_ON = date(2026, 8, 12)

# The printed scope sentence of the not-filing-for-office calendar, which is the primary
# source for the whole classification below. Kept verbatim because it is the sentence
# that says the 2 candidate calendars are mutually exclusive and what separates them.
NOT_FILING_SCOPE_SENTENCE = (
    "This calendar does not apply to legislative or district court candidates who will "
    "file to appear on the ballot in 2026 or to constitutional or appellate court "
    "candidates whose seat will be on the ballot in 2026."
)


class ScheduleClass(enum.Enum):
    """What we were able to establish about a committee's filing schedule.

    ``unknown`` is a first-class answer and not an error
    (``.claude/rules/grounded-answers.md`` rule 12): a missing schedule and a schedule
    of "nothing until February" are different facts, and defaulting the first onto a
    calendar is how a page ends up asserting a deadline nobody has.
    """

    filing_for_office = "filing_for_office"
    not_filing_for_office = "not_filing_for_office"
    terminated = "terminated"
    unknown = "unknown"


@dataclass(frozen=True)
class CalendarEntry:
    """One report of receipts and expenditures a calendar names.

    ``period_start`` and ``period_end`` are read off the document. They are not Optional
    because every periodic report on all 4 calendars prints both ends; an entry that
    printed neither would be one of the excluded notices rather than a report.

    ``condition`` is a printed exemption, verbatim, on a report that is otherwise
    ordinary. **A surface that prints this report's due date must print its condition
    too.** The 2026 pre-general report is the live case: every candidate who advances
    past the primary owes it, and one who lost the primary does not, and no source we
    hold says which happened. Suppressing the report would give the wrong date to the
    many; asserting it unqualified would give a deadline to the few who have none. The
    printed sentence is the only honest form, so it travels with the date.
    """

    report_name: str
    period_start: date
    period_end: date
    due_date: date
    condition: Optional[str] = None


@dataclass(frozen=True)
class CataloguedReport:
    """One report the Board has scheduled for a committee, as we already store it.

    A projection of ``cf_filing_report`` carrying only the 3 fields the classification
    reads, so the logic can be tested without a database and without a snapshot.
    """

    filing_year: int
    report_name: str
    special_election: bool


@dataclass(frozen=True)
class Determination:
    """What a page may say about one committee's filing schedule for one year.

    ``reason`` is always populated, including on success, because every state here ends
    up as words on a screen and the layout owns the wording
    (``.claude/rules/grounded-answers.md`` rule 3). It says what was established and
    from what, so a surface never has to guess why a date is missing.
    """

    registration_number: str
    year: int
    schedule_class: ScheduleClass
    reason: str
    calendar: Optional[CalendarKey] = None
    next_report: Optional[CalendarEntry] = None
    # Set only for a terminated registration, and it is the date the *registration*
    # ended rather than any report's date. The catalogue copies this value onto every
    # report row including ones filed years earlier (``docs/architecture/campaign-finance-system-design.md``
    # §9.1, The route), so it is read from the filer
    # and never from a report.
    terminated_on: Optional[date] = None

    @property
    def has_next_report(self) -> bool:
        return self.next_report is not None


# --- The transcribed calendars ---------------------------------------------------
#
# Every date below is printed on the document named in SOURCE_URLS. None is derived
# from another entry, and none is filled in from the pattern the others follow.
#
# The 2025 year-end report appears on all 4 of the 2026 calendars, because the Board
# prints the report that closes the previous year on the calendar for the year it is
# due in. It is kept rather than dropped as belonging to 2025: on any date in January
# 2026 it is genuinely the next report due.

_LEGISLATIVE_FILING_2026 = (
    CalendarEntry(
        report_name="2025 year-end report of receipts and expenditures",
        period_start=date(2025, 1, 1),
        period_end=date(2025, 12, 31),
        due_date=date(2026, 2, 2),
    ),
    CalendarEntry(
        report_name="Pre-primary report of receipts and expenditures",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 7, 20),
        due_date=date(2026, 7, 27),
    ),
    CalendarEntry(
        report_name="Pre-general report of receipts and expenditures",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 10, 19),
        due_date=date(2026, 10, 26),
        condition=(
            "Candidates who lost the primary election do not need to file this report."
        ),
    ),
    CalendarEntry(
        report_name="2026 year-end report of receipts and expenditures",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 12, 31),
        due_date=date(2027, 2, 1),
    ),
)

# The whole filing burden this calendar prints: 2 year-end reports and nothing else. No
# pre-primary, no pre-general, no large-contribution notice, no election dates. This is
# the emptiness that makes a legislator's 2026 money page read "Not reported" all year.
_NOT_FILING_2026 = (
    CalendarEntry(
        report_name="2025 year-end report of receipts and expenditures",
        period_start=date(2025, 1, 1),
        period_end=date(2025, 12, 31),
        due_date=date(2026, 2, 2),
    ),
    CalendarEntry(
        report_name="2026 year-end report of receipts and expenditures",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 12, 31),
        due_date=date(2027, 2, 1),
    ),
)

# Identical on both documents, entry for entry, in name, period and due date. Kept as
# one tuple bound to 2 keys rather than copied, because a copy is how the 2 drift.
_PARTY_AND_FUND_2026 = (
    CalendarEntry(
        report_name="2025 year-end report of receipts and expenditures",
        period_start=date(2025, 1, 1),
        period_end=date(2025, 12, 31),
        due_date=date(2026, 2, 2),
    ),
    CalendarEntry(
        report_name="First report of receipts and expenditures",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 3, 31),
        due_date=date(2026, 4, 14),
    ),
    CalendarEntry(
        report_name="Second report of receipts and expenditures",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 5, 31),
        due_date=date(2026, 6, 15),
    ),
    CalendarEntry(
        report_name="Third report of receipts and expenditures – Pre-primary-election",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 7, 20),
        due_date=date(2026, 7, 27),
    ),
    CalendarEntry(
        report_name="Fourth report of receipts and expenditures",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 9, 15),
        due_date=date(2026, 9, 22),
    ),
    CalendarEntry(
        report_name="Fifth report of receipts and expenditures – Pre-general-election",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 10, 19),
        due_date=date(2026, 10, 26),
    ),
    CalendarEntry(
        report_name="2026 year-end report of receipts and expenditures",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 12, 31),
        due_date=date(2027, 2, 1),
    ),
)

CALENDARS: dict[tuple[CalendarKey, int], tuple[CalendarEntry, ...]] = {
    (
        CalendarKey.legislative_candidate_filing_for_office,
        2026,
    ): _LEGISLATIVE_FILING_2026,
    (CalendarKey.candidate_not_filing_for_office, 2026): _NOT_FILING_2026,
    (CalendarKey.state_party_or_legislative_caucus, 2026): _PARTY_AND_FUND_2026,
    (CalendarKey.political_committee_or_fund, 2026): _PARTY_AND_FUND_2026,
}


# --- Reading the Board's own report names ----------------------------------------
#
# **Match on the report's name, never on its type letter.** The letters are not stable
# in meaning across years: in the live snapshot type ``A`` is "2010 15th Day
# Pre-Primary" in 2010 and "2026 1st Quarter Report" in 2026, and the 2026 pre-primary
# arrives as ``C`` for 1,259 filers, ``G`` for one and ``J`` for one. The printed name
# says what the report is in every year we hold.
#
# Tolerant of the Board's own typos, which are in the data rather than hypothetical:
# "Special Election: 2024 Pre-Primay Report" and "Special Election: 2025 Pre_Primary"
# both appear. A loose "pre" followed by "prim" or "gen" reads both, where an exact
# string would silently drop them. "2015 Pre-Special Election Report" carries "pre" and
# neither stem, so it correctly does not match -- it belongs to the special-election
# series that ``CataloguedReport.special_election`` already flags.
_ELECTION_REPORT = re.compile(r"pre[\s_-]*(?:prim|gen)", re.IGNORECASE)

# The offices the legislative and district-court calendar covers, as the Board's filer
# directory spells them (``cf_filer.office``).
LEGISLATIVE_AND_DISTRICT_COURT_OFFICES = frozenset(
    {"House", "Senate", "District Court"}
)


def names_an_election_report(report_name: str) -> bool:
    """Whether this report's name says it is a pre-primary or pre-general report.

    These are the reports only a committee on the ballot owes, so one of them existing
    for a year is what places a committee on the election-year calendar.
    """
    return bool(_ELECTION_REPORT.search(report_name or ""))


def first_election_report_due(
    year: int,
    calendar: CalendarKey = CalendarKey.legislative_candidate_filing_for_office,
) -> Optional[date]:
    """When the year's first pre-election report came due, from the transcription.

    This is the date that makes absence readable: past it, the Board has scheduled an
    election report for every committee that owes one, so a live committee carrying
    none is not on the election-year calendar. Before it, absence says nothing.

    Taken from the printed calendar rather than from a rule about Minnesota's election
    timetable, because the timetable is not ours to assert and the calendar states it.
    """
    entries = CALENDARS.get((calendar, year))
    if not entries:
        return None
    due = [
        entry.due_date
        for entry in entries
        if names_an_election_report(entry.report_name)
    ]
    return min(due) if due else None


def next_report_after(
    entries: Sequence[CalendarEntry], as_of: date
) -> Optional[CalendarEntry]:
    """The first report on this calendar still to come, on the day asked about.

    Inclusive of ``as_of`` itself: a report due today has not been missed, and a page
    saying "due today" is right where one saying "nothing until February" would be
    wrong by 6 months.
    """
    upcoming = [entry for entry in entries if entry.due_date >= as_of]
    return min(upcoming, key=lambda entry: entry.due_date) if upcoming else None


def calendar_for(
    schedule_class: ScheduleClass, office: Optional[str]
) -> Optional[CalendarKey]:
    """Which transcribed calendar governs a candidate committee, or None.

    Only the 2 candidate calendars are transcribed, covering legislative and
    district-court seats, which is the population a legislator's page needs
    ([#1375](https://github.com/alethical-org/alethical/issues/1375), Out of scope). A
    statewide or appellate candidate on this year's ballot is on a fifth calendar we
    have not transcribed -- ``2026 Disclosure Calendar for Candidates for Constitutional
    Offices and Appellate Courts``, which the not-filing calendar names and this batch
    did not include -- so returning None makes that surface as unknown rather than as a
    legislative deadline applied to the wrong race.

    The not-filing calendar needs no office test: its printed scope
    (``NOT_FILING_SCOPE_SENTENCE``) excludes candidates whose seat is on the ballot and
    nobody else, so it covers every candidate committee that is not, whatever seat its
    candidate last sought.
    """
    if schedule_class is ScheduleClass.filing_for_office:
        if (office or "").strip() in LEGISLATIVE_AND_DISTRICT_COURT_OFFICES:
            return CalendarKey.legislative_candidate_filing_for_office
        return None
    if schedule_class is ScheduleClass.not_filing_for_office:
        return CalendarKey.candidate_not_filing_for_office
    return None


def printed_period_start_for_end(period_end: date) -> Optional[date]:
    """The period start the Board's own calendars print against this period end.

    ``docs/architecture/campaign-finance-system-design.md`` §7 (Display rules) forbids
    hardcoding 1 January as a period start, because a special-election filer's period
    does not open there. This is the grounded alternative: the 4 transcribed calendars
    each print both ends of every periodic report, so a period end that appears on them
    carries a printed start, read off a document rather than assumed.

    ``None`` in 2 cases, and both are the "covers through" state rather than a fault:
    no transcribed calendar names this end (every year before 2025's year-end, since
    only the 2026 calendars are transcribed), or 2 of them disagree about the start. The
    calendars agree on every end they share today; the disagreement branch exists so a
    future transcription cannot introduce one silently.

    **It answers about the regular report series only.** Nothing here knows whether the
    filer is on a special-election series, whose start these calendars do not print, so
    the caller excludes those filer-years before asking (``recent_filings`` in
    ``alethical/api/services/campaign_finance_register.py``).
    """
    starts = {
        entry.period_start
        for entries in CALENDARS.values()
        for entry in entries
        if entry.period_end == period_end
    }
    return starts.pop() if len(starts) == 1 else None


def classify(
    *,
    registration_number: str,
    year: int,
    catalogued: Iterable[CataloguedReport],
    office: Optional[str],
    termination_date: Optional[date],
    as_of: date,
    evidence_read_on: date,
) -> Determination:
    """Which calendar this committee is on for ``year``, and what it owes next.

    Pure: no database, no network, no clock. ``as_of`` is a parameter because the answer
    genuinely depends on the day it is asked -- "the next report due" changes the moment
    a deadline passes -- which is also why this is computed on read and never stored.

    **``evidence_read_on`` is the day ``catalogued`` was read from the Board, and it is
    what decides whether absence means anything.** The 2 dates are separate because they
    answer separate questions: ``as_of`` picks which report is next, while
    ``evidence_read_on`` says whether the Board had yet scheduled the reports we are
    reasoning from the absence of. Collapsing them into one date is a live bug rather
    than a tidy simplification -- see the absence test below.

    The order of the tests is load-bearing. Termination first, because a closed
    registration owes nothing whatever else its catalogue holds. Then the
    special-election series, because a filer on it carries pre-election reports whose
    periods this calendar does not describe, and reading those as an ordinary
    election-year placement would print a plausible wrong date range.
    """
    for_year = [report for report in catalogued if report.filing_year == year]

    if termination_date is not None and termination_date <= as_of:
        return Determination(
            registration_number=registration_number,
            year=year,
            schedule_class=ScheduleClass.terminated,
            terminated_on=termination_date,
            reason=(
                f"this committee closed its registration on {termination_date} and "
                "filed its final report then, so no further report is due"
            ),
        )

    if any(report.special_election for report in for_year):
        return Determination(
            registration_number=registration_number,
            year=year,
            schedule_class=ScheduleClass.unknown,
            reason=(
                f"this committee has a {year} special-election report, which runs on "
                "its own series of periods that we have not established, so its next "
                "due date is not known"
            ),
        )

    if any(names_an_election_report(report.report_name) for report in for_year):
        calendar = calendar_for(ScheduleClass.filing_for_office, office)
        if calendar is None:
            return Determination(
                registration_number=registration_number,
                year=year,
                schedule_class=ScheduleClass.filing_for_office,
                reason=(
                    f"this committee is on the {year} ballot, but the office it seeks "
                    f"({office or 'not stated'}) is on a filing calendar we have not "
                    "transcribed, so its next due date is not known"
                ),
            )
        return _with_next_report(
            registration_number=registration_number,
            year=year,
            schedule_class=ScheduleClass.filing_for_office,
            calendar=calendar,
            as_of=as_of,
            established=(
                f"the state scheduled a pre-election report for this committee for "
                f"{year}, so it is on the ballot"
            ),
        )

    opened = first_election_report_due(year)
    if opened is None:
        return Determination(
            registration_number=registration_number,
            year=year,
            schedule_class=ScheduleClass.unknown,
            reason=(
                f"the state's {year} filing calendar has not been transcribed, so "
                "which schedule this committee is on is not known"
            ),
        )
    # **Absence is proof only if the reports we did not find had been scheduled by the
    # time we looked.** So this tests ``evidence_read_on``, not ``as_of``. Testing
    # ``as_of`` is what an earlier version did, and it was wrong in a way that produced a
    # confident false date: filings read on 1 July, before that year's pre-primary was
    # catalogued for anybody, asked about on 12 August, would find no election report,
    # see that the 27 July deadline had passed, and conclude the committee was not on the
    # ballot -- for a committee whose pre-general is due 26 October. Found by a review bot
    # on [#1481](https://github.com/alethical-org/alethical/pull/1481).
    if evidence_read_on <= opened:
        return Determination(
            registration_number=registration_number,
            year=year,
            schedule_class=ScheduleClass.unknown,
            reason=(
                f"the filings we hold were read on {evidence_read_on}, before the first "
                f"{year} pre-election report was due on {opened}, so this committee "
                f"having none does not establish whether it is on the {year} ballot"
            ),
        )

    calendar = calendar_for(ScheduleClass.not_filing_for_office, office)
    assert calendar is not None  # this class always resolves to the not-filing calendar
    return _with_next_report(
        registration_number=registration_number,
        year=year,
        schedule_class=ScheduleClass.not_filing_for_office,
        calendar=calendar,
        as_of=as_of,
        established=(
            f"the {year} pre-election reports came due on {opened} and the state "
            "scheduled none for this committee, so it is not on the ballot and owes "
            f"nothing covering {year} money until its year-end report"
        ),
    )


def _with_next_report(
    *,
    registration_number: str,
    year: int,
    schedule_class: ScheduleClass,
    calendar: CalendarKey,
    as_of: date,
    established: str,
) -> Determination:
    entries = CALENDARS.get((calendar, year))
    if not entries:
        return Determination(
            registration_number=registration_number,
            year=year,
            schedule_class=schedule_class,
            calendar=calendar,
            reason=(
                f"{established}, but the state's {year} calendar for that schedule has "
                "not been transcribed, so its next due date is not known"
            ),
        )
    upcoming = next_report_after(entries, as_of)
    if upcoming is None:
        return Determination(
            registration_number=registration_number,
            year=year,
            schedule_class=schedule_class,
            calendar=calendar,
            reason=(
                f"{established}. Every report on the {year} calendar has come due, and "
                f"the {year + 1} calendar has not been transcribed, so the next due "
                "date is not known"
            ),
        )
    return Determination(
        registration_number=registration_number,
        year=year,
        schedule_class=schedule_class,
        calendar=calendar,
        next_report=upcoming,
        reason=established,
    )
