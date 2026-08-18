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

**Every money figure comes from ``committee_finance``, which comes from
``campaign_finance_reader``.** Nothing here sums a payment. The 4 source behaviours
that make a plausible query silently wrong (both expenditure labels counted, receipts
filtered to ``Contribution``, the file's own ``Year`` column rather than a row's date,
a release resolved once) all live in the reader and are not restated.

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
2. **Minnesota's two publications can contradict each other.** Where our named
   payments exceed what the filer told the state it raised, the remainder is negative
   and §9.5 is explicit that a negative result is a failed reconciliation rather than a
   number to clamp. Eugene ruled on 12 Aug 2026 that where 2 official sources disagree
   and we cannot derive the truth, we show both figures and say plainly that they
   disagree.
3. **We can hold no named payments at all while the filing reports money.** "The state
   named nobody" and "we hold nobody" look identical on a card and are not the same
   claim (``CampaignFinanceReconcileOutcome.no_itemized_rows``). §7: "we hold no
   itemized rows" is never rendered as "this money had no names".

Each check is per committee-year and none of them blocks anything else: a committee
whose figures disagree withholds its own split while every other committee on every
other profile publishes normally.

The states are deliberately one field with a reason rather than several booleans,
because the page's behaviour is identical for every withheld reason -- both figures
shown, no split, no composition bar -- and only the sentence differs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

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
    confirmed_committees,
)
from alethical.db.schema import load_schema
from alethical.pipeline import campaign_finance_reader as reader

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


@dataclass(frozen=True)
class LegislatorFinance:
    """Everything a legislator's campaign money tab may show for one year.

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
) -> NamedMoneySplit:
    """Whether this committee-year's split may be drawn, and what it is.

    The order of the checks is load-bearing and is the reason each one is named. A
    period mismatch is asked **before** the two totals are compared, because comparing
    figures that cover different periods produces a disagreement that is not one: the
    House Republican Campaign Committee's 2026 rows exceed its own reported total by
    $482,540.48 purely because our download runs 4 months further than its last report.
    Calling that "the sources disagree" would blame Minnesota for our arithmetic.
    """
    money_in = finance.money_in
    reported_total = money_in.reported_total
    reported_through = money_in.reported_through
    named_total = money_in.itemized_contribution_total
    named_payments = money_in.itemized_contribution_payments
    in_kind_total = (
        named_total - named_cash_total
        if named_total is not None and named_cash_total is not None
        else None
    )

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
        # `apps/frontend/src/lib/legislatorCampaignMoney.ts` said so until #1496 and was
        # wrong for 33 of them — reached by no reader, because the money section needs a
        # confirmed member-to-committee match and `legislator_campaign_committee` holds 0
        # rows in production, but wrong in shipped code all the same).
        return NamedMoneySplit(
            state=SPLIT_SOURCES_DISAGREE,
            reported_total=reported_total,
            reported_through=reported_through,
            named_total=named_total,
            named_payments=named_payments,
            named_cash_total=named_cash_total,
            named_in_kind_total=in_kind_total,
            unnamed_total=None,
            first_payment_on=first_payment_on,
            last_payment_on=last_payment_on,
            stated_split_state=stated_split_state,
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

    # §7's coverage-end guard, and it is a guard rather than a caption. The Board's
    # totals route ignores the year it is asked for when that year has no report and
    # answers with the most recent report's figures instead, at HTTP 200 with nothing
    # in the response to say so. The coverage-end date is the only thing standing
    # between a page and printing last year's money under this year's heading, so a
    # figure whose coverage end is missing or falls outside the year asked for is not
    # a figure this page holds.
    if (
        reported_total is None
        or reported_through is None
        or reported_through.year != finance.year
    ):
        return NamedMoneySplit(
            state=SPLIT_NO_REPORTED_TOTAL,
            # Both dropped rather than passed through. A figure that fails this guard
            # is one we may not print at all, and a coverage end from the wrong year
            # printed beside it would be the caption §7 says this must not become.
            reported_total=None,
            reported_through=None,
            named_total=named_total,
            named_payments=named_payments,
            named_cash_total=named_cash_total,
            named_in_kind_total=in_kind_total,
            unnamed_total=None,
            first_payment_on=first_payment_on,
            last_payment_on=last_payment_on,
            stated_split_state=stated_split_state,
        )

    # What the release itself decided, read before anything computed here. A release
    # records which filer-years its own reconciliation refused, and a surface honours
    # that decision rather than forming a second opinion against rows that may since
    # have been replaced.
    if (finance.committee.registration_number, finance.year) in withheld_filer_years:
        return outcome(SPLIT_SOURCES_DISAGREE)

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
        return outcome(SPLIT_SOURCES_DISAGREE)

    return outcome(SPLIT_SHOWN, remainder)


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
        first_on, last_on = payment_dates(
            db, release, registration_number=link.registration_number, year=year
        )
        cash = next(
            (
                entry.total
                for entry in reader.contribution_cash(
                    db, release, link.registration_number, years=[year]
                )
                if entry.year == year
            ),
            None,
        )
        stated = stated_split_for_year(db, release, link.registration_number, year)
        committees.append(
            LegislatorCommitteeMoney(
                registration_number=link.registration_number,
                committee_name_as_reviewed=link.committee_name_as_reviewed,
                office_as_reviewed=link.office_as_reviewed,
                finance=finance,
                split=named_money_split(
                    finance,
                    first_payment_on=first_on,
                    last_payment_on=last_on,
                    named_cash_total=cash,
                    withheld_filer_years=withheld,
                    # Only ``agrees`` is a pass. Everything else -- the Board serving no
                    # document, our own reader failing to prove itself, or nobody having
                    # run the comparison -- is a fact about the check rather than about
                    # the committee, and the page says which it is rather than implying
                    # a verification that did not happen.
                    stated_split_state=(
                        STATED_SPLIT_AGREES
                        if stated.status == AGREES
                        else DISAGREES
                        if stated.status == DISAGREES
                        else STATED_SPLIT_NOT_CHECKED
                    ),
                ),
            )
        )
    return LegislatorFinance(
        legislator_id=legislator_id,
        year=year,
        link_state=state,
        committees=tuple(committees),
        other_office_committees=other_office,
    )
