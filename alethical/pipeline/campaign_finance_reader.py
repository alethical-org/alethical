"""Read one published campaign-finance release, with the source's traps enforced here.

Net: this is the read half of ``campaign_finance.py``, which writes. It answers "what
money did this registered filer take in and pay out" for the state parties, the
caucuses, and any other filer, and it enforces in code the handful of source
behaviours that make a naive query quietly wrong. It lives beside its writer so both
halves of what we know about this source sit in one directory.

**Two numbers, and neither one substitutes for the other.** ``money_in`` returns the
sum of the itemized rows the Board published, which is never a filer's true total:
Minnesota names a donor only once their giving passes $200 in aggregate within the
calendar year (Minnesota Statutes 10A.20 subd. 3(c)), and everything below that
reaches us as one unnamed lump. The filer's own reported figure is a different number
and comes from a different source, now stored by
[#1408](https://github.com/alethical-org/alethical/issues/1408) and served here by
``reported_contributions``. ``.claude/rules/grounded-answers.md`` rule 12 requires
**both** on any surface that shows either, because the gap between them is legitimate
small-donor money rather than an error or a hole in our data, and #1408 measured it at
roughly 4 dollars in every 10. A page printing only the itemized sum understates every
committee by about that much while looking authoritative.

The four source behaviours this module exists to stop a caller getting wrong, each
one measured against the live release on 12 Aug 2026:

1. **A candidate committee and a party unit label the same spending differently, so
   no query may filter on one expenditure ``Type``.** In 2025, candidate committees
   filed 6,762 rows typed ``Campaign Expenditure`` and **none** typed
   ``General Expenditure``; party units filed 7,524 the other way round and none the
   first way. Filtering on either label alone drops a whole kind of filer in silence.
   ``money_out`` therefore returns one bucket per label present and never accepts a
   label to filter on.

2. **1.2% of the rows in the file called "itemized contributions" are not
   contributions, and the share is heaviest exactly on these filers.** 2025 rows that
   are not ``Contribution``: candidate committees 0.36%, party units 6.57%. So
   ``money_in`` filters to ``Receipt type = 'Contribution'`` before it sums anything,
   and returns every other receipt type as its own bucket rather than dropping it —
   for the 2 major state parties and the 4 caucuses across 2025 and 2026 that is 731 rows and
   $520,187.72 of money the Board published, which must not simply vanish.

3. **Only a ``Contribution`` row names who received the money. Nothing else does.**
   Measured across all 377,860 expenditure rows: ``Contribution`` carries an affected
   committee registration number on 61,816 of its 61,840 rows, and every other label
   carries one on **zero** rows — ``General Expenditure`` 148,735 rows, 0;
   ``Campaign Expenditure`` 129,237, 0; ``Non-Campaign Disbursement`` 35,844, 0;
   ``Ballot Question Expenditure`` 1,274, 0; ``Other Disbursement`` 930, 0. What those
   rows carry instead is a *vendor*, which is a supplier and not a recipient of a
   transfer. So ``transfers_from`` reads the ``Contribution`` rows only, and a
   surface that puts a "who received this" column beside ``money_out`` would leave it
   blank on 92.5% of these filers' outgoing rows.

4. **A filer's kind comes from the file's own type column, never from its
   registration number.** 4,672 rows carry a type that contradicts their number's
   band, and the Libertarian Party of Minnesota is registration 40858 with type
   ``PTU`` (§5, Identity). ``party_units_and_caucuses`` reads the subtype column.

**Where this module ends and `alethical/api/services/independent_spending.py` begins,
because they overlap and the boundary is a product rule rather than a tidiness
preference.** That module answers "what was spent for and against *this legislator*"
and reaches its figures only through a committee link a person has confirmed, because
every row in the source names a committee and none names a person, so matching by name
would put a city mayoral race on a state senator's profile — its own docstring records
the live case, 10 separate "Fateh, Omar for Minneapolis Mayor" committees in 2025 while
Senator Fateh's own Senate committee has had no independent spending since 2022.

This module is keyed on a registration number and needs no such link, and the reason is
not that the rule is relaxed here: **for a party unit or a caucus the registration
number is the organisation.** There is no person to misattribute money to and no
identity to confirm, so §5's human-confirmation requirement has nothing to attach to.
Anything scoped to a *legislator* belongs in that module and must not be rebuilt here.

**Separate transfers, never a chain.** Nothing here joins one transfer to another, and
nothing may be added that does. That a party paid a caucus and the caucus later paid a
candidate are two documented facts; that the same dollars travelled between them is
not a fact and no filing establishes it, because money is fungible and once it lands
in an account no record says which dollar went out
(``.claude/rules/grounded-answers.md`` rule 12).

**A release id is resolved once and used for every read.** ``live_release`` resolves
the pointer, the release and its 3 snapshots in a single statement, because each
statement sees the newest committed state and re-resolving per query can hand back a
mixed set. The rows of a superseded release survive exactly one further publish, so a
read that returns nothing might mean the release has been pruned rather than that the
filer has no money — which a page renders as "this committee has no payments", the
missing-versus-zero failure rule 12 forbids. Every read below therefore checks the
release still holds rows before it reports an empty result, and raises
``ReleaseNoLongerHeld`` instead of handing back a zero.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Iterable, Optional, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.db import models as schema

Dataset = schema.CampaignFinanceDataset

# The Board's own subtype values. `SPU` is a state party unit and `CAU` is a
# legislative caucus committee; measured on the live release, `CAU` is exactly 4
# filers (DFL House Caucus 20006, DFL Senate Caucus 20011, HRCC 20010, Senate
# Victory Fund 20013) and `SPU` is 6 (MN DFL State Central 20003, Republican Party
# of Minn 20008, Libertarian Party of Minn 40858, Forward Independence 20711,
# Grassroots-Legalize Cannabis 20839, Legal Marijuana Now 20905).
#
# Read from the source rather than pinned as a list of 6 numbers on purpose: a
# stored list goes stale the moment a party registers or terminates, and the file
# already carries the Board's own answer. The names are not a substitute either —
# 12 filers whose names contain "Caucus" are political committees and funds rather
# than caucuses ("DFL Senior Caucus" 40993, "Republican Liberty Caucus of Minn"
# 41012), so a name match would pull in 12 wrong filers.
STATE_PARTY_UNIT = "SPU"
CAUCUS_COMMITTEE = "CAU"

CONTRIBUTION_RECEIPT = "Contribution"
# The one expenditure label that names a payee. See behaviour 3 above.
TRANSFER_EXPENDITURE_TYPE = "Contribution"


class ReleaseNoLongerHeld(RuntimeError):
    """The release resolved earlier no longer holds rows, so no answer is possible.

    Raised rather than returning an empty result, because "0 payments" and "the set
    we were reading has been replaced twice" are different facts about a named
    person or organisation and only one of them is safe to print.
    """


# --- Which release, and where its rows came from -----------------------------


@dataclass(frozen=True)
class SourceFile:
    """One dated download: the citation every row in it shares.

    Minnesota publishes no per-transaction identifier and no per-transaction page,
    so the honest source for a single payment is "record N of the file we
    downloaded from this address", which is what ``snapshot_id`` plus a row's
    ``row_number`` names. ``row_count`` is what the snapshot recorded at publish
    time, so a caller can tell "this filer has no rows" from "this file has no
    rows".
    """

    dataset: Dataset
    snapshot_id: uuid.UUID
    source_url: str
    row_count: int


@dataclass(frozen=True)
class Release:
    """The set of 3 files published together, resolved once for a whole request."""

    id: uuid.UUID
    # The page's freshness date (#861). It is the date the files were fetched, and
    # it is never the period a figure covers: the period is per filer and always
    # earlier (§7). Normalized to UTC, because the driver can hand a `timestamptz`
    # back in the session's own timezone and this instant is a date a page prints —
    # so an unnormalized value can tell a reader the money was fetched on the wrong
    # day (found by the #1332 session, `alethical/api/services/independent_spending.py`).
    fetched_at: datetime
    contributions: SourceFile
    expenditures: SourceFile
    independent_expenditures: SourceFile

    def file_for(self, dataset: Dataset) -> SourceFile:
        return {
            Dataset.contributions: self.contributions,
            Dataset.expenditures: self.expenditures,
            Dataset.independent_expenditures: self.independent_expenditures,
        }[dataset]


_LIVE_RELEASE_SQL = text(
    """
    SELECT r.id,
           r.fetch_completed_at,
           c.id, c.source_url, c.row_count, c.status,
           e.id, e.source_url, e.row_count, e.status,
           i.id, i.source_url, i.row_count, i.status
      FROM cf_current_release p
      JOIN cf_release r ON r.id = p.release_id
      JOIN cf_snapshot c ON c.id = r.contributions_snapshot_id
      JOIN cf_snapshot e ON e.id = r.expenditures_snapshot_id
      JOIN cf_snapshot i ON i.id = r.independent_expenditures_snapshot_id
     WHERE p.id = true
    """
)


def live_release(db: Session) -> Optional[Release]:
    """Resolve the published release and its 3 snapshots in one statement.

    One statement because each statement in a Read Committed transaction sees the
    newest committed state, so resolving the pointer and then the snapshots in
    separate statements can straddle a publish and return a mixed set. Callers pass
    the returned object to every read below rather than re-resolving.

    Returns ``None`` when nothing is published, which is a real state on a fresh
    database and is not the same as a release whose rows have gone.
    """
    row = db.execute(_LIVE_RELEASE_SQL).one_or_none()
    if row is None:
        return None
    (
        release_id,
        fetched_at,
        contributions_id,
        contributions_url,
        contributions_rows,
        contributions_status,
        expenditures_id,
        expenditures_url,
        expenditures_rows,
        expenditures_status,
        independent_id,
        independent_url,
        independent_rows,
        independent_status,
    ) = row
    statuses = (contributions_status, expenditures_status, independent_status)
    loaded = schema.CampaignFinanceSnapshotStatus.loaded
    if any(status != loaded and status != loaded.value for status in statuses):
        # A published release naming a snapshot that is not `loaded` means its rows
        # were pruned under it. Refusing beats reading rows that may be half gone.
        raise ReleaseNoLongerHeld(
            f"release {release_id} names a snapshot that is no longer loaded "
            f"(statuses {statuses}). Re-resolve the live release."
        )
    return Release(
        id=release_id,
        fetched_at=fetched_at.astimezone(UTC) if fetched_at is not None else fetched_at,
        contributions=SourceFile(
            Dataset.contributions,
            contributions_id,
            contributions_url,
            contributions_rows or 0,
        ),
        expenditures=SourceFile(
            Dataset.expenditures,
            expenditures_id,
            expenditures_url,
            expenditures_rows or 0,
        ),
        independent_expenditures=SourceFile(
            Dataset.independent_expenditures,
            independent_id,
            independent_url,
            independent_rows or 0,
        ),
    )


def _refuse_if_rows_are_gone(db: Session, release: Release, dataset: Dataset) -> None:
    """Turn an empty result into a refusal when the release's rows have been pruned.

    Called only when a read found nothing, so the ordinary path pays for it never.
    One index-backed ``EXISTS``, because the alternative — letting the caller decide
    — is exactly the missing-versus-zero failure this module is meant to remove from
    every surface at once rather than once per surface.
    """
    source = release.file_for(dataset)
    if source.row_count == 0:
        return
    table = {
        Dataset.contributions: "cf_contribution_row",
        Dataset.expenditures: "cf_expenditure_row",
        Dataset.independent_expenditures: "cf_independent_expenditure_row",
    }[dataset]
    present = db.execute(
        text(f"SELECT 1 FROM {table} WHERE snapshot_id = :s LIMIT 1"),
        {"s": source.snapshot_id},
    ).one_or_none()
    if present is None:
        raise ReleaseNoLongerHeld(
            f"release {release.id} published {source.row_count:,} "
            f"{dataset.value} rows and none are present now, so this set has been "
            "replaced. Re-resolve the live release rather than reporting a zero."
        )


# --- Who the parties and the caucuses are ------------------------------------


@dataclass(frozen=True)
class Filer:
    """A registered filer as one release describes it.

    ``name``, ``kind`` and ``subkind`` are what the Board publishes against this
    number *in this download*. The Board prints a committee's current name and
    classification against the whole of its history, so a filer that has been
    renamed or reclassified shows its current values on rows from every year
    (§5.1). The registration number is the identity; these three are evidence.
    """

    reg_num: str
    name: str
    kind: str
    subkind: Optional[str]
    first_year: Optional[int]
    last_year: Optional[int]

    @property
    def is_caucus(self) -> bool:
        return self.subkind == CAUCUS_COMMITTEE

    @property
    def is_state_party(self) -> bool:
        return self.subkind == STATE_PARTY_UNIT


_FILERS_BY_SUBKIND_SQL = text(
    """
    SELECT reg_num, min(name), kind, subkind, min(first_year), max(last_year)
      FROM (
        SELECT recipient_reg_num AS reg_num,
               min(recipient)    AS name,
               recipient_type    AS kind,
               recipient_subtype AS subkind,
               min(year)         AS first_year,
               max(year)         AS last_year
          FROM cf_contribution_row
         WHERE snapshot_id = :contributions
           AND recipient_subtype = ANY(:subkinds)
           AND recipient_reg_num IS NOT NULL
         GROUP BY recipient_reg_num, recipient_type, recipient_subtype
        UNION ALL
        SELECT committee_reg_num,
               min(committee_name),
               entity_type,
               entity_sub_type,
               min(year),
               max(year)
          FROM cf_expenditure_row
         WHERE snapshot_id = :expenditures
           AND entity_sub_type = ANY(:subkinds)
           AND committee_reg_num IS NOT NULL
         GROUP BY committee_reg_num, entity_type, entity_sub_type
      ) in_either_file
     GROUP BY reg_num, kind, subkind
     ORDER BY subkind, reg_num
    """
)


def party_units_and_caucuses(
    db: Session,
    release: Release,
    subkinds: Sequence[str] = (STATE_PARTY_UNIT, CAUCUS_COMMITTEE),
) -> list[Filer]:
    """Every state party unit and legislative caucus in this release, from the file.

    A union across the money-in and money-out files, because a filer that only
    raised or only spent in the covered years appears in one of them and not the
    other, and dropping either would silently shorten the list.

    Measured on the live release 12 Aug 2026: 4 caucuses and 6 state party units,
    and the classification never contradicts itself — 0 registration numbers carry
    2 different subtypes within either file, 0 disagree between the 2 files, and 0
    rows for any of the 4 caucuses or the 2 major state parties carry a null subtype. That is consistency *within
    one download*, not proof the Board never reclassifies a filer between downloads;
    a later release showing a different subtype for the same number is a thing to
    notice, not a contradiction (§5.1's rule for names, which applies here for the
    same reason).
    """
    rows = db.execute(
        _FILERS_BY_SUBKIND_SQL,
        {
            "contributions": release.contributions.snapshot_id,
            "expenditures": release.expenditures.snapshot_id,
            "subkinds": list(subkinds),
        },
    ).all()
    return [
        Filer(
            reg_num=reg_num,
            name=name,
            kind=kind,
            subkind=subkind,
            first_year=first_year,
            last_year=last_year,
        )
        for reg_num, name, kind, subkind, first_year, last_year in rows
    ]


# --- Money in and money out --------------------------------------------------


@dataclass(frozen=True)
class Bucket:
    """One of the source's own labels, with its rows and their sum.

    A label keeps its own line rather than being folded into a total, because
    folding is how a whole kind of filer disappears: filtering to
    ``Campaign Expenditure`` drops every party unit, and filtering to
    ``General Expenditure`` drops every candidate committee.
    """

    label: str
    rows: int
    total: Decimal
    # How many of `rows` carry no amount at all. `sum` skips a row with a null
    # amount while `count(*)` still counts it, so a bucket of blanks reports a total
    # of 0 over a positive row count -- an invented zero -- and one blank beside a
    # real payment reports an understated total as though it were whole. Both are the
    # missing-versus-zero failure `.claude/rules/grounded-answers.md` rule 12 forbids,
    # so the count is carried here and a caller withholds the figure rather than
    # printing it (#1442).
    #
    # 0 for every row of the live release: all 583,152 contribution rows and 377,860
    # expenditure rows state an amount. The column is nullable and the loader stores a
    # blank as null rather than inventing a value, so one blank cell in a future
    # download is enough to make this matter.
    rows_missing_an_amount: int = 0


@dataclass(frozen=True)
class MoneyIn:
    """One filer's reported receipts for one year, as this release holds them.

    ``contributions`` is the only bucket that belongs in a contribution figure.
    ``other_receipts`` is everything else the file carries under this filer —
    ``Miscellaneous``, ``Miscellaneous Income``, ``Loan Payable`` — which the filing
    reports on separate schedules and outside its contribution totals. It is
    returned rather than dropped so a caller can say what it excluded instead of
    losing money the Board published.
    """

    reg_num: str
    year: int
    contributions: Bucket
    other_receipts: tuple[Bucket, ...]


@dataclass(frozen=True)
class MoneyOut:
    """One filer's reported spending for one year, split by the source's own labels.

    There is no single total worth naming here, because the labels mean different
    things: a ``Contribution`` is money handed to another committee and a
    ``General Expenditure`` is money spent on goods and services. ``by_label`` keeps
    them apart. ``rows`` and ``total`` are provided for a caller that genuinely
    wants everything the filer paid out, and both are honest only when described as
    every reported payment rather than as a category.
    """

    reg_num: str
    year: int
    by_label: tuple[Bucket, ...]

    @property
    def rows(self) -> int:
        return sum(bucket.rows for bucket in self.by_label)

    @property
    def total(self) -> Decimal:
        return sum((bucket.total for bucket in self.by_label), Decimal("0"))


def _year_clause(years: Optional[Iterable[int]]) -> tuple[str, list[int]]:
    """Group and filter on the file's own ``Year`` column, not on the row's date.

    They are separate claims and disagree on 702 rows across the 3 files (§2.1).
    ``Year`` is the one to use because it is the filing year the Board's own reports
    are organised by, which is what a figure has to line up with to be checkable
    against a filing. It also costs nothing here: measured across all 44,577
    contribution and 49,326 expenditure rows of the 2 major state parties and the 4 caucuses,
    ``Year`` disagrees with the row's own date year on 0 and 3 rows.
    """
    if years is None:
        return "", []
    return " AND year = ANY(:years)", list(years)


def money_in(
    db: Session,
    release: Release,
    reg_num: str,
    years: Optional[Iterable[int]] = None,
) -> list[MoneyIn]:
    """What this filer reported receiving, per year, contributions kept separate.

    **A year with no rows is absent from the result and is not a zero.** The bulk
    file holds itemized rows only, so "no rows for 2026" means this download names
    no payment to this filer for 2026 — which can be a filer that raised nothing, a
    filer whose report is not due yet, a terminated committee, or a filer none of
    whose donors passed the $200 yearly threshold. Those are different facts and
    nothing here can tell them apart, so a caller renders absence as "not reported"
    and never as "0" (§7, Missing versus zero).
    """
    clause, year_values = _year_clause(years)
    params: dict[str, object] = {
        "snapshot": release.contributions.snapshot_id,
        "reg_num": reg_num,
    }
    if year_values:
        params["years"] = year_values
    rows = db.execute(
        text(
            "SELECT year, receipt_type, count(*), coalesce(sum(amount), 0), "
            "       count(*) - count(amount) "
            "  FROM cf_contribution_row "
            " WHERE snapshot_id = :snapshot AND recipient_reg_num = :reg_num "
            "   AND year IS NOT NULL" + clause + " "
            " GROUP BY year, receipt_type ORDER BY year, receipt_type"
        ),
        params,
    ).all()
    if not rows:
        _refuse_if_rows_are_gone(db, release, Dataset.contributions)
        return []

    by_year: dict[int, list[Bucket]] = {}
    for year, receipt_type, count, total, missing in rows:
        label = receipt_type if receipt_type is not None else "(not stated)"
        by_year.setdefault(int(year), []).append(
            Bucket(label, int(count), total, int(missing))
        )
    result: list[MoneyIn] = []
    for year in sorted(by_year):
        buckets = by_year[year]
        contributions = next(
            (b for b in buckets if b.label == CONTRIBUTION_RECEIPT),
            Bucket(CONTRIBUTION_RECEIPT, 0, Decimal("0")),
        )
        others = tuple(b for b in buckets if b.label != CONTRIBUTION_RECEIPT)
        result.append(MoneyIn(reg_num, year, contributions, others))
    return result


def money_out(
    db: Session,
    release: Release,
    reg_num: str,
    years: Optional[Iterable[int]] = None,
) -> list[MoneyOut]:
    """What this filer reported paying out, per year, split by the source's labels.

    There is deliberately no parameter to filter by label. A caller that wants one
    label reads it off ``by_label``, which keeps the whole picture in view: the trap
    this module exists for is a query that names ``Campaign Expenditure`` or
    ``General Expenditure`` and silently loses every filer that uses the other one.

    The amount summed is the filing's **total** column, which is what the file's
    ``Amount`` holds — not its paid column. Measured on filer 17709 where they
    differ, the paid column sums to $10,062.18 and the total column to $9,956.91,
    and only the total matches the rows we hold (§2.1). Unpaid amounts are on the
    rows and are not netted off here, because netting would invent a figure the
    filing does not state.

    A year with no rows is absent and is not a zero, for the same reasons as
    ``money_in``.
    """
    clause, year_values = _year_clause(years)
    params: dict[str, object] = {
        "snapshot": release.expenditures.snapshot_id,
        "reg_num": reg_num,
    }
    if year_values:
        params["years"] = year_values
    rows = db.execute(
        text(
            "SELECT year, type, count(*), coalesce(sum(amount), 0), "
            "       count(*) - count(amount) "
            "  FROM cf_expenditure_row "
            " WHERE snapshot_id = :snapshot AND committee_reg_num = :reg_num "
            "   AND year IS NOT NULL" + clause + " "
            " GROUP BY year, type ORDER BY year, type"
        ),
        params,
    ).all()
    if not rows:
        _refuse_if_rows_are_gone(db, release, Dataset.expenditures)
        return []

    by_year: dict[int, list[Bucket]] = {}
    for year, label, count, total, missing in rows:
        by_year.setdefault(int(year), []).append(
            Bucket(
                label if label is not None else "(not stated)",
                int(count),
                total,
                int(missing),
            )
        )
    return [MoneyOut(reg_num, year, tuple(by_year[year])) for year in sorted(by_year)]


# --- Transfers between registered filers -------------------------------------


@dataclass(frozen=True)
class Transfer:
    """One reported payment from one registered filer to another.

    Stands entirely on its own. Nothing in this module relates one ``Transfer`` to
    another, and nothing may be added that does: money is fungible, so that a party
    paid a caucus and the caucus later paid a candidate are 2 documented facts and
    no filing establishes that the same dollars moved between them
    (``.claude/rules/grounded-answers.md`` rule 12).

    ``row_number`` is the record's line in the download named by
    ``Release.expenditures``, which together are the whole citation this source
    supports: Minnesota publishes no per-transaction identifier and no page for an
    individual payment.

    ``label`` is carried because it is the filing's own word for the payment
    (always ``Contribution`` today) and it is what a surface prints. No label
    describing the payment's *purpose or effect* may be added to it, computed or
    otherwise: rule 12 forbids asserting the meaning between documented facts.
    """

    payer_reg_num: str
    payer_name: Optional[str]
    payee_reg_num: str
    payee_name: Optional[str]
    amount: Decimal
    paid_on: Optional[date]
    year: Optional[int]
    label: str
    row_number: int


_TRANSFER_COLUMNS = (
    "committee_reg_num, committee_name, affected_committee_reg_num, "
    "affected_committee_name, amount, transaction_date, year, type, row_number"
)


def _transfers(db: Session, sql: str, params: dict[str, object]) -> list[Transfer]:
    rows = db.execute(text(sql), params).all()
    return [
        Transfer(
            payer_reg_num=payer_reg,
            payer_name=payer_name,
            payee_reg_num=payee_reg,
            payee_name=payee_name,
            amount=amount if amount is not None else Decimal("0"),
            paid_on=paid_on,
            year=int(year) if year is not None else None,
            label=label if label is not None else "(not stated)",
            row_number=int(row_number),
        )
        for (
            payer_reg,
            payer_name,
            payee_reg,
            payee_name,
            amount,
            paid_on,
            year,
            label,
            row_number,
        ) in rows
    ]


def transfers_from(
    db: Session,
    release: Release,
    reg_num: str,
    years: Optional[Iterable[int]] = None,
) -> list[Transfer]:
    """Payments this filer made to another registered filer, each on its own.

    Reads the ``Contribution``-typed rows only, because they are the only rows that
    name who received the money: measured across all 377,860 expenditure rows,
    ``Contribution`` names an affected committee's registration number on 61,816 of
    its 61,840 rows and every other label names one on **zero**. This is not a
    filter that loses filers — it is the difference between a payment to a committee
    and a payment to a supplier, and the other labels carry a vendor instead.

    So this is never a complete picture of what a filer paid out. For the 6 state
    parties and caucuses across 2025 and 2026 it is 466 of 6,186 outgoing rows.
    ``money_out`` is where the rest is.
    """
    clause, year_values = _year_clause(years)
    params: dict[str, object] = {
        "snapshot": release.expenditures.snapshot_id,
        "reg_num": reg_num,
        "label": TRANSFER_EXPENDITURE_TYPE,
    }
    if year_values:
        params["years"] = year_values
    return _transfers(
        db,
        f"SELECT {_TRANSFER_COLUMNS} FROM cf_expenditure_row "
        " WHERE snapshot_id = :snapshot AND committee_reg_num = :reg_num "
        "   AND type = :label AND affected_committee_reg_num IS NOT NULL" + clause + " "
        " ORDER BY transaction_date, row_number",
        params,
    )


def transfers_to(
    db: Session,
    release: Release,
    reg_num: str,
    years: Optional[Iterable[int]] = None,
) -> list[Transfer]:
    """Payments another registered filer made to this one, each on its own.

    Read off the payer's own filing, which is the same file ``transfers_from``
    reads. It is deliberately not read off the recipient's contributions file, even
    though the money appears there too: the 2 files are 2 different filings and
    their figures need not agree, so returning the payer's row keeps every transfer
    traceable to the filing that reported it.
    """
    clause, year_values = _year_clause(years)
    params: dict[str, object] = {
        "snapshot": release.expenditures.snapshot_id,
        "reg_num": reg_num,
        "label": TRANSFER_EXPENDITURE_TYPE,
    }
    if year_values:
        params["years"] = year_values
    return _transfers(
        db,
        f"SELECT {_TRANSFER_COLUMNS} FROM cf_expenditure_row "
        " WHERE snapshot_id = :snapshot AND affected_committee_reg_num = :reg_num "
        "   AND type = :label" + clause + " "
        " ORDER BY transaction_date, row_number",
        params,
    )


# --- Independent spending ----------------------------------------------------


@dataclass(frozen=True)
class IndependentSpending:
    """What one filer spent independently in one year, split by for and against.

    ``stance`` is the file's own ``For /Against`` value and is never inferred. The
    ``(not stated)`` bucket is defensive only and should never appear: across all
    41,130 rows of the live release on 12 Aug 2026, 31,718 read "For", 9,412 read
    "Against" and **none is blank** (measured by the #1332 session). It exists so a
    future blank is reported rather than assigned to a side, and a surface must not
    print an always-empty third figure, which would tell a reader the source leaves
    the question open when it does not.
    """

    reg_num: str
    year: int
    stance: str
    rows: int
    total: Decimal


def independent_spending_by(
    db: Session,
    release: Release,
    reg_num: str,
    years: Optional[Iterable[int]] = None,
) -> list[IndependentSpending]:
    """Independent expenditures this filer reported making.

    Measured on the live release for the 2 major state parties and the 4 caucuses across 2025
    and 2026: 93 rows, and 0 rows anywhere in the file name any of the 6 as the
    *affected* committee. So independent spending aimed at a party or a caucus is
    genuinely an empty state rather than a partly filled one, and a surface saying
    "nothing was spent about this organisation" would be stating a fact about a
    population of zero as though it were a measurement.
    """
    clause, year_values = _year_clause(years)
    params: dict[str, object] = {
        "snapshot": release.independent_expenditures.snapshot_id,
        "reg_num": reg_num,
    }
    if year_values:
        params["years"] = year_values
    rows = db.execute(
        text(
            "SELECT year, for_against, count(*), coalesce(sum(amount), 0) "
            "  FROM cf_independent_expenditure_row "
            " WHERE snapshot_id = :snapshot AND spender_reg_num = :reg_num "
            "   AND year IS NOT NULL" + clause + " "
            " GROUP BY year, for_against ORDER BY year, for_against"
        ),
        params,
    ).all()
    if not rows:
        _refuse_if_rows_are_gone(db, release, Dataset.independent_expenditures)
        return []
    return [
        IndependentSpending(
            reg_num=reg_num,
            year=int(year),
            stance=stance if stance is not None else "(not stated)",
            rows=int(count),
            total=total,
        )
        for year, stance, count, total in rows
    ]


# --- The other number: what the filer itself reported ------------------------


@dataclass(frozen=True)
class ReportedContributions:
    """One filer-year's own reported contribution figure, from its filed report.

    The second of rule 12's two numbers. It comes from the Board's totals route
    (#1408), not from the downloads, so it is a separate claim by a separate source and
    the two are never reconciled into one figure for display.

    ``reported_through`` is the date the figure runs to and must be shown with it: a
    reported total covering January to June is not a year's money, and §7 requires
    every total to state the period it covers.

    ``comparable`` is False when the Board's totals route cannot speak for this
    filer-year, which happens when the filer also filed a special-election series the
    route does not return. Those years read "Not reported" rather than being compared
    (§9.5), so a caller must not treat a False here as a zero or as a mismatch.
    """

    reg_num: str
    year: int
    total: Decimal
    reported_through: Optional[date]
    comparable: bool


def reported_contributions(
    db: Session,
    reg_num: str,
    years: Optional[Iterable[int]] = None,
) -> list[ReportedContributions]:
    """What this filer reported taking in from contributors, per year.

    Reads through ``campaign_finance_filings.filings_context``, which is #1408's own
    reader, rather than re-deriving the line keys here: which lines add up to
    "contributions" differs by filer kind and deliberately excludes public subsidy,
    loan income and miscellaneous income, none of which is a contribution and none of
    which appears in the itemized download. Duplicating that mapping is how the two
    halves would drift.

    Returns an empty list when no filings snapshot is published, which is a fact about
    us and never about the filer. A year absent from the result is likewise "not
    reported", never a zero — the same rule as ``money_in``.
    """
    from alethical.pipeline import campaign_finance_filings as filings

    context = filings.filings_context(db)
    if context is None:
        return []
    wanted = set(years) if years is not None else None
    result: list[ReportedContributions] = []
    for (registration, year), total in context.reported_contributions.items():
        if registration != reg_num:
            continue
        if wanted is not None and year not in wanted:
            continue
        result.append(
            ReportedContributions(
                reg_num=registration,
                year=year,
                total=total,
                reported_through=context.reported_through.get((registration, year)),
                comparable=(registration, year)
                not in context.special_election_filer_years,
            )
        )
    return sorted(result, key=lambda row: row.year)


# --- Do the payees resolve to a filer we hold? -------------------------------


@dataclass(frozen=True)
class PayeeResolution:
    """Whether each registration number a filer paid appears as a filer here.

    Two claims of different strength, kept apart because a caller must know which one
    it is holding.

    ``unresolved`` is the weak one: the number appears nowhere in this release as a
    filer of its own. ``absent_from_directory`` is the strong one, against the Board's
    registered-filer directory (§9.7), which
    [#1408](https://github.com/alethical-org/alethical/issues/1408) now stores. A
    number can pass the weak check and fail the strong one.

    ``directory_checked`` is False when no filings snapshot is published, and then
    ``absent_from_directory`` is empty because nothing was checked rather than because
    everything passed. A caller must not read an empty tuple as a clean result without
    reading this flag first.

    **An unresolved number is usually a local candidate, not a gap in our
    ingestion.** Measured across every 2025 and 2026 ``Contribution`` row in the
    file, 537 of 1,232 distinct payees resolve to no filer, and they are 4 kinds:

    * **511 negative placeholder numbers**, 560 rows, $299,156.30. The state Board
      does not register candidates for city, county or school-board office, so it
      fills this column with a synthetic negative number instead. Every one of the
      511 is named "X for <local office>" — "Frey, Jacob for Minneapolis Mayor",
      "Fletcher, Bob for Ramsey County Sheriff". A negative number never appears on
      the *filer* side of any of the 3 files, only on the affected side, which is
      what a filer being registered and an affected committee not being registered
      looks like. The independent-expenditures file carries 1,912 more such rows.
    * **17 numbers in a 9xxxx band**, 22 rows, of which 10 are also named for a local
      office and 7 carry no name at all.
    * **8 numbers in the candidate-committee space** — "Meyer, Monica Senate
      Committee" and 7 others — which are state committees that received money and
      itemized none of their own in this release. Not a gap either.
    * **1 literal ``123456`` with no name**, 1 row, $600. A junk value in the source.

    So a surface must not print an unresolved number as an error, and no copy may
    claim the money went to a state filer. Among the 10 state party units and
    caucuses, only Forward Independence (20711) has any: 5 of its 7 payees, all
    negative placeholders. The 2 major parties and 4 caucuses have 0 of 44.
    """

    payee_reg_nums: tuple[str, ...]
    unresolved: tuple[str, ...]
    # Rows whose payee carries no registration number at all, which cannot be
    # resolved either way.
    rows_without_a_payee_number: int
    absent_from_directory: tuple[str, ...] = ()
    directory_checked: bool = False


def resolve_payees(
    db: Session,
    release: Release,
    reg_num: str,
    years: Optional[Iterable[int]] = None,
) -> PayeeResolution:
    """Check every filer this one paid appears as a filer in the same release.

    Measured on the live release for the 2 major state parties and the 4 caucuses
    across 2025 and 2026: 44 distinct payees, 0 unresolved, and 0 rows missing a
    payee number. Across the whole file 24 ``Contribution`` rows carry no payee
    number and 21 carry a number with no name, none of them in 2025 or 2026.
    """
    clause, year_values = _year_clause(years)
    params: dict[str, object] = {
        "contributions": release.contributions.snapshot_id,
        "expenditures": release.expenditures.snapshot_id,
        "reg_num": reg_num,
        "label": TRANSFER_EXPENDITURE_TYPE,
    }
    if year_values:
        params["years"] = year_values
    rows = db.execute(
        text(
            "WITH paid AS ("
            "  SELECT DISTINCT affected_committee_reg_num AS reg "
            "    FROM cf_expenditure_row "
            "   WHERE snapshot_id = :expenditures AND committee_reg_num = :reg_num "
            "     AND type = :label AND affected_committee_reg_num IS NOT NULL"
            + clause
            + "), "
            "known AS ("
            "  SELECT DISTINCT recipient_reg_num AS reg FROM cf_contribution_row "
            "   WHERE snapshot_id = :contributions AND recipient_reg_num IS NOT NULL "
            "  UNION "
            "  SELECT DISTINCT committee_reg_num FROM cf_expenditure_row "
            "   WHERE snapshot_id = :expenditures AND committee_reg_num IS NOT NULL) "
            "SELECT paid.reg, known.reg IS NOT NULL "
            "  FROM paid LEFT JOIN known ON known.reg = paid.reg ORDER BY paid.reg"
        ),
        params,
    ).all()
    missing = db.execute(
        text(
            "SELECT count(*) FROM cf_expenditure_row "
            " WHERE snapshot_id = :expenditures AND committee_reg_num = :reg_num "
            "   AND type = :label AND affected_committee_reg_num IS NULL" + clause
        ),
        params,
    ).scalar_one()
    from alethical.pipeline import campaign_finance_filings as filings

    context = filings.filings_context(db)
    return PayeeResolution(
        payee_reg_nums=tuple(reg for reg, _ in rows),
        unresolved=tuple(reg for reg, resolved in rows if not resolved),
        rows_without_a_payee_number=int(missing),
        absent_from_directory=()
        if context is None
        else tuple(reg for reg, _ in rows if reg not in context.known_registrations),
        directory_checked=context is not None,
    )


__all__ = [
    "CAUCUS_COMMITTEE",
    "CONTRIBUTION_RECEIPT",
    "Bucket",
    "Filer",
    "IndependentSpending",
    "MoneyIn",
    "MoneyOut",
    "PayeeResolution",
    "Release",
    "ReportedContributions",
    "ReleaseNoLongerHeld",
    "STATE_PARTY_UNIT",
    "SourceFile",
    "TRANSFER_EXPENDITURE_TYPE",
    "Transfer",
    "independent_spending_by",
    "live_release",
    "money_in",
    "money_out",
    "party_units_and_caucuses",
    "reported_contributions",
    "resolve_payees",
    "transfers_from",
    "transfers_to",
]
