"""Read one explicit filed subsidy schedule; no API/issuer/remainder inference.

Caller owns effective-report/account/amendment and summary-row validation. This
reader checks only this PDF's schedule against those exact supplied expectations.
Run under the caller's PDF worker deadline; these are size limits, not a CPU timer.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation, localcontext
from hashlib import sha256
from io import BytesIO
import re

from pypdf import PdfReader

MAX_BYTES = 64 * 1024 * 1024
# Match election_campaign_expenses.py _MAX_BYTES/_MAX_PAGES/_MAX_TEXT.
MAX_PAGES = 2000
MAX_TEXT = 24 * 1024 * 1024
TITLE = "Schedule A2 - PS Receipts from Public Subsidy Payment"
PURPOSE = "Public subsidy payment from State of Minnesota"
AMOUNT = r"(?:0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:,[0-9]{3})+)\.[0-9]{2}"
ROW = re.compile(rf"([0-9]{{2}}/[0-9]{{2}}/[0-9]{{4}}) {PURPOSE} ({AMOUNT})")
TOTAL = re.compile(rf"Amount Received ({AMOUNT})")
FOOTER = re.compile(
    r"Campaign Finance Reporter Online [0-9]+(?:\.[0-9]+)+ "
    r"XSD Version: [0-9]+(?:\.[0-9]+)+ Printed ([0-9]{2}/[0-9]{2}/[0-9]{4})"
)


def _space(text: str) -> str:
    return " ".join(text.split())


def _day(value) -> date:
    if type(value) is date:
        return value
    if isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        return date.fromisoformat(value)
    raise ValueError("date")


def _expectation(value) -> Decimal:
    if isinstance(value, str) and re.fullmatch(r"(?:0|[1-9][0-9]*)\.[0-9]{2}", value):
        return Decimal(value)
    if (
        type(value) is Decimal
        and value.is_finite()
        and value >= 0
        and value.as_tuple().exponent == -2
    ):
        return value
    raise ValueError("amount")


def extract_subsidy_receipts(
    body: bytes,
    *,
    candidate_name: str,
    office: str,
    period_start: date | str,
    period_end: date | str,
    expected_total: Decimal | str,
) -> dict:
    """Return exact Decimal evidence or an unavailable reason, never guessed zero.

    Identity is exact after whitespace normalization only. Scans every page with
    standard extraction; requests layout extraction only on explicit title pages.
    Supports consecutive schedule pages within the existing PDF limits, repeated headings/footers and1
    final Amount Received total. Every nonblank schedule line must be consumed.
    """
    fingerprint = sha256(body).hexdigest() if type(body) is bytes else None
    scanned = 0

    def unavailable(reason):
        return {
            "status": "unavailable",
            "reason": reason,
            "total": None,
            "source_sha256": fingerprint,
            "pages_scanned": scanned,
            "schedule_pages": [],
            "rows": [],
            "evidence": [],
        }

    try:
        start, end, expected = (
            _day(period_start),
            _day(period_end),
            _expectation(expected_total),
        )
        if (
            start > end
            or not isinstance(candidate_name, str)
            or not isinstance(office, str)
        ):
            raise ValueError("identity")
        name, seat = _space(candidate_name), _space(office)
        if not name or not seat:
            raise ValueError("identity")
    except (ValueError, InvalidOperation):
        return unavailable("invalid_expectations")
    if (
        type(body) is not bytes
        or not body.startswith(b"%PDF-")
        or not 0 < len(body) <= MAX_BYTES
    ):
        return unavailable("invalid_or_oversized_pdf")
    try:
        reader = PdfReader(BytesIO(body), strict=True)
        if not 0 < len(reader.pages) <= MAX_PAGES:
            return unavailable("unsupported_pdf")
        matches = []
        text_size = 0
        for number, page in enumerate(reader.pages, 1):
            standard = page.extract_text()
            if not isinstance(standard, str):
                return unavailable("unreadable_page")
            text_size += len(standard)
            if text_size > MAX_TEXT:
                return unavailable("text_limit_exceeded")
            scanned += 1
            # A blank/image-only page cannot support a negative full-document claim.
            if not standard.strip():
                return unavailable("unreadable_page")
            normalized = _space(standard)
            if "Receipts from Public Subsidy" in normalized:
                matches.append((number, page, standard))
            elif PURPOSE in normalized or re.search(
                r"\bSchedule\s+A\d+\s*[-‐‑–—]?\s*PS\b", normalized, re.I
            ):
                # A payment may be orphaned from its title/header. Do not let a
                # separate well-formed schedule hide this extra or malformed row.
                return unavailable("orphan_subsidy_content")
        if not matches:
            return unavailable("schedule_not_found")
        numbers = [number for number, _, _ in matches]
        if numbers != list(range(numbers[0], numbers[-1] + 1)):
            return unavailable("ambiguous_schedule_pages")
        rows, evidence, totals, seen_rows = [], [], [], set()
        expected_header = f"{name} {seat} Committee"
        for physical_page, page, standard in matches:
            layout = page.extract_text(extraction_mode="layout")
            if not isinstance(layout, str):
                return unavailable("unreadable_schedule")
            text_size += len(layout)
            if text_size > MAX_TEXT:
                return unavailable("text_limit_exceeded")
            if _space(standard) != _space(layout):
                return unavailable("extraction_modes_disagree")
            lines = [
                (n, raw, _space(raw))
                for n, raw in enumerate(layout.splitlines(), 1)
                if raw.strip()
            ]
            if len(lines) < 6 or [x[2] for x in lines[:3]] != [
                TITLE,
                expected_header,
                "Date Total",
            ]:
                return unavailable("unsupported_heading_or_identity")
            footer = FOOTER.fullmatch(lines[-2][2])
            if footer is None or lines[-1][2] != f"Page {physical_page}":
                return unavailable("unsupported_footer")
            datetime.strptime(footer[1], "%m/%d/%Y")
            evidence.append(
                {
                    "page": physical_page,
                    "standard_text": standard,
                    "layout_text": layout,
                    "heading_line": lines[0][0],
                    "identity_line": lines[1][0],
                    "column_header_line": lines[2][0],
                    "footer_line": lines[-2][0],
                    "page_number_line": lines[-1][0],
                }
            )
            for line_number, raw, text in lines[3:-2]:
                total = TOTAL.fullmatch(text)
                if total:
                    # Exactly1 total, on final schedule page after every payment.
                    if totals or physical_page != numbers[-1]:
                        return unavailable("duplicate_or_misplaced_total")
                    totals.append(
                        {
                            "amount": Decimal(total[1].replace(",", "")),
                            "page": physical_page,
                            "line": line_number,
                            "text": raw,
                        }
                    )
                    continue
                row = ROW.fullmatch(text)
                if row is None or totals:
                    return unavailable("uninterpreted_or_extra_schedule_row")
                payment_date = datetime.strptime(row[1], "%m/%d/%Y").date()
                if not start <= payment_date <= end:
                    return unavailable("payment_outside_report_period")
                if text in seen_rows:
                    return unavailable("ambiguous_duplicate_payment")
                seen_rows.add(text)
                rows.append(
                    {
                        "date": payment_date,
                        "amount": Decimal(row[2].replace(",", "")),
                        "purpose": PURPOSE,
                        "page": physical_page,
                        "line": line_number,
                        "text": raw,
                    }
                )
        if len(totals) != 1:
            return unavailable("missing_unique_total")
        with localcontext() as context:
            # Exact addition even if the caller changed its decimal context.
            context.prec = max(
                28,
                max((len(r["amount"].as_tuple().digits) for r in rows), default=1)
                + len(str(len(rows) or 1))
                + 2,
            )
            actual = sum((r["amount"] for r in rows), Decimal("0.00"))
        if actual != totals[0]["amount"] or actual != expected:
            return unavailable("receipt_total_mismatch")
        return {
            "status": "checked",
            "reason": None,
            "source_sha256": fingerprint,
            "pages_scanned": scanned,
            "schedule_pages": numbers,
            "candidate_name": name,
            "office": seat,
            "period_start": start,
            "period_end": end,
            "total": actual,
            "printed_total": totals[0],
            "rows": rows,
            "evidence": evidence,
        }
    except Exception:
        # Extraction/date/shape failures never become a missing schedule or zero.
        return unavailable("unreadable_or_malformed_pdf_schedule")
