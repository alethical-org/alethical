"""The individual payments behind a committee's figures, reachable from either end.

Net: ``committee_finance.py`` answers "how much did this committee raise and spend".
This answers "who, exactly" -- and then the same question backwards: hand it one name
as the Board printed it and it returns every payment recorded under that string. It is
the data a clickable name needs ([#1331](https://github.com/alethical-org/alethical/issues/1331))
and it deliberately builds none of the clicking, which waits on
[#1329](https://github.com/alethical-org/alethical/issues/1329).

**Nothing here returns a total, and that is the design rather than an omission.** Every
figure a surface may print already exists in ``committee_finance.py``, sourced from
``campaign_finance_reader.py`` where the source's traps are enforced once. What this
module adds is rows: each with its own amount, its own date, its own label in the
source's own words, and the record number that traces it back to one line of one dated
download. A sum over a *name* would be worse than redundant -- it would be a claim about
a person assembled from one spelling, which §5 of
``docs/architecture/campaign-finance-system-design.md`` is explicit nobody may make.

Measurements below are against production release ``3f2bdf90`` on 12 Aug 2026. Counts
are evidence for the design, never assertions a test repeats (§8).

## Two kinds of name, and only one of them is joinable

**A registered filer joins by registration number.** Both directions use it: a
committee's own rows are found by its number, and where a row names the committee on the
*other* end, that number is what a surface follows.

**A person, an employer or a vendor has no identifier at all, so the printed string is
the whole of the key, matched exactly.** No trimming, no case folding, no initial
matching, no fuzzy anything. The live release is the argument: "Messinger, Alida" carries
121 rows to 39 committees, "Messinger, Alida R" 10 rows to 6, and
"Messinger, Alida Rockefelle" 4 rows to 1. A page for the first spelling is missing
$2,033,000.00 given under the other two, and it says so by returning only what one string
matched. Merging them is our guess, and the file punishes guessing: it also holds
"Messinger, William Frye" and "Messinger, Wiiiam Frey", which any rule loose enough to
join the Alidas would join to each other and to "Messinger, William F".

So a caller renders a name result as *what this spelling matched*, never as a person's
giving. 88,608 distinct contributor strings, 44,284 employer strings and 41,660 vendor
strings are in the live release, and nothing here knows how many people they are.

## The contributor registration number, which is a trap in two ways

85,764 of the 583,152 contribution rows carry one, and it is the honest way to link a
committee that gave money to another committee. Two things make reading it naively wrong.

**``'0'`` is not a number, it is a blank the file spells with a digit.** 621 distinct
contributor names share it across 1,227 rows and 7 different contributor types, from
"(Emily) Larson for Duluth" to "Ziton, Kim". A link on it merges 621 unrelated donors
into one page, so it is normalised to ``None`` here and never reaches a caller as an
identifier.

**A lobbyist's number belongs to a different register.** 912 distinct numbers arrive on
rows typed ``Lobbyist`` and **not one of them appears anywhere in this release as a
committee's registration number**, so resolving one as a committee would be a wrong link
rather than a dead one. The number is meaningful for the filer-shaped types --
``Political Committee/Fund`` 510 of 521, ``Party Unit`` 437 of 441,
``Candidate Committee`` 1,275 of 1,298 -- and meaningless for ``Individual`` (1 of 56).
Rather than trusting the type column to sort them, ``linkable_registration_numbers``
answers it by looking: a number is linkable when this release holds it as a filer. That
also covers the 341 committees reachable only as the target of someone else's independent
spending, 283 of which carry a negative number the Board assigns internally.

**And the name beside that number is not stable, unlike on the recipient side.** The
contributor column is free text a filer typed, so one committee arrives spelled several
ways: 15667 carries 7 names including "Dibble D Scott Senate Committee" and "Volunteers
for Dibble Campaign"; 18129 carries both "Stephenson, Zachary House Committee" and
"Stepenson (Zachary) for House". Each row keeps the name it was filed under and nothing
here elects a canonical one.

## What the employer column actually holds

Not employers, mostly. The 4 largest values in the live release are "Not Employed"
(67,342 rows), "Retired" (36,517), "Self employed Retired" (16,788) and "Lawyer" (9,276),
and 87,419 rows carry nothing at all. It is a free-text box a donor filled in, holding
occupations, statuses and workplaces without distinguishing them. So an employer result
is *payments whose donor typed this string*, which is what ``payments_from_donors_typing``
is named for, and no surface may present it as a company's giving or as a count of its
employees.

## The 2 expenditure files are never added together

A vendor is paid from both: the expenditures download and the independent-expenditures
download. They are 2 separate filings and this module returns them as 2 separately
sourced lists, because 491 independent-expenditure rows share a spender, vendor, amount
and date with an expenditure row, and 166 expenditure rows do the reverse. Whether those
are one payment filed twice or two payments that coincide is not established, and adding
the lists would resolve it by inventing money.

## Identical rows survive, and a record number is not an identity

A single download legitimately holds many rows with identical contents: 15,786
contribution rows are content-identical to at least one other, in 6,464 groups, and one
group has **119 identical rows** ($30.00 from "Zachary, Wivoda" to 20008 on 31 Aug 2019).
Nothing here deduplicates and nothing keys on a row's contents. A row is
``(snapshot_id, row_number)``, which §4.2 is explicit is **not** an identity across
downloads -- so ``record_number`` is a citation into one dated file and never a stable id
a caller may store.

Because of that, paging is honest only within one release, and ``release_id`` is returned
on every page so a caller can see when the ground moved under it.

## The 3 states, and the one that is nobody's zero

Same vocabulary as ``committee_finance.py``, imported rather than restated:

* ``reported`` -- we hold rows and they are listed.
* ``not_reported`` -- we hold none. **Never a zero.** Only donors passing $200 in
  aggregate for the calendar year are named at all, so absence on a committee is silence;
  and absence under a name means that exact spelling matched nothing, never that the
  person gave nothing.
* ``unavailable`` -- our own gap. Either the release's rows have been replaced out from
  under it, or the download does not reach the year asked for. The downloads cover 2015
  to 2026 while the routes accept later years, and a confident empty list for 2027 would
  report a finding about a year nobody has filed for.

The year decision is delegated to ``committee_finance`` rather than reimplemented, so
the 2 services cannot drift into disagreeing about what an absence means.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, Sequence
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.api.services import committee_finance
from alethical.api.services.committee_finance import NOT_REPORTED
from alethical.api.services.independent_spending import REPORTED, UNAVAILABLE
from alethical.db.schema import load_schema
from alethical.pipeline import campaign_finance_reader as reader

schema = load_schema()

Dataset = schema.CampaignFinanceDataset
Release = reader.Release
ReleaseNoLongerHeld = reader.ReleaseNoLongerHeld

#: What ``Contrib Reg Num`` holds when the Board did not identify the donor. Not a
#: registration number: 621 distinct contributor names share it across 1,227 rows and 7
#: contributor types, so a link on it merges 621 unrelated donors onto one page.
#: Normalised to ``None`` before a caller ever sees it.
UNIDENTIFIED_REGISTRATION_NUMBER = "0"

#: The most rows one request will list. A page asks again with a larger ``offset``, and
#: ``has_more`` says whether there is anything left, so no list is ever presented as
#: complete when it is not.
MAX_PAYMENTS = 200


@dataclass(frozen=True)
class ContributionPayment:
    """One record of the itemized-contributions download, standing on its own.

    Both ends are here, because which end is the counterparty depends on which way the
    caller came in: a committee page reads ``contributor``, a donor page reads
    ``recipient_name``.

    ``amount is None`` means the file states no amount, which happens on no row of the
    live release and is not a zero if it ever does. ``contributor_registration_number``
    is ``None`` both when the file states nothing and when it states
    ``UNIDENTIFIED_REGISTRATION_NUMBER``.
    """

    recipient_registration_number: Optional[str]
    recipient_name: Optional[str]
    recipient_type: Optional[str]
    contributor: Optional[str]
    contributor_registration_number: Optional[str]
    contributor_type: Optional[str]
    employer: Optional[str]
    amount: Optional[Decimal]
    received_on: Optional[date]
    year: Optional[int]
    receipt_type: Optional[str]
    in_kind: Optional[str]
    in_kind_description: Optional[str]
    record_number: int


@dataclass(frozen=True)
class ExpenditurePayment:
    """One record of the itemized-expenditures download, standing on its own.

    ``expenditure_type`` is the source's own ``Type`` and every value is listed. A
    candidate committee files ``Campaign Expenditure`` and a party unit files
    ``General Expenditure`` for the same thing, so nothing here filters on a label: in
    2025 candidate committees filed 6,781 rows the first way and none the second, and
    party units the reverse.

    ``affected_committee_registration_number`` is set only on the ``Contribution``-typed
    rows, which are the only ones naming another committee -- measured across all 377,860
    rows, every other label carries one on zero rows and names a *vendor* instead.

    ``amount`` is the filing's total column, not its paid column, and ``unpaid_amount``
    is carried beside it rather than netted off, which would invent a figure the filing
    does not state.
    """

    committee_registration_number: Optional[str]
    committee_name: Optional[str]
    vendor_name: Optional[str]
    vendor_city: Optional[str]
    vendor_state: Optional[str]
    affected_committee_name: Optional[str]
    affected_committee_registration_number: Optional[str]
    amount: Optional[Decimal]
    unpaid_amount: Optional[Decimal]
    paid_on: Optional[date]
    year: Optional[int]
    expenditure_type: Optional[str]
    purpose: Optional[str]
    in_kind: Optional[str]
    in_kind_description: Optional[str]
    record_number: int


@dataclass(frozen=True)
class IndependentPayment:
    """One record of the itemized-independent-expenditures download.

    A third payment shape because it names 3 parties rather than 2: who spent, which
    committee it was about, and which vendor was paid. ``stance`` is the file's own
    ``For /Against`` value and is never inferred; none of the 41,130 rows in the live
    release is blank.

    This is not a chain. That a spender paid a vendor and that the spending was about a
    committee are 2 facts on one row; nothing here relates this row to any other, and
    nothing may be added that does (``.claude/rules/grounded-answers.md`` rule 12).
    """

    spender: Optional[str]
    spender_registration_number: Optional[str]
    affected_committee_name: Optional[str]
    affected_committee_registration_number: Optional[str]
    stance: Optional[str]
    vendor_name: Optional[str]
    amount: Optional[Decimal]
    unpaid_amount: Optional[Decimal]
    paid_on: Optional[date]
    year: Optional[int]
    expenditure_type: Optional[str]
    purpose: Optional[str]
    record_number: int


@dataclass(frozen=True)
class PaymentPage:
    """One block of payments: what was found, where it came from, and what it is missing.

    ``state`` decides whether ``payments`` may be read as an answer at all, and the
    3 values are the 3 different facts an empty list can be (see this module's
    docstring). A caller must read it first.

    ``has_more`` exists so no surface can present a truncated list as complete, which is
    the same failure ``.claude/rules/grounded-answers.md`` rule 11 forbids of a generated
    answer. ``matched_payments`` is deliberately absent: counting every row under a
    donor's name means scanning for it, and a count is the one number a page would print
    largest and trust most.

    ``linkable_registration_numbers`` are the counterparty numbers on this page that this
    release holds as a filer of its own. Only those may be rendered as links: 912
    lobbyist numbers arrive on contribution rows and none of them is a committee, so a
    surface linking every number it is handed would produce wrong links rather than dead
    ones.

    ``release_id`` and ``fetched_at`` come from the one release resolved for the whole
    request. ``fetched_at`` is the day we downloaded the file and is **never** the period
    the payments cover -- that is per payment, and each one carries its own date (§7).
    """

    state: str
    payments: tuple[ContributionPayment | ExpenditurePayment | IndependentPayment, ...]
    has_more: bool
    limit: int
    offset: int
    linkable_registration_numbers: frozenset[str]
    dataset: Dataset
    source_url: Optional[str]
    release_id: UUID
    fetched_at: Optional[datetime]


def _clean_registration_number(value: Optional[str]) -> Optional[str]:
    """Drop the file's digit-spelled blank, so it can never be read as an identifier."""
    if value is None or value == UNIDENTIFIED_REGISTRATION_NUMBER:
        return None
    return value


