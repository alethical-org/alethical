"""Read donor evidence from a complete, internally reconciled contribution schedule.

These records are evidence for existing bulk rows, never replacement payment rows.
Unsupported layouts fail as a whole. A name is never a lobbyist identity: only the
report's explicit lobbyist label and registration number establish that identity.
"""

from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from pypdf import PdfReader
from pypdf.errors import PyPdfError

from alethical.pipeline.campaign_finance_report_documents import SCHEDULE_HEADING


class ReportEvidenceError(ValueError):
    """A deterministic refusal, with no source personal information in its message."""


@dataclass(frozen=True)
class ReportTransaction:
    donor_name: str
    lobbyist_registration_number: str | None
    receipt_date: date
    cash: Decimal
    in_kind: Decimal
    page: int
    line: int
    schedule: str

    @property
    def total(self) -> Decimal:
        return self.cash + self.in_kind


@dataclass(frozen=True)
class EvidenceSchedule:
    code: str
    itemized_cash: Decimal
    itemized_in_kind: Decimal
    non_itemized_cash: Decimal
    non_itemized_in_kind: Decimal


@dataclass(frozen=True)
class ReportEvidence:
    registration_number: str
    filing_year: int
    period_start: date
    period_end: date
    document_hash: str
    transactions: tuple[ReportTransaction, ...]
    schedules: tuple[EvidenceSchedule, ...]


_CODES = {
    "A1 - CR",
    "A1 - IND",
    "A1 - LOB",
    "A1 - PCF",
    "A1 - PTY/TERM PCC",
    "A1 - OTH",
}
_ZERO = Decimal("0.00")
_MONEY = re.compile(
    r"(?:-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}|\(\$?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\))\Z"
)
_DATE = re.compile(r"\d{2}/\d{2}/\d{4}\Z")
_PERIOD = re.compile(
    r"Period Covered:\s*(\d{2}/\d{2}/\d{4})\s+through\s+(\d{2}/\d{2}/\d{4})"
)
_REG = re.compile(r"Registration Number:\s*(\d+)\b")
_DONOR_REG = re.compile(
    r"^(?P<lobbyist>Lobbyist:\s*)?(?P<name>.+?)\s*\(Registered Id:\s*(?P<reg>\d+)\s*\)\s*$"
)
_COLUMNS = re.compile(r"^(?P<date>Date\s+)?Cash\s+In kind\s+Total$")
_CITY = re.compile(r"\b[A-Z]{2}(?:\s+\d{1,10}(?:\s*-\s*\d{4})?)?[.`]*\s*$")
# Address lines may omit a state or ZIP, or drop a leading zero. Their indentation
# separates them from a new donor heading; none contributes to donor identity.
_ADDRESS = re.compile(r"[A-Za-z .,'’\-]+(?:\s+\d{1,10}(?:\s*-\s*\d{4})?)?[.`]*\Z")
_STREET = re.compile(r"\d+\s+[A-Za-z .,#’'\-]+\s+\d{1,10}\Z")
_NAME_START = re.compile(r"^(?:[A-Za-z]|\d+[A-Za-z]*\s+[A-Za-z])")
_FOOTER = re.compile(r"^Page\s+\d+$")


def _date(value: str) -> date:
    try:
        return datetime.strptime(value, "%m/%d/%Y").date()
    except ValueError as exc:
        raise ReportEvidenceError("invalid_date") from exc


def _amounts(value: str) -> tuple[Decimal, Decimal, Decimal]:
    parts = value.split()
    if len(parts) != 3 or any(_MONEY.fullmatch(part) is None for part in parts):
        raise ReportEvidenceError("unsupported_money_columns")
    amounts = tuple(
        Decimal(
            part.replace(",", "").replace("$", "").replace("(", "-").replace(")", "")
        )
        for part in parts
    )
    if amounts[0] + amounts[1] != amounts[2]:
        raise ReportEvidenceError("row_arithmetic_mismatch")
    return amounts[0], amounts[1], amounts[2]


def _donor(value: str, schedule: str) -> tuple[str, str | None]:
    match = _DONOR_REG.fullmatch(value)
    if match:
        name = match["name"].strip()
        if not name or name == "Lobbyist:":
            raise ReportEvidenceError("unsupported_donor_identity")
        identity = match["reg"] if match["lobbyist"] or schedule == "A1 - LOB" else None
        return name, identity
    if "Lobbyist:" in value or "Registered Id" in value or schedule == "A1 - LOB":
        raise ReportEvidenceError("unsupported_donor_identity")
    if not value or _NAME_START.match(value) is None or value.startswith("Employment:"):
        raise ReportEvidenceError("unsupported_donor_heading")
    return value, None


