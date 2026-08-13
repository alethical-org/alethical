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
the Senate, and 2025 carries 10 separate "Fateh, Omar for Minneapolis Mayor"
committees across 101 payments: $487,974.82 supporting and $162,841.95 opposing.
His Senate committee (18488) has no independent spending at all after 2022.
Matching on the name would put a city mayoral race on a state senator's profile;
matching on a confirmed registration number reports his 2025 as the verified 0
it is. Measured against the live release on 12 Aug 2026.

**It never guesses which side an unreadable row belongs to, and never drops it
either.** Minnesota records each payment as "For" or "Against", and across all
41,130 rows of the live release on 12 Aug 2026, 31,718 read "For", 9,412 read
"Against" and **none is blank**. So a row this module cannot classify is a row the
source does not currently publish. It gets a third figure of its own rather than
being attributed to a side, and rather than being dropped: dropping it is how a
total goes quietly short while the answer still reads as complete ([#1454]). The
third figure is 0 for every committee in today's release, which is why a surface
renders it only when it is not — a permanently-visible empty figure would tell a
reader the source leaves the question open when it does not.

Between them the three figures account for every row this module holds, because
the third one is defined as everything the first two are not.

**It never renders our own missing data as a zero.** ``.claude/rules/grounded-answers.md``
rule 12: a missing value reads "Not reported" and a verified zero reads "0". Two
ways that arises here, both ours and both ``UNAVAILABLE``:

* The loader keeps one spare generation of rows, so an id held across two publishes
  resolves to none — "no rows for a release that exists" is stale, never an answer
  about a named person
  (``docs/product-onboarding/data-ingestion-onboarding.md`` section H).
* A row whose amount is blank cannot be added up, so the figure is withheld rather
  than understated. ``sum`` skips such a row while ``count(*)`` counts it, so left
  alone a committee whose only payment has no amount reports a *verified* $0 over a
  payment the file plainly contains ([#1454]). 0 of the live release's 41,130 rows
  are like this, and the column is nullable because the loader stores a blank as
  missing rather than inventing a value, so one blank cell in a future download is
  all it takes.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
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
# Not one of the source's words: the bucket every other value lands in, including
# no value at all. Defined as the complement of the two above so the three figures
# partition the rows and none can go missing between them (#1454).
DIRECTION_NOT_RECORDED = "not recorded"

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

    ``supporting``, ``opposing`` and ``direction_not_recorded`` account between
    them for every row held for this committee-year, so a page showing all three
    is showing everything and a page showing two is not.
    """

    registration_number: str
    committee_name: str
    office: str | None
    supporting: Decimal
    opposing: Decimal
    supporting_payments: int
    opposing_payments: int
    #: Money the filing records as neither "For" nor "Against". 0 for every
    #: committee in the live release, and its own figure rather than a silent
    #: omission for the day that changes (#1454).
    direction_not_recorded: Decimal
    direction_not_recorded_payments: int
    #: Rows held for this committee-year whose amount is blank, and which are
    #: therefore in none of the 3 figures above. Any at all means no figure here
    #: may be shown: the sums are short by an unknown amount, so a caller reads
    #: this before the money and reports ``UNAVAILABLE`` instead.
    rows_missing_an_amount: int
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
    def direction_not_recorded(self) -> Decimal | None:
        """Total spent where the filing records neither side, or ``None``.

        0 for every committee in today's release. Kept as a figure rather than
        folded into either side, because attributing it would invent a claim about
        a person and dropping it would understate the money while the answer still
        read as complete (#1454).
        """
        if self.state != REPORTED:
            return None
        return sum((c.direction_not_recorded for c in self.committees), Decimal(0))

    @property
    def payment_count(self) -> int | None:
        """Payments behind the two directional figures, and only those.

        A payment whose direction could not be read is counted in
        ``direction_not_recorded_payments`` instead, so a surface prints both counts
        or neither. Printing this one alone beside a non-zero third figure would
        describe more money in fewer payments than it names.
        """
        if self.state != REPORTED:
            return None
        return sum(c.supporting_payments + c.opposing_payments for c in self.committees)

    @property
    def supporting_payments(self) -> int | None:
        """Payments behind ``supporting`` alone.

        Served split as well as combined so a page can put a count beside each
        figure. Without it a page printing ``payment_count`` under both figures
        would say the same payments produced each of them.
        """
        if self.state != REPORTED:
            return None
        return sum(c.supporting_payments for c in self.committees)

    @property
    def opposing_payments(self) -> int | None:
        if self.state != REPORTED:
            return None
        return sum(c.opposing_payments for c in self.committees)

    @property
    def direction_not_recorded_payments(self) -> int | None:
        if self.state != REPORTED:
            return None
        return sum(c.direction_not_recorded_payments for c in self.committees)


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
    # The driver can hand back a `timestamptz` in the session's own timezone
    # (`docs/architecture/backend-api-system-design.md`, sitemap `lastmod`), and this
    # instant is the freshness date a page prints. Normalized here so a reader is
    # never told the money was fetched on the wrong day.
    fetched_at = row[2].astimezone(UTC) if row[2] is not None else None
    return Release(snapshot_id=row[0], source_url=row[1], fetched_at=fetched_at)


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
        _committee_spending(
            link.registration_number,
            link.committee_name_as_reviewed,
            link.office_as_reviewed,
            totals.get(link.registration_number),
        )
        for link in sorted(links, key=lambda link: link.registration_number)
    )
    if not totals and not _snapshot_covers_year(db, release.snapshot_id, year):
        # Nothing for this member, in a year the download does not reach. The
        # committee route fixed this same hole (#1442) and this route still had it:
        # the files stop at the present while the route accepts 2100, so a page
        # defaulting to "this year" reports "nobody spent anything about Senator X"
        # about a year nobody has filed for -- on 1 January, without warning.
        # Asked only when the member's own rows come back empty, so a populated
        # request costs nothing extra.
        return IndependentSpending(
            UNAVAILABLE, year, (), release.source_url, release.fetched_at
        )
    if any(committee.rows_missing_an_amount for committee in committees):
        # We hold rows for this member and cannot add them all up, so every total
        # here is short by an unknown amount. Withheld whole rather than published
        # short: an understated figure presented as complete is the failure rule 12
        # exists to stop, and it would be indistinguishable from a real one. One
        # committee is enough, because the figures a page prints are sums across
        # all of them (#1454).
        return IndependentSpending(
            UNAVAILABLE, year, (), release.source_url, release.fetched_at
        )
    return IndependentSpending(
        REPORTED, year, committees, release.source_url, release.fetched_at
    )


def spending_for_committee(
    db: Session,
    *,
    registration_number: str,
    committee_name: str,
    year: int,
    snapshot_id: UUID,
    office: str | None = None,
) -> CommitteeSpending:
    """One committee's independent spending, with no confirmed link in the path.

    The committee-scoped entry point ([#1442](https://github.com/alethical-org/alethical/issues/1442)).
    A registration number identifies a committee on its own, so a committee page
    needs none of the confirming a legislator's profile needs -- what the
    confirmation buys is the right to put a *person's* name over the figure, which
    is the claim the file cannot support and this function does not make.

    Same query as the legislator path above, deliberately: the rules about which
    directions may be read and how a total is assembled are mutation-checked in one
    place and must not be reimplemented beside it.

    Staleness is **not** decided here. The caller resolves the release and must have
    established that this snapshot holds rows, because a committee with no rows in a
    live snapshot is a measured 0 while a snapshot with no rows at all is our own
    staleness, and only the caller can tell those apart.

    For the same reason the caller, not this function, turns a blank amount into a
    state: **read ``rows_missing_an_amount`` before any figure here** and report
    nothing when it is not 0. This returns one committee's numbers and has no state
    to put that in, so the refusal lives with whoever has one.
    """
    totals = _totals_by_committee(
        db, snapshot_id, year=year, registration_numbers=[registration_number]
    )
    return _committee_spending(
        registration_number, committee_name, office, totals.get(registration_number)
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


@dataclass(frozen=True)
class _Bucket:
    """One direction's rows for one committee-year, as the database grouped them."""

    amount: Decimal = Decimal(0)
    payments: int = 0
    first_payment_on: date | None = None
    last_payment_on: date | None = None
    rows_missing_an_amount: int = 0


_EMPTY = _Bucket()


def _snapshot_covers_year(db: Session, snapshot_id: UUID, year: int) -> bool:
    """Whether the download holds any row at all for ``year``, from any committee.

    Deliberately a question about the year rather than about one member, for the
    same reason ``_snapshot_has_rows`` asks about the whole snapshot: a year the
    files cover and a year they do not are different facts, and only the first
    makes an empty answer a finding. Measured on the live release, every dataset
    holds rows for 2015 through 2026 and none beyond.

    ``committee_finance._covers_year`` asks the same question for all 3 downloads.
    Kept separate rather than shared because that module imports this one, so the
    dependency cannot run the other way; both are existence checks and neither
    sums money.
    """
    return (
        db.scalar(
            select(CampaignFinanceIndependentExpenditureRow.row_number)
            .where(
                CampaignFinanceIndependentExpenditureRow.snapshot_id == snapshot_id,
                CampaignFinanceIndependentExpenditureRow.year == year,
            )
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
) -> dict[str, dict[str, _Bucket]]:
    """``{registration_number: {direction: bucket}}``, every row in exactly one.

    Keyed on the two directions the source publishes plus
    ``DIRECTION_NOT_RECORDED`` for everything else, so no row is filtered out of
    the result. The direction used to be a WHERE clause and that was the bug
    (#1454): a value the Board had not published before was excluded from both
    figures and from the count of payments, leaving a total short with nothing to
    say so.

    Both remaining WHERE clauses narrow the scan; neither is what makes the result
    correct. ``_committee_spending`` reads each committee's entry by its own
    registration number, so a row belonging to another committee cannot reach a
    figure even if the clause were dropped. Verified by removing each one and
    watching the suite stay green, which is why it is written down rather than
    assumed: a future reader must not mistake these for the guard and relax the read.

    ``count(*) - count(amount)`` is the second half of #1454. ``sum`` ignores a row
    whose amount is blank while ``count(*)`` includes it, so the two disagree about
    such a row and the difference is the only way to notice it.
    """
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
            func.count()
            - func.count(CampaignFinanceIndependentExpenditureRow.amount),
        )
        .where(
            CampaignFinanceIndependentExpenditureRow.snapshot_id == snapshot_id,
            CampaignFinanceIndependentExpenditureRow.year == year,
            CampaignFinanceIndependentExpenditureRow.affected_committee_reg_num.in_(
                registration_numbers
            ),
        )
        .group_by(
            CampaignFinanceIndependentExpenditureRow.affected_committee_reg_num,
            direction,
        )
    ).all()
    totals: dict[str, dict[str, _Bucket]] = {}
    for reg_num, for_against, amount, payments, first, last, missing in rows:
        # Every unreadable spelling merges into one bucket, so a download carrying
        # both a blank and a new word reports one figure rather than two.
        key = (
            for_against
            if for_against in (SUPPORTING, OPPOSING)
            else DIRECTION_NOT_RECORDED
        )
        by_direction = totals.setdefault(reg_num, {})
        by_direction[key] = _merge(
            by_direction.get(key, _EMPTY),
            _Bucket(
                amount=Decimal(amount),
                payments=payments,
                first_payment_on=first,
                last_payment_on=last,
                rows_missing_an_amount=missing,
            ),
        )
    return totals


def _merge(left: _Bucket, right: _Bucket) -> _Bucket:
    return _Bucket(
        amount=left.amount + right.amount,
        payments=left.payments + right.payments,
        first_payment_on=min(
            _dates(left.first_payment_on, right.first_payment_on), default=None
        ),
        last_payment_on=max(
            _dates(left.last_payment_on, right.last_payment_on), default=None
        ),
        rows_missing_an_amount=(
            left.rows_missing_an_amount + right.rows_missing_an_amount
        ),
    )


def _dates(*values: date | None) -> list[date]:
    return [value for value in values if value is not None]


def _committee_spending(
    registration_number: str,
    committee_name: str,
    office: str | None,
    totals: dict[str, _Bucket] | None,
) -> CommitteeSpending:
    """Assemble one committee's figures.

    Takes the name and office as plain values rather than a confirmed link, because
    a committee page has no link and must still name the committee -- from the
    download's own text, which is a fact about the committee rather than about
    anyone's identity.

    The 3 buckets read here are the whole of what the query returned for this
    committee, so nothing it holds is left out of the figures.
    """
    by_direction = totals or {}
    supporting = by_direction.get(SUPPORTING, _EMPTY)
    opposing = by_direction.get(OPPOSING, _EMPTY)
    not_recorded = by_direction.get(DIRECTION_NOT_RECORDED, _EMPTY)
    buckets = (supporting, opposing, not_recorded)
    return CommitteeSpending(
        registration_number=registration_number,
        committee_name=committee_name,
        office=office,
        supporting=supporting.amount,
        opposing=opposing.amount,
        supporting_payments=supporting.payments,
        opposing_payments=opposing.payments,
        direction_not_recorded=not_recorded.amount,
        direction_not_recorded_payments=not_recorded.payments,
        rows_missing_an_amount=sum(b.rows_missing_an_amount for b in buckets),
        first_payment_on=min(
            _dates(*(b.first_payment_on for b in buckets)), default=None
        ),
        last_payment_on=max(_dates(*(b.last_payment_on for b in buckets)), default=None),
    )