def _empty_state(
    db: Session, release: Release, dataset: Dataset, year: Optional[int]
) -> str:
    """What an empty list means: our staleness, our coverage, or the record's silence.

    Order matters. Staleness is checked first, because a release whose rows were replaced
    twice holds nothing for *any* year, and asking "does the download cover 2025" of a
    pruned snapshot answers a question about data that is gone.

    With a year, the coverage decision is ``committee_finance``'s, called rather than
    copied: 2 services disagreeing about whether an absence is the committee's silence or
    our missing year is exactly the drift that puts a confident zero on one page and a
    caveat on another.
    """
    reader._refuse_if_rows_are_gone(db, release, dataset)
    if year is None:
        return NOT_REPORTED
    return committee_finance._empty_state(db, release, dataset, year)


def linkable_committees(
    db: Session, release: Release, registration_numbers: Sequence[str]
) -> frozenset[str]:
    """Which of these numbers this release holds as a filer, so a surface links only those.

    Two index-backed lookups rather than the whole filer set, and deliberately a check
    against the rows we hold rather than against the contributor-type column: a row typed
    ``Political Committee/Fund`` still carries a number that resolves nowhere on 11 of
    521, and a row typed ``Lobbyist`` carries one that resolves nowhere on all 912.

    The independent-expenditures file is not consulted, because a committee reachable
    only there has no money of its own to show. ``committee_finance.find_committee`` does
    read it, which is right for a page keyed on a number somebody typed into a URL and
    wrong for deciding whether to offer a link.
    """
    wanted = sorted({number for number in registration_numbers if number})
    if not wanted:
        return frozenset()
    rows = db.execute(
        text(
            "SELECT DISTINCT recipient_reg_num FROM cf_contribution_row "
            " WHERE snapshot_id = :contributions "
            "   AND recipient_reg_num = ANY(:numbers) "
            " UNION "
            "SELECT DISTINCT committee_reg_num FROM cf_expenditure_row "
            " WHERE snapshot_id = :expenditures "
            "   AND committee_reg_num = ANY(:numbers)"
        ),
        {
            "contributions": release.contributions.snapshot_id,
            "expenditures": release.expenditures.snapshot_id,
            "numbers": wanted,
        },
    ).all()
    return frozenset(number for (number,) in rows)


