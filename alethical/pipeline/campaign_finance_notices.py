"""Large-contribution notices and disclosure statements, collected from the Board (#2347).

Net: money a committee receives in the last 2 weeks before an election appears on no
periodic report until the year-end report the following February. The only public
record of it in the meantime is the committee's **large-contribution notice**, a 1-page
PDF the Board posts on one plain HTML page. Beside it, an unregistered association giving
to an independent-expenditure committee files a **disclosure statement** naming where the
money for that gift came from. This module reads both, keeps every PDF it reads, and
never adds either kind into any total (`.claude/rules/grounded-answers.md` rules 3 and 12).

**Where each record comes from, measured 23 Sep 2026.**

* **Notices**: one page, ``NOTICE_LIST_URL``, grouped under "Candidate Committee" and
  "Political Committee/Political Fund". Each notice is a date link calling
  ``viewNoticePDF('26','notice','PrePrimary',0,<regnum>,'<id>')``, and the PDF behind it
  is a real text PDF (``pypdf`` reads it). 320 notices were listed, all in the
  pre-primary window. The page lists the current election year only.
* **Statements**: a committee's report catalogue (the viewer's ``reports_data`` tab,
  the same response ``campaign_finance_filings`` reads for reports) carries them under
  ``data.disclosure`` as numbered files (``41412_D1.pdf``), repeated under every report
  of the year. The PDF behind number *n* is ``type=disclosure&period=D&disc=n``. The PDFs
  are **scanned images with no text layer**, so nothing past a statement's existence is
  machine-read: which gift it names, its box, sources and lines are entered by a person
  (``scripts/record_disclosure_statement_reading.py``).
* **Which notice windows apply**: Minnesota Statutes 10A.20 subd. 5(d) says there is no
  general-election notice for a candidate whose name is not on the general-election
  ballot, and no primary notice for a candidate unopposed in the primary or for a
  ballot-question committee or fund. The ballot facts come from the Secretary of State's
  own candidate files (``PRIMARY_CANDIDATES_URL``, ``GENERAL_CANDIDATES_URL``).

**Request volume is kept low on purpose.** The Board's ``robots.txt`` disallows
``/rptViewer``, where both kinds of PDF live, so every PDF is fetched **once**, kept in
the raw-source-files bucket, and never fetched again. A re-run reads the notice page (1
request) and only the PDFs it does not already hold.
"""

from __future__ import annotations

import gzip
import html
import io
import os
import re
import tempfile
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Optional

import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.pipeline import campaign_finance_filings as filings
from alethical.pipeline.campaign_finance_report_document_store import gzip_bytes_to
from alethical.pipeline.raw_file_store import sha256_of_file

FilerKind = schema.CampaignFinanceFilerKind

BOARD_BASE_URL = filings.BOARD_BASE_URL
NOTICE_LIST_URL = (
    f"{BOARD_BASE_URL}/reports-and-data/viewers/campaign-finance/"
    "large-contribution-notices/"
)
PDF_VIEWER_URL = f"{BOARD_BASE_URL}/rptViewer/Main.php"
PRIMARY_CANDIDATES_URL = "https://electionresultsfiles.sos.mn.gov/20260811/cand.txt"
GENERAL_CANDIDATES_URL = "https://electionresultsfiles.sos.mn.gov/20261103/cand.txt"

#: Pause between PDF requests. The route is one robots.txt disallows, so a backfill
#: of a few hundred PDFs takes minutes rather than seconds, deliberately.
PDF_SPACING_SECONDS = 1.0

NOTICE_OBJECT_PREFIX = "campaign-finance/notice"
STATEMENT_OBJECT_PREFIX = "campaign-finance/disclosure-statement"

#: The page's 2 group headings, and the filer kind each one lists.
_GROUP_KIND = {
    "Candidate Committee": FilerKind.candidate_committee,
    "Political Committee/Political Fund": FilerKind.political_committee_or_fund,
}

PRE_PRIMARY = "pre_primary"
PRE_GENERAL = "pre_general"


@dataclass(frozen=True)
class NoticeWindow:
    """One period the law sets for large-contribution notices, from the Board's calendar.

    ``board_period`` is the page's own label for notices in this window
    (``PrePrimary``); the general window's label is read as ``PreGeneral`` on the
    catalogue's placeholder for it, which is the only place it appears before the window
    opens.
    """

    key: str
    label: str
    start: date
    end: date
    board_period: str


#: The 2026 windows, from the Board's 2026 disclosure calendars (committees and funds;
#: House, Senate and district court; constitutional and appellate court), which all
#: print the same 2 periods: 21 Jul to 10 Aug before the 11 Aug primary, and 20 Oct to
#: 2 Nov before the 3 Nov general election. Party units file no notices, so they have
#: no windows. A year missing here has no windows and the card does not draw.
NOTICE_WINDOWS: dict[int, tuple[NoticeWindow, ...]] = {
    2026: (
        NoticeWindow(
            PRE_PRIMARY,
            "Before the primary",
            date(2026, 7, 21),
            date(2026, 8, 10),
            "PrePrimary",
        ),
        NoticeWindow(
            PRE_GENERAL,
            "Before the general election",
            date(2026, 10, 20),
            date(2026, 11, 2),
            "PreGeneral",
        ),
    ),
}

_PERIOD_WINDOW = {"PrePrimary": PRE_PRIMARY, "PreGeneral": PRE_GENERAL}


def window_for_period(board_period: str) -> Optional[str]:
    return _PERIOD_WINDOW.get(board_period)


# --- Reading the notice page -----------------------------------------------------


@dataclass(frozen=True)
class ListedNotice:
    """One date link on the Board's notice page."""

    filer_kind: FilerKind
    committee_name_as_listed: str
    two_digit_year: str
    notice_period: str
    special_election: bool
    registration_number: str
    board_notice_id: str
    listed_on: Optional[date]

    @property
    def filing_year(self) -> int:
        return 2000 + int(self.two_digit_year)

    @property
    def pdf_url(self) -> str:
        return notice_pdf_url(
            self.two_digit_year,
            self.notice_period,
            self.special_election,
            self.registration_number,
            self.board_notice_id,
        )


def notice_pdf_url(
    two_digit_year: str,
    notice_period: str,
    special_election: bool,
    registration_number: str,
    board_notice_id: str,
) -> str:
    return (
        f"{PDF_VIEWER_URL}?do=viewPDF&year={two_digit_year}&type=notice"
        f"&period={notice_period}&se={1 if special_election else 0}"
        f"&regnum={registration_number}&date={board_notice_id}"
    )


def statement_pdf_url(
    filing_year: int, registration_number: str, report_period: str, number: int
) -> str:
    """The Board's PDF of one statement: the report's own period code and the number
    the statement carries on that report."""
    return (
        f"{PDF_VIEWER_URL}?do=viewPDF&year={filing_year % 100:02d}&type=disclosure"
        f"&period={report_period}&regnum={registration_number}&disc={number}"
    )


