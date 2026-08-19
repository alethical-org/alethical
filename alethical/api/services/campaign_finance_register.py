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

**We hold no filing date, so nothing here orders by one.** The catalogue serves 17 fields
per report and none of them is the date the report was filed (§9.6's field list); the
"Received by the Board" date is printed inside the report document, which is served only
from 2023 and fails softly. So the feed is newest-first by the period end the catalogue
does serve, and says so in ``ordered_by`` rather than letting a caller assume it has a
filing order. Storing a real filing date is
[#1670](https://github.com/alethical-org/alethical/issues/1670).
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
#: The only order this feed has, served on every page. Named once because the string
#: appears in 3 returns and a drifting copy would tell a caller the order changed.
ORDERED_BY_PERIOD_END = "period_end"


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
    special_election: bool
    amendment_count: Optional[int]
    effective_amendment_index: Optional[int]


@dataclass(frozen=True)
class FilingsPage:
    """One page of the newest filings we hold, newest by period end.

    ``ordered_by`` is served rather than assumed, because the order is not the one the
    design asked for: we hold no filing date (see this module's docstring), so a caller
    must not label these rows "filed on" anything.
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
    * **Reports with no period end.** Nothing orders them and no row can be drawn from
      them, since we hold no filing date either.
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
            as_of=None,
            snapshot_id=None,
            reason=NO_FILINGS_SNAPSHOT,
        )
    report = schema.CampaignFinanceFilingReport
    filer = schema.CampaignFinanceFiler
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
            filer.name,
            filer.kind,
        )
        .join(
            filer,
            (filer.snapshot_id == report.snapshot_id)
            & (filer.registration_number == report.registration_number),
        )
        .where(
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
        .order_by(
            report.cut_off_date.desc(),
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
    return FilingsPage(
        state=REPORTED,
        ordered_by=ORDERED_BY_PERIOD_END,
        periods_ended_on_or_before=as_of,
        filings=filings,
        limit=limit,
        offset=offset,
        has_more=has_more,
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
        special_election=special_election,
        amendment_count=amendment_count,
        effective_amendment_index=effective_amendment_index,
    )