def _page(
    *,
    state: str,
    payments: tuple,
    has_more: bool,
    limit: int,
    offset: int,
    linkable: frozenset[str],
    release: Release,
    dataset: Dataset,
) -> PaymentPage:
    return PaymentPage(
        state=state,
        payments=payments,
        has_more=has_more,
        limit=limit,
        offset=offset,
        linkable_registration_numbers=linkable,
        dataset=dataset,
        source_url=release.file_for(dataset).source_url,
        release_id=release.id,
        fetched_at=release.fetched_at,
    )


def _unavailable(
    release: Release, dataset: Dataset, *, limit: int, offset: int
) -> PaymentPage:
    """A refusal, not an answer. Carries no rows and no figure of any kind."""
    return _page(
        state=UNAVAILABLE,
        payments=(),
        has_more=False,
        limit=limit,
        offset=offset,
        linkable=frozenset(),
        release=release,
        dataset=dataset,
    )


def _fetch(
    db: Session,
    *,
    columns: str,
    table: str,
    key_column: str,
    key_value: str,
    date_column: str,
    snapshot_id: UUID,
    year: Optional[int],
    limit: int,
    offset: int,
) -> tuple[list, bool]:
    """One page of rows, newest first, plus whether anything is left after it.

    ``limit + 1`` rows are asked for so ``has_more`` is measured rather than guessed.
    The order is the row's own date and then its record number, which is unique within a
    snapshot, so paging cannot repeat or skip a row -- and it must not be the row's
    contents, of which 15,786 contribution rows share theirs with another row.

    ``year`` filters on the file's own ``Year`` column, which is a separate claim from
    the date and disagrees with it on 702 rows across the 3 files. A filing is scoped by
    ``Year``, so that is the one to use.

    ``table``, ``columns`` and the 2 column names are this module's own constants; only
    ``key_value`` and ``year`` come from a caller, and both are bound parameters, so a
    name holding a quote or a comma is matched rather than interpreted.
    """
    clause = "" if year is None else " AND year = :year"
    params: dict[str, object] = {
        "snapshot": snapshot_id,
        "key": key_value,
        "limit": limit + 1,
        "offset": offset,
    }
    if year is not None:
        params["year"] = year
    rows = db.execute(
        text(
            f"SELECT {columns} FROM {table} "
            f" WHERE snapshot_id = :snapshot AND {key_column} = :key{clause} "
            f" ORDER BY {date_column} DESC NULLS LAST, row_number DESC "
            f" LIMIT :limit OFFSET :offset"
        ),
        params,
    ).all()
    return list(rows[:limit]), len(rows) > limit