_GROUP_HEADING = re.compile(r"<h2>([^<]+)</h2>")
_ENTRY = re.compile(
    r"<dt>(?P<name>.*?)</dt>|<dd>\s*<a href=\"javascript:viewNoticePDF\("
    r"'(?P<year>\d{2})','notice','(?P<period>[A-Za-z]+)',(?P<se>\d),"
    r"(?P<reg>\d+),'(?P<id>[0-9A-Za-z_]+)'\);\">(?P<shown>[^<]*)</a>\s*</dd>",
    re.S,
)


def _us_date(value: str) -> Optional[date]:
    try:
        return datetime.strptime(value.strip(), "%m/%d/%Y").date()
    except ValueError:
        return None


def parse_notice_list(page: str) -> tuple[list[ListedNotice], list[str]]:
    """Every notice link on the page, grouped by the heading it sits under.

    Only the 2 known group headings are read. A notice link under any other heading, or
    before a committee name, is an error rather than a guess: a new group would mean a
    filer kind we have not mapped.
    """
    errors: list[str] = []
    notices: list[ListedNotice] = []
    headings = [(m.start(), m.group(1).strip()) for m in _GROUP_HEADING.finditer(page)]
    groups = [(start, heading) for start, heading in headings if heading in _GROUP_KIND]
    if not groups:
        return [], ["the notice page carries neither group heading it always has"]
    for index, (start, heading) in enumerate(groups):
        end = groups[index + 1][0] if index + 1 < len(groups) else len(page)
        # The group ends at the next heading of any kind, so a later site section
        # (the footer's headings) is never read as part of it.
        later = [s for s, _ in headings if s > start]
        if later:
            end = min(end, later[0])
        committee: Optional[str] = None
        for match in _ENTRY.finditer(page, start, end):
            if match.group("name") is not None:
                committee = html.unescape(re.sub(r"<[^>]+>", "", match.group("name")))
                committee = committee.strip()
                continue
            if committee is None:
                errors.append(f"a notice link under {heading!r} has no committee name")
                continue
            notices.append(
                ListedNotice(
                    filer_kind=_GROUP_KIND[heading],
                    committee_name_as_listed=committee,
                    two_digit_year=match.group("year"),
                    notice_period=match.group("period"),
                    special_election=match.group("se") != "0",
                    registration_number=match.group("reg"),
                    board_notice_id=match.group("id"),
                    listed_on=_us_date(match.group("shown")),
                )
            )
    links = page.count("viewNoticePDF(") - page.count("function viewNoticePDF(")
    if links != len(notices):
        errors.append(
            f"the page carries {links} notice links and {len(notices)} were read"
        )
    return notices, errors


# --- Reading one notice PDF ------------------------------------------------------


@dataclass
class ParsedNotice:
    committee_name: Optional[str] = None
    registration_number: Optional[str] = None
    treasurer_name: Optional[str] = None
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    submitted_on: Optional[date] = None
    received_on: Optional[date] = None
    contributor_name: Optional[str] = None
    contributor_registration_number: Optional[str] = None
    employer: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    contribution_date: Optional[date] = None
    amount: Optional[Decimal] = None
    in_kind: Optional[bool] = None
    in_kind_description: Optional[str] = None
    loan: Optional[bool] = None
    amended: bool = False
    errors: list[str] = field(default_factory=list)


def _long_date(value: str) -> Optional[date]:
    try:
        return datetime.strptime(value.strip(), "%B %d, %Y").date()
    except ValueError:
        return None


def _any_us_date(value: str) -> Optional[date]:
    """``07/21/2026`` or ``7/21/2026``: the 2 notice layouts write dates both ways."""
    match = re.fullmatch(r"\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*", value)
    if not match:
        return None
    try:
        return date(int(match.group(3)), int(match.group(1)), int(match.group(2)))
    except ValueError:
        return None


def _money(value: str) -> Optional[Decimal]:
    try:
        return Decimal(value.replace(",", "").replace("$", "").strip())
    except InvalidOperation:
        return None


def _yes_no(value: str) -> Optional[bool]:
    word = value.strip().lower()
    return {"yes": True, "no": False}.get(word)


def pdf_text(body: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(body))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


#: Every label a notice line can open with, in either layout. A line opening with none
#: of these, directly under a ``Name:`` line, is that name wrapping onto a second line.
_LABEL = re.compile(
    r"^(?:(?:Name|Unregistered|Registered|Employer|City|Date|Amount|Inkind|Loan|"
    r"Committee|Treasurer|Period|Submission date)\s*:|Received by the Board\b|"
    r"Contribution received from|Loan received from|Contributor, Lender, or Endorser "
    r"Information|(?:Candidate / )?Committee Information|Campaign Finance Reporter|"
    r"Page \d|Large Contribution Notice|24 Hour Notice)",
    re.I,
)


def _names(lines: list[str]) -> list[str]:
    names = []
    for index, line in enumerate(lines):
        match = re.match(r"^(?:Name|Unregistered|Registered):\s*(.*)$", line)
        if not match:
            continue
        parts = [match.group(1).strip()]
        for following in lines[index + 1 :]:
            if _LABEL.match(following):
                break
            parts.append(following.strip())
        names.append(" ".join(part for part in parts if part))
    return names


