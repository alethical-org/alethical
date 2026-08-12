"""What the Board's own figures and filer list must survive as, and what must stop a run.

Net: the routes behind these tests are undocumented and answer **HTTP 200 to at least 6
kinds of failure**, so almost every test here is a fake Board answering 200 with
something wrong and an assertion that the run refuses it. A test asserting the happy
path would pass against a route that had silently started returning nothing.

The fake Board is served over a real socket rather than by patching ``requests``,
matching ``test_campaign_finance_load.py``: the failures worth catching are in how a
real response is read, and a patched client cannot produce a 403 with an Apache error
page or a chunked body.
"""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterator, Optional
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select, text

from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.pipeline import campaign_finance_filings as filings

FilerKind = models.CampaignFinanceFilerKind

# One candidate committee, one party unit and one committee-or-fund, so both label sets
# and all 3 viewers are exercised by the default fixture rather than by a special case.
DIRECTORY_ROWS: dict[FilerKind, list[dict[str, Any]]] = {
    FilerKind.candidate_committee: [
        {
            "RegisteredEntityFullName": "Marty, John Senate Committee",
            "RegisteredEntityID": "11880",
            "Party": "DFL",
            "OfficeSoughtFullName": "Senate",
            "District": "40",
            "RegistrationDate": "1994-01-01 00:00:00.000",
            "TerminationDate": None,
            "Incumbent": "1",
            "CandidateFullName": "Marty, John",
            "DistrictKey": "40",
            "OfficeKey": "Senate",
        },
        {
            "RegisteredEntityFullName": "Novotny, Paul House Committee",
            "RegisteredEntityID": "18999",
            "Party": "RPM",
            "OfficeSoughtFullName": "House",
            "District": "30B",
            "RegistrationDate": "2020-06-01 00:00:00.000",
            # A closed committee, which §7 makes a display state of its own.
            "TerminationDate": "2026-07-28 00:00:00.000",
            "Incumbent": "1",
            "CandidateFullName": "Novotny, Paul",
            "DistrictKey": "30B",
            "OfficeKey": "House",
        },
    ],
    # 4 columns, not 11. The party-unit and committee-or-fund lists really are narrower,
    # so party, office and district are absent rather than empty.
    FilerKind.party_unit: [
        {
            "RegisteredEntityFullName": "Republican Party of Minnesota",
            "RegisteredEntityID": "20008",
            "RegistrationDate": "1974-06-28 00:00:00.000",
            "TerminationDate": None,
        }
    ],
    FilerKind.political_committee_or_fund: [
        {
            "RegisteredEntityFullName": "Green Party of Minn",
            "RegisteredEntityID": "20724",
            "RegistrationDate": "1997-05-27 00:00:00.000",
            "TerminationDate": None,
        }
    ],
}

CANDIDATE_AMOUNTS = {
    "Beginning cash balance": "$25,160.91",
    "Individuals contributions": "$12,875.00",
    "Lobbyist contributions": "$0.00",
    "Committee/fund contributions": "$0.00",
    "Party unit contributions": "$1,000.00",
    "Other contributions": "$0.00",
    "Public subsidy payments": "$0.00",
    "Loans payable income": "$0.00",
    "Miscellaneous income": "$25.48",
    "Total receipts": "$13,900.48",
    "Campaign expenditures": "$1,388.17",
    "Noncampaign disbursements": "$783.98",
    "Other expenditures": "$0.00",
    "Total expenditures": "$7,172.15",
    "Ending cash balance": "$31,889.24",
    "Unpaid bills and loans": "$0.00",
}
PARTY_UNIT_AMOUNTS = {
    "Beginning cash balance": "$2,130.77",
    "Contributions received": "$748,643.94",
    "Loans payable income": "$0.00",
    "Miscellaneous income": "$5.99",
    "Total receipts": "$748,649.93",
    "General expenditures": "$647,671.22",
    "Contributions to candidate": "$0.00",
    "Approved expenditures": "$0.00",
    "Contributions to party units": "$72,600.00",
    "Contributions to committee / funds": "$0.00",
    "Independent expenditure": "$0.00",
    "Ballot question expenditure": "$0.00",
    "Total expenditures": "$720,271.22",
    "Ending cash balance": "$30,509.48",
    "Unpaid bills and loans": "$0.00",
}
DATED_LABELS = (
    "Beginning cash balance",
    "Ending cash balance",
    "Unpaid bills and loans",
)


# --- The Board, faked over a real socket -------------------------------------