# --- One driver over 3 downloads ---------------------------------------------
#
# The scaffolding is shared deliberately rather than written once per download. Its
# subtlety is the order inside `_empty_state` -- staleness before coverage -- and 3 copies
# of that is 3 places for it to drift, where only one would get fixed.


def _contribution_from_row(row) -> ContributionPayment:
    return ContributionPayment(
        recipient_registration_number=row[0],
        recipient_name=row[1],
        recipient_type=row[2],
        contributor=row[3],
        contributor_registration_number=_clean_registration_number(row[4]),
        contributor_type=row[5],
        employer=row[6],
        amount=row[7],
        received_on=row[8],
        year=int(row[9]) if row[9] is not None else None,
        receipt_type=row[10],
        in_kind=row[11],
        in_kind_description=row[12],
        record_number=int(row[13]),
    )


def _expenditure_from_row(row) -> ExpenditurePayment:
    return ExpenditurePayment(
        committee_registration_number=row[0],
        committee_name=row[1],
        vendor_name=row[2],
        vendor_city=row[3],
        vendor_state=row[4],
        affected_committee_name=row[5],
        affected_committee_registration_number=_clean_registration_number(row[6]),
        amount=row[7],
        unpaid_amount=row[8],
        paid_on=row[9],
        year=int(row[10]) if row[10] is not None else None,
        expenditure_type=row[11],
        purpose=row[12],
        in_kind=row[13],
        in_kind_description=row[14],
        record_number=int(row[15]),
    )


