"""A committee's large-contribution notices and disclosure statements, for its page (#2347).

Two record kinds that sit beside a committee's payments and are never added to them.
Nothing in this module returns a total, a share or a count of money: each notice and
each statement carries its own amount, date and source, and the page prints them as
records (`.claude/rules/grounded-answers.md` rules 3 and 12).

**Notices.** Grouped by the windows the law sets for this filer (Minnesota Statutes
10A.20 subd. 5), with each notice's status against the payments we hold:

* ``matched`` -- a payment row names the same contributor, date and amount, ignoring
  only letter case and surrounding spaces. The same gift, drawn twice on purpose.
* ``not_yet_on_a_report`` -- the gift is dated after the end of the latest report the
  committee has filed in our copy of the Board's catalogue, so no report could list it.
* ``no_exact_match`` -- a filed report covers the date and no row matches exactly.
  Spellings vary between filings, so this never says the gift is missing.

**Statements.** Attached to the one payment whose donor, date and amount the person who
read the statement recorded, by the same exact rule. A statement no one has linked to a
gift, or whose gift matches no row, attaches to nothing and prints nothing: matching is
exact, so an absence line on a gift would be false the moment a statement had been filed
under a slightly different date.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from alethical.db import models as schema
from alethical.pipeline import campaign_finance_filings as filings
from alethical.pipeline import campaign_finance_notices as notices_pipeline

MINNESOTA = ZoneInfo("America/Chicago")
FilerKind = schema.CampaignFinanceFilerKind


def minnesota_date(moment: Optional[datetime]) -> Optional[date]:
    if moment is None:
        return None
    return moment.astimezone(MINNESOTA).date()


def same_name(left: Optional[str], right: Optional[str]) -> bool:
    """The match rule's only allowance: letter case and surrounding spaces."""
    if left is None or right is None:
        return False
    return left.strip().casefold() == right.strip().casefold()


def _same_amount(left: Optional[Decimal], right: Optional[Decimal]) -> bool:
    return left is not None and right is not None and Decimal(left) == Decimal(right)


#: The notice threshold the page's lead names, by what the statute attaches it to.
THRESHOLD_COMMITTEE = "more_than_1000"
THRESHOLD_APPELLATE = "more_than_2000"
THRESHOLD_DISTRICT_COURT = "more_than_400"
THRESHOLD_HALF_LIMIT = "more_than_half_the_limit"


def threshold_for(kind: FilerKind, office: Optional[str]) -> str:
    if kind == FilerKind.political_committee_or_fund:
        return THRESHOLD_COMMITTEE
    if office in ("Supreme Court", "Appellate Court"):
        return THRESHOLD_APPELLATE
    if office == "District Court":
        return THRESHOLD_DISTRICT_COURT
    return THRESHOLD_HALF_LIMIT


@dataclass(frozen=True)
class MatchedPayment:
    contributor: Optional[str]
    contributor_type: Optional[str]
    received_on: Optional[date]
    amount: Optional[Decimal]
    record_number: int


@dataclass(frozen=True)
class NoticeRecord:
    id: str
    contributor: str
    amount: Decimal
    contribution_date: date
    received_on: date
    employer: Optional[str]
    in_kind: bool
    in_kind_description: Optional[str]
    loan: bool
    amended: bool
    earlier_contributor: Optional[str]
    earlier_contribution_date: Optional[date]
    earlier_amount: Optional[Decimal]
    status: str
    matched_payment: Optional[MatchedPayment]
    pdf_url: str


@dataclass(frozen=True)
class WindowRecord:
    key: str
    label: str
    start: date
    end: date
    notices: tuple[NoticeRecord, ...]


@dataclass(frozen=True)
class CommitteeNotices:
    """``state``: ``listed`` draws the card; every other state draws nothing.

    ``not_covered`` (no copy of the notice list speaks for this year),
    ``no_windows`` (a party unit, or every window ruled out for this filer) and
    ``unavailable`` (we hold no completed copy of the list at all) are all absent by
    scope: the card is never drawn empty.
    """

    state: str
    registration_number: str
    year: int
    threshold: Optional[str] = None
    windows: tuple[WindowRecord, ...] = ()
    copied_on: Optional[date] = None
    source_url: str = notices_pipeline.NOTICE_LIST_URL
    any_amended: bool = False


def latest_notice_copy(db: Session) -> Optional[schema.CampaignFinanceNoticeListCopy]:
    return db.scalar(
        select(schema.CampaignFinanceNoticeListCopy)
        .order_by(schema.CampaignFinanceNoticeListCopy.fetched_at.desc())
        .limit(1)
    )


