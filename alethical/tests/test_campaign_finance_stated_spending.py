"""What comparing a filing's own stated money out against ours must guarantee (#1645).

Every test here stands in for a way this check could quietly lie about a named
politician's spending. Four matter most, because each produces an answer that looks
right:

* **Independent expenditures live in a different file.** Minnesota publishes what a
  committee spent for or against someone as its own download, so counting those
  schedules against ``cf_expenditure_row`` invents a shortfall wherever a filer spends
  independently -- and a shortfall makes a committee look like it spent less than it did.
* **A money-out schedule prints its total in the last column and its paid amount in the
  first**, and the widths differ by schedule: 3 columns for a transfer to another
  committee, 4 for ordinary spending. Reading a fixed position finds the wrong one.
* **Three quarters of the money-out schedule codes have no figure of their own** in the
  Board's totals route, so a reader that dropped a whole schedule would pass a per-line
  self-test. The route's ``total_expenditures`` is what catches it.
* **"We could not look" must never read as "we looked and it was fine".** We hold no copy
  of every filing's document, and those committee-years are recorded as not checked.

Fixtures are tiny and hand-written, and the documents are real PDFs built by the money-in
suite's ``pdf_of`` rather than mocked, so the pypdf path is genuinely covered. §8 of
``docs/architecture/campaign-finance-system-design.md`` is explicit that every count in
that document is one day's measurement and never a thing to assert, so no real total
appears here.

Needs the local Postgres on port 54329 for the tests that publish a release.
"""

from __future__ import annotations

import tempfile
import threading
from datetime import UTC, date, datetime
from decimal import Decimal
from http.server import ThreadingHTTPServer
from typing import Iterator, Optional

import pytest
from sqlalchemy import text

from alethical.api.services import committee_stated_spending as service
from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline import campaign_finance_report_document_store as document_store
from alethical.pipeline import campaign_finance_report_documents as documents
from alethical.pipeline import campaign_finance_stated_spending as spending
from alethical.tests.test_campaign_finance_load import (
    FakeBoard,
    MemoryStore,
    _clear,
    _Handler,
    publish_first,
    seed_filings_snapshot,
)
from alethical.tests.test_campaign_finance_stated_split import pdf_of

Kind = models.CampaignFinanceFilerKind
Status = models.CampaignFinanceStatedSpendingStatus


# --- The documents these tests read -------------------------------------------


def candidate_spending_lines(
    *,
    campaign: tuple[str, str] = ("11,350.46", "3,179.92"),
    party_unit_transfer: Optional[str] = None,
    independent: Optional[str] = None,
) -> list[str]:
    """A candidate committee's report, in the shape the Board really prints one.

    ``B1 - CE`` prints 4 columns (paid, in-kind, unpaid, total) and ``B2 - PTY`` prints
    3 (paid, in-kind, total), which is measured rather than invented: every one of the
    18 money-out schedule codes across the 3,643 stored documents prints one width or
    the other and never both, and all 12,928 of their rows add up to the last column.
    """
    lines = [
        "Campaign Finance And Public Disclosure Board",
        "Period Covered: 01/01/2025 through 12/31/2025",
        "Schedule A1 - IND   Contributions from Individuals",
        "Total of itemized 2,150.00 0.00 2,150.00",
        "Total of non-itemized 3,286.57 0.00 3,286.57",
        "Schedule B1 - CE   Campaign Expenditures",
        f"Total of itemized {campaign[0]} 0.00 0.00 {campaign[0]}",
        f"Total of non-itemized {campaign[1]} 0.00 0.00 {campaign[1]}",
    ]
    if party_unit_transfer is not None:
        # A schedule the Board's totals route reports no line of its own for. Only the
        # whole-document check can prove it was read.
        lines += [
            "Schedule B2 - PTY   Contributions to Party Units",
            f"Total of itemized {party_unit_transfer} 0.00 {party_unit_transfer}",
            "Total of non-itemized 0.00 0.00 0.00",
        ]
    if independent is not None:
        lines += [
            "Schedule B3A - IE   Independent Expenditures",
            f"Total of itemized {independent} 0.00 0.00 {independent}",
            "Total of non-itemized 0.00 0.00 0.00 0.00",
        ]
    return lines