def parse_notice_text(text: str) -> ParsedNotice:
    """The fields a notice PDF states, read from its text.

    Two layouts are in use, measured across all 320 notices on 23 Sep 2026: the Board's
    own filing software ("Large Contribution Notice", 217 of them) and a second one
    ("24 Hour Notice", 103) that prints unpadded dates, a dollar sign, the name block
    twice, a long name wrapped onto a second line, and **no date received by the
    Board**. A missing received date is left missing and the page prints none, never the
    submission date in its place.

    The contributor, the date and the amount are required: a notice missing any of them
    carries an error and is never served, because printing a blank where its amount
    belongs would be a claim the record does not make.
    """
    notice = ParsedNotice()
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    joined = "\n".join(lines)
    if "REPORT OF LARGE PERSONAL CONTRIBUTION OR LOAN" in joined:
        return _parse_personal_contribution_form(lines)

    if re.search(r"\bamend", joined, re.I):
        notice.amended = True

    match = re.search(r"^Committee:\s*(.+?)\s*(?:\((\d+)\))?\s*$", joined, re.M)
    if match:
        notice.committee_name = match.group(1).strip()
        notice.registration_number = match.group(2)
    match = re.search(r"^Treasurer:\s*(.+)$", joined, re.M)
    if match:
        notice.treasurer_name = match.group(1).strip()
    match = re.search(
        r"^Period:\s*(\d{1,2}/\d{1,2}/\d{4})\s+through\s+(\d{1,2}/\d{1,2}/\d{4})",
        joined,
        re.M,
    )
    if match:
        notice.period_start = _any_us_date(match.group(1))
        notice.period_end = _any_us_date(match.group(2))
    match = re.search(r"^Submission date:\s*(.+)$", joined, re.M | re.I)
    if match:
        notice.submitted_on = _long_date(match.group(1))
    match = re.search(r"^Received by the Board\s+(.+)$", joined, re.M)
    if match:
        notice.received_on = _long_date(match.group(1))

    names = list(dict.fromkeys(_names(lines)))
    if len(names) != 1:
        notice.errors.append(
            f"expected 1 contributor name on the notice and read {len(names)}"
        )
    if names:
        raw_name = names[0].strip()
        registered = re.search(r"\s*\(Registered Id:\s*(\d+)\s*\)\s*$", raw_name)
        if registered:
            notice.contributor_registration_number = registered.group(1)
            raw_name = raw_name[: registered.start()].strip()
        notice.contributor_name = raw_name or None
    employers = list(dict.fromkeys(re.findall(r"^Employer:\s*(.*)$", joined, re.M)))
    if employers and employers[0].strip():
        notice.employer = employers[0].strip()
    match = re.search(
        r"^City:\s*(.*?)\s*State:\s*([A-Z]{0,2})\s*Zip code:\s*(\S*)\s*$",
        joined,
        re.M | re.I,
    )
    if match:
        notice.city = match.group(1).strip() or None
        notice.state = match.group(2).strip() or None
        notice.zip_code = match.group(3).strip() or None
    match = re.search(
        r"^Date:\s*(\d{1,2}/\d{1,2}/\d{4})\s+Amount:\s*\$?\s*([\d,]+\.\d{2})\s*$",
        joined,
        re.M,
    )
    if match:
        notice.contribution_date = _any_us_date(match.group(1))
        notice.amount = _money(match.group(2))
    match = re.search(
        r"^Inkind:\s*(\w+)\s*Description:\s*(.*?)\s*^Loan:", joined, re.M | re.S
    )
    if match:
        notice.in_kind = _yes_no(match.group(1))
        description = " ".join(match.group(2).split())
        notice.in_kind_description = description or None
    match = re.search(r"^Loan:\s*(\w+)", joined, re.M)
    if match:
        notice.loan = _yes_no(match.group(1))

    for name, value in (
        ("the contributor", notice.contributor_name),
        ("the contribution date", notice.contribution_date),
        ("the amount", notice.amount),
        ("the in-kind answer", notice.in_kind),
        ("the loan answer", notice.loan),
    ):
        if value is None:
            notice.errors.append(f"could not read {name}")
    return notice


def _parse_personal_contribution_form(lines: list[str]) -> ParsedNotice:
    """A candidate's report of a large contribution or loan to their own campaign.

    The Board lists it among the notices (Minnesota Statutes 10A.20 subd. 5a). Its
    filled-in values follow the form's printed labels, in a fixed order: the committee
    and its registration number, then the candidate's name and the date, then the
    amount. Measured on the one such form on the 2026 list (filer 19304).
    """
    notice = ParsedNotice(in_kind=False, loan=False)
    for index, line in enumerate(lines):
        committee = re.match(r"^(.+?)\s+(\d{4,6})$", line)
        if not committee or index + 2 >= len(lines):
            continue
        person = re.match(r"^(.+?)\s+(\d{2}/\d{2}/\d{4})$", lines[index + 1])
        amount = re.match(r"^\$?\s*([\d,]+\.\d{2})$", lines[index + 2])
        if person and amount:
            notice.committee_name = committee.group(1).strip()
            notice.registration_number = committee.group(2)
            notice.contributor_name = person.group(1).strip()
            notice.contribution_date = _any_us_date(person.group(2))
            notice.amount = _money(amount.group(1))
            break
    for name, value in (
        ("the contributor", notice.contributor_name),
        ("the contribution date", notice.contribution_date),
        ("the amount", notice.amount),
    ):
        if value is None:
            notice.errors.append(f"could not read {name}")
    return notice


# --- The catalogue's statement and notice entries --------------------------------


@dataclass(frozen=True)
class CatalogueStatement:
    registration_number: str
    filing_year: int
    report_period: str
    report_name: str
    report_cut_off: Optional[date]
    number: int


_STATEMENT_FILE = re.compile(r"^(\d+)_D(\d+)\.pdf$")
_NOTICE_FILE = re.compile(r"^(\d+)_(\d{6}_\d{6}(?:_N\d+)?)\.pdf$")


def _catalogue_rows(payload: Any, key: str) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if not isinstance(data, dict):
        return []
    rows = data.get(key)
    if isinstance(rows, dict):
        return [row for row in rows.values() if isinstance(row, dict)]
    return []


def _report_periods(
    payload: Any, registration_number: str
) -> dict[tuple[int, str, bool], Optional[tuple[str, Optional[date]]]]:
    """(year, report name, special election) to that report's period code and cut-off,
    from the catalogue's ``pdfs`` rows. ``None`` where 2 reports share the key, which
    makes the period code ambiguous and the statement unaddressable."""
    periods: dict[tuple[int, str, bool], Optional[tuple[str, Optional[date]]]] = {}
    for row in _catalogue_rows(payload, "pdfs"):
        if (row.get("RegisteredEntityID") or "").strip() != registration_number:
            continue
        try:
            year = int(row.get("FilingYear"))
        except (TypeError, ValueError):
            continue
        name = (row.get("ReportName") or "").strip()
        code = (row.get("ReportType") or "").strip()
        if not name or not code:
            continue
        special = str(row.get("SpecialElectionindicator") or "0").strip() not in (
            "0",
            "",
        )
        key = (year, name, special)
        cut_off = filings._timestamp_date(row.get("CutOffDate"))
        if key in periods and periods[key] != (code, cut_off):
            periods[key] = None
        else:
            periods[key] = (code, cut_off)
    return periods


