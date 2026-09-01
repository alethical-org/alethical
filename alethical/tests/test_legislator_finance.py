"""What a legislator's campaign money tab must never claim (#1329).

The figure this page exists to show is the one nothing upstream computes: how much of
a committee's money reached it with a donor's name attached and how much did not. It
is *derived* -- the committee's own reported total minus the named payments we hold --
and a wrong remainder does not look wrong. It looks like a fact about donors.

So most of what follows is the same assertion from a different angle: **the split is
withheld unless the subtraction can be honest.** Each way it can lie was measured
against the live release on 12 Aug 2026 before it was written down here, and the
counts in the docstrings are that evidence rather than a requirement
(`docs/architecture/campaign-finance-system-design.md` §8).

The state machine is tested with no database at all, because it is a pure function of
one committee-year's figures and a date range. Only the 3 tests at the end need
Postgres: those check that a person's confirmed link is what decides whose money this
is, which is `docs/architecture/campaign-finance-system-design.md` §5 (Identity) and
the one thing no amount of arithmetic can recover from getting wrong.

The last 3 need the local Postgres on port 54329.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import text

from alethical.api.services.committee_finance import (
    NOT_REPORTED,
    current_release,
    REPORTED,
    UNAVAILABLE,
    Committee,
    CommitteeFinance,
    IndependentSpendingAbout,
    MoneyIn,
    MoneyOut,
)
from alethical.api.services.committee_stated_split import AGREES, DISAGREES, NOT_RUN
from alethical.api.services import committee_filing_schedule as schedule_service
from alethical.api.services.legislator_finance import (
    STATED_SPLIT_AGREES,
    STATED_SPLIT_NOT_CHECKED,
    LINK_CONFIRMED,
    LINK_REVIEWED_NONE_CONFIRMED,
    LINK_UNCONFIRMED,
    is_for_a_legislative_office,
    SPLIT_FIGURES_DO_NOT_LINE_UP,
    SPLIT_NAMED_PAYMENTS_NOT_IN_OUR_COPY,
    SPLIT_NO_NAMED_PAYMENTS,
    SPLIT_NO_REPORTED_TOTAL,
    SPLIT_REPORTED_TOTAL_PREDATES_A_CORRECTION,
    SPLIT_PERIODS_DIFFER,
    SPLIT_SHOWN,
    SPLIT_SOURCES_DISAGREE,
    legislator_finance,
    link_state,
    named_money_split,
)
from alethical.db import models
from alethical.db.session import get_session_factory

# Real registration numbers and real figures from the live release, so a reader can
# check any of these against the Board's own publications.
HRCC = "20010"  # House Republican Campaign Committee.
FATEH_SENATE = "18488"  # Fateh, Omar Senate Committee.
NASH_HOUSE = "17709"  # Nash, Jim House Committee.
ROBBINS_GOVERNOR = "19244"  # Robbins, Kristin Gov Committee.


def _finance(
    *,
    registration_number: str = NASH_HOUSE,
    year: int = 2025,
    money_in_state: str = REPORTED,
    named_total: str | None = "10730.30",
    named_payments: int | None = 30,
    reported_total: str | None = "20552.62",
    reported_through: date | None = date(2025, 12, 31),
) -> CommitteeFinance:
    """One committee-year as ``committee_finance`` would return it."""
    return CommitteeFinance(
        committee=Committee(registration_number, "A Committee", "PCC", None),
        year=year,
        release_id=uuid.uuid4(),
        fetched_at=datetime(2026, 8, 12, 2, 54, tzinfo=UTC),
        money_in=MoneyIn(
            state=money_in_state,
            itemized_contribution_total=(
                None if named_total is None else Decimal(named_total)
            ),
            itemized_contribution_payments=named_payments,
            other_receipts=(),
            reported_total=(
                None if reported_total is None else Decimal(reported_total)
            ),
            reported_through=reported_through,
            reported_period_start=None,
            source_url="https://cfb.mn.gov/reports/contributions.csv",
        ),
        money_out=MoneyOut(
            REPORTED, Decimal("1000.00"), 3, (), Decimal("0"), None, None, None
        ),
        independent_spending=IndependentSpendingAbout(REPORTED, None, None),
    )


def _split(
    finance: CommitteeFinance,
    *,
    last_payment_on: date | None,
    withheld=(),
    cash: str | None = "__same__",
    stated: str = STATED_SPLIT_NOT_CHECKED,
    corrections: int | None = None,
):
    """``cash`` defaults to "all of it was cash", which is 400 committee-years short of
    the truth and the right default for a test about something else."""
    whole = finance.money_in.itemized_contribution_total
    named_cash = (
        whole if cash == "__same__" else (None if cash is None else Decimal(cash))
    )
    return named_money_split(
        finance,
        first_payment_on=date(finance.year, 1, 4),
        last_payment_on=last_payment_on,
        named_cash_total=named_cash,
        withheld_filer_years=frozenset(withheld),
        stated_split_state=stated,
        report_corrections=corrections,
    )


def test_an_ordinary_committee_year_states_what_had_no_name_on_it():
    """The whole point of the page, and the case 289 of 2025's candidate committees are in.

    Jim Nash's House committee reported $20,552.62 of contributions for 2025 and the
    itemized download names $10,730.30 of it across 30 payments. So $9,822.32 -- 48
    cents in every dollar -- reached the committee without a donor's name, because
    Minnesota names a donor only once their giving passes $200 in aggregate for the
    year.
    """
    split = _split(_finance(), last_payment_on=date(2025, 11, 12))

    assert split.state == SPLIT_SHOWN
    assert split.unnamed_total == Decimal("9822.32")
    assert split.named_total == Decimal("10730.30")
    assert split.reported_total == Decimal("20552.62")


def test_two_figures_covering_different_periods_are_never_subtracted():
    """The trap that ruins the biggest committee on the page, with real numbers.

    The itemized download runs to 20 July 2026 while the House Republican Campaign
    Committee's most recent report stops on 31 March. Its named payments for 2026
    total $881,816.24 against a reported $399,275.76, so subtracting one from the
    other prints **minus $482,540.48** of unnamed money -- a figure produced entirely
    by the two sources covering different months.

    Measured on the live release: 36 of 835 committee-years for 2026 hold a payment
    dated after their own report's coverage end, and 28 of those are candidate
    committees, which is what a legislator's profile shows.

    Both figures survive; only the subtraction is withheld.
    """
    split = _split(
        _finance(
            registration_number=HRCC,
            year=2026,
            named_total="881816.24",
            named_payments=272,
            reported_total="399275.76",
            reported_through=date(2026, 3, 31),
        ),
        last_payment_on=date(2026, 7, 20),
    )

    assert split.state == SPLIT_PERIODS_DIFFER
    assert split.unnamed_total is None
    assert split.named_total == Decimal("881816.24")
    assert split.reported_total == Decimal("399275.76")
    assert split.reported_through == date(2026, 3, 31)


def test_a_period_mismatch_is_not_reported_as_the_sources_disagreeing():
    """Order of checks, pinned, because both fire on the same committee-year.

    The House Republican Committee's 2026 rows do exceed its own reported total, so a
    naive check would announce that Minnesota contradicts itself. It does not: our
    download simply runs 4 months further than its last report. Blaming the source for
    our arithmetic is its own false claim, so the period question is asked first.
    """
    split = _split(
        _finance(
            registration_number=HRCC,
            year=2026,
            named_total="881816.24",
            reported_total="399275.76",
            reported_through=date(2026, 3, 31),
        ),
        last_payment_on=date(2026, 7, 20),
    )

    assert split.state != SPLIT_SOURCES_DISAGREE


def test_named_payments_exceeding_the_filers_own_total_withhold_the_split():
    """The subtraction refuses to run, and does not blame Minnesota for refusing.

    Within one period, our named payments cannot exceed what the filer told the state
    it raised. Where they do, the remainder is negative, and §9.5 is explicit that a
    negative result is a failed reconciliation rather than a number to clamp to zero.
    Withholding the split is the load-bearing half and is unchanged.

    What the state may **not** say is that Minnesota's 2 publications disagree, which
    this used to say. A negative remainder establishes that these 2 numbers cannot be
    subtracted and nothing else; the one check that compares the 2 publications is the
    stated split, and it has not spoken here (#1648).
    """
    split = _split(
        _finance(named_total="30000.00", reported_total="20552.62"),
        last_payment_on=date(2025, 12, 31),
    )

    assert split.state == SPLIT_FIGURES_DO_NOT_LINE_UP
    assert split.state != SPLIT_SOURCES_DISAGREE
    assert split.unnamed_total is None
    # Both figures are still there. The page shows them and subtracts nothing.
    assert split.named_total == Decimal("30000.00")
    assert split.reported_total == Decimal("20552.62")


def test_a_corrected_filing_is_told_apart_from_a_gap_nobody_can_explain():
    """The 2 shapes are one subtraction apart, and a test on the amount would pass either way.

    Wynfred Russell's House committee (19086) filed an empty 2026 pre-primary report on
    1 August, corrected it on 10 August to name $20,750.00, and our rows hold exactly
    that $20,750.00. The Board's totals service was still serving the superseded $0.00
    on 18 August, so our stored total is the superseded version's. That is our refresh
    gap, and the page may say so.

    The same arithmetic with no correction on the Board's catalogue is a gap we cannot
    explain, and it gets the quieter sentence. Both withhold the split; neither claims a
    disagreement.
    """
    corrected = _split(
        _finance(named_total="20750.00", reported_total="0.00", named_payments=29),
        last_payment_on=date(2025, 12, 31),
        corrections=1,
    )
    unexplained = _split(
        _finance(named_total="20750.00", reported_total="0.00", named_payments=29),
        last_payment_on=date(2025, 12, 31),
        corrections=0,
    )
    no_history = _split(
        _finance(named_total="20750.00", reported_total="0.00", named_payments=29),
        last_payment_on=date(2025, 12, 31),
        corrections=None,
    )

    assert corrected.state == SPLIT_REPORTED_TOTAL_PREDATES_A_CORRECTION
    assert unexplained.state == SPLIT_FIGURES_DO_NOT_LINE_UP
    # No version history is not "never corrected". A count we cannot compute is absent,
    # never 0 (rule 12), so it may not claim the correction either.
    assert no_history.state == SPLIT_FIGURES_DO_NOT_LINE_UP
    # Every one of them still shows both figures and subtracts neither.
    for split in (corrected, unexplained, no_history):
        assert split.unnamed_total is None
        assert split.reported_total == Decimal("0.00")
        assert split.named_total == Decimal("20750.00")


def test_a_penny_over_never_prints_a_penny_of_negative_unnamed_money():
    """Every negative is a disagreement, not only a large one.

    An earlier version tolerated a penny on the comparison and applied no tolerance to
    the subtraction, so $20,552.63 of named payments against a reported $20,552.62 was
    accepted and then printed **-$0.01 of donations with nobody's name on them**, which
    cannot be true of anything. Found by Codex on PR #1499.
    """
    split = _split(
        _finance(named_total="20552.63", reported_total="20552.62"),
        last_payment_on=date(2025, 12, 31),
    )

    assert split.state == SPLIT_FIGURES_DO_NOT_LINE_UP
    assert split.unnamed_total is None


def test_the_release_can_withhold_a_filer_year_this_arithmetic_would_publish():
    """A release records which filer-years its own reconciliation refused, and that wins.

    The check runs against the rows as they were at publish time and this page runs
    against whatever is loaded now, so a surface honours the release's decision rather
    than forming a second opinion. Empty in production today only because the live
    release predates the filings load that gives the check something to compare.
    """
    split = _split(
        _finance(registration_number=FATEH_SENATE),
        last_payment_on=date(2025, 11, 12),
        withheld={(FATEH_SENATE, 2025)},
    )

    # The same refusal the negative-remainder guard makes, found at publish time
    # instead, so it reports the same state rather than a disagreement it has no
    # verdict for.
    assert split.state == SPLIT_FIGURES_DO_NOT_LINE_UP
    assert split.unnamed_total is None


def test_holding_no_named_payment_never_becomes_money_that_had_no_donor():
    """§7's sentence, made a test: "we hold no itemized rows" is never "this money had no names".

    Omar Fateh's Senate committee is the measured case behind this: its filing
    itemizes $2,300.00 for 2025 and the bulk download carries none of it. Subtracting
    nothing from the reported total would print every dollar of it as unnamed
    small-donor money, which is a positive claim that money had no donor.

    Measured on the live release: 212 candidate committee-years in 2025 and 28 in 2026
    report contributions we hold no named payment for.
    """
    split = _split(
        _finance(
            registration_number=FATEH_SENATE,
            money_in_state=NOT_REPORTED,
            named_total=None,
            named_payments=None,
            reported_total="2300.00",
        ),
        last_payment_on=None,
    )

    assert split.state == SPLIT_NO_NAMED_PAYMENTS
    assert split.unnamed_total is None


def test_a_reported_zero_beside_a_named_zero_is_a_verified_zero():
    """Missing versus zero, in the one place the two genuinely agree (rule 12).

    A committee that told the state it took in nothing, and that the download names no
    payment for, really did report nothing. That is a fact worth stating, and it is
    the only route by which this page prints a 0.
    """
    split = _split(
        _finance(
            money_in_state=NOT_REPORTED,
            named_total=None,
            named_payments=None,
            reported_total="0",
        ),
        last_payment_on=None,
    )

    assert split.state == SPLIT_SHOWN
    assert split.unnamed_total == Decimal(0)


def test_rows_we_cannot_total_never_read_as_money_without_a_donor():
    """``UNAVAILABLE`` is a gap in our copy, and it must not be spent as a finding.

    A committee-year holding a payment with no amount cannot be summed, so the named
    figure is withheld upstream. The split must withhold too: treating an
    uncomputable named total as zero would hand the whole reported figure to the
    unnamed bucket.
    """
    split = _split(
        _finance(
            money_in_state=UNAVAILABLE,
            named_total=None,
            named_payments=None,
        ),
        last_payment_on=None,
    )

    assert split.state == SPLIT_NO_NAMED_PAYMENTS
    assert split.unnamed_total is None


def test_a_total_whose_coverage_ends_in_another_year_is_not_printed_at_all():
    """§7's coverage-end guard, and it is a guard rather than a caption.

    The Board's totals route ignores the year it is asked for when that year has no
    report, and answers with the most recent report's figures at HTTP 200 with nothing
    in the response to say so. Measured on 8 filers with a 2025 report and no 2026
    one: all 8 answered a 2026 request with their 2025 figures, byte for byte. So a
    figure whose coverage end falls outside the year asked for is dropped rather than
    captioned, because a caption under a large number loses to the number.
    """
    split = _split(
        _finance(year=2026, reported_through=date(2025, 12, 31)),
        last_payment_on=date(2026, 7, 20),
    )

    assert split.state == SPLIT_NO_REPORTED_TOTAL
    assert split.reported_total is None
    assert split.reported_through is None
    # The named payments are ours and stay, labelled as named payments.
    assert split.named_total == Decimal("10730.30")


def test_a_total_with_no_coverage_end_is_dropped_for_the_same_reason():
    """No coverage end means no way to check the guard above, so the figure is not ours to print."""
    split = _split(
        _finance(reported_through=None),
        last_payment_on=date(2025, 11, 12),
    )

    assert split.state == SPLIT_NO_REPORTED_TOTAL
    assert split.reported_total is None


def test_no_official_total_leaves_the_named_payments_standing_alone():
    """Special-election filers, and every year the totals route cannot speak for.

    Such a filer files a second report series the route does not return, so its
    regular figures are a part of the year rather than the year. §7: print the named
    payments alone, labelled as named payments, with no composition bar, because there
    is no whole to divide.
    """
    split = _split(_finance(reported_total=None), last_payment_on=date(2025, 11, 12))

    assert split.state == SPLIT_NO_REPORTED_TOTAL
    assert split.named_total == Decimal("10730.30")
    assert split.named_payments == 30


def test_payment_dates_are_carried_but_are_never_a_coverage_period():
    """Both ends travel with the figure so a page can date the payments it lists.

    They describe the payments we hold and nothing else. §7 forbids hardcoding
    1 January as a period start -- filer 19223 reports from 11 July 2025 -- so a
    surface may say "payments dated 4 Jan to 12 Nov" and may never turn that into
    "covers 1 Jan to 12 Nov".
    """
    split = _split(_finance(), last_payment_on=date(2025, 11, 12))

    assert split.first_payment_on == date(2025, 1, 4)
    assert split.last_payment_on == date(2025, 11, 12)


def test_donated_goods_are_not_subtracted_from_a_cash_only_reported_total():
    """The measured defect this page shipped with, on the very committee in its guide.

    Minnesota's reported contributions figure excludes donated goods and services, and
    our itemized rows include them, so subtracting the whole itemized figure understates
    what went unnamed. Jim Nash's House committee holds $250.00 of donated goods in
    2025: the wrong subtraction gives $9,822.32 of unnamed money and the right one gives
    $10,072.32. 2,346 named contribution rows across 400 committee-years for 2025 and
    2026 are in kind, so this is ordinary rather than rare.
    """
    split = _split(_finance(), last_payment_on=date(2025, 11, 12), cash="10480.30")

    assert split.state == SPLIT_SHOWN
    assert split.unnamed_total == Decimal("10072.32")
    # The whole itemized figure still stands as what the committee actually received.
    assert split.named_total == Decimal("10730.30")
    assert split.named_in_kind_total == Decimal("250.00")


def test_in_kind_alone_never_manufactures_a_disagreement():
    """Folding the two together makes our sum exceed the Board's figure on 24 filer-years
    against 15 on cash alone, so 9 of those disagreements would be our arithmetic rather
    than Minnesota's data.
    """
    split = _split(
        _finance(named_total="21000.00", reported_total="20552.62"),
        last_payment_on=date(2025, 11, 12),
        cash="20000.00",
    )

    assert split.state == SPLIT_SHOWN
    assert split.unnamed_total == Decimal("552.62")


def test_a_filing_that_itemizes_more_than_we_hold_withholds_the_split():
    """#1433's check, which catches the direction the release reconciliation cannot.

    A filing can state a larger itemized figure than our rows carry, and that shortfall
    lands silently in the unnamed figure where it becomes a positive claim that money
    had no donor. 14 committee-years in the live release disagree this way, 3 of them
    candidate committees for 2025.
    """
    split = _split(_finance(), last_payment_on=date(2025, 11, 12), stated=DISAGREES)

    assert split.state == SPLIT_SOURCES_DISAGREE
    assert split.unnamed_total is None
    # Both official figures survive. The page shows them and subtracts neither.
    assert split.reported_total == Decimal("20552.62")
    assert split.named_total == Decimal("10730.30")


def test_an_empty_download_is_never_dressed_as_minnesota_contradicting_itself():
    """#1682, and the 7th empty-year state #1642 found, are one state seen twice.

    A committee-year where the filing names money donor by donor and our copy of the
    state's donation list holds not one row is not 2 official sources disagreeing. It
    is our copy being empty, and there is nothing of Minnesota's on our side of the
    comparison to disagree with anything.

    **14 committee-years in the live release, measured 19 Aug 2026**, and 6 of them
    printed "for this committee and year they do not agree" on a live committee page.
    Kristin Robbins's governor committee is the largest: its own 2025 report names
    $533,295.01 and our download holds none of it.

    The distinguishing fact is ``money_in.state``. ``not_reported`` means the download
    covers this year and carries no row for this committee, which is a measured
    absence. ``unavailable`` -- a stale copy of ours, or a year the download does not
    reach -- is not that fact, so it keeps the disagreement it has a verdict for.
    """
    empty = _split(
        _finance(
            registration_number=ROBBINS_GOVERNOR,
            money_in_state=NOT_REPORTED,
            named_total=None,
            named_payments=None,
            reported_total="553925.86",
        ),
        last_payment_on=None,
        cash=None,
        stated=DISAGREES,
    )
    rows_we_cannot_total = _split(
        _finance(
            money_in_state=UNAVAILABLE,
            named_total=None,
            named_payments=None,
        ),
        last_payment_on=None,
        cash=None,
        stated=DISAGREES,
    )

    assert empty.state == SPLIT_NAMED_PAYMENTS_NOT_IN_OUR_COPY
    assert empty.state != SPLIT_SOURCES_DISAGREE
    assert rows_we_cannot_total.state == SPLIT_SOURCES_DISAGREE
    # The committee's own reported total still shows. Only the subtraction is withheld.
    assert empty.reported_total == Decimal("553925.86")
    assert empty.named_total is None
    assert empty.unnamed_total is None


def test_a_year_nobody_checked_never_borrows_the_missing_copy_sentence():
    """The near-identical sibling, and why they may not share a sentence.

    468 committee-years in the live release hold no named payment against a reported
    total, and for **none** of them has the filing been read. A committee whose donors
    all gave $200 or less in the year is never itemized, so those may be perfectly
    complete. Saying our copy is missing the money would be a claim about Minnesota's
    export that nothing we hold supports.
    """
    unchecked = _split(
        _finance(
            money_in_state=NOT_REPORTED,
            named_total=None,
            named_payments=None,
            reported_total="4000.00",
        ),
        last_payment_on=None,
        cash=None,
    )

    assert unchecked.state == SPLIT_NO_NAMED_PAYMENTS
    assert unchecked.state != SPLIT_NAMED_PAYMENTS_NOT_IN_OUR_COPY


def test_a_stated_split_disagreement_never_prints_a_total_from_another_year():
    """§7's coverage-end guard, which the stated-split branch used to return before.

    The Board's totals route answers a year it has no report for with the most recent
    report's figures, at HTTP 200 with nothing in the response to say so, so a coverage
    end outside the year asked for is the only tell. No committee-year on the live
    release trips this today (0 of 76 measured 19 Aug 2026), which is exactly why a
    branch that skipped the guard could sit there unnoticed.
    """
    stale = _split(
        _finance(
            year=2026, reported_total="20552.62", reported_through=date(2025, 12, 31)
        ),
        last_payment_on=None,
        stated=DISAGREES,
    )

    assert stale.reported_total is None
    assert stale.reported_through is None


def test_a_checked_split_is_told_apart_from_an_unchecked_one():
    """Shown either way, and never allowed to read as the same thing.

    The comparison costs a document request per filing and has been run for 2025 and not
    for 2026: 296 of 312 candidate committee-years with our rows agree for 2025, and all
    424 for 2026 are unrun. Blanking every 2026 profile would be a bigger distortion than
    labelling the figure, so the state travels with it and the page says which it is.
    """
    checked = _split(
        _finance(), last_payment_on=date(2025, 11, 12), stated=STATED_SPLIT_AGREES
    )
    unchecked = _split(_finance(), last_payment_on=date(2025, 11, 12))

    assert checked.state == SPLIT_SHOWN
    assert unchecked.state == SPLIT_SHOWN
    assert checked.stated_split_state == STATED_SPLIT_AGREES
    assert unchecked.stated_split_state == STATED_SPLIT_NOT_CHECKED
    assert AGREES == STATED_SPLIT_AGREES
    assert NOT_RUN != STATED_SPLIT_AGREES


# --- Which of a member's committees belong on a legislative profile ----------


def test_a_members_house_and_senate_committees_both_belong_here():
    """Matched on the office, never on the chamber the member sits in.

    Liz Reyer sits in the House and has 2 live committees: "Reyer, Lizabeth House
    Committee" and "Reyer, Liz Senate Committee". Filtering to her own chamber would
    throw away a real committee of hers, which is why the test is on the office being
    legislative at all rather than on it matching the seat.
    """
    assert is_for_a_legislative_office("House")
    assert is_for_a_legislative_office("Senate")


def test_a_run_at_a_different_office_never_reaches_a_legislative_profile():
    """§7: money from a race for another office never appears under a legislator's profile.

    A run for Attorney General is a real public record and a committee a person may well
    confirm as this member's. Reporting its receipts under their legislative profile
    asserts something about their legislative work that no filing supports. The offices
    below are the rest of the closed vocabulary the committee names carry, measured on
    the 11 Aug 2026 download: Gov 66, Atty Gen 18, State Aud 17, Sec of State 11,
    Sup Court 11, Dist Court 54, App Court 2.
    """
    for office in (
        "Gov",
        "Atty Gen",
        "State Aud",
        "Sec of State",
        "Sup Court",
        "App Court",
        "Dist Court",
    ):
        assert not is_for_a_legislative_office(office), office


def test_a_committee_with_no_office_recorded_is_kept():
    """Absence is not evidence of another race, and hiding real money is the worse error.

    2 committees in the download carry no office at all ("Reyes, Peter M Jr Committee",
    "Brown, Anthony L Committee"). A reader cannot tell a hidden figure from a figure
    that does not exist, so a blank field never removes a member's money.
    """
    assert is_for_a_legislative_office(None)
    assert is_for_a_legislative_office("")


# --- Whose money this is, which only a person decides ------------------------


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    session.execute(text("DELETE FROM legislator_campaign_committee"))
    session.commit()
    try:
        yield session
    finally:
        session.rollback()
        session.execute(text("DELETE FROM legislator_campaign_committee"))
        session.commit()
        session.close()


def _legislator(db) -> uuid.UUID:
    row = db.execute(text("SELECT id FROM legislator LIMIT 1")).first()
    assert row is not None, "the seeded corpus should hold at least one legislator"
    return row[0]


def test_a_member_nobody_has_reviewed_reads_as_unreviewed(db):
    """The state every one of the 200 sitting members was in on the day this shipped.

    Minnesota publishes no link between a committee and a human, so a person confirms
    each one by hand and signs it. Until then this is the tab, not an edge case, and
    §7 requires the honest sentence to be that their committees are on file with the
    state and we have not yet confirmed which is theirs.
    """
    assert link_state(db, _legislator(db)) == LINK_UNCONFIRMED


def test_a_rejection_is_not_the_same_fact_as_nobody_having_looked(db):
    """§5.1 stores a rejection rather than discarding it, and the two states stay apart.

    A reader-facing card words them the same way -- all 200 sitting members do appear
    in the Board's registered-filer directory, so "checked, and none is theirs" on a
    sitting member means their committee exists and we failed to surface it, never
    that none is registered. Keeping the values distinct is what lets that be
    noticed rather than blamed on the reader's member.
    """
    legislator_id = _legislator(db)
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=legislator_id,
            registration_number=FATEH_SENATE,
            decision=models.CommitteeLinkReviewDecision.rejected,
            committee_name_as_reviewed="Fateh, Omar Senate Committee",
            reviewed_by="a person",
        )
    )
    db.commit()

    assert link_state(db, legislator_id) == LINK_REVIEWED_NONE_CONFIRMED


def test_a_confirmed_link_outside_the_year_still_counts_as_reviewed(db):
    """Asked without a year, deliberately.

    Whether a confirmed link covers the year on screen is a question about that link's
    reviewed period, answered per committee. Whether anyone has looked at all is a
    question about the legislator, and it does not change when a reader switches
    years. Collapsed into one, a member with a confirmed 2024-only committee would
    read as unreviewed in 2026, which is the opposite of true.
    """
    legislator_id = _legislator(db)
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=legislator_id,
            registration_number=NASH_HOUSE,
            decision=models.CommitteeLinkReviewDecision.confirmed,
            committee_name_as_reviewed="Nash, Jim House Committee",
            first_year_as_reviewed="2023",
            last_year_as_reviewed="2024",
            reviewed_by="a person",
        )
    )
    db.commit()

    assert link_state(db, legislator_id) == LINK_CONFIRMED


@pytest.fixture()
def published_release(db):
    """An empty published release, cleaned up after.

    The cleanup is the point. A release row left behind holds a foreign key onto
    ``cf_snapshot``, and the next test module to clear that table fails on the
    constraint rather than on anything it did -- 15 errors in one run, from one row.
    """
    row = models.CampaignFinanceRelease(
        contributions_snapshot_id=_finance_snapshot(
            db, models.CampaignFinanceDataset.contributions
        ).id,
        expenditures_snapshot_id=_finance_snapshot(
            db, models.CampaignFinanceDataset.expenditures
        ).id,
        independent_expenditures_snapshot_id=_finance_snapshot(
            db, models.CampaignFinanceDataset.independent_expenditures
        ).id,
        status=models.CampaignFinanceReleaseStatus.published,
        fetch_started_at=datetime(2026, 8, 12, 2, 52, tzinfo=UTC),
        fetch_completed_at=datetime(2026, 8, 12, 2, 54, tzinfo=UTC),
        published_at=datetime(2026, 8, 12, 2, 56, tzinfo=UTC),
    )
    db.add(row)
    db.flush()
    db.execute(
        text(
            "INSERT INTO cf_current_release (id, release_id) VALUES (true, :rid) "
            "ON CONFLICT (id) DO UPDATE SET release_id = EXCLUDED.release_id"
        ),
        {"rid": row.id},
    )
    db.commit()
    resolved = current_release(db)
    assert resolved is not None
    try:
        yield resolved
    finally:
        db.rollback()
        db.execute(text("UPDATE cf_current_release SET release_id = NULL"))
        db.execute(text("DELETE FROM cf_release WHERE id = :rid"), {"rid": row.id})
        db.execute(
            text("DELETE FROM cf_snapshot WHERE id = ANY(:ids)"),
            {
                "ids": [
                    row.contributions_snapshot_id,
                    row.expenditures_snapshot_id,
                    row.independent_expenditures_snapshot_id,
                ]
            },
        )
        db.commit()


def _finance_snapshot(db, dataset):
    """One loaded snapshot of a bulk download, holding no rows.

    Rows are beside the point here: what is under test is that a confirmed committee
    reaches the tab carrying a schedule at all, and an empty release is the state where
    forgetting it would be invisible.
    """
    marker = f"{dataset.value}-{uuid.uuid4()}"
    snapshot = models.CampaignFinanceSnapshot(
        dataset=dataset,
        download_id="-617535497",
        source_url="https://cfb.mn.gov/reports/contributions.csv",
        content_hash=hashlib.sha256(marker.encode()).hexdigest(),
        record_set_hash=hashlib.sha256(f"records-{marker}".encode()).hexdigest(),
        byte_size=1024,
        status=models.CampaignFinanceSnapshotStatus.loaded,
    )
    db.add(snapshot)
    db.flush()
    return snapshot


def test_every_confirmed_committee_carries_a_reason_its_year_may_be_empty(
    db, published_release
):
    """The tab cannot say *why* a year is blank unless it is handed the reason (#1642).

    Deliberately run against a committee the release does not hold, which is the branch
    most likely to be forgotten: the year has no figures at all, so it is exactly the
    year whose emptiness needs explaining. The schedule comes off the Board's filings
    snapshot rather than off this release, so one being empty does not silence the
    other.

    With no filings snapshot published in a test database, the honest answer is that our
    own copy cannot answer -- which is one of the 3 states rule 12 requires be worded as
    ours rather than as the committee's.
    """
    legislator_id = _legislator(db)
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=legislator_id,
            registration_number=NASH_HOUSE,
            decision=models.CommitteeLinkReviewDecision.confirmed,
            committee_name_as_reviewed="Nash, Jim House Committee",
            office_as_reviewed="House",
            reviewed_by="a person",
        )
    )
    db.commit()

    finance = legislator_finance(
        db, published_release, legislator_id=legislator_id, year=2026
    )

    assert len(finance.committees) == 1
    entry = finance.committees[0]
    assert entry.finance is None
    assert entry.schedule.state == schedule_service.FILINGS_CANNOT_ANSWER
    assert entry.schedule.next_report_due_on is None
