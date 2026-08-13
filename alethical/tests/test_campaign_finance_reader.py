"""What reading a published campaign-finance release must guarantee (#1330).

Every test here stands in for a way a party or caucus figure could be quietly wrong,
and each names the failure it prevents. The three that matter most, because each one
produces a number that looks right:

* **Filtering on one expenditure label drops a whole kind of filer.** In 2025 candidate
  committees filed 6,762 rows typed ``Campaign Expenditure`` and none typed
  ``General Expenditure``; party units filed 7,524 the other way round. A query naming
  either label returns a plausible total with an entire population missing.
* **A fifth of the "itemized contributions" file's party-unit rows are not
  contributions.** 6.57% of a party unit's 2025 rows carry another receipt type, which
  the filing reports on separate schedules, so they must leave the contribution figure
  without leaving the report.
* **An empty result can mean the set we were reading has been replaced.** The rows of a
  superseded release survive one further publish and then go, so 0 rows for a release
  id that exists is stale rather than an answer about a named organisation.

Rows arrive through the real loader and the fake Board from
``test_campaign_finance_load.py`` rather than being inserted by hand, so these tests
prove the reader reads what the writer actually writes, including the row numbers a
citation points at.

Fixtures are tiny and hand-written. §8 of
``docs/architecture/campaign-finance-system-design.md`` is explicit that every count in
that document is one day's measurement and never a thing to assert, so no real total
appears here. What the fixtures do reproduce verbatim are the source's awkward shapes:
a party unit and a candidate committee labelling the same spending differently, a
receipt that is not a contribution, a registration number whose band contradicts its
type, a committee whose name says "Caucus" and whose type says otherwise, and a payee
whose registration number is a negative placeholder for a local candidate the state
Board does not register.

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import json
import threading
from datetime import timedelta
from decimal import Decimal
from http.server import ThreadingHTTPServer
from typing import Iterator

import pytest
from sqlalchemy import text

from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.pipeline import campaign_finance as cf
from alethical.pipeline import campaign_finance_reader as reader
from alethical.tests.test_campaign_finance_load import (
    _Handler,
    FakeBoard,
    MemoryStore,
    _clear,
    publish_first,
)

Dataset = models.CampaignFinanceDataset

# --- The shapes that make a naive query wrong --------------------------------
#
# 20010 is a caucus committee, 20003 a state party unit, 19200 a candidate
# committee, 40993 a political committee whose *name* says "Caucus", and 40858 a
# state party unit whose number sits in the band people assume means a committee.

CONTRIBUTIONS = [
    # A caucus's ordinary contributions.
    '20010,HRCC,PTU,CAU,5000.0000,2025-03-04,2025,"Giver, Grace",,Individual,'
    "Contribution,No,,55101,",
    '20010,HRCC,PTU,CAU,2500.0000,2025-04-01,2025,"Fund, Friendly",30500,'
    '"Political Committee/Fund",Contribution,No,,55102,',
    # Not a contribution. The filing carries this on a separate schedule and outside
    # its contribution totals, so it must leave the contribution figure and still be
    # reported.
    '20010,HRCC,PTU,CAU,900.0000,2025-05-02,2025,"Sundry, Sam",,Individual,'
    "Miscellaneous,No,,55103,",
    '20010,HRCC,PTU,CAU,100.0000,2025-05-03,2025,"Sundry, Sam",,Individual,'
    '"Miscellaneous Income",No,,55103,',
    # The file's own Year column disagreeing with the row's date year, which happens
    # on 702 rows across the 3 real files. Grouping must follow Year.
    '20010,HRCC,PTU,CAU,700.0000,2026-01-05,2025,"Newyear, Nora",,Individual,'
    "Contribution,No,,55104,",
    # A state party unit.
    '20003,"MN DFL State Central Committee",PTU,SPU,10000.0000,2025-02-01,2025,'
    '"Donor, Dana",,Individual,Contribution,No,,55105,',
    # A candidate committee, so the reader has both kinds of filer to keep apart.
    '19200,"Olson, Rick Senate Committee",PCC,,250.0000,2025-07-10,2025,'
    '"Smith, Jane",,Individual,Contribution,No,,55106,Retired',
    # Its name says "Caucus" and the Board types it a political committee. 12 real
    # filers look like this, so a name match would pull in 12 wrong filers.
    '40993,"DFL Senior Caucus",PCF,PC,300.0000,2025-06-01,2025,'
    '"Member, Mary",,Individual,Contribution,No,,55107,',
    # Registration 40858 with type PTU and subtype SPU contradicts the numeric band
    # people assume. The type column is what we believe (§5, Identity).
    '40858,"Libertarian Party of Minn",PTU,SPU,500.0000,2025-04-04,2025,'
    '"Doe, John",,Individual,Contribution,No,,55108,',
]

EXPENDITURES = [
    # A caucus's spending on goods and services. Party units label this
    # "General Expenditure" and it names a vendor, never an affected committee.
    '20010,HRCC,PTU,CAU,"Seven Corners Print","St. Paul",MN,55108,853.1800,.0000,'
    '2025-07-02,Printing,2025,"General Expenditure",,No,,',
    '20010,HRCC,PTU,CAU,"Ad Shop",Duluth,MN,55802,1200.0000,200.0000,'
    '2025-08-02,Advertising,2025,"General Expenditure",,No,,',
    # A caucus paying a candidate committee. Only this label names who received it.
    '20010,HRCC,PTU,CAU,"Olson, Rick Senate Committee",St Paul,MN,55106,'
    "4500.0000,.0000,2025-09-15,,2025,Contribution,,No,"
    '"Olson, Rick Senate Committee",19200',
    # A state party paying a caucus, and the caucus paying the party. Two documented
    # facts about two filings, and nothing joins them.
    '20003,"MN DFL State Central Committee",PTU,SPU,HRCC,St Paul,MN,55101,'
    "25000.0000,.0000,2025-06-10,,2025,Contribution,,No,HRCC,20010",
    '20010,HRCC,PTU,CAU,"MN DFL State Central Committee",St Paul,MN,55101,'
    "15000.0000,.0000,2025-10-01,,2025,Contribution,,No,"
    '"MN DFL State Central Committee",20003',
    # A candidate committee's spending, labelled the other way round. A query naming
    # either label alone loses one of these two filers entirely.
    '19200,"Olson, Rick Senate Committee",PCC,,KnuFunK,Rochester,MN,55902,'
    '400.0000,.0000,2025-11-01,"Parade and Event Fees",2025,'
    '"Campaign Expenditure",,No,,',
    # A payee the state Board does not register: a local candidate, carried under a
    # negative placeholder number. 511 of these appear in the real 2025-2026 rows.
    '20003,"MN DFL State Central Committee",PTU,SPU,'
    '"Frey Jacob for Minneapolis Mayor",Minneapolis,MN,55401,600.0000,.0000,'
    "2026-04-16,,2026,Contribution,,No,"
    '"Frey, Jacob for Minneapolis Mayor",-2139632941',
    # 2026 rows so a second year exists to group by.
    '20010,HRCC,PTU,CAU,"Ad Shop",Duluth,MN,55802,2000.0000,.0000,2026-02-01,'
    'Advertising,2026,"General Expenditure",,No,,',
]

INDEPENDENT = [
    '"HRCC",20010,PTU,CAU,"Olson, Rick Senate Committee",19200,For,2025,'
    '2025-09-10,"Independent Expenditure",1500.00,.00,No,,Mailers,'
    '"Print Co",Minneapolis,MN,55401',
    '"HRCC",20010,PTU,CAU,"Fateh, Omar Senate Committee",18488,Against,2025,'
    '2025-09-11,"Independent Expenditure",900.00,.00,No,,Mailers,'
    '"Print Co",Minneapolis,MN,55401',
]


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


@pytest.fixture()
def board() -> Iterator[FakeBoard]:
    fake = FakeBoard()
    fake.set_rows(Dataset.contributions, CONTRIBUTIONS)
    fake.set_rows(Dataset.expenditures, EXPENDITURES)
    fake.set_rows(Dataset.independent_expenditures, INDEPENDENT)
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    server.board = fake  # type: ignore[attr-defined]
    fake.port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield fake
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture()
def release(db, board: FakeBoard) -> reader.Release:
    publish_first(db, board, MemoryStore())
    resolved = reader.live_release(db)
    assert resolved is not None
    return resolved


# --- Identity ----------------------------------------------------------------


def test_parties_and_caucuses_come_from_the_boards_own_type_column(db, release):
    """Not from the registration number's band, and not from the name.

    4,672 real rows carry a type that contradicts their number's band, and 12 real
    filers whose names contain "Caucus" are political committees rather than
    caucuses. Both traps are in the fixtures: 40858 is a state party unit in the
    band people read as a committee, and "DFL Senior Caucus" is a committee whose
    name reads as a caucus.
    """
    found = {
        filer.reg_num: filer for filer in reader.party_units_and_caucuses(db, release)
    }

    assert set(found) == {"20003", "20010", "40858"}
    assert found["20010"].is_caucus
    assert found["20003"].is_state_party
    # The band says "committee or fund"; the type column says state party unit, and
    # the type column is what we believe.
    assert found["40858"].is_state_party
    assert found["40858"].kind == "PTU"
    # A name is not a classification.
    assert "40993" not in found
    # Nor is a candidate committee a party unit.
    assert "19200" not in found


def test_a_filers_years_come_from_the_rows_we_hold(db, release):
    caucus = next(
        filer
        for filer in reader.party_units_and_caucuses(db, release)
        if filer.reg_num == "20010"
    )
    assert (caucus.first_year, caucus.last_year) == (2025, 2026)


# --- Money in ----------------------------------------------------------------


def test_money_in_counts_contributions_only_and_still_reports_the_rest(db, release):
    """The receipt-type filter, which is ~18 times more load-bearing for these filers.

    6.57% of a party unit's 2025 rows are not contributions against 0.36% of a
    candidate committee's. Filtering is right, because the filing reports them on
    separate schedules and outside its contribution totals. Dropping them silently
    is not: that is money the Board published disappearing from our copy of it.
    """
    (year_2025,) = [
        row for row in reader.money_in(db, release, "20010", [2025]) if row.year == 2025
    ]

    # 5000 + 2500 + 700, and not the 900 Miscellaneous or the 100 Miscellaneous Income.
    assert year_2025.contributions.rows == 3
    assert year_2025.contributions.total == Decimal("8200.0000")

    excluded = {bucket.label: bucket for bucket in year_2025.other_receipts}
    assert set(excluded) == {"Miscellaneous", "Miscellaneous Income"}
    assert excluded["Miscellaneous"].total == Decimal("900.0000")
    assert excluded["Miscellaneous Income"].total == Decimal("100.0000")
    # Nothing is lost: the buckets account for every row the file holds.
    assert (
        year_2025.contributions.rows
        + sum(bucket.rows for bucket in year_2025.other_receipts)
        == 5
    )


def test_money_in_groups_on_the_files_own_year_not_the_rows_date(db, release):
    """``Year`` and the row's date are separate claims and disagree on 702 real rows.

    ``Year`` is the one to group on, because it is the filing year the Board's own
    reports are organised by, which is what a figure has to line up with to be
    checkable against a filing. The fixture's $700 payment is dated 5 January 2026
    and the file calls it 2025, so a reader that grouped on the date would report it
    in the wrong filing year.
    """
    stored = db.execute(
        text(
            "SELECT year, receipt_date FROM cf_contribution_row "
            " WHERE snapshot_id = :s AND amount = 700.0000"
        ),
        {"s": release.contributions.snapshot_id},
    ).one()
    # The fixture really does hold the disagreement, so this test cannot pass by the
    # row having gone away.
    assert (stored[0], stored[1].year) == (2025, 2026)

    year_2025 = next(
        row for row in reader.money_in(db, release, "20010", [2025]) if row.year == 2025
    )
    assert year_2025.contributions.total == Decimal("8200.0000")
    # And it is not reported under 2026, which is the year its date falls in.
    assert reader.money_in(db, release, "20010", [2026]) == []


def test_a_year_with_no_rows_is_absent_and_is_never_a_zero(db, release):
    """Absence is not a filed zero, and a surface must not render it as one.

    The bulk file holds itemized rows only, so no rows for a year can mean a filer
    that raised nothing, a report not yet due, a terminated committee, or a filer
    none of whose donors passed the $200 yearly threshold. Those are different facts
    and nothing here can tell them apart (§7, Missing versus zero).
    """
    assert reader.money_in(db, release, "20010", [2024]) == []
    assert reader.money_out(db, release, "20010", [2024]) == []
    # A filer we hold nothing for at all behaves the same way, rather than returning
    # a zero-valued row that reads as a measurement.
    assert reader.money_in(db, release, "29999", [2025]) == []


# --- Money out ---------------------------------------------------------------


def test_money_out_keeps_every_label_so_no_kind_of_filer_disappears(db, release):
    """The sharpest trap in this source, and it produces a plausible total.

    A party unit and a candidate committee label the same spending differently, so a
    query naming ``Campaign Expenditure`` returns every candidate and no party unit,
    and a query naming ``General Expenditure`` returns the reverse. Both look fine.
    """
    caucus = next(
        row
        for row in reader.money_out(db, release, "20010", [2025])
        if row.year == 2025
    )
    candidate = next(
        row
        for row in reader.money_out(db, release, "19200", [2025])
        if row.year == 2025
    )

    assert {bucket.label for bucket in caucus.by_label} == {
        "General Expenditure",
        "Contribution",
    }
    assert {bucket.label for bucket in candidate.by_label} == {"Campaign Expenditure"}
    # The two filers share no label, which is the whole point: filtering to either
    # one of them would have returned one filer and lost the other.
    assert not {bucket.label for bucket in caucus.by_label} & {
        bucket.label for bucket in candidate.by_label
    }
    # 853.18 + 1200 general, 4500 + 15000 contribution.
    assert caucus.total == Decimal("21553.1800")
    assert caucus.rows == 4


def test_money_out_offers_no_way_to_filter_by_label(db, release):
    """Enforced by the signature, not asked for in a comment.

    A caller that wants one label reads it off ``by_label``, which keeps the whole
    picture in view. There is deliberately no parameter that would let the trap above
    back in.
    """
    import inspect

    parameters = set(inspect.signature(reader.money_out).parameters)
    assert parameters == {"db", "release", "reg_num", "years"}


def test_money_out_sums_the_filings_total_column_not_its_paid_column(db, release):
    """``Amount`` is the filing's total. Unpaid is a separate column and is not netted.

    Measured on real filer 17709 where the two differ: the paid column sums to
    $10,062.18 and the total column to $9,956.91, and only the total matches the rows
    we hold. Netting the unpaid amount off would invent a figure the filing does not
    state.
    """
    caucus = next(
        row
        for row in reader.money_out(db, release, "20010", [2025])
        if row.year == 2025
    )
    general = next(
        bucket for bucket in caucus.by_label if bucket.label == "General Expenditure"
    )
    # 853.18 + 1200.00, with the 200.00 unpaid on the second row left alone.
    assert general.total == Decimal("2053.1800")


# --- Transfers ---------------------------------------------------------------


def test_only_a_contribution_row_is_a_transfer(db, release):
    """Because it is the only label that names who received the money.

    Measured across all 377,860 real expenditure rows: ``Contribution`` carries an
    affected committee's registration number on 61,816 of its 61,840 rows and every
    other label carries one on zero. The other labels carry a vendor, which is a
    supplier and not the recipient of a transfer.
    """
    transfers = reader.transfers_from(db, release, "20010", [2025])

    assert {transfer.label for transfer in transfers} == {"Contribution"}
    assert {transfer.payee_reg_num for transfer in transfers} == {"19200", "20003"}
    # The two General Expenditure rows are money out and are not transfers, so the
    # transfer list is deliberately shorter than the money-out list.
    spent = next(
        row
        for row in reader.money_out(db, release, "20010", [2025])
        if row.year == 2025
    )
    assert len(transfers) < spent.rows


def test_every_transfer_carries_its_own_amount_date_and_citation(db, release):
    """A reader has to be able to verify each payment on its own.

    Minnesota publishes no per-transaction identifier and no page for an individual
    payment, so the citation is the record's line in one dated download plus that
    download's address.
    """
    (to_candidate,) = [
        transfer
        for transfer in reader.transfers_from(db, release, "20010", [2025])
        if transfer.payee_reg_num == "19200"
    ]

    assert to_candidate.amount == Decimal("4500.0000")
    assert to_candidate.paid_on.isoformat() == "2025-09-15"
    assert to_candidate.year == 2025
    assert to_candidate.row_number > 0
    assert release.expenditures.source_url.startswith("http")
    assert release.expenditures.snapshot_id is not None


def test_a_transfer_in_and_a_transfer_out_stay_two_separate_facts(db, release):
    """The state party paid the caucus and the caucus paid a candidate. Two facts.

    That the same dollars travelled between them is not a fact and no filing
    establishes it, because money is fungible and once it lands in an account no
    record says which dollar went out (``.claude/rules/grounded-answers.md`` rule 12).
    Each is read off the filing that reported it, with its own amount, date and line.
    """
    (into_caucus,) = [
        transfer
        for transfer in reader.transfers_to(db, release, "20010", [2025])
        if transfer.payer_reg_num == "20003"
    ]
    (out_of_caucus,) = [
        transfer
        for transfer in reader.transfers_from(db, release, "20010", [2025])
        if transfer.payee_reg_num == "19200"
    ]

    assert into_caucus.amount == Decimal("25000.0000")
    assert out_of_caucus.amount == Decimal("4500.0000")
    assert into_caucus.paid_on != out_of_caucus.paid_on
    assert into_caucus.row_number != out_of_caucus.row_number
    # Nothing on either record points at the other one, so no caller can assemble a
    # chain out of what this module returns.
    assert not set(vars(into_caucus)) & {"funded_by", "next_hop", "chain", "traced_to"}


def test_the_public_surface_has_no_way_to_relate_two_transfers(db):
    """Pinned deliberately, so adding a chain helper has to be a considered act.

    A comment asking nobody to build one is a request. Pinning the module's exported
    names makes anyone adding ``trace_money`` edit this list, and this docstring is
    what they read when they do: rule 12 forbids implying that a party's payment to a
    caucus and the caucus's later payment to a candidate are the same dollars.
    """
    assert set(reader.__all__) == {
        "CAUCUS_COMMITTEE",
        "CONTRIBUTION_RECEIPT",
        "Bucket",
        # Money *in*, cash only, per filer-year. It names no payer and no counterparty,
        # so it adds no way to relate one payment to another (#1329).
        "ContributionCash",
        "contribution_cash",
        "Filer",
        "IndependentSpending",
        "MoneyIn",
        "MoneyOut",
        "PayeeResolution",
        "Release",
        "ReleaseNoLongerHeld",
        "ReportedContributions",
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
    }


def test_a_transfer_carries_the_filings_own_label_and_no_judgement(db, release):
    """Rule 12 forbids asserting what a documented payment means.

    The label is the filing's own word. Nothing here may add a computed description
    of the payment's purpose or effect, so the record has no field one could go in.
    """
    transfers = reader.transfers_from(db, release, "20003", [2025, 2026])
    assert {transfer.label for transfer in transfers} == {"Contribution"}
    assert not set(vars(transfers[0])) & {"purpose", "effect", "influence", "reason"}


# --- Do the payees resolve? --------------------------------------------------


def test_a_local_candidate_payee_is_reported_as_unresolved(db, release):
    """A party unit may pay a candidate the state Board does not register.

    The Board fills the affected-committee number with a negative placeholder for
    those, and every one of the 511 in the real 2025-2026 rows is named "X for
    <local office>" -- a city, county or school-board candidate. So an unresolved
    number is usually a local candidate rather than a gap in our ingestion, and a
    surface must not present it as either a state filer or an error.
    """
    resolution = reader.resolve_payees(db, release, "20003", [2025, 2026])

    assert "20010" in resolution.payee_reg_nums
    assert resolution.unresolved == ("-2139632941",)
    assert resolution.rows_without_a_payee_number == 0


def test_resolution_is_a_weaker_claim_than_the_boards_own_directory(db, release):
    """It says a number appears as a filer here, not that the Board registers it.

    The loader records the directory check as ``not_run`` because no table holds the
    Board's registered-filer directory yet (#1408), and a number that resolves here
    and is absent from that directory is still unconfirmed.
    """
    resolution = reader.resolve_payees(db, release, "20010", [2025])
    assert set(resolution.payee_reg_nums) == {"19200", "20003"}
    assert resolution.unresolved == ()


def test_the_directory_check_says_when_it_did_not_run(db, release):
    """An empty "absent" list must not read as a clean result.

    The Board's registered-filer directory is a separate published set (#1408). With
    none published here, nothing was checked — and reporting that as 0 absent would
    turn "we did not look" into "everything passed", which is the shape of every
    missing-versus-zero failure rule 12 forbids.
    """
    resolution = reader.resolve_payees(db, release, "20010", [2025])

    assert resolution.directory_checked is False
    assert resolution.absent_from_directory == ()
    # The weak check still ran and is a different claim.
    assert set(resolution.payee_reg_nums) == {"19200", "20003"}


def test_a_reported_total_is_absent_rather_than_zero_when_none_is_published(db):
    """No filings snapshot is a fact about us, never about the filer.

    Returning an empty list rather than a zero-valued row, because a party that
    reported nothing and a party whose report we do not hold are different facts about
    a named organisation (§7, Missing versus zero).
    """
    assert reader.reported_contributions(db, "20010", [2025]) == []


# --- Independent spending ----------------------------------------------------


def test_independent_spending_keeps_the_files_own_stance(db, release):
    """``For`` and ``Against`` are the file's words and are never inferred."""
    spending = reader.independent_spending_by(db, release, "20010", [2025])
    by_stance = {row.stance: row for row in spending}
    assert set(by_stance) == {"For", "Against"}
    assert by_stance["For"].total == Decimal("1500.00")
    assert by_stance["Against"].total == Decimal("900.00")