def parse_catalogue_statements(
    payload: Any, registration_number: str
) -> tuple[list[CatalogueStatement], list[str]]:
    """Every disclosure statement a catalogue lists, one per report and number.

    **The number restarts for every report.** Restore Sanity's 2026 catalogue lists
    `41412_D1.pdf` under its 1st Quarter, June, Pre-Primary and September reports, and
    those are 4 different documents: the PDF address takes the report's own period code
    (`period=A` .. `period=D`), which only the catalogue's ``pdfs`` row for that report
    carries. The ``disclosure`` rows themselves all say ``ReportType: D`` and the
    September cut-off whatever report they sit under, so the code is never read from
    them. A statement whose report has no ``pdfs`` row, or 2, is reported and skipped:
    fetching it under a guessed code would keep a different document in its place.
    """
    periods = _report_periods(payload, registration_number)
    found: dict[tuple[int, str, int], CatalogueStatement] = {}
    errors: list[str] = []
    for row in _catalogue_rows(payload, "disclosure"):
        if (row.get("RegisteredEntityID") or "").strip() != registration_number:
            errors.append(
                f"asked for {registration_number}'s catalogue and a statement row "
                f"came back for {row.get('RegisteredEntityID')!r}"
            )
            continue
        name = (row.get("fileName") or "").strip()
        match = _STATEMENT_FILE.match(name)
        if not match or match.group(1) != registration_number:
            continue
        try:
            year = int(row.get("FilingYear"))
        except (TypeError, ValueError):
            errors.append(f"a statement row for {registration_number} has no year")
            continue
        report_name = (row.get("ReportName") or "").strip()
        special = str(row.get("SpecialElectionindicator") or "0").strip() not in (
            "0",
            "",
        )
        period = periods.get((year, report_name, special))
        if period is None:
            errors.append(
                f"{registration_number}'s {year} statement {match.group(2)} is listed "
                f"under {report_name!r}, and the catalogue gives that report "
                + (
                    "2 period codes"
                    if (year, report_name, special) in periods
                    else "no period code"
                )
            )
            continue
        code, cut_off = period
        number = int(match.group(2))
        found.setdefault(
            (year, code, number),
            CatalogueStatement(
                registration_number, year, code, report_name, cut_off, number
            ),
        )
    return [found[key] for key in sorted(found)], errors


def parse_catalogue_notice_amendments(
    payload: Any, registration_number: str
) -> dict[tuple[int, str], int]:
    """(year, Board notice id) to the catalogue's amendment index, for filed notices."""
    marks: dict[tuple[int, str], int] = {}
    for row in _catalogue_rows(payload, "notices"):
        match = _NOTICE_FILE.match((row.get("fileName") or "").strip())
        if not match or match.group(1) != registration_number:
            continue
        indexes = filings._amendment_indexes(row.get("amendments"))
        if not indexes:
            continue
        try:
            year = int(row.get("FilingYear"))
        except (TypeError, ValueError):
            continue
        marks[(year, match.group(2))] = max(indexes)
    return marks


# --- Which windows apply to a filer ----------------------------------------------


@dataclass(frozen=True)
class BallotCandidate:
    office: str
    name: str
    party: str


def parse_candidate_file(body: bytes) -> list[BallotCandidate]:
    """The Secretary of State's ``cand.txt``: ``id;name;office id;office;...;party``."""
    text = body.decode("latin-1")
    candidates = []
    for line in text.splitlines():
        parts = line.split(";")
        if len(parts) < 7:
            continue
        candidates.append(
            BallotCandidate(
                office=parts[3].strip(), name=parts[1].strip(), party=parts[6].strip()
            )
        )
    return candidates


def _fold(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    return re.sub(r"[^a-z]", "", value.lower())


def ballot_office_for(office: Optional[str], district: Optional[str]) -> Optional[str]:
    """The Secretary of State's office name for a Board register office and district.

    Only the offices whose ballot names are unambiguous are mapped. Judicial seats are
    not: the ballot names a seat number the Board's register does not carry, so a judicial
    candidate keeps both windows rather than being matched to a seat by guesswork.
    """
    office = (office or "").strip()
    district = (district or "").strip()
    if office == "House" and district:
        return f"State Representative District {district.upper()}"
    if office == "Senate" and district:
        return f"State Senator District {district.lstrip('0') or district}"
    return {
        "Governor": "Governor & Lt Governor",
        "Attorney General": "Attorney General",
        "Secretary of State": "Secretary of State",
        "State Auditor": "State Auditor",
    }.get(office)


def _surname(candidate_name: str) -> str:
    """The Board's register writes a candidate as ``Surname, Given``."""
    return _fold(candidate_name.split(",")[0]) if "," in candidate_name else ""


def _on(
    ballot: Iterable[BallotCandidate], office: str, surname: str
) -> list[BallotCandidate]:
    found = []
    for candidate in ballot:
        if candidate.office != office:
            continue
        # A governor's ballot line names the running mate too ("Lisa Demuth and Ryan
        # Wilson"); only the first person is the committee's candidate.
        first_person = candidate.name.split(" and ")[0]
        words = [_fold(word) for word in first_person.split()]
        if surname and surname in words:
            found.append(candidate)
    return found


def window_exclusions_for_candidate(
    *,
    office: Optional[str],
    district: Optional[str],
    candidate_name: Optional[str],
    primary: list[BallotCandidate],
    general: list[BallotCandidate],
) -> list[tuple[str, str, str]]:
    """``(window, reason, source)`` for each window the ballot files rule out.

    Conservative on purpose: a window is removed only when the candidate is found in the
    primary file under their office and district. Found in the primary and absent from
    the general ballot removes the October window; found in the primary as the only
    candidate of their party removes the primary window. Anyone found nowhere keeps both,
    which the guide states as a limit.
    """
    ballot_office = ballot_office_for(office, district)
    surname = _surname(candidate_name or "")
    if not ballot_office or not surname:
        return []
    in_primary = _on(primary, ballot_office, surname)
    if len(in_primary) != 1:
        return []
    exclusions = []
    party = in_primary[0].party
    same_party = [c for c in primary if c.office == ballot_office and c.party == party]
    if len(same_party) == 1:
        exclusions.append((PRE_PRIMARY, "unopposed_in_primary", PRIMARY_CANDIDATES_URL))
    if not _on(general, ballot_office, surname):
        exclusions.append(
            (PRE_GENERAL, "not_on_general_ballot", GENERAL_CANDIDATES_URL)
        )
    return exclusions


BALLOT_QUESTION_SUB_TYPES = frozenset({"BC", "BF"})


# --- Fetching and keeping PDFs ---------------------------------------------------


def get_bytes(http: requests.Session, url: str) -> tuple[int, bytes]:
    last_error: Optional[Exception] = None
    for attempt, pause in enumerate(filings.CONNECTION_RETRY_PAUSES + (0,), start=1):
        try:
            response = http.get(url, timeout=filings.REQUEST_TIMEOUT_SECONDS)
        except requests.RequestException as error:
            last_error = error
            if pause == 0:
                raise
            time.sleep(pause)
            continue
        pause = filings.pause_before_retry(response, attempt)
        if pause is not None:
            time.sleep(pause)
            continue
        return response.status_code, response.content
    raise last_error or RuntimeError(f"{url} could not be reached")  # pragma: no cover


@dataclass(frozen=True)
class KeptPdf:
    document_hash: str
    object_key: str
    compressed_hash: str
    byte_size: int


def keep_pdf(store: Any, prefix: str, body: bytes) -> KeptPdf:
    """Compress, upload, read back and verify one PDF, keyed on its own sha256."""
    import hashlib

    document_hash = hashlib.sha256(body).hexdigest()
    key = f"{prefix}/{document_hash}.pdf.gz"
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "document.pdf.gz")
        compressed_hash, _size = gzip_bytes_to(body, path)
        if store is not None:
            store.put_and_verify(key, path, compressed_hash)
    return KeptPdf(document_hash, key, compressed_hash, len(body))


