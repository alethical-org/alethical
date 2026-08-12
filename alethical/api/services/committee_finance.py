"""One committee's money in and money out, keyed on its registration number (#1442).

Minnesota identifies a campaign committee by a registration number and never says
whose it is. That number needs no human confirmation, so everything here is
answerable today, while a *legislator's* money waits on someone confirming which
committee is theirs (``docs/architecture/campaign-finance-system-design.md`` §5,
Identity). This module is deliberately the committee-shaped layer underneath that
confirmation: hand it a number and a year and it reports what the state's own
downloads say, with no legislator anywhere in the path.

**Every figure here is a sum of itemized rows, and never a committee's total.**
Minnesota names a donor only once their giving passes $200 in aggregate within a
calendar year (Minnesota Statutes 10A.20 subd. 3(c)), so the payments we can list
never add up to what a committee reported raising -- measured at 36.5% of the 2024
total and 41.3% of 2025 going unnamed (§9.5). The reported total is a different
number from a different source and nothing stores it yet
([#1408](https://github.com/alethical-org/alethical/issues/1408)). So every field
below says ``itemized`` in its own name, there is deliberately no field a caller
could mistake for a grand total, and ``reported_total`` is left free as a purely
additive field for whoever lands #1408.

Four things this module refuses to do, each because the alternative states
something no filing supports (``.claude/rules/grounded-answers.md`` rule 12).

**It never renders "we hold no rows" as a zero.** A committee-year with no
itemized rows is ``NOT_REPORTED``, never ``0``. This is not a technicality: Senator
Omar Fateh's Senate committee (18488) filed $2,300.00 of itemized contributions for
2025 that the bulk download does not carry, so a page reading absence as zero would
print "$0 raised" over a real filing. 218 committee-years in the live release hold
receipts of which **not one** is a contribution, which is why the contribution
figure's state is decided by the contribution rows alone rather than by whether the
committee appears at all.

**It never mixes two releases.** A request resolves the live release once and reads
all 3 datasets from that one set of snapshot ids, because each statement otherwise
sees the newest committed state and a committee's spending could come from a
different day than its income (``docs/product-onboarding/data-ingestion-onboarding.md``
section H).

**It never reads a stale release as an answer.** The loader keeps one spare
generation of rows, so a release id held across 2 publishes finds no rows at all.
"No rows for a release that exists" is our own staleness and reads as
``UNAVAILABLE`` -- a fact about us, never a fact about a committee.

**It never decides which kinds of money count.** Money out is the sum of every row
the committee filed, with the source's own ``Type`` label kept alongside each
subtotal, because a candidate committee and a party unit spell the same thing
differently: in 2025 candidate committees filed 6,781 rows typed
``Campaign Expenditure`` and none typed ``General Expenditure``, while party units
filed 7,524 the other way round (§2.1). Filtering on either label alone silently
drops a whole kind of filer. Money in is the one place a filter is required rather
than forbidden -- ``Receipt type`` carries 4 values and only ``Contribution``
belongs in a contribution figure -- so the other 3 are reported beside it under
their own labels rather than dropped. Senator Lindsey Port's committee (18466) is
the plain case: its 2025 receipts are $5,100.00 of contributions and a $5,000.00
row typed ``Miscellaneous``, which is a loan from the candidate to her own campaign.
Counting it as a contribution would nearly double her figure; hiding it would lose
real money the filing reports.

All measurements above are against production release ``3f2bdf90`` on 12 Aug 2026.
Counts are evidence, never assertions (§8).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, date
from decimal import Decimal
from typing import Mapping
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from alethical.api.services.independent_spending import (
    REPORTED,
    UNAVAILABLE,
    CommitteeSpending,
    spending_for_committee,
)
from alethical.db.schema import load_schema

schema = load_schema()
CampaignFinanceContributionRow = schema.CampaignFinanceContributionRow
CampaignFinanceCurrentRelease = schema.CampaignFinanceCurrentRelease
CampaignFinanceDataset = schema.CampaignFinanceDataset
CampaignFinanceExpenditureRow = schema.CampaignFinanceExpenditureRow
CampaignFinanceIndependentExpenditureRow = (
    schema.CampaignFinanceIndependentExpenditureRow
)
CampaignFinanceRelease = schema.CampaignFinanceRelease
CampaignFinanceSnapshot = schema.CampaignFinanceSnapshot

Dataset = CampaignFinanceDataset

#: We hold no itemized rows for this committee-year. The committee may well have
#: raised or spent money: the downloads carry only payments over $200, so absence
#: here is silence, not a zero. ``REPORTED`` and ``UNAVAILABLE`` are imported from
#: ``independent_spending`` rather than restated, so the two services cannot drift
#: into two vocabularies for the same three answers.
NOT_REPORTED = "not_reported"

# The one value of `Receipt type` that belongs in a contribution figure, compared
# case-insensitively and trimmed. The spelling is the Board's to change, and a
# silent miss here understates a committee's headline figure while the money is
# still visible under `other_receipts` -- so the comparison is loose on purpose and
# nothing is ever dropped, only labelled.
CONTRIBUTION_RECEIPT_TYPE = "contribution"


@dataclass(frozen=True)
class Release:
    """The live release, resolved once and used for all 3 datasets in a request.

    ``loaded`` names the datasets whose snapshot actually holds rows. A published
    release whose rows have been pruned is not an answer about anybody, so a
    dataset missing from this set reads ``UNAVAILABLE`` rather than "nothing here".
    """

    release_id: UUID
    fetched_at: datetime
    snapshot_ids: Mapping[Dataset, UUID]
    source_urls: Mapping[Dataset, str]
    loaded: frozenset[Dataset]

    @property
    def is_usable(self) -> bool:
        """Whether any dataset in this release still has rows behind it."""
        return bool(self.loaded)

    def state_for(self, dataset: Dataset) -> str | None:
        """``UNAVAILABLE`` when this dataset is stale, otherwise ``None``."""
        return None if dataset in self.loaded else UNAVAILABLE


@dataclass(frozen=True)
class Committee:
    """Who the registration number belongs to, as the download itself names them.

    ``entity_type`` is the Board's code for the kind of filer -- ``PCC`` a
    candidate's principal campaign committee, ``PTU`` a party unit (``CAU`` a
    caucus), ``PCF`` a political committee or fund. It is ``None`` for the 283
    committees reachable only through the independent-expenditure file, which are
    local candidates the state does not register and which carry a negative
    registration number the Board assigns internally.
    """

    registration_number: str
    name: str
    entity_type: str | None
    entity_sub_type: str | None


@dataclass(frozen=True)
class ReceiptTypeTotal:
    """One ``Receipt type`` the committee reported, spelled as the source spells it."""

    receipt_type: str
    total: Decimal
    payments: int


@dataclass(frozen=True)
class ExpenditureTypeTotal:
    """One ``Type`` of payment out, spelled as the source spells it."""

    expenditure_type: str
    total: Decimal
    payments: int


@dataclass(frozen=True)
class MoneyIn:
    """Itemized receipts for one committee-year.

    ``state`` describes the **contribution** figure alone. A committee-year can hold
    a loan and no contributions, and 218 of them do, so deciding this from "are
    there any rows" would print a zero over a real filing.

    ``other_receipts`` is everything the file reports that is not a contribution --
    ``Miscellaneous``, ``Miscellaneous Income``, ``Loan Payable``. It is not part of
    ``itemized_contribution_total`` and must never be added to it: the filing carries
    those on separate schedules and the Board's own totals exclude them (§2.1).
    """

    state: str
    itemized_contribution_total: Decimal | None
    itemized_contribution_payments: int | None
    first_receipt_on: date | None
    last_receipt_on: date | None
    other_receipts: tuple[ReceiptTypeTotal, ...]
    source_url: str | None


@dataclass(frozen=True)
class MoneyOut:
    """Itemized payments out for one committee-year.

    ``itemized_payment_total`` sums **every** row the committee filed, whatever its
    ``Type``. Nothing is filtered, which is how a party unit's ``General Expenditure``
    rows and a candidate committee's ``Campaign Expenditure`` rows both land in the
    figure; ``by_type`` carries the source's own breakdown so a surface can show the
    composition without this layer deciding what counts.

    ``unpaid_total`` is a separate column of the filing, not a subset of the total.
    The download's ``Amount`` is the filing's *total* column and a row can be
    unpaid, which is why nothing here is called a payment date or a paid figure
    (§2.1).
    """

    state: str
    itemized_payment_total: Decimal | None
    itemized_payments: int | None
    unpaid_total: Decimal | None
    first_transaction_on: date | None
    last_transaction_on: date | None
    by_type: tuple[ExpenditureTypeTotal, ...]
    source_url: str | None


@dataclass(frozen=True)
class IndependentSpendingAbout:
    """What others spent about this committee, from #1332's shared query.

    Unlike money in and money out, a committee absent from this file reads as a
    measured ``0`` rather than ``NOT_REPORTED``. The two cases genuinely differ: an
    absent *filer* may simply have raised money nobody had to name, while a committee
    nobody filed an independent expenditure about had no independent spending
    reported over $200, which is a finding. Staleness is still ``UNAVAILABLE``, and
    that judgement is made about the whole snapshot rather than this committee's
    slice of it.
    """

    state: str
    spending: CommitteeSpending | None
    source_url: str | None


@dataclass(frozen=True)
class CommitteeFinance:
    """Everything one committee's page may show for one year, from one release.

    ``fetched_at`` is the single freshness date §7 requires, and it is **not** the
    period the money covers: the period is per filing and always earlier. The dates
    on each block are the first and last payment we hold, which is a fact about our
    rows and never a claim about a reporting period -- no surface may hardcode
    1 January as a period start, and this layer states no period at all until #1408
    supplies the filing's own.
    """

    committee: Committee
    year: int
    release_id: UUID
    fetched_at: datetime
    money_in: MoneyIn
    money_out: MoneyOut
    independent_spending: IndependentSpendingAbout


def current_release(db: Session) -> Release | None:
    """The published release and its 3 snapshots, resolved in one read.

    ``None`` means no release is published, which is a fact about us. Section H is
    explicit that re-resolving the live release per query can hand back a mixed set,
    so a request calls this once and passes the result to every read below.
    """
    contributions = aliased(CampaignFinanceSnapshot)
    expenditures = aliased(CampaignFinanceSnapshot)
    independent = aliased(CampaignFinanceSnapshot)
    row = db.execute(
        select(
            CampaignFinanceRelease.id,
            CampaignFinanceRelease.fetch_completed_at,
            CampaignFinanceRelease.contributions_snapshot_id,
            CampaignFinanceRelease.expenditures_snapshot_id,
            CampaignFinanceRelease.independent_expenditures_snapshot_id,
            contributions.source_url,
            expenditures.source_url,
            independent.source_url,
        )
        .join(
            CampaignFinanceCurrentRelease,
            CampaignFinanceCurrentRelease.release_id == CampaignFinanceRelease.id,
        )
        .join(
            contributions,
            contributions.id == CampaignFinanceRelease.contributions_snapshot_id,
        )
        .join(
            expenditures,
            expenditures.id == CampaignFinanceRelease.expenditures_snapshot_id,
        )
        .join(
            independent,
            independent.id
            == CampaignFinanceRelease.independent_expenditures_snapshot_id,
        )
    ).first()
    if row is None:
        return None
    snapshot_ids = {
        Dataset.contributions: row[2],
        Dataset.expenditures: row[3],
        Dataset.independent_expenditures: row[4],
    }
    source_urls = {
        Dataset.contributions: row[5],
        Dataset.expenditures: row[6],
        Dataset.independent_expenditures: row[7],
    }
    return Release(
        release_id=row[0],
        # The driver can hand back a `timestamptz` in the session's own timezone, and
        # this instant is the freshness date a page prints beside the money.
        fetched_at=row[1].astimezone(UTC),
        snapshot_ids=snapshot_ids,
        source_urls=source_urls,
        loaded=frozenset(
            dataset
            for dataset, snapshot_id in snapshot_ids.items()
            if _snapshot_has_rows(db, dataset, snapshot_id)
        ),
    )


_ROW_MODEL = {
    Dataset.contributions: CampaignFinanceContributionRow,
    Dataset.expenditures: CampaignFinanceExpenditureRow,
    Dataset.independent_expenditures: CampaignFinanceIndependentExpenditureRow,
}


def _snapshot_has_rows(db: Session, dataset: Dataset, snapshot_id: UUID) -> bool:
    """Whether this snapshot holds any rows at all.

    Deliberately a question about the whole snapshot rather than about one
    committee. A snapshot with rows and a committee with none is silence about that
    committee; a snapshot with no rows is our own staleness and may not be reported
    as anyone's anything.
    """
    model = _ROW_MODEL[dataset]
    return (
        db.scalar(
            select(model.row_number).where(model.snapshot_id == snapshot_id).limit(1)
        )
        is not None
    )


def find_committee(
    db: Session, release: Release, registration_number: str
) -> Committee | None:
    """Who this registration number is, or ``None`` if it is nowhere in the release.

    Looked up across all 3 datasets, because a committee can be missing from any one
    of them: 333 filers in the live release appear only in the expenditures download,
    72 only in contributions, and 341 committees appear only as the *target* of
    someone else's independent spending and have no state filings of their own.

    The expenditures file is preferred where a committee appears in more than one,
    because it names the most filers and carries the filer kind; the
    independent-expenditure file is last because it names an affected committee
    without saying what kind of filer it is. This is a display preference only: name
    and kind are stable per registration number within a snapshot, measured across
    all 2,783 and 3,044 filers of the live release with zero disagreements.
    """
    candidates: list[tuple[int, Committee]] = []

    if Dataset.expenditures in release.loaded:
        row = db.execute(
            select(
                CampaignFinanceExpenditureRow.committee_name,
                CampaignFinanceExpenditureRow.entity_type,
                CampaignFinanceExpenditureRow.entity_sub_type,
            )
            .where(
                CampaignFinanceExpenditureRow.snapshot_id
                == release.snapshot_ids[Dataset.expenditures],
                CampaignFinanceExpenditureRow.committee_reg_num == registration_number,
            )
            .limit(1)
        ).first()
        if row is not None:
            candidates.append(
                (1, Committee(registration_number, row[0] or "", row[1], row[2]))
            )

    if Dataset.contributions in release.loaded:
        row = db.execute(
            select(
                CampaignFinanceContributionRow.recipient,
                CampaignFinanceContributionRow.recipient_type,
                CampaignFinanceContributionRow.recipient_subtype,
            )
            .where(
                CampaignFinanceContributionRow.snapshot_id
                == release.snapshot_ids[Dataset.contributions],
                CampaignFinanceContributionRow.recipient_reg_num == registration_number,
            )
            .limit(1)
        ).first()
        if row is not None:
            candidates.append(
                (2, Committee(registration_number, row[0] or "", row[1], row[2]))
            )

    if Dataset.independent_expenditures in release.loaded:
        row = db.execute(
            select(CampaignFinanceIndependentExpenditureRow.affected_committee_name)
            .where(
                CampaignFinanceIndependentExpenditureRow.snapshot_id
                == release.snapshot_ids[Dataset.independent_expenditures],
                CampaignFinanceIndependentExpenditureRow.affected_committee_reg_num
                == registration_number,
            )
            .limit(1)
        ).first()
        if row is not None:
            candidates.append(
                (3, Committee(registration_number, row[0] or "", None, None))
            )

    if not candidates:
        return None
    return min(candidates, key=lambda pair: pair[0])[1]


def money_in(
    db: Session, release: Release, *, registration_number: str, year: int
) -> MoneyIn:
    """Itemized receipts for one committee in one year.

    ``year`` is matched against the file's own ``Year`` column, never against the
    year of a row's date. They are separate claims and disagree on 702 rows across
    the 3 files, and it is ``Year`` the filing is scoped by, so a figure built from
    dates would sum a different set than the total it will one day sit beside (§2.1).
    """
    stale = release.state_for(Dataset.contributions)
    if stale is not None:
        return MoneyIn(stale, None, None, None, None, (), None)

    source_url = release.source_urls[Dataset.contributions]
    rows = db.execute(
        select(
            CampaignFinanceContributionRow.receipt_type,
            func.coalesce(func.sum(CampaignFinanceContributionRow.amount), 0),
            func.count(),
            func.min(CampaignFinanceContributionRow.receipt_date),
            func.max(CampaignFinanceContributionRow.receipt_date),
        )
        .where(
            CampaignFinanceContributionRow.snapshot_id
            == release.snapshot_ids[Dataset.contributions],
            CampaignFinanceContributionRow.recipient_reg_num == registration_number,
            CampaignFinanceContributionRow.year == year,
        )
        .group_by(CampaignFinanceContributionRow.receipt_type)
    ).all()

    contributions = [row for row in rows if _is_contribution(row[0])]
    others = tuple(
        ReceiptTypeTotal(row[0] or "", Decimal(row[1]), row[2])
        for row in sorted(rows, key=lambda row: row[0] or "")
        if not _is_contribution(row[0])
    )
    if not contributions:
        return MoneyIn(NOT_REPORTED, None, None, None, None, others, source_url)

    total = sum((Decimal(row[1]) for row in contributions), Decimal(0))
    payments = sum(row[2] for row in contributions)
    first = min(row[3] for row in contributions if row[3] is not None)
    last = max(row[4] for row in contributions if row[4] is not None)
    return MoneyIn(REPORTED, total, payments, first, last, others, source_url)


def _is_contribution(receipt_type: str | None) -> bool:
    return (receipt_type or "").strip().casefold() == CONTRIBUTION_RECEIPT_TYPE


def money_out(
    db: Session, release: Release, *, registration_number: str, year: int
) -> MoneyOut:
    """Itemized payments out for one committee in one year.

    Every row counts. There is no ``Type`` filter here and there must never be one:
    the same kind of spending is labelled ``Campaign Expenditure`` by a candidate
    committee and ``General Expenditure`` by a party unit, so any single-label filter
    reports one kind of filer as having spent nothing (§2.1).
    """
    stale = release.state_for(Dataset.expenditures)
    if stale is not None:
        return MoneyOut(stale, None, None, None, None, None, (), None)

    source_url = release.source_urls[Dataset.expenditures]
    rows = db.execute(
        select(
            CampaignFinanceExpenditureRow.type,
            func.coalesce(func.sum(CampaignFinanceExpenditureRow.amount), 0),
            func.count(),
            func.coalesce(func.sum(CampaignFinanceExpenditureRow.unpaid_amount), 0),
            func.min(CampaignFinanceExpenditureRow.transaction_date),
            func.max(CampaignFinanceExpenditureRow.transaction_date),
        )
        .where(
            CampaignFinanceExpenditureRow.snapshot_id
            == release.snapshot_ids[Dataset.expenditures],
            CampaignFinanceExpenditureRow.committee_reg_num == registration_number,
            CampaignFinanceExpenditureRow.year == year,
        )
        .group_by(CampaignFinanceExpenditureRow.type)
    ).all()
    if not rows:
        return MoneyOut(NOT_REPORTED, None, None, None, None, None, (), source_url)

    by_type = tuple(
        ExpenditureTypeTotal(row[0] or "", Decimal(row[1]), row[2])
        for row in sorted(rows, key=lambda row: row[0] or "")
    )
    dates = [row[4] for row in rows if row[4] is not None]
    last_dates = [row[5] for row in rows if row[5] is not None]
    return MoneyOut(
        state=REPORTED,
        itemized_payment_total=sum((Decimal(row[1]) for row in rows), Decimal(0)),
        itemized_payments=sum(row[2] for row in rows),
        unpaid_total=sum((Decimal(row[3]) for row in rows), Decimal(0)),
        first_transaction_on=min(dates) if dates else None,
        last_transaction_on=max(last_dates) if last_dates else None,
        by_type=by_type,
        source_url=source_url,
    )


def independent_spending_about(
    db: Session, release: Release, *, committee: Committee, year: int
) -> IndependentSpendingAbout:
    """What others spent about this committee, through #1332's query.

    Deliberately the same query a legislator's profile runs, handed a registration
    number directly instead of one a person confirmed. Writing a second query here
    would put the honesty rules #1332 mutation-checked in two places, where only one
    of them would get fixed.
    """
    stale = release.state_for(Dataset.independent_expenditures)
    source_url = release.source_urls[Dataset.independent_expenditures]
    if stale is not None:
        return IndependentSpendingAbout(stale, None, None)
    return IndependentSpendingAbout(
        REPORTED,
        spending_for_committee(
            db,
            registration_number=committee.registration_number,
            committee_name=committee.name,
            year=year,
            snapshot_id=release.snapshot_ids[Dataset.independent_expenditures],
        ),
        source_url,
    )


def committee_finance(
    db: Session, release: Release, *, registration_number: str, year: int
) -> CommitteeFinance | None:
    """One committee's money for one year, or ``None`` if we hold no record of it.

    ``None`` means this registration number appears in no dataset of the live
    release. That is a statement about our records, not about Minnesota's: the
    Board's registered-filer directory is the authority on whether a committee
    exists and nothing here reads it yet (§9.7). Callers must not phrase it as
    "no such committee".
    """
    committee = find_committee(db, release, registration_number)
    if committee is None:
        return None
    return CommitteeFinance(
        committee=committee,
        year=year,
        release_id=release.release_id,
        fetched_at=release.fetched_at,
        money_in=money_in(
            db, release, registration_number=registration_number, year=year
        ),
        money_out=money_out(
            db, release, registration_number=registration_number, year=year
        ),
        independent_spending=independent_spending_about(
            db, release, committee=committee, year=year
        ),
    )