def figures_for(
    *, campaign_paid: str, party_unit_paid: str = "0", independent_paid: str = "0"
) -> dict[str, Decimal]:
    """The money-out figures the Board's own totals route reports for a candidate.

    ``total_expenditures`` covers every money-out schedule together, independent
    expenditures included, because it is the Board's total for the whole filing rather
    than for either of its 2 downloads.
    """
    return {
        "campaign_expenditures": Decimal(campaign_paid),
        "total_expenditures": (
            Decimal(campaign_paid)
            + Decimal(party_unit_paid)
            + Decimal(independent_paid)
        ),
    }


# --- Reading the money-out schedules ------------------------------------------


def test_the_total_is_the_last_column_and_the_paid_amount_is_the_first() -> None:
    """Both widths, in one document, because a fixed position gets one of them wrong."""
    document = documents.schedules_from_lines(
        [
            "Schedule B1 - EXP   General Expenditures",
            "Total of itemized 900.00 40.00 60.00 1,000.00",
            "Total of non-itemized 5.00 0.00 0.00 5.00",
            "Schedule B2 - PTY   Contributions to Party Units",
            "Total of itemized 250.00 50.00 300.00",
            "Total of non-itemized 0.00 0.00 0.00",
        ]
    )
    stated, errors = documents.stated_spending(
        document,
        Kind.party_unit,
        {
            "general_expenditures": Decimal("905.00"),
            "contributions_to_party_units": Decimal("250.00"),
            "total_expenditures": Decimal("1155.00"),
        },
    )
    assert errors == []
    assert stated is not None
    assert stated.itemized == Decimal("1300.00")
    assert stated.itemized_paid == Decimal("1150.00")
    assert stated.non_itemized == Decimal("5.00")
    assert stated.self_test is documents.SelfTest.passed


def test_independent_expenditures_are_reported_apart_from_the_comparison_figure() -> (
    None
):
    """The rule everything else depends on.

    Minnesota publishes what a committee spent for or against someone as its own
    download, so a comparison against ``cf_expenditure_row`` that counts these invents a
    shortfall wherever a filer spends independently. It is reported beside the figure
    rather than dropped, so a person auditing a row can see the money exists.
    """
    document = documents.schedules_from_lines(
        candidate_spending_lines(campaign=("100.00", "0.00"), independent="9,000.00")
    )
    stated, errors = documents.stated_spending(
        document, Kind.candidate_committee, figures_for(campaign_paid="100.00")
    )
    assert errors == []
    assert stated is not None
    assert stated.itemized == Decimal("100.00")
    assert stated.independent_itemized == Decimal("9000.00")
    assert "B3A - IE" not in stated.schedules_read


@pytest.mark.parametrize(
    "code", ["B3A - IE", "B3B - LOC IE", "B3B - HEN IE", "B9Z - SOMETHING NEW IE"]
)
def test_every_independent_expenditure_schedule_is_recognised_by_its_suffix(
    code,
) -> None:
    """Including one nobody has met, because a new code must not be silently counted."""
    assert documents.is_independent_expenditure_schedule(code)
    assert documents.is_spending_schedule(code)


def test_a_money_out_row_whose_columns_do_not_add_up_is_an_error() -> None:
    """Every column before the last must sum to the last, which catches a column shift.

    A shift would otherwise read as a real disagreement about a named committee's
    spending rather than as our own reader losing its place.
    """
    document = documents.schedules_from_lines(
        [
            "Schedule B1 - CE   Campaign Expenditures",
            "Total of itemized 100.00 0.00 0.00 9,999.00",
            "Total of non-itemized 0.00 0.00 0.00 0.00",
        ]
    )
    stated, errors = documents.stated_spending(document, Kind.candidate_committee, {})
    assert stated is None
    assert any("does not add up" in error for error in errors)


def test_a_money_out_schedule_narrower_than_three_columns_is_an_error() -> None:
    """A width nobody has met is reported rather than read as though it were paid."""
    document = documents.schedules_from_lines(
        [
            "Schedule B1 - CE   Campaign Expenditures",
            "Total of itemized 100.00",
            "Total of non-itemized 0.00",
        ]
    )
    stated, errors = documents.stated_spending(document, Kind.candidate_committee, {})
    assert stated is None
    assert any("columns" in error for error in errors)


# --- Proving the reader before it may accuse anyone ---------------------------


def test_the_reader_passes_when_it_reproduces_the_boards_own_figures() -> None:
    document = documents.schedules_from_lines(candidate_spending_lines())
    stated, errors = documents.stated_spending(
        document, Kind.candidate_committee, figures_for(campaign_paid="14530.38")
    )
    assert errors == []
    assert stated is not None
    assert stated.self_test is documents.SelfTest.passed
    assert stated.itemized == Decimal("11350.46")