@dataclass
class FakeBoard:
    """The 3 routes, and every way this fixture can be told to answer wrongly."""

    port: int = 0
    # Per (registration, year) overrides of one label's served value.
    amount_overrides: dict[tuple[str, int], dict[str, str]] = field(
        default_factory=dict
    )
    # Registrations to answer with no financial block at all, which is what a wrong
    # viewer and an unregistered filer both produce.
    empty_filers: set[str] = field(default_factory=set)
    directory_status: dict[FilerKind, int] = field(default_factory=dict)
    # Answer the directory with the JSON literal `false`, as omitting a parameter does.
    directory_returns_false: set[FilerKind] = field(default_factory=set)
    figures_status: int = 200
    figures_status_uses: int = 0
    extra_label: Optional[str] = None
    drop_label: Optional[str] = None
    repeat_label: Optional[str] = None
    unreadable_amendments: bool = False
    null_amendments: bool = False
    special_election_filers: set[str] = field(default_factory=set)
    reported_through: dict[tuple[str, int], str] = field(default_factory=dict)
    requests_seen: list[tuple[str, dict[str, str]]] = field(default_factory=list)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def kind_for(self, registration: str) -> Optional[FilerKind]:
        for kind, rows in DIRECTORY_ROWS.items():
            if any(row["RegisteredEntityID"] == registration for row in rows):
                return kind
        return None

    def directory_payload(self, kind: FilerKind) -> Any:
        if kind in self.directory_returns_false:
            return False
        rows = DIRECTORY_ROWS[kind]
        columns = list(rows[0])
        return {
            "cols": columns,
            # Keyed by registration with a *list* of rows per key, which is the shape
            # the real route uses and the reason a flat-array reader finds nothing.
            "data": {
                row["RegisteredEntityID"]: [[row[name] for name in columns]]
                for row in rows
            },
        }

    def financial_payload(self, registration: str, segment: tuple[int, int]) -> Any:
        if registration in self.empty_filers:
            blocks = "".join(
                f'<div class="col-md-6">Data not available for {year}</div>'
                for year in segment
            )
            return {"tabcontent": f'<div class="row">{blocks}</div>'}
        kind = self.kind_for(registration)
        base = (
            CANDIDATE_AMOUNTS
            if kind is FilerKind.candidate_committee
            else PARTY_UNIT_AMOUNTS
        )
        tables = []
        for year in segment:
            amounts = dict(base)
            amounts.update(self.amount_overrides.get((registration, year), {}))
            if self.drop_label:
                amounts.pop(self.drop_label, None)
            through = self.reported_through.get((registration, year), f"12/31/{year}")
            rows = [f'<tr><th colspan="2">{year} - Election year</th></tr>']
            for label, value in amounts.items():
                shown = f"{label} as of {through}" if label in DATED_LABELS else label
                rows.append(f"<tr><th>{shown}</th><td>{value}</td></tr>")
                if label == "Beginning cash balance":
                    rows.append(
                        f"<tr><th>Most recent report through</th><td>{through}</td></tr>"
                    )
                    # The spacer row exactly as served: a <td> closed by </th>. Invalid
                    # markup, and the reason rows are classified by which cells they
                    # hold rather than by a rule naming this row.
                    rows.append('<tr class="divider"><td colspan="2"></th></tr>')
            if self.extra_label:
                rows.append(f"<tr><th>{self.extra_label}</th><td>$1.00</td></tr>")
            if self.repeat_label:
                rows.append(f"<tr><th>{self.repeat_label}</th><td>$2.00</td></tr>")
            tables.append(
                '<div class="table-responsive col-md-6">'
                f'<table class="spec-spreadsheet">{"".join(rows)}</table></div>'
            )
        return {"tabcontent": f'<div class="row">{"".join(tables)}</div>'}

    def catalogue_payload(self, registration: str, segment: tuple[int, int]) -> Any:
        if self.unreadable_amendments:
            amendments: Any = ["not-a-number"]
        elif self.null_amendments:
            amendments = None
        else:
            amendments = ["1", "0", "1", "0"]
        reports = {}
        for offset, year in enumerate(sorted(segment)):
            reports[f"hash{offset}"] = {
                "RegisteredEntityID": registration,
                "RegisteredEntityType": "PCC",
                "ReportType": "YE",
                "FilingYear": str(year),
                "as_2DigitYear": str(year)[2:],
                "ReportName": f"{year} Year-End Report",
                "PrePrimaryReport": "0",
                "PreGeneralReport": "0",
                "YearEndReport": "1",
                "SpecialElectionindicator": "0",
                "SpecialElectionDistrict": "N/A",
                "TerminationDate": None,
                "TerminationYear": None,
                "District": "40",
                "NoticePeriod": "1",
                "CutOffDate": f"{year}-12-31 00:00:00",
                "amendments": amendments,
            }
        if registration in self.special_election_filers:
            year = max(segment)
            reports["special"] = {
                "RegisteredEntityID": registration,
                "RegisteredEntityType": "PCC",
                "ReportType": "YE",
                "FilingYear": str(year),
                "as_2DigitYear": str(year)[2:],
                "ReportName": f"Special Election: {year} Election Cycle Final Report",
                "PrePrimaryReport": "0",
                "PreGeneralReport": "0",
                "YearEndReport": "1",
                "SpecialElectionindicator": "1",
                "SpecialElectionDistrict": "40",
                "TerminationDate": None,
                "TerminationYear": None,
                "District": "40",
                "NoticePeriod": "1",
                "CutOffDate": f"{year}-10-01 00:00:00",
                "amendments": ["0"],
            }
        return {"data": {"pdfs": reports}, "tabcontent": "<p>reports</p>"}


