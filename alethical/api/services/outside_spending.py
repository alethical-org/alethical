"""The outside-spending record, one subject at a time ([#1945]).

Net: what the ``/money/outside-spending`` page and the committee page's 2
outside-spending tabs read. One query shape answers 3 views over Minnesota's
independent-expenditures file: the whole record, one group that spent
(``spender``), and one committee the spending was about (``about``).

Outside spending is money a group that is not the candidate's campaign spends to
support or oppose a committee. Minnesota calls it an independent expenditure, and
the law requires it to be made without the candidate's cooperation, so a row here is
what a group spent -- never what a campaign received.

Three things this module holds to, each because the alternative is a claim no filing
supports (``.claude/rules/grounded-answers.md`` rules 3 and 12).

**One subject per figure.** A total here is a sum over one subject: the file as a
whole, one spender's own rows, or the rows filed about one committee. Nothing here
sets 2 groups or 2 committees side by side, because the state publishes no date
saying when a report arrived, so we cannot tell whether one group's year is finished
and another's has barely started.

**The committee is the subject, never the person.** Every row names a committee and
none names a person. A subject block names the register's candidate only where a
person at Alethical has confirmed the link (``legislator_finance``), and even then
the figures stay spending about the committee.

**Absence is never a zero, and a short total is never served.** No rows for a subject
is ``not_reported``: the file may be silent because nothing was spent or because a
report has not arrived, and nothing in the state's catalogue says which. A release
whose rows were replaced under this read is ``unavailable``. A subject holding a row
whose amount is blank gets its counts and no money figure, because ``sum`` skips the
blank while ``count(*)`` counts it, and a total short by an unknown amount would read
as complete ([#1454]). 0 of the live release's 41,130 rows are blank; the column is
nullable because the loader stores a blank as missing rather than inventing a value.

**Never added to the ordinary expenditures file.** 491 rows here share a spender,
vendor, amount and date with an expenditure row, and whether that is one payment filed
twice or 2 that coincide is not established. Nothing here reads that file.

Measured against the live release on 3 Sep 2026: 41,130 rows, $178,579,449.67, 2015
through 2026; 31,718 "For", 9,412 "Against", none blank; 1,065 in kind; 250 distinct
spenders, of which 178 are in the Board's register we hold; 1,131 distinct committees
spent about, of which 283 appear in no filing of their own and carry a negative number
the Board assigns internally. Counts are evidence for the design, never assertions a
test repeats.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from alethical.api.services import committee_finance
from alethical.api.services.campaign_finance_payments import (
    UNIDENTIFIED_REGISTRATION_NUMBER,
    linkable_committees,
)
from alethical.api.services.campaign_finance_register import (
    REPORTED as REGISTER_REPORTED,
    register_entry,
)
from alethical.api.services.committee_finance import NOT_REPORTED
from alethical.api.services.independent_spending import (
    DIRECTION_NOT_RECORDED,
    OPPOSING,
    REPORTED,
    SUPPORTING,
    UNAVAILABLE,
)
from alethical.api.services.legislator_finance import confirmed_member_for_committee
from alethical.db.schema import load_schema
from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline.campaign_finance_filings import live_filings_snapshot

schema = load_schema()
Dataset = schema.CampaignFinanceDataset
Release = reader.Release
ReleaseNoLongerHeld = reader.ReleaseNoLongerHeld

#: Rows a page holds. The drawing's list is 50 rows and then a next page, so the
#: count line can say "Showing 50 of 1,284" over a measured total.
PAGE_SIZE = 50

#: The 2 orders a subject's rows may take. Newest first is the default; largest first
#: is honest here because ranking rows inside ONE subject is a fact about that subject
#: (``docs/architecture/campaign-finance-system-design.md`` §7).
SORT_NEWEST = "newest"
SORT_LARGEST = "largest"

_TABLE = "cf_independent_expenditure_row"
_COLUMNS = (
    "spender, spender_reg_num, affected_committee_name, affected_committee_reg_num, "
    "for_against, purpose, vendor_name, type, in_kind, transaction_date, year, amount, "
    "unpaid_amount, row_number"
)
#: The source's own spelling of a direction, normalised the same way the profile's
#: figures normalise it, so the 2 surfaces cannot disagree about which side a row is on.
_DIRECTION = "initcap(trim(for_against))"
#: The source's own "In kind?" column holds "Yes" or "No" on every live row.
_IN_KIND = "lower(trim(in_kind)) = 'yes'"


@dataclass(frozen=True)
class OutsideSpendingRow:
    """One expenditure, every field the file states and nothing inferred.

    ``direction`` is one of ``SUPPORTING``, ``OPPOSING`` or ``DIRECTION_NOT_RECORDED``;
    ``direction_as_filed`` is the column's own text, so a page can print the filing's
    word. ``spender_linkable`` and ``about_committee_linkable`` say whether this release
    holds that number as a filer with a page of its own (the Board's register we hold,
    or its own contributions or expenditures); ``*_in_register`` says whether the
    Board's register we hold lists it. A name whose number resolves nowhere is still
    printed, as the filing names it: dropping it would shrink the record and linking
    it would invent a page.
    """

    spender: Optional[str]
    spender_registration_number: Optional[str]
    spender_in_register: bool
    spender_linkable: bool
    about_committee_name: Optional[str]
    about_committee_registration_number: Optional[str]
    about_committee_in_register: bool
    about_committee_linkable: bool
    direction: str
    direction_as_filed: Optional[str]
    purpose: Optional[str]
    vendor_name: Optional[str]
    expenditure_type: Optional[str]
    in_kind: bool
    paid_on: Optional[date]
    year: Optional[int]
    amount: Optional[Decimal]
    unpaid_amount: Optional[Decimal]
    record_number: int


@dataclass(frozen=True)
class OutsideSpendingFigures:
    """What one subject's rows add up to, with every count served beside its sum.

    The 3 direction figures partition ``row_count``: every row is in exactly one, so
    a page showing all 3 shows everything. ``in_kind_count`` is a count inside those
    figures, not beside them. Every money field is ``None`` when
    ``rows_missing_an_amount`` is not 0, because the sums would be short by an unknown
    amount; the counts stay, because a count of rows needs no amount.

    ``committee_count`` and ``spender_count`` are counts of distinct names, keyed on the
    registration number where a row carries one and on the filed name where it does
    not. ``committees_not_linkable`` counts the committees spent about whose number
    resolves to no page of ours; ``None`` when we hold no register to ask.
    """

    row_count: int
    rows_missing_an_amount: int
    amount_total: Optional[Decimal]
    supporting_count: int
    supporting_amount: Optional[Decimal]
    opposing_count: int
    opposing_amount: Optional[Decimal]
    direction_not_recorded_count: int
    direction_not_recorded_amount: Optional[Decimal]
    in_kind_count: int
    first_year: Optional[int]
    last_year: Optional[int]
    first_paid_on: Optional[date]
    last_paid_on: Optional[date]
    committee_count: int
    spender_count: int
    committees_not_linkable: Optional[int]


@dataclass(frozen=True)
class ConfirmedMember:
    """The legislator a person confirmed this committee belongs to (§5.1)."""

    slug: str
    full_name: str


@dataclass(frozen=True)
class Subject:
    """The one group or committee a filtered view is about.

    ``name`` is the Board's register name where the register lists the number, and
    otherwise the name as the file prints it on its rows. ``kind``, ``office`` and
    ``district`` come from the register and are ``None`` where it does not list the
    number or lists no such field for its kind. ``confirmed_member`` is set only where
    a person confirmed whose committee this is; it changes no figure.
    """

    registration_number: str
    name: Optional[str]
    in_register: bool
    linkable: bool
    kind: Optional[str]
    office: Optional[str]
    district: Optional[str]
    confirmed_member: Optional[ConfirmedMember]


@dataclass(frozen=True)
class OutsideSpendingPage:
    """One page of one subject's rows, plus the subject's own figures.

    Read ``state`` before anything else. ``reported`` means the rows and figures are
    real; ``not_reported`` means the file holds no row for this subject and year, which
    is **never a zero**; ``unavailable`` means our own copy is stale or the download
    does not reach the year asked for.
    """

    state: str
    about: Optional[Subject]
    spender: Optional[Subject]
    year: Optional[int]
    sort: str
    rows: tuple[OutsideSpendingRow, ...]
    page_number: int
    page_size: int
    total_rows: Optional[int]
    has_more: bool
    figures: Optional[OutsideSpendingFigures]
    source_url: Optional[str]
    release_id: UUID
    fetched_at: Optional[datetime]


class UnknownSubject(LookupError):
    """The number is in neither the register we hold nor the file we read.

    Raised rather than answering ``not_reported``, because that would invent a subject
    and then attribute silence to it -- rule 12's missing-versus-zero failure with the
    committee itself as the missing value.
    """


def _clean(value: Optional[str]) -> Optional[str]:
    if value is None or value == "" or value == UNIDENTIFIED_REGISTRATION_NUMBER:
        return None
    return value


def _where(
    *, about: Optional[str], spender: Optional[str], year: Optional[int]
) -> tuple[str, dict[str, object]]:
    """The WHERE clause every read of one subject shares, with its bound parameters.

    Only ``about``, ``spender`` and ``year`` come from a caller, and each is bound, so a
    number holding a quote is matched rather than interpreted. Returned once and used
    by the rows, the count and the figures alike, so the 3 can never describe
    different populations.
    """
    clauses = ["snapshot_id = :snapshot"]
    params: dict[str, object] = {}
    if about is not None:
        clauses.append("affected_committee_reg_num = :about")
        params["about"] = about
    if spender is not None:
        clauses.append("spender_reg_num = :spender")
        params["spender"] = spender
    if year is not None:
        clauses.append("year = :year")
        params["year"] = year
    return " AND ".join(clauses), params


def _register_numbers(db: Session, numbers: set[str]) -> Optional[frozenset[str]]:
    """Which of these numbers the Board's register we hold lists, or ``None`` if none is held."""
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return None
    if not numbers:
        return frozenset()
    rows = db.execute(
        select(schema.CampaignFinanceFiler.registration_number).where(
            schema.CampaignFinanceFiler.snapshot_id == snapshot.id,
            schema.CampaignFinanceFiler.registration_number.in_(sorted(numbers)),
        )
    ).all()
    return frozenset(number for (number,) in rows)