# --- One release, and what happens when its rows go --------------------------


def test_the_release_is_resolved_once_with_all_three_files(db, release):
    """A request that re-resolves per query can straddle a publish and mix sets."""
    assert release.contributions.dataset == Dataset.contributions
    assert release.expenditures.dataset == Dataset.expenditures
    assert release.independent_expenditures.dataset == Dataset.independent_expenditures
    assert release.contributions.row_count == len(CONTRIBUTIONS)
    assert release.expenditures.row_count == len(EXPENDITURES)
    assert release.fetched_at is not None


def test_the_freshness_date_is_normalized_to_utc(db, release):
    """Because it is a date a page prints, and the driver may not hand back UTC.

    A ``timestamptz`` can come back in the session's own timezone, so an
    unnormalized value can tell a reader the files were fetched on the wrong day
    (found by the #1332 session, ``alethical/api/services/independent_spending.py``).
    """
    assert release.fetched_at.tzinfo is not None
    assert release.fetched_at.utcoffset() == timedelta(0)


def test_an_emptied_release_refuses_rather_than_reporting_a_zero(db, release):
    """The failure this whole guard exists for, and it is about a named organisation.

    A superseded release keeps its rows for exactly one further publish and then they
    go. A reader holding that id then finds nothing, and a page renders "this
    committee has no payments" -- the missing-versus-zero failure rule 12 forbids.
    Deleting the rows under a still-published snapshot reproduces it exactly.
    """
    db.execute(
        text("DELETE FROM cf_contribution_row WHERE snapshot_id = :s"),
        {"s": release.contributions.snapshot_id},
    )
    db.commit()

    with pytest.raises(reader.ReleaseNoLongerHeld):
        reader.money_in(db, release, "20010", [2025])


