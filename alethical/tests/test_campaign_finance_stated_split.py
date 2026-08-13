"""What comparing a filing's own stated split against ours must guarantee (#1433).

Every test here stands in for a way this check could quietly lie about a named
politician's money. The four that matter most, because each produces an answer that
looks right:

* **A missing document answers HTTP 200.** Five soft failures, four of them plain text
  and one a 30 KB web page, and none carries an error status. A check asking "is the
  body HTML" passes four of the five as success.
* **A reader that finds nothing looks exactly like a filing that named nobody.** §9.4
  records that as the worst of the 3 parser bugs it caught, because a wrong number
  invites suspicion and "no data at all" invites a conclusion about the source. So the
  self-test compares an **absent** schedule against its stored figure too, and a reader
  that reads nothing fails rather than passing.
* **"We could not look" must never read as "we looked and it was fine".** The Board
  serves no report document before 2023, and those years are recorded as not checked.
* **"Our reader is wrong" and "the data is wrong" must never come out the same way.**
  One is Minnesota's gap and one is ours, and collapsing them lets a broken reader of
  ours accuse a real committee's filing of contradicting itself.

Fixtures are tiny and hand-written, and the documents are real PDFs built here rather
than mocked, so the pypdf path is genuinely covered. §8 of
``docs/architecture/campaign-finance-system-design.md`` is explicit that every count in
that document is one day's measurement and never a thing to assert, so no real total
appears here. What the fixtures do reproduce verbatim are the source's awkward shapes: a
schedule code carrying a slash and internal spaces, a heading 1,800 lines from its own
totals, a summary row that mentions a schedule mid-sentence, and each of the Board's 5
ways of answering 200 without a document.

Needs the local Postgres on port 54329 for the tests that publish a release.
"""

from __future__ import annotations

import threading
from datetime import UTC, date, datetime
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Iterator
from urllib.parse import parse_qs

import requests

import pytest
from sqlalchemy import text

from alethical.api.services import committee_stated_split as service
from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.pipeline import campaign_finance as cf
from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline import campaign_finance_stated_split as split
from alethical.pipeline import campaign_finance_report_documents as documents
from alethical.tests.test_campaign_finance_load import (
    FakeBoard,
    MemoryStore,
    _clear,
    _Handler,
    publish_first,
    seed_filings_snapshot,
)

Kind = models.CampaignFinanceFilerKind
Status = models.CampaignFinanceStatedSplitStatus


# --- A real, tiny report document ---------------------------------------------


def pdf_of(lines: list[str]) -> bytes:
    """A genuine one-page PDF carrying these lines, built by hand.

    Written out rather than mocked because ``extract_lines`` is the step that turns
    bytes into the lines everything else reads, and a mock there would test the test.
    Uncompressed, uncomposed and about 700 bytes, so the fixture stays readable.
    """
    operations = ["BT", "/F1 10 Tf", "12 TL", "40 750 Td"]
    for line in lines:
        escaped = line.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        operations.append(f"({escaped}) Tj")
        operations.append("T*")
    operations.append("ET")
    content = "\n".join(operations).encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources "
        b"<< /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length "
        + str(len(content)).encode()
        + b" >>\nstream\n"
        + content
        + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += str(number).encode() + b" 0 obj\n" + body + b"\nendobj\n"
    start_xref = len(out)
    out += b"xref\n0 " + str(len(objects) + 1).encode() + b"\n0000000000 65535 f \n"
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += (
        b"trailer\n<< /Size "
        + str(len(objects) + 1).encode()
        + b" /Root 1 0 R >>\nstartxref\n"
        + str(start_xref).encode()
        + b"\n%%EOF\n"
    )
    return bytes(out)