def _rows(
    db: Session,
    release: Release,
    *,
    where: str,
    params: dict[str, object],
    sort: str,
    page_number: int,
) -> list:
    order_by = (
        "amount DESC NULLS LAST, transaction_date DESC NULLS LAST, row_number DESC"
        if sort == SORT_LARGEST
        else "transaction_date DESC NULLS LAST, row_number DESC"
    )
    return list(
        db.execute(
            text(
                f"SELECT {_COLUMNS} FROM {_TABLE} WHERE {where} "
                f"ORDER BY {order_by} LIMIT :limit OFFSET :offset"
            ),
            {
                **params,
                "snapshot": release.independent_expenditures.snapshot_id,
                "limit": PAGE_SIZE,
                "offset": (page_number - 1) * PAGE_SIZE,
            },
        ).all()
    )


def _figures(
    db: Session,
    release: Release,
    *,
    where: str,
    params: dict[str, object],
) -> OutsideSpendingFigures:
    """One aggregate pass over the subject's rows.

    The direction test is the same normalisation the profile's figures use, and the
    third figure is defined as everything the first 2 are not, so no row can fall
    between them (#1454).
    """
    snapshot_id = release.independent_expenditures.snapshot_id
    row = db.execute(
        text(
            "SELECT count(*), count(*) - count(amount), coalesce(sum(amount), 0), "
            f" count(*) FILTER (WHERE {_DIRECTION} = :for), "
            f" coalesce(sum(amount) FILTER (WHERE {_DIRECTION} = :for), 0), "
            f" count(*) FILTER (WHERE {_DIRECTION} = :against), "
            f" coalesce(sum(amount) FILTER (WHERE {_DIRECTION} = :against), 0), "
            f" count(*) FILTER (WHERE {_IN_KIND}), "
            " min(year), max(year), min(transaction_date), max(transaction_date), "
            " count(DISTINCT coalesce(nullif(nullif(affected_committee_reg_num, ''), '0'),"
            "   affected_committee_name)), "
            " count(DISTINCT coalesce(nullif(nullif(spender_reg_num, ''), '0'), spender)) "
            f"FROM {_TABLE} WHERE {where}"
        ),
        {**params, "snapshot": snapshot_id, "for": SUPPORTING, "against": OPPOSING},
    ).one()
    (
        count,
        missing,
        total,
        for_count,
        for_amount,
        against_count,
        against_amount,
        in_kind,
        first_year,
        last_year,
        first_paid,
        last_paid,
        committees,
        spenders,
    ) = row
    money = missing == 0
    return OutsideSpendingFigures(
        row_count=int(count),
        rows_missing_an_amount=int(missing),
        amount_total=Decimal(total) if money else None,
        supporting_count=int(for_count),
        supporting_amount=Decimal(for_amount) if money else None,
        opposing_count=int(against_count),
        opposing_amount=Decimal(against_amount) if money else None,
        direction_not_recorded_count=int(count - for_count - against_count),
        direction_not_recorded_amount=(
            Decimal(total) - Decimal(for_amount) - Decimal(against_amount)
            if money
            else None
        ),
        in_kind_count=int(in_kind),
        first_year=int(first_year) if first_year is not None else None,
        last_year=int(last_year) if last_year is not None else None,
        first_paid_on=first_paid,
        last_paid_on=last_paid,
        committee_count=int(committees),
        spender_count=int(spenders),
        committees_not_linkable=_committees_not_linkable(
            db, release, where=where, params=params
        ),
    )


