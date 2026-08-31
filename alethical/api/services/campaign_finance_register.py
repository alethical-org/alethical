"""What our campaign-finance records hold right now, counted rather than pasted.

Net: the ``/money`` landing page opens with 3 lane cards, a "files last copied" date and
a list of the newest filings we hold. Every one of those is a count or a date over the
live data, so the page cannot say 1,336 registered filers on a day the register holds
1,603 -- which is exactly what a pasted figure did once
(``docs/design/handoff-campaign-money/Campaign money IA.dc.html``, section 01, and the
data census in [#1661](https://github.com/alethical-org/alethical/issues/1661)).

**Nothing here sums money, and nothing here can be made to.** No function returns an
amount, so no total across members or filers exists to be printed, sorted or ranked
(``.claude/rules/grounded-answers.md`` rule 12, and §7's ban on ranking members whose
filing calendars differ).

**Two different copies of Minnesota's data sit behind one page, so both are named.** The
3 bulk downloads are one release with its own fetch date (``cf_release``, resolved by
``alethical/api/services/committee_finance.py``); the register of filers and the report
catalogue are a separate run with its own fetch date (``cf_filing_snapshot``, loaded by
[#1408](https://github.com/alethical-org/alethical/issues/1408)). They are copied on the
same day today and they are still 2 sources, so a caller gets a date for each rather than
one date standing in for both.

**A count we cannot compute is ``None``, never 0.** Three separate ways of holding no
number, each with its own reason: no filings snapshot is published at all, the snapshot's
rows have been replaced under us, and no legislative session is current. A zero we
genuinely measured -- 0 sitting members with a confirmed committee -- is served as ``0``,
because the confirmation log is ours and its emptiness is a fact we know (rule 12,
missing-versus-zero).

**The report catalogue is a schedule, not a filing record**, and that is the trap on this
surface. The Board lists a report from the moment its filing period opens, filed or not:
7 of the 1,261 catalogued 2026 pre-primary reports were unfiled when the calendars module
measured them. An unfiled report carries no amendment record while every filed one
carries at least ``['0']`` (``docs/architecture/campaign-finance-system-design.md`` §9.6),
so ``recent_filings`` returns only rows that carry one. Without that filter a "filings as
they arrive" module would print a report as filed under a named politician who has not
filed it.

**A filing date is held per report where the Board's own document states one, and it is
never invented where it does not** ([#1670](https://github.com/alethical-org/alethical/issues/1670)).
The catalogue serves 17 fields per report and none of them is a filing date (§9.6's field
list), so it arrives from a separate read of the report document, which prints
``Received by the Board July 24, 2026`` on its own line. ``filed_date`` is therefore NULL
on a great many rows -- the Board serves no document before 2023 for most reports, answers
HTTP 200 with an HTML page when it will not serve one, and serves some documents as scans
carrying no text (§9.4).

So the order is **mixed and says which mix it is**: rows sort by the filing date where
there is one and by the period end where there is not, and ``ordered_by`` names that
rather than letting a caller read a chronology of arrivals into a list that is partly one.
A NULL filing date is served as NULL and is never filled in from the period end -- a
period end relabelled "filed on" is a fabricated fact about a named committee, which is
the whole reason #1670 was filed rather than closed inline.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from alethical.api.services.independent_spending import REPORTED, UNAVAILABLE
from alethical.db import models as schema
from alethical.pipeline.campaign_finance_filing_calendars import (
    printed_period_start_for_end,
)
from alethical.pipeline.campaign_finance_filings import live_filings_snapshot
from alethical.pipeline.campaign_finance_reader import Dataset

#: No filings snapshot is published, so the register and the catalogue can say nothing.
#: A fact about us: production held none until #1408's loader was first run.
NO_FILINGS_SNAPSHOT = "no_filings_snapshot"
#: The published snapshot recorded rows and holds none now, so its rows were replaced
#: under this read. Refused rather than counted, because counting would report the
#: register as empty on the strength of our own pruning.
ROWS_REPLACED = "rows_replaced"
#: No legislative session is marked current, so there is no set of sitting members to
#: count and no denominator for the confirmed ones.
NO_CURRENT_SESSION = "no_current_legislative_session"
#: The period start came off one of the Board's own transcribed disclosure calendars.
#: The only source this module will name for a start; there is deliberately no value
#: meaning "we worked it out".
BOARD_CALENDAR = "board_calendar"
#: The order when no row in the filtered set carries a filing date, so the order
#: genuinely is the period end and nothing else. Named once because the string appears in
#: several returns and a drifting copy would tell a caller the order changed.
ORDERED_BY_PERIOD_END = "period_end"
#: The order when some rows carry a filing date and some do not, which is the ordinary
#: state and will stay so: the Board serves no document for most reports before 2023
#: (§9.4), so those rows can never have one. Named as the mix it is rather than as
#: ``filed_date``, because a caller told the list is in filing order would read the
#: undated rows as having arrived when their period closed.
ORDERED_BY_FILED_DATE_THEN_PERIOD_END = "filed_date_then_period_end"
#: The only order the committees list has, served on every page so a caller never has to
#: assume one. Alphabetical by the name as filed, and there is deliberately no way to ask
#: for another: ordering 1,603 filers by money would rank filing calendars rather than
#: fundraising, because these filers file to different ones (§7).
ORDERED_BY_NAME = "name"


def _utc_today() -> date:
    """Today in UTC, matching how a snapshot's fetch window is stored.

    Same reason as ``committee_filing_schedule._utc_today``: both sides of a date
    comparison have to be measured the same way, and a local ``date.today()`` sits a day
    behind a UTC-stored date for the hours either side of midnight UTC.
    """
    return datetime.now(UTC).date()


#: Rows fetched per page at most. The landing draws 5; the ceiling is here so a caller
#: cannot ask for the whole catalogue (36,655 rows in the live snapshot) in one response.
MAX_FILINGS = 100

#: Committees fetched per page at most. Screen A draws 8 and pages by 8; the ceiling
#: stops a caller pulling the whole register (1,603 filers) into one response.
MAX_COMMITTEES = 100


@dataclass(frozen=True)
class CommitteeRow:
    """One registered filer, exactly as the Board's own directory lists them.

    **No amount, and there is no version of this row that carries one.** These filers
    file to different calendars, so 2 dollar figures side by side on a list would set one
    period against another (``.claude/rules/grounded-answers.md`` rule 12, and
    ``docs/architecture/campaign-finance-system-design.md`` §7). Money lives on each
    committee's own page, where the period it belongs to is stated.

    ``office`` and ``district`` are ``None`` on most rows and that is the register's
    shape, not a gap in our copy. The Board publishes 3 lists of different widths: a
    candidate row carries office, district and party; a party-unit row and a
    committee-or-fund row carry name, registration number and 2 dates
    ([#1661](https://github.com/alethical-org/alethical/issues/1661) measured 778 of
    1,603 rows carrying an office and 0 party units carrying one). A party unit's
    geography exists only inside its printed name, and reading it out of the name is a
    mapping a person confirms rather than a column we hold, so nothing here derives one.

    ``is_closed`` is exactly "the register carries a termination date for this filer",
    which is why the date is served beside the flag rather than behind it: a closed
    committee with no date would be a claim we could not show the evidence for.
    """

    registration_number: str
    name: str
    kind: str
    office: Optional[str]
    district: Optional[str]
    is_closed: bool
    termination_date: Optional[date]
    #: The Board's own sub-type code from this filer's money rows, where one carries a
    #: documented code. It carries 2 different things, both of which exist nowhere else:
    #: the **finer kind** of a committee or fund, since the register's 3 lists carry no
    #: marker separating a ballot-question committee from a political fund (§9.7); and
    #: **which layer of a party** a party unit is, on the 10 party units the Board marks
    #: `CAU` (legislative caucus) or `SPU` (state party committee).
    #:
    #: A **code, never a label**: the wording a reader sees is owned once, by
    #: ``committeeEyebrow`` in ``apps/frontend/src/lib/committeeMoney.ts``, so this list
    #: and the committee page cannot label the same filer 2 different ways. ``None`` for
    #: the 33 registered filers with no money row and the 73 carrying the undocumented
    #: `PCN` and `PFN` codes, and a caller renders those at the register's kind.
    #:
    #: ``None`` is also the answer for the other 289 party units, and it means Minnesota
    #: publishes no layer for them rather than that we failed to read one: 285 of the 289
    #: have money rows and the Board leaves this column blank on every one of them. A
    #: caller prints "party unit" there and never a layer read out of the filer's name.
    sub_type: Optional[str]


@dataclass(frozen=True)
class CommitteesPage:
    """One page of the register, with both totals a screen needs.

    ``total`` and ``register_total`` are different numbers on purpose. ``total`` counts
    the filter the rows came from, so "showing 8 of 778 candidate committees" is true of
    the list a reader is looking at; ``register_total`` counts the whole register, so the
    lane card can say 1,603 whatever filter is applied. A single total would make one of
    those 2 sentences false.

    ``by_kind`` is unfiltered for the same reason: the 3 filter chips label themselves
    from it, and counts that changed when a filter was applied would read as the filter
    having found fewer of a kind than exist.
    """

    state: str
    ordered_by: str
    committees: tuple[CommitteeRow, ...]
    limit: int
    offset: int
    has_more: bool
    total: Optional[int]
    register_total: Optional[int]
    by_kind: Optional[dict[str, int]]
    as_of: Optional[date]
    snapshot_id: Optional[UUID]
    #: Which download release the rows' ``sub_type`` codes were read from. A second
    #: source behind one page, named rather than left implicit: the rows themselves come
    #: from the register snapshot and only that one field comes from here, so a caller
    #: can see the 2 apart. ``None`` when no release is held, which empties every
    #: ``sub_type`` and nothing else.
    release_id: Optional[UUID]
    reason: Optional[str]


@dataclass(frozen=True)
class RegisterSummary:
    """How many filers Minnesota's register holds, in total and per kind.

    ``by_kind`` carries all 3 of the Board's filer kinds whenever the state is
    ``reported``, including a kind with no rows: the register is loaded whole per
    snapshot, so a kind counting 0 is a measured zero rather than a gap. It is ``None``
    with the whole block when nothing could be counted.
    """

    state: str
    filer_count: Optional[int]
    by_kind: Optional[dict[str, int]]
    as_of: Optional[date]
    snapshot_id: Optional[UUID]
    reason: Optional[str]


@dataclass(frozen=True)
class ConfirmationState:
    """How far the member-to-committee confirmation has got, for the whole set.

    The only figure on the product that speaks about all 200 sitting members at once
    (``Campaign money IA.dc.html``, section 01). Every per-member surface speaks about
    that member alone, which is why nothing here is keyed on a legislator.

    ``newest_confirmation_at`` dates the count and is ``None`` while no confirmation
    exists, which is today's state. A ``None`` date beside a count of 0 is not a gap: it
    is what "nobody has started" looks like.
    """

    state: str
    confirmed_member_count: Optional[int]
    sitting_member_count: Optional[int]
    newest_confirmation_at: Optional[datetime]
    reason: Optional[str]


@dataclass(frozen=True)
class Freshness:
    """When each copy of Minnesota's data was last taken.

    ``downloads_fetched_at`` is the landing's "files last copied" date (#861). It is
    never the period a figure covers: every period ends earlier, and the 2 are different
    claims.
    """

    downloads_fetched_at: Optional[datetime]
    register_fetched_at: Optional[datetime]
    release_id: Optional[UUID]


@dataclass(frozen=True)
class FilingRow:
    """One filed report, with no amount of any kind.

    ``period_start`` is ``None`` far more often than it is populated, and that is the
    designed row rather than a defect: it reads "covers through {period_end}". It is
    populated only from a Board calendar (``period_start_source``), and never for a filer
    with a special-election report in that year, whose period does not open on 1 January.

    ``filed_date`` is the day the Board received this report's effective version, and it
    is ``None`` wherever the Board's document does not state one (#1670). **A ``None``
    here means a page prints no filed date on that row** -- not that the report was
    unfiled, and never the period end wearing a "filed" label.
    """

    registration_number: str
    filer_name: str
    filer_kind: str
    report_name: str
    report_type: str
    filing_year: int
    period_end: Optional[date]
    period_start: Optional[date]
    period_start_source: Optional[str]
    filed_date: Optional[date]
    special_election: bool
    amendment_count: Optional[int]
    effective_amendment_index: Optional[int]


@dataclass(frozen=True)
class FilingsPage:
    """One page of the newest filings we hold, newest by period end.

    ``ordered_by`` is served rather than assumed, because the order is a mix: rows with a
    filing date sort by it and rows without sort by their period end (see this module's
    docstring). A caller may label a row "filed on" **only** where that row's own
    ``filed_date`` is populated.
    """

    state: str
    ordered_by: str
    #: The day a report's period must have ended on or before to appear here. Served
    #: because without it a caller cannot tell why the newest row is not dated today.
    periods_ended_on_or_before: Optional[date]
    filings: tuple[FilingRow, ...]
    limit: int
    offset: int
    has_more: bool
    #: How many filings the rows are a slice of, counted over the identical filter --
    #: the same 4 exclusions and the same ended-periods cutoff
    #: ([#1677](https://github.com/alethical-org/alethical/issues/1677)). Without it a
    #: landing showing 5 rows beginning "100 Percent Future Fund" reads as a shortlist of
    #: the newest or the biggest, which is a claim these rows do not make: over 1,200
    #: filers share the period end of 20 July 2026, so the list is one enormous tie
    #: broken alphabetically. ``None`` whenever the state is not ``reported``, never 0.
    total: Optional[int]
    #: The newest period any filing here covers, and how many filings cover it -- the 2
    #: served together as one block, deliberately, because a count of filings is
    #: meaningless without the period it counts them for
    #: (``.claude/rules/grounded-answers.md`` rule 12: every total states the period it
    #: covers). This is the number the landing's "N committees filed for this period"
    #: sentence needs, and ``total`` is **not** it: measured on production 20 Aug 2026,
    #: 1,203 filings carry the newest period end of 20 Jul 2026 while ``total`` counts
    #: all 33,612 ended filed reports we hold, so printing ``total`` in that sentence
    #: would overstate one period 28-fold. Both are honest; they answer different
    #: questions, and they are named apart so neither can wear the other's label.
    #: ``None`` for all 3 whenever the state is not ``reported``, never 0.
    #:
    #: **Two counts of the same period, because the sentence says committees and the
    #: rows are filings.** A committee can appear on 2 rows for one period end by filing
    #: 2 different reports that both close that day, and then a count of documents is
    #: larger than a count of committees while looking exactly like it. Amendments are
    #: **not** how that happens: the loader folds a report's whole amendment list onto
    #: its single catalogue row as ``amendment_count`` and ``effective_amendment_index``
    #: (``alethical/pipeline/campaign_finance_filings.py``), so an amended report is one
    #: row however many times it was amended.
    #:
    #: Measured on production 20 Aug 2026, and it is a fact about the data rather than a
    #: rule: the 2 are **identical on every period sampled** -- 1,203 of each on the
    #: newest period end of 20 Jul 2026, and no divergence in 3,000 filings across the
    #: 25 next-newest periods. They are still served apart, because "identical today" is
    #: not "cannot differ", and the page's sentence names committees.
    newest_period_end: Optional[date]
    newest_period_filing_count: Optional[int]
    newest_period_committee_count: Optional[int]
    as_of: Optional[date]
    snapshot_id: Optional[UUID]
    reason: Optional[str]


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Normalize a stored instant to UTC before anything reads a day off it.

    Not housekeeping. Postgres hands a ``timestamptz`` back in the *session's* timezone,
    so the same instant arrives as ``06:40+00:00`` or ``02:40-04:00`` depending on the
    connection -- and a page printing the second one as "files last copied" can name the
    wrong day for any run completed in the small hours. The download release already
    normalizes for exactly this reason (``Release.fetched_at`` in
    ``alethical/pipeline/campaign_finance_reader.py``, found by the #1332 session), and
    every date this module serves is a date a reader sees. Caught here by
    ``test_each_copy_of_the_data_carries_its_own_date``.
    """
    return value.astimezone(UTC) if value is not None else None


def _snapshot_date(snapshot) -> Optional[date]:
    """The day the register and catalogue were copied, as a calendar date.

    Read off ``fetch_completed_at``, the end of the run's fetch window rather than an
    instant, matching what ``cf_release`` serves for the downloads. In UTC, because the
    calendar day depends on the zone the instant is read in.
    """
    completed = _as_utc(getattr(snapshot, "fetch_completed_at", None))
    return completed.date() if completed is not None else None


def register_summary(db: Session) -> RegisterSummary:
    """Count the register of filers, live, in total and per kind.

    One grouped count over ``cf_filer`` for the published snapshot. The lane card and its
    filters read this, so a filter cannot advertise a kind the register does not hold.

    Refuses rather than reporting 0 when the snapshot published filers and holds none
    now: those rows survive exactly one further publish, so an empty count on a
    populated snapshot means we are reading a set that has been replaced, and "the
    register is empty" is a claim about Minnesota we would be making about ourselves.
    """
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return RegisterSummary(
            state=UNAVAILABLE,
            filer_count=None,
            by_kind=None,
            as_of=None,
            snapshot_id=None,
            reason=NO_FILINGS_SNAPSHOT,
        )
    counted = db.execute(
        select(schema.CampaignFinanceFiler.kind, func.count())
        .where(schema.CampaignFinanceFiler.snapshot_id == snapshot.id)
        .group_by(schema.CampaignFinanceFiler.kind)
    ).all()
    total = sum(count for _, count in counted)
    if total == 0 and (snapshot.filer_count or 0) > 0:
        return RegisterSummary(
            state=UNAVAILABLE,
            filer_count=None,
            by_kind=None,
            as_of=_snapshot_date(snapshot),
            snapshot_id=snapshot.id,
            reason=ROWS_REPLACED,
        )
    by_kind = {kind.value: 0 for kind in schema.CampaignFinanceFilerKind}
    for kind, count in counted:
        # The driver hands back the enum member; a raw value would arrive as a string.
        by_kind[kind.value if hasattr(kind, "value") else str(kind)] = count
    return RegisterSummary(
        state=REPORTED,
        filer_count=total,
        by_kind=by_kind,
        as_of=_snapshot_date(snapshot),
        snapshot_id=snapshot.id,
        reason=None,
    )


#: The register is held and this number is on none of its 3 lists. A fact about our
#: copy of the Board's register, never "no such committee": the number may be newer
#: than our copy, or mistyped by a digit.
NOT_REGISTERED = "not_registered"


@dataclass(frozen=True)
class RegisterEntry:
    """One filer as the Board's registered-filer directory lists them, or why not.

    What a committee page's header reads: the register's own kind (its verbatim label
    is the only kind a page may print -- data census
    [#1661](https://github.com/alethical-org/alethical/issues/1661)), the office and
    district a candidate registered for, and the termination date that makes a closed
    committee its own display state rather than an empty year
    (``docs/architecture/campaign-finance-system-design.md`` §7).

    ``party``, ``office`` and ``district`` are legitimately empty for party units and
    committees-or-funds -- the Board's own lists carry them only for candidates -- so
    their absence is never a gap to fill. ``termination_date`` empty means the Board
    lists the committee as open.
    """

    state: str
    kind: Optional[str]
    name: Optional[str]
    party: Optional[str]
    office: Optional[str]
    district: Optional[str]
    registration_date: Optional[date]
    termination_date: Optional[date]
    as_of: Optional[date]
    reason: Optional[str]


def register_entry(db: Session, registration_number: str) -> RegisterEntry:
    """Whether the Board's register we hold lists this number, and what it says.

    Three answers, each a different sentence on a page. ``reported`` -- the register
    lists it, fields attached. ``not_registered`` -- our copy of the register is held
    and does not carry this number, which is a fact about our copy rather than about
    the committee. ``unavailable`` -- we hold no register to ask (no snapshot, or its
    rows were replaced under this read), so nothing may be said either way.
    """
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return RegisterEntry(
            state=UNAVAILABLE,
            kind=None,
            name=None,
            party=None,
            office=None,
            district=None,
            registration_date=None,
            termination_date=None,
            as_of=None,
            reason=NO_FILINGS_SNAPSHOT,
        )
    filer = db.execute(
        select(schema.CampaignFinanceFiler).where(
            schema.CampaignFinanceFiler.snapshot_id == snapshot.id,
            schema.CampaignFinanceFiler.registration_number == registration_number,
        )
    ).scalar_one_or_none()
    if filer is None:
        # Absence from a replaced set says nothing; absence from a populated register
        # is the real answer. Same guard as `register_summary`.
        held = db.scalar(
            select(schema.CampaignFinanceFiler.registration_number)
            .where(schema.CampaignFinanceFiler.snapshot_id == snapshot.id)
            .limit(1)
        )
        if held is None and (snapshot.filer_count or 0) > 0:
            return RegisterEntry(
                state=UNAVAILABLE,
                kind=None,
                name=None,
                party=None,
                office=None,
                district=None,
                registration_date=None,
                termination_date=None,
                as_of=_snapshot_date(snapshot),
                reason=ROWS_REPLACED,
            )
        return RegisterEntry(
            state=NOT_REGISTERED,
            kind=None,
            name=None,
            party=None,
            office=None,
            district=None,
            registration_date=None,
            termination_date=None,
            as_of=_snapshot_date(snapshot),
            reason=None,
        )
    kind = filer.kind
    return RegisterEntry(
        state=REPORTED,
        kind=kind.value if hasattr(kind, "value") else str(kind),
        name=filer.name,
        party=filer.party,
        office=filer.office,
        district=filer.district,
        registration_date=filer.registration_date,
        termination_date=filer.termination_date,
        as_of=_snapshot_date(snapshot),
        reason=None,
    )


def name_contains(column, typed: str):
    """Match a filed name against exactly what somebody typed, and nothing else.

    Case-insensitive containment of the typed string. **No closest-spelling match, no
    did-you-mean, no similarity score, ever** -- and this is the one rule on this surface
    that is not a preference. 178 registered filer names sit a single character apart
    from another registered name, and every one of those pairs is a different
    organisation: the Green Party and the Republican Party of the same district are 2 of
    them. A helpful correction would hand a reader one organisation's money under
    another's name, silently, with nothing on screen to tell them
    ([#1661](https://github.com/alethical-org/alethical/issues/1661)).

    The typed string is escaped rather than passed through, so a reader typing ``%`` or
    ``_`` searches for that character instead of matching everything.
    """
    escaped = typed.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return column.ilike(f"%{escaped}%", escape="\\")


#: The 6 codes that name a **finer kind of committee or fund** than the register's own 3
#: lists can. These are the codes that make a ballot-question committee knowable at all.
FINER_KIND_SUB_TYPES = frozenset({"PC", "PF", "IEC", "IEF", "BC", "BF"})

#: The 2 codes that name **which layer of a party organisation a party unit is**, and the
#: only 2 of the Board's 7 layers that exist as data anywhere
#: ([#1661](https://github.com/alethical-org/alethical/issues/1661) §2). `CAU` is a
#: legislative caucus and `SPU` is a state party committee.
#:
#: **What establishes those 2 readings is the whole population, not a sample.** Measured
#: on the live release and register, 26 Aug 2026: every one of the 4 `CAU` filers is one
#: of Minnesota's 4 legislative caucuses (20006 DFL House Caucus, 20011 DFL Senate
#: Caucus, 20010 HRCC, 20013 Senate Victory Fund), and every one of the 6 `SPU` filers is
#: a party's own state committee (20003 MN DFL State Central Committee, 20008 Republican
#: Party of Minn, 40858 Libertarian Party of Minn, 20905 Legal Marijuana Now Party, 20839
#: Grassroots-Legalize Cannabis Party, 20711 Forward Independence). 4 of 4 and 6 of 6,
#: with nothing left over to be wrong about.
#:
#: **And neither code can land on anything that is not a party unit.** Across the whole
#: live release, 0 of the 1,304 registered candidate committees and committees-or-funds
#: carry either code, and 0 registration numbers absent from the register carry either
#: one -- so serving these cannot relabel a committee as party machinery.
PARTY_LAYER_SUB_TYPES = frozenset({"CAU", "SPU"})

#: Every code anything may act on. `PCN`, `PFN` and `BCN` also appear and are
#: **documented nowhere** -- not by the Board, whose data-downloads page publishes no
#: legend and whose handbooks do not name them, and not by us (#1661). They are dropped
#: here rather than served, because a code reaching a surface is a code somebody
#: eventually expands, and there is no expansion to give: their behaviour establishes
#: only that they are general-purpose rather than independent-expenditure.
DOCUMENTED_SUB_TYPES = FINER_KIND_SUB_TYPES | PARTY_LAYER_SUB_TYPES


def sub_types_for(db: Session, release, registration_numbers) -> dict[str, str]:
    """The Board's sub-type code for each of these filers, where a money row carries one.

    **The register itself distinguishes 3 kinds and this is the only finer signal there
    is.** Independent-expenditure committees, ballot-question committees and political
    funds all arrive on one register list carrying no type marker at all (§9.7), so a
    ballot-question filer is knowable only from the code its own money rows carry. On the
    live release 493 of the 526 registered committees and funds carry one; the other 33
    have no money row anywhere, which is ordinary for a newly registered filer (#1661).

    **The same column is also the only place a party unit's layer exists**, and it names
    2 of the Board's 7 layers: `CAU` a legislative caucus, `SPU` a state party committee,
    on 10 of the 299 registered party units. The remaining 289 are not a hole in our copy
    and not a filer that has yet to file -- 285 of them have money rows in the live
    release and the Board leaves this column **blank on all 66,486 of those rows**, and
    the last 4 have no money row at all. So for congressional-district, county,
    legislative-district, municipal and precinct party units the answer is that Minnesota
    publishes no layer, and the honest thing a page can print is the register's own word,
    "party unit".

    **A party unit's printed name is not a substitute, and the register itself is what
    disproves it.** 21 registered filers are named exactly `Nth Congressional District
    <party>`, and **3 of those 21 are not party units** -- 20733 and 20726, the Green
    Party's 4th and 5th district organisations, and 41427, all 3 registered as political
    committees or funds. A layer read off a name would therefore publish our reading of
    an organisation in the Board's voice, and would already be wrong about 3 named
    political organisations. Nothing here derives a layer from a name
    (``.claude/rules/grounded-answers.md`` rule 3).

    **The code is returned, never a label.** The vocabulary a reader sees is owned in one
    place -- ``committeeEyebrow`` in ``apps/frontend/src/lib/committeeMoney.ts``, which
    the committee page already ships -- so the list and the committee page cannot print
    2 different kinds for the same filer. A second expansion written here would be that
    divergence rather than a guard against it, and it would start out disagreeing: that
    function deliberately expands ``BC`` and ``BF`` only, leaving the rest at the
    register's own wording, on the ground that any further expansion would be ours rather
    than the register's.

    Read in the same preference order as ``committee_finance.find_committee``, so 2
    surfaces asking the same question of the same filer get the same answer:
    expenditures, then contributions, then independent expenditures. Order matters only
    in theory -- 0 registration numbers carry 2 different sub-type codes, re-checked
    across all 3 files and every filer on the live release rather than the expenditure
    file alone -- and it is fixed anyway rather than left to whichever query returns
    first.

    Scoped to the page's own filers, so the cost is a lookup for 25 rows rather than a
    scan that grows with the register. ``{}`` when no release is held: the sub-type is a
    label on top of the register rather than the register itself, so its absence leaves
    every row at its register kind instead of emptying the list.
    """
    numbers = tuple(registration_numbers)
    if not numbers or release is None:
        return {}
    expenditure = schema.CampaignFinanceExpenditureRow
    contribution = schema.CampaignFinanceContributionRow
    independent = schema.CampaignFinanceIndependentExpenditureRow
    lookups = (
        (
            Dataset.expenditures,
            expenditure,
            expenditure.committee_reg_num,
            expenditure.entity_sub_type,
        ),
        (
            Dataset.contributions,
            contribution,
            contribution.recipient_reg_num,
            contribution.recipient_subtype,
        ),
        (
            Dataset.independent_expenditures,
            independent,
            independent.spender_reg_num,
            independent.spender_sub_type,
        ),
    )
    found: dict[str, str] = {}
    for dataset, model, key_column, sub_type_column in lookups:
        outstanding = [number for number in numbers if number not in found]
        if not outstanding:
            break
        rows = db.execute(
            select(key_column, sub_type_column)
            .where(
                model.snapshot_id == release.file_for(dataset).snapshot_id,
                key_column.in_(outstanding),
                sub_type_column.in_(DOCUMENTED_SUB_TYPES),
            )
            .distinct()
        ).all()
        for registration_number, sub_type in rows:
            found.setdefault(registration_number, sub_type)
    return found


def committees(
    db: Session,
    *,
    limit: int,
    offset: int,
    kind: Optional[str] = None,
    query: Optional[str] = None,
    release=None,
) -> CommitteesPage:
    """One page of the register, ordered by the filed name, A to Z.

    **Ordered by name and nothing else, with no way to ask for another order.** Not a
    simplification to revisit: any order over money would compare filers who file to
    different calendars, and 2 periods on this register can end nearly 7 months apart
    (§7). Alphabetical is also the only order that is stable while a reader pages, since
    names are unique within a snapshot -- checked on the live register, 0 duplicates in
    1,603 rows -- so ``name`` alone is a deterministic tie-breaker and no second sort key
    is needed.

    ``kind`` filters to one of the Board's 3 register kinds. There are only 3, and that
    is the source's shape rather than something our loader dropped: independent-
    expenditure committees, ballot-question committees and political funds all arrive on
    a single list carrying no type marker (§9.7). A caller must not offer a finer filter.

    ``query`` is the screen's "find a committee by name" box, matched by
    ``name_contains`` -- read that function before loosening anything here.

    Refuses rather than reporting an empty register when the snapshot published filers
    and holds none now, the same reasoning as ``register_summary``: those rows survive
    exactly one further publish, so an empty read on a populated snapshot means we are
    looking at a set that has been replaced, and "Minnesota registers nobody" is a claim
    about the state we would be making about ourselves.
    """
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return CommitteesPage(
            state=UNAVAILABLE,
            ordered_by=ORDERED_BY_NAME,
            committees=(),
            limit=limit,
            offset=offset,
            has_more=False,
            total=None,
            register_total=None,
            by_kind=None,
            as_of=None,
            snapshot_id=None,
            release_id=None,
            reason=NO_FILINGS_SNAPSHOT,
        )
    summary = register_summary(db)
    if summary.state != REPORTED:
        # The register itself could not be counted, so a page of it would be a slice of
        # a set we just refused to describe. Carries the summary's own reason rather
        # than a second one, so a caller sees one explanation for both.
        return CommitteesPage(
            state=summary.state,
            ordered_by=ORDERED_BY_NAME,
            committees=(),
            limit=limit,
            offset=offset,
            has_more=False,
            total=None,
            register_total=None,
            by_kind=None,
            as_of=summary.as_of,
            snapshot_id=summary.snapshot_id,
            release_id=None,
            reason=summary.reason,
        )
    filer = schema.CampaignFinanceFiler
    filters = [filer.snapshot_id == snapshot.id]
    if kind is not None:
        filters.append(filer.kind == schema.CampaignFinanceFilerKind(kind))
    if query:
        filters.append(name_contains(filer.name, query))
    total = db.scalar(select(func.count()).select_from(filer).where(*filters)) or 0
    rows = db.execute(
        select(
            filer.registration_number,
            filer.name,
            filer.kind,
            filer.office,
            filer.district,
            filer.termination_date,
        )
        .where(*filters)
        .order_by(filer.name.asc())
        .limit(limit + 1)
        .offset(offset)
    ).all()
    has_more = len(rows) > limit
    page = rows[:limit]
    sub_types = sub_types_for(db, release, (row[0] for row in page))
    return CommitteesPage(
        state=REPORTED,
        ordered_by=ORDERED_BY_NAME,
        committees=tuple(_committee_row(row, sub_types=sub_types) for row in page),
        limit=limit,
        offset=offset,
        has_more=has_more,
        total=total,
        register_total=summary.filer_count,
        by_kind=summary.by_kind,
        as_of=summary.as_of,
        snapshot_id=summary.snapshot_id,
        release_id=getattr(release, "id", None),
        reason=None,
    )


def _committee_row(row, *, sub_types: dict[str, str]) -> CommitteeRow:
    registration_number, name, kind, office, district, termination_date = row
    return CommitteeRow(
        registration_number=registration_number,
        name=name,
        kind=kind.value if hasattr(kind, "value") else str(kind),
        office=office,
        district=district,
        # Read off the date rather than stored separately, so the flag and the evidence
        # for it can never disagree.
        is_closed=termination_date is not None,
        termination_date=termination_date,
        sub_type=sub_types.get(registration_number),
    )


def _sitting_members_stmt(session_id: UUID) -> Select:
    """The sitting members, filtered exactly as the legislator directory filters them.

    Mirrors ``legislator_directory_stmt`` (``alethical/db/models.py``) clause for clause,
    including its exclusion of the placeholder ``-unknown`` districts, so the lane's
    count and the directory it opens cannot describe different populations.

    **Counted as people, once each.** The directory's own total counts rows of this join,
    which is the same number unless one member holds 2 current service periods in a
    single session -- the directory would list them twice and this counts them once. The
    lane says "members", so people is the honest unit.
    """
    return (
        select(schema.LegislatorServicePeriod.legislator_id)
        .join(
            schema.District,
            schema.District.id == schema.LegislatorServicePeriod.district_id,
        )
        .where(
            schema.LegislatorServicePeriod.session_id == session_id,
            schema.LegislatorServicePeriod.is_current.is_(True),
            schema.District.code.not_like("%-unknown"),
        )
        .distinct()
    )


def legislator_committee_confirmations(db: Session) -> ConfirmationState:
    """How many sitting members have a committee a person has confirmed is theirs.

    Both halves come from tables we own, so this answers with no reference to any
    snapshot: the sitting set from the current session's service periods, the confirmed
    links from ``legislator_campaign_committee``, whose rows exist only where a reviewer
    wrote one (``docs/architecture/campaign-finance-system-design.md`` §5, Identity).

    Rejections are stored in that same table and are deliberately not counted here: "we
    looked and it is not theirs" is not a confirmed link, and folding the 2 together
    would report review activity as progress.

    ``None`` for both counts when no session is current, because the confirmed count is
    only meaningful against the set it is out of, and a bare "0 confirmed" with no
    denominator invites a page to invent one.
    """
    session_id = db.scalar(
        select(schema.LegislativeSession.id).where(
            schema.LegislativeSession.is_current.is_(True)
        )
    )
    if session_id is None:
        return ConfirmationState(
            state=UNAVAILABLE,
            confirmed_member_count=None,
            sitting_member_count=None,
            newest_confirmation_at=None,
            reason=NO_CURRENT_SESSION,
        )
    sitting = _sitting_members_stmt(session_id)
    sitting_count = db.scalar(select(func.count()).select_from(sitting.subquery())) or 0
    confirmed_rows = select(
        schema.LegislatorCampaignCommittee.legislator_id,
        schema.LegislatorCampaignCommittee.reviewed_at,
    ).where(
        schema.LegislatorCampaignCommittee.decision
        == schema.CommitteeLinkReviewDecision.confirmed,
        schema.LegislatorCampaignCommittee.legislator_id.in_(sitting),
    )
    confirmed = confirmed_rows.subquery()
    confirmed_count = (
        db.scalar(select(func.count(func.distinct(confirmed.c.legislator_id)))) or 0
    )
    newest = _as_utc(db.scalar(select(func.max(confirmed.c.reviewed_at))))
    return ConfirmationState(
        state=REPORTED,
        confirmed_member_count=confirmed_count,
        sitting_member_count=sitting_count,
        newest_confirmation_at=newest,
        reason=None,
    )


def freshness(db: Session, release) -> Freshness:
    """One date per copy of the data, each named for the copy it belongs to.

    ``release`` is the download release the caller already resolved, passed in rather
    than re-resolved: resolving it twice inside one request is how a response ends up
    describing 2 different releases (``committee_finance.pin_to_one_view``). ``None``
    means nothing is published, which is a fact about us.
    """
    snapshot = live_filings_snapshot(db)
    return Freshness(
        downloads_fetched_at=_as_utc(getattr(release, "fetched_at", None)),
        register_fetched_at=_as_utc(getattr(snapshot, "fetch_completed_at", None)),
        release_id=getattr(release, "id", None),
    )


@dataclass(frozen=True)
class SitemapCommittee:
    """One committee whose own page is worth listing in the sitemap."""

    registration_number: str
    name: str


def committees_worth_indexing(db: Session) -> tuple[SitemapCommittee, ...]:
    """Every registered filer whose own page carries a filed record, A to Z by name.

    **Not the whole register.** A committee page is worth a sitemap entry when it has
    something on it: a report the Board's catalogue records as filed, or a year of
    reported figures we hold. A filer with neither draws its register row and its
    "no figures cover this year" state and nothing else, and Google's own guidance is
    that a page has to carry original information to be worth listing
    (``docs/architecture/page-metadata-for-search-and-sharing-decisions.md`` §20.5
    rule 4). Those pages still work, still say plainly what our records hold for them,
    and are still reachable from the register's own numbered pages -- they are simply
    not advertised.

    ``effective_amendment_index IS NOT NULL`` is what "filed" means, the same positive
    signal ``recent_filings`` reads: the catalogue lists a report from the moment its
    period opens, and every filed report carries at least ``['0']`` while an unfiled one
    carries none (design doc §9.6). Reported figures count on their own because a
    committee can carry a year of totals whose report rows predate the catalogue's
    amendment record.

    Returns an empty tuple when no filings snapshot is published, which a caller renders
    as "no committee sitemap today" rather than as an empty register.
    """
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return ()
    filer = schema.CampaignFinanceFiler
    report = schema.CampaignFinanceFilingReport
    filing = schema.CampaignFinanceFiling
    filed_reports = select(report.registration_number).where(
        report.snapshot_id == snapshot.id,
        report.effective_amendment_index.is_not(None),
    )
    reported_years = select(filing.registration_number).where(
        filing.snapshot_id == snapshot.id
    )
    rows = db.execute(
        select(filer.registration_number, filer.name)
        .where(
            filer.snapshot_id == snapshot.id,
            filer.registration_number.in_(filed_reports.union(reported_years)),
        )
        .order_by(filer.name.asc(), filer.registration_number.asc())
    ).all()
    return tuple(
        SitemapCommittee(registration_number=registration_number, name=name)
        for registration_number, name in rows
    )


def _filed_date_order(report):
    """The ORDER BY that puts the newest arrival first without inventing an arrival.

    ``COALESCE(filed_date, cut_off_date)`` rather than ``filed_date DESC NULLS LAST``,
    and the difference is what a reader sees. Sinking every undated row below every dated
    one would drop a 2026 report whose document is an unreadable scan to the bottom of a
    feed of the newest filings, behind dated reports from 2023. Coalescing keeps it near
    where it belongs, because a report is always filed *after* its period closes, so the
    period end is the earliest the filing can have been.

    This is a **ranking** fallback and never a displayed one: the served ``filed_date``
    stays NULL, so no row can print a period end as the day it was filed. That
    distinction is pinned by
    ``test_a_report_with_no_filed_date_is_never_dated_from_its_period_end``.
    """
    return func.coalesce(report.filed_date, report.cut_off_date).desc()


def _order_name(db: Session, report, filters, joined_to_filer) -> str:
    """Whether any row this page is drawn from carries a filing date.

    **The filer join is part of the filter, not decoration**, exactly as it is for the
    rows and for the count: it is what drops a report whose filer the register does not
    hold. Without it this could answer "some rows are dated" on the strength of a row the
    caller can never see, and the page would then print an arrival order over rows that
    have none. 0 report rows are in that state on the live snapshot (measured 31 Aug
    2026), so this is the shape being right rather than a fault being fixed — and it is
    what lets the served name be described as coming from the identical filter the rows
    use, which is the claim `backend-api-system-design.md` makes for it.
    """
    present = db.scalar(
        select(report.row_number)
        .join(*joined_to_filer)
        .where(*filters, report.filed_date.is_not(None))
        .limit(1)
    )
    return (
        ORDERED_BY_FILED_DATE_THEN_PERIOD_END
        if present is not None
        else ORDERED_BY_PERIOD_END
    )


def recent_filings(
    db: Session, *, limit: int, offset: int, as_of: Optional[date] = None
) -> FilingsPage:
    """The filed reports we hold with the latest periods, newest period end first.

    Three deliberate exclusions, each of which would otherwise put a false row on a
    landing page under a named politician's committee:

    * **Reports nobody has filed.** The catalogue lists a report when its period opens,
      so ``effective_amendment_index IS NULL`` -- no version history -- is what an
      unfiled report looks like (§9.6). Those are dropped. It also drops genuinely filed
      reports from 2002 to 2007, whose amendment record the catalogue does not serve;
      that is the safe direction on a feed of the newest filings, and rule 11 forbids
      claiming a list is complete in either case.
    * **Reports with no period end.** Nothing places them on a feed of the newest
      filings: a filing date is held for only a minority of reports (§9.4), so a row
      with neither cannot be ordered at all. The committee's own page lists them last
      rather than dropping them.
    * **A filer the register does not hold.** The name comes from ``cf_filer`` in the
      same snapshot, and a nameless row is not worth showing.
    * **Reports whose period has not ended yet.** Found on production the day this
      shipped: the 5 newest rows were 2026 year-end reports covering "1 Jan - 31 Dec
      2026", read on 19 August. They are real filings -- a terminating committee files its
      final report at termination rather than waiting for the period to close, and Paul
      Novotny's is the measured case (§9.8) -- and there were 7 of them against 1,261
      catalogued 2026 pre-primary reports. But a list of the newest filings whose top row
      covers 4 months of the future reads as an error or as a claim about money nobody has
      raised yet, and the ordering key is the whole reason: with no filing date, "newest"
      can only be the latest period, and a period that has not ended sorts above every
      period that has. So this list is the filings whose periods have **ended**, and the
      cutoff is served as ``periods_ended_on_or_before`` so a caller can see why the top
      row is not today's date.

    ``as_of`` is a parameter rather than a call to the clock inside the query, so a test
    fixes the day instead of racing it. It is a UTC date, matching how a snapshot's fetch
    window is stored.

    ``limit + 1`` is fetched to answer ``has_more`` without a second count, the same
    shape ``campaign_finance_payments`` uses.
    """
    as_of = as_of or _utc_today()
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return FilingsPage(
            state=UNAVAILABLE,
            ordered_by=ORDERED_BY_PERIOD_END,
            periods_ended_on_or_before=as_of,
            filings=(),
            limit=limit,
            offset=offset,
            has_more=False,
            total=None,
            newest_period_end=None,
            newest_period_filing_count=None,
            newest_period_committee_count=None,
            as_of=None,
            snapshot_id=None,
            reason=NO_FILINGS_SNAPSHOT,
        )
    report = schema.CampaignFinanceFilingReport
    filer = schema.CampaignFinanceFiler
    # Built once and handed to both the rows and the count below, so the number a page
    # prints can never describe a different set from the rows under it (#1677). The join
    # is part of the filter, not decoration: it is what drops a report whose filer the
    # register does not hold.
    filed_and_ended = (
        report.snapshot_id == snapshot.id,
        # Not an optimization, and never remove it to widen the feed. An amendment
        # record is the Board's own positive signal that a report was FILED: every
        # filed report carries at least ['0'] and a report nobody has filed carries
        # none (`docs/architecture/campaign-finance-system-design.md` §9.6). The
        # catalogue is a schedule, so without this line the feed prints a report as
        # filed under a named politician's committee that has not filed it. §9.6 also
        # rules that this must be read from the version history and never inferred
        # from a failed document download, which is what this column stores.
        report.effective_amendment_index.is_not(None),
        report.cut_off_date.is_not(None),
        report.cut_off_date <= as_of,
    )
    joined_to_filer = (
        filer,
        (filer.snapshot_id == report.snapshot_id)
        & (filer.registration_number == report.registration_number),
    )
    rows = db.execute(
        select(
            report.registration_number,
            report.filing_year,
            report.report_type,
            report.report_name,
            report.cut_off_date,
            report.special_election,
            report.effective_amendment_index,
            report.amendment_count,
            report.filed_date,
            filer.name,
            filer.kind,
        )
        .join(*joined_to_filer)
        .where(*filed_and_ended)
        .order_by(
            _filed_date_order(report),
            filer.name.asc(),
            report.registration_number.asc(),
            report.row_number.asc(),
        )
        .limit(limit + 1)
        .offset(offset)
    ).all()
    if not rows and offset == 0 and (snapshot.report_count or 0) > 0:
        # An empty page has 2 causes and they are different facts: the snapshot's rows
        # have been replaced under this read, or every row it holds was filtered out by
        # the 4 exclusions above (a catalogue of nothing but unfiled, undated or
        # not-yet-ended reports).
        # Only the first is a refusal, so the rows are probed unfiltered rather than
        # inferred from the filtered count -- the same shape as
        # ``_refuse_if_rows_are_gone`` in the reader, and caught here by
        # ``test_a_report_with_no_period_end_is_left_out_rather_than_undated``.
        present = db.scalar(
            select(report.row_number).where(report.snapshot_id == snapshot.id).limit(1)
        )
        if present is None:
            return FilingsPage(
                state=UNAVAILABLE,
                ordered_by=ORDERED_BY_PERIOD_END,
                periods_ended_on_or_before=as_of,
                filings=(),
                limit=limit,
                offset=offset,
                has_more=False,
                total=None,
                newest_period_end=None,
                newest_period_filing_count=None,
                newest_period_committee_count=None,
                as_of=_snapshot_date(snapshot),
                snapshot_id=snapshot.id,
                reason=ROWS_REPLACED,
            )
    has_more = len(rows) > limit
    page = rows[:limit]
    special_years = _special_election_filer_years(
        db, snapshot.id, {row[0] for row in page}
    )
    filings = tuple(_filing_row(row, special_years=special_years) for row in page)
    total = (
        db.scalar(
            select(func.count())
            .select_from(report)
            .join(*joined_to_filer)
            .where(*filed_and_ended)
        )
        or 0
    )
    # Counted over the same filter again rather than read off the rows: the newest
    # period's filings run past the end of any one page, so a count taken from `filings`
    # would be a count of this page wearing the period's name. Grouped and ordered
    # rather than read from row 0, so it is right whatever offset the caller asked for.
    newest = db.execute(
        select(
            report.cut_off_date,
            func.count(),
            func.count(func.distinct(report.registration_number)),
        )
        .select_from(report)
        .join(*joined_to_filer)
        .where(*filed_and_ended)
        .group_by(report.cut_off_date)
        .order_by(report.cut_off_date.desc())
        .limit(1)
    ).first()
    return FilingsPage(
        state=REPORTED,
        ordered_by=_order_name(db, report, filed_and_ended, joined_to_filer),
        periods_ended_on_or_before=as_of,
        filings=filings,
        limit=limit,
        offset=offset,
        has_more=has_more,
        total=total,
        newest_period_end=newest[0] if newest else None,
        newest_period_filing_count=newest[1] if newest else None,
        newest_period_committee_count=newest[2] if newest else None,
        as_of=_snapshot_date(snapshot),
        snapshot_id=snapshot.id,
        reason=None,
    )


@dataclass(frozen=True)
class CommitteeFilingsPage:
    """One committee's filed reports, the whole history the catalogue records.

    The same row shape as the landing feed (``FilingRow``), because both lists make the
    same claims and must break in the same places. Two deliberate differences from
    ``FilingsPage``:

    * **No ended-periods cutoff.** A terminating committee files its final report at
      termination, before the period closes — filer 18472's 2026 year-end is a real,
      filed report read in August 2026 (§9.4's sixth filer) — and on the committee's own
      page that report is the newest thing it has filed, not noise at the top of a feed.
    * **A filed report with no period end is listed, last, rather than dropped.** The
      landing drops it because a "newest" feed cannot place it; a committee's own history
      leaving it out would hide a real filing. The row then carries no period line
      (0 such rows in the live snapshot, measured 19 Aug 2026 — this is the safe shape,
      not a live state).

    ``catalogued_without_record`` counts this filer's catalogue rows that carry no
    amendment record — either never filed (the catalogue is a schedule) or too old for
    the Board to serve a version history (ordinary before 2008, §9.6) — so the page can
    say the list's boundary out loud instead of implying it lists every report ever
    filed. ``None`` when the state is not ``reported``, never 0.
    """

    state: str
    ordered_by: str
    filings: tuple[FilingRow, ...]
    limit: int
    offset: int
    has_more: bool
    total: Optional[int]
    catalogued_without_record: Optional[int]
    as_of: Optional[date]
    snapshot_id: Optional[UUID]
    reason: Optional[str]


def committee_filings(
    db: Session, registration_number: str, *, limit: int, offset: int
) -> CommitteeFilingsPage:
    """Every report this committee is recorded as having filed, newest period first.

    The same honesty rules as ``recent_filings``, scoped to one filer:

    * **Only reports somebody actually filed.** The catalogue lists a report the moment
      its filing period opens, so rows with no amendment record are excluded (§9.6's
      rule: every filed report carries at least ``['0']``). They are counted in
      ``catalogued_without_record`` instead, because for pre-2008 rows the missing
      record means "the Board serves no history", not "never filed", and the page must
      not pretend the boundary away.
    * **Ordered newest arrival first, and it says which order that is.** A row sorts by
      its filing date where the Board's document states one and by its period end where
      it does not ([#1670](https://github.com/alethical-org/alethical/issues/1670)), so
      ``ordered_by`` is served and a caller may print "filed on" beside a row **only**
      where that row's own ``filed_date`` is populated. Most of a committee's history
      will carry none: the Board serves no document before 2023 for most reports (§9.4).
    * **A period start comes off a Board calendar or not at all**, and never for a
      filer-year that carries a special-election report, whose year does not open on
      1 January (§9.5).

    An empty page for a real committee is ``reported`` with 0 rows: the register lists
    filers whose catalogued reports all lack an amendment record (filer 18684 holds 7
    catalogued rows and 0 filed ones in the live snapshot), and that is a fact about the
    catalogue, not a fault of ours. ``unavailable`` is reserved for our own gaps: no
    filings snapshot loaded, or the snapshot's rows replaced under this read.
    """
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return CommitteeFilingsPage(
            state=UNAVAILABLE,
            ordered_by=ORDERED_BY_PERIOD_END,
            filings=(),
            limit=limit,
            offset=offset,
            has_more=False,
            total=None,
            catalogued_without_record=None,
            as_of=None,
            snapshot_id=None,
            reason=NO_FILINGS_SNAPSHOT,
        )
    report = schema.CampaignFinanceFilingReport
    filer = schema.CampaignFinanceFiler
    filed_for_this_committee = (
        report.snapshot_id == snapshot.id,
        report.registration_number == registration_number,
        # The amendment-record rule, same as the landing feed: the Board's own positive
        # signal that a report was FILED (§9.6). Never inferred from a failed document
        # download, which is what this column stores.
        report.effective_amendment_index.is_not(None),
    )
    joined_to_filer = (
        filer,
        (filer.snapshot_id == report.snapshot_id)
        & (filer.registration_number == report.registration_number),
    )
    rows = db.execute(
        select(
            report.registration_number,
            report.filing_year,
            report.report_type,
            report.report_name,
            report.cut_off_date,
            report.special_election,
            report.effective_amendment_index,
            report.amendment_count,
            report.filed_date,
            filer.name,
            filer.kind,
        )
        .join(*joined_to_filer)
        .where(*filed_for_this_committee)
        .order_by(
            # A row with neither a filing date nor a period end sorts last rather than
            # being dropped: it is a real filing we simply cannot place, and its row
            # carries no period line.
            _filed_date_order(report).nulls_last(),
            report.filing_year.desc(),
            report.row_number.asc(),
        )
        .limit(limit + 1)
        .offset(offset)
    ).all()
    if not rows and offset == 0 and (snapshot.report_count or 0) > 0:
        # Empty has 2 causes and only one is a refusal: the snapshot's rows were
        # replaced under this read, or this committee genuinely has no filed report in
        # the catalogue. Probed unfiltered, the same shape as ``recent_filings``.
        present = db.scalar(
            select(report.row_number).where(report.snapshot_id == snapshot.id).limit(1)
        )
        if present is None:
            return CommitteeFilingsPage(
                state=UNAVAILABLE,
                ordered_by=ORDERED_BY_PERIOD_END,
                filings=(),
                limit=limit,
                offset=offset,
                has_more=False,
                total=None,
                catalogued_without_record=None,
                as_of=_snapshot_date(snapshot),
                snapshot_id=snapshot.id,
                reason=ROWS_REPLACED,
            )
    has_more = len(rows) > limit
    page = rows[:limit]
    special_years = _special_election_filer_years(
        db, snapshot.id, {registration_number}
    )
    filings = tuple(_filing_row(row, special_years=special_years) for row in page)
    total = (
        db.scalar(
            select(func.count())
            .select_from(report)
            .join(*joined_to_filer)
            .where(*filed_for_this_committee)
        )
        or 0
    )
    ordered_by = _order_name(db, report, filed_for_this_committee, joined_to_filer)
    without_record = (
        db.scalar(
            select(func.count())
            .select_from(report)
            .where(
                report.snapshot_id == snapshot.id,
                report.registration_number == registration_number,
                report.effective_amendment_index.is_(None),
            )
        )
        or 0
    )
    return CommitteeFilingsPage(
        state=REPORTED,
        ordered_by=ordered_by,
        filings=filings,
        limit=limit,
        offset=offset,
        has_more=has_more,
        total=total,
        catalogued_without_record=without_record,
        as_of=_snapshot_date(snapshot),
        snapshot_id=snapshot.id,
        reason=None,
    )


def _special_election_filer_years(
    db: Session, snapshot_id: UUID, registrations: set[str]
) -> set[tuple[str, int]]:
    """Which filer-years on this page carry a special-election report.

    A candidate who ran in a special election files a whole second report series, and
    their regular report's period does not open on 1 January: filer 19223 reports from
    11 July 2025 (§9.5). So a printed calendar start is wrong for them, and this is what
    withholds it. Scoped to the page's own filers, so the cost does not grow with the
    catalogue.
    """
    if not registrations:
        return set()
    report = schema.CampaignFinanceFilingReport
    return {
        (registration, year)
        for registration, year in db.execute(
            select(report.registration_number, report.filing_year)
            .where(
                report.snapshot_id == snapshot_id,
                report.registration_number.in_(registrations),
                report.special_election.is_(True),
            )
            .distinct()
        ).all()
    }


def _filing_row(row, *, special_years: set[tuple[str, int]]) -> FilingRow:
    (
        registration_number,
        filing_year,
        report_type,
        report_name,
        cut_off_date,
        special_election,
        effective_amendment_index,
        amendment_count,
        filed_date,
        filer_name,
        filer_kind,
    ) = row
    start = None
    if (registration_number, filing_year) not in special_years:
        start = printed_period_start_for_end(cut_off_date)
    return FilingRow(
        registration_number=registration_number,
        filer_name=filer_name,
        filer_kind=filer_kind.value
        if hasattr(filer_kind, "value")
        else str(filer_kind),
        report_name=report_name or "",
        report_type=report_type,
        filing_year=filing_year,
        period_end=cut_off_date,
        period_start=start,
        period_start_source=BOARD_CALENDAR if start is not None else None,
        # Passed straight through, never defaulted. `or cut_off_date` here is the one
        # line that would turn this whole module into a liar (#1670).
        filed_date=filed_date,
        special_election=special_election,
        amendment_count=amendment_count,
        effective_amendment_index=effective_amendment_index,
    )


def report_corrections(
    db: Session, registration_number: str, year: int
) -> Optional[int]:
    """How many times this committee-year's report has been corrected after filing.

    The Board's catalogue keeps a version history per report, and
    ``effective_amendment_index`` is the version that counts: ``0`` is the report as
    first filed, ``1`` and above mean the committee filed it again with different
    figures. This returns the highest index across the year's reports, because a
    Minnesota report restates the whole year, so the year's latest version is the
    year's figures.

    Three answers and they are not interchangeable:

    * A number **above 0** -- the committee corrected itself, and any figure of ours
      that predates the correction is a figure of the superseded version.
    * ``0`` -- every report of this year is still on its first version, so a
      disagreement between 2 of our figures cannot be blamed on a correction.
    * ``None`` -- we hold no version history for this committee-year at all: no
      filings snapshot, no catalogued report, or a report nobody has filed yet (the
      catalogue lists a report when its period opens, and an unfiled one carries no
      version history at all, §9.6). Never read as "never corrected": a count we
      cannot compute is absent, never 0
      (``.claude/rules/grounded-answers.md`` rule 12).

    Measured on the live catalogue, 19 Aug 2026: of 15,988 committee-years, 5,402
    carry a correction, 8,898 are still on their first version, and 1,688 carry no
    version history. So this separates a third of the population rather than being
    true of everything.
    """
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return None
    report = schema.CampaignFinanceFilingReport
    return db.scalar(
        select(func.max(report.effective_amendment_index)).where(
            report.snapshot_id == snapshot.id,
            report.registration_number == registration_number,
            report.filing_year == year,
        )
    )