def latest_report_end(
    db: Session, registration_number: str, year: int
) -> Optional[date]:
    """The end of the latest report this filer has filed for the year, in our copy."""
    snapshot = filings.live_filings_snapshot(db)
    if snapshot is None:
        return None
    report = schema.CampaignFinanceFilingReport
    return db.scalar(
        select(func.max(report.cut_off_date)).where(
            report.snapshot_id == snapshot.id,
            report.registration_number == registration_number,
            report.filing_year == year,
            report.effective_amendment_index.is_not(None),
            report.special_election.is_(False),
        )
    )


def _contribution_rows(
    db: Session, snapshot_id: uuid.UUID, registration_number: str, year: int
) -> list[MatchedPayment]:
    row = schema.CampaignFinanceContributionRow
    return [
        MatchedPayment(
            contributor, contributor_type, received_on, amount, record_number
        )
        for contributor, contributor_type, received_on, amount, record_number in db.execute(
            select(
                row.contributor,
                row.contrib_type,
                row.receipt_date,
                row.amount,
                row.row_number,
            ).where(
                row.snapshot_id == snapshot_id,
                row.recipient_reg_num == registration_number,
                row.year == year,
                row.receipt_type == "Contribution",
            )
        ).all()
    ]


def notice_status(
    notice: schema.CampaignFinanceContributionNotice,
    payments: Iterable[MatchedPayment],
    report_end: Optional[date],
) -> tuple[str, Optional[MatchedPayment]]:
    for payment in payments:
        if (
            same_name(payment.contributor, notice.contributor_name)
            and payment.received_on == notice.contribution_date
            and _same_amount(payment.amount, notice.amount)
        ):
            return "matched", payment
    if report_end is None or notice.contribution_date > report_end:
        return "not_yet_on_a_report", None
    return "no_exact_match", None


def committee_notices(
    db: Session,
    *,
    registration_number: str,
    year: int,
    contributions_snapshot_id: Optional[uuid.UUID],
    kind: Optional[FilerKind],
    office: Optional[str],
) -> CommitteeNotices:
    copy = latest_notice_copy(db)
    if copy is None:
        return CommitteeNotices("unavailable", registration_number, year)
    if year not in (copy.covered_years or []):
        return CommitteeNotices("not_covered", registration_number, year)

    rows = db.scalars(
        select(schema.CampaignFinanceContributionNotice).where(
            schema.CampaignFinanceContributionNotice.registration_number
            == registration_number,
            schema.CampaignFinanceContributionNotice.filing_year == year,
            schema.CampaignFinanceContributionNotice.special_election.is_(False),
            schema.CampaignFinanceContributionNotice.parse_error.is_(None),
            schema.CampaignFinanceContributionNotice.document_hash.is_not(None),
        )
    ).all()
    if kind is None and rows:
        kind = rows[0].filer_kind
    if kind is None or kind == FilerKind.party_unit:
        return CommitteeNotices("no_windows", registration_number, year)

    excluded = set(
        db.scalars(
            select(schema.CampaignFinanceNoticeWindowExclusion.window).where(
                schema.CampaignFinanceNoticeWindowExclusion.registration_number
                == registration_number,
                schema.CampaignFinanceNoticeWindowExclusion.election_year == year,
            )
        ).all()
    )
    # A notice the Board holds for a window we had ruled out still draws its window:
    # the record outranks our reading of the ballot files.
    held_windows = {
        notices_pipeline.window_for_period(row.notice_period) for row in rows
    }
    windows_defined = [
        window
        for window in notices_pipeline.NOTICE_WINDOWS.get(year, ())
        if window.key not in excluded or window.key in held_windows
    ]
    if not windows_defined:
        return CommitteeNotices("no_windows", registration_number, year)

    payments = (
        _contribution_rows(db, contributions_snapshot_id, registration_number, year)
        if contributions_snapshot_id is not None and rows
        else []
    )
    report_end = latest_report_end(db, registration_number, year) if rows else None

    windows = []
    any_amended = False
    for window in windows_defined:
        records = []
        for row in rows:
            if notices_pipeline.window_for_period(row.notice_period) != window.key:
                continue
            status, payment = notice_status(row, payments, report_end)
            amended = (row.amendment_index or 0) > 0
            any_amended = any_amended or amended
            records.append(
                NoticeRecord(
                    id=str(row.id),
                    contributor=row.contributor_name,
                    amount=row.amount,
                    contribution_date=row.contribution_date,
                    received_on=row.received_on,
                    employer=row.employer,
                    in_kind=bool(row.in_kind),
                    in_kind_description=row.in_kind_description
                    if row.in_kind
                    else None,
                    loan=bool(row.loan),
                    amended=amended,
                    earlier_contributor=row.earlier_contributor_name
                    if amended
                    else None,
                    earlier_contribution_date=(
                        row.earlier_contribution_date if amended else None
                    ),
                    earlier_amount=row.earlier_amount if amended else None,
                    status=status,
                    matched_payment=payment,
                    pdf_url=notices_pipeline.notice_pdf_url(
                        f"{row.filing_year % 100:02d}",
                        row.notice_period,
                        row.special_election,
                        row.registration_number,
                        row.board_notice_id,
                    ),
                )
            )
        records.sort(
            key=lambda n: (n.contribution_date, n.received_on, n.amount), reverse=True
        )
        windows.append(
            WindowRecord(
                window.key, window.label, window.start, window.end, tuple(records)
            )
        )
    return CommitteeNotices(
        "listed",
        registration_number,
        year,
        threshold=threshold_for(kind, office),
        windows=tuple(windows),
        copied_on=minnesota_date(copy.fetched_at),
        any_amended=any_amended,
    )