def read_kept_pdf(store: Any, object_key: str, compressed_hash: str) -> bytes:
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "document.pdf.gz")
        store.get(object_key, path)
        if sha256_of_file(path) != compressed_hash:
            raise RuntimeError(
                f"the kept PDF {object_key} no longer hashes as recorded"
            )
        with gzip.open(path, "rb") as compressed:
            return compressed.read()


class PdfCache:
    """An optional local folder of PDFs already read, so a dry run's reads are reused.

    A dry run fetches the PDFs to show what it would store; pointing the real run at the
    same folder means the Board is asked for each PDF once in all, which is the whole
    point of fetching once.
    """

    def __init__(self, directory: Optional[str]):
        self.directory = directory
        if directory:
            os.makedirs(directory, exist_ok=True)

    def _path(self, name: str) -> Optional[str]:
        if not self.directory:
            return None
        return os.path.join(self.directory, re.sub(r"[^0-9A-Za-z_.-]", "_", name))

    def get(self, name: str) -> Optional[bytes]:
        path = self._path(name)
        if path and os.path.exists(path):
            with open(path, "rb") as handle:
                return handle.read()
        return None

    def put(self, name: str, body: bytes) -> None:
        path = self._path(name)
        if path:
            with open(path, "wb") as handle:
                handle.write(body)


def fetch_pdf(
    http: requests.Session, url: str, cache: PdfCache, cache_name: str
) -> tuple[Optional[bytes], Optional[str]]:
    """The PDF's bytes, or why there are none. A body not starting ``%PDF`` is refused."""
    cached = cache.get(cache_name)
    if cached is not None:
        return cached, None
    status, body = get_bytes(http, url)
    time.sleep(PDF_SPACING_SECONDS)
    if status != 200:
        return None, f"HTTP {status}"
    if not body.startswith(b"%PDF"):
        return None, "the Board answered with something that is not a PDF"
    cache.put(cache_name, body)
    return body, None


# --- Collecting notices ----------------------------------------------------------


@dataclass
class NoticeRunReport:
    listed: int = 0
    new: int = 0
    already_held: int = 0
    parse_failures: list[str] = field(default_factory=list)
    fetch_failures: list[str] = field(default_factory=list)
    page_errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not (self.fetch_failures or self.page_errors)


def _apply_parsed(
    row: schema.CampaignFinanceContributionNotice,
    parsed: ParsedNotice,
    listed: ListedNotice,
) -> None:
    errors = list(parsed.errors)
    if (
        parsed.registration_number
        and parsed.registration_number != listed.registration_number
    ):
        errors.append(
            f"the PDF names committee {parsed.registration_number}, the page "
            f"{listed.registration_number}"
        )
    row.committee_name_as_filed = parsed.committee_name
    row.treasurer_name = parsed.treasurer_name
    row.period_start = parsed.period_start
    row.period_end = parsed.period_end
    row.submitted_on = parsed.submitted_on
    row.received_on = parsed.received_on
    row.contributor_name = parsed.contributor_name
    row.contributor_registration_number = parsed.contributor_registration_number
    row.employer = parsed.employer
    row.city = parsed.city
    row.state = parsed.state
    row.zip_code = parsed.zip_code
    row.contribution_date = parsed.contribution_date
    row.amount = parsed.amount
    row.in_kind = parsed.in_kind
    row.in_kind_description = parsed.in_kind_description
    row.loan = parsed.loan
    row.parse_error = "; ".join(errors) or None


def collect_notices(
    db: Session,
    http: requests.Session,
    store: Any,
    *,
    dry_run: bool,
    cache: Optional[PdfCache] = None,
    page_body: Optional[bytes] = None,
    now: Optional[datetime] = None,
) -> NoticeRunReport:
    """Read the notice page, fetch each notice PDF not yet held, and record it.

    A failure keeps every record already held: nothing is deleted, a notice no longer
    listed keeps its row (``last_listed_at`` says when it was last seen), and the list's
    copy date only moves when a whole read completes.
    """
    cache = cache or PdfCache(None)
    now = now or datetime.now(UTC)
    report = NoticeRunReport()
    if page_body is None:
        status, page_body = get_bytes(http, NOTICE_LIST_URL)
        if status != 200:
            report.page_errors.append(f"the notice page answered HTTP {status}")
            return report
    page = page_body.decode("utf-8", errors="replace")
    listed, errors = parse_notice_list(page)
    report.page_errors.extend(errors)
    report.listed = len(listed)
    if report.page_errors:
        return report

    held = {
        (
            n.registration_number,
            n.filing_year,
            n.notice_period,
            n.special_election,
            n.board_notice_id,
        ): n
        for n in db.scalars(select(schema.CampaignFinanceContributionNotice))
    }
    for notice in listed:
        key = (
            notice.registration_number,
            notice.filing_year,
            notice.notice_period,
            notice.special_election,
            notice.board_notice_id,
        )
        row = held.get(key)
        if row is not None and row.document_hash is not None:
            report.already_held += 1
            if not dry_run:
                row.last_listed_at = now
                row.committee_name_as_listed = notice.committee_name_as_listed
            continue
        body, failure = fetch_pdf(
            http,
            notice.pdf_url,
            cache,
            f"notice-{notice.registration_number}-{notice.filing_year}-"
            f"{notice.notice_period}-{int(notice.special_election)}-"
            f"{notice.board_notice_id}.pdf",
        )
        if body is None:
            report.fetch_failures.append(f"{notice.pdf_url}: {failure}")
            continue
        parsed = parse_notice_text(pdf_text(body))
        if parsed.errors:
            report.parse_failures.append(
                f"{notice.pdf_url}: {'; '.join(parsed.errors)}"
            )
        report.new += 1
        if dry_run:
            continue
        kept = keep_pdf(store, NOTICE_OBJECT_PREFIX, body)
        if row is None:
            row = schema.CampaignFinanceContributionNotice(
                registration_number=notice.registration_number,
                filer_kind=notice.filer_kind,
                filing_year=notice.filing_year,
                notice_period=notice.notice_period,
                special_election=notice.special_election,
                board_notice_id=notice.board_notice_id,
                first_listed_at=now,
                last_listed_at=now,
            )
            db.add(row)
        row.committee_name_as_listed = notice.committee_name_as_listed
        row.listed_on = notice.listed_on
        row.last_listed_at = now
        _apply_parsed(row, parsed, notice)
        if parsed.amended and (row.amendment_index or 0) == 0:
            row.amendment_index = 1
        row.document_hash = kept.document_hash
        row.object_key = kept.object_key
        row.compressed_hash = kept.compressed_hash
        row.byte_size = kept.byte_size
        row.fetched_at = now
        db.commit()

    if not dry_run and report.ok:
        years = sorted(
            {n.filing_year for n in listed}
            | ({now.year} if now.year in NOTICE_WINDOWS else set())
        )
        import hashlib

        db.add(
            schema.CampaignFinanceNoticeListCopy(
                fetched_at=now,
                page_sha256=hashlib.sha256(page_body).hexdigest(),
                notice_count=len(listed),
                covered_years=years,
                source_url=NOTICE_LIST_URL,
            )
        )
        db.commit()
    return report


