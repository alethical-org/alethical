"""Independent spending for and against a legislator ([#1332]).

Money spent to support or oppose a candidate by groups that are not the
candidate's own campaign. It never passes through the campaign and appears in no
filing the campaign makes, so a reader looking only at a member's own report is
missing part of the picture.

Three things this module refuses to do, each because the alternative asserts
something no filing supports.

**It never attributes a payment by name.** Every row in the source names an
affected *committee* and none names a person
(``docs/architecture/campaign-finance-system-design.md`` §7, Display rules), so a
figure is reachable only through a committee link a person has confirmed. The
sharpest case is real and lives in the live release: Senator Omar Fateh sits in
the Senate, and 2025 carries 11 separate "Fateh, Omar for Minneapolis Mayor"
committees holding $488,000 supporting and $163,000 opposing. His Senate
committee (18488) has no independent spending at all after 2022. Matching on the
name would put a city mayoral race on a state senator's profile; matching on a
confirmed registration number reports his 2025 as the verified 0 it is.

**It never invents a third "target not recorded" figure.** The issue that
commissioned this asked for one, from a measurement of the retired Base44 copy
where 78% of rows recorded no target. That is damage that copy did to itself, not
a property of Minnesota's data: across all 41,130 rows of the live release on
12 Aug 2026, 31,718 read "For" and 9,412 read "Against", and **none is blank**.
A permanently-empty third figure would tell a reader the source leaves the
question open when it does not.

**It never renders our own missing data as a zero.** ``.claude/rules/grounded-answers.md``
rule 12: a missing value reads "Not reported" and a verified zero reads "0". The
loader keeps one spare generation of rows, so an id held across two publishes
resolves to none — "no rows for a release that exists" is stale and reads as
unavailable, never as an answer about a named person
(``docs/product-onboarding/data-ingestion-onboarding.md`` section H).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from alethical.db.schema import load_schema

schema = load_schema()
CampaignFinanceCurrentRelease = schema.CampaignFinanceCurrentRelease
CampaignFinanceIndependentExpenditureRow = (
    schema.CampaignFinanceIndependentExpenditureRow
)
CampaignFinanceRelease = schema.CampaignFinanceRelease
CampaignFinanceSnapshot = schema.CampaignFinanceSnapshot
CommitteeLinkReviewDecision = schema.CommitteeLinkReviewDecision
LegislatorCampaignCommittee = schema.LegislatorCampaignCommittee

# The source's own two words for the direction of a payment, spelled exactly as
# the file spells them. Compared case-insensitively at the database, because the
# spelling is the Board's to change and a silent miss would move real money into
# neither figure.
SUPPORTING = "For"
OPPOSING = "Against"

#: No published release, or a release whose rows have been superseded twice over.
#: Says nothing about any legislator.
UNAVAILABLE = "unavailable"
#: The release is fine; this legislator has no committee link a person has
#: confirmed, so no row can be attributed to them.
LINK_UNCONFIRMED = "link_unconfirmed"
#: Figures, where 0 is a verified 0.
REPORTED = "reported"


@dataclass(frozen=True)
class CommitteeSpending:
    """One confirmed committee's independent spending for one year.

    ``office`` is carried so a figure can say which committee it belongs to
    rather than only which year (§7). A member may hold several committees, and
    a race for another office must never be summed into a legislative figure.
    """

    registration_number: str
    committee_name: str
    office: str | None
    supporting: Decimal
    opposing: Decimal
    supporting_payments: int
    opposing_payments: int
    first_payment_on: date | None
    last_payment_on: date | None


@dataclass(frozen=True)
class IndependentSpending:
    """What a legislator's profile may say about independent spending in a year.

    ``state`` decides whether the figures may be read at all. Only ``REPORTED``
    carries numbers, and there a zero is a measured zero.
    """

    state: str
    year: int
    committees: tuple[CommitteeSpending, ...]
    source_url: str | None
    fetched_at: datetime | None

    @property
    def supporting(self) -> Decimal | None:
        """Total spent supporting, or ``None`` when no figure may be shown."""
        if self.state != REPORTED:
            return None
        return sum((c.supporting for c in self.committees), Decimal(0))

    @property
    def opposing(self) -> Decimal | None:
        """Total spent opposing, or ``None`` when no figure may be shown."""
        if self.state != REPORTED:
            return None
        return sum((c.opposing for c in self.committees), Decimal(0))

    @property
    def payment_count(self) -> int | None:
        if self.state != REPORTED:
            return None
        return sum(
            c.supporting_payments + c.opposing_payments for c in self.committees
        )


@dataclass(frozen=True)
class Release:
    """The live release's independent-expenditures slot, resolved once.

    Section H is explicit that re-resolving per query can hand back a mixed set,
    so a request resolves this once and passes it to every read.
    """

    snapshot_id: UUID
    source_url: str | None
    fetched_at: datetime | None


def current_release(db: Session) -> Release | None:
    """The published release's independent-expenditures snapshot, or ``None``.

    ``None`` means no release is published — which is a fact about us, never a
    fact about a legislator.
    """
    row = db.execute(
        select(
            CampaignFinanceRelease.independent_expenditures_snapshot_id,
            CampaignFinanceSnapshot.source_url,
            CampaignFinanceRelease.fetch_completed_at,
        )
        .join(
            CampaignFinanceCurrentRelease,
            CampaignFinanceCurrentRelease.release_id == CampaignFinanceRelease.id,
        )
        .join(
            CampaignFinanceSnapshot,
            CampaignFinanceSnapshot.id
            == CampaignFinanceRelease.independent_expenditures_snapshot_id,
        )
    ).first()
    if row is None:
        return None
    return Release(snapshot_id=row[0], source_url=row[1], fetched_at=row[2])


def confirmed_committees(
    db: Session, legislator_id: UUID, *, year: int
) -> list[LegislatorCampaignCommittee]:
    """This legislator's confirmed committees whose reviewed period covers ``year``.

    Only ``confirmed`` counts. A rejection is stored rather than discarded (§5.1),
    and a proposal is a question — only an answer is a link.

    A reviewed period with no first or last year is treated as open at that end:
    the reviewer saw the committee and did not bound it, which is weaker evidence
    than a bound but is not evidence against.
    """
    rows = db.scalars(
        select(LegislatorCampaignCommittee).where(
            LegislatorCampaignCommittee.legislator_id == legislator_id,
            LegislatorCampaignCommittee.decision
            == CommitteeLinkReviewDecision.confirmed,
        )
    ).all()
    return [link for link in rows if _period_covers(link, year)]


def _period_covers(link: LegislatorCampaignCommittee, year: int) -> bool:
    first = _as_year(link.first_year_as_reviewed)
    last = _as_year(link.last_year_as_reviewed)
    if first is not None and year < first:
        return False
    if last is not None and year > last:
        return False
    return True


def _as_year(value: str | None) -> int | None:
    """A reviewed year as an int, or ``None`` when it is absent or not a year.

    The column is free-ish text a person filled in, so an unparseable value reads
    as "not bounded" rather than raising. Bounding wrongly would hide real money.
    """
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def independent_spending_for_legislator(
    db: Session,
    legislator_id: UUID,
    *,
    year: int,
    release: Release | None = None,
) -> IndependentSpending:
    """Independent spending for and against one legislator in one calendar year.

    Pass ``release`` when a request already resolved it, so every dataset on the
    page reads the same one (section H).
    """
    release = release or current_release(db)
    if release is None:
        return IndependentSpending(UNAVAILABLE, year, (), None, None)

    empty = IndependentSpending(
        UNAVAILABLE, year, (), release.source_url, release.fetched_at
    )
    if not _snapshot_has_rows(db, release.snapshot_id):
        # A release that exists but holds no rows is stale, not an answer.
        return empty

    links = confirmed_committees(db, legislator_id, year=year)
    if not links:
        return IndependentSpending(
            LINK_UNCONFIRMED, year, (), release.source_url, release.fetched_at
        )

    totals = _totals_by_committee(
        db,
        release.snapshot_id,
        year=year,
        registration_numbers=[link.registration_number for link in links],
    )
    committees = tuple(
        _committee_spending(link, totals.get(link.registration_number))
        for link in sorted(links, key=lambda link: link.registration_number)
    )
    return IndependentSpending(
        REPORTED, year, committees, release.source_url, release.fetched_at
    )


def _snapshot_has_rows(db: Session, snapshot_id: UUID) -> bool:
    """Whether the live snapshot holds any rows at all.

    Deliberately a question about the whole snapshot, not about one legislator.
    A snapshot with rows and a legislator with none is a verified zero; a
    snapshot with no rows is our own staleness and may not be reported as
    anyone's zero.
    """
    return (
        db.scalar(
            select(CampaignFinanceIndependentExpenditureRow.row_number)
            .where(CampaignFinanceIndependentExpenditureRow.snapshot_id == snapshot_id)
            .limit(1)
        )
        is not None
    )


def _totals_by_committee(
    db: Session,
    snapshot_id: UUID,
    *,
    year: int,
    registration_numbers: list[str],
) -> dict[str, dict[str, tuple[Decimal, int, date | None, date | None]]]:
    """``{registration_number: {direction: (amount, payments, first, last)}}``."""
    direction = func.initcap(
        func.trim(CampaignFinanceIndependentExpenditureRow.for_against)
    )
    rows = db.execute(
        select(
            CampaignFinanceIndependentExpenditureRow.affected_committee_reg_num,
            direction,
            func.coalesce(func.sum(CampaignFinanceIndependentExpenditureRow.amount), 0),
            func.count(),
            func.min(CampaignFinanceIndependentExpenditureRow.transaction_date),
            func.max(CampaignFinanceIndependentExpenditureRow.transaction_date),
        )
        .where(
            CampaignFinanceIndependentExpenditureRow.snapshot_id == snapshot_id,
            CampaignFinanceIndependentExpenditureRow.year == year,
            CampaignFinanceIndependentExpenditureRow.affected_committee_reg_num.in_(
                registration_numbers
            ),
            direction.in_([SUPPORTING, OPPOSING]),
        )
        .group_by(
            CampaignFinanceIndependentExpenditureRow.affected_committee_reg_num,
            direction,
        )
    ).all()
    totals: dict[str, dict[str, tuple[Decimal, int, date | None, date | None]]] = {}
    for reg_num, for_against, amount, count, first, last in rows:
        totals.setdefault(reg_num, {})[for_against] = (amount, count, first, last)
    return totals


def _committee_spending(
    link: LegislatorCampaignCommittee,
    totals: dict[str, tuple[Decimal, int, date | None, date | None]] | None,
) -> CommitteeSpending:
    supporting = (totals or {}).get(SUPPORTING, (Decimal(0), 0, None, None))
    opposing = (totals or {}).get(OPPOSING, (Decimal(0), 0, None, None))
    dates = [value for value in (supporting[2], opposing[2]) if value is not None]
    last_dates = [value for value in (supporting[3], opposing[3]) if value is not None]
    return CommitteeSpending(
        registration_number=link.registration_number,
        committee_name=link.committee_name_as_reviewed,
        office=link.office_as_reviewed,
        supporting=Decimal(supporting[0]),
        opposing=Decimal(opposing[0]),
        supporting_payments=supporting[1],
        opposing_payments=opposing[1],
        first_payment_on=min(dates) if dates else None,
        last_payment_on=max(last_dates) if last_dates else None,
    )