def candidate_lines(
    *,
    individuals: tuple[str, str] = ("2,150.00", "3,286.57"),
    with_party_unit: bool = False,
) -> list[str]:
    """A candidate committee's report, in the shape the Board really prints one."""
    lines = [
        "Campaign Finance And Public Disclosure Board",
        "Period Covered: 01/01/2025 through 12/31/2025",
        # A summary row that names a schedule mid-sentence. It is not a heading, and a
        # parser that matches "Schedule" anywhere on the line reads it as one.
        "14A Total outstanding balance of all loans incurred during the current year "
        "Schedule A2-LP 0.00",
        "Schedule A1 - IND   Contributions from Individuals",
        "Doe, John 01/02/2025 500.00",
        f"Total of itemized {individuals[0]} 0.00 {individuals[0]}",
        f"Total of non-itemized {individuals[1]} 0.00 {individuals[1]}",
    ]
    if with_party_unit:
        lines += [
            # A code carrying a slash and internal spaces, whose heading text also
            # wraps onto the next line.
            "Schedule A1 - PTY/TERM PCC   Contributions from",
            "Total of itemized 1,000.00 0.00 1,000.00",
            "Total of non-itemized 0.00 0.00 0.00",
        ]
    lines += [
        "Schedule A2 - MISC   Receipts from Miscellaneous Income",
        "Total of itemized 0.00",
        "Total of non-itemized 44.93",
        "Schedule B1 - CE   Campaign Expenditures",
        "Total of itemized 11,350.46 0.00 742.21 12,092.67",
        "Total of non-itemized 3,179.92 0.00 0.00 3,179.92",
    ]
    return lines


# --- Telling a document from the Board saying no ------------------------------


@pytest.mark.parametrize(
    "body,expected",
    [
        (b"%PDF-1.4\nrest", documents.DocumentOutcome.served),
        (b"", documents.DocumentOutcome.empty),
        (
            b"File requested has not been released.  Try back on 02/02/2027 at 8am",
            documents.DocumentOutcome.not_released,
        ),
        (
            b"The file requested has not been released.  Files are available at 8am "
            b"following the due date.  If you believe that this report should be "
            b"available please contact the board.",
            documents.DocumentOutcome.not_released,
        ),
        (b"Requested file not found.", documents.DocumentOutcome.not_found),
        (
            b"<!DOCTYPE html><html><body>" + b"x" * 30_000 + b"</body></html>",
            documents.DocumentOutcome.error_page,
        ),
    ],
)
def test_only_a_body_starting_with_pdf_counts_as_a_document(body, expected) -> None:
    """All 6 arrive as HTTP 200, and 5 of them are the Board saying no.

    A check asking "is the body HTML" passes 4 of the 5 refusals as success, and one
    asking "did I get bytes back" passes 4 as well (§9.4).
    """
    outcome, note = documents.classify_document(200, body)
    assert outcome is expected
    assert note


def test_a_non_200_is_reported_as_the_status_it_answered() -> None:
    outcome, note = documents.classify_document(403, b"forbidden")
    assert outcome is documents.DocumentOutcome.http_error
    assert "403" in note


# --- Reading the totals by schedule code --------------------------------------


def test_totals_are_found_however_far_they_sit_from_their_heading() -> None:
    """In one real party-unit report the heading is at line 104 and its totals at 1,924.

    Reading near a heading works on a small candidate report and finds nothing on a
    party unit, so the scan runs heading to heading instead.
    """
    lines = (
        ["Schedule A1 - CR   Contributions Received"]
        + [f"Donor {index} 01/02/2025 250.00" for index in range(1_800)]
        + [
            "Total of itemized 170,053.52 5,751.39 175,804.91",
            "Total of non-itemized 578,590.42 0.00 578,590.42",
        ]
    )
    document = documents.schedules_from_lines(lines)
    assert document.errors == []
    totals = document.schedules["A1 - CR"]
    assert totals.itemized == (
        Decimal("170053.52"),
        Decimal("5751.39"),
        Decimal("175804.91"),
    )
    assert totals.contribution_cash() == Decimal("748643.94")


def test_a_summary_row_naming_a_schedule_mid_sentence_is_not_a_heading() -> None:
    """The cover page prints "... Schedule A2-LP 0.00" inside a numbered summary row."""
    document = documents.schedules_from_lines(candidate_lines())
    assert sorted(document.schedules) == ["A1 - IND", "A2 - MISC", "B1 - CE"]


def test_a_schedule_code_may_carry_a_slash_and_internal_spaces() -> None:
    document = documents.schedules_from_lines(candidate_lines(with_party_unit=True))
    assert "A1 - PTY/TERM PCC" in document.schedules


def test_a_schedule_that_appears_twice_is_an_error_rather_than_the_first_one() -> None:
    """Every document measured prints each code once, so a repeat is a lost boundary."""
    document = documents.schedules_from_lines(
        [
            "Schedule A1 - IND   Contributions from Individuals",
            "Total of itemized 1.00 0.00 1.00",
            "Total of non-itemized 0.00 0.00 0.00",
            "Schedule A1 - IND   Contributions from Individuals",
            "Total of itemized 9.00 0.00 9.00",
            "Total of non-itemized 0.00 0.00 0.00",
        ]
    )
    assert any("more than once" in error for error in document.errors)