def _independent_from_row(row) -> IndependentPayment:
    return IndependentPayment(
        spender=row[0],
        spender_registration_number=row[1],
        affected_committee_name=row[2],
        affected_committee_registration_number=_clean_registration_number(row[3]),
        stance=row[4],
        vendor_name=row[5],
        amount=row[6],
        unpaid_amount=row[7],
        paid_on=row[8],
        year=int(row[9]) if row[9] is not None else None,
        expenditure_type=row[10],
        purpose=row[11],
        record_number=int(row[12]),
    )


@dataclass(frozen=True)
class _Download:
    """Which download a lookup reads, and how to turn one of its rows into a payment.

    ``columns`` is this module's own constant and mirrors the download's own column order,
    which is what the row-building functions above index into. A column added here without
    being added there shifts every field after it, which is why the 2 sit side by side.
    """

    dataset: Dataset
    table: str
    columns: str
    date_column: str
    build: object


_CONTRIBUTIONS = _Download(
    dataset=Dataset.contributions,
    table="cf_contribution_row",
    columns=(
        "recipient_reg_num, recipient, recipient_type, contributor, contrib_reg_num, "
        "contrib_type, contrib_employer_name, amount, receipt_date, year, receipt_type, "
        "in_kind, in_kind_descr, row_number"
    ),
    date_column="receipt_date",
    build=_contribution_from_row,
)

_EXPENDITURES = _Download(
    dataset=Dataset.expenditures,
    table="cf_expenditure_row",
    columns=(
        "committee_reg_num, committee_name, vendor_name, vendor_city, vendor_state, "
        "affected_committee_name, affected_committee_reg_num, amount, unpaid_amount, "
        "transaction_date, year, type, purpose, in_kind, in_kind_descr, row_number"
    ),
    date_column="transaction_date",
    build=_expenditure_from_row,
)

_INDEPENDENT = _Download(
    dataset=Dataset.independent_expenditures,
    table="cf_independent_expenditure_row",
    columns=(
        "spender, spender_reg_num, affected_committee_name, affected_committee_reg_num, "
        "for_against, vendor_name, amount, unpaid_amount, transaction_date, year, type, "
        "purpose, row_number"
    ),
    date_column="transaction_date",
    build=_independent_from_row,
)


