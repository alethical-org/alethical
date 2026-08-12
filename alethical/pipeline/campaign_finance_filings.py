"""Fetch the Board's own per-filer figures and its registered-filer directory (#1408).

Net: ask Minnesota what each committee itself reported, and keep the answer beside
the payments we already hold, so a page can show both numbers and say what the
difference between them is. Without this, the only totals we can print are the sums
of the payments the state happened to itemize, which understate every committee by
roughly 4 dollars in 10.

Why it is a second pipeline rather than more of ``campaign_finance.py``: that one
downloads 3 whole files and replaces 3 whole tables, and this one asks about one
filer at a time across ~1,600 filers. What they share is the shape of the promise —
a dated set that is checked before anything is published, published by replacing the
previous set entirely, and traceable back to the exact bytes the Board served.

Three routes, all undocumented, all answering **HTTP 200 to several kinds of
failure**. Measured 12 August 2026 unless stated:

1. **The registered-filer directory**, ``POST https://cfb.mn.gov/reports/api/``. One
   call per filer kind. Omit ``data[params][0]=all`` and it returns the JSON literal
   ``false``.
2. **A filer's report catalogue**, ``tabname=reports_data`` on the viewer endpoint.
   One call per filer, all years, whatever segment is asked for. This is where a
   period end (``CutOffDate``), the amendment list and the special-election flag come
   from.
3. **A filer's reported figures**, ``tabname=financial`` on the same endpoint. Money
   inside an HTML table inside JSON.

**Six ways these routes fail while answering 200**, each measured and each guarded
here rather than trusted:

* A GET with the same parameters returns ``{"tabcontent": "<p>No information found
  for </p>"}``.
* Omitting the ``year_data`` pair returns ``Data not available for `` with no year.
* A filer id nobody registered returns ``Data not available for <year>`` per year and
  no table at all.
* **The wrong viewer for the filer's kind returns exactly that same empty answer.**
  Filer 11880 is a candidate committee; asked through the party-unit or the
  committee-and-fund viewer it returns 200 with no table. This is why the filer's
  kind is read from the directory and never guessed, and why a missing block is
  corroborated against the catalogue before anyone writes "Not reported".
* **``year`` is ignored — the election segment decides which 2 years come back.**
  ``year=2025`` with the segment 2020–2021 returns 2021 and 2020, correctly labelled
  and not what was asked for. So the answer is checked against the years requested,
  never assumed from the request.
* A missing or wrongly-named cookie returns **403** with an Apache error page.
  ``Cookie: PHPSESSID=`` with an empty value is accepted; ``Cookie: x=y`` is not. The
  value is never checked, which is an observed effect and not a published contract.

**One call returns both years of the segment**, as 2 tables, so a filer costs 1
request per 2-year window rather than 2.

Design: ``docs/architecture/campaign-finance-system-design.md`` §9 (Filed reports:
where the official totals come from). Display rules that turn on these figures: §7
and ``.claude/rules/grounded-answers.md`` rule 12.
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import html
import json
import os
import re
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Optional, Sequence

import requests
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.pipeline.raw_file_store import sha256_of_file

FilerKind = schema.CampaignFinanceFilerKind
SnapshotStatus = schema.CampaignFinanceSnapshotStatus
ReconcileOutcome = schema.CampaignFinanceReconcileOutcome

USER_AGENT = "Alethical Campaign Finance Filings/0.1 (+https://alethical.com)"
# Split into a base and 2 paths so a test can serve the same 3 routes over a real
# socket, which is how the download loader's landing page is already handled. Nothing
# in the run guesses an address: both paths are built from whichever base it is given.
BOARD_BASE_URL = "https://cfb.mn.gov"
FILER_DIRECTORY_PATH = "/reports/api/"
VIEWER_PATH = "/reports-and-data/viewers/campaign-finance/{viewer}/api"
# Empty on purpose. The server requires a cookie *named* PHPSESSID and never reads
# its value: an empty value answers 200 and `Cookie: x=y` answers 403. Sending a
# made-up value would look like a session we do not have.
SESSION_COOKIE = "PHPSESSID="
REQUEST_TIMEOUT_SECONDS = 60
# The spacing used throughout #1337's investigation, which drew no refusal across
# roughly 1,200 requests in 2 hours. That is an observation about one day, not a rate
# limit the Board has told us, so it stays conservative rather than being tuned down.
REQUEST_SPACING_SECONDS = 0.25
MAX_ATTEMPTS = 3
RETRY_PAUSE_SECONDS = 5

VIEWER_BY_KIND = {
    FilerKind.candidate_committee: "candidates",
    FilerKind.party_unit: "party-unit",
    FilerKind.political_committee_or_fund: "political-committee-fund",
}
DIRECTORY_ACTION_BY_KIND = {
    FilerKind.candidate_committee: "all-registered-candidates",
    FilerKind.party_unit: "all-registered-ptus",
    FilerKind.political_committee_or_fund: "all-registered-pcfs",
}

TAG = re.compile(r"<[^>]+>")
TABLE_ROW = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.S)
ROW_HEADER = re.compile(r"<th\b([^>]*)>(.*?)</th>", re.S)
ROW_VALUE = re.compile(r"<td\b([^>]*)>(.*?)</td>", re.S)
LEADING_YEAR = re.compile(r"^(\d{4})\b")
# "Data not available for 2025" and "No information found for Financial" are how this
# route says no, at HTTP 200. The year is captured because it says *which* year is
# missing, which is what separates "this filer filed nothing for 2024" from "this
# whole request was wrong".
NO_DATA_FOR = re.compile(r"(?:Data not available|No information found) for\s*(\d{4})?")
# `as of 12/31/2025`, and the date is not always 31 December -- one committee-year
# reads 11/16/2025 -- so 3 of the labels are matched on their stem and the served
# date is kept beside the stem rather than parsed out of it.
AS_OF_SUFFIX = re.compile(r"\s+as of\s+\d{1,2}/\d{1,2}/\d{4}\s*$")
MONEY = re.compile(r"^\(?-?\$-?([\d,]+(?:\.\d+)?)\)?$")
US_DATE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")

MAX_REPORTED_ERRORS = 8


# --- What a filer's figures look like ----------------------------------------
#
# The label sets below are a contract in code, and an unknown, missing or repeated
# label stops a release (§9.3). That only works if the sets are the real
# populations rather than a sample, so both were measured against every registered
# filer rather than taken from the 12-of-each-kind sample §9.9 recorded as a gap.


@dataclass(frozen=True)
class Line:
    """One labelled line of a filer's reported figures.

    ``key`` is ours and never changes; ``stem`` is the Board's wording with any
    "as of <date>" suffix removed. ``money`` is false for the one line whose value
    is a date rather than an amount.
    """

    key: str
    stem: str
    money: bool = True
    dated: bool = False


_SHARED_OPENING = (
    Line("beginning_cash_balance", "Beginning cash balance", dated=True),
    Line("most_recent_report_through", "Most recent report through", money=False),
)
_SHARED_CLOSING = (
    Line("total_expenditures", "Total expenditures"),
    Line("ending_cash_balance", "Ending cash balance", dated=True),
    Line("unpaid_bills_and_loans", "Unpaid bills and loans", dated=True),
)

# A candidate committee reports its money in by contributor type, which is what makes
# the reconciliation in this module possible per schedule rather than in aggregate.
CANDIDATE_LINES = (
    *_SHARED_OPENING,
    Line("individuals_contributions", "Individuals contributions"),
    Line("lobbyist_contributions", "Lobbyist contributions"),
    Line("committee_fund_contributions", "Committee/fund contributions"),
    Line("party_unit_contributions", "Party unit contributions"),
    Line("other_contributions", "Other contributions"),
    Line("public_subsidy_payments", "Public subsidy payments"),
    Line("loans_payable_income", "Loans payable income"),
    Line("miscellaneous_income", "Miscellaneous income"),
    Line("total_receipts", "Total receipts"),
    Line("campaign_expenditures", "Campaign expenditures"),
    Line("noncampaign_disbursements", "Noncampaign disbursements"),
    Line("other_expenditures", "Other expenditures"),
    *_SHARED_CLOSING,
)

# A party unit and a committee or fund share one set, and it carries a single
# "Contributions received" line where a candidate carries 5. So for those kinds
# there is one number to agree on rather than 5, which still catches a broken
# parser but can no longer say which schedule broke (§9.4).
PARTY_UNIT_LINES = (
    *_SHARED_OPENING,
    Line("contributions_received", "Contributions received"),
    Line("loans_payable_income", "Loans payable income"),
    Line("miscellaneous_income", "Miscellaneous income"),
    Line("total_receipts", "Total receipts"),
    Line("general_expenditures", "General expenditures"),
    Line("contributions_to_candidate", "Contributions to candidate"),
    Line("approved_expenditures", "Approved expenditures"),
    Line("contributions_to_party_units", "Contributions to party units"),
    Line("contributions_to_committee_funds", "Contributions to committee / funds"),
    Line("independent_expenditure", "Independent expenditure"),
    Line("ballot_question_expenditure", "Ballot question expenditure"),
    *_SHARED_CLOSING,
)

LINES_BY_KIND: dict[FilerKind, tuple[Line, ...]] = {
    FilerKind.candidate_committee: CANDIDATE_LINES,
    FilerKind.party_unit: PARTY_UNIT_LINES,
    FilerKind.political_committee_or_fund: PARTY_UNIT_LINES,
}

# The lines that add up to the money a filer reported taking in from contributors,
# which is the figure our itemized rows are compared against. Deliberately not
# "total receipts": that also carries public subsidy, loan income and miscellaneous
# income, none of which is a contribution and none of which appears in the itemized
# contributions download.
CONTRIBUTION_LINE_KEYS: dict[FilerKind, tuple[str, ...]] = {
    FilerKind.candidate_committee: (
        "individuals_contributions",
        "lobbyist_contributions",
        "committee_fund_contributions",
        "party_unit_contributions",
        "other_contributions",
    ),
    FilerKind.party_unit: ("contributions_received",),
    FilerKind.political_committee_or_fund: ("contributions_received",),
}


class CampaignFinanceFilingsRefusal(RuntimeError):
    """Raised when the run must stop without publishing."""


# --- Reading a response -------------------------------------------------------


@dataclass
class YearFigures:
    """One year's block of figures for one filer, as the Board rendered it."""

    year: int
    heading: str
    reported_through: Optional[date] = None
    amounts: dict[str, Decimal] = field(default_factory=dict)
    served_labels: dict[str, str] = field(default_factory=dict)