def test_a_contribution_row_whose_columns_do_not_add_up_is_an_error() -> None:
    """Cash plus in-kind must equal the printed total, which catches a column shift."""
    document = documents.schedules_from_lines(
        [
            "Schedule A1 - IND   Contributions from Individuals",
            "Total of itemized 2,150.00 250.00 9,999.00",
            "Total of non-itemized 0.00 0.00 0.00",
        ]
    )
    stated, errors = documents.stated_contributions(
        document, Kind.candidate_committee, {}
    )
    assert stated is None
    assert any("does not add up" in error for error in errors)


def test_a_real_pdf_round_trips_through_the_reader() -> None:
    """Covers ``extract_lines``, which is the step that turns bytes into lines."""
    document = documents.parse_report_document(pdf_of(candidate_lines()))
    assert document.page_count == 1
    assert document.schedules["A1 - IND"].itemized[0] == Decimal("2150.00")


def test_bytes_that_start_like_a_document_and_are_not_one_are_reported() -> None:
    document = documents.parse_report_document(b"%PDF-1.4\nnot really")
    assert document.schedules == {}
    assert any("will not open" in error for error in document.errors)


# --- Proving the reader before it may accuse anyone ---------------------------

FIGURES = {
    "individuals_contributions": Decimal("5436.57"),
    "lobbyist_contributions": Decimal("0"),
    "committee_fund_contributions": Decimal("0"),
    "party_unit_contributions": Decimal("0"),
    "other_contributions": Decimal("0"),
}


def test_the_reader_passes_when_it_reproduces_the_boards_own_figures() -> None:
    """Each contributor-type figure equals its schedule's itemized plus non-itemized."""
    document = documents.schedules_from_lines(candidate_lines())
    stated, errors = documents.stated_contributions(
        document, Kind.candidate_committee, FIGURES
    )
    assert errors == []
    assert stated.self_test is documents.SelfTest.passed
    assert stated.itemized == Decimal("2150.00")
    assert stated.non_itemized == Decimal("3286.57")


def test_a_reader_that_finds_nothing_fails_rather_than_reporting_an_empty_filing() -> (
    None
):
    """The worst of the 3 parser bugs §9.4 caught returned zero rows for all 4 filers.

    A wrong number invites suspicion; "no data at all" invites a conclusion about the
    source. So an **absent** schedule is compared against its stored figure exactly as a
    present one is, and a reader that reads nothing cannot pass its own test.
    """
    # A document the reader found no totals in at all reports itself broken outright.
    empty = documents.schedules_from_lines(["Certification", "Page 1"])
    stated, errors = documents.stated_contributions(
        empty, Kind.candidate_committee, FIGURES
    )
    assert stated is None
    assert any("no schedule" in error for error in errors)

    # And the subtler one: the reader found other schedules and missed the
    # contribution blocks, so nothing looks wrong until its figures are compared.
    partial = documents.schedules_from_lines(
        [
            "Schedule B1 - CE   Campaign Expenditures",
            "Total of itemized 11,350.46 0.00 742.21 12,092.67",
            "Total of non-itemized 3,179.92 0.00 0.00 3,179.92",
        ]
    )
    stated, errors = documents.stated_contributions(
        partial, Kind.candidate_committee, FIGURES
    )
    assert errors == []
    assert stated.self_test is documents.SelfTest.failed
    assert "A1 - IND" in stated.self_test_detail


def test_an_absent_schedule_is_a_real_zero_when_the_board_agrees_it_is() -> None:
    """Filer 17709's report prints no party-unit block and the route reports $0.00."""
    document = documents.schedules_from_lines(candidate_lines())
    stated, _ = documents.stated_contributions(
        document, Kind.candidate_committee, FIGURES
    )
    assert stated.self_test is documents.SelfTest.passed
    assert "A1 - PTY/TERM PCC" in stated.self_test_detail


def test_a_missing_stored_figure_is_not_a_weak_pass() -> None:
    """Real: the totals route serves no 2025 block at all for filer 18488.

    Its 2025 report itemizes $2,300.00, so throwing the case away would drop the
    sharpest one there is. It is reported as unproved rather than as proved.
    """
    document = documents.schedules_from_lines(candidate_lines())
    stated, _ = documents.stated_contributions(document, Kind.candidate_committee, {})
    assert stated.self_test is documents.SelfTest.not_available
    assert stated.itemized == Decimal("2150.00")