def _extract_pages(body: bytes) -> list[str]:
    if not body.startswith(b"%PDF"):
        raise ReportEvidenceError("not_pdf")
    try:
        reader = PdfReader(io.BytesIO(body))
        pages = [
            page.extract_text(extraction_mode="layout") or "" for page in reader.pages
        ]
    except (PyPdfError, ValueError, KeyError, TypeError, OSError) as exc:
        raise ReportEvidenceError("unreadable_pdf") from exc
    if not pages or any(not page.strip() for page in pages):
        raise ReportEvidenceError("empty_pdf_page")
    return pages


def parse_lobbyist_report_evidence(
    body: bytes, *, registration_number: str, filing_year: int
) -> ReportEvidence:
    """Validate one PDF, preserving every printed contribution and its source page.

    Catalogue selection, effective amendments, cross-report coverage, bulk-row
    matching and publication are deliberately the caller's responsibility.
    """
    pages = _extract_pages(body)
    registrations = _REG.findall(pages[0])
    periods = _PERIOD.findall(pages[0])
    if registrations != [registration_number]:
        raise ReportEvidenceError("report_registration_mismatch")
    if len(periods) != 1:
        raise ReportEvidenceError("missing_or_ambiguous_report_period")
    period_start, period_end = (_date(value) for value in periods[0])
    if (
        not period_start.year <= filing_year <= period_end.year
        or period_start > period_end
    ):
        raise ReportEvidenceError("report_year_or_period_mismatch")
    parser = _ScheduleReader(period_start, period_end)
    for page_number, page in enumerate(pages, 1):
        printed_pages = [
            line.strip()
            for line in page.splitlines()
            if _FOOTER.fullmatch(line.strip())
        ]
        if printed_pages != [f"Page {page_number}"]:
            raise ReportEvidenceError("missing_or_out_of_order_page")
        for line_number, raw in enumerate(page.splitlines(), 1):
            parser.line(raw, page_number, line_number)
    parser.finish()
    if not parser.schedules:
        # An absent schedule is not proof that no contribution was reported.
        raise ReportEvidenceError("no_contribution_schedules")
    if "A1 - CR" in parser.seen and len(parser.seen) != 1:
        raise ReportEvidenceError("mixed_contribution_schedule_families")
    _reconcile_summary(pages, parser.schedules)
    return ReportEvidence(
        registration_number,
        filing_year,
        period_start,
        period_end,
        hashlib.sha256(body).hexdigest(),
        tuple(parser.transactions),
        tuple(parser.schedules),
    )


_SUMMARY_CODE = re.compile(
    r"Sch\.\s+A1\s*-\s*(?P<code>IND|LOB|PCF|OTH|CR|PS|PTY/)(?P<rest>.*)$"
)
_SUMMARY_RECEIPTS = re.compile(r"^A\s+Receipts\s+Cash\s+Blank\s+In-kind\s+Total$")
_CANDIDATE_CODES = _CODES - {"A1 - CR"}