# --- Statements ------------------------------------------------------------------


@dataclass(frozen=True)
class AttachedStatement:
    record_number: int
    statement_id: str
    state: str
    pdf_url: str


def _readings_for(db: Session, registration_number: str):
    statement = schema.CampaignFinanceDisclosureStatement
    reading = schema.CampaignFinanceDisclosureStatementReading
    return db.execute(
        select(statement, reading)
        .join(reading, reading.statement_id == statement.id)
        .where(statement.recipient_registration_number == registration_number)
    ).all()


def attached_statements(
    db: Session, registration_number: str, payments: Iterable
) -> list[AttachedStatement]:
    """For payment rows already read, the statements that name exactly those gifts.

    ``payments`` are ``ContributionPayment`` rows of one committee. Each statement
    attaches to at most one row: the first, by record number, among rows naming the same
    donor, date and amount.
    """
    readings = _readings_for(db, registration_number)
    if not readings:
        return []
    candidates = sorted(
        (p for p in payments if getattr(p, "receipt_type", None) == "Contribution"),
        key=lambda p: p.record_number,
    )
    attached: list[AttachedStatement] = []
    used: set[int] = set()
    for statement, reading in sorted(
        readings, key=lambda pair: pair[0].statement_number
    ):
        for payment in candidates:
            if payment.record_number in used:
                continue
            if (
                same_name(payment.contributor, reading.donor_name)
                and payment.received_on == reading.gift_date
                and _same_amount(payment.amount, reading.gift_amount)
            ):
                used.add(payment.record_number)
                attached.append(
                    AttachedStatement(
                        record_number=payment.record_number,
                        statement_id=str(statement.id),
                        state=reading.state.value,
                        pdf_url=notices_pipeline.statement_pdf_url(
                            statement.filing_year,
                            statement.recipient_registration_number,
                            statement.statement_number,
                        ),
                    )
                )
                break
    return attached


def statements_copied_on(db: Session) -> Optional[date]:
    completed = db.scalar(
        select(func.max(schema.CampaignFinanceStatementScan.completed_at))
    )
    return minnesota_date(completed)


@dataclass(frozen=True)
class StatementSource:
    name: str
    city: Optional[str]
    state: Optional[str]
    amount: Optional[Decimal]


@dataclass(frozen=True)
class StatementDetail:
    id: str
    recipient_registration_number: str
    state: str
    donor_name: str
    gift_date: date
    gift_amount: Decimal
    pdf_url: str
    box: Optional[int] = None
    sources: tuple[StatementSource, ...] = field(default_factory=tuple)
    line_a: Optional[Decimal] = None
    line_b: Optional[Decimal] = None
    line_c: Optional[Decimal] = None
    signed_on: Optional[date] = None
    received_on: Optional[date] = None


def statement_detail(db: Session, statement_id: uuid.UUID) -> Optional[StatementDetail]:
    """One statement's reading. ``None`` for a statement with no reading at all."""
    reading_model = schema.CampaignFinanceDisclosureStatementReading
    reading = db.scalar(
        select(reading_model)
        .options(selectinload(reading_model.sources))
        .where(reading_model.statement_id == statement_id)
    )
    if reading is None:
        return None
    statement = db.get(schema.CampaignFinanceDisclosureStatement, statement_id)
    base = dict(
        id=str(statement.id),
        recipient_registration_number=statement.recipient_registration_number,
        state=reading.state.value,
        donor_name=reading.donor_name,
        gift_date=reading.gift_date,
        gift_amount=reading.gift_amount,
        pdf_url=notices_pipeline.statement_pdf_url(
            statement.filing_year,
            statement.recipient_registration_number,
            statement.statement_number,
        ),
    )
    if reading.state != schema.DisclosureStatementReadingState.read:
        return StatementDetail(**base)
    # Sources print only for box 3, the one box whose statement lists them.
    sources = (
        tuple(
            StatementSource(source.name, source.city, source.state, source.amount)
            for source in reading.sources
        )
        if reading.box == 3
        else ()
    )
    return StatementDetail(
        **base,
        box=reading.box,
        sources=sources,
        line_a=reading.line_a if reading.box == 3 else None,
        line_b=reading.line_b if reading.box == 3 else None,
        line_c=reading.line_c if reading.box == 3 else None,
        signed_on=reading.signed_on,
        received_on=reading.received_on,
    )