def _committees_not_linkable(
    db: Session, release: Release, *, where: str, params: dict[str, object]
) -> Optional[int]:
    """How many committees spent about, in this subject, have no page of ours to link.

    A committee is linkable when this release holds it as a filer of its own money
    (``linkable_committees``) or the Board's register we hold lists it. The rest are
    printed as filed and never linked. ``None`` while we hold no register, because
    then the question cannot be answered either way.
    """
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return None
    return int(
        db.execute(
            text(
                "SELECT count(DISTINCT coalesce(nullif(nullif(r.affected_committee_reg_num, ''), '0'),"
                "   r.affected_committee_name)) "
                f"FROM {_TABLE} r WHERE {where} "
                " AND NOT EXISTS (SELECT 1 FROM cf_filer f WHERE f.snapshot_id = :register"
                "   AND f.registration_number = r.affected_committee_reg_num) "
                " AND NOT EXISTS (SELECT 1 FROM cf_contribution_row c"
                "   WHERE c.snapshot_id = :contributions"
                "   AND c.recipient_reg_num = r.affected_committee_reg_num) "
                " AND NOT EXISTS (SELECT 1 FROM cf_expenditure_row e"
                "   WHERE e.snapshot_id = :expenditures"
                "   AND e.committee_reg_num = r.affected_committee_reg_num)"
            ),
            {
                **params,
                "snapshot": release.independent_expenditures.snapshot_id,
                "register": snapshot.id,
                "contributions": release.contributions.snapshot_id,
                "expenditures": release.expenditures.snapshot_id,
            },
        ).scalar_one()
    )