def record_notice_amendment(
    db: Session,
    http: requests.Session,
    store: Any,
    *,
    registration_number: str,
    filing_year: int,
    board_notice_id: str,
    amendment_index: int,
    cache: Optional[PdfCache] = None,
    now: Optional[datetime] = None,
) -> bool:
    """A notice the catalogue marks as revised: keep what we held, read the new version.

    Returns whether anything changed. Only a higher index than the one recorded triggers
    a new fetch, so an unchanged marker never re-asks the Board.
    """
    row = db.scalar(
        select(schema.CampaignFinanceContributionNotice).where(
            schema.CampaignFinanceContributionNotice.registration_number
            == registration_number,
            schema.CampaignFinanceContributionNotice.filing_year == filing_year,
            schema.CampaignFinanceContributionNotice.board_notice_id == board_notice_id,
        )
    )
    if row is None or amendment_index <= (row.amendment_index or 0):
        if row is not None and row.amendment_index is None:
            row.amendment_index = amendment_index
            db.commit()
        return False
    cache = cache or PdfCache(None)
    now = now or datetime.now(UTC)
    url = notice_pdf_url(
        f"{filing_year % 100:02d}",
        row.notice_period,
        row.special_election,
        registration_number,
        board_notice_id,
    )
    body, failure = fetch_pdf(
        http,
        url,
        cache,
        f"notice-{registration_number}-{board_notice_id}-a{amendment_index}.pdf",
    )
    if body is None:
        return False
    parsed = parse_notice_text(pdf_text(body))
    kept = keep_pdf(store, NOTICE_OBJECT_PREFIX, body)
    if kept.document_hash == row.document_hash:
        row.amendment_index = amendment_index
        db.commit()
        return False
    earlier = (row.contributor_name, row.contribution_date, row.amount)
    listed = ListedNotice(
        filer_kind=row.filer_kind,
        committee_name_as_listed=row.committee_name_as_listed or "",
        two_digit_year=f"{filing_year % 100:02d}",
        notice_period=row.notice_period,
        special_election=row.special_election,
        registration_number=registration_number,
        board_notice_id=board_notice_id,
        listed_on=row.listed_on,
    )
    _apply_parsed(row, parsed, listed)
    if earlier[0] != row.contributor_name:
        row.earlier_contributor_name = earlier[0]
    if earlier[1] != row.contribution_date:
        row.earlier_contribution_date = earlier[1]
    if earlier[2] != row.amount:
        row.earlier_amount = earlier[2]
    row.amendment_index = amendment_index
    row.document_hash = kept.document_hash
    row.object_key = kept.object_key
    row.compressed_hash = kept.compressed_hash
    row.byte_size = kept.byte_size
    row.fetched_at = now
    db.commit()
    return True


# --- Window exclusions from the ballot files -------------------------------------


def record_window_exclusions(
    db: Session,
    *,
    election_year: int,
    filers: Iterable[Any],
    sub_types: dict[str, str],
    primary: list[BallotCandidate],
    general: list[BallotCandidate],
    dry_run: bool,
    now: Optional[datetime] = None,
) -> list[tuple[str, str, str]]:
    """Replace the year's exclusions with what the ballot files and the statute say.

    ``filers`` are register rows (``cf_filer``) carrying ``registration_number``,
    ``kind``, ``office``, ``district`` and ``candidate_name``.
    """
    now = now or datetime.now(UTC)
    decided: list[tuple[str, str, str, str]] = []
    for filer in filers:
        registration = filer.registration_number
        if filer.kind == FilerKind.political_committee_or_fund:
            if sub_types.get(registration) in BALLOT_QUESTION_SUB_TYPES:
                decided.append(
                    (
                        registration,
                        PRE_PRIMARY,
                        "ballot_question_committee",
                        "https://www.revisor.mn.gov/statutes/cite/10A.20#stat.10A.20.5",
                    )
                )
            continue
        if filer.kind != FilerKind.candidate_committee:
            continue
        for window, reason, source in window_exclusions_for_candidate(
            office=filer.office,
            district=filer.district,
            candidate_name=filer.candidate_name,
            primary=primary,
            general=general,
        ):
            decided.append((registration, window, reason, source))
    if dry_run:
        return [(r, w, why) for r, w, why, _ in decided]
    existing = {
        (row.registration_number, row.window): row
        for row in db.scalars(
            select(schema.CampaignFinanceNoticeWindowExclusion).where(
                schema.CampaignFinanceNoticeWindowExclusion.election_year
                == election_year
            )
        )
    }
    wanted = {(r, w) for r, w, _, _ in decided}
    for key, row in existing.items():
        if key not in wanted:
            db.delete(row)
    for registration, window, reason, source in decided:
        row = existing.get((registration, window))
        if row is None:
            db.add(
                schema.CampaignFinanceNoticeWindowExclusion(
                    registration_number=registration,
                    election_year=election_year,
                    window=window,
                    reason=reason,
                    source_url=source,
                    determined_at=now,
                )
            )
        else:
            row.reason = reason
            row.source_url = source
            row.determined_at = now
    db.commit()
    return [(r, w, why) for r, w, why, _ in decided]


# --- Collecting statements -------------------------------------------------------


@dataclass
class StatementRunReport:
    catalogues_read: int = 0
    listed: int = 0
    new: int = 0
    pdfs_fetched: int = 0
    notice_amendments: int = 0
    failures: list[str] = field(default_factory=list)