class _Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        board: FakeBoard = self.server.board  # type: ignore[attr-defined]
        length = int(self.headers.get("Content-Length") or 0)
        form = {
            key: values[0]
            for key, values in parse_qs(self.rfile.read(length).decode("utf-8")).items()
        }
        path = urlparse(self.path).path
        board.requests_seen.append((path, form))

        # The cookie gate, exactly as measured: a cookie *named* PHPSESSID is required
        # and its value is never read, so `x=y` gets an Apache 403 page and an empty
        # PHPSESSID gets through.
        if "PHPSESSID" not in (self.headers.get("Cookie") or ""):
            self._send(
                403,
                b"<html><head><title>403 Forbidden</title></head></html>",
                "text/html",
            )
            return

        if path == filings.FILER_DIRECTORY_PATH:
            kind = next(
                (
                    candidate
                    for candidate, action in filings.DIRECTORY_ACTION_BY_KIND.items()
                    if action == form.get("data[action]")
                ),
                None,
            )
            if kind is None:
                self._json(200, [])
                return
            status = board.directory_status.get(kind, 200)
            if status != 200:
                self._send(status, b"nope", "text/plain")
                return
            if form.get("data[params][0]") != "all":
                # The real route's answer to a missing parameter: the literal false.
                self._json(200, False)
                return
            self._json(200, board.directory_payload(kind))
            return

        registration = form.get("id", "")
        segment = (
            int(form["year_data[ElectionSegmentStartDate]"]),
            int(form["year_data[ElectionSegmentEndDate]"]),
        )
        if form.get("tabname") == "reports_data":
            self._json(200, board.catalogue_payload(registration, segment))
            return
        if board.figures_status != 200 and board.figures_status_uses > 0:
            board.figures_status_uses -= 1
            self._send(board.figures_status, b"", "text/plain")
            return
        self._json(200, board.financial_payload(registration, segment))

    def do_GET(self) -> None:  # noqa: N802
        # A GET with the same parameters is one of the silent failures, so the fake
        # answers it the way the real route does rather than refusing it.
        self._json(200, {"tabcontent": "<p>No information found for </p>"})

    def _json(self, status: int, payload: Any) -> None:
        self._send(status, json.dumps(payload).encode("utf-8"), "application/json")

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        return


