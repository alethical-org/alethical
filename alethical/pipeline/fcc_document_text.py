"""Bounded, local reading of FCC political PDFs, with unapproved source evidence.

Facts are candidates for review, never payment records or approved public totals.
A blank page is a coverage gap, even if other pages yielded searchable text.
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict, dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from pypdf import PdfReader
from pypdf.generic import ContentStream, DictionaryObject

EXTRACTOR_VERSION = "fcc-document-text-v1"
VERSION = EXTRACTOR_VERSION
MAX_DOCUMENT_BYTES = 30 * 1024 * 1024
MAX_PAGES = 100
MAX_SECONDS = 180
MAX_PAGE_CHARACTERS = 200_000
MAX_OUTPUT_BYTES = 25 * 1024 * 1024
COMMAND_SECONDS = 30


@dataclass(frozen=True)
class PageText:
    page: int
    text: str
    method: str
    status: str
    error: str | None = None


@dataclass(frozen=True)
class Fact:
    field: str
    value: str
    page: int
    quote: str


@dataclass(frozen=True)
class Extraction:
    pages: list[PageText]
    document_kind: str
    facts: list[Fact]
    status: str
    version: str = VERSION
    errors: list[str] = field(default_factory=list)


def _failed(status: str, error: str) -> Extraction:
    return Extraction([], "unknown", [], status, errors=[error])


def extract_document(body: bytes, name: str) -> Extraction:
    """Read an untrusted PDF in a separate process with a total time limit.

    ``name`` is catalogue context, never evidence of a value or document kind.
    Missing OCR software is reported without installation or a network request.
    """
    if len(body) > MAX_DOCUMENT_BYTES:
        return _failed("limit_exceeded", "document_byte_limit")
    if not body.lstrip().startswith(b"%PDF-"):
        return _failed("unreadable", "not_pdf")
    with tempfile.TemporaryDirectory(prefix="alethical-fcc-text-") as directory:
        source = Path(directory) / "source.pdf"
        output = Path(directory) / "extraction.json"
        source.write_bytes(body)
        try:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-c",
                    "from alethical.pipeline.fcc_document_text import _worker_main; "
                    "import sys; _worker_main(sys.argv[1], sys.argv[2])",
                    str(source),
                    str(output),
                ],
                cwd=Path(__file__).resolve().parents[2],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=os.name == "posix",
            )
            try:
                process.wait(timeout=MAX_SECONDS)
            except subprocess.TimeoutExpired:
                if os.name == "posix":
                    os.killpg(process.pid, signal.SIGKILL)
                else:
                    process.kill()
                process.wait()
                return _failed("limit_exceeded", "document_time_limit")
        except OSError:
            return _failed("unreadable", "reader_process_unavailable")
        if process.returncode or not output.exists():
            return _failed("unreadable", "reader_process_failed")
        if output.stat().st_size > MAX_OUTPUT_BYTES:
            return _failed("limit_exceeded", "extracted_text_limit")
        try:
            data = json.loads(output.read_text())
            return Extraction(
                pages=[PageText(**page) for page in data["pages"]],
                facts=[Fact(**fact) for fact in data["facts"]],
                document_kind=data["document_kind"],
                status=data["status"],
                version=data["version"],
                errors=data["errors"],
            )
        except (OSError, ValueError, KeyError, TypeError):
            return _failed("unreadable", "reader_output_invalid")


def _worker_main(source: str, output: str) -> None:
    # Linux worker memory is bounded independently of the ingestion process.
    # macOS does not reliably support an address-space limit for Python.
    if sys.platform == "linux":
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024,) * 2)
    extraction = _extract_pages(Path(source).read_bytes(), Path(source))
    Path(output).write_text(json.dumps(asdict(extraction), ensure_ascii=False))


def _usable(text: str) -> bool:
    # A page number or an isolated heading does not make a scan searchable.
    return (
        len(re.findall(r"[A-Za-z]", text)) >= 8
        and len(re.findall(r"[A-Za-z]{2,}", text)) >= 2
    )


def _command(command: list[str], deadline: float) -> bytes:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise subprocess.TimeoutExpired(command, 0)
    return subprocess.run(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=min(COMMAND_SECONDS, remaining),
        check=True,
    ).stdout


def _ocr_page(source: Path, page: int, deadline: float) -> tuple[str, str | None]:
    renderer, recognizer = shutil.which("pdftoppm"), shutil.which("tesseract")
    if not renderer or not recognizer:
        return "", "local_ocr_unavailable"
    try:
        with tempfile.TemporaryDirectory(prefix="alethical-fcc-ocr-") as directory:
            prefix = Path(directory) / "page"
            _command(
                [
                    renderer,
                    "-f",
                    str(page),
                    "-l",
                    str(page),
                    "-singlefile",
                    "-scale-to",
                    "2500",
                    "-png",
                    str(source),
                    str(prefix),
                ],
                deadline,
            )
            text = _command(
                [recognizer, str(prefix.with_suffix(".png")), "stdout", "-l", "eng"],
                deadline,
            ).decode("utf-8", errors="replace")
            return text.strip(), None if _usable(text) else "local_ocr_no_text"
    except subprocess.TimeoutExpired:
        return "", "local_ocr_time_limit"
    except (OSError, subprocess.CalledProcessError):
        return "", "local_ocr_failed"


def _image_coverage(page: Any, reader: PdfReader) -> float | None:
    """Measure painted image area without decoding pixels or executing content.

    Overlapping or clipped pictures can overestimate coverage. That deliberately
    requests extra local OCR rather than certifying an unsearched image body.
    """
    operations_seen = 0

    def area(stream: Any, resources: Any, scale: float, depth: int) -> float:
        nonlocal operations_seen
        if depth > 8:
            raise ValueError("nested image coverage limit")
        stack = []
        total = 0.0
        resources = resources.get_object()
        objects = resources.get("/XObject", DictionaryObject()).get_object()
        for operands, operator in ContentStream(stream, reader).operations:
            operations_seen += 1
            if operations_seen > 100_000:
                raise ValueError("image coverage operation limit")
            if operator == b"q":
                stack.append(scale)
            elif operator == b"Q":
                if not stack:
                    raise ValueError("unbalanced image graphics state")
                scale = stack.pop()
            elif operator == b"cm":
                a, b, c, d, _, _ = map(float, operands)
                scale *= abs(a * d - b * c)
            elif operator == b"INLINE IMAGE":
                total += scale
            elif operator == b"Do":
                obj = objects[operands[0]].get_object()
                if obj.get("/Subtype") == "/Image":
                    total += scale
                elif obj.get("/Subtype") == "/Form":
                    a, b, c, d, _, _ = map(
                        float, obj.get("/Matrix", (1, 0, 0, 1, 0, 0))
                    )
                    total += area(
                        obj,
                        obj.get("/Resources", resources),
                        scale * abs(a * d - b * c),
                        depth + 1,
                    )
        return total

    try:
        painted = area(
            page.get_contents(), page.get("/Resources", DictionaryObject()), 1.0, 0
        )
        page_area = float(page.mediabox.width) * float(page.mediabox.height)
        return min(1.0, painted / page_area) if page_area > 0 else None
    except Exception:
        return None


def _extract_pages(body: bytes, source: Path) -> Extraction:
    deadline = time.monotonic() + MAX_SECONDS - 5
    try:
        reader = PdfReader(io.BytesIO(body), strict=False)
        if reader.is_encrypted:
            return _failed("unreadable", "encrypted_pdf")
        count = len(reader.pages)
        if count > MAX_PAGES:
            return _failed("limit_exceeded", "document_page_limit")
        if not count:
            return _failed("unreadable", "no_pages")
    except Exception:
        return _failed("unreadable", "pdf_parse_failed")
    pages = []
    for number, page in enumerate(reader.pages, 1):
        if time.monotonic() >= deadline:
            pages.extend(
                PageText(n, "", "none", "unreadable", "document_time_limit")
                for n in range(number, count + 1)
            )
            break
        page_errors: list[str] = []
        method = "pypdf"
        try:
            text = page.extract_text(extraction_mode="layout") or ""
        except Exception:
            text = ""
            page_errors.append("page_text_failed")
        if not _usable(text) and (binary := shutil.which("pdftotext")):
            try:
                text = _command(
                    [
                        binary,
                        "-f",
                        str(number),
                        "-l",
                        str(number),
                        "-layout",
                        str(source),
                        "-",
                    ],
                    deadline,
                ).decode("utf-8", errors="replace")
                method = "pdftotext"
            except (OSError, subprocess.SubprocessError):
                page_errors.append("pdftotext_failed")
        coverage = _image_coverage(page, reader)
        needs_image_ocr = (
            coverage is None
            or coverage >= 0.35
            or (coverage >= 0.05 and len(re.findall(r"[A-Za-z]", text)) < 150)
        )
        if coverage is None:
            page_errors.append("image_coverage_unreadable")
        partial = False
        if not _usable(text) or needs_image_ocr:
            native_text = text if _usable(text) else ""
            ocr_text, ocr_error = _ocr_page(source, number, deadline)
            if _usable(ocr_text):
                if native_text:
                    text = (
                        native_text + "\n\n[Supplemental local OCR text]\n" + ocr_text
                    )
                    method += "+tesseract"
                else:
                    text, method = ocr_text, "tesseract"
            elif native_text:
                text = native_text
                partial = True
            else:
                text, method = "", "none"
            if ocr_error:
                page_errors.append(ocr_error)
        error = ";".join(page_errors) or None
        # Preserve uncertain characters rather than joining digits into a new
        # apparent value. NUL cannot be stored in PostgreSQL text.
        text = re.sub(r"[\x00\ud800-\udfff]", "\ufffd", text)
        if len(text) > MAX_PAGE_CHARACTERS:
            pages.append(PageText(number, "", method, "unreadable", "page_text_limit"))
        elif _usable(text):
            pages.append(
                PageText(
                    number,
                    text.strip(),
                    method,
                    "partial" if partial else "extracted",
                    error,
                )
            )
        else:
            status = (
                "needs_ocr" if "local_ocr_unavailable" in page_errors else "unreadable"
            )
            pages.append(PageText(number, "", method, status, error or "no_text"))
    kind, facts, errors = _read_facts(pages)
    if all(p.status == "extracted" for p in pages):
        status = "pending_review"
    elif any(p.status in {"extracted", "partial"} for p in pages):
        status = "partial"
    elif any(p.status == "needs_ocr" for p in pages):
        status = "needs_ocr"
    else:
        status = "unreadable"
    return Extraction(pages, kind, facts, status, errors=errors)


# A label must own the whole line, or be followed by a separator. Never scan
# forward through a table for the next money-shaped token or infer commission.
_LABELS = {
    "order_number": r"(?:(?:order|contract)\s*(?:number|no\.?|#)|order\s*/\s*rev)",
    "invoice_number": r"invoice\s*(?:number|no\.?|#)",
    "agency_name": r"agency(?:\s+name)?",
    "agency_address": r"agency\s+address",
    "advertiser": r"advertiser(?:\s+name)?",
    "payer": r"(?:payer(?:\s+name)?|paid\s+by)",
    "invoice_date": r"invoice\s+date",
    "start_date": r"(?:start|flight\s+start)\s+date",
    "end_date": r"(?:end|flight\s+end)\s+date",
    "gross_amount": r"gross\s+(?:amount|total)",
    "commission_amount": r"(?:agency\s+)?commission(?:\s+amount)?",
    "commission_rate": r"(?:agency\s+)?commission\s+(?:rate|%)",
    "net_amount": r"net\s+(?:amount(?:\s+due)?|total)",
    "total_order_amount": r"(?:total\s+order\s+amount|order\s+total)",
    "credit_amount": r"credit\s+amount",
    "paid_amount": r"(?:amount\s+paid|paid\s+amount|payment\s+received)",
}
_LABEL_PATTERNS = [
    (field_name, re.compile(rf"^\s*(?:{label})(?:\s*[:=]\s*(.*?)|\s*)$", re.I))
    for field_name, label in _LABELS.items()
]
_MONEY_FIELDS = {
    "gross_amount",
    "commission_amount",
    "net_amount",
    "total_order_amount",
    "credit_amount",
    "paid_amount",
}
_NUMBER = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?"
_MONEY = re.compile(
    rf"(?:\(\s*(?:USD\s*)?\$?\s*{_NUMBER}\s*\)|[+-]?\s*(?:USD\s*)?\$?\s*[+-]?{_NUMBER})",
    re.I,
)
_FLIGHT_DATES = re.compile(r"(\d{1,2}/\d{1,2}/\d{2,4})\s*-\s*(\d{1,2}/\d{1,2}/\d{2,4})")


def _label(line: str) -> tuple[str, str] | None:
    for name, pattern in _LABEL_PATTERNS:
        if match := pattern.fullmatch(line):
            return name, (match.group(1) or "").strip()
    return None


def _value(name: str, value: str) -> str | None:
    if not value or len(value) > 500 or "\ufffd" in value:
        return None
    if name in _MONEY_FIELDS:
        if not _MONEY.fullmatch(value):
            return None
        normalized = re.sub(r"USD|\$|,|\s", "", value, flags=re.I)
        if normalized.startswith("("):
            normalized = "-" + normalized[1:-1]
        try:
            return format(Decimal(normalized), ".2f")
        except InvalidOperation:
            return None
    if name == "commission_rate":
        match = re.fullmatch(r"(\d{1,3}(?:\.\d+)?)\s*%", value)
        if match and Decimal(match.group(1)) <= 100:
            return format(Decimal(match.group(1)).normalize(), "f")
        return None
    # Multiple columns may contain otherwise plausible strings. Never join them.
    if re.search(r"\S\s{2,}\S", value) or _label(value) or ":" in value:
        return None
    if name.endswith("_date") and not re.fullmatch(
        r"(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})",
        value,
    ):
        return None
    if name.endswith("_number") and not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9./_-]{0,79}", value
    ):
        return None
    return value


def _read_facts(pages: list[PageText]) -> tuple[str, list[Fact], list[str]]:
    candidates: list[Fact] = []
    for page in pages:
        lines = page.text.splitlines()
        for index, line in enumerate(lines):
            # This observed WideOrbit table labels both repeated gross/net
            # columns. Its explicit Totals row states the order-level values.
            # Require the entire header and row, not proximity to a dollar sign.
            if re.fullmatch(
                r"\s*Start Date\s+End Date\s+# Spots\s+Gross Amount\s+Net Amount"
                r"\s+Month\s+# Spots\s+Gross Amount\s+Net Amount\s+Rating\s*",
                line,
                re.I,
            ):
                for row_index in range(index + 1, min(index + 4, len(lines))):
                    total = re.fullmatch(
                        rf"\s*Totals\s+\d+\s+(\$?{_NUMBER})\s+(\$?{_NUMBER})\s+\d+\.\d+\s*",
                        lines[row_index],
                        re.I,
                    )
                    if total:
                        for field_name, raw in zip(
                            ("gross_amount", "net_amount"), total.groups(), strict=True
                        ):
                            normalized = _value(field_name, raw)
                            if normalized is not None:
                                candidates.append(
                                    Fact(
                                        field_name,
                                        normalized,
                                        page.page,
                                        "\n".join(lines[index : row_index + 1]).strip(),
                                    )
                                )
            # Native layout text separates columns with repeated spaces. Accept
            # an exact label cell and its immediately adjacent value cell only.
            # Inline-labelled multi-value rows still fail the whole-line parser.
            cells = re.split(r"\s{2,}", line.strip())
            for position, cell in enumerate(cells[:-1]):
                if re.fullmatch(r"Flight Dates:?", cell, re.I):
                    if match := _FLIGHT_DATES.fullmatch(cells[position + 1]):
                        candidates.extend(
                            Fact(name, value, page.page, line.strip())
                            for name, value in zip(
                                ("start_date", "end_date"), match.groups(), strict=True
                            )
                        )
                    continue
                cell_label = _label(cell)
                if not cell_label or cell_label[1]:
                    continue
                field_name = cell_label[0]
                adjacent = cells[position + 1]
                if (
                    field_name in {"agency_name", "advertiser"}
                    and adjacent.lower() == "name:"
                    and position + 2 < len(cells)
                ):
                    adjacent = cells[position + 2]
                if field_name == "commission_amount" and _value(
                    "commission_rate", adjacent
                ):
                    field_name = "commission_rate"
                if position + 2 < len(cells) and _MONEY.fullmatch(cells[position + 2]):
                    continue
                cell_value = _value(field_name, adjacent)
                if cell_value is not None:
                    candidates.append(
                        Fact(field_name, cell_value, page.page, line.strip())
                    )
            label = _label(line)
            if not label:
                continue
            name, value = label
            quote = line.strip()
            if not value:
                following = index + 1
                while following < len(lines) and not lines[following].strip():
                    following += 1
                if following >= len(lines) or following > index + 3:
                    continue
                value = lines[following].strip()
                quote = "\n".join(lines[index : following + 1]).strip()
            if name == "commission_amount" and _value("commission_rate", value):
                name = "commission_rate"
            normalized = _value(name, value)
            if normalized is not None:
                candidates.append(Fact(name, normalized, page.page, quote))
    values: dict[str, set[str]] = {}
    for candidate in candidates:
        values.setdefault(candidate.field, set()).add(candidate.value)
    conflicts = {name for name, distinct in values.items() if len(distinct) > 1}
    facts = []
    seen: set[tuple[str, str, int, str]] = set()
    for candidate in candidates:
        key = (candidate.field, candidate.value, candidate.page, candidate.quote)
        if candidate.field not in conflicts and key not in seen:
            facts.append(candidate)
            seen.add(key)
    text = "\n".join(p.text for p in pages)
    if re.search(r"(?im)^\s*credit\s+(?:memo|note)\b", text):
        kind = "credit"
    elif "invoice_number" in values or re.search(r"(?im)^\s*invoice\s*$", text):
        kind = "invoice"
    elif "order_number" in values or re.search(
        r"(?im)^\s*(?:order|advertising\s+order|insertion\s+order|order\s+confirmation)\s*$",
        text,
    ):
        kind = "order"
    elif re.search(
        r"(?im)^\s*(?:political\s+disclosure|political\s+advertising\s+disclosure|political\s+broadcast\s+agreement)\b",
        text,
    ):
        kind = "disclosure"
    elif "credit_amount" in values:
        kind = "credit"
    else:
        kind = "unknown"
    return kind, facts, [f"conflicting_field:{name}" for name in sorted(conflicts)]