def record_catalogue_statements(
    db: Session,
    registration_number: str,
    payload: Any,
    *,
    now: Optional[datetime] = None,
) -> tuple[int, int, list[str]]:
    """Record the statements one catalogue lists. Returns (listed, new, errors).

    The additive step the filings loader can call with a catalogue it has already
    fetched, so reading statements costs the Board no extra request. Never deletes: a
    statement no longer listed keeps its row and its reading.
    """
    now = now or datetime.now(UTC)
    statements, errors = parse_catalogue_statements(payload, registration_number)
    model = schema.CampaignFinanceDisclosureStatement
    new = 0
    for statement in statements:
        row = db.scalar(
            select(model).where(
                model.recipient_registration_number == registration_number,
                model.filing_year == statement.filing_year,
                model.report_period == statement.report_period,
                model.statement_number == statement.number,
            )
        )
        if row is None:
            db.add(
                model(
                    recipient_registration_number=registration_number,
                    filing_year=statement.filing_year,
                    report_period=statement.report_period,
                    report_name=statement.report_name,
                    report_cut_off=statement.report_cut_off,
                    statement_number=statement.number,
                    listed_under_reports=[statement.report_name],
                    first_listed_at=now,
                    last_listed_at=now,
                )
            )
            new += 1
        else:
            row.last_listed_at = now
            row.report_name = statement.report_name
            row.report_cut_off = statement.report_cut_off
            row.listed_under_reports = [statement.report_name]
    db.commit()
    return len(statements), new, errors


#: Statement PDFs are kept from this filing year on. Minnesota is re-posting every report
#: filed since 1 Jan 2022 with addresses blacked out, so from 2022 a copy taken now may be
#: the only one of that version; before 2022 the Board serves almost nothing
#: (`docs/architecture/campaign-finance-system-design.md` §9.4). Older statements are
#: recorded as listed and link to the Board's own PDF.
KEEP_STATEMENT_PDFS_FROM = 2022


def fetch_missing_statement_pdfs(
    db: Session,
    http: requests.Session,
    store: Any,
    *,
    cache: Optional[PdfCache] = None,
    now: Optional[datetime] = None,
    from_year: int = KEEP_STATEMENT_PDFS_FROM,
) -> tuple[int, list[str]]:
    """Fetch and keep each listed statement's PDF that is not yet held, once."""
    cache = cache or PdfCache(None)
    now = now or datetime.now(UTC)
    fetched = 0
    failures: list[str] = []
    model = schema.CampaignFinanceDisclosureStatement
    rows = db.scalars(
        select(model).where(
            model.document_hash.is_(None), model.filing_year >= from_year
        )
    ).all()
    for row in rows:
        url = statement_pdf_url(
            row.filing_year,
            row.recipient_registration_number,
            row.report_period,
            row.statement_number,
        )
        body, failure = fetch_pdf(
            http,
            url,
            cache,
            f"statement-{row.recipient_registration_number}-{row.filing_year}-"
            f"{row.report_period}{row.statement_number}.pdf",
        )
        if body is None:
            failures.append(f"{url}: {failure}")
            continue
        kept = keep_pdf(store, STATEMENT_OBJECT_PREFIX, body)
        row.document_hash = kept.document_hash
        row.object_key = kept.object_key
        row.compressed_hash = kept.compressed_hash
        row.byte_size = kept.byte_size
        row.fetched_at = now
        db.commit()
        fetched += 1
    return fetched, failures


def scan_catalogues_for_statements(
    db: Session,
    http: requests.Session,
    store: Any,
    *,
    filers: list[tuple[FilerKind, str]],
    segment: tuple[int, int],
    scope: str,
    dry_run: bool,
    cache: Optional[PdfCache] = None,
    spacing_seconds: float = 0.5,
    notice_amendment_http: Optional[requests.Session] = None,
) -> StatementRunReport:
    """Read each filer's catalogue for statements and notice amendment markers.

    The standalone form of ``record_catalogue_statements``, for the backfill and for any
    refresh that does not already hold the catalogues. A scan that read every catalogue
    records a ``cf_statement_scan`` row, which dates the copy the page prints.
    """
    started = datetime.now(UTC)
    report = StatementRunReport()
    for kind, registration in filers:
        try:
            response, _reports, errors = filings.fetch_catalogue(
                http, kind, registration, segment
            )
        except requests.RequestException as error:
            report.failures.append(
                f"{registration}'s catalogue could not be reached: {error}"
            )
            continue
        time.sleep(spacing_seconds)
        if response.status_code != 200:
            report.failures.append(
                f"{registration}'s catalogue answered HTTP {response.status_code}"
            )
            continue
        payload = response.json()
        report.catalogues_read += 1
        statements, statement_errors = parse_catalogue_statements(payload, registration)
        report.failures.extend(statement_errors)
        report.listed += len(statements)
        if not dry_run:
            _listed, new, _ = record_catalogue_statements(db, registration, payload)
            report.new += new
            for (year, board_id), index in parse_catalogue_notice_amendments(
                payload, registration
            ).items():
                if record_notice_amendment(
                    db,
                    notice_amendment_http or http,
                    store,
                    registration_number=registration,
                    filing_year=year,
                    board_notice_id=board_id,
                    amendment_index=index,
                    cache=cache,
                ):
                    report.notice_amendments += 1
    if not dry_run:
        fetched, failures = fetch_missing_statement_pdfs(db, http, store, cache=cache)
        report.pdfs_fetched = fetched
        report.failures.extend(failures)
        if report.catalogues_read == len(filers):
            db.add(
                schema.CampaignFinanceStatementScan(
                    started_at=started,
                    completed_at=datetime.now(UTC),
                    catalogues_read=report.catalogues_read,
                    statements_listed=report.listed,
                    scope=scope,
                )
            )
            db.commit()
    return report


# --- Readings of scanned statements ------------------------------------------------


def statement_image_fingerprint(body: bytes) -> str:
    """sha256 over the scanned page images inside a statement PDF, in page order.

    A reading is tied to what the reader saw, which is the page images. The Board's
    wrapper around them could in principle be regenerated on another request, so the
    check that a reading belongs to the copy we keep compares images, not whole files.
    """
    import hashlib

    from pypdf import PdfReader

    digest = hashlib.sha256()
    reader = PdfReader(io.BytesIO(body))
    for page in reader.pages:
        resources = page.get("/Resources")
        if resources is None:
            continue
        objects = resources.get_object().get("/XObject")
        if objects is None:
            continue
        objects = objects.get_object()
        for name in sorted(objects):
            image = objects[name].get_object()
            if image.get("/Subtype") == "/Image":
                digest.update(image._data)
    return digest.hexdigest()


@dataclass(frozen=True)
class StatementReadingInput:
    recipient_registration_number: str
    filing_year: int
    report_period: str
    statement_number: int
    image_fingerprint: str
    state: str
    donor_name: str
    gift_date: date
    gift_amount: Decimal
    reviewed_by: str
    evidence: str
    recipient_name: Optional[str] = None
    box: Optional[int] = None
    sources: tuple[
        tuple[str, Optional[str], Optional[str], Optional[Decimal]], ...
    ] = ()
    line_a: Optional[Decimal] = None
    line_b: Optional[Decimal] = None
    line_c: Optional[Decimal] = None
    signed_on: Optional[date] = None
    received_on: Optional[date] = None
    repeat_of_period: Optional[str] = None
    repeat_of_number: Optional[int] = None

    @property
    def label(self) -> str:
        return (
            f"{self.recipient_registration_number} {self.filing_year} statement "
            f"{self.report_period}{self.statement_number}"
        )