def test_a_release_naming_a_pruned_snapshot_refuses_to_resolve(db, release):
    """Refusing beats handing back a release whose rows may be half gone."""
    db.execute(
        text("UPDATE cf_snapshot SET status = 'pruned' WHERE id = :s"),
        {"s": release.expenditures.snapshot_id},
    )
    db.commit()

    with pytest.raises(reader.ReleaseNoLongerHeld):
        reader.live_release(db)


def test_no_published_release_reads_as_none_not_as_an_error(db):
    """A database with nothing published is a real state, not a failure."""
    cf.ensure_pointer_row(db)
    assert reader.live_release(db) is None


# --- Filer-years that must not show a split ----------------------------------


def test_nothing_is_withheld_when_every_filer_year_reconciled(db, release):
    """The ordinary case, so the reader is not read as "there is always a problem"."""
    assert reader.filer_years_that_must_not_show_a_split(db, release) == frozenset()


def test_a_filer_year_the_release_refused_is_named_to_the_caller(db, release):
    """Recording which committee-years contradict themselves is only half the job.

    The other half is a caller being able to ask, because a surface that computes
    "how much of this money had no name on it" would otherwise print a negative
    share for exactly these committees (§9.5, a negative reconciliation is a failure
    rather than a number to clamp).
    """
    db.execute(
        text("UPDATE cf_snapshot SET validation_json = :recorded WHERE id = :snapshot"),
        {
            "recorded": json.dumps(
                {
                    "checks": [
                        {
                            "name": "reported_totals_reconcile",
                            "status": "overridden",
                            "detail": "reviewed and published anyway",
                            "filer_years": ["19200:2025", "30654:2024"],
                        }
                    ]
                }
            ),
            "snapshot": release.contributions.snapshot_id,
        },
    )
    db.commit()

    assert reader.filer_years_that_must_not_show_a_split(db, release) == frozenset(
        {("19200", 2025), ("30654", 2024)}
    )


def test_a_registration_number_holding_a_colon_still_resolves(db, release):
    """The year is split off the right-hand end, so a number containing a colon keeps
    its whole self rather than being truncated at the first one."""
    db.execute(
        text("UPDATE cf_snapshot SET validation_json = :recorded WHERE id = :snapshot"),
        {
            "recorded": json.dumps(
                {
                    "checks": [
                        {
                            "name": "reported_totals_reconcile",
                            "status": "failed",
                            "detail": "x",
                            "filer_years": ["A:B:2025", "malformed", "19200:notayear"],
                        }
                    ]
                }
            ),
            "snapshot": release.contributions.snapshot_id,
        },
    )
    db.commit()

    assert reader.filer_years_that_must_not_show_a_split(db, release) == frozenset(
        {("A:B", 2025)}
    )