def test_the_report_type_is_passed_through_rather_than_chosen_from_a_known_set() -> (
    None
):
    """§9.4's first 3 values were an incomplete list, not a restrictive one.

    ``A``, ``B``, ``G`` and ``D`` all name real reports, and choosing among a fixed set
    would lose whichever type nobody had met yet -- as a polite plain-text refusal
    rather than as an error.
    """
    form = documents.document_form(
        registration_number="20010",
        filing_year=2025,
        kind=Kind.party_unit,
        report_type="D",
        amendment_index=2,
        special_election=False,
    )
    assert form["period"] == "D"
    assert form["type"] == "ptu"
    assert form["year"] == "25"
    assert form["amend"] == "2"


# --- A fake Board that serves documents ---------------------------------------


class _DocumentHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        length = int(self.headers.get("Content-Length", "0"))
        form = parse_qs(self.rfile.read(length).decode("utf-8"))
        board = self.server.documents  # type: ignore[attr-defined]
        body = board.get(form.get("regnum", [""])[0], b"Requested file not found.")
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:  # pragma: no cover - quiet in tests
        return


@pytest.fixture()
def documents_server() -> Iterator[tuple[str, dict[str, bytes]]]:
    """A real socket, like every other Board fake in this suite."""
    served: dict[str, bytes] = {}
    server = ThreadingHTTPServer(("127.0.0.1", 0), _DocumentHandler)
    server.documents = served  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", served
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    _clear(session)
    session.execute(text("DELETE FROM cf_stated_split"))
    session.commit()
    try:
        yield session
    finally:
        session.rollback()
        session.execute(text("DELETE FROM cf_stated_split"))
        session.commit()
        _clear(session)
        session.close()


@pytest.fixture()
def board() -> Iterator[FakeBoard]:
    """The download side's fake, unchanged, so a release can be published here."""
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


# --- Which committee-years get checked ----------------------------------------


def test_a_committee_year_with_no_rows_and_no_figures_is_still_checked(
    db, board, store
) -> None:
    """The sharpest case there is, and a narrower population drops it.

    Filer 18488 has no 2025 payment rows and the Board's totals route serves no 2025
    block for it, while its catalogue lists a 2025 report itemizing $2,300.00. A
    population built from our rows and their figures alone would never look at it.
    """
    snapshot = seed_filings_snapshot(db, reported={("19200", 2025): "2000.00"})
    db.add(
        models.CampaignFinanceFilingReport(
            snapshot_id=snapshot.id,
            row_number=900,
            registration_number="30161",
            filing_year=2025,
            report_type="YE",
            report_name="2025 Year-End Report",
            cut_off_date=date(2025, 12, 31),
            special_election=False,
            effective_amendment_index=1,
            amendment_count=2,
        )
    )
    db.commit()
    publish_first(db, board, store)
    found = {
        (target.registration_number, target.filing_year): target
        for target in split.targets(db, live(db), snapshot.id, [2025])
    }
    assert ("30161", 2025) in found
    assert found[("30161", 2025)].skip_reason is None


def test_a_year_the_board_serves_no_document_for_is_not_checked(
    db, board, store
) -> None:
    """ "We could not look" must never read as "we looked and it was fine"."""
    snapshot = seed_filings_snapshot(
        db, reported={("19200", 2022): "2000.00"}, years=(2022,)
    )
    publish_first(db, board, store)
    found = split.targets(db, live(db), snapshot.id, [2022])
    assert found
    assert all("serves no report document for 2022" in t.skip_reason for t in found)


def test_a_special_election_year_is_not_checked_and_says_why(db, board, store) -> None:
    """That filer files a second series covering part of the year (§9.5)."""
    snapshot = seed_filings_snapshot(
        db,
        reported={("19200", 2025): "2000.00"},
        special_election={("19200", 2025)},
    )
    publish_first(db, board, store)
    found = {
        t.registration_number: t
        for t in split.targets(db, live(db), snapshot.id, [2025])
    }
    assert "special-election" in found["19200"].skip_reason


# --- What we hold -------------------------------------------------------------