def test_a_reader_that_finds_nothing_fails_rather_than_reporting_an_empty_filing() -> (
    None
):
    """An absent schedule is compared against its stored figure exactly as a present one.

    A wrong number invites suspicion; "no spending at all" invites a conclusion about the
    committee. So a reader that read nothing cannot pass its own test.
    """
    empty = documents.schedules_from_lines(["Certification", "Page 1"])
    stated, errors = documents.stated_spending(
        empty, Kind.candidate_committee, figures_for(campaign_paid="14530.38")
    )
    assert errors == []
    assert stated is not None
    assert stated.self_test is documents.SelfTest.failed


def test_a_schedule_with_no_figure_of_its_own_is_still_proved_by_the_whole_document():
    """The reason ``total_expenditures`` is tested at all.

    A candidate committee's transfers to party units are on its filing and no line the
    Board's totals route reports for a candidate carries them. Drop that schedule and
    every per-line check still passes, so only the whole-document figure catches it.
    """
    figures = figures_for(campaign_paid="14530.38", party_unit_paid="5250.00")

    complete = documents.schedules_from_lines(
        candidate_spending_lines(party_unit_transfer="5,250.00")
    )
    stated, _ = documents.stated_spending(complete, Kind.candidate_committee, figures)
    assert stated is not None
    assert stated.self_test is documents.SelfTest.passed
    assert stated.itemized == Decimal("16600.46")

    # The same filing with that one schedule missed. Its campaign-expenditure line still
    # matches to the cent.
    dropped = documents.schedules_from_lines(candidate_spending_lines())
    stated, _ = documents.stated_spending(dropped, Kind.candidate_committee, figures)
    assert stated is not None
    assert stated.self_test is documents.SelfTest.failed
    assert "total expenditures" in stated.self_test_detail


def test_a_local_ballot_question_schedule_does_not_fail_a_correct_reader() -> None:
    """The route reports 0.00 for a filer whose local ballot-question schedule has money.

    Measured across the stored corpus: ``ballot_question_expenditure`` matches the
    state-level ``B4A - BQ`` schedule and never the local or Hennepin County ones, so
    mapping that line to them would fail a reader that read the document correctly. The
    money is still proved, by the whole-document figure.
    """
    document = documents.schedules_from_lines(
        [
            "Schedule B1 - EXP   General Expenditures",
            "Total of itemized 100.00 0.00 0.00 100.00",
            "Total of non-itemized 0.00 0.00 0.00 0.00",
            "Schedule B4B - LOC BQ   Local Ballot Question Expenditures",
            "Total of itemized 998.88 0.00 0.00 998.88",
            "Total of non-itemized 0.00 0.00 0.00 0.00",
        ]
    )
    stated, errors = documents.stated_spending(
        document,
        Kind.political_committee_or_fund,
        {
            "general_expenditures": Decimal("100.00"),
            "ballot_question_expenditure": Decimal("0"),
            "total_expenditures": Decimal("1098.88"),
        },
    )
    assert errors == []
    assert stated is not None
    assert stated.self_test is documents.SelfTest.passed
    assert stated.itemized == Decimal("1098.88")


def test_no_money_out_figure_at_all_is_not_available_rather_than_a_pass() -> None:
    document = documents.schedules_from_lines(candidate_spending_lines())
    stated, _ = documents.stated_spending(document, Kind.candidate_committee, {})
    assert stated is not None
    assert stated.self_test is documents.SelfTest.not_available


# --- Fixtures for everything that needs a published release --------------------


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    _clear(session)
    session.execute(text("DELETE FROM cf_stated_spending"))
    session.commit()
    try:
        yield session
    finally:
        session.rollback()
        session.execute(text("DELETE FROM cf_stated_spending"))
        session.commit()
        _clear(session)
        session.close()


@pytest.fixture()
def board() -> Iterator[FakeBoard]:
    fake = FakeBoard()
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
def store() -> MemoryStore:
    return MemoryStore()


def live(db) -> reader.Release:
    release = reader.live_release(db)
    assert release is not None
    return release