def _subject(
    db: Session,
    release: Release,
    *,
    registration_number: str,
    key_column: str,
    name_column: str,
    linkable: frozenset[str],
    in_register: frozenset[str],
) -> Subject:
    """The filtered view's own header facts, resolved from the register first.

    Raises ``UnknownSubject`` when the number is in neither the register we hold nor
    the file, under either column. A number in the file but not the register is a real
    subject and its name is the file's.
    """
    entry = register_entry(db, registration_number)
    filed_name = db.execute(
        text(
            f"SELECT {name_column} FROM {_TABLE} WHERE snapshot_id = :snapshot "
            f" AND {key_column} = :number ORDER BY row_number DESC LIMIT 1"
        ),
        {
            "snapshot": release.independent_expenditures.snapshot_id,
            "number": registration_number,
        },
    ).scalar_one_or_none()
    if entry.state != REGISTER_REPORTED and filed_name is None:
        raise UnknownSubject(registration_number)
    member = confirmed_member_for_committee(db, registration_number)
    return Subject(
        registration_number=registration_number,
        name=entry.name if entry.state == REGISTER_REPORTED else filed_name,
        in_register=registration_number in in_register,
        linkable=registration_number in linkable,
        kind=entry.kind,
        office=entry.office,
        district=entry.district,
        confirmed_member=(
            ConfirmedMember(slug=member.slug, full_name=member.full_name)
            if member is not None
            else None
        ),
    )


