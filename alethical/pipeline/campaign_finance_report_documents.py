"""The Board's report documents, and the one figure we read out of them (#1433).

Net: a committee's own filed report states how much of its money it named donors for.
Nothing else Minnesota publishes states that, and without it a payment we are *missing*
does not go missing on a page -- it lands in the derived "no donor named" figure and
reads as ordinary small-donor money, which is a false claim about money the state
itself named. This module fetches one report document and reads that one stated figure
per schedule.

**Nothing here rebuilds a payment.** ``docs/architecture/campaign-finance-system-design.md``
§2.3 is explicit that reconstructing rows from a report document is what the retired
version of this product did and is where its errors came from. Every payment record
still comes from the bulk download; this reads subtotals a filing prints about itself.

Three things this route does that a normal HTTP client will get wrong:

* **A missing document answers HTTP 200.** Five different soft failures, four of them
  plain text and one a 30,424-byte HTML page, and none of them carries an error status.
  The only thing separating a document from an error is that the body starts with
  ``%PDF`` (§9.4).
* **Totals are read by schedule code, never by position.** A filer with no lobbyist
  money has no ``A1 - LOB`` block at all, so the blocks sit at no fixed offset, and a
  position-based read returned $20,754.27 for a filer whose reported figure is
  $6,002.62 (§9.4).
* **A heading and its totals can be 1,800 lines apart.** In the Republican Party of
  Minnesota's 2025 report the ``A1 - CR`` heading sits at line 110 and its totals at
  line 1,886, because every itemized donor sits between them. So the totals are found
  by scanning to the *next* heading rather than by looking near this one -- reading
  near a heading works on small candidate reports and finds nothing on a party unit
  (§9.4).

Design: ``docs/architecture/campaign-finance-system-design.md`` §9.4 (Report PDFs are a
fallback, not a route).
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Optional

import requests

from alethical.db.models import CampaignFinanceFilerKind as FilerKind
from alethical.pipeline.campaign_finance_filings import (
    BOARD_BASE_URL,
    Response,
    post_form,
)

DOCUMENT_PATH = "/rptViewer/Main.php"
DOCUMENT_QUERY = "?do=viewPDF"

# ``type`` in the request, which is not the same vocabulary as the viewer names the
# financial route uses. Both are the Board's; neither is documented.
DOCUMENT_TYPE_BY_KIND = {
    FilerKind.candidate_committee: "pcc",
    FilerKind.party_unit: "ptu",
    FilerKind.political_committee_or_fund: "pcf",
}


def document_url(base_url: str = BOARD_BASE_URL) -> str:
    return f"{base_url.rstrip('/')}{DOCUMENT_PATH}{DOCUMENT_QUERY}"


def document_form(
    *,
    registration_number: str,
    filing_year: int,
    kind: FilerKind,
    report_type: str,
    amendment_index: int,
    special_election: bool,
) -> dict[str, str]:
    """The body for one document request.

    ``period`` takes the catalogue's own ``ReportType`` **verbatim**. §9.4 first
    documented three values and they turned out to be an incomplete list rather than a
    restrictive one: ``A``, ``B`` and ``G`` all serve real documents, and the House
    Republican Campaign Committee's 2025 catalogue adds ``D`` on top of those. Choosing
    among a known set would silently lose whichever type nobody had met yet, and the
    failure would arrive as a polite plain-text refusal rather than as an error.

    ``year`` is the 2-digit form the route expects. ``searchType=Candidate`` is sent for
    every filer kind, which is what the Board's own page sends and what a party-unit
    request was verified against.
    """
    return {
        "searchType": "Candidate",
        "downloadpdf": "true",
        "year": f"{filing_year % 100:02d}",
        "type": DOCUMENT_TYPE_BY_KIND[kind],
        "period": report_type,
        "se": "1" if special_election else "0",
        "regnum": registration_number,
        "amend": str(amendment_index),
        "disc": "",
        "date": "",
        "show": "0",
    }


class DocumentOutcome(str, Enum):
    """What came back, told apart by the body rather than by the status code.

    Every value except ``served`` arrives as HTTP 200. ``error_page`` is the HTML one
    §9.4 measured at 30,424 bytes; the three plain-text ones are the Board saying no in
    three different sentences, and they mean genuinely different things -- a report that
    is scheduled but unreleased, a report that is overdue, and a request whose ``period``
    code the Board does not recognise for this filer.
    """

    served = "served"
    not_released = "not_released"
    not_found = "not_found"
    error_page = "error_page"
    empty = "empty"
    http_error = "http_error"


# The plain-text refusals, matched on a distinctive stem rather than on the whole
# sentence, because two of the three differ only in their trailing wording.
NOT_RELEASED = re.compile(rb"file requested has not been released", re.I)
NOT_FOUND = re.compile(rb"Requested file not found", re.I)
# How much of the body to keep on the record when it is not a document. Enough to hold
# the longest refusal measured (172 bytes) with room to spare, and far short of the
# 30 KB error page.
NOTE_BYTES = 400


def classify_document(status_code: int, body: bytes) -> tuple[DocumentOutcome, str]:
    """Say what a response is, and why, in words an operator can act on.

    The ``%PDF`` test comes first and everything else is a description of the failure.
    That order is the point: a check asking "is the body HTML" passes four of the five
    soft failures as success, and one asking "did I get bytes back" passes four as well.
    """
    if status_code != 200:
        return DocumentOutcome.http_error, f"the document answered HTTP {status_code}"
    if body.startswith(b"%PDF"):
        return DocumentOutcome.served, f"a {len(body):,}-byte document"
    if not body:
        return DocumentOutcome.empty, "the Board answered 200 with an empty body"
    if NOT_RELEASED.search(body[:NOTE_BYTES]):
        return (
            DocumentOutcome.not_released,
            "the Board says this report has not been released yet: " + _readable(body),
        )
    if NOT_FOUND.search(body[:NOTE_BYTES]):
        return (
            DocumentOutcome.not_found,
            "the Board says the file was not found, which is what an overdue report "
            "returns: " + _readable(body),
        )
    return (
        DocumentOutcome.error_page,
        # The size goes at the END. A run tallies these reasons by their opening
        # characters, and a size at the front made one cause count as many.
        "the Board answered 200 with a page that is not a document, which is how it "
        f"reports a document it does not serve ({len(body):,} bytes)",
    )


def _readable(body: bytes) -> str:
    return " ".join(body[:NOTE_BYTES].decode("utf-8", "replace").split())


def fetch_document(
    http: requests.Session,
    *,
    registration_number: str,
    filing_year: int,
    kind: FilerKind,
    report_type: str,
    amendment_index: int,
    special_election: bool,
    base_url: str = BOARD_BASE_URL,
) -> tuple[Response, DocumentOutcome, str]:
    """Ask for one report document and say what came back.

    Retries and pacing are ``post_form``'s, unchanged: a connection that never left the
    machine is retried for about 2 minutes, a 5xx three times, and a 403 not at all.
    """
    form = document_form(
        registration_number=registration_number,
        filing_year=filing_year,
        kind=kind,
        report_type=report_type,
        amendment_index=amendment_index,
        special_election=special_election,
    )
    response = post_form(http, document_url(base_url), form)
    outcome, note = classify_document(response.status_code, response.body)
    return response, outcome, note


# --- Reading the document -----------------------------------------------------

# A schedule heading, and the code is everything between "Schedule" and the run of
# spaces before the title. Anchored at the start of the line so the two summary rows
# that mention "Schedule A2-LP" and "Schedule C" mid-sentence cannot be mistaken for
# headings. The code itself is left exactly as printed apart from collapsing runs of
# whitespace, because "A1 - PTY/TERM PCC" carries a slash and internal spaces and any
# tidier normalisation would have to guess at a shape we have only seen 5 of.
SCHEDULE_HEADING = re.compile(r"^Schedule\s+(?P<code>\S.*?)\s{2,}\S")
ITEMIZED_TOTAL = re.compile(r"^Total of itemized\s+(?P<amounts>[\d,.\s()$-]+)$")
NON_ITEMIZED_TOTAL = re.compile(r"^Total of non-itemized\s+(?P<amounts>[\d,.\s()$-]+)$")
MONEY = re.compile(r"^\(?-?\$?-?([\d,]+(?:\.\d+)?)\)?$")

# The schedules that hold contributions, per filer kind. A candidate committee splits
# its money in by who gave it; a party unit and a committee or fund report one combined
# schedule. These are the blocks whose stated itemized figure is the number this whole
# module exists to read -- deliberately not the public-subsidy, loans-payable or
# miscellaneous-income schedules, none of which is a contribution and none of which
# appears in the itemized contributions download.
CONTRIBUTION_SCHEDULES: dict[FilerKind, tuple[str, ...]] = {
    FilerKind.candidate_committee: (
        "A1 - IND",
        "A1 - LOB",
        "A1 - PCF",
        "A1 - PTY/TERM PCC",
        "A1 - OTH",
    ),
    FilerKind.party_unit: ("A1 - CR",),
    FilerKind.political_committee_or_fund: ("A1 - CR",),
}

# Which stored figure proves which schedule was read correctly. This is the self-test
# §9.4 requires, and it is exact rather than approximate: each contributor-type line the
# Board's totals route returns equals that schedule's itemized plus non-itemized cash.
# Verified line by line on filers 15667, 17709, 19043, 19223, 20008 and 20010.
STORED_FIGURE_FOR_SCHEDULE: dict[str, str] = {
    "A1 - IND": "individuals_contributions",
    "A1 - LOB": "lobbyist_contributions",
    "A1 - PCF": "committee_fund_contributions",
    "A1 - PTY/TERM PCC": "party_unit_contributions",
    "A1 - OTH": "other_contributions",
    "A1 - CR": "contributions_received",
}

# A contribution schedule's totals row prints cash, in-kind and total, in that order.
# Anything else is a shape this parser has not met, and it is reported as a parse error
# rather than read as though the first column were still cash.
CONTRIBUTION_COLUMNS = 3


@dataclass(frozen=True)
class ScheduleTotals:
    """One schedule's own stated itemized and non-itemized subtotals.

    ``columns`` is kept as served because the width says which kind of schedule this is
    -- a contribution schedule prints 3 (cash, in-kind, total), an expenditure schedule
    4, and a single-figure schedule 1 -- and a width that changes is exactly the silent
    shift this module must not read through.
    """

    code: str
    itemized: tuple[Decimal, ...]
    non_itemized: tuple[Decimal, ...]

    @property
    def columns(self) -> int:
        return len(self.itemized)

    def contribution_cash(self) -> Decimal:
        return self.itemized[0] + self.non_itemized[0]


@dataclass
class ReportDocument:
    """Everything read out of one document, and everything that could not be."""

    schedules: dict[str, ScheduleTotals] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    line_count: int = 0
    page_count: int = 0


def extract_lines(body: bytes) -> tuple[list[str], Optional[int]]:
    """The document's text, one entry per line, in the order it is printed.

    Returns an empty list and a ``None`` page count when the bytes will not open as a
    document at all, which the caller reports rather than treating as an empty report.
    """
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    try:
        reader = PdfReader(io.BytesIO(body))
        pages = [page.extract_text() or "" for page in reader.pages]
    except (PyPdfError, ValueError, KeyError, TypeError, OSError):
        return [], None
    return "\n".join(pages).splitlines(), len(pages)


def parse_money(value: str) -> Optional[Decimal]:
    """``1,234.56`` or ``$1,234.56`` or ``(1,234.56)`` to a Decimal, or None.

    Strict for the same reason the totals route's reader is: these figures are printed
    text with no type of any kind, so the only thing separating an amount from a word
    that landed in a column is that one of them parses.
    """
    text_value = value.strip()
    match = MONEY.match(text_value)
    if match is None:
        return None
    try:
        amount = Decimal(match.group(1).replace(",", ""))
    except InvalidOperation:  # pragma: no cover - the pattern already bounds this
        return None
    negative = text_value.startswith("(") or "-" in text_value
    return -amount if negative else amount


def _parse_amounts(raw: str) -> Optional[tuple[Decimal, ...]]:
    parts = raw.split()
    amounts = [parse_money(part) for part in parts]
    if not amounts or any(amount is None for amount in amounts):
        return None
    return tuple(amount for amount in amounts if amount is not None)


def parse_report_document(body: bytes) -> ReportDocument:
    """Read every schedule's stated subtotals out of one report document.

    The scan is heading to heading. Inside each block the **first** itemized total and
    the **first** non-itemized total are this schedule's, because a schedule prints its
    pair once at the end of its rows; a second pair inside one block would mean the
    heading scan lost a boundary, and that is reported rather than resolved by guessing.

    A repeated schedule code is an error too. Every document measured prints each code
    exactly once even where 1,776 lines of donors sit between the heading and the
    totals, so a repeat means either a page header this parser started reading as a
    heading or a document shape nobody has seen.
    """
    lines, page_count = extract_lines(body)
    if page_count is None:
        document = ReportDocument()
        document.errors.append(
            "the bytes start like a document but will not open as one"
        )
        return document
    document = schedules_from_lines(lines)
    document.page_count = page_count
    return document


def schedules_from_lines(lines: list[str]) -> ReportDocument:
    """The same read, from text that has already been extracted.

    Split out because every awkward shape this parser has to survive is a shape of the
    *lines* -- a code carrying a slash, a heading 1,776 lines from its totals, a
    schedule that is simply absent -- so a test that feeds lines is testing the thing
    that actually breaks.
    """
    document = ReportDocument()
    document.line_count = len(lines)
    if not lines:
        # A real reader failure, and the one case that must not be softened below. The
        # Board serves some reports as scanned images -- filer 13481's 2025 year-end is
        # 1.5 MB for a single page and yields no text at all -- and for those we cannot
        # tell an empty filing from a file we could not read.
        document.errors.append("the document opened and carried no text at all")
        return document

    code: Optional[str] = None
    itemized: Optional[tuple[Decimal, ...]] = None
    non_itemized: Optional[tuple[Decimal, ...]] = None

    def close_block() -> None:
        nonlocal code, itemized, non_itemized
        if code is None:
            return
        if itemized is not None and non_itemized is not None:
            if len(itemized) != len(non_itemized):
                document.errors.append(
                    f"schedule {code} prints {len(itemized)} itemized columns and "
                    f"{len(non_itemized)} non-itemized ones"
                )
            elif code in document.schedules:
                document.errors.append(f"schedule {code} appears more than once")
            else:
                document.schedules[code] = ScheduleTotals(code, itemized, non_itemized)
        code, itemized, non_itemized = None, None, None

    for line in lines:
        stripped = line.strip()
        heading = SCHEDULE_HEADING.match(stripped)
        if heading is not None:
            close_block()
            code = re.sub(r"\s+", " ", heading.group("code")).strip()
            continue
        if code is None:
            continue
        found = ITEMIZED_TOTAL.match(stripped)
        if found is not None and itemized is None:
            itemized = _parse_amounts(found.group("amounts"))
            if itemized is None:
                document.errors.append(
                    f"schedule {code}'s itemized total is not money: {stripped!r}"
                )
            continue
        found = NON_ITEMIZED_TOTAL.match(stripped)
        if found is not None and non_itemized is None:
            non_itemized = _parse_amounts(found.group("amounts"))
            if non_itemized is None:
                document.errors.append(
                    f"schedule {code}'s non-itemized total is not money: {stripped!r}"
                )
    close_block()
    # **A document with text and no schedules is a reading of zero, not an error**, and
    # this is where an earlier version got it exactly backwards. A committee that took in
    # and spent nothing files a report with no schedule sections at all: filer 12328's
    # 2025 year-end prints "Sch. A1 - IND 0.00" on its own summary and carries no
    # schedules, and the Board's totals route reports $0.00 for all 5 contributor types.
    # Calling that a reader failure withheld **216 of 1,278** committee-years on the
    # first full 2025 run, almost all of them committees that genuinely named nobody.
    # Whether reading nothing is right is not a question this function can answer; the
    # self-test answers it, by comparing that zero against figures we already trust.
    return document


# --- Proving the reader before it may say anything ----------------------------


class SelfTest(str, Enum):
    """Whether this document's reader agreed with figures we already trust.

    ``not_available`` is not a weaker ``passed``. It means this filer-year has no stored
    contributor-type figures to test against at all, which happens for real: the Board's
    totals route serves no 2025 block for filer 18488 even though its catalogue lists a
    2025 year-end report and that report itemizes $2,300.00. Kept separate so a caller
    can weigh a comparison by how it was proved, and so the run can report its accuracy
    as a measured number over the documents where the test could actually run.
    """

    passed = "passed"
    failed = "failed"
    not_available = "not_available"


# The Board prints 2 decimal places on both sides, so a sub-cent difference is
# arithmetic rather than a contradiction. The same tolerance the download loader's
# reconcile uses, for the same reason.
TOLERANCE = Decimal("0.01")


@dataclass(frozen=True)
class StatedContributions:
    """What a filing says about the money it named, and how well we proved we read it.

    ``itemized`` and ``non_itemized`` are the **total** column -- cash plus in-kind --
    because that is what our payment rows sum to. The cash column is kept beside it
    because the self-test runs on cash: the Board's totals route reports cash, so cash
    is the only column an already-trusted figure can prove.
    """

    itemized: Decimal
    non_itemized: Decimal
    itemized_cash: Decimal
    self_test: SelfTest
    self_test_detail: str
    schedules_read: tuple[str, ...]


def stated_contributions(
    document: ReportDocument,
    kind: FilerKind,
    stored_figures: dict[str, Decimal],
) -> tuple[Optional[StatedContributions], list[str]]:
    """Add up what this filing says it itemized, and prove the reading first.

    **A schedule that is absent is a real zero, not a gap.** Filer 17709's 2025 report
    prints no ``A1 - PTY/TERM PCC`` block and the Board's own totals route reports
    $0.00 for party-unit contributions, so absence and zero are the same claim here --
    which is exactly why the totals have to be read by code and never by position.

    The self-test is per schedule where it can be: a candidate committee's 5 contributor
    lines each prove their own block, so a misread is caught and named. A party unit
    returns one combined line against one ``A1 - CR`` schedule, so the test still catches
    a broken reader but can no longer say which schedule broke (§9.4).

    Returns ``(None, errors)`` when the document cannot support a claim at all.
    """
    errors = list(document.errors)
    wanted = CONTRIBUTION_SCHEDULES[kind]
    itemized = Decimal("0")
    non_itemized = Decimal("0")
    itemized_cash = Decimal("0")
    read: list[str] = []
    for code in wanted:
        totals = document.schedules.get(code)
        if totals is None:
            continue
        if totals.columns != CONTRIBUTION_COLUMNS:
            errors.append(
                f"schedule {code} prints {totals.columns} columns where a contribution "
                f"schedule prints {CONTRIBUTION_COLUMNS} (cash, in-kind, total)"
            )
            continue
        # Cash plus in-kind must equal the printed total, on both rows. This costs
        # nothing and it is the one check that catches a column shifting under us, which
        # is the failure that would otherwise read as a real disagreement.
        for label, row in (
            ("itemized", totals.itemized),
            ("non-itemized", totals.non_itemized),
        ):
            if abs(row[0] + row[1] - row[2]) > TOLERANCE:
                errors.append(
                    f"schedule {code}'s {label} row does not add up: {row[0]} cash plus "
                    f"{row[1]} in-kind against a printed total of {row[2]}"
                )
        itemized += totals.itemized[2]
        non_itemized += totals.non_itemized[2]
        itemized_cash += totals.itemized[0]
        read.append(code)
    if errors:
        return None, errors
    # No contribution schedule at all is a reading of zero rather than a failure: a
    # committee that took in nothing prints none. What stops a broken reader arriving
    # here and calling a real filing empty is the self-test below, which compares an
    # absent schedule against its stored figure exactly as it compares a present one.
    passed, detail = _self_test(document, kind, stored_figures)
    return (
        StatedContributions(
            itemized=itemized,
            non_itemized=non_itemized,
            itemized_cash=itemized_cash,
            self_test=passed,
            self_test_detail=detail,
            schedules_read=tuple(read),
        ),
        [],
    )


def _self_test(
    document: ReportDocument,
    kind: FilerKind,
    stored_figures: dict[str, Decimal],
) -> tuple[SelfTest, str]:
    checked: list[str] = []
    wrong: list[str] = []
    for code in CONTRIBUTION_SCHEDULES[kind]:
        line_key = STORED_FIGURE_FOR_SCHEDULE[code]
        stored = stored_figures.get(line_key)
        if stored is None:
            continue
        totals = document.schedules.get(code)
        # An absent schedule is a claim of zero, and the stored figure has to agree
        # with that claim too. Skipping absent schedules is how a reader that finds
        # nothing at all passes its own test -- the failure §9.4 records as the worst
        # of the three, because zero rows looks like the data being missing rather
        # than like a bug.
        ours = totals.contribution_cash() if totals is not None else Decimal("0")
        checked.append(code)
        if abs(ours - stored) > TOLERANCE:
            wrong.append(
                f"{code}: this reader makes it {ours} where the Board's own totals "
                f"route says {stored}"
            )
    if wrong:
        return SelfTest.failed, "; ".join(wrong)
    if not checked:
        return (
            SelfTest.not_available,
            "no contributor-type figure is stored for this filer-year, so nothing "
            "already trusted can prove this reading",
        )
    return (
        SelfTest.passed,
        f"{len(checked)} of {len(checked)} schedules match the Board's own totals "
        f"route ({', '.join(checked)})",
    )


# --- The date the Board received a report ------------------------------------


# "Received by the Board July 24, 2026", printed on its own line near the top of every
# report document.
#
# The stamp has to be a WHOLE line, and the 2 anchors do different jobs. The end anchor
# is the one that works here: it refuses a line that opens like the stamp and carries
# more, which would mean the extraction merged 2 lines or the Board changed its layout,
# and returning a date read out of a line we do not understand is the harm #1670 exists
# to prevent. The start is anchored by ``match`` rather than by ``^``, so the ``^`` is
# belt-and-braces against someone switching that call to ``search``.
#
# Both zero-padded and bare day numbers occur and both are real: filer 12339's 2025
# year-end reads "July 01, 2026" and filer 11880's 2022 year-end reads "June 1, 2023".
RECEIVED_BY_BOARD = re.compile(
    r"^Received by the Board\s+"
    r"(?P<month>[A-Z][a-z]+)\s+(?P<day>\d{1,2}),\s+(?P<year>\d{4})$"
)
# The line the document prints 1 line below the stamp, and **not** the same fact. Filer
# 11880's 2026 pre-primary was received 24 Jul 2026 and printed 27 Jul 2026, so a reader
# that scanned for any date near the bottom of the header would be 3 days wrong on a
# real filing. Kept only so a test can prove this line is never read.
PRINTED_STAMP = re.compile(r"Printed\s+(\d{2})/(\d{2})/(\d{4})")


def filed_date_from_lines(lines: list[str]) -> tuple[Optional[date], list[str]]:
    """The date the Board received this document, or ``None`` and why not.

    ``None`` is the ordinary answer rather than a failure, and the caller must keep it
    as ``None``: #1670 exists because a period end relabelled as a filing date is a
    fabricated fact about a named committee. Three measured causes, 31 Aug 2026:

    * **The Board serves no document.** Of a 54-report sample spanning 2021 to 2026, all
      9 sampled 2021 reports and 5 of 9 sampled 2022 ones came back as the HTML page
      SS 9.4 measures at 30,424 bytes. That never reaches this function.
    * **The document is a scan with no text.** Filer 13481's 2025 year-end is a
      1,511,095-byte, 1-page document that ``pypdf`` reads as 0 lines, and its 2023
      year-end is the same. 2 of the 38 served documents in that sample.
    * **The stamp is missing or unreadable** on a document that otherwise reads.

    On the other 36 the stamp appeared **exactly once** and parsed. Two stamps carrying
    2 different dates is a shape nothing has been seen to serve, so it is reported as an
    error rather than resolved by taking the first: picking one would silently choose
    between 2 filing dates for the same document.
    """
    errors: list[str] = []
    found: set[date] = set()
    for line in lines:
        match = RECEIVED_BY_BOARD.match(line.strip())
        if match is None:
            continue
        parsed = _received_date(match)
        if parsed is None:
            errors.append(
                "the Board's received stamp names a date this reader cannot read: "
                f"{line.strip()!r}"
            )
            continue
        found.add(parsed)
    if not found:
        return None, errors
    if len(found) > 1:
        errors.append(
            "this document carries 2 different received stamps "
            f"({', '.join(str(day) for day in sorted(found))}), so which date it was "
            "filed on cannot be read from it"
        )
        return None, errors
    return found.pop(), errors


def _received_date(match: re.Match[str]) -> Optional[date]:
    """``July 24, 2026`` as a date, or ``None`` when the month name is not one.

    ``%B`` is the full month name the Board prints. A day is padded here rather than in
    the pattern because ``%d`` will not read a bare ``1``.
    """
    stamp = f"{match['month']} {int(match['day']):02d}, {match['year']}"
    try:
        return datetime.strptime(stamp, "%B %d, %Y").date()
    except ValueError:
        return None