def money_out_figures(db, snapshot, reg_num: str, year: int, lines: dict[str, str]):
    """Put the Board's own money-out lines on a seeded filing.

    ``seed_filings_snapshot`` writes only the money-in line it was built for, and these
    are what the money-out reader is proved against.
    """
    filing_id = db.execute(
        text(
            "SELECT id FROM cf_filing WHERE snapshot_id = :snapshot "
            " AND registration_number = :reg AND filing_year = :year"
        ),
        {"snapshot": snapshot.id, "reg": reg_num, "year": year},
    ).scalar_one()
    for line_key, amount in lines.items():
        db.add(
            models.CampaignFinanceFilingFigure(
                filing_id=filing_id,
                line_key=line_key,
                label_as_served=line_key.replace("_", " ").capitalize(),
                amount=Decimal(amount),
            )
        )
    db.commit()


def keep(db, store, directory: str, body: bytes, *, reg_num: str, year: int) -> str:
    """Store one document the way #1501's keeper does, so the library can read it back."""
    import hashlib

    document_hash = hashlib.sha256(body).hexdigest()
    document_store.store_document(
        db,
        store,
        directory,
        document_hash=document_hash,
        body=body,
        registration_number=reg_num,
        filing_year=year,
        report_type="YE",
        amendment_index=0,
    )
    return document_hash


def check(db, store, snapshot, *, body: Optional[bytes], reg_num="19004", year=2025):
    """Run one committee-year through the real check, reading from a real store."""
    with tempfile.TemporaryDirectory() as directory:
        if body is not None:
            keep(db, store, directory, body, reg_num=reg_num, year=year)
        library = document_store.DocumentLibrary(
            db=db, store=store, directory=directory
        )
        release = live(db)
        target = next(
            t
            for t in spending.targets(db, release, snapshot.id, [year])
            if t.registration_number == reg_num
        )
        return spending.check_one(db, library, release, snapshot.id, target)[0]


def prepare(db, board, store, *, reg_num="19004", year=2025, lines=None):
    snapshot = seed_filings_snapshot(
        db, reported={(reg_num, year): "0.00"}, years=(year,)
    )
    money_out_figures(db, snapshot, reg_num, year, lines or {})
    publish_first(db, board, store)
    return snapshot


# --- One committee-year, end to end -------------------------------------------


def test_a_committee_whose_filing_matches_our_rows_agrees(db, board, store) -> None:
    """The fixture holds one 2025 expenditure row for 19004, $1,000.00."""
    snapshot = prepare(
        db,
        board,
        store,
        lines={"campaign_expenditures": "1000.00", "total_expenditures": "1000.00"},
    )
    body = pdf_of(candidate_spending_lines(campaign=("1,000.00", "0.00")))
    verdict = check(db, store, snapshot, body=body)
    assert verdict.status is Status.agrees
    assert verdict.ours_itemized == Decimal("1000.0000")
    assert verdict.stated_itemized == Decimal("1000.00")


def test_a_filing_that_itemizes_more_than_we_hold_disagrees(db, board, store) -> None:
    """The direction that makes a committee look like it spent less than it did."""
    snapshot = prepare(
        db,
        board,
        store,
        lines={"campaign_expenditures": "1300.00", "total_expenditures": "1300.00"},
    )
    body = pdf_of(candidate_spending_lines(campaign=("1,300.00", "0.00")))
    verdict = check(db, store, snapshot, body=body)
    assert verdict.status is Status.disagrees
    assert verdict.stated_itemized - verdict.ours_itemized == Decimal("300")
    assert "300" in verdict.reason


def test_holding_no_rows_at_all_is_a_disagreement_and_says_so(db, board, store) -> None:
    """It must never render as "this committee spent nothing"."""
    snapshot = prepare(
        db,
        board,
        store,
        reg_num="30161",
        lines={"campaign_expenditures": "500.00", "total_expenditures": "500.00"},
    )
    body = pdf_of(candidate_spending_lines(campaign=("500.00", "0.00")))
    verdict = check(db, store, snapshot, body=body, reg_num="30161")
    assert verdict.status is Status.disagrees
    assert verdict.ours_itemized == Decimal("0")
    assert "no rows at all" in verdict.reason


def test_a_committee_year_we_hold_no_document_for_is_not_checked(db, board, store):
    """Minnesota's gap, and it is not a pass.

    The Board serves a document for only about 1 report in 4, so this is the ordinary
    state of a committee-year rather than an error, and recording it as agreeing would
    publish an unchecked figure as a checked one.
    """
    snapshot = prepare(
        db,
        board,
        store,
        lines={"campaign_expenditures": "1000.00", "total_expenditures": "1000.00"},
    )
    verdict = check(db, store, snapshot, body=None)
    assert verdict.status is Status.not_checked
    assert "no copy" in verdict.reason
    assert verdict.stated_itemized is None