def _reconcile_summary(pages: list[str], schedules: list[EvidenceSchedule]) -> None:
    """A missing schedule cannot hide behind agreement inside the remaining ones.

    Compare every category independently, not just their grand total: two missing
    categories with offsetting signed amounts must not cancel each other out.
    """
    summary_count = 0
    receipts_count = 0
    in_receipts = False
    pending_party = False
    summary: dict[str, tuple[Decimal, Decimal, Decimal]] = {}
    for page in pages:
        for raw in page.splitlines():
            value = raw.strip()
            if value == "Committee Transaction Summary":
                summary_count += 1
            if _SUMMARY_RECEIPTS.fullmatch(value):
                receipts_count += 1
                in_receipts = True
                continue
            if re.match(r"^B\s+Disbursements\b", value) or SCHEDULE_HEADING.match(
                value
            ):
                if pending_party:
                    raise ReportEvidenceError("incomplete_summary_category")
                in_receipts = False
            if not in_receipts:
                continue
            match = _SUMMARY_CODE.search(value)
            if pending_party:
                # The Board wraps this code across two physical lines. The row
                # number and description precede TERM PCC on the second line.
                if "TERM PCC" not in value or match is not None:
                    if value:
                        raise ReportEvidenceError("incomplete_summary_category")
                    continue
                code = "A1 - PTY/TERM PCC"
                amounts = _amounts(value.partition("TERM PCC")[2])
                pending_party = False
            elif match:
                suffix = match["code"]
                if suffix == "PS":
                    # Public subsidy is a separate receipt, not a contribution.
                    continue
                code = f"A1 - {suffix}"
                rest = match["rest"].strip()
                if suffix == "PTY/":
                    if not rest:
                        pending_party = True
                        continue
                    if not rest.startswith("TERM PCC"):
                        raise ReportEvidenceError("unsupported_summary_category")
                    code = "A1 - PTY/TERM PCC"
                    rest = rest.removeprefix("TERM PCC")
                amounts = _amounts(rest)
            elif re.search(r"Sch\.\s+A1\b", value):
                raise ReportEvidenceError("unsupported_summary_category")
            else:
                continue
            if code in summary:
                raise ReportEvidenceError("repeated_summary_category")
            summary[code] = amounts
    if summary_count != 1 or receipts_count != 1 or pending_party:
        raise ReportEvidenceError("missing_or_ambiguous_contribution_summary")
    expected = {"A1 - CR"} if "A1 - CR" in summary else _CANDIDATE_CODES
    if set(summary) != expected:
        raise ReportEvidenceError("incomplete_contribution_summary")
    parsed = {schedule.code: schedule for schedule in schedules}
    if not set(parsed).issubset(expected):
        raise ReportEvidenceError("summary_schedule_family_mismatch")
    for code, amounts in summary.items():
        schedule = parsed.get(code)
        if schedule is None:
            if amounts != (_ZERO, _ZERO, _ZERO):
                raise ReportEvidenceError("missing_nonzero_contribution_schedule")
            continue
        cash = schedule.itemized_cash + schedule.non_itemized_cash
        kind = schedule.itemized_in_kind + schedule.non_itemized_in_kind
        if amounts != (cash, kind, cash + kind):
            raise ReportEvidenceError("contribution_summary_mismatch")