@dataclass
class FinancialTab:
    years: dict[int, YearFigures] = field(default_factory=dict)
    unavailable_years: set[int] = field(default_factory=set)
    unavailable_without_year: bool = False
    errors: list[str] = field(default_factory=list)


def _clean(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(TAG.sub(" ", fragment))).strip()


def parse_money(value: str) -> Optional[Decimal]:
    """``$1,234.56`` to a Decimal, or None when it is not money at all.

    Kept strict on purpose. This route puts money in an HTML cell with no type of
    any kind, so the only thing standing between "$12,875.00" and a heading that
    happened to land in a value cell is that one of them parses and the other does
    not.
    """
    text_value = value.strip()
    match = MONEY.match(text_value)
    if match is None:
        return None
    try:
        amount = Decimal(match.group(1).replace(",", ""))
    except InvalidOperation:  # pragma: no cover - the pattern already bounds this
        return None
    # The digits group cannot contain a minus sign, so any minus anywhere in the
    # string is this value's sign, wherever the source chose to put it. Brackets are
    # the accountant's negative and mean the same thing.
    negative = text_value.startswith("(") or "-" in text_value
    return -amount if negative else amount


def parse_us_date(value: str) -> Optional[date]:
    match = US_DATE.match(value.strip())
    if match is None:
        return None
    month, day, year = (int(part) for part in match.groups())
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_financial_tab(
    payload: Any, kind: FilerKind, requested_years: Sequence[int]
) -> FinancialTab:
    """Read one ``tabname=financial`` response, or say exactly why it cannot be read.

    Everything this function refuses is something the route answers 200 to, so its
    errors are the difference between a checked release and a plausible-looking
    wrong one. A response with the right shape but an unknown, missing or repeated
    label is an error here rather than a partially-read block, because a label we do
    not recognise may be the one carrying the money.
    """
    tab = FinancialTab()
    if not isinstance(payload, dict) or "tabcontent" not in payload:
        got = type(payload).__name__
        tab.errors.append(
            f"the response is not an object carrying tabcontent (got {got}: "
            f"{str(payload)[:80]!r})"
        )
        return tab
    markup = payload["tabcontent"]
    if not isinstance(markup, str):
        tab.errors.append(f"tabcontent is {type(markup).__name__}, not a string")
        return tab

    for match in NO_DATA_FOR.finditer(_clean(markup)):
        if match.group(1):
            tab.unavailable_years.add(int(match.group(1)))
        else:
            tab.unavailable_without_year = True

    expected = {line.stem: line for line in LINES_BY_KIND[kind]}
    for chunk in markup.split("<table")[1:]:
        chunk = chunk.split("</table>")[0]
        block, error = _parse_year_block(chunk, expected)
        if error is not None:
            tab.errors.append(error)
            continue
        if block.year in tab.years:
            tab.errors.append(f"{block.year} appears in more than one table")
            continue
        tab.years[block.year] = block

    for year in requested_years:
        if year in tab.years or year in tab.unavailable_years:
            continue
        tab.errors.append(
            f"{year} was requested and the response neither carries a block for it "
            "nor says data is unavailable for it"
        )
    for year in tab.years:
        if year not in requested_years:
            tab.errors.append(
                f"the response carries a block for {year}, which was not requested "
                f"(asked for {', '.join(str(item) for item in requested_years)})"
            )
    if tab.unavailable_without_year:
        tab.errors.append(
            "the response says data is unavailable without naming a year, which is "
            "how this route answers a request missing its year_data pair"
        )
    return tab


def _parse_year_block(
    chunk: str, expected: dict[str, Line]
) -> tuple[YearFigures, Optional[str]]:
    """One ``<table>`` of one year's figures.

    The markup is invalid and that is load-bearing to work around rather than to
    tidy: a spacer row is served as ``<td colspan="2"></th>``, a ``<td>`` closed by
    ``</th>``. Rows are therefore classified by whether they hold a header cell and
    a value cell at all, which leaves the spacer matching neither and skips it
    without a rule that names it.
    """
    heading = ""
    year: Optional[int] = None
    figures: dict[str, Decimal] = {}
    served: dict[str, str] = {}
    reported_through: Optional[date] = None
    seen: list[str] = []
    for row in TABLE_ROW.findall(chunk):
        headers = ROW_HEADER.findall(row)
        values = ROW_VALUE.findall(row)
        if len(headers) == 1 and not values:
            if year is not None:
                continue
            heading = _clean(headers[0][1])
            found = LEADING_YEAR.match(heading)
            if found is None:
                return YearFigures(0, heading), (
                    f"a table heading does not start with a 4-digit year: {heading!r}"
                )
            year = int(found.group(1))
            continue
        if not headers or not values:
            continue
        if len(headers) != 1 or len(values) != 1:
            return YearFigures(year or 0, heading), (
                f"a row in the {heading or 'unlabelled'} block carries "
                f"{len(headers)} header cells and {len(values)} value cells"
            )
        label = _clean(headers[0][1])
        raw_value = _clean(values[0][1])
        stem = AS_OF_SUFFIX.sub("", label)
        line = expected.get(stem)
        if line is None:
            return YearFigures(year or 0, heading), (
                f"{heading or 'a block'} carries a label this design does not know: "
                f"{label!r}"
            )
        if line.key in seen:
            return YearFigures(year or 0, heading), (
                f"{heading or 'a block'} repeats the label {label!r}"
            )
        seen.append(line.key)
        served[line.key] = label
        if line.money:
            amount = parse_money(raw_value)
            if amount is None:
                return YearFigures(year or 0, heading), (
                    f"{label!r} in {heading or 'a block'} does not hold money: "
                    f"{raw_value!r}"
                )
            figures[line.key] = amount
        else:
            reported_through = parse_us_date(raw_value)
            if reported_through is None:
                return YearFigures(year or 0, heading), (
                    f"{label!r} in {heading or 'a block'} does not hold a date: "
                    f"{raw_value!r}"
                )
    if year is None:
        return YearFigures(0, heading), "a table carries no year heading"
    missing = [line.stem for line in expected.values() if line.key not in seen]
    if missing:
        return YearFigures(year, heading), (
            f"{heading} is missing {len(missing)} label(s): {', '.join(missing[:4])}"
        )
    return (
        YearFigures(
            year=year,
            heading=heading,
            reported_through=reported_through,
            amounts=figures,
            served_labels=served,
        ),
        None,
    )


@dataclass
class CatalogueReport:
    """One report as the Board's own catalogue lists it."""

    registration_number: str
    filing_year: int
    report_type: str
    report_name: str
    cut_off_date: Optional[date]
    special_election: bool
    # Both None when the catalogue carries no amendment record for this report, which
    # is ordinary on old reports rather than a fault: measured on filer 20008, 5 of its
    # 64 reports serve `amendments: null`, all of them from 2004, 2006 and 2007.
    # Recorded as unknown rather than as index 0, because 0 would assert that the
    # original version is the effective one and §9.4 is explicit that a missing
    # amendment marker in an older year means the document is unavailable, never that
    # the report was never amended.
    effective_amendment_index: Optional[int]
    amendment_count: Optional[int]
    termination_date: Optional[date]


def parse_catalogue_payload(
    payload: Any, registration_number: str
) -> tuple[list[CatalogueReport], list[str]]:
    """Read one ``tabname=reports_data`` response.

    Two traps live in this payload and both are the kind that produce a plausible
    wrong answer rather than an error:

    * ``amendments`` is highest-first in 366 of 367 multi-version reports, and the
      exception repeats its entries (``['1','0','1','0']``), so the effective
      version is the **maximum after deduplicating** rather than the first entry.
    * ``TerminationDate`` belongs to the registration and is copied onto every
      report row, including reports filed years before it. Read as "this report
      terminated the committee" it is wrong on 15 of one filer's 16 rows, so it is
      stored once per filer rather than per report.
    """
    errors: list[str] = []
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        errors.append(
            f"the catalogue for {registration_number} is not an object carrying data "
            f"(got {type(payload).__name__}: {str(payload)[:80]!r})"
        )
        return [], errors
    rows = payload["data"].get("pdfs")
    if not isinstance(rows, dict):
        errors.append(
            f"the catalogue for {registration_number} carries no pdfs object "
            f"(got {type(rows).__name__})"
        )
        return [], errors

    reports: list[CatalogueReport] = []
    for raw in rows.values():
        if not isinstance(raw, dict):
            errors.append(
                f"a catalogue entry for {registration_number} is not an object"
            )
            continue
        served_id = (raw.get("RegisteredEntityID") or "").strip()
        if served_id != registration_number:
            errors.append(
                f"asked the catalogue for {registration_number} and a row came back "
                f"for {served_id!r}"
            )
            continue
        year = _int_or_none(raw.get("FilingYear"))
        if year is None:
            errors.append(
                f"a catalogue row for {registration_number} carries no filing year"
            )
            continue
        served_amendments = raw.get("amendments")
        amendments = _amendment_indexes(served_amendments)
        if served_amendments is not None and not amendments:
            # A null list is ordinary on an old report; a list that is there and holds
            # nothing readable is a change in what the Board serves, and reading it as
            # "no amendments" would silently pick the wrong version of a report.
            errors.append(
                f"{registration_number}'s {year} {raw.get('ReportType')} report serves "
                f"an amendment list this design cannot read: {served_amendments!r}"
            )
            continue
        reports.append(
            CatalogueReport(
                registration_number=registration_number,
                filing_year=year,
                report_type=(raw.get("ReportType") or "").strip(),
                report_name=(raw.get("ReportName") or "").strip(),
                cut_off_date=_timestamp_date(raw.get("CutOffDate")),
                special_election=str(raw.get("SpecialElectionindicator") or "") == "1",
                effective_amendment_index=max(amendments) if amendments else None,
                amendment_count=len(amendments) if amendments else None,
                termination_date=_timestamp_date(raw.get("TerminationDate")),
            )
        )
    return reports, errors