def _numbers(payments: tuple, attributes: Sequence[str]) -> list[str]:
    """The registration numbers these payments carry under the named fields."""
    return [
        number
        for payment in payments
        for number in (getattr(payment, attribute) for attribute in attributes)
        if number
    ]


def _payments(
    db: Session,
    release: Release,
    download: _Download,
    *,
    key_column: str,
    key_value: str,
    year: Optional[int],
    limit: int,
    offset: int,
    numbers_that_are_filers_here: Sequence[str] = (),
    numbers_to_check: Sequence[str] = (),
) -> PaymentPage:
    """One page of one download's rows, found by one column, with no figure computed.

    Nothing is filtered by the source's own labels. Every ``Receipt type`` and every
    expenditure ``Type`` is listed and each row carries its own, because those filters
    exist to keep a *total* honest and there is no total here -- dropping a label would
    instead lose real money the Board published from a list of what the record says.

    The 2 number arguments are the fields whose registration numbers a surface might
    follow, and they are separate because the claims differ in strength.
    ``numbers_that_are_filers_here`` are filers by construction: these rows *are* those
    committees' own filings, so no lookup is needed and stating it beats an empty set a
    reader would misread as "nothing is linkable". ``numbers_to_check`` arrive on somebody
    else's filing, where a number can be a lobbyist's or a local candidate's, so each one
    is resolved against the filers we hold.
    """
    dataset = download.dataset
    try:
        rows, has_more = _fetch(
            db,
            columns=download.columns,
            table=download.table,
            key_column=key_column,
            key_value=key_value,
            date_column=download.date_column,
            snapshot_id=release.file_for(dataset).snapshot_id,
            year=year,
            limit=limit,
            offset=offset,
        )
        if not rows:
            return _page(
                state=_empty_state(db, release, dataset, year),
                payments=(),
                has_more=False,
                limit=limit,
                offset=offset,
                linkable=frozenset(),
                release=release,
                dataset=dataset,
            )
    except ReleaseNoLongerHeld:
        return _unavailable(release, dataset, limit=limit, offset=offset)

    payments = tuple(download.build(row) for row in rows)
    return _page(
        state=REPORTED,
        payments=payments,
        has_more=has_more,
        limit=limit,
        offset=offset,
        linkable=frozenset(_numbers(payments, numbers_that_are_filers_here))
        | linkable_committees(db, release, _numbers(payments, numbers_to_check)),
        release=release,
        dataset=dataset,
    )


# --- One committee, both directions ------------------------------------------


def payments_received(
    db: Session,
    release: Release,
    *,
    registration_number: str,
    year: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
) -> PaymentPage:
    """Who paid this committee, one row each, from the committee's own filing.

    The counterparty is ``contributor``, and ``linkable_registration_numbers`` says which
    of the numbers beside those names this release holds as a committee -- so a surface
    links the party unit that gave and leaves the lobbyist and the individual as plain
    text, which is what §5 requires and what the measurements in this module's docstring
    make necessary.
    """
    return _payments(
        db,
        release,
        _CONTRIBUTIONS,
        key_column="recipient_reg_num",
        key_value=registration_number,
        year=year,
        limit=limit,
        offset=offset,
        numbers_to_check=("contributor_registration_number",),
    )


def payments_made(
    db: Session,
    release: Release,
    *,
    registration_number: str,
    year: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
) -> PaymentPage:
    """Who this committee paid, one row each, every ``Type`` included.

    Most rows name a vendor, which is a supplier rather than a recipient of a transfer;
    the ``Contribution``-typed rows name another committee instead and carry its
    registration number. Both are here because both are money out, and the row's own
    ``expenditure_type`` is what tells them apart.
    """
    return _payments(
        db,
        release,
        _EXPENDITURES,
        key_column="committee_reg_num",
        key_value=registration_number,
        year=year,
        limit=limit,
        offset=offset,
        numbers_to_check=("affected_committee_registration_number",),
    )