def test_a_store_that_cannot_hand_back_its_bytes_is_not_checked(db, board, store):
    """A 13-minute sweep must not end on one unreadable object, and must not pass it.

    ``read_document`` refuses when the stored bytes no longer hash to what the row
    records, which is exactly the case where handing them to the reader would publish a
    figure from a file we cannot vouch for.
    """
    snapshot = prepare(
        db,
        board,
        store,
        lines={"campaign_expenditures": "1000.00", "total_expenditures": "1000.00"},
    )
    body = pdf_of(candidate_spending_lines(campaign=("1,000.00", "0.00")))
    with tempfile.TemporaryDirectory() as directory:
        document_hash = keep(db, store, directory, body, reg_num="19004", year=2025)
        key = document_store.object_key(document_hash)
        store.objects[key] = b"something else entirely"
        library = document_store.DocumentLibrary(
            db=db, store=store, directory=directory
        )
        release = live(db)
        target = next(
            t
            for t in spending.targets(db, release, snapshot.id, [2025])
            if t.registration_number == "19004"
        )
        verdict, read_one = spending.check_one(
            db, library, release, snapshot.id, target
        )
    assert verdict.status is Status.not_checked
    assert read_one is False
    assert "could not be read back" in verdict.reason


def test_a_reader_that_cannot_prove_itself_blames_itself_and_not_the_data(
    db, board, store
) -> None:
    """ "Our reader is wrong" and "the data is wrong" must never come out the same way."""
    snapshot = prepare(
        db,
        board,
        store,
        lines={"campaign_expenditures": "9999.00", "total_expenditures": "9999.00"},
    )
    body = pdf_of(candidate_spending_lines(campaign=("1,000.00", "0.00")))
    verdict = check(db, store, snapshot, body=body)
    assert verdict.status is Status.reader_unproven
    assert verdict.self_test == documents.SelfTest.failed.value
    assert verdict.ours_itemized is None


def test_our_rows_are_scoped_and_bounded_but_never_filtered_by_kind(db, board, store):
    """All 6 ``Type`` values in this file are money out, and each is on a schedule.

    The money-in twin filters its rows to ``Contribution`` because that file carries 3
    receipt kinds that are not contributions. Copying that filter here would drop a whole
    kind of payment, so this asserts the opposite.
    """
    prepare(
        db,
        board,
        store,
        lines={"campaign_expenditures": "1000.00", "total_expenditures": "1000.00"},
    )
    release = live(db)
    db.execute(
        text(
            "INSERT INTO cf_expenditure_row (snapshot_id, row_number, "
            "  committee_reg_num, amount, transaction_date, year, type) "
            "VALUES (:snapshot, 9001, '19004', 25.0000, DATE '2025-06-01', 2025, "
            "  'Other Disbursement'), "
            "  (:snapshot, 9002, '19004', 900.0000, DATE '2026-01-04', 2026, "
            "  'Campaign Expenditure'), "
            "  (:snapshot, 9003, '19004', 700.0000, DATE '2025-11-30', 2025, "
            "  'Campaign Expenditure')"
        ),
        {"snapshot": release.expenditures.snapshot_id},
    )
    db.commit()

    # Through the year's end: the fixture row, the Other Disbursement and the November
    # one. The 2026 row belongs to another filing year and is never counted.
    whole_year, rows = spending.ours_spent(
        db, release, "19004", 2025, date(2025, 12, 31)
    )
    assert (whole_year, rows) == (Decimal("1725.0000"), 3)

    # Bounded by a mid-year report's own cut-off, the November row is outside the period.
    part_year, rows = spending.ours_spent(db, release, "19004", 2025, date(2025, 6, 30))
    assert (part_year, rows) == (Decimal("1025.0000"), 2)


# --- Storing, reading back, and how much was covered --------------------------