class _ScheduleReader:
    def __init__(self, period_start: date, period_end: date):
        self.period_start = period_start
        self.period_end = period_end
        self.transactions: list[ReportTransaction] = []
        self.schedules: list[EvidenceSchedule] = []
        self.seen: set[str] = set()
        self.code: str | None = None
        self.title_pending = 0
        self.pending_name: str | None = None
        self.donor: tuple[str, str | None] | None = None
        self.donor_count = 0
        self.donor_cash = _ZERO
        self.donor_kind = _ZERO
        self.cash = _ZERO
        self.kind = _ZERO
        self.itemized: tuple[Decimal, Decimal, Decimal] | None = None
        self.non_itemized: tuple[Decimal, Decimal, Decimal] | None = None
        self.total_seen = False
        self.description_columns: tuple[int, int] | None = None

    def finish(self) -> None:
        if self.code is None:
            return
        if self.pending_name is not None or (
            self.donor is not None and not self.donor_count
        ):
            raise ReportEvidenceError("unfinished_donor")
        if self.itemized is None or self.non_itemized is None or not self.total_seen:
            raise ReportEvidenceError("incomplete_schedule_totals")
        if (self.cash, self.kind) != self.itemized[:2]:
            raise ReportEvidenceError("itemized_schedule_mismatch")
        self.schedules.append(
            EvidenceSchedule(
                self.code,
                self.itemized[0],
                self.itemized[1],
                self.non_itemized[0],
                self.non_itemized[1],
            )
        )
        self.code = None

    def line(self, raw: str, page: int, line: int) -> None:
        value = raw.strip()
        if not value:
            return
        heading = SCHEDULE_HEADING.match(value)
        if heading:
            self.finish()
            code = " ".join(heading["code"].split())
            if code.startswith("A1") and code not in _CODES:
                raise ReportEvidenceError("unknown_contribution_schedule")
            if code not in _CODES:
                return
            if code in self.seen:
                raise ReportEvidenceError("repeated_schedule")
            self.seen.add(code)
            self.code = code
            self.title_pending = 2 if code == "A1 - PTY/TERM PCC" else 1
            self.donor = None
            self.donor_count = 0
            self.cash = self.kind = _ZERO
            self.itemized = self.non_itemized = None
            self.total_seen = False
            self.description_columns = None
            return
        if re.match(r"^Schedule\s+A1\b", value):
            raise ReportEvidenceError("unsupported_schedule_heading")
        if self.code is None:
            return
        if "XSD Version:" in value and "Printed " in value or _FOOTER.fullmatch(value):
            return
        if self.title_pending:
            if not raw[0].isspace() or value.startswith(("Date", "Lobbyist:", "Total")):
                raise ReportEvidenceError("missing_schedule_title")
            self.title_pending -= 1
            return
        columns = _COLUMNS.fullmatch(value)
        if columns:
            if columns["date"]:
                if self.itemized is not None:
                    raise ReportEvidenceError("donor_after_schedule_total")
                if self.pending_name is None:
                    raise ReportEvidenceError("missing_donor_heading")
                else:
                    self.donor = _donor(self.pending_name, self.code)
                    self.pending_name = None
                    self.donor_cash = self.donor_kind = _ZERO
                    self.donor_count = 0
                    self.description_columns = None
            return
        for prefix in ("Total of non-itemized", "Total of itemized", "Totals", "Total"):
            if value.startswith(prefix + " "):
                self.description_columns = None
                amounts = _amounts(value[len(prefix) :])
                if self.pending_name is not None:
                    raise ReportEvidenceError("unfinished_donor")
                if prefix == "Total of itemized":
                    if self.itemized is not None:
                        raise ReportEvidenceError("repeated_itemized_total")
                    self.itemized = amounts
                elif prefix == "Total of non-itemized":
                    if self.itemized is None or self.non_itemized is not None:
                        raise ReportEvidenceError("unexpected_non_itemized_total")
                    self.non_itemized = amounts
                elif prefix == "Totals":
                    if (
                        self.itemized is None
                        or self.non_itemized is None
                        or self.total_seen
                    ):
                        raise ReportEvidenceError("unexpected_schedule_total")
                    if amounts != tuple(
                        a + b
                        for a, b in zip(self.itemized, self.non_itemized, strict=True)
                    ):
                        raise ReportEvidenceError("schedule_total_mismatch")
                    self.total_seen = True
                elif (
                    self.donor is None
                    or not self.donor_count
                    or amounts[:2] != (self.donor_cash, self.donor_kind)
                ):
                    raise ReportEvidenceError("donor_total_mismatch")
                return
        first, _, rest = value.partition(" ")
        if _DATE.fullmatch(first):
            if (
                self.itemized is not None
                or self.donor is None
                or self.pending_name is not None
            ):
                raise ReportEvidenceError("transaction_outside_donor")
            parts = rest.rsplit(None, 3)
            if len(parts) < 3:
                raise ReportEvidenceError("unsupported_money_columns")
            description = "" if len(parts) == 3 else parts.pop(0)
            cash, kind, _ = _amounts(" ".join(parts))
            if description and not kind:
                raise ReportEvidenceError("unexpected_cash_description")
            self.description_columns = None
            if description:
                # Text between the date and the money may wrap onto the next
                # physical line. It remains a description, never another payment.
                description_start = raw.index(description)
                money_start = raw.index(parts[0], description_start + len(description))
                self.description_columns = (description_start, money_start)
            received = _date(first)
            if not self.period_start <= received <= self.period_end:
                raise ReportEvidenceError("transaction_outside_report_period")
            self.transactions.append(
                ReportTransaction(
                    *self.donor, received, cash, kind, page, line, self.code
                )
            )
            self.donor_cash += cash
            self.donor_kind += kind
            self.cash += cash
            self.kind += kind
            self.donor_count += 1
            return
        if self.itemized is not None:
            raise ReportEvidenceError("unexpected_text_after_schedule_total")
        indent = len(raw) - len(raw.lstrip())
        if self.description_columns is not None:
            left, right = self.description_columns
            if (
                indent >= left
                and len(raw.rstrip()) <= right
                and not any(token in value for token in ("Registered Id:", "Lobbyist:"))
            ):
                return
        # Only address/employment lines may intervene between a donor heading and
        # its Date/Cash/In-kind header. No such text is retained as evidence.
        if self.pending_name is not None:
            if value.startswith("Employment:"):
                return
            if (
                _CITY.search(value)
                or _STREET.fullmatch(value)
                or (indent >= 2 and _ADDRESS.fullmatch(value))
            ) and not any(token in value for token in ("Registered Id:", "Lobbyist:")):
                return
            raise ReportEvidenceError("ambiguous_donor_boundary")
        if indent > 1 or (
            _NAME_START.match(value) is None and _DONOR_REG.fullmatch(value) is None
        ):
            raise ReportEvidenceError("unrecognized_schedule_line")
        if self.donor is not None and not self.donor_count:
            raise ReportEvidenceError("unfinished_donor")
        self.pending_name = value
        self.description_columns = None