def test_our_rows_are_filtered_scoped_and_bounded(db, board, store) -> None:
    """3 rules, each measured, each of which silently breaks the comparison if skipped.

    Only ``Receipt type = 'Contribution'`` counts; the file's own ``Year`` column scopes
    the year rather than the year of a row's date; and the period ends at the report's
    cut-off. The fixture carries one row of each awkward shape: a $5,000 receipt that is
    not a contribution, and a row whose ``Year`` is 2025 while its date is in 2026.
    """
    seed_filings_snapshot(db, reported={("19200", 2025): "2000.00"})
    publish_first(db, board, store)
    total, cash, rows = split.ours_itemized(
        db, live(db), "19200", 2025, date(2025, 12, 31)
    )
    # The $5,000 Miscellaneous receipt is out, and so is the $75 row dated in 2026.
    assert total == Decimal("1526.0578")
    # 2 of the rows are in-kind, worth $6.49 and $15.00.
    assert cash == Decimal("1504.5678")
    assert rows == 7


def test_a_row_with_no_date_is_counted_inside_the_period(db, board, store) -> None:
    """Deliberately the direction that can cause a false disagreement.

    A false disagreement withholds a split loudly; a missed shortfall publishes a wrong
    figure quietly, and the quiet direction is the one this whole check exists for.
    """
    seed_filings_snapshot(db, reported={("19200", 2025): "2000.00"})
    publish_first(db, board, store)
    db.execute(
        text(
            "UPDATE cf_contribution_row SET receipt_date = NULL "
            " WHERE recipient_reg_num = '19200' AND amount = 250.0000"
        )
    )
    db.commit()
    total, _, _ = split.ours_itemized(db, live(db), "19200", 2025, date(2025, 6, 30))
    # The undated $250 is counted; every row dated after 30 June is not.
    assert total == Decimal("1459.5678")


# --- End to end ---------------------------------------------------------------


def _prepare(db, board, store, *, itemized: str, non_itemized: str, figure: str):
    snapshot = seed_filings_snapshot(db, reported={("19200", 2025): figure})
    publish_first(db, board, store)
    lines = candidate_lines(individuals=(itemized, non_itemized))
    return snapshot, pdf_of(lines)


def _check(db, snapshot, base_url, registration="19200", year=2025):
    release = live(db)
    target = next(
        t
        for t in split.targets(db, release, snapshot.id, [year])
        if t.registration_number == registration
    )
    session = requests.Session()
    try:
        return split.check_one(db, session, release, snapshot.id, target, base_url)[0]
    finally:
        session.close()


def test_a_committee_whose_filing_matches_our_rows_agrees(
    db, board, store, documents_server
) -> None:
    base_url, served = documents_server
    # Our fixture rows for 19200, bounded by 31 December, total $1,526.0578.
    snapshot, pdf = _prepare(
        db, board, store, itemized="1,526.0578", non_itemized="473.94", figure="2000.00"
    )
    served["19200"] = pdf
    verdict = _check(db, snapshot, base_url)
    assert verdict.status is Status.agrees
    assert verdict.ours_itemized == Decimal("1526.0578")


def test_a_filing_that_names_more_than_we_hold_disagrees(
    db, board, store, documents_server
) -> None:
    """The one direction nothing else can see.

    Our rows still fit inside the committee's reported total, so the other
    reconciliation passes; the shortfall lands in the derived "no donor named" figure
    and reads as ordinary small-donor money.
    """
    base_url, served = documents_server
    snapshot, pdf = _prepare(
        db, board, store, itemized="1,826.0578", non_itemized="173.94", figure="2000.00"
    )
    served["19200"] = pdf
    verdict = _check(db, snapshot, base_url)
    assert verdict.status is Status.disagrees
    assert verdict.stated_itemized - verdict.ours_itemized == Decimal("300")
    assert "300" in verdict.reason


def test_holding_no_rows_at_all_is_a_disagreement_and_says_so(
    db, board, store, documents_server
) -> None:
    """It must never render as "this money had no names"."""
    base_url, served = documents_server
    snapshot = seed_filings_snapshot(db, reported={("30161", 2025): "2300.00"})
    db.add(
        models.CampaignFinanceFilingReport(
            snapshot_id=snapshot.id,
            row_number=901,
            registration_number="30161",
            filing_year=2025,
            report_type="YE",
            cut_off_date=date(2025, 12, 31),
            special_election=False,
            effective_amendment_index=0,
            amendment_count=1,
        )
    )
    db.commit()
    publish_first(db, board, store)
    served["30161"] = pdf_of(candidate_lines(individuals=("2,300.00", "0.00")))
    verdict = _check(db, snapshot, base_url, registration="30161")
    assert verdict.status is Status.disagrees
    assert verdict.ours_itemized == Decimal("0")
    assert "no rows at all" in verdict.reason