def test_a_stored_verdict_reads_back_for_the_release_it_was_made_about(
    db, board, store
) -> None:
    snapshot = prepare(
        db,
        board,
        store,
        lines={"campaign_expenditures": "1300.00", "total_expenditures": "1300.00"},
    )
    body = pdf_of(candidate_spending_lines(campaign=("1,300.00", "0.00")))
    verdict = check(db, store, snapshot, body=body)
    release = live(db)
    spending.store_verdicts(
        db, release.expenditures.snapshot_id, snapshot.id, [verdict]
    )

    stored = service.stated_spending_for_year(db, release, "19004", 2025)
    assert stored.status == service.DISAGREES
    assert stored.difference == Decimal("300")
    assert stored.cut_off_date == date(2025, 12, 31)
    assert service.committee_years_whose_spending_disagrees(db, release) == frozenset(
        {("19004", 2025)}
    )


def test_a_committee_year_nobody_has_checked_reads_as_not_run(db, board, store) -> None:
    """A fact about us, and never a verdict about the committee."""
    prepare(db, board, store)
    answer = service.stated_spending_for_year(db, live(db), "19004", 2025)
    assert answer.status == service.NOT_RUN
    assert answer.figures_agree is False


def test_writing_the_same_committee_year_twice_replaces_rather_than_duplicates(
    db, board, store
) -> None:
    """A verdict is a statement about the payments published now, so it is replaced."""
    snapshot = prepare(db, board, store)
    release = live(db)
    for status in (Status.disagrees, Status.agrees):
        spending.store_verdicts(
            db,
            release.expenditures.snapshot_id,
            snapshot.id,
            [
                spending.Verdict(
                    registration_number="19004",
                    filing_year=2025,
                    status=status,
                    reason="written twice",
                )
            ],
        )
    answers = service.stated_spending(db, release, "19004")
    assert [answer.status for answer in answers] == [service.AGREES]


def test_a_scoped_run_does_not_make_the_whole_release_read_as_checked(
    db, board, store
) -> None:
    """One verdict is 1 of the population, never 1 of 1.

    A coverage built from stored rows alone reports a clean sweep after a run scoped to
    a single committee, which is the failure the money-in check was caught making.
    """
    snapshot = prepare(db, board, store)
    release = live(db)
    spending.store_verdicts(
        db,
        release.expenditures.snapshot_id,
        snapshot.id,
        [
            spending.Verdict(
                registration_number="19004",
                filing_year=2025,
                status=Status.agrees,
                reason="one committee only",
            )
        ],
    )
    coverage = spending.stated_spending_coverage(db, release.expenditures.snapshot_id)
    assert coverage is not None
    assert coverage.total == 1
    assert coverage.population is not None and coverage.population > 1
    assert coverage.without_a_verdict == coverage.population - 1


def test_coverage_is_none_when_nobody_has_run_the_check(db, board, store) -> None:
    """A real, ordinary state on a freshly loaded download, reported as not run."""
    prepare(db, board, store)
    release = live(db)
    assert (
        spending.stated_spending_coverage(db, release.expenditures.snapshot_id) is None
    )


def test_a_run_with_nowhere_to_write_refuses_before_it_reads_anything(
    db, board, store
) -> None:
    """The money-in check learned this the hard way: the first write is the last step."""
    prepare(db, board, store)
    db.execute(text("ALTER TABLE cf_stated_spending RENAME TO cf_stated_spending_tmp"))
    db.commit()
    try:
        with tempfile.TemporaryDirectory() as directory:
            library = document_store.DocumentLibrary(
                db=db, store=store, directory=directory
            )
            with pytest.raises(RuntimeError, match="no cf_stated_spending table"):
                spending.run_stated_spending_check(db, library, years=[2025])
    finally:
        db.rollback()
        db.execute(
            text("ALTER TABLE cf_stated_spending_tmp RENAME TO cf_stated_spending")
        )
        db.commit()


def test_the_run_reports_its_readers_accuracy_as_a_measured_number() -> None:
    """A committee-year the self-test could not run on is neither a pass nor a fail."""
    run = spending.StatedSpendingRun(years=(2025,), started_at=datetime.now(UTC))
    run.verdicts = [
        spending.Verdict("1", 2025, Status.agrees, "", self_test="passed"),
        spending.Verdict("2", 2025, Status.disagrees, "", self_test="passed"),
        spending.Verdict("3", 2025, Status.reader_unproven, "", self_test="failed"),
        spending.Verdict("4", 2025, Status.agrees, "", self_test="not_available"),
        spending.Verdict("5", 2025, Status.not_checked, ""),
    ]
    assert run.reader_accuracy() == (2, 3)
    assert run.counts() == {
        "agrees": 2,
        "disagrees": 1,
        "reader_unproven": 1,
        "not_checked": 1,
    }