def _optional_decimal(value: Any) -> Optional[Decimal]:
    return None if value is None else Decimal(str(value))


def _optional_date(value: Any) -> Optional[date]:
    return None if value is None else date.fromisoformat(value)


def reading_from_json(item: dict, default_reviewer: str) -> StatementReadingInput:
    """One reviewed reading. A read statement names its box; its received date is
    optional, because a form carrying no received stamp states none."""
    state = item["state"]
    if state not in ("gift_identified", "read"):
        raise ValueError(f"unknown reading state {state!r}")
    repeat = item.get("repeat_of")
    reading = StatementReadingInput(
        recipient_registration_number=str(item["recipient_registration_number"]),
        filing_year=int(item["filing_year"]),
        report_period=str(item["report_period"]),
        statement_number=int(item["statement_number"]),
        image_fingerprint=item["image_fingerprint"],
        state=state,
        donor_name=item["donor_name"],
        recipient_name=item.get("recipient_name"),
        gift_date=date.fromisoformat(item["gift_date"]),
        gift_amount=Decimal(str(item["gift_amount"])),
        reviewed_by=item.get("reviewed_by") or default_reviewer,
        evidence=item["evidence"],
        box=item.get("box"),
        sources=tuple(
            (
                source["name"],
                source.get("city"),
                source.get("state"),
                _optional_decimal(source.get("amount")),
            )
            for source in item.get("sources", [])
        ),
        line_a=_optional_decimal(item.get("line_a")),
        line_b=_optional_decimal(item.get("line_b")),
        line_c=_optional_decimal(item.get("line_c")),
        signed_on=_optional_date(item.get("signed_on")),
        received_on=_optional_date(item.get("received_on")),
        repeat_of_period=str(repeat["report_period"]) if repeat else None,
        repeat_of_number=int(repeat["statement_number"]) if repeat else None,
    )
    if state == "read" and reading.box not in (1, 2, 3):
        raise ValueError(f"{reading.label} is marked read without its box")
    if state == "read" and reading.box != 3 and reading.sources:
        raise ValueError(f"{reading.label}: only a box-3 statement lists sources")
    return reading


def repeats_match(
    original: StatementReadingInput, repeat: StatementReadingInput
) -> bool:
    """A repeat must state exactly what its original states, or it is 2 statements."""
    return (
        original.donor_name == repeat.donor_name
        and original.gift_date == repeat.gift_date
        and original.gift_amount == repeat.gift_amount
        and original.state == repeat.state
        and original.box == repeat.box
        and original.sources == repeat.sources
        and (original.line_a, original.line_b, original.line_c)
        == (repeat.line_a, repeat.line_b, repeat.line_c)
    )


def _same_reading(row: Any, reading: StatementReadingInput) -> bool:
    read = reading.state == "read"
    return (
        row.state.value == reading.state
        and row.donor_name == reading.donor_name
        and row.recipient_name == reading.recipient_name
        and row.gift_date == reading.gift_date
        and Decimal(row.gift_amount) == reading.gift_amount
        and row.box == (reading.box if read else None)
        and row.line_a == (reading.line_a if read else None)
        and row.line_b == (reading.line_b if read else None)
        and row.line_c == (reading.line_c if read else None)
        and row.signed_on == (reading.signed_on if read else None)
        and row.received_on == (reading.received_on if read else None)
        and row.reviewed_by == reading.reviewed_by
        and row.evidence == reading.evidence
        and row.repeat_of_period == reading.repeat_of_period
        and row.repeat_of_number == reading.repeat_of_number
        and [(s.name, s.city, s.state, s.amount) for s in row.sources]
        == (list(reading.sources) if read else [])
    )


def record_statement_reading(
    db: Session, store: Any, reading: StatementReadingInput, *, dry_run: bool
) -> str:
    """Store one reading after proving it was taken from the copy we keep.

    Refuses when the statement is not listed, when its PDF is not held, or when the kept
    PDF's page images are not the images the reading names. Returns what it did.
    """
    model = schema.CampaignFinanceDisclosureStatement
    statement = db.scalar(
        select(model).where(
            model.recipient_registration_number
            == reading.recipient_registration_number,
            model.filing_year == reading.filing_year,
            model.report_period == reading.report_period,
            model.statement_number == reading.statement_number,
        )
    )
    label = reading.label
    if statement is None:
        return f"refused {label}: no catalogue lists it"
    if statement.object_key is None:
        return f"refused {label}: its PDF is not held yet"
    existing = db.scalar(
        select(schema.CampaignFinanceDisclosureStatementReading).where(
            schema.CampaignFinanceDisclosureStatementReading.statement_id
            == statement.id
        )
    )
    if (
        existing is not None
        and existing.document_hash_read == statement.document_hash
        and _same_reading(existing, reading)
    ):
        return f"unchanged {label}"
    if store is not None:
        body = read_kept_pdf(store, statement.object_key, statement.compressed_hash)
        if statement_image_fingerprint(body) != reading.image_fingerprint:
            return f"refused {label}: the kept PDF's page images are not the ones read"
    if dry_run:
        return f"would record {label}"
    if existing is not None:
        db.delete(existing)
        db.flush()
    read = reading.state == "read"
    row = schema.CampaignFinanceDisclosureStatementReading(
        statement_id=statement.id,
        state=schema.DisclosureStatementReadingState(reading.state),
        donor_name=reading.donor_name,
        recipient_name=reading.recipient_name,
        gift_date=reading.gift_date,
        gift_amount=reading.gift_amount,
        box=reading.box if read else None,
        line_a=reading.line_a if read else None,
        line_b=reading.line_b if read else None,
        line_c=reading.line_c if read else None,
        signed_on=reading.signed_on if read else None,
        received_on=reading.received_on if read else None,
        reviewed_by=reading.reviewed_by,
        evidence=reading.evidence,
        document_hash_read=statement.document_hash,
        repeat_of_period=reading.repeat_of_period,
        repeat_of_number=reading.repeat_of_number,
    )
    if read:
        for position, (name, city, state, amount) in enumerate(
            reading.sources, start=1
        ):
            row.sources.append(
                schema.CampaignFinanceDisclosureStatementSource(
                    position=position, name=name, city=city, state=state, amount=amount
                )
            )
    db.add(row)
    db.commit()
    return f"recorded {label} ({reading.state})"