def test_a_reader_that_cannot_prove_itself_blames_itself_and_not_the_data(
    db, board, store, documents_server
) -> None:
    """ "Our reader is wrong" and "the data is wrong" must never come out the same way."""
    base_url, served = documents_server
    snapshot, pdf = _prepare(
        db, board, store, itemized="1.00", non_itemized="1.00", figure="2000.00"
    )
    served["19200"] = pdf
    verdict = _check(db, snapshot, base_url)
    assert verdict.status is Status.reader_unproven
    assert verdict.ours_itemized is None
    assert "reader" in verdict.reason


def test_a_document_the_board_will_not_serve_is_not_checked(
    db, board, store, documents_server
) -> None:
    base_url, _served = documents_server
    snapshot, _pdf = _prepare(
        db, board, store, itemized="1.00", non_itemized="1.00", figure="2000.00"
    )
    verdict = _check(db, snapshot, base_url)
    assert verdict.status is Status.not_checked
    assert "not found" in verdict.reason


# --- Storing and reading it ---------------------------------------------------


def test_a_stored_verdict_reads_back_for_the_release_it_was_made_about(
    db, board, store
) -> None:
    seed_filings_snapshot(db, reported={("19200", 2025): "2000.00"})
    publish_first(db, board, store)
    release = live(db)
    filings = split._live_filings_snapshot_id(db)
    split.store_verdicts(
        db,
        release.contributions.snapshot_id,
        filings,
        [
            split.Verdict(
                registration_number="19200",
                filing_year=2025,
                status=Status.disagrees,
                reason="the filing states more than we hold",
                stated_itemized=Decimal("1826.06"),
                ours_itemized=Decimal("1526.06"),
                cut_off_date=date(2025, 12, 31),
                self_test="passed",
            )
        ],
    )
    found = service.stated_split_for_year(db, release, "19200", 2025)
    assert found.status == service.DISAGREES
    assert found.difference == Decimal("300.00")
    assert found.may_show_a_split is False
    assert service.committee_years_that_must_not_show_a_split(db, release) == frozenset(
        {("19200", 2025)}
    )


def test_a_committee_year_nobody_has_checked_reads_as_not_run(db, board, store) -> None:
    """A fact about us. A caller must never read an absent row as a clean result."""
    seed_filings_snapshot(db, reported={("19200", 2025): "2000.00"})
    publish_first(db, board, store)
    found = service.stated_split_for_year(db, live(db), "19200", 2025)
    assert found.status == service.NOT_RUN
    assert found.may_show_a_split is False
    assert found.stated_itemized is None


def test_writing_the_same_committee_year_twice_replaces_rather_than_duplicates(
    db, board, store
) -> None:
    """Two answers for one committee-year would leave a page choosing between them."""
    seed_filings_snapshot(db, reported={("19200", 2025): "2000.00"})
    publish_first(db, board, store)
    release = live(db)
    filings = split._live_filings_snapshot_id(db)
    for status in (Status.disagrees, Status.agrees):
        split.store_verdicts(
            db,
            release.contributions.snapshot_id,
            filings,
            [
                split.Verdict(
                    registration_number="19200",
                    filing_year=2025,
                    status=status,
                    reason=status.value,
                )
            ],
        )
    assert service.stated_split(db, release, "19200") == [
        service.StatedSplit(
            reg_num="19200",
            year=2025,
            status=service.AGREES,
            reason="agrees",
            checked_at=service.stated_split(db, release, "19200")[0].checked_at,
        )
    ]


# --- What the loader reports --------------------------------------------------


def contributions_checks(report) -> dict:
    outcome = next(
        outcome
        for outcome in report.outcomes
        if outcome.spec.dataset is models.CampaignFinanceDataset.contributions
    )
    return {check.name: check for check in outcome.checks}