def _amendment_indexes(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    found: set[int] = set()
    for entry in value:
        index = _int_or_none(entry)
        if index is not None:
            found.add(index)
    return sorted(found)


def _int_or_none(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _timestamp_date(value: Any) -> Optional[date]:
    """``2026-07-20 00:00:00`` to a date. Null and empty both mean absent."""
    if not value:
        return None
    head = str(value).strip().split(" ")[0]
    try:
        return date.fromisoformat(head)
    except ValueError:
        return None


@dataclass
class DirectoryFiler:
    registration_number: str
    kind: FilerKind
    name: str
    candidate_name: Optional[str] = None
    party: Optional[str] = None
    office: Optional[str] = None
    district: Optional[str] = None
    registration_date: Optional[date] = None
    termination_date: Optional[date] = None
    is_incumbent: bool = False


def parse_directory_payload(
    payload: Any, kind: FilerKind
) -> tuple[list[DirectoryFiler], list[str]]:
    """Read one registered-filer list.

    **The 3 lists are not the same width, and the design's field list describes only
    the widest.** A candidate row carries 11 columns including party, office and
    district; a party-unit row and a committee-or-fund row carry 4 — name,
    registration number, registration date and termination date. So party, office
    and district are legitimately absent for two of the three kinds rather than
    missing, and nothing may treat their absence as a gap to fill.
    """
    errors: list[str] = []
    if not isinstance(payload, dict) or "cols" not in payload or "data" not in payload:
        errors.append(
            f"the {DIRECTORY_ACTION_BY_KIND[kind]} list did not return its usual shape "
            f"(got {type(payload).__name__}: {str(payload)[:80]!r}). Omitting "
            "data[params][0]=all returns the literal false, which lands here"
        )
        return [], errors
    columns = payload["cols"]
    if not isinstance(columns, list) or "RegisteredEntityID" not in columns:
        errors.append(
            f"the {DIRECTORY_ACTION_BY_KIND[kind]} list names no RegisteredEntityID "
            f"column (got {columns!r})"
        )
        return [], errors
    if not isinstance(payload["data"], dict):
        errors.append(
            f"the {DIRECTORY_ACTION_BY_KIND[kind]} list's data is "
            f"{type(payload['data']).__name__}, not an object keyed by registration"
        )
        return [], errors

    filers: list[DirectoryFiler] = []
    for group in payload["data"].values():
        if not isinstance(group, list):
            errors.append(
                f"a {DIRECTORY_ACTION_BY_KIND[kind]} group is "
                f"{type(group).__name__}, not a list of rows"
            )
            continue
        for raw in group:
            if not isinstance(raw, list) or len(raw) != len(columns):
                errors.append(
                    f"a {DIRECTORY_ACTION_BY_KIND[kind]} row has {len(raw)} values "
                    f"against {len(columns)} columns"
                )
                continue
            row = dict(zip(columns, raw))
            registration = (row.get("RegisteredEntityID") or "").strip()
            if not registration:
                errors.append(
                    f"a {DIRECTORY_ACTION_BY_KIND[kind]} row carries no registration "
                    "number"
                )
                continue
            filers.append(
                DirectoryFiler(
                    registration_number=registration,
                    kind=kind,
                    name=(row.get("RegisteredEntityFullName") or "").strip(),
                    candidate_name=(row.get("CandidateFullName") or "").strip() or None,
                    party=(row.get("Party") or "").strip() or None,
                    office=(row.get("OfficeSoughtFullName") or "").strip() or None,
                    district=(row.get("District") or "").strip() or None,
                    registration_date=_timestamp_date(row.get("RegistrationDate")),
                    termination_date=_timestamp_date(row.get("TerminationDate")),
                    is_incumbent=str(row.get("Incumbent") or "") == "1",
                )
            )
    return filers, errors


# --- Asking the Board ---------------------------------------------------------


@dataclass
class Response:
    """One request and the exact bytes that came back."""

    url: str
    form: dict[str, str]
    status_code: int
    body: bytes
    content_hash: str
    started_at: datetime
    completed_at: datetime

    def json(self) -> Any:
        try:
            return json.loads(self.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None


def http_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Cookie": SESSION_COOKIE})
    return session


def post_form(http: requests.Session, url: str, form: dict[str, str]) -> Response:
    """One form POST, retried on a server error, with its bytes kept.

    A 403 is **not** retried. It is what this route returns when the cookie is
    missing or wrongly named, and repeating the same request cannot fix that; a
    retry loop there would turn one clear failure into 3 slow ones.
    """
    started_at = datetime.now(UTC)
    last_error: Optional[Exception] = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = http.post(url, data=form, timeout=REQUEST_TIMEOUT_SECONDS)
        except requests.RequestException as error:
            last_error = error
            if attempt == MAX_ATTEMPTS:
                raise
            time.sleep(RETRY_PAUSE_SECONDS)
            continue
        if response.status_code >= 500 and attempt < MAX_ATTEMPTS:
            time.sleep(RETRY_PAUSE_SECONDS)
            continue
        body = response.content
        return Response(
            url=url,
            form=dict(form),
            status_code=response.status_code,
            body=body,
            content_hash=hashlib.sha256(body).hexdigest(),
            started_at=started_at,
            completed_at=datetime.now(UTC),
        )
    raise last_error or RuntimeError(f"{url} could not be reached")  # pragma: no cover


def directory_form(kind: FilerKind) -> dict[str, str]:
    return {
        "action": "grid_data",
        "data[action]": DIRECTORY_ACTION_BY_KIND[kind],
        "data[type]": "current-lists",
        # Omitting this returns the JSON literal `false` rather than an error, so it
        # is not optional and its absence is a silent failure (§9.7).
        "data[params][0]": "all",
    }


def viewer_form(
    registration_number: str, segment: tuple[int, int], tabname: str
) -> dict[str, str]:
    """The body for one viewer call.

    ``year`` is sent because the route expects the field, and it is set to the
    segment's end rather than to a year we want, because **the route ignores it**:
    the segment alone decides which 2 years come back. Sending a year that looked
    meaningful would invite the next reader to trust it.
    """
    start, end = segment
    return {
        "id": registration_number,
        "year": str(end),
        "year_data[ElectionSegmentStartDate]": str(start),
        "year_data[ElectionSegmentEndDate]": str(end),
        "tabname": tabname,
    }


def segment_for_year(year: int) -> tuple[int, int]:
    """The 2-year election segment a calendar year sits in.

    Minnesota's segments run from an even year to the odd year after it, so 2024 and
    2025 are one segment and 2026 and 2027 are the next.
    """
    start = year - (year % 2)
    return start, start + 1


def segments_for_years(years: Iterable[int]) -> list[tuple[int, int]]:
    return sorted({segment_for_year(year) for year in years})


def directory_url(base_url: str = BOARD_BASE_URL) -> str:
    return f"{base_url.rstrip('/')}{FILER_DIRECTORY_PATH}"


def viewer_url(kind: FilerKind, base_url: str = BOARD_BASE_URL) -> str:
    return f"{base_url.rstrip('/')}{VIEWER_PATH}".format(viewer=VIEWER_BY_KIND[kind])


def fetch_directory(
    http: requests.Session, kind: FilerKind, base_url: str = BOARD_BASE_URL
) -> tuple[Response, list[DirectoryFiler], list[str]]:
    response = post_form(http, directory_url(base_url), directory_form(kind))
    if response.status_code != 200:
        return (
            response,
            [],
            [
                f"the {DIRECTORY_ACTION_BY_KIND[kind]} list answered HTTP "
                f"{response.status_code}"
                + (
                    " — this route answers 403 when the PHPSESSID cookie is missing or "
                    "wrongly named"
                    if response.status_code == 403
                    else ""
                )
            ],
        )
    filers, errors = parse_directory_payload(response.json(), kind)
    return response, filers, errors


def fetch_catalogue(
    http: requests.Session,
    kind: FilerKind,
    registration_number: str,
    segment: tuple[int, int],
    base_url: str = BOARD_BASE_URL,
) -> tuple[Response, list[CatalogueReport], list[str]]:
    response = post_form(
        http,
        viewer_url(kind, base_url),
        viewer_form(registration_number, segment, "reports_data"),
    )
    if response.status_code != 200:
        return (
            response,
            [],
            [f"{registration_number}'s catalogue answered HTTP {response.status_code}"],
        )
    reports, errors = parse_catalogue_payload(response.json(), registration_number)
    return response, reports, errors


def fetch_figures(
    http: requests.Session,
    kind: FilerKind,
    registration_number: str,
    segment: tuple[int, int],
    base_url: str = BOARD_BASE_URL,
) -> tuple[Response, FinancialTab]:
    response = post_form(
        http,
        viewer_url(kind, base_url),
        viewer_form(registration_number, segment, "financial"),
    )
    if response.status_code != 200:
        tab = FinancialTab()
        tab.errors.append(
            f"{registration_number}'s figures answered HTTP {response.status_code}"
        )
        return response, tab
    return response, parse_financial_tab(response.json(), kind, list(segment))


# --- Keeping the bytes --------------------------------------------------------


class ResponseArchive:
    """Every response of one run, in one gzipped JSON Lines file.

    One object per run rather than one per response, because a run makes about
    4,800 requests and 4,800 tiny objects would cost more to store and to audit
    than the evidence is worth. Each line carries the response's own sha256 and its
    body base64-encoded, so a figure traces to a specific line and that line's bytes
    can be proved to be the ones the figure was read from.

    **Base64 rather than the decoded text**, for the same reason
    ``campaign_finance.py`` hashes response bytes and never decoded text: a
    truncated or mis-encoded response is exactly the evidence worth keeping, and
    decoding it before storing it would quietly repair it.
    """

    def __init__(self, path: str) -> None:
        self._path = path
        self._raw = open(path, "wb")
        # mtime=0 and filename="" for the same reason campaign_finance.py sets them:
        # without both, identical input compresses to different bytes each run, once
        # from the timestamp in the gzip header and once from the output file's own
        # basename, which would make the archive's hash depend on a temporary path.
        self._handle = gzip.GzipFile(filename="", mode="wb", mtime=0, fileobj=self._raw)
        self._lines = 0

    def write(self, kind: str, response: Response, **extra: Any) -> int:
        """Append one response and return its 1-based line number."""
        self._lines += 1
        record = {
            "line": self._lines,
            "what": kind,
            "url": response.url,
            "form": response.form,
            "status": response.status_code,
            "sha256": response.content_hash,
            "bytes": len(response.body),
            "started_at": response.started_at.isoformat(),
            "completed_at": response.completed_at.isoformat(),
            "body_base64": base64.b64encode(response.body).decode("ascii"),
            **extra,
        }
        self._handle.write(json.dumps(record, sort_keys=True).encode("utf-8") + b"\n")
        return self._lines

    def close(self) -> tuple[str, int, int]:
        """Finish the file and return its hash, its size and its line count."""
        self._handle.close()
        self._raw.close()
        return sha256_of_file(self._path), os.path.getsize(self._path), self._lines

    @property
    def path(self) -> str:
        return self._path

    @property
    def line_count(self) -> int:
        return self._lines


def archive_object_key(content_hash: str) -> str:
    return f"campaign-finance/filings/{content_hash}.jsonl.gz"


def read_archive_line(path: str, line_number: int) -> Optional[dict]:
    """One record back out of an archive, for tracing a published figure."""
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for index, line in enumerate(handle, start=1):
            if index == line_number:
                return json.loads(line)
    return None


# --- What the run collected ---------------------------------------------------


@dataclass
class Check:
    name: str
    status: str  # "passed" | "failed" | "not_run" | "overridden"
    detail: str

    @property
    def blocks_publication(self) -> bool:
        return self.status == "failed"

    def as_json(self) -> dict[str, str]:
        return {"name": self.name, "status": self.status, "detail": self.detail}


@dataclass
class ParsedFiling:
    """One filer-year of figures, ready to be written."""

    registration_number: str
    kind: FilerKind
    filing_year: int
    segment: tuple[int, int]
    block_heading: str
    reported_through: Optional[date]
    amounts: dict[str, Decimal]
    served_labels: dict[str, str]
    response_hash: str
    archive_line: int

    @property
    def reported_contributions(self) -> Decimal:
        """What this filer said it took in from contributors.

        Deliberately not total receipts: that also carries public subsidy money, loan
        income and miscellaneous income, none of which is a contribution and none of
        which appears in the itemized contributions download, so comparing our rows
        against it would understate our own coverage every time.
        """
        return sum(
            (
                self.amounts.get(key, Decimal("0"))
                for key in CONTRIBUTION_LINE_KEYS[self.kind]
            ),
            Decimal("0"),
        )


@dataclass
class FilingsRun:
    """Everything one run read, and what the checks made of it."""

    years: list[int]
    segments: list[tuple[int, int]]
    fetch_started_at: datetime
    fetch_completed_at: Optional[datetime] = None
    filers: list[DirectoryFiler] = field(default_factory=list)
    reports: list[CatalogueReport] = field(default_factory=list)
    filings: list[ParsedFiling] = field(default_factory=list)
    # Filer-years we asked for and the Board said it had nothing for. Kept as a list
    # rather than a count because a jump in it is how a changed route or a wrong
    # viewer would show, and an operator needs to see which filers.
    without_figures: list[tuple[str, int]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    requested_filers: int = 0
    record_set_hash: str = ""
    checks: list[Check] = field(default_factory=list)
    snapshot_id: Optional[uuid.UUID] = None
    unchanged: bool = False
    archive_key: Optional[str] = None
    archive_hash: Optional[str] = None
    archive_size: Optional[int] = None
    response_count: int = 0

    @property
    def blocked(self) -> list[Check]:
        return [check for check in self.checks if check.blocks_publication]

    @property
    def reported_contributions_sum(self) -> Decimal:
        return sum(
            (filing.reported_contributions for filing in self.filings), Decimal("0")
        )

    @property
    def figure_count(self) -> int:
        return sum(len(filing.amounts) for filing in self.filings)

    @property
    def missing_figure_share(self) -> float:
        asked = len(self.filings) + len(self.without_figures)
        if asked <= 0:
            return 0.0
        return len(self.without_figures) / asked

    def missing_figure_share_by_kind(self) -> dict[FilerKind, float]:
        """The share of asked-for filer-years with no figures, per filer kind.

        Counted only over the years actually asked for, matching ``without_figures``:
        one request returns both years of its segment, and the extra year it brings back
        was never requested, so counting it here would compare an asked-for denominator
        against a wider numerator.
        """
        kind_by_registration = {
            filer.registration_number: filer.kind for filer in self.filers
        }
        asked: dict[FilerKind, int] = {}
        empty: dict[FilerKind, int] = {}
        for filing in self.filings:
            if filing.filing_year not in self.years:
                continue
            asked[filing.kind] = asked.get(filing.kind, 0) + 1
        for registration, _ in self.without_figures:
            kind = kind_by_registration.get(registration)
            if kind is None:  # pragma: no cover - every target came from the directory
                continue
            asked[kind] = asked.get(kind, 0) + 1
            empty[kind] = empty.get(kind, 0) + 1
        return {
            kind: empty.get(kind, 0) / count for kind, count in asked.items() if count
        }

    def compute_record_set_hash(self) -> str:
        """A hash over the figures, sorted, so nothing about request order reaches it.

        The archive's own hash cannot do this job: response bodies carry timings and
        no ordering guarantee, so every run would look like new data and publish a
        new snapshot even when not one filer had moved.

        **A run whose responses could not be read gets no hash**, and the column is
        nullable for exactly that reason. Hashing it anyway would give every broken run
        the same value — the hash of no figures at all — so two unrelated failures would
        collide on one snapshot row and the second one's responses would never be kept.
        Losing the evidence of a failure is the one thing retention exists to prevent.
        """
        if self.errors:
            self.record_set_hash = ""
            return ""
        lines = sorted(
            f"{filing.registration_number}|{filing.filing_year}|{key}|{amount}"
            for filing in self.filings
            for key, amount in filing.amounts.items()
        )
        digest = hashlib.sha256()
        for line in lines:
            digest.update(line.encode("utf-8"))
            digest.update(b"\n")
        self.record_set_hash = digest.hexdigest()
        return self.record_set_hash

    def summary(self) -> str:
        parts = [
            f"  {len(self.filers):,} registered filers "
            f"({', '.join(f'{kind.value} {sum(1 for f in self.filers if f.kind is kind)}' for kind in FilerKind)})",
            f"  {len(self.filings):,} filer-years of figures, {self.figure_count:,} figures",
            f"  {len(self.reports):,} catalogued reports",
            f"  {len(self.without_figures):,} filer-years the Board had nothing for "
            f"({self.missing_figure_share:.2%})",
            f"  reported contributions total {self.reported_contributions_sum}",
            f"  records {self.record_set_hash or '(unhashed)'}",
        ]
        for check in self.checks:
            if check.status != "passed":
                parts.append(f"      {check.status}: {check.name} — {check.detail}")
        return "\n".join(parts)


# --- How much movement is too much -------------------------------------------
#
# These bands are a guess and are stated as one, exactly as the download loader's
# are. What is measured is one day: 778 candidates, 299 party units and 526
# committees and funds on 12 August 2026, against 777, 299 and 526 on 11 August.
# They tighten once there are a few weeks of real deltas.


@dataclass(frozen=True)
class Band:
    shrink: float
    growth: float

    def contains(self, candidate: float, baseline: float) -> bool:
        if baseline <= 0:
            return True
        change = (candidate - baseline) / baseline
        return -self.shrink <= change <= self.growth


# Asymmetric on purpose. A registered-filer list *grows* through an election year as
# candidates register, and there is no honest ceiling on that; a list that shrinks is
# the truncation this check exists to catch.
FILER_COUNT_BAND = Band(shrink=0.02, growth=0.50)
FILING_COUNT_BAND = Band(shrink=0.02, growth=0.50)
# Money in a closed year does not move much and money in the current year only rises,
# so a fall is the signal. Wider on growth than the download loader's 10% because a
# single quarter's reports landing across 1,600 filers is a real step.
REPORTED_SUM_BAND = Band(shrink=0.01, growth=0.40)
# How far the share of filer-years with no figures may move between runs.
MISSING_FIGURE_SHARE_TOLERANCE = 0.05
# The ceiling one filer *kind* may never pass, whatever the previous run said, and the
# only thing standing between us and the failure that looks most like real data:
# **asking the wrong viewer for a filer's kind returns 200 with no table**, so a route
# change that broke the kind-to-viewer mapping would read as "no filer of that kind
# reported anything" rather than as an error.
#
# Per kind rather than across the run, for two measured reasons. Empty answers are
# ordinary and their share is nowhere near uniform — measured across all 1,603
# registered filers on 12 August 2026, the share with no figures runs 1.0% for party
# units, 7.0% to 23.0% for committees and funds, and 32.5% to 46.3% for candidate
# committees, which is 21.7% across a default 2-year run. So a ceiling low enough to be
# meaningful for party units would quarantine every honest run, and one high enough for
# candidates could hide a whole kind going dark behind two healthy ones. 75% sits above
# the worst kind ever measured and far below the 100% a broken viewer produces.
MAX_MISSING_FIGURE_SHARE_PER_KIND = 0.75


# The standing test filer-years §9.3 requires: a fixed set that must still return the
# figures recorded in the design, which is what detects a silently changed amendment
# resolution rule. All 4 verified live on 12 August 2026.
#
# **These are a canary, not a fixture.** A filer really can amend a closed year, and
# then this check fails, an operator reads why, confirms the amendment against the
# Board's own documents, and publishes by naming the record hash — and updates the
# figure here in the same change. That cost is the point: an amendment we cannot see
# and a route that quietly stopped resolving amendments look identical from here, and
# only a person can tell them apart.
STANDING_TEST_FIGURES: tuple[tuple[FilerKind, str, int, str, Decimal], ...] = (
    # A plain candidate committee, and the extreme case behind §7's two-number rule:
    # one $1,000 named payment against this whole reported total.
    (
        FilerKind.candidate_committee,
        "11880",
        2025,
        "total_receipts",
        Decimal("13900.48"),
    ),
    # §9.6's first amendment case. Amendment #2 states this; the original and
    # amendment #1 state $646,371.22, so a route that stopped preferring the highest
    # version would return the older figure here.
    (
        FilerKind.party_unit,
        "20008",
        2025,
        "general_expenditures",
        Decimal("647671.22"),
    ),
    (
        FilerKind.party_unit,
        "20008",
        2025,
        "contributions_received",
        Decimal("748643.94"),
    ),
    # §9.6's second amendment case. Amendments #1 to #3 state $2,600.00 itemized plus
    # $2,269.59 non-itemized; the original states $2,194.59 non-itemized.
    (
        FilerKind.candidate_committee,
        "15667",
        2024,
        "individuals_contributions",
        Decimal("4869.59"),
    ),
    # The special-election gap itself. This filer's true 2024 receipts across both
    # report series are $283,287.13 and the route returns the regular series alone, so
    # if this figure ever rises the route has started covering both series and §9.5's
    # whole exclusion needs revisiting.
    (
        FilerKind.candidate_committee,
        "18453",
        2024,
        "total_receipts",
        Decimal("317.20"),
    ),
)


# --- Checking it before anything is published ---------------------------------


def validate_filings(
    run: FilingsRun,
    baseline: Optional[Any],
    baseline_filer_years: Optional[set[tuple[str, int]]],
    *,
    operator_approved: bool,
) -> list[Check]:
    """Compare a run against the published snapshot, and refuse what cannot be read.

    ``operator_approved`` waives the comparison checks only, for an operator who has
    named the exact record hash they reviewed. It never waives a structural one: a
    response that did not parse, a label nobody knows, a value that is not money, and
    a share of empty answers above the ceiling are not judgement calls, and no flag
    lets one through.
    """
    checks: list[Check] = []

    def add(name: str, ok: bool, detail: str, *, comparison: bool = False) -> None:
        if ok:
            checks.append(Check(name, "passed", detail))
        elif comparison and operator_approved:
            checks.append(
                Check(
                    name,
                    "overridden",
                    f"{detail} — waived by an operator who named this record hash",
                )
            )
        else:
            checks.append(Check(name, "failed", detail))

    by_kind = {
        kind: sum(1 for filer in run.filers if filer.kind is kind) for kind in FilerKind
    }
    add(
        "every_registered_filer_list_was_read",
        all(count > 0 for count in by_kind.values()),
        ", ".join(f"{kind.value} {count}" for kind, count in by_kind.items())
        + ". An empty list is how this route answers a request missing "
        "data[params][0]=all, which returns the literal false",
    )
    add(
        "every_response_was_read",
        not run.errors,
        "; ".join(run.errors[:MAX_REPORTED_ERRORS])
        or f"{run.response_count:,} responses, every label known and every value typed",
    )
    per_kind = run.missing_figure_share_by_kind()
    over = [
        f"{kind.value} {share:.1%}"
        for kind, share in sorted(per_kind.items(), key=lambda item: item[0].value)
        if share > MAX_MISSING_FIGURE_SHARE_PER_KIND
    ]
    add(
        "no_filer_kind_came_back_mostly_empty",
        not over,
        (
            "above the "
            f"{MAX_MISSING_FIGURE_SHARE_PER_KIND:.0%} ceiling: {', '.join(over)}. "
            "Asking the wrong viewer for a filer's kind returns exactly this empty "
            "answer at HTTP 200, so a broken kind mapping reads as nobody of that kind "
            "having reported anything"
            if over
            else ", ".join(
                f"{kind.value} {share:.1%} empty"
                for kind, share in sorted(
                    per_kind.items(), key=lambda item: item[0].value
                )
            )
            or "no filers were asked about"
        ),
    )
    # Only the pinned filers this run actually asked about. A run narrowed with
    # --only-filers must not fail because it did not fetch a filer it was told to
    # leave out, and a full run asks about every filer in the directory so nothing is
    # skipped there. Skipped rather than passed, and counted in the detail, so a
    # narrowed run cannot read as having checked them.
    asked = {filing.registration_number for filing in run.filings} | {
        registration for registration, _ in run.without_figures
    }
    covered_years = {year for segment in run.segments for year in segment}
    applicable = [
        pinned
        for pinned in STANDING_TEST_FIGURES
        if pinned[1] in asked and pinned[2] in covered_years
    ]
    mismatched = [
        f"{registration} {year} {key} is {found} and should be {expected}"
        for _, registration, year, key, expected in applicable
        for found in [_figure_in_run(run, registration, year, key)]
        if found != expected
    ]
    skipped = len(STANDING_TEST_FIGURES) - len(applicable)
    add(
        "standing_test_filer_years_still_match",
        not mismatched,
        "; ".join(mismatched[:MAX_REPORTED_ERRORS])
        + (
            ". Either a filer amended a closed year, which is ordinary and wants the "
            "figure updated in STANDING_TEST_FIGURES, or the route stopped resolving "
            "amendments the way it did, which is not. Read the Board's own documents "
            "before waiving this"
            if mismatched
            else f"{len(applicable)} pinned figures unchanged"
            + (
                f", {skipped} not asked about by this run"
                if skipped
                else ", including both amendment-resolution cases"
            )
        ),
        comparison=True,
    )

    add(
        "previous_snapshot_to_compare_against",
        baseline is not None,
        "no filings snapshot is published yet, so there is nothing to compare "
        "against. Review the counts and publish by naming the record hash",
        comparison=True,
    )
    if baseline is None:
        return checks

    add(
        "filer_count_within_band",
        FILER_COUNT_BAND.contains(len(run.filers), baseline.filer_count or 0),
        f"{len(run.filers):,} registered filers against {baseline.filer_count:,} "
        "published",
        comparison=True,
    )
    add(
        "filing_count_within_band",
        FILING_COUNT_BAND.contains(len(run.filings), baseline.filing_count or 0),
        f"{len(run.filings):,} filer-years against {baseline.filing_count:,} published",
        comparison=True,
    )
    add(
        "reported_contributions_within_band",
        REPORTED_SUM_BAND.contains(
            float(run.reported_contributions_sum),
            float(baseline.reported_contributions_sum or 0),
        ),
        f"{run.reported_contributions_sum} against "
        f"{baseline.reported_contributions_sum} published",
        comparison=True,
    )
    was = baseline.filer_years_without_figures
    if was is not None and (baseline.filing_count or 0) + was > 0:
        published_share = was / ((baseline.filing_count or 0) + was)
        add(
            "filer_years_without_figures_share_steady",
            abs(run.missing_figure_share - published_share)
            <= MISSING_FIGURE_SHARE_TOLERANCE,
            f"{run.missing_figure_share:.2%} of filer-years came back empty against "
            f"{published_share:.2%} published",
            comparison=True,
        )
    if baseline_filer_years is not None:
        now = {
            (filing.registration_number, filing.filing_year) for filing in run.filings
        }
        lost = sorted(baseline_filer_years - now)
        add(
            "no_published_filer_year_lost_its_figures",
            not lost,
            (
                f"{len(lost)} filer-year(s) had figures and now have none: "
                + ", ".join(f"{registration} {year}" for registration, year in lost[:6])
            )
            if lost
            else f"all {len(baseline_filer_years):,} published filer-years still "
            "carry figures",
            comparison=True,
        )
    return checks


def _figure_in_run(
    run: FilingsRun, registration_number: str, year: int, line_key: str
) -> Optional[Decimal]:
    for filing in run.filings:
        if (
            filing.registration_number == registration_number
            and filing.filing_year == year
        ):
            return filing.amounts.get(line_key)
    return None


# --- What the download loader's checks read -----------------------------------


@dataclass(frozen=True)
class FilingsContext:
    """The published filings, in the shape the download loader's 2 checks need.

    Read once per run rather than queried per filer, because both checks sweep every
    filer-year at once and neither has any use for a single one.
    """

    snapshot_id: uuid.UUID
    fetch_completed_at: datetime
    years: tuple[int, ...]
    known_registrations: frozenset[str]
    reported_contributions: dict[tuple[str, int], Decimal]
    reported_through: dict[tuple[str, int], date]
    # Filer-years the totals route cannot speak for, because the filer also filed a
    # special-election series that the route does not return. Excluded from the
    # reconciliation rather than failed by it: §9.5 measured the cause and §7 says
    # those years read "Not reported" until both series are assembled.
    special_election_filer_years: frozenset[tuple[str, int]]

    def contribution_cutoffs(self) -> dict[tuple[str, int], date]:
        """The date each filer-year's reported figure runs to, for filer-years we can
        compare at all."""
        return {
            filer_year: through
            for filer_year, through in self.reported_through.items()
            if filer_year not in self.special_election_filer_years
        }


def filings_context(db: Session) -> Optional[FilingsContext]:
    """Read the live filings snapshot, or None when none is published."""
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return None
    registrations = frozenset(
        db.scalars(
            select(schema.CampaignFinanceFiler.registration_number).where(
                schema.CampaignFinanceFiler.snapshot_id == snapshot.id
            )
        ).all()
    )
    special = frozenset(
        (registration, year)
        for registration, year in db.execute(
            select(
                schema.CampaignFinanceFilingReport.registration_number,
                schema.CampaignFinanceFilingReport.filing_year,
            )
            .where(
                schema.CampaignFinanceFilingReport.snapshot_id == snapshot.id,
                schema.CampaignFinanceFilingReport.special_election.is_(True),
            )
            .distinct()
        ).all()
    )
    contributions: dict[tuple[str, int], Decimal] = {}
    through: dict[tuple[str, int], date] = {}
    rows = db.execute(
        select(
            schema.CampaignFinanceFiling.registration_number,
            schema.CampaignFinanceFiling.filing_year,
            schema.CampaignFinanceFiling.filer_kind,
            schema.CampaignFinanceFiling.reported_through,
            schema.CampaignFinanceFilingFigure.line_key,
            schema.CampaignFinanceFilingFigure.amount,
        )
        .join(
            schema.CampaignFinanceFilingFigure,
            schema.CampaignFinanceFilingFigure.filing_id
            == schema.CampaignFinanceFiling.id,
        )
        .where(schema.CampaignFinanceFiling.snapshot_id == snapshot.id)
    ).all()
    for registration, year, kind, reported_through, line_key, amount in rows:
        filer_year = (registration, year)
        if reported_through is not None:
            through[filer_year] = reported_through
        if line_key in CONTRIBUTION_LINE_KEYS[kind]:
            contributions[filer_year] = (
                contributions.get(filer_year, Decimal("0")) + amount
            )
    return FilingsContext(
        snapshot_id=snapshot.id,
        fetch_completed_at=snapshot.fetch_completed_at,
        years=tuple(snapshot.years or ()),
        known_registrations=registrations,
        reported_contributions=contributions,
        reported_through=through,
        special_election_filer_years=special,
    )


# --- Writing it ---------------------------------------------------------------

# One key for the whole publish, so two overlapping runs queue instead of colliding.
# A different number from the download loader's, so a filings publish and a download
# publish do not block each other; they touch different tables and neither reads the
# other's rows inside its own transaction.
PUBLISH_LOCK_KEY = 610312263011
# How many superseded snapshots keep their rows. One, for exactly the reason the
# download loader keeps one: a request that resolved the previous snapshot a moment
# before a publish still finds its rows instead of an empty page, and a page renders
# an empty page as "this committee reported nothing".
KEEP_SUPERSEDED_GENERATIONS = 1


def live_filings_snapshot(db: Session) -> Optional[Any]:
    """Which filings snapshot is live, read from the database rather than from memory.

    ``populate_existing=True`` for the same reason the download loader needs it:
    publishing moves the pointer with a statement rather than through the object, and
    this repo's session factory sets ``expire_on_commit=False``, so a caller still
    holding the pointer object would get the value it had *before* the publish — and
    pruning on a stale pointer deletes the rows of the snapshot just published.
    """
    pointer = db.get(
        schema.CampaignFinanceFilingCurrentSnapshot, True, populate_existing=True
    )
    if pointer is None or pointer.snapshot_id is None:
        return None
    return db.get(
        schema.CampaignFinanceFilingSnapshot,
        pointer.snapshot_id,
        populate_existing=True,
    )


def ensure_filings_pointer_row(db: Session) -> None:
    """``SELECT ... FOR UPDATE`` locks nothing when there is no row, so the very first
    two concurrent runs would not see each other without this."""
    db.execute(
        text(
            "INSERT INTO cf_filing_current (id, snapshot_id) VALUES (true, NULL) "
            "ON CONFLICT (id) DO NOTHING"
        )
    )
    db.commit()


def published_filer_years(db: Session, snapshot_id: uuid.UUID) -> set[tuple[str, int]]:
    return {
        (registration, year)
        for registration, year in db.execute(
            select(
                schema.CampaignFinanceFiling.registration_number,
                schema.CampaignFinanceFiling.filing_year,
            ).where(schema.CampaignFinanceFiling.snapshot_id == snapshot_id)
        ).all()
    }


def find_filings_snapshot(db: Session, record_set_hash: str) -> Optional[Any]:
    if not record_set_hash:
        return None
    return db.scalars(
        select(schema.CampaignFinanceFilingSnapshot).where(
            schema.CampaignFinanceFilingSnapshot.record_set_hash == record_set_hash
        )
    ).one_or_none()


def record_filings_fetch(
    db: Session,
    run: FilingsRun,
    store: Any,
    archive_path: str,
    ingestion_run_id: Optional[uuid.UUID],
) -> tuple[uuid.UUID, bool]:
    """Store the archive and record the run, then commit — before any validation.

    Its own transaction for the same reason the download loader's is: a failure record
    written inside the transaction that later fails rolls back with it, which quietly
    turns "the bad run is on the record" into "the bad run never happened". A run whose
    responses could not be read is stored and recorded here too.
    """
    # A run with no hash could not be read, so it is never matched against an earlier
    # one: it gets its own snapshot row and its own retained archive.
    existing = find_filings_snapshot(db, run.record_set_hash)
    if existing is not None:
        # This run's archive is NOT uploaded, because one body is kept per distinct set
        # of figures rather than per run. So the run must stop describing its own
        # archive: the line numbers it collected belong to a file nobody kept, and
        # writing them would point every published figure at the wrong response in the
        # archive that *was* kept. The caller rebuilds from the retained one.
        run.archive_key = existing.object_key
        run.archive_hash = existing.compressed_hash
        run.archive_size = existing.compressed_byte_size
        run.response_count = existing.response_count or 0
        return existing.id, True
    key = archive_object_key(run.archive_hash or "")
    store.put_and_verify(key, archive_path, run.archive_hash)
    run.archive_key = key
    snapshot = schema.CampaignFinanceFilingSnapshot(
        fetch_started_at=run.fetch_started_at,
        fetch_completed_at=run.fetch_completed_at or datetime.now(UTC),
        status=SnapshotStatus.quarantined if run.errors else SnapshotStatus.fetched,
        record_set_hash=run.record_set_hash or None,
        years=list(run.years),
        segments=[list(segment) for segment in run.segments],
        filer_count=len(run.filers),
        report_count=len(run.reports),
        filing_count=len(run.filings),
        figure_count=run.figure_count,
        filer_years_without_figures=len(run.without_figures),
        reported_contributions_sum=run.reported_contributions_sum,
        measurements=_measurements_json(run),
        validation_json={},
        error_text="; ".join(run.errors[:MAX_REPORTED_ERRORS]) or None,
        ingestion_run_id=ingestion_run_id,
        object_key=key,
        compressed_hash=run.archive_hash,
        compressed_byte_size=run.archive_size,
        compression="gzip",
        response_count=run.response_count,
    )
    db.add(snapshot)
    try:
        db.commit()
    except IntegrityError:
        # Two runs can reach here with the same figures and both find nothing. The
        # unique index on the record hash decides, so the loser re-reads rather than
        # dying with a traceback.
        db.rollback()
        existing = find_filings_snapshot(db, run.record_set_hash)
        if existing is None:  # pragma: no cover - the index is what conflicted
            raise
        return existing.id, True
    return snapshot.id, False


def rebuild_run_from_retained_archive(
    db: Session, run: FilingsRun, snapshot: Any, store: Any, directory: str
) -> None:
    """Replace what this run collected with what the kept archive holds, and prove it.

    Needed whenever the figures were already on file, which is the **ordinary** path
    rather than an edge case: a first import quarantines for want of anything to compare
    against, and the operator's second run to publish it takes exactly this branch.

    The reason it cannot be skipped is the same one ``campaign_finance.py`` gives for
    rebuilding a pruned set's rows from its retained body: ``cf_filing.archive_line``
    points at a line of the archive we kept, and this run's own responses were numbered
    against an archive nobody kept. Two runs happen to make the same requests in the
    same order today; a run narrowed with ``--only-filers``, or one where a filer came
    back empty this time and not last time, numbers them differently, and then every
    published figure cites the wrong response.

    The rebuilt figures are hashed and checked against the hash recorded on the
    snapshot, which makes this a full integrity check of the stored object rather than a
    formality: if the archive has been altered or truncated, this is where it stops.
    """
    if not snapshot.object_key:
        raise CampaignFinanceFilingsRefusal(
            f"filings snapshot {snapshot.id} holds these figures but kept no archive, "
            "so a published figure could not be traced to the response it came from."
        )
    compressed_path = os.path.join(directory, "retained.jsonl.gz")
    filers: list[DirectoryFiler] = []
    reports: list[CatalogueReport] = []
    rebuilt: list[ParsedFiling] = []
    errors: list[str] = []
    # Reading the object is itself a check on it. A truncated or damaged archive fails
    # inside gzip or inside json, and letting either escape as a stdlib error would hand
    # an operator a stack trace instead of the name of the object that is broken.
    try:
        store.get(snapshot.object_key, compressed_path)
        with gzip.open(compressed_path, "rt", encoding="utf-8") as handle:
            records = [json.loads(line) for line in handle if line.strip()]
    except Exception as error:
        raise CampaignFinanceFilingsRefusal(
            f"the kept archive {snapshot.object_key} for filings snapshot "
            f"{snapshot.id} could not be read back, so no figure in it can be traced "
            f"to a response: {type(error).__name__}: {error}. The archive is the only "
            "record of what the Board served on that date, so investigate the store "
            "rather than re-running over it"
        ) from error

    for record in records:
        what = record.get("what") or ""
        if not what.startswith("directory:"):
            continue
        kind = FilerKind(what.split(":", 1)[1])
        payload = _payload_of(record)
        found, problems = parse_directory_payload(payload, kind)
        filers.extend(found)
        errors.extend(problems)
    kind_by_registration = {filer.registration_number: filer.kind for filer in filers}

    for record in records:
        what = record.get("what") or ""
        registration = record.get("registration") or record.get("form", {}).get(
            "id", ""
        )
        kind = kind_by_registration.get(registration)
        if kind is None:
            if what in ("catalogue", "figures"):
                errors.append(
                    f"the kept archive holds a {what} response for {registration!r}, "
                    "which its own directory lists do not name"
                )
            continue
        payload = _payload_of(record)
        if what == "catalogue":
            found_reports, problems = parse_catalogue_payload(payload, registration)
            reports.extend(found_reports)
            errors.extend(problems)
            continue
        if what != "figures":
            continue
        segment = tuple(record.get("segment") or ())
        if len(segment) != 2:
            errors.append(
                f"the kept archive's figures response for {registration} names no "
                "2-year segment, so its years cannot be checked against the request"
            )
            continue
        tab = parse_financial_tab(payload, kind, list(segment))
        errors.extend(f"{registration}: {problem}" for problem in tab.errors)
        for year, block in sorted(tab.years.items()):
            rebuilt.append(
                ParsedFiling(
                    registration_number=registration,
                    kind=kind,
                    filing_year=year,
                    segment=(int(segment[0]), int(segment[1])),
                    block_heading=block.heading,
                    reported_through=block.reported_through,
                    amounts=block.amounts,
                    served_labels=block.served_labels,
                    response_hash=record["sha256"],
                    # The archive's own line number, which is the whole point.
                    archive_line=int(record["line"]),
                )
            )

    was = run.record_set_hash
    run.filers = filers
    run.reports = reports
    run.filings = rebuilt
    run.errors = errors
    run.compute_record_set_hash()
    if errors or run.record_set_hash != snapshot.record_set_hash:
        raise CampaignFinanceFilingsRefusal(
            f"the kept archive {snapshot.object_key} no longer reproduces the figures "
            f"recorded against filings snapshot {snapshot.id}. Refusing to publish "
            "figures we cannot trace: "
            + ("; ".join(errors[:MAX_REPORTED_ERRORS]) or f"hash was {was}")
        )


def _payload_of(record: dict) -> Any:
    """One archived response's body, back as the object it was."""
    try:
        return json.loads(base64.b64decode(record["body_base64"]).decode("utf-8"))
    except (KeyError, ValueError, UnicodeDecodeError):
        return None


def _measurements_json(run: FilingsRun) -> dict:
    return {
        "requested_filers": run.requested_filers,
        "filers_by_kind": {
            kind.value: sum(1 for filer in run.filers if filer.kind is kind)
            for kind in FilerKind
        },
        "filings_by_year": {
            str(year): sum(1 for filing in run.filings if filing.filing_year == year)
            for year in sorted({filing.filing_year for filing in run.filings})
        },
        "missing_figure_share": round(run.missing_figure_share, 6),
        "filer_years_without_figures": [
            f"{registration}:{year}" for registration, year in run.without_figures[:200]
        ],
        "errors": run.errors[:50],
    }


def publish_filings(
    db: Session,
    run: FilingsRun,
    *,
    ingestion_run_id: Optional[uuid.UUID],
    notes: Optional[str],
    approved_hash: Optional[str] = None,
) -> uuid.UUID:
    """Write the rows and move the live pointer, in one transaction.

    The pointer is taken with ``FOR UPDATE``, the live snapshot re-read inside the
    lock, a candidate whose fetch window opened before it refused, **and the comparison
    checks re-run against what is live now** — because being newer is not the same as
    having been compared. Without the re-run, two overlapping runs each compare against
    the same older snapshot and the second publishes numbers that were never measured
    against anything that was ever live.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": PUBLISH_LOCK_KEY})
    pointer = db.execute(
        text("SELECT snapshot_id FROM cf_filing_current WHERE id = true FOR UPDATE")
    ).one_or_none()
    current_id = pointer[0] if pointer is not None else None
    current = (
        db.get(schema.CampaignFinanceFilingSnapshot, current_id, populate_existing=True)
        if current_id
        else None
    )
    if current is not None and current.fetch_started_at > run.fetch_started_at:
        raise CampaignFinanceFilingsRefusal(
            "Refusing to publish: the live filings snapshot was fetched starting "
            f"{current.fetch_started_at.isoformat()}, after this run started "
            f"{run.fetch_started_at.isoformat()}. Replacing newer figures with older "
            "ones is the one thing the pointer row exists to prevent."
        )
    rechecked = validate_filings(
        run,
        current,
        published_filer_years(db, current.id) if current is not None else None,
        operator_approved=bool(
            run.record_set_hash and run.record_set_hash == (approved_hash or "")
        ),
    )
    failed = [check for check in rechecked if check.blocks_publication]
    if failed:
        raise CampaignFinanceFilingsRefusal(
            "Refusing to publish: this run passed its checks against the snapshot that "
            "was live when it started and fails them against the one that is live now, "
            "so another run published in between. "
            + "; ".join(f"{check.name}: {check.detail}" for check in failed)
            + ". Re-run to compare against what is actually published."
        )
    run.checks = rechecked

    snapshot = db.get(schema.CampaignFinanceFilingSnapshot, run.snapshot_id)
    if snapshot is None:  # pragma: no cover - written moments ago
        raise CampaignFinanceFilingsRefusal(
            "the filings snapshot vanished before publish"
        )
    if snapshot.record_set_hash != run.record_set_hash:  # pragma: no cover
        raise CampaignFinanceFilingsRefusal(
            f"filings snapshot {snapshot.id} no longer holds the figures this run "
            "validated"
        )

    # Rewritten rather than assumed absent: a snapshot whose rows were pruned and is
    # being published again reaches here with a `loaded` status and no rows.
    for table in (
        schema.CampaignFinanceFilingFigure,
        schema.CampaignFinanceFiling,
        schema.CampaignFinanceFilingReport,
        schema.CampaignFinanceFiler,
    ):
        if table is schema.CampaignFinanceFilingFigure:
            db.execute(
                delete(table).where(
                    table.filing_id.in_(
                        select(schema.CampaignFinanceFiling.id).where(
                            schema.CampaignFinanceFiling.snapshot_id == snapshot.id
                        )
                    )
                )
            )
        else:
            db.execute(delete(table).where(table.snapshot_id == snapshot.id))

    for filer in run.filers:
        db.add(
            schema.CampaignFinanceFiler(
                snapshot_id=snapshot.id,
                registration_number=filer.registration_number,
                kind=filer.kind,
                name=filer.name,
                candidate_name=filer.candidate_name,
                party=filer.party,
                office=filer.office,
                district=filer.district,
                registration_date=filer.registration_date,
                termination_date=filer.termination_date,
                is_incumbent=filer.is_incumbent,
            )
        )
    for row_number, report in enumerate(run.reports, start=1):
        db.add(
            schema.CampaignFinanceFilingReport(
                snapshot_id=snapshot.id,
                row_number=row_number,
                registration_number=report.registration_number,
                filing_year=report.filing_year,
                report_type=report.report_type,
                report_name=report.report_name,
                cut_off_date=report.cut_off_date,
                special_election=report.special_election,
                effective_amendment_index=report.effective_amendment_index,
                amendment_count=report.amendment_count,
            )
        )
    for filing in run.filings:
        row = schema.CampaignFinanceFiling(
            snapshot_id=snapshot.id,
            registration_number=filing.registration_number,
            filer_kind=filing.kind,
            filing_year=filing.filing_year,
            segment_start=filing.segment[0],
            segment_end=filing.segment[1],
            block_heading=filing.block_heading,
            reported_through=filing.reported_through,
            response_hash=filing.response_hash,
            archive_line=filing.archive_line,
        )
        db.add(row)
        db.flush()
        for line_key, amount in filing.amounts.items():
            db.add(
                schema.CampaignFinanceFilingFigure(
                    filing_id=row.id,
                    line_key=line_key,
                    label_as_served=filing.served_labels.get(line_key, ""),
                    amount=amount,
                )
            )

    snapshot.status = SnapshotStatus.loaded
    snapshot.validation_json = {"checks": [check.as_json() for check in run.checks]}
    snapshot.error_text = None
    if notes:
        snapshot.measurements = {**(snapshot.measurements or {}), "notes": notes}
    # The snapshot this one replaces keeps its `loaded` status and its rows until
    # `prune_filings` takes them, so the pointer alone says which set is live. There is
    # deliberately no "superseded" status here: a status saying loaded with no rows is
    # the one state that would be reused as "unchanged" and publish nothing.
    db.execute(
        text("UPDATE cf_filing_current SET snapshot_id = :snapshot WHERE id = true"),
        {"snapshot": snapshot.id},
    )
    db.commit()
    return snapshot.id


def prune_filings(db: Session) -> tuple[int, int]:
    """Delete the rows of every filings snapshot the live pointer does not name.

    Takes the same lock ``publish_filings`` takes, which is what makes it safe outside
    the publish transaction: without it, this transaction can read the pointer, build
    its keep-list, and then have a newer snapshot commit in the gap — and the newer
    snapshot is absent from the list already built, so this would delete the rows of
    the set that is live.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": PUBLISH_LOCK_KEY})
    live = live_filings_snapshot(db)
    # Newest first by the data's own recency rather than by when the row was written,
    # so a run that fetched older figures and published later cannot displace a newer
    # set from the one spare generation.
    loaded = db.scalars(
        select(schema.CampaignFinanceFilingSnapshot)
        .where(schema.CampaignFinanceFilingSnapshot.status == SnapshotStatus.loaded)
        .order_by(schema.CampaignFinanceFilingSnapshot.fetch_completed_at.desc())
    ).all()
    stale: list[Any] = []
    spared = 0
    for snapshot in loaded:
        if live is not None and snapshot.id == live.id:
            continue
        if spared < KEEP_SUPERSEDED_GENERATIONS:
            spared += 1
            continue
        stale.append(snapshot)

    snapshots = 0
    rows = 0
    for snapshot in stale:
        rows += (
            db.execute(
                delete(schema.CampaignFinanceFilingFigure).where(
                    schema.CampaignFinanceFilingFigure.filing_id.in_(
                        select(schema.CampaignFinanceFiling.id).where(
                            schema.CampaignFinanceFiling.snapshot_id == snapshot.id
                        )
                    )
                )
            ).rowcount
            or 0
        )
        for table in (
            schema.CampaignFinanceFiling,
            schema.CampaignFinanceFilingReport,
            schema.CampaignFinanceFiler,
        ):
            rows += (
                db.execute(
                    delete(table).where(table.snapshot_id == snapshot.id)
                ).rowcount
                or 0
            )
        # The status change and the delete share a transaction on purpose: a snapshot
        # left saying `loaded` with no rows would be reused as "unchanged" the next
        # time the Board serves those exact figures, and would publish nothing.
        snapshot.status = SnapshotStatus.pruned
        snapshots += 1
    db.commit()
    return snapshots, rows


def quarantine_filings(db: Session, run: FilingsRun) -> None:
    snapshot = db.get(schema.CampaignFinanceFilingSnapshot, run.snapshot_id)
    if snapshot is None:  # pragma: no cover
        return
    if snapshot.status != SnapshotStatus.loaded:
        snapshot.status = SnapshotStatus.quarantined
    snapshot.validation_json = {"checks": [check.as_json() for check in run.checks]}
    snapshot.error_text = (
        "; ".join(check.detail for check in run.blocked)[:4000] or None
    )
    db.commit()


# --- The whole cycle ----------------------------------------------------------


def default_years(today: date) -> list[int]:
    """The years a page shows: this calendar year and the one before it.

    Both, not just this one, because in an election year a member not on the ballot
    files nothing covering the current year until the following February, so the
    previous year is the only one with a complete figure for them (§7).
    """
    return [today.year - 1, today.year]


def load_campaign_finance_filings(
    db: Session,
    *,
    http: Optional[requests.Session] = None,
    store: Any = None,
    dry_run: bool = False,
    years: Optional[Sequence[int]] = None,
    only_filers: Optional[Sequence[str]] = None,
    publish_hash: Optional[str] = None,
    base_url: str = BOARD_BASE_URL,
    spacing_seconds: float = REQUEST_SPACING_SECONDS,
    today: Optional[date] = None,
    log=print,
) -> FilingsRun:
    """Run the whole cycle once and report what happened.

    ``publish_hash`` is how an operator publishes a run the comparison checks
    quarantined, including the very first one, which has nothing to compare against.
    The record hash rather than the archive's hash, because the archive's bytes carry
    request timings and change every run while the figures do not.

    ``only_filers`` narrows the run to named registration numbers, which is what makes
    a scoped live check possible: the full run is about 4,800 requests and 48 minutes,
    and a single filer is 3 requests.
    """
    http = http or http_session()
    years = sorted(
        {int(year) for year in (years or default_years(today or date.today()))}
    )
    segments = segments_for_years(years)
    run = FilingsRun(
        years=list(years), segments=segments, fetch_started_at=datetime.now(UTC)
    )

    with tempfile.TemporaryDirectory(prefix="alethical-cf-filings-") as directory:
        archive = ResponseArchive(os.path.join(directory, "responses.jsonl.gz"))

        ingestion_run_id = None
        if not dry_run:
            ensure_filings_pointer_row(db)
            ingestion = schema.IngestionRun(
                adapter="minnesota_campaign_finance_filings",
                target_type="campaign_finance_filing_snapshot",
                status=schema.IngestionStatus.running,
                stats={},
            )
            db.add(ingestion)
            db.commit()
            ingestion_run_id = ingestion.id
            store = store or _store_from_env()

        wanted = {str(number).strip() for number in (only_filers or ())}
        for kind in FilerKind:
            response, filers, errors = fetch_directory(http, kind, base_url)
            archive.write(f"directory:{kind.value}", response)
            run.errors.extend(errors)
            run.filers.extend(filers)
            log(
                f"{kind.value}: {len(filers):,} registered filers"
                + (f", {len(errors)} error(s)" if errors else "")
            )
            time.sleep(spacing_seconds)

        seen: set[str] = set()
        for filer in run.filers:
            if filer.registration_number in seen:
                run.errors.append(
                    f"{filer.registration_number} appears in more than one registered "
                    "filer list, so its kind is ambiguous and the viewer to ask for it "
                    "cannot be decided"
                )
            seen.add(filer.registration_number)

        targets = [
            filer
            for filer in run.filers
            if not wanted or filer.registration_number in wanted
        ]
        run.requested_filers = len(targets)
        missing_names = wanted - {filer.registration_number for filer in targets}
        if missing_names:
            run.errors.append(
                "asked for registration number(s) the directory does not list: "
                + ", ".join(sorted(missing_names))
            )
        log(
            f"{len(targets):,} filers to ask about, {len(segments)} segment(s) each, "
            f"about {len(targets) * (1 + len(segments)):,} requests"
        )

        for index, filer in enumerate(targets, start=1):
            response, reports, errors = fetch_catalogue(
                http, filer.kind, filer.registration_number, segments[-1], base_url
            )
            archive.write("catalogue", response, registration=filer.registration_number)
            run.errors.extend(errors)
            run.reports.extend(reports)
            time.sleep(spacing_seconds)

            for segment in segments:
                response, tab = fetch_figures(
                    http, filer.kind, filer.registration_number, segment, base_url
                )
                line = archive.write(
                    "figures",
                    response,
                    registration=filer.registration_number,
                    segment=list(segment),
                )
                run.errors.extend(
                    f"{filer.registration_number}: {error}" for error in tab.errors
                )
                for year in segment:
                    block = tab.years.get(year)
                    if block is None:
                        # Counted as missing only for a year we asked for. One request
                        # returns both years of its segment, so asking about 2025 also
                        # brings back 2024 and asking about 2026 also brings back 2027 —
                        # and 2027 has not happened, so counting its absence would put
                        # the empty-answer share near 100% every run and swamp the one
                        # signal that check exists to carry.
                        if year in years:
                            run.without_figures.append(
                                (filer.registration_number, year)
                            )
                        continue
                    # Kept whatever year it is. The extra year arrives in the same
                    # response at no extra cost, and discarding it would throw away real
                    # history — and with it the pinned closed-year figures that detect a
                    # changed amendment rule.
                    run.filings.append(
                        ParsedFiling(
                            registration_number=filer.registration_number,
                            kind=filer.kind,
                            filing_year=year,
                            segment=segment,
                            block_heading=block.heading,
                            reported_through=block.reported_through,
                            amounts=block.amounts,
                            served_labels=block.served_labels,
                            response_hash=response.content_hash,
                            archive_line=line,
                        )
                    )
                time.sleep(spacing_seconds)

            if index % 100 == 0:
                log(
                    f"  {index:,}/{len(targets):,} filers, "
                    f"{len(run.filings):,} filer-years, {len(run.errors)} error(s)"
                )

        run.fetch_completed_at = datetime.now(UTC)
        run.archive_hash, run.archive_size, run.response_count = archive.close()
        run.compute_record_set_hash()
        log(run.summary())

        if not dry_run:
            run.snapshot_id, reused = record_filings_fetch(
                db, run, store, archive.path, ingestion_run_id
            )
            if reused:
                log(
                    "these figures were already on file; rebuilding from the archive "
                    "that was kept, so every figure cites a response we still hold"
                )
                rebuild_run_from_retained_archive(
                    db,
                    run,
                    db.get(schema.CampaignFinanceFilingSnapshot, run.snapshot_id),
                    store,
                    directory,
                )

        live = live_filings_snapshot(db)
        run.unchanged = bool(
            live is not None
            and run.record_set_hash
            and live.record_set_hash == run.record_set_hash
        )
        if run.unchanged:
            log("the published snapshot already holds these figures")
            _finish_filings_run(db, ingestion_run_id, run, dry_run)
            return run

        run.checks = validate_filings(
            run,
            live,
            published_filer_years(db, live.id) if live is not None else None,
            operator_approved=bool(
                run.record_set_hash and run.record_set_hash == (publish_hash or "")
            ),
        )
        if run.blocked:
            if not dry_run:
                quarantine_filings(db, run)
                _finish_filings_run(db, ingestion_run_id, run, dry_run)
            log(
                "quarantined. Nothing was published and the previous snapshot is "
                "still live."
            )
            return run
        if dry_run:
            log("dry run: nothing was written")
            return run

        publish_filings(
            db,
            run,
            ingestion_run_id=ingestion_run_id,
            notes=(
                f"published by an operator naming the reviewed record hash "
                f"{publish_hash}"
                if publish_hash
                else None
            ),
            approved_hash=publish_hash,
        )
        snapshots, rows = prune_filings(db)
        log(
            f"published filings snapshot {run.snapshot_id}; pruned {rows:,} rows from "
            f"{snapshots} superseded snapshot(s)"
        )
        _finish_filings_run(db, ingestion_run_id, run, dry_run)
        return run


def _finish_filings_run(
    db: Session, run_id: Optional[uuid.UUID], run: FilingsRun, dry_run: bool
) -> None:
    if run_id is None or dry_run:
        return
    ingestion = db.get(schema.IngestionRun, run_id)
    if ingestion is None:  # pragma: no cover
        return
    ingestion.status = (
        schema.IngestionStatus.failed
        if run.blocked
        else schema.IngestionStatus.succeeded
    )
    ingestion.finished_at = datetime.now(UTC)
    ingestion.stats = {
        "snapshot_id": str(run.snapshot_id) if run.snapshot_id else None,
        "unchanged": run.unchanged,
        "filers": len(run.filers),
        "filings": len(run.filings),
        "figures": run.figure_count,
        "reports": len(run.reports),
        "filer_years_without_figures": len(run.without_figures),
        "quarantined": [check.name for check in run.blocked],
    }
    db.commit()


def _store_from_env():
    from alethical.pipeline.raw_file_store import raw_file_store_from_env

    return raw_file_store_from_env()
