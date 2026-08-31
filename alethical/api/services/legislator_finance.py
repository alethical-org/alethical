"""One legislator's campaign money, for the money tab on their profile (#1329).

Minnesota never says which registered committee belongs to which person, so this
module sits on top of two things that already exist and adds only what a *profile*
needs that a committee page does not.

* **Which committees are this legislator's**, from the person-checked link table
  (``docs/architecture/campaign-finance-system-design.md`` §5, Identity). Read through
  ``independent_spending.confirmed_committees`` rather than re-queried here, so the
  period rule that decides whether a link covers the year asked for exists once.
* **The split between money that carries a donor's name and money that does not**,
  which is the one figure on the page that nothing upstream computes and that
  ``.claude/rules/grounded-answers.md`` rule 12 is mostly about.

**One thing here is not about a profile**: ``confirmed_member_for_committee`` answers
the committee page's version of the same question -- which legislator, if anyone, a
person has confirmed a committee belongs to. It lives beside ``link_state`` so both
directions of one person-checked fact are read in one place and cannot drift apart
([#1680](https://github.com/alethical-org/alethical/issues/1680)).

**Every money figure comes from ``committee_finance``, which comes from
``campaign_finance_reader``.** Nothing here sums a payment. The 4 source behaviours
that make a plausible query silently wrong (both expenditure labels counted, receipts
filtered to ``Contribution``, the file's own ``Year`` column rather than a row's date,
a release resolved once) all live in the reader and are not restated.

**And nothing here may sum a person's committees, ever.** A candidate who closes one
committee and opens another transfers the leftover money, and Minnesota records that
transfer as a ``Contribution`` from the old committee to the new one -- so the same
dollars sit in both committees' figures and a combined total counts them twice. Every
figure this module hands out is tagged with the committee that reported it by
``reported_by_one_committee``, and adding 2 of them raises ``CrossCommitteeTotal``
(``alethical/api/services/committee_amount.py``,
[#1663](https://github.com/alethical-org/alethical/issues/1663)).

The one query this module owns reads **dates and not money**: the first and last
payment date among a committee-year's named contributions. It is here because the
split cannot be honest without it, for a reason §7 states and no code enforced until
now.

Why the split is withheld more often than a design would guess
--------------------------------------------------------------

The split is *derived*: the committee's own reported total minus the named payments we
hold. Every way that subtraction can lie has to be checked before it is printed,
because a wrong remainder does not look wrong -- it looks like a fact about donors.

1. **The two figures can cover different periods.** The itemized download runs to
   20 July 2026 while a filer's most recent report may stop on 31 March. Subtracting
   one from the other then reports the difference between two calendars as a finding
   about donors. Measured on the live release, 12 Aug 2026: 36 of 835 committee-years
   for 2026 hold a payment dated after their own report's coverage end, and 1 of 851
   for 2025. The House Republican Campaign Committee (20010) is the sharpest -- its
   2026 named payments total $881,816.24 against a report of $399,275.76 through
   31 March, so an unguarded subtraction prints **minus $482,540.48** of unnamed money.
2. **Minnesota's two publications can contradict each other.** Where the committee's
   own filed report and our copy of the state's donation list state different itemized
   figures, the comparison in ``committee_stated_split`` records a disagreement, and
   Eugene ruled on 12 Aug 2026 that where 2 official sources disagree and we cannot
   derive the truth, we show both figures and say plainly that they disagree.
3. **A subtraction that comes out negative is not that.** It proves these 2 numbers
   cannot be subtracted and nothing more. Sometimes we can say why -- the committee has
   refiled the year's report and the total we hold is the superseded version's -- and
   sometimes we cannot, and those are 2 different sentences and neither is the one
   above (#1648).
4. **We can hold no named payments at all while the filing reports money.** "The state
   named nobody" and "we hold nobody" look identical on a card and are not the same
   claim (``CampaignFinanceReconcileOutcome.no_itemized_rows``). §7: "we hold no
   itemized rows" is never rendered as "this money had no names". Where the filing has
   been read and it names the money, the emptiness is provably our copy's and says so
   (#1682).

Each check is per committee-year and none of them blocks anything else: a committee
whose figures disagree withholds its own split while every other committee on every
other profile publishes normally.

The states are deliberately one field with a reason rather than several booleans,
because the page's behaviour is identical for every withheld reason -- both figures
shown, no split, no composition bar -- and only the sentence differs.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from alethical.api.services.campaign_finance_register import report_corrections
from alethical.api.services.committee_amount import reported_by
from alethical.api.services.committee_filing_schedule import (
    CommitteeFilingSchedule,
    committee_filing_schedule,
)
from alethical.api.services.committee_finance import (
    NOT_REPORTED,
    CommitteeFinance,
    committee_finance,
)
from alethical.api.services.committee_stated_split import (
    AGREES,
    DISAGREES,
    stated_split_for_year,
)
from alethical.api.services.independent_spending import (
    REPORTED,
    committees_outside_the_year,
    confirmed_committees,
)
from alethical.db.schema import load_schema
from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline.campaign_finance_filings import live_filings_snapshot

schema = load_schema()
CommitteeLinkReviewDecision = schema.CommitteeLinkReviewDecision
LegislatorCampaignCommittee = schema.LegislatorCampaignCommittee

Release = reader.Release

#: Nobody has reviewed this legislator's proposed committees yet. On a sitting
#: member's profile this is the state at launch: all 200 of them, because a proposal
#: is a question and only an answer is a link (§7).
LINK_UNCONFIRMED = "unconfirmed"
#: A person read this legislator's candidate committees and confirmed none of them.
#: Kept apart from ``LINK_UNCONFIRMED`` because §5.1 stores a rejection rather than
#: discarding it, and "we looked and it is not theirs" is a different fact from
#: "nobody has looked". §7 forbids a reader-facing card stating it as a finding on a
#: sitting member, since all 200 do appear in the Board's registered-filer directory,
#: so a surface renders it with the same wording as ``LINK_UNCONFIRMED``.
LINK_REVIEWED_NONE_CONFIRMED = "reviewed_none_confirmed"
#: At least one committee is confirmed as this legislator's for the year asked for.
LINK_CONFIRMED = "confirmed"

#: The split is honest and may be drawn.
SPLIT_SHOWN = "shown"
#: No official total for this committee-year, so there is no whole to divide. §7:
#: print the named payments alone, labelled as named payments, with no composition
#: bar. Never a partial figure under a caveat.
SPLIT_NO_REPORTED_TOTAL = "no_reported_total"
#: Minnesota's own report and Minnesota's own spreadsheet do not agree.
SPLIT_SOURCES_DISAGREE = "sources_disagree"
#: The two figures cover different periods, so the difference between them is not a
#: fact about donors.
SPLIT_PERIODS_DIFFER = "periods_differ"
#: The filing reports money and we hold no named payment for it.
SPLIT_NO_NAMED_PAYMENTS = "no_named_payments"
#: The committee's own filed report names money donor by donor and our copy of
#: Minnesota's donation list holds not one row of it for this year. Our gap, and a
#: different fact from ``SPLIT_NO_NAMED_PAYMENTS``, which is the honest shrug for a year
#: where nobody has checked the filing and the money may simply have come from donors
#: too small to name. Here the filing has been read and it names the money, so the
#: emptiness is provably our copy's rather than possibly the committee's
#: ([#1682](https://github.com/alethical-org/alethical/issues/1682)).
SPLIT_NAMED_PAYMENTS_NOT_IN_OUR_COPY = "named_payments_not_in_our_copy"
#: The official total we hold cannot be squared with the payments we hold, and the
#: committee has corrected this year's report since. Our stored total is the superseded
#: version's ([#1648](https://github.com/alethical-org/alethical/issues/1648)).
SPLIT_REPORTED_TOTAL_PREDATES_A_CORRECTION = "reported_total_predates_a_correction"
#: The official total we hold cannot be squared with the payments we hold and nothing
#: we hold says why. Not a disagreement between Minnesota's 2 publications: a
#: subtraction that will not run, which is a weaker thing to know and the only thing
#: known here.
SPLIT_FIGURES_DO_NOT_LINE_UP = "figures_do_not_line_up"

#: The committee's own filed report states the same itemized figure we hold, so the
#: split has been checked against the filing rather than only derived from it.
STATED_SPLIT_AGREES = "agrees"
#: Nobody has compared this committee-year against its own filed report yet. A fact
#: about us: the comparison costs a document request per filing, and it has been run
#: for 2025 and not for 2026 (measured on the live release, 13 Aug 2026: 296 of 312
#: candidate committee-years with our rows agree for 2025, and all 424 for 2026 are
#: unrun). The figures are still our best evidence, so they are shown and labelled
#: rather than blanked.
STATED_SPLIT_NOT_CHECKED = "not_checked"

#: A penny, matching the release-time reconciliation in
#: ``alethical/pipeline/campaign_finance.py``. Two sources rounding differently is not
#: a contradiction; a dollar apart is.
DISAGREEMENT_TOLERANCE = Decimal("0.01")


@dataclass(frozen=True)
class NamedMoneySplit:
    """How much of a committee-year's money carries a donor's name, and how much does not.

    ``unnamed_total`` is populated only when ``state`` is ``SPLIT_SHOWN``. Every other
    state means there is no honest remainder to state, and a surface shows the two
    figures it does have without subtracting them.

    ``first_payment_on`` and ``last_payment_on`` are facts about the payments we hold,
    never a claimed coverage period: §7 forbids hardcoding 1 January as a period start,
    and the filing's own start is not something any source we store states. So a page
    may say "payments dated 4 Jan to 20 Jul" and may not say "covers 1 Jan to 20 Jul".
    """

    state: str
    reported_total: Decimal | None
    reported_through: date | None
    named_total: Decimal | None
    named_payments: int | None
    #: The part of ``named_total`` that was cash, which is the only part the
    #: subtraction may use: the Board's reported contributions figure excludes donated
    #: goods and services while our itemized rows include them.
    named_cash_total: Decimal | None
    #: Named donations of goods and services rather than money. Shown on its own line
    #: because it is real money's worth that the reported total does not carry, so it
    #: can be neither added to the reported figure nor silently dropped.
    named_in_kind_total: Decimal | None
    unnamed_total: Decimal | None
    first_payment_on: date | None
    last_payment_on: date | None
    #: Whether the committee's own filed report was checked against our rows for this
    #: year, from ``committee_stated_split``. ``AGREES`` is the only value that lets a
    #: page say the split has been verified against the filing itself.
    stated_split_state: str


@dataclass(frozen=True)
class CommitteeMatchCheck:
    """The basis a person recorded when they confirmed one account belongs to one member.

    Read off the stored decision, never recomputed. A recomputed basis would describe
    today's records rather than what the reviewer saw, and the point of showing it is that a
    reader can hold us to the decision we actually made.
    """

    checked_on: date
    name_evidence: str | None
    register_verdict: str | None
    party_agreement: str | None
    party_of_party_unit_money: str | None


@dataclass(frozen=True)
class LegislatorCommitteeMoney:
    """One confirmed committee of this legislator's, with the year's money.

    ``office`` is what the reviewer recorded the committee as being for. It travels with
    the figure so a card can say which committee a number belongs to rather than only
    which year, and it is what ``is_for_a_legislative_office`` reads to keep a race for
    something else off this page.
    """

    registration_number: str
    committee_name_as_reviewed: str
    office_as_reviewed: str | None
    finance: CommitteeFinance | None
    split: NamedMoneySplit
    #: Which of the 6 filing-schedule states this committee-year is in, so the tab can
    #: say *why* a year is empty for this committee rather than reciting Minnesota's
    #: calendar in general ([#1642](https://github.com/alethical-org/alethical/issues/1642)).
    #: Keyed on the registration number, so it needs no confirmation of its own.
    schedule: CommitteeFilingSchedule
    #: What a person read when they decided this account is this member's, and the day they
    #: decided it. Served so the card can say so in its own words: the whole standard this
    #: product holds itself to on identity is that a named entity checked and signed, and a
    #: reader who cannot see that has to take it on trust (§5.1). The 3 values are the same
    #: ones stored on the decision, never recomputed here, so the page shows the basis of the
    #: decision that was actually made rather than what today's data would suggest.
    checked: CommitteeMatchCheck | None = None


@dataclass(frozen=True)
class CommitteeOutsideThisYear:
    """One confirmed committee this year's page leaves out, and whether it is closed.

    Served because "we left this out" and "there is nothing here" look identical to a
    reader, and the page used to say the first as though it were a fact about the
    committee's registration. The years on a link are the years money was **reported**
    (§5.1), so landing here means nothing was reported for that year and says nothing
    about whether the registration ran.

    ``closed_on`` is the only thing that may licence saying a registration ended, and it
    comes from the Board's own filer record rather than from the reported years.
    ``None`` therefore means 2 different things -- open, or absent from the filer list we
    hold -- and the page's wording for both is the same honest one, because we cannot
    tell them apart and must not guess.
    """

    registration_number: str
    committee_name_as_reviewed: str
    closed_on: date | None


@dataclass(frozen=True)
class LegislatorFinance:
    """Everything a legislator's campaign money tab may show for one year.

    ``committees`` is a list and never a total, and it cannot be turned into one: every
    money figure on it is a ``CommitteeAmount`` tagged with the committee that reported
    it, so adding 2 of them raises ``CrossCommitteeTotal`` (#1663). A person's
    committees pass money between each other, and Minnesota records that transfer the
    same way it records a donation, so the same dollars sit in both figures.

    ``other_office_committees`` counts this member's confirmed committees that this page
    deliberately leaves out because they are for a race other than a legislative seat.
    It is served rather than dropped in silence: a reader who knows their member ran for
    Attorney General should be told the money exists and is elsewhere, not left to
    conclude we missed it.
    """

    legislator_id: UUID
    year: int
    link_state: str
    committees: tuple[LegislatorCommitteeMoney, ...]
    other_office_committees: int
    committees_outside_this_year: tuple[CommitteeOutsideThisYear, ...] = ()

    def __post_init__(self) -> None:
        """Tag every figure with the committee that reported it, on construction.

        Here rather than at the one call site that builds this, deliberately. A call
        can be deleted while every test still passes, and then a person's committees
        quietly become summable again; a constructor cannot. Whatever builds a
        ``LegislatorFinance`` -- this module, a future one, a test -- gets figures that
        refuse to be added across committees (#1663).

        Tagging twice is harmless: it rewrites the same registration number.
        """
        object.__setattr__(
            self,
            "committees",
            tuple(reported_by_one_committee(entry) for entry in self.committees),
        )


#: The 2 offices a sitting member of the Minnesota Legislature holds, spelled exactly as
#: `alethical/pipeline/legislator_committee_match.py` parses them out of a committee's own
#: name. That vocabulary is closed and short, measured across the 11 Aug 2026 download:
#: House 1,078, Senate 473, Dist Court 54, Gov 66, Atty Gen 18, State Aud 17,
#: Sec of State 11, Sup Court 11, App Court 2, and 2 committees carrying no office at all.
#: A reviewer stores the parsed value verbatim, so an exact match is right here and a
#: substring search would only invent ways to be wrong.
LEGISLATIVE_OFFICES = frozenset({"House", "Senate"})


def is_for_a_legislative_office(office: str | None) -> bool:
    """Whether a confirmed committee belongs on a legislator's profile at all.

    §7: **money from a race for another office never appears under a legislator's
    profile.** A run for Attorney General is a real public record and putting its
    receipts under a state senator's name asserts something about their legislative work
    that no filing supports.

    **Matched against the office, never against the chamber the member sits in**, and
    that distinction is measured rather than stylistic. Liz Reyer sits in the House and
    has two live committees, "Reyer, Lizabeth House Committee" and "Reyer, Liz Senate
    Committee"; filtering to her own chamber would throw away a real committee of hers.
    Both are legislative, so both belong here.

    **A committee with no office recorded is kept.** 2 committees in the download carry
    no office at all, and absence is not evidence of another race. Hiding a member's real
    money on the strength of a blank field is the worse of the two errors available here,
    because a reader cannot tell a hidden figure from a figure that does not exist.
    """
    if not office:
        return True
    return office in LEGISLATIVE_OFFICES


def link_state(db: Session, legislator_id: UUID) -> str:
    """Whether anyone has confirmed which committees are this legislator's.

    Asked without a year, deliberately. Whether a *confirmed* link covers the year on
    screen is a question about that link's reviewed period and is answered per
    committee; whether anyone has looked at all is a question about the legislator and
    does not change when a reader switches years. Collapsing the two would make a
    member with a confirmed 2024-only committee read as unreviewed in 2026, which is
    the opposite of true.
    """
    decisions = set(
        db.scalars(
            select(LegislatorCampaignCommittee.decision).where(
                LegislatorCampaignCommittee.legislator_id == legislator_id
            )
        ).all()
    )
    if CommitteeLinkReviewDecision.confirmed in decisions:
        return LINK_CONFIRMED
    if decisions:
        return LINK_REVIEWED_NONE_CONFIRMED
    return LINK_UNCONFIRMED


@dataclass(frozen=True)
class ConfirmedCommitteeMember:
    """The one legislator a person has confirmed a committee belongs to.

    ``slug`` rather than the id alone, because a profile's address is the slug
    (``/legislators/melissa-hortman``) and a committee page's whole job here is to
    carry a reader there.
    """

    legislator_id: UUID
    slug: str
    full_name: str


def confirmed_member_for_committee(
    db: Session, registration_number: str
) -> ConfirmedCommitteeMember | None:
    """Which legislator, if any, a person has confirmed this committee belongs to.

    The reverse of ``link_state``: that one asks a legislator's question and this one
    asks a committee's, off the same table and the same single fact -- a row a named
    person wrote (§5.1). Nothing here infers, matches or scores; with no confirmed row
    the answer is ``None`` and the page keeps saying what it says today.

    **At most one row can come back, and the database is what guarantees it.** The
    partial unique index ``uq_legislator_campaign_committee_confirmed_registration``
    (migration ``0028_legislator_committee_link``) makes a *confirmed* registration
    number appear once in the whole table, which is also the index this query reads,
    so a committee cannot be published under 2 people's names and this lookup cannot
    be expensive. Rejections carry no such constraint -- the same number may be ruled
    out for several legislators -- and none of them reaches here.

    **Asked without a year, deliberately**, exactly as ``link_state`` is. Whose
    committee this is does not change when a reader switches filing year; the reviewed
    period bounds which *money* belongs on a profile, and that question is answered on
    the profile by ``confirmed_committees``.
    """
    row = db.execute(
        select(
            schema.Legislator.id,
            schema.Legislator.slug,
            schema.Legislator.full_name,
        )
        .join(
            LegislatorCampaignCommittee,
            LegislatorCampaignCommittee.legislator_id == schema.Legislator.id,
        )
        .where(
            LegislatorCampaignCommittee.registration_number == registration_number,
            LegislatorCampaignCommittee.decision
            == CommitteeLinkReviewDecision.confirmed,
        )
    ).first()
    if row is None:
        return None
    return ConfirmedCommitteeMember(legislator_id=row[0], slug=row[1], full_name=row[2])


def payment_dates(
    db: Session, release: Release, *, registration_number: str, year: int
) -> tuple[date | None, date | None]:
    """The first and last date among this committee-year's named contributions.

    Dates, not money: this module sums nothing, and the filter here is the same
    ``Receipt type = 'Contribution'`` the reader applies to the figure these dates
    describe, so the range always belongs to the payments the figure counts.

    Scoped on the file's own ``Year`` column for the same reason the reader is -- the
    column and the row's date are separate claims that disagree on 702 rows across the
    3 files -- so a returned date can legitimately fall outside ``year``, and that is a
    fact about the source rather than an error to hide.
    """
    row = db.execute(
        text(
            "SELECT min(receipt_date), max(receipt_date) "
            "  FROM cf_contribution_row "
            " WHERE snapshot_id = :snapshot "
            "   AND recipient_reg_num = :reg_num "
            "   AND year = :year "
            "   AND receipt_type = :contribution"
        ),
        {
            "snapshot": release.contributions.snapshot_id,
            "reg_num": registration_number,
            "year": year,
            "contribution": reader.CONTRIBUTION_RECEIPT,
        },
    ).first()
    if row is None:
        return None, None
    return row[0], row[1]


def named_money_split(
    finance: CommitteeFinance,
    *,
    first_payment_on: date | None,
    last_payment_on: date | None,
    named_cash_total: Decimal | None,
    withheld_filer_years: frozenset[tuple[str, int]],
    stated_split_state: str,
    report_corrections: int | None = None,
) -> NamedMoneySplit:
    """Whether this committee-year's split may be drawn, and what it is.

    The order of the checks is load-bearing and is the reason each one is named. A
    period mismatch is asked **before** the two totals are compared, because comparing
    figures that cover different periods produces a disagreement that is not one: the
    House Republican Campaign Committee's 2026 rows exceed its own reported total by
    $482,540.48 purely because our download runs 4 months further than its last report.
    Calling that "the sources disagree" would blame Minnesota for our arithmetic.

    **Only one of these states may say that Minnesota's 2 publications disagree, and it
    is the one backed by a verdict that compared them.** Three routes used to share
    ``SPLIT_SOURCES_DISAGREE`` and only the first established a disagreement at all:
    the stated-split verdict, an empty download, and a subtraction that came out
    negative. The other 2 are facts about our own copy, and printing them as Minnesota
    contradicting itself put a false sentence on 7 live committee pages, measured
    19 Aug 2026 (#1682, #1648). Each route now carries only what its own evidence
    supports.

    ``report_corrections`` is the highest version number the Board's catalogue holds for
    this committee-year's reports, from ``campaign_finance_register.report_corrections``:
    above 0 means the committee refiled with different figures, ``0`` means it did not,
    and ``None`` means we hold no version history and may not say either way.
    """
    money_in = finance.money_in
    named_total = money_in.itemized_contribution_total
    # §7's coverage-end guard, applied once and before anything reads these 2 figures.
    # The Board's totals route ignores the year it is asked for when that year has no
    # report and answers with the most recent report's figures instead, at HTTP 200 with
    # nothing in the response to say so. The coverage-end date is the only thing standing
    # between a page and printing last year's money under this year's heading, so a
    # figure whose coverage end is missing or falls outside the year asked for is not a
    # figure this page holds. It is checked up here rather than inside one branch because
    # a branch that returns before the check bypasses it, which is what the
    # stated-split branch below used to do.
    reported_total = money_in.reported_total
    reported_through = money_in.reported_through
    if (
        reported_total is None
        or reported_through is None
        or reported_through.year != finance.year
    ):
        # Both dropped rather than one. A coverage end from the wrong year printed
        # beside a figure is the caption §7 says this guard must not become.
        reported_total = None
        reported_through = None
    named_payments = money_in.itemized_contribution_payments
    in_kind_total = (
        named_total - named_cash_total
        if named_total is not None and named_cash_total is not None
        else None
    )

    def outcome(state: str, unnamed: Decimal | None = None) -> NamedMoneySplit:
        return NamedMoneySplit(
            state=state,
            reported_total=reported_total,
            reported_through=reported_through,
            named_total=named_total,
            named_payments=named_payments,
            named_cash_total=named_cash_total,
            named_in_kind_total=in_kind_total,
            unnamed_total=unnamed,
            first_payment_on=first_payment_on,
            last_payment_on=last_payment_on,
            stated_split_state=stated_split_state,
        )

    def cannot_be_subtracted() -> NamedMoneySplit:
        """The 2 figures will not subtract, and what we may say about why.

        Reached from a negative remainder and from the release's own withheld-filer
        list, which are the same evidence found at 2 different moments. Neither
        establishes that Minnesota's 2 publications disagree -- only that these 2
        numbers cannot be subtracted -- so neither may borrow the sentence that says
        they do (#1648).
        """
        if report_corrections is not None and report_corrections > 0:
            return outcome(SPLIT_REPORTED_TOTAL_PREDATES_A_CORRECTION)
        return outcome(SPLIT_FIGURES_DO_NOT_LINE_UP)

    if stated_split_state == DISAGREES:
        # The committee's own filed report states a different itemized figure from the
        # one we hold. That is #1433's check, and it catches the direction the release
        # reconciliation cannot: a filing that itemizes money our rows are missing
        # entirely, which would otherwise land silently in the unnamed figure and become
        # a positive claim that money had no donor. **76 committee-years in the live
        # release**, measured 18 Aug 2026 across 2024, 2025 and 2026 (#1496).
        #
        # It runs in both directions, which matters to the page and not to this branch:
        # 33 of the 76 are the filing naming more than we hold and 43 are us holding more
        # than it names. Both land here, so no wording downstream of this state may say
        # which figure is the larger one (`splitExplanation` in
        # `apps/frontend/src/lib/legislatorCampaignMoney.ts` said so until #1646 and was
        # wrong for 33 of them).
        if money_in.state == NOT_REPORTED:
            # We hold not one row for this committee-year while the filing names money
            # donor by donor, so there is nothing of Minnesota's to disagree with the
            # filing: the emptiness is our copy's. 14 committee-years in the live
            # release, measured 19 Aug 2026 (#1682), of which Kristin Robbins's governor
            # committee is the largest -- its own 2025 report names $533,295.01 and our
            # download holds none of it.
            #
            # ``NOT_REPORTED`` rather than "no total", deliberately: it means the
            # download covers this year and carries no contribution row for this
            # committee, which is a measured absence. ``UNAVAILABLE`` -- a stale copy, or
            # a year the download does not reach -- is not that fact and falls through.
            return outcome(SPLIT_NAMED_PAYMENTS_NOT_IN_OUR_COPY)
        return outcome(SPLIT_SOURCES_DISAGREE)

    if reported_total is None:
        # The coverage-end guard at the top of this function refused the figure, or
        # there was never one to refuse. Either way there is no whole to divide.
        return outcome(SPLIT_NO_REPORTED_TOTAL)

    # What the release itself decided, read before anything computed here. A release
    # records which filer-years its own reconciliation refused, and a surface honours
    # that decision rather than forming a second opinion against rows that may since
    # have been replaced. What it refused is the same negative subtraction the guard at
    # the foot of this function catches, so it reports the same states.
    if (finance.committee.registration_number, finance.year) in withheld_filer_years:
        return cannot_be_subtracted()

    if money_in.state != REPORTED:
        # Either we hold no named payment for a year the download covers
        # (``NOT_REPORTED``), or we hold rows we cannot total (``UNAVAILABLE``).
        # Either way the filing reports money we cannot account for by name, and
        # subtracting nothing from it would state that every dollar of it had no
        # donor. Fateh's Senate committee (18488) is the measured case: the filing
        # itemizes $2,300.00 for 2025 and our rows hold none of it.
        if money_in.state == NOT_REPORTED and reported_total == 0:
            # A reported nothing and a named nothing agree, and a verified zero is a
            # fact worth stating (rule 12, missing versus zero).
            return outcome(SPLIT_SHOWN, Decimal(0))
        return outcome(SPLIT_NO_NAMED_PAYMENTS)

    if last_payment_on is not None and last_payment_on > reported_through:
        return outcome(SPLIT_PERIODS_DIFFER)

    if named_cash_total is None:
        return outcome(SPLIT_NO_NAMED_PAYMENTS)

    # **Cash against cash.** The Board's reported contributions figure excludes donated
    # goods and services and our itemized rows include them, so subtracting the whole
    # itemized figure understates what went unnamed and manufactures disagreements that
    # are not one. In the live release 2,346 named contribution rows across 400
    # committee-years for 2025 and 2026 are in kind: Jim Nash's House committee holds
    # $250.00 of it in 2025, which moved the unnamed figure by exactly that much.
    remainder = reported_total - named_cash_total
    if remainder < 0:
        # Every negative, not merely a large one. A tolerance on the comparison and no
        # tolerance on the subtraction let a penny through as "-$0.01 of money with
        # nobody's name on it", which cannot be true of anything.
        #
        # Refusing the subtraction is the load-bearing half and does not change here.
        # What changes is what may be said about the refusal: a negative remainder
        # proves these 2 numbers cannot be subtracted and proves nothing about whether
        # Minnesota's 2 publications disagree. Wynfred Russell's House committee (19086)
        # is the measured case -- it filed an empty 2026 pre-primary report on 1 August,
        # corrected it on 10 August to name $20,750.00, our rows hold exactly that, and
        # the Board's totals service was still serving the superseded $0.00 8 days later.
        # Its 2 official figures agree once the corrected filing is used (#1648).
        return cannot_be_subtracted()

    return outcome(SPLIT_SHOWN, remainder)


def split_for_committee(
    db: Session,
    release: Release,
    *,
    registration_number: str,
    year: int,
    finance: CommitteeFinance,
    withheld_filer_years: frozenset[tuple[str, int]] | None = None,
) -> NamedMoneySplit:
    """One committee-year's split, assembled from the same inputs wherever it is asked.

    The legislator route and the committee page both show this split, and this is the
    one place that gathers its inputs -- the payment dates, the cash-only itemized
    figure, the release's own withheld filer-years, and the stated-split check --
    so the two surfaces cannot drift into different answers for the same committee
    ([#1442](https://github.com/alethical-org/alethical/issues/1442)).

    ``withheld_filer_years`` is a parameter so a caller looping over several committees
    can resolve the release-wide set once; a single-committee caller omits it.
    """
    if withheld_filer_years is None:
        withheld_filer_years = reader.filer_years_that_must_not_show_a_split(
            db, release
        )
    first_on, last_on = payment_dates(
        db, release, registration_number=registration_number, year=year
    )
    cash = next(
        (
            entry.total
            for entry in reader.contribution_cash(
                db, release, registration_number, years=[year]
            )
            if entry.year == year
        ),
        None,
    )
    stated = stated_split_for_year(db, release, registration_number, year)
    return named_money_split(
        finance,
        first_payment_on=first_on,
        last_payment_on=last_on,
        named_cash_total=cash,
        withheld_filer_years=withheld_filer_years,
        # Whether the committee has refiled this year's report with different figures.
        # Read from the Board's own report catalogue rather than inferred, and only
        # consulted where a subtraction has already refused to run.
        report_corrections=report_corrections(db, registration_number, year),
        # Only ``agrees`` is a pass. Everything else -- the Board serving no document,
        # our own reader failing to prove itself, or nobody having run the comparison
        # -- is a fact about the check rather than about the committee, and the page
        # says which it is rather than implying a verification that did not happen.
        stated_split_state=(
            STATED_SPLIT_AGREES
            if stated.status == AGREES
            else DISAGREES
            if stated.status == DISAGREES
            else STATED_SPLIT_NOT_CHECKED
        ),
    )


def reported_by_one_committee(
    entry: LegislatorCommitteeMoney,
) -> LegislatorCommitteeMoney:
    """Tag every money figure on this card with the committee that reported it.

    The whole guard for [#1663](https://github.com/alethical-org/alethical/issues/1663).
    After this, adding 2 of a person's committees together raises
    ``CrossCommitteeTotal`` rather than returning a number, so a page that sums them
    fails the moment it is written instead of publishing a figure that looks right.

    Why a person's committees may never be added, in 1 sentence: a candidate who closes
    one committee and opens another transfers the leftover money, Minnesota records
    that transfer as a ``Contribution`` from the old committee to the new one, so the
    same dollars sit in both committees' figures and a combined total counts them
    twice. Measured on the live release: 9 candidates, 30 payments, $121,241.64, and
    for 2 candidate-years **every dollar** a combined figure would show is the same
    money twice.

    Applied here rather than in ``committee_finance``, deliberately. A committee's own
    page shows 1 committee and its figure is correct; the risk exists only where a
    person's committees sit together, which is this page and nowhere else.

    Payment *counts* are left as plain integers. Rule 12's harm is a wrong dollar
    figure under a named person's photograph, and counts are not that; guarding them
    would widen the change without widening what it prevents.
    """
    number = entry.registration_number
    finance = entry.finance
    if finance is not None:
        finance = replace(
            finance,
            money_in=replace(
                finance.money_in,
                itemized_contribution_total=reported_by(
                    number, finance.money_in.itemized_contribution_total
                ),
                reported_total=reported_by(number, finance.money_in.reported_total),
                other_receipts=tuple(
                    replace(receipt, total=reported_by(number, receipt.total))
                    for receipt in finance.money_in.other_receipts
                ),
            ),
            money_out=replace(
                finance.money_out,
                itemized_payment_total=reported_by(
                    number, finance.money_out.itemized_payment_total
                ),
                reported_total=reported_by(number, finance.money_out.reported_total),
                by_type=tuple(
                    replace(bucket, total=reported_by(number, bucket.total))
                    for bucket in finance.money_out.by_type
                ),
            ),
        )
    split = replace(
        entry.split,
        reported_total=reported_by(number, entry.split.reported_total),
        named_total=reported_by(number, entry.split.named_total),
        named_cash_total=reported_by(number, entry.split.named_cash_total),
        named_in_kind_total=reported_by(number, entry.split.named_in_kind_total),
        unnamed_total=reported_by(number, entry.split.unnamed_total),
    )
    return replace(entry, finance=finance, split=split)


def legislator_finance(
    db: Session, release: Release, *, legislator_id: UUID, year: int
) -> LegislatorFinance:
    """This legislator's confirmed committees and their money for one year.

    An empty ``committees`` tuple is never on its own a statement about the
    legislator: read ``link_state`` first. With no confirmed link the honest sentence
    on a sitting member's profile is that their committees are on file with the state
    and we have not yet confirmed which is theirs -- never that no committee is
    registered for them, which §5.1 measured as false for all 200 sitting members.
    """
    state = link_state(db, legislator_id)
    confirmed = confirmed_committees(db, legislator_id, year=year)
    # §7's office boundary, applied here rather than trusted to the reviewer. A person
    # confirms that a committee is *this member's*, which is a different question from
    # whether it is their *legislative* committee, and a run for Attorney General is
    # both a real committee of theirs and a race this page may not report.
    links = [
        row for row in confirmed if is_for_a_legislative_office(row.office_as_reviewed)
    ]
    other_office = len(confirmed) - len(links)
    withheld = reader.filer_years_that_must_not_show_a_split(db, release)
    committees: list[LegislatorCommitteeMoney] = []
    for link in sorted(links, key=lambda row: row.registration_number):
        finance = committee_finance(
            db, release, registration_number=link.registration_number, year=year
        )
        # Read before the money, and never skipped when the money is missing: a year
        # with no figures is exactly the year whose emptiness needs explaining. It
        # comes off the Board's filings snapshot rather than off this release, so a
        # committee absent from one can still be answered from the other.
        schedule = committee_filing_schedule(db, link.registration_number, year=year)
        if finance is None:
            # A confirmed link to a registration number the current release holds no
            # record of. That is a fact about our download, not about the committee,
            # and the link stays visible so a reader sees which committee is missing
            # rather than a member who appears to have none.
            committees.append(
                LegislatorCommitteeMoney(
                    registration_number=link.registration_number,
                    committee_name_as_reviewed=link.committee_name_as_reviewed,
                    office_as_reviewed=link.office_as_reviewed,
                    finance=None,
                    schedule=schedule,
                    checked=_match_check(link),
                    split=NamedMoneySplit(
                        state=SPLIT_NO_REPORTED_TOTAL,
                        reported_total=None,
                        reported_through=None,
                        named_total=None,
                        named_payments=None,
                        named_cash_total=None,
                        named_in_kind_total=None,
                        unnamed_total=None,
                        first_payment_on=None,
                        last_payment_on=None,
                        stated_split_state=STATED_SPLIT_NOT_CHECKED,
                    ),
                )
            )
            continue
        committees.append(
            LegislatorCommitteeMoney(
                registration_number=link.registration_number,
                committee_name_as_reviewed=link.committee_name_as_reviewed,
                office_as_reviewed=link.office_as_reviewed,
                finance=finance,
                schedule=schedule,
                checked=_match_check(link),
                split=split_for_committee(
                    db,
                    release,
                    registration_number=link.registration_number,
                    year=year,
                    finance=finance,
                    withheld_filer_years=withheld,
                ),
            )
        )
    return LegislatorFinance(
        legislator_id=legislator_id,
        year=year,
        link_state=state,
        # Tagged by ``LegislatorFinance.__post_init__``, not here: from here on, adding
        # 2 of this person's committees together raises rather than returning a
        # number (#1663).
        committees=tuple(committees),
        other_office_committees=other_office,
        committees_outside_this_year=_committees_outside_this_year(
            db, legislator_id=legislator_id, year=year
        ),
    )


def _match_check(link) -> CommitteeMatchCheck | None:
    """The stored basis for one confirmed link, or None when it predates the columns.

    None rather than a guess: 4 nullable columns were added the day before the first sitting
    and a decision written before them genuinely has no stored basis (§5.1). The page says
    nothing at all in that case, which is the honest reading of an absent record.
    """
    if link.reviewed_at is None:
        return None
    if not any(
        (
            link.name_evidence_as_reviewed,
            link.filer_directory_as_reviewed,
            link.party_agreement_as_reviewed,
        )
    ):
        return None
    return CommitteeMatchCheck(
        checked_on=link.reviewed_at.date(),
        name_evidence=link.name_evidence_as_reviewed,
        register_verdict=link.filer_directory_as_reviewed,
        party_agreement=link.party_agreement_as_reviewed,
        party_of_party_unit_money=None,
    )


def _committees_outside_this_year(
    db: Session, *, legislator_id: UUID, year: int
) -> tuple[CommitteeOutsideThisYear, ...]:
    """The confirmed committees this year leaves out, each with its closing date if any.

    The closing date is read from the Board's filer record, never inferred from the
    reported years: 22 of the 23 committees that landed here on the day the first 200
    matches were confirmed are open, with no closing date, and had simply reported no
    money for the year on screen. Saying their registration had ended would have been
    false on a named person's page.
    """
    links = committees_outside_the_year(db, legislator_id, year=year)
    if not links:
        return ()
    closed_on = _closing_dates(db, [link.registration_number for link in links])
    return tuple(
        CommitteeOutsideThisYear(
            registration_number=link.registration_number,
            committee_name_as_reviewed=link.committee_name_as_reviewed,
            closed_on=closed_on.get(link.registration_number),
        )
        for link in sorted(links, key=lambda row: row.registration_number)
    )


def _closing_dates(
    db: Session, registration_numbers: list[str]
) -> dict[str, date | None]:
    """Each committee's closing date from the newest filer snapshot we hold.

    A missing row is a missing key, not a False: the filer list we hold not carrying a
    committee is our gap, and it may never render as the committee being open.
    """
    schema = load_schema()
    # The same snapshot ``committee_filing_schedule`` reads, through the same pointer, so
    # a committee cannot read as closed on one part of the page and open on another.
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return {}
    rows = db.execute(
        select(
            schema.CampaignFinanceFiler.registration_number,
            schema.CampaignFinanceFiler.termination_date,
        ).where(
            schema.CampaignFinanceFiler.snapshot_id == snapshot.id,
            schema.CampaignFinanceFiler.registration_number.in_(registration_numbers),
        )
    ).all()
    return {row[0]: row[1] for row in rows}