def test_the_loader_names_the_command_when_nobody_has_compared_these_records(
    db, board, store
) -> None:
    seed_filings_snapshot(db, reported={("19200", 2025): "2000.00"})
    report = cf.load_campaign_finance(
        db,
        landing_page=board.landing_page,
        store=store,
        dry_run=True,
        log=lambda message: None,
    )
    check = contributions_checks(report)["reported_itemized_split_matches_ours"]
    assert check.status == "not_run"
    assert "check_campaign_finance_stated_split" in check.detail


def test_the_loader_reports_a_disagreement_and_does_not_block_the_release(
    db, board, store
) -> None:
    """Eugene ruled on 12 Aug 2026 that this is a display state, not a release fault.

    A million verified payment records must not be withheld because 1 committee's own
    2 published figures contradict each other.
    """
    seed_filings_snapshot(db, reported={("19200", 2025): "2000.00"})
    published = publish_first(db, board, store)
    release = db.get(models.CampaignFinanceRelease, published.release_id)
    split.store_verdicts(
        db,
        release.contributions_snapshot_id,
        split._live_filings_snapshot_id(db),
        [
            split.Verdict(
                registration_number="19200",
                filing_year=2025,
                status=Status.disagrees,
                reason="short",
                stated_itemized=Decimal("1826.06"),
                ours_itemized=Decimal("1526.06"),
            )
        ],
    )
    # Re-running finds the same records, so the stored answers describe them.
    again = cf.load_campaign_finance(
        db,
        landing_page=board.landing_page,
        store=store,
        dry_run=True,
        log=lambda message: None,
    )
    check = contributions_checks(again)["reported_itemized_split_matches_ours"]
    assert check.status == "reported"
    assert check.blocks_publication is False
    assert check.filer_years == ("19200:2025",)
    assert "Compared against each filing's own itemized subtotal" in (
        again.reconciliation_line()
    )


def test_the_loader_passes_the_check_when_every_committee_year_agrees(
    db, board, store
) -> None:
    seed_filings_snapshot(db, reported={("19200", 2025): "2000.00"})
    published = publish_first(db, board, store)
    release = db.get(models.CampaignFinanceRelease, published.release_id)
    split.store_verdicts(
        db,
        release.contributions_snapshot_id,
        split._live_filings_snapshot_id(db),
        [
            split.Verdict(
                registration_number="19200",
                filing_year=2025,
                status=Status.agrees,
                reason="matches",
            )
        ],
    )
    again = cf.load_campaign_finance(
        db,
        landing_page=board.landing_page,
        store=store,
        dry_run=True,
        log=lambda message: None,
    )
    check = contributions_checks(again)["reported_itemized_split_matches_ours"]
    assert check.status == "passed"
    assert check.filer_years == ()


def test_a_run_with_nowhere_to_write_refuses_before_it_asks_the_board(
    db, board, store
) -> None:
    """A run is ~1,300 requests over ~20 minutes and its first write is its last step.

    So a missing destination used to throw the whole run away and ask the Board for all
    of it a second time. Found on the first production run, 13 Aug 2026.
    """
    seed_filings_snapshot(db, reported={("19200", 2025): "2000.00"})
    publish_first(db, board, store)
    db.execute(text("ALTER TABLE cf_stated_split RENAME TO cf_stated_split_hidden"))
    db.commit()
    try:
        with pytest.raises(RuntimeError, match="no cf_stated_split table"):
            split.run_stated_split_check(
                db, years=[2025], base_url="http://127.0.0.1:1"
            )
    finally:
        db.rollback()
        db.execute(text("ALTER TABLE cf_stated_split_hidden RENAME TO cf_stated_split"))
        db.commit()


def test_the_run_reports_its_readers_accuracy_as_a_measured_number() -> None:
    """§9.4 asks for it before the reader may block anything, and it is the only honest
    weight to put on a committee-year whose own self-test could not run."""
    run = split.StatedSplitRun(years=(2025,), started_at=datetime.now(UTC))
    run.verdicts = [
        split.Verdict("1", 2025, Status.agrees, "", self_test="passed"),
        split.Verdict("2", 2025, Status.disagrees, "", self_test="passed"),
        split.Verdict("3", 2025, Status.reader_unproven, "", self_test="failed"),
        split.Verdict("4", 2025, Status.disagrees, "", self_test="not_available"),
        split.Verdict("5", 2025, Status.not_checked, ""),
    ]
    assert run.reader_accuracy() == (2, 3)
    assert run.counts() == {
        "agrees": 1,
        "disagrees": 2,
        "reader_unproven": 1,
        "not_checked": 1,
    }