def independent_payments_about(
    db: Session,
    release: Release,
    *,
    registration_number: str,
    year: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
) -> PaymentPage:
    """Independent spending filed about this committee, one row each.

    Money nobody in this committee reported, because it did not pass through it. The
    honest counterparty here is the *spender*, and the row says whether the spending was
    for or against -- never why, which no filing states.

    This is the one direction where a committee with no rows is close to a finding rather
    than to silence, and saying which is ``committee_finance.independent_spending_about``'s
    job; this returns the rows behind whatever that reports.
    """
    return _payments(
        db,
        release,
        _INDEPENDENT,
        key_column="affected_committee_reg_num",
        key_value=registration_number,
        year=year,
        limit=limit,
        offset=offset,
        numbers_to_check=(
            "spender_registration_number",
            "affected_committee_registration_number",
        ),
    )


# --- One printed name, which is never a person -------------------------------


def payments_from_contributor(
    db: Session,
    release: Release,
    *,
    contributor: str,
    year: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
) -> PaymentPage:
    """Every payment recorded under exactly this contributor string.

    Exactly: the string as the Board printed it, matched character for character. A
    caller labels the result with the string it asked for and never with a person's name,
    because the release holds "Messinger, Alida", "Messinger, Alida R" and "Messinger,
    Alida Rockefelle" as 3 separate strings and nothing here knows how many people that
    is.

    Every committee the string paid is on these rows, in ``recipient_name`` and
    ``recipient_registration_number``, and each of those numbers is linkable because
    these are those committees' own filings.
    """
    return _payments(
        db,
        release,
        _CONTRIBUTIONS,
        key_column="contributor",
        key_value=contributor,
        year=year,
        limit=limit,
        offset=offset,
        numbers_that_are_filers_here=("recipient_registration_number",),
    )


def payments_to_vendor(
    db: Session,
    release: Release,
    *,
    vendor: str,
    year: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
) -> PaymentPage:
    """Every committee payment recorded under exactly this vendor string.

    From the expenditures download only. The independent-expenditures download names
    vendors too and ``independent_payments_to_vendor`` returns those separately, because
    491 of its rows share a spender, vendor, amount and date with an expenditure row and
    adding the 2 lists would decide, without evidence, that those are 2 payments.
    """
    return _payments(
        db,
        release,
        _EXPENDITURES,
        key_column="vendor_name",
        key_value=vendor,
        year=year,
        limit=limit,
        offset=offset,
        numbers_that_are_filers_here=("committee_registration_number",),
    )


def independent_payments_to_vendor(
    db: Session,
    release: Release,
    *,
    vendor: str,
    year: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
) -> PaymentPage:
    """Every independent-expenditure payment recorded under exactly this vendor string."""
    return _payments(
        db,
        release,
        _INDEPENDENT,
        key_column="vendor_name",
        key_value=vendor,
        year=year,
        limit=limit,
        offset=offset,
        numbers_to_check=(
            "spender_registration_number",
            "affected_committee_registration_number",
        ),
    )


def payments_from_donors_typing(
    db: Session,
    release: Release,
    *,
    employer: str,
    year: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
) -> PaymentPage:
    """Every payment whose donor typed exactly this string in the employer box.

    Named for what it is, because the obvious name would be a claim. The column is free
    text a donor filled in and its 4 commonest values in the live release are "Not
    Employed", "Retired", "Self employed Retired" and "Lawyer" -- statuses and
    occupations, not employers -- so this is never a company's giving and never a count
    of anybody's employees. 87,419 rows carry nothing here at all, which is why an empty
    result says only that no row carries this exact string.
    """
    return _payments(
        db,
        release,
        _CONTRIBUTIONS,
        key_column="contrib_employer_name",
        key_value=employer,
        year=year,
        limit=limit,
        offset=offset,
        numbers_that_are_filers_here=("recipient_registration_number",),
    )


__all__ = [
    "MAX_PAYMENTS",
    "NOT_REPORTED",
    "REPORTED",
    "UNAVAILABLE",
    "UNIDENTIFIED_REGISTRATION_NUMBER",
    "ContributionPayment",
    "ExpenditurePayment",
    "IndependentPayment",
    "PaymentPage",
    "ReleaseNoLongerHeld",
    "independent_payments_about",
    "independent_payments_to_vendor",
    "linkable_committees",
    "payments_from_contributor",
    "payments_from_donors_typing",
    "payments_made",
    "payments_received",
    "payments_to_vendor",
]