class MemoryStore:
    """Stands in for the private Supabase bucket, with the same read-back check."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def exists(self, key: str) -> bool:
        return key in self.objects

    def put_and_verify(self, key: str, path: str, expected_sha256: str) -> None:
        data = Path(path).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected_sha256:
            raise RuntimeError("stored bytes do not hash to what was uploaded")
        self.objects[key] = data

    def get(self, key: str, destination: str) -> None:
        Path(destination).write_bytes(self.objects[key])


def _clear(session) -> None:
    session.rollback()
    session.execute(text("UPDATE cf_filing_current SET snapshot_id = NULL"))
    for table in (
        "cf_filing_figure",
        "cf_filing",
        "cf_filing_report",
        "cf_filer",
        "cf_filing_snapshot",
    ):
        session.execute(text(f"DELETE FROM {table}"))
    session.commit()


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


def run(db, board: FakeBoard, store: MemoryStore, **kwargs) -> filings.FilingsRun:
    kwargs.setdefault("years", [2024, 2025])
    return filings.load_campaign_finance_filings(
        db,
        store=store,
        base_url=board.base_url,
        spacing_seconds=0.0,
        log=lambda message: None,
        **kwargs,
    )


def publish_first(
    db, board: FakeBoard, store: MemoryStore, **kwargs
) -> filings.FilingsRun:
    """Get a first snapshot live.

    There is deliberately no first-run exception: a first run has nothing to compare
    against, so it quarantines like any other and an operator publishes it by naming
    the record hash they reviewed. This helper is that operator.
    """
    first = run(db, board, store, **kwargs)
    assert first.blocked, first.summary()
    published = run(db, board, store, publish_hash=first.record_set_hash, **kwargs)
    assert not published.blocked, published.summary()
    return published


def figures_of(db, snapshot_id, registration: str, year: int) -> dict[str, Decimal]:
    filing = db.scalars(
        select(models.CampaignFinanceFiling).where(
            models.CampaignFinanceFiling.snapshot_id == snapshot_id,
            models.CampaignFinanceFiling.registration_number == registration,
            models.CampaignFinanceFiling.filing_year == year,
        )
    ).one()
    return {figure.line_key: figure.amount for figure in filing.figures}


def checks_of(run_result: filings.FilingsRun) -> dict[str, filings.Check]:
    return {check.name: check for check in run_result.checks}


# --- Reading a response ------------------------------------------------------


def test_the_spacer_row_the_board_serves_as_invalid_markup_is_not_read_as_a_figure(
    board,
) -> None:
    """``<td colspan="2"></th>`` is a real row in every response.

    A reader that paired header cells with value cells across row boundaries would
    glue the year heading onto the first label, which is exactly what a naive pass
    over the whole document does.
    """
    tab = filings.parse_financial_tab(
        board.financial_payload("11880", (2024, 2025)),
        FilerKind.candidate_committee,
        [2024, 2025],
    )
    assert tab.errors == []
    assert sorted(tab.years) == [2024, 2025]
    block = tab.years[2025]
    assert block.heading == "2025 - Election year"
    assert block.amounts["total_receipts"] == Decimal("13900.48")
    # The year heading stayed a heading. Glued onto the first label instead, it reads
    # "2025 - Election year ... Beginning cash balance as of 1/1/2025", which is what a
    # reader that spans row boundaries produces.
    assert not any("Election year" in label for label in block.served_labels.values())
    assert block.served_labels["beginning_cash_balance"].startswith(
        "Beginning cash balance as of"
    )
    # And every money line was read, so the spacer rows were skipped rather than
    # consuming their neighbours.
    assert len(block.amounts) == 16


def test_a_dated_label_matches_on_its_stem_and_keeps_the_date_it_was_served_with(
    board,
) -> None:
    """The date is not always 31 December, so the whole string is never the key."""
    board.reported_through[("11880", 2025)] = "11/16/2025"
    tab = filings.parse_financial_tab(
        board.financial_payload("11880", (2024, 2025)),
        FilerKind.candidate_committee,
        [2024, 2025],
    )
    assert tab.errors == []
    block = tab.years[2025]
    assert block.reported_through == date(2025, 11, 16)
    assert block.served_labels["ending_cash_balance"] == (
        "Ending cash balance as of 11/16/2025"
    )
    assert block.amounts["ending_cash_balance"] == Decimal("31889.24")


@pytest.mark.parametrize(
    "served, expected",
    [
        ("$1,234.56", Decimal("1234.56")),
        ("$0.00", Decimal("0")),
        ("-$1,234.56", Decimal("-1234.56")),
        ("$-1,234.56", Decimal("-1234.56")),
        ("($1,234.56)", Decimal("-1234.56")),
    ],
)
def test_money_parses_however_the_source_writes_the_sign(served, expected) -> None:
    assert filings.parse_money(served) == expected


@pytest.mark.parametrize(
    "served", ["", "n/a", "2025 - Election year", "12/31/2025", "$"]
)
def test_a_value_that_is_not_money_is_refused_rather_than_guessed(served) -> None:
    assert filings.parse_money(served) is None


def test_a_label_this_design_does_not_know_stops_the_read(board) -> None:
    board.extra_label = "Cryptocurrency contributions"
    tab = filings.parse_financial_tab(
        board.financial_payload("11880", (2024, 2025)),
        FilerKind.candidate_committee,
        [2024, 2025],
    )
    assert any("does not know" in error for error in tab.errors)


def test_a_missing_label_stops_the_read(board) -> None:
    board.drop_label = "Total receipts"
    tab = filings.parse_financial_tab(
        board.financial_payload("11880", (2024, 2025)),
        FilerKind.candidate_committee,
        [2024, 2025],
    )
    assert any("missing" in error for error in tab.errors)


def test_a_repeated_label_stops_the_read(board) -> None:
    board.repeat_label = "Total receipts"
    tab = filings.parse_financial_tab(
        board.financial_payload("11880", (2024, 2025)),
        FilerKind.candidate_committee,
        [2024, 2025],
    )
    assert any("repeats" in error for error in tab.errors)


def test_a_block_for_a_year_nobody_asked_for_stops_the_read(board) -> None:
    """The route ignores its own ``year`` field and answers from the segment alone.

    So a request naming 2026 with the segment 2020-2021 gets 2021 and 2020 back,
    correctly labelled and not what was wanted. Only checking the years against the
    request catches it.
    """
    tab = filings.parse_financial_tab(
        board.financial_payload("11880", (2020, 2021)),
        FilerKind.candidate_committee,
        [2024, 2025],
    )
    assert any("not requested" in error for error in tab.errors)
    assert any("neither carries a block" in error for error in tab.errors)


def test_a_response_that_is_not_an_object_carrying_tabcontent_stops_the_read() -> None:
    for payload in ([], False, None, {"other": 1}, {"tabcontent": 3}):
        tab = filings.parse_financial_tab(
            payload, FilerKind.candidate_committee, [2025]
        )
        assert tab.errors, payload


def test_an_empty_answer_names_the_years_it_has_nothing_for(board) -> None:
    """A filer nobody registered, and a wrong viewer, both produce exactly this."""
    board.empty_filers.add("11880")
    tab = filings.parse_financial_tab(
        board.financial_payload("11880", (2024, 2025)),
        FilerKind.candidate_committee,
        [2024, 2025],
    )
    assert tab.errors == []
    assert tab.years == {}
    assert tab.unavailable_years == {2024, 2025}


def test_an_answer_with_no_year_at_all_is_the_missing_parameter_failure() -> None:
    tab = filings.parse_financial_tab(
        {"tabcontent": '<div class="col-md-12">Data not available for </div>'},
        FilerKind.candidate_committee,
        [2025],
    )
    assert any("without naming a year" in error for error in tab.errors)


# --- The filer directory -----------------------------------------------------


def test_the_directory_literal_false_is_read_as_a_failure_not_as_no_filers() -> None:
    found, errors = filings.parse_directory_payload(False, FilerKind.party_unit)
    assert found == []
    assert any("data[params][0]=all" in error for error in errors)


def test_the_two_narrow_lists_have_no_party_or_district_and_that_is_not_a_gap(
    board,
) -> None:
    found, errors = filings.parse_directory_payload(
        board.directory_payload(FilerKind.party_unit), FilerKind.party_unit
    )
    assert errors == []
    assert [filer.registration_number for filer in found] == ["20008"]
    assert found[0].party is None and found[0].district is None
    assert found[0].registration_date == date(1974, 6, 28)


def test_a_candidate_row_carries_the_11_columns_the_narrow_lists_do_not(board) -> None:
    found, errors = filings.parse_directory_payload(
        board.directory_payload(FilerKind.candidate_committee),
        FilerKind.candidate_committee,
    )
    assert errors == []
    marty = next(filer for filer in found if filer.registration_number == "11880")
    assert marty.party == "DFL"
    assert marty.district == "40"
    assert marty.office == "Senate"
    assert marty.is_incumbent is True
    closed = next(filer for filer in found if filer.registration_number == "18999")
    assert closed.termination_date == date(2026, 7, 28)


def test_a_row_whose_width_disagrees_with_the_columns_is_refused() -> None:
    payload = {"cols": ["RegisteredEntityID", "Party"], "data": {"1": [["1"]]}}
    found, errors = filings.parse_directory_payload(payload, FilerKind.party_unit)
    assert found == []
    assert any("against 2 columns" in error for error in errors)


# --- The report catalogue ----------------------------------------------------


def test_a_duplicated_amendment_list_is_deduplicated_before_the_maximum(board) -> None:
    """One real report's list reads ``['1','0','1','0']``.

    Counted without deduplicating it would claim 4 versions of a 2-version report.
    """
    reports, errors = filings.parse_catalogue_payload(
        board.catalogue_payload("11880", (2024, 2025)), "11880"
    )
    assert errors == []
    assert {report.effective_amendment_index for report in reports} == {1}
    assert {report.amendment_count for report in reports} == {2}


def test_no_amendment_list_is_recorded_as_unknown_rather_than_as_version_zero(
    board,
) -> None:
    """5 of one real filer's 64 reports serve ``amendments: null``, all pre-2008.

    Recording 0 would assert the original version is effective, and §9.4 is explicit
    that a missing marker in an older year means the document is unavailable.
    """
    board.null_amendments = True
    reports, errors = filings.parse_catalogue_payload(
        board.catalogue_payload("11880", (2024, 2025)), "11880"
    )
    assert errors == []
    assert reports
    assert all(report.effective_amendment_index is None for report in reports)
    assert all(report.amendment_count is None for report in reports)


def test_an_amendment_list_that_is_there_and_unreadable_is_an_error(board) -> None:
    board.unreadable_amendments = True
    reports, errors = filings.parse_catalogue_payload(
        board.catalogue_payload("11880", (2024, 2025)), "11880"
    )
    assert reports == []
    assert any("cannot read" in error for error in errors)


def test_a_catalogue_row_for_a_different_filer_is_refused(board) -> None:
    payload = board.catalogue_payload("11880", (2024, 2025))
    next(iter(payload["data"]["pdfs"].values()))["RegisteredEntityID"] = "99999"
    reports, errors = filings.parse_catalogue_payload(payload, "11880")
    assert any("came back for" in error for error in errors)
    assert len(reports) == 1


# --- Asking the Board --------------------------------------------------------


def test_a_missing_cookie_gets_403_and_is_not_retried(board) -> None:
    """Retrying cannot fix a cookie, so a retry loop would make one failure 3 slow ones."""
    session = filings.http_session()
    session.headers["Cookie"] = "x=y"
    response, found, errors = filings.fetch_directory(
        session, FilerKind.party_unit, board.base_url
    )
    assert response.status_code == 403
    assert found == []
    assert any("PHPSESSID" in error for error in errors)
    assert len(board.requests_seen) == 1


def test_a_server_error_is_retried(board, monkeypatch) -> None:
    monkeypatch.setattr(filings, "RETRY_PAUSE_SECONDS", 0)
    board.figures_status = 500
    board.figures_status_uses = 1
    response, tab = filings.fetch_figures(
        filings.http_session(),
        FilerKind.candidate_committee,
        "11880",
        (2024, 2025),
        board.base_url,
    )
    assert response.status_code == 200
    assert tab.errors == []


def test_the_year_field_is_sent_but_the_segment_is_what_decides() -> None:
    """Recorded as a test because the field looks meaningful and is not."""
    form = filings.viewer_form("11880", (2024, 2025), "financial")
    assert form["year_data[ElectionSegmentStartDate]"] == "2024"
    assert form["year_data[ElectionSegmentEndDate]"] == "2025"
    assert form["year"] == "2025"


@pytest.mark.parametrize(
    "year, expected",
    [(2024, (2024, 2025)), (2025, (2024, 2025)), (2026, (2026, 2027))],
)
def test_a_year_resolves_to_the_election_segment_it_sits_in(year, expected) -> None:
    assert filings.segment_for_year(year) == expected


def test_asking_about_two_years_of_one_segment_costs_one_request(
    db, board, store
) -> None:
    result = run(db, board, store, dry_run=True, only_filers=["11880"])
    figures = [
        form for path, form in board.requests_seen if form.get("tabname") == "financial"
    ]
    assert len(figures) == 1
    assert sorted(filing.filing_year for filing in result.filings) == [2024, 2025]


# --- Keeping the bytes -------------------------------------------------------


def test_every_response_is_kept_and_each_figure_names_the_line_it_came_from(
    db, board, store
) -> None:
    result = publish_first(db, board, store)
    assert len(store.objects) == 1
    key = next(iter(store.objects))
    assert key == filings.archive_object_key(result.archive_hash)

    archive = Path(store.objects and "archive.jsonl.gz")
    archive.write_bytes(store.objects[key])
    try:
        filing = db.scalars(
            select(models.CampaignFinanceFiling).where(
                models.CampaignFinanceFiling.snapshot_id == result.snapshot_id,
                models.CampaignFinanceFiling.registration_number == "11880",
                models.CampaignFinanceFiling.filing_year == 2025,
            )
        ).one()
        record = filings.read_archive_line(str(archive), filing.archive_line)
        assert record is not None
        assert record["sha256"] == filing.response_hash
        # The bytes in the archive really are the ones the figure was read from, so a
        # published number can be traced to a response rather than to a claim.
        import base64

        body = base64.b64decode(record["body_base64"])
        assert hashlib.sha256(body).hexdigest() == filing.response_hash
        assert b"13,900.48" in body
    finally:
        archive.unlink(missing_ok=True)


def test_a_second_run_publishing_the_same_figures_cites_the_archive_that_was_kept(
    db, board, store
) -> None:
    """The ordinary publish path, and the one where the line numbers can go wrong.

    A first run quarantines for want of anything to compare against, so the run that
    actually publishes is a second one — and its own responses were numbered against an
    archive nobody kept. Every published figure must cite a line of the archive that
    exists.
    """
    first = run(db, board, store)
    assert first.blocked
    kept = set(store.objects)
    assert len(kept) == 1

    published = run(db, board, store, publish_hash=first.record_set_hash)
    assert not published.blocked, published.summary()
    # No second object: one archive per distinct set of figures.
    assert set(store.objects) == kept
    assert published.archive_hash == first.archive_hash

    archive = Path("kept.jsonl.gz")
    archive.write_bytes(store.objects[next(iter(kept))])
    try:
        rows = db.scalars(
            select(models.CampaignFinanceFiling).where(
                models.CampaignFinanceFiling.snapshot_id == published.snapshot_id
            )
        ).all()
        assert rows
        for row in rows:
            record = filings.read_archive_line(str(archive), row.archive_line)
            assert record is not None, row.archive_line
            assert record["sha256"] == row.response_hash
            assert record["form"]["id"] == row.registration_number
    finally:
        archive.unlink(missing_ok=True)


def test_two_runs_that_could_not_be_read_each_keep_their_own_responses(
    db, board, store
) -> None:
    """A broken run gets no record hash, so 2 unrelated failures cannot collide.

    Hashed the same way a good run is, every unreadable run would produce the hash of
    no figures at all, share one snapshot row, and the second one's responses would
    never be stored — losing exactly the evidence retention exists to keep.
    """
    board.extra_label = "Cryptocurrency contributions"
    first = run(db, board, store)
    assert first.blocked
    assert first.record_set_hash == ""

    board.extra_label = "Something else entirely"
    second = run(db, board, store)
    assert second.blocked
    assert second.snapshot_id != first.snapshot_id
    assert len(store.objects) == 2
    stored = db.scalars(select(models.CampaignFinanceFilingSnapshot)).all()
    assert {snapshot.record_set_hash for snapshot in stored} == {None}
    assert all(
        snapshot.status is models.CampaignFinanceSnapshotStatus.quarantined
        for snapshot in stored
    )


def test_an_archive_that_no_longer_reproduces_its_figures_stops_the_run(
    db, board, store
) -> None:
    first = run(db, board, store)
    assert first.blocked
    key = next(iter(store.objects))
    # Truncate the kept archive, which is what a damaged or partial object looks like.
    store.objects[key] = store.objects[key][: len(store.objects[key]) // 2]
    with pytest.raises(
        filings.CampaignFinanceFilingsRefusal, match="could not be read back"
    ) as raised:
        run(db, board, store, publish_hash=first.record_set_hash)
    # Named, so an operator knows which object to look at rather than reading a stack
    # trace out of gzip.
    assert key in str(raised.value)


def test_an_archive_whose_figures_have_changed_stops_the_run(db, board, store) -> None:
    """Readable, and no longer the figures the snapshot claims. A different failure."""
    first = run(db, board, store)
    assert first.blocked
    key = next(iter(store.objects))
    import base64
    import gzip as gziplib

    lines = gziplib.decompress(store.objects[key]).decode("utf-8").splitlines()
    rewritten = []
    for line in lines:
        record = json.loads(line)
        if record["what"] == "figures":
            body = base64.b64decode(record["body_base64"]).replace(
                b"13,900.48", b"99,900.48"
            )
            record["body_base64"] = base64.b64encode(body).decode("ascii")
        rewritten.append(json.dumps(record, sort_keys=True))
    store.objects[key] = gziplib.compress(
        ("\n".join(rewritten) + "\n").encode("utf-8"), mtime=0
    )
    with pytest.raises(
        filings.CampaignFinanceFilingsRefusal, match="no longer reproduces"
    ):
        run(db, board, store, publish_hash=first.record_set_hash)


def test_the_archive_compresses_identically_whatever_the_file_is_called(
    tmp_path,
) -> None:
    """Without ``mtime=0`` and ``filename=""`` the same run hashes differently twice."""
    hashes = set()
    for name in ("a.jsonl.gz", "b.jsonl.gz"):
        archive = filings.ResponseArchive(str(tmp_path / name))
        archive.write(
            "test",
            filings.Response(
                url="http://example.test",
                form={"id": "1"},
                status_code=200,
                body=b'{"tabcontent":"x"}',
                content_hash="deadbeef",
                started_at=datetime(2026, 8, 12, tzinfo=UTC),
                completed_at=datetime(2026, 8, 12, tzinfo=UTC),
            ),
        )
        hashes.add(archive.close()[0])
    assert len(hashes) == 1


# --- Publishing and replacing ------------------------------------------------


def test_a_first_run_quarantines_and_publishes_only_when_its_hash_is_named(
    db, board, store
) -> None:
    first = run(db, board, store)
    assert first.blocked
    assert checks_of(first)["previous_snapshot_to_compare_against"].status == "failed"
    assert db.scalars(select(models.CampaignFinanceFiling)).all() == []

    published = run(db, board, store, publish_hash=first.record_set_hash)
    assert not published.blocked
    assert figures_of(db, published.snapshot_id, "11880", 2025)["total_receipts"] == (
        Decimal("13900.48")
    )
    snapshot = db.get(models.CampaignFinanceFilingSnapshot, published.snapshot_id)
    assert snapshot.status is models.CampaignFinanceSnapshotStatus.loaded
    assert filings.live_filings_snapshot(db).id == published.snapshot_id


def test_running_it_twice_on_unchanged_figures_publishes_nothing_new(
    db, board, store
) -> None:
    published = publish_first(db, board, store)
    again = run(db, board, store)
    assert again.unchanged
    assert filings.live_filings_snapshot(db).id == published.snapshot_id
    assert (
        db.scalar(
            select(models.CampaignFinanceFilingSnapshot.id).where(
                models.CampaignFinanceFilingSnapshot.record_set_hash
                == again.record_set_hash
            )
        )
        == published.snapshot_id
    )


def test_a_figure_changing_makes_a_new_snapshot_and_replaces_the_old_one(
    db, board, store
) -> None:
    first = publish_first(db, board, store)
    board.amount_overrides[("11880", 2025)] = {
        "Individuals contributions": "$13,000.00"
    }
    second = run(db, board, store)
    assert not second.blocked, second.summary()
    assert second.snapshot_id != first.snapshot_id
    assert filings.live_filings_snapshot(db).id == second.snapshot_id
    assert figures_of(db, second.snapshot_id, "11880", 2025)[
        "individuals_contributions"
    ] == Decimal("13000.00")


def test_the_replaced_snapshot_keeps_its_rows_for_one_generation_then_loses_them(
    db, board, store
) -> None:
    """A reader resolves the live snapshot in one statement and its rows in the next.

    Deleting the previous rows the instant a new set lands hands a request that
    started moments earlier zero rows, which a page renders as "this committee
    reported nothing".
    """
    first = publish_first(db, board, store)
    board.amount_overrides[("11880", 2025)] = {
        "Individuals contributions": "$13,001.00"
    }
    second = run(db, board, store)
    assert not second.blocked
    assert figures_of(db, first.snapshot_id, "11880", 2025)

    board.amount_overrides[("11880", 2025)] = {
        "Individuals contributions": "$13,002.00"
    }
    third = run(db, board, store)
    assert not third.blocked
    assert (
        db.get(models.CampaignFinanceFilingSnapshot, first.snapshot_id).status
        is models.CampaignFinanceSnapshotStatus.pruned
    )
    assert (
        db.scalars(
            select(models.CampaignFinanceFiling).where(
                models.CampaignFinanceFiling.snapshot_id == first.snapshot_id
            )
        ).all()
        == []
    )
    # And the one it just replaced still has its rows.
    assert figures_of(db, second.snapshot_id, "11880", 2025)


def test_publishing_refuses_a_run_older_than_the_live_snapshot(
    db, board, store
) -> None:
    published = publish_first(db, board, store)
    stale = filings.FilingsRun(
        years=[2025],
        segments=[(2024, 2025)],
        fetch_started_at=datetime.now(UTC) - timedelta(days=1),
    )
    stale.snapshot_id = published.snapshot_id
    stale.record_set_hash = published.record_set_hash
    with pytest.raises(filings.CampaignFinanceFilingsRefusal, match="older"):
        filings.publish_filings(db, stale, ingestion_run_id=None, notes=None)


def test_a_dry_run_writes_nothing(db, board, store) -> None:
    result = run(db, board, store, dry_run=True)
    assert result.filings
    assert db.scalars(select(models.CampaignFinanceFilingSnapshot)).all() == []
    assert store.objects == {}


# --- What must stop a run ----------------------------------------------------


def test_a_directory_list_answering_the_literal_false_stops_the_run(
    db, board, store
) -> None:
    board.directory_returns_false.add(FilerKind.party_unit)
    result = run(db, board, store, publish_hash="anything")
    assert result.blocked
    assert checks_of(result)["every_registered_filer_list_was_read"].status == "failed"
    assert checks_of(result)["every_response_was_read"].status == "failed"


def test_a_whole_filer_kind_coming_back_empty_stops_even_with_a_named_hash(
    db, board, store
) -> None:
    """This is the wrong-viewer failure, and it is why the ceiling is not waivable.

    Asking the wrong viewer for a filer's kind returns 200 with no table, so a broken
    kind mapping reads as nobody of that kind having reported anything. Checked per
    kind rather than across the run: empty answers are ordinary and their share is
    nowhere near uniform, so a run-wide ceiling could hide one kind going dark behind
    two healthy ones.
    """
    board.empty_filers.update({"11880", "18999"})
    result = run(db, board, store)
    check = checks_of(result)["no_filer_kind_came_back_mostly_empty"]
    assert check.status == "failed"
    assert "candidate_committee" in check.detail
    waived = run(db, board, store, publish_hash=result.record_set_hash)
    assert checks_of(waived)["no_filer_kind_came_back_mostly_empty"].status == "failed"
    assert waived.blocked


def test_one_filer_of_a_kind_coming_back_empty_is_ordinary(db, board, store) -> None:
    """Measured across all 1,603 registered filers, 21.7% of asked-for filer-years
    legitimately come back empty, and 46.3% for candidate committees in one year."""
    board.empty_filers.add("18999")
    result = run(db, board, store)
    check = checks_of(result)["no_filer_kind_came_back_mostly_empty"]
    assert check.status == "passed", check.detail
    assert "candidate_committee 50.0% empty" in check.detail


def test_naming_a_hash_never_waives_a_structural_check(db, board, store) -> None:
    board.extra_label = "Cryptocurrency contributions"
    result = run(db, board, store)
    waived = run(db, board, store, publish_hash=result.record_set_hash)
    assert checks_of(waived)["every_response_was_read"].status == "failed"
    assert waived.blocked


def test_a_pinned_figure_changing_stops_the_run_and_says_why(db, board, store) -> None:
    """The canary for a silently changed amendment-resolution rule."""
    published = publish_first(db, board, store)
    assert (
        checks_of(published)["standing_test_filer_years_still_match"].status == "passed"
    )
    board.amount_overrides[("11880", 2025)] = {"Total receipts": "$99,999.00"}
    result = run(db, board, store)
    check = checks_of(result)["standing_test_filer_years_still_match"]
    assert check.status == "failed"
    assert "amended a closed year" in check.detail


def test_a_filer_year_losing_its_figures_stops_the_run(db, board, store) -> None:
    publish_first(db, board, store)
    board.empty_filers.add("18999")
    result = run(db, board, store)
    check = checks_of(result)["no_published_filer_year_lost_its_figures"]
    assert check.status == "failed"
    assert "18999" in check.detail


def test_a_run_narrowed_to_filers_the_directory_does_not_list_says_so(
    db, board, store
) -> None:
    result = run(db, board, store, dry_run=True, only_filers=["11880", "404404"])
    assert any("404404" in error for error in result.errors)
    assert checks_of(result)["every_response_was_read"].status == "failed"


def test_a_narrowed_run_does_not_claim_to_have_checked_the_pinned_figures_it_skipped(
    db, board, store
) -> None:
    result = run(db, board, store, dry_run=True, only_filers=["11880"])
    check = checks_of(result)["standing_test_filer_years_still_match"]
    assert check.status == "passed"
    assert "not asked about by this run" in check.detail


# --- What the download loader reads ------------------------------------------


def test_the_context_gives_the_download_loader_the_totals_dates_and_special_years(
    db, board, store
) -> None:
    board.special_election_filers.add("18999")
    published = publish_first(db, board, store)
    context = filings.filings_context(db)
    assert context is not None
    assert context.snapshot_id == published.snapshot_id
    assert "20008" in context.known_registrations
    # A candidate's reported contributions are the 5 contributor-type lines summed, not
    # total receipts, which also carries subsidy and miscellaneous income.
    assert context.reported_contributions[("11880", 2025)] == Decimal("13875.00")
    # A party unit's are its single combined line.
    assert context.reported_contributions[("20008", 2025)] == Decimal("748643.94")
    assert context.reported_through[("11880", 2025)] == date(2025, 12, 31)
    assert ("18999", 2025) in context.special_election_filer_years
    # And a filer-year the route cannot speak for is left out of the cutoffs entirely,
    # so no comparison is even attempted for it.
    assert ("18999", 2025) not in context.contribution_cutoffs()
    assert ("11880", 2025) in context.contribution_cutoffs()


def test_the_context_is_none_when_nothing_is_published(db) -> None:
    assert filings.filings_context(db) is None


def test_a_registration_number_in_two_lists_is_an_error_not_a_coin_toss(
    db, board, store, monkeypatch
) -> None:
    """Its kind decides which viewer answers for it, and the wrong one returns nothing."""
    monkeypatch.setitem(
        DIRECTORY_ROWS,
        FilerKind.party_unit,
        DIRECTORY_ROWS[FilerKind.party_unit]
        + [
            {
                "RegisteredEntityFullName": "Marty, John Senate Committee",
                "RegisteredEntityID": "11880",
                "RegistrationDate": "1994-01-01 00:00:00.000",
                "TerminationDate": None,
            }
        ],
    )
    result = run(db, board, store, dry_run=True)
    assert any(
        "more than one registered filer list" in error for error in result.errors
    )