def outside_spending(
    db: Session,
    release: Release,
    *,
    about: Optional[str] = None,
    spender: Optional[str] = None,
    year: Optional[int] = None,
    sort: str = SORT_NEWEST,
    page_number: int = 1,
) -> OutsideSpendingPage:
    """One page of the outside-spending record for one subject.

    No filter is the whole record. ``about`` and ``spender`` may be combined, which is
    still one subject's rows narrowed by the other side. The rows, the total, the
    figures and the counts all come from the same WHERE clause.
    """
    dataset = Dataset.independent_expenditures
    where, params = _where(about=about, spender=spender, year=year)

    def refusal(state: str, *, about_s=None, spender_s=None) -> OutsideSpendingPage:
        return OutsideSpendingPage(
            state=state,
            about=about_s,
            spender=spender_s,
            year=year,
            sort=sort,
            rows=(),
            page_number=page_number,
            page_size=PAGE_SIZE,
            total_rows=None,
            has_more=False,
            figures=None,
            source_url=release.independent_expenditures.source_url,
            release_id=release.id,
            fetched_at=release.fetched_at,
        )

    try:
        rows = _rows(
            db, release, where=where, params=params, sort=sort, page_number=page_number
        )
        figures = _figures(db, release, where=where, params=params)
        if figures.row_count == 0:
            # Staleness first, then coverage, then silence: the same order the
            # payments reader uses, delegated rather than copied so 2 services cannot
            # disagree about what an absence means.
            reader._refuse_if_rows_are_gone(db, release, dataset)
            state = (
                NOT_REPORTED
                if year is None
                else committee_finance._empty_state(db, release, dataset, year)
            )
        else:
            state = REPORTED
    except ReleaseNoLongerHeld:
        return refusal(UNAVAILABLE)

    numbers = {
        n for row in rows for n in (_clean(row[1]), _clean(row[3])) if n is not None
    }
    for subject_number in (about, spender):
        if subject_number is not None:
            numbers.add(subject_number)
    in_register = _register_numbers(db, numbers) or frozenset()
    linkable = linkable_committees(db, release, sorted(numbers)) | in_register

    about_subject = (
        _subject(
            db,
            release,
            registration_number=about,
            key_column="affected_committee_reg_num",
            name_column="affected_committee_name",
            linkable=linkable,
            in_register=in_register,
        )
        if about is not None
        else None
    )
    spender_subject = (
        _subject(
            db,
            release,
            registration_number=spender,
            key_column="spender_reg_num",
            name_column="spender",
            linkable=linkable,
            in_register=in_register,
        )
        if spender is not None
        else None
    )

    if state != REPORTED:
        return refusal(state, about_s=about_subject, spender_s=spender_subject)

    shaped = tuple(
        _row(row, linkable=linkable, in_register=in_register) for row in rows
    )
    return OutsideSpendingPage(
        state=REPORTED,
        about=about_subject,
        spender=spender_subject,
        year=year,
        sort=sort,
        rows=shaped,
        page_number=page_number,
        page_size=PAGE_SIZE,
        total_rows=figures.row_count,
        has_more=page_number * PAGE_SIZE < figures.row_count,
        figures=figures,
        source_url=release.independent_expenditures.source_url,
        release_id=release.id,
        fetched_at=release.fetched_at,
    )


def _row(
    row, *, linkable: frozenset[str], in_register: frozenset[str]
) -> OutsideSpendingRow:
    (
        spender,
        spender_reg,
        about_name,
        about_reg,
        for_against,
        purpose,
        vendor,
        kind,
        in_kind,
        paid_on,
        year,
        amount,
        unpaid,
        record_number,
    ) = row
    spender_reg = _clean(spender_reg)
    about_reg = _clean(about_reg)
    filed = (for_against or "").strip().title()
    direction = filed if filed in (SUPPORTING, OPPOSING) else DIRECTION_NOT_RECORDED
    return OutsideSpendingRow(
        spender=spender,
        spender_registration_number=spender_reg,
        spender_in_register=spender_reg is not None and spender_reg in in_register,
        spender_linkable=spender_reg is not None and spender_reg in linkable,
        about_committee_name=about_name,
        about_committee_registration_number=about_reg,
        about_committee_in_register=about_reg is not None and about_reg in in_register,
        about_committee_linkable=about_reg is not None and about_reg in linkable,
        direction=direction,
        direction_as_filed=for_against,
        purpose=_clean_text(purpose),
        vendor_name=_clean_text(vendor),
        expenditure_type=kind,
        in_kind=(in_kind or "").strip().lower() == "yes",
        paid_on=paid_on,
        year=int(year) if year is not None else None,
        amount=amount,
        unpaid_amount=unpaid,
        record_number=int(record_number),
    )


def _clean_text(value: Optional[str]) -> Optional[str]:
    """A blank cell is a missing value, so a page prints its own words for it."""
    if value is None or value.strip() == "":
        return None
    return value


__all__ = [
    "PAGE_SIZE",
    "SORT_LARGEST",
    "SORT_NEWEST",
    "ConfirmedMember",
    "OutsideSpendingFigures",
    "OutsideSpendingPage",
    "OutsideSpendingRow",
    "Subject",
    "UnknownSubject",
    "outside_spending",
]
