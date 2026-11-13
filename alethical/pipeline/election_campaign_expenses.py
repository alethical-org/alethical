"""Checked Schedule B1-CE detail from one exact candidate report PDF.

This parser never establishes committee identity or merges vendor names. Its checked
rows are separate from proposals: a failed structural or arithmetic check withholds
all proposed rows, while preserving their source locators for repair.
"""

from __future__ import annotations

import hashlib
import io
import re
from datetime import date, datetime
from decimal import Decimal

from pypdf import PdfReader
from pypdf.errors import PyPdfError

_COLUMNS = ("paid", "unpaid", "in_kind", "total")
_MONEY = r"(?:-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}|\(\$?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\))"
_AMOUNTS = re.compile(
    r"(?P<label>.*?)\s+(?P<paid>"
    + _MONEY
    + r")\s+(?P<unpaid>"
    + _MONEY
    + r")\s+(?P<in_kind>"
    + _MONEY
    + r")\s+(?P<total>"
    + _MONEY
    + r")\s*$"
)
_SCHEDULE = re.compile(
    r"^\s*Schedule\s+(?P<code>[A-Z]\d[A-Z0-9]*\s*-\s*\S+)\s+(?P<title>.*)$"
)
_TARGET = re.compile(r"^\s*Schedule\s+B1\s*-\s*CE\s+Campaign Expenditures\s*$")
_HEADER = re.compile(
    r"^\s*Date\s+Specific purpose of expenditure\s+Paid\s+Unpaid\s+In[ -]Kind\s+Total\s*$",
    re.I,
)
_TOTAL_HEADER = re.compile(r"^\s*Paid\s+Unpaid\s+In[ -]Kind\s+Total\s*$", re.I)
_PERIOD = re.compile(
    r"Period Covered:\s*(\d{2}/\d{2}/\d{4})\s+through\s+(\d{2}/\d{2}/\d{4})"
)
_STATES = set(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI AA AE AP".split()
)
_MAX_BYTES = 64 * 1024 * 1024
_MAX_PAGES = 2000
_MAX_TEXT = 24 * 1024 * 1024


def _decimal(value: str) -> Decimal:
    value = value.replace("$", "").replace(",", "")
    return -Decimal(value[1:-1]) if value.startswith("(") else Decimal(value)


def _values(match: re.Match) -> dict:
    return {key: format(_decimal(match[key]), ".2f") for key in _COLUMNS}


def _adds(values: dict) -> bool:
    return sum((Decimal(values[key]) for key in _COLUMNS[:-1]), Decimal(0)) == Decimal(
        values["total"]
    )


def _locator(page: int, line: int, text: str, sha256: str) -> dict:
    return {"source_sha256": sha256, "page": page, "line": line, "text": text}


def _address(lines: list[str], *, address_format_version: int = 2) -> dict:
    """Read only the printed locality. Unrecognised text is retained, not guessed."""
    if type(address_format_version) is not int or address_format_version not in (1, 2):
        raise ValueError("Unsupported address format version")
    result = {
        "lines": lines,
        "street": None,
        "city": None,
        "state": None,
        "postal_code": None,
        "geography_status": "missing" if not lines else "unknown",
    }
    if not lines:
        return result
    pattern = (
        r"(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-?\d{4})?)"
        if address_format_version == 1
        else r"(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-?\d{4}| \d{4}|,)?)"
    )
    match = re.fullmatch(pattern, lines[-1])
    if match:
        city, state, postal_code = match.groups()
        if (" " in postal_code or postal_code.endswith(",")) and state not in _STATES:
            return result
        # The two filed formatting variants keep their literal source lines.
        # Only the parsed ZIP changes to the existing hyphenated ZIP+4 form.
        postal_code = postal_code.removesuffix(",").replace(" ", "-")
        result.update(
            city=city.strip(),
            state=state,
            postal_code=postal_code,
            geography_status="filed_us" if state in _STATES else "unknown_state",
        )
        result["street"] = "\n".join(lines[:-1]) or None
    return result


def _identity(
    lines: list[dict], prefix: str = "", *, address_format_version: int = 2
) -> dict | None:
    if not lines:
        return None
    # Name lines align to the left edge; filed address lines are indented. A
    # second unindented name is never quietly treated as an address.
    names, addresses, in_address = [], [], False
    for loc in lines:
        text = loc["text"]
        stripped = text.strip()
        if prefix and not names:
            if not stripped.startswith(prefix):
                return None
            stripped = stripped[len(prefix) :].strip()
        if len(text) - len(text.lstrip()) >= 3:
            in_address = True
            addresses.append(stripped)
        elif in_address:
            return None
        else:
            names.append(stripped)
    if not names or not all(names):
        return None
    return {
        "name": "\n".join(names),
        "address": _address(addresses, address_format_version=address_format_version),
        "source": lines.copy(),
    }


def _pdf_pages(body: bytes):
    reader = PdfReader(io.BytesIO(body))
    if len(reader.pages) > _MAX_PAGES:
        raise ValueError("page limit exceeded")
    for page in reader.pages:
        yield page.extract_text(extraction_mode="layout") or ""


def extract_campaign_expenses(
    body: bytes,
    *,
    period_start: str,
    period_end: str,
    expected_totals: dict | None = None,
    address_format_version: int = 2,
) -> dict:
    """Return source-backed rows only when identity, dates and all totals check.

    ``expected_totals`` may contain paid (or cash), unpaid, in_kind and total.
    It is an additional comparison, never a replacement for PDF summary evidence.
    Outside-period dates and missing addresses are explicit row uncertainties; their
    presence does not invalidate an otherwise exact reading of the filed figures.
    Address format 1 replays the original grammar; 2 accepts the two additional
    filed ZIP formats without changing the record schema or literal source lines.
    """
    sha = hashlib.sha256(body).hexdigest()
    result = {
        "schema_version": 1,
        "source_sha256": sha,
        "status": "unavailable",
        "rows": [],
        "proposals": [],
        "itemized_totals": None,
        "non_itemized_totals": None,
        "schedule_totals": None,
        "summary_totals": None,
        "source_totals_locators": {},
        "period": None,
        "gaps": [],
        "errors": [],
        "layout": None,
    }
    errors = result["errors"]
    if type(address_format_version) is not int or address_format_version not in (1, 2):
        errors.append("unsupported_address_format_version")
        return result
    try:
        start, end = date.fromisoformat(period_start), date.fromisoformat(period_end)
        if start > end:
            raise ValueError
    except (ValueError, TypeError):
        errors.append("invalid_requested_period")
        return result
    if not body.startswith(b"%PDF") or len(body) > _MAX_BYTES:
        errors.append("unreadable_or_oversized_pdf")
        return result
    try:
        _read_pages(
            _pdf_pages(body),
            result,
            start,
            end,
            address_format_version=address_format_version,
        )
    except (
        PyPdfError,
        ValueError,
        KeyError,
        IndexError,
        TypeError,
        OSError,
        OverflowError,
    ) as exc:
        errors.append("pdf_read_failed:" + type(exc).__name__)
    if expected_totals is not None:
        for key in _COLUMNS:
            value = expected_totals.get(
                key, expected_totals.get("cash") if key == "paid" else None
            )
            try:
                if value is None or not Decimal(str(value)).is_finite():
                    raise ValueError
                if result["summary_totals"] is None or Decimal(str(value)) != Decimal(
                    result["summary_totals"][key]
                ):
                    errors.append("expected_summary_mismatch:" + key)
            except (ValueError, ArithmeticError):
                errors.append("invalid_expected_total:" + key)
    result["gaps"] = list(dict.fromkeys(result["gaps"] + errors))
    if not errors:
        result["status"] = "checked"
        result["rows"], result["proposals"] = result["proposals"], []
    else:
        result["status"] = "unavailable"
    return result


def _read_pages(
    pages, result: dict, start: date, end: date, *, address_format_version: int = 2
) -> None:
    sha, errors = result["source_sha256"], result["errors"]
    rows = result["proposals"]
    active = False
    found = False
    ended = False
    pending: list[dict] = []
    payee = vendor = None
    relationship = "direct"
    header_ready = False
    blank_payee = False
    header_source = None
    current_row = None
    group_rows: list[dict] = []
    reimbursement_rows: list[dict] = []
    reimbursement_payee = None
    totals: dict = {}
    text_size = 0
    summary_seen = 0
    skip_committee = False
    for page_num, text in enumerate(pages, 1):
        text_size += len(text)
        if text_size > _MAX_TEXT:
            raise ValueError("text limit exceeded")
        lines = text.splitlines()
        if page_num == 1:
            matches = list(_PERIOD.finditer(text))
            if len(matches) != 1:
                errors.append("missing_or_ambiguous_cover_period")
            else:
                m = matches[0]
                try:
                    actual = [
                        datetime.strptime(v, "%m/%d/%Y").date() for v in m.groups()
                    ]
                    result["period"] = dict(zip(("start", "end"), map(str, actual)))
                    result["source_totals_locators"]["period"] = _locator(
                        1, text[: m.start()].count("\n") + 1, m[0], sha
                    )
                    if actual != [start, end]:
                        errors.append("cover_period_mismatch")
                except ValueError:
                    errors.append("invalid_cover_period")
        if page_num == 2:
            headers = [
                s
                for s in lines
                if re.search(
                    r"^\s*B\s+Disbursements\s+Cash\s+Unpaid Bills\s+In-kind\s+Total\s*$",
                    s,
                )
            ]
            for line_num, line in enumerate(lines, 1):
                if re.match(
                    r"^\s*11\s+Campaign expenditures\s+Sch\.\s*B1\s*-\s*CE\s+",
                    line,
                    re.I,
                ):
                    summary_seen += 1
                    m = _AMOUNTS.fullmatch(line)
                    if m and len(headers) == 1:
                        values = _values(m)
                        result["summary_totals"] = values
                        result["source_totals_locators"]["summary"] = _locator(
                            2, line_num, line, sha
                        )
                        if not _adds(values):
                            errors.append("summary_arithmetic_mismatch")
                    else:
                        errors.append("unreadable_summary_columns")
        # The group may continue on a new page. A repeated explicit table header
        # can reuse it; a new pending name must resolve before any next transaction.
        for line_num, line in enumerate(lines, 1):
            stripped = line.strip()
            if not stripped:
                continue
            loc = _locator(page_num, line_num, line, sha)
            if _SCHEDULE.match(line):
                if _TARGET.match(line):
                    if ended:
                        errors.append("repeated_completed_schedule")
                    active = found = True
                    skip_committee = True
                else:
                    heading = _SCHEDULE.match(line)
                    if heading and re.sub(r"\s+", "", heading["code"]) == "B1-CE":
                        errors.append("unrecognized_campaign_schedule_heading")
                    if active:
                        active = False
                        if not ended:
                            errors.append("schedule_ended_without_totals")
                continue
            if not active:
                continue
            if skip_committee:
                skip_committee = False
                # The committee title is centred, distinct from a left-edge payee.
                if len(line) - len(line.lstrip()) >= 15:
                    continue
                errors.append("unrecognized_committee_header")
            if ("XSD Version:" in line and "Printed " in line) or re.fullmatch(
                r"Page\s+\d+", stripped
            ):
                continue
            if _TOTAL_HEADER.fullmatch(line):
                current_row = None
                continue
            if _HEADER.fullmatch(line):
                if pending:
                    blank_payee = False
                    vendor_at = [
                        i
                        for i, source_line in enumerate(pending)
                        if source_line["text"].strip().startswith("Vendor:")
                    ]
                    first = pending[0]["text"].strip()
                    prefix = next(
                        (
                            p
                            for p in ("Reimbursement:", "Credit card:")
                            if first.startswith(p)
                        ),
                        None,
                    )
                    if prefix:
                        if reimbursement_payee is not None:
                            errors.append(
                                f"unclosed_reimbursement:{page_num}:{line_num}"
                            )
                        cut = vendor_at[0] if len(vendor_at) == 1 else len(pending)
                        payee = _identity(
                            pending[:cut],
                            prefix,
                            address_format_version=address_format_version,
                        )
                        vendor = (
                            _identity(
                                pending[cut:],
                                "Vendor:",
                                address_format_version=address_format_version,
                            )
                            if cut < len(pending)
                            else None
                        )
                        relationship = (
                            "reimbursement"
                            if prefix == "Reimbursement:"
                            else "credit_card"
                        )
                        reimbursement_payee = payee
                        reimbursement_rows = []
                        if vendor is None:
                            errors.append(
                                f"missing_reimbursement_vendor:{page_num}:{line_num}"
                            )
                    elif first.startswith("Vendor:"):
                        payee = reimbursement_payee
                        vendor = _identity(
                            pending,
                            "Vendor:",
                            address_format_version=address_format_version,
                        )
                        if payee is None or vendor is None:
                            errors.append(
                                f"vendor_without_grouped_payee:{page_num}:{line_num}"
                            )
                    else:
                        if reimbursement_payee is not None:
                            errors.append(
                                f"unclosed_reimbursement:{page_num}:{line_num}"
                            )
                        payee, vendor = (
                            _identity(
                                pending, address_format_version=address_format_version
                            ),
                            None,
                        )
                        relationship = "direct"
                    if payee is None:
                        errors.append(f"ambiguous_payee_header:{page_num}:{line_num}")
                    pending = []
                    group_rows = []
                else:
                    # This form also prints complete tables whose payee and address
                    # fields are visibly blank. Preserve the checked amounts under
                    # an explicit unknown identity, never the preceding payee.
                    if reimbursement_payee is not None:
                        errors.append(
                            f"missing_grouped_vendor_header:{page_num}:{line_num}"
                        )
                    payee = vendor = None
                    relationship = "unknown"
                    blank_payee = True
                    group_rows = []
                    result["gaps"].append(f"payee_header_blank:{page_num}:{line_num}")
                header_source = loc
                header_ready = True
                current_row = None
                continue
            m = _AMOUNTS.fullmatch(line)
            label = m["label"].strip() if m else stripped
            total_key = {
                "Total of itemized": "itemized",
                "Total of non-itemized": "non_itemized",
                "Totals": "schedule",
            }.get(label)
            if total_key:
                if pending:
                    errors.append(
                        f"unresolved_header_before_totals:{page_num}:{line_num}"
                    )
                if reimbursement_payee is not None:
                    errors.append(f"unclosed_reimbursement:{page_num}:{line_num}")
                if not m or total_key in totals:
                    errors.append(f"unreadable_or_repeated_{total_key}_totals")
                    continue
                totals[total_key] = _values(m)
                result["source_totals_locators"][total_key] = loc
                if not _adds(totals[total_key]):
                    errors.append(total_key + "_arithmetic_mismatch")
                current_row = None
                if total_key == "schedule":
                    ended = True
                    active = False
                continue
            if (
                label == "Total"
                or label == "Total reimbursement for"
                or label.startswith("Total reimbursement for ")
            ):
                if not m:
                    errors.append(f"unreadable_subtotal:{page_num}:{line_num}")
                else:
                    values = _values(m)
                    is_group_total = label.startswith("Total reimbursement for")
                    subtotal_rows = reimbursement_rows if is_group_total else group_rows
                    result["source_totals_locators"].setdefault("groups", []).append(
                        {"label": label, "amounts": values, "source": loc}
                    )
                    for key in _COLUMNS:
                        if sum(
                            (Decimal(r["amounts"][key]) for r in subtotal_rows),
                            Decimal(0),
                        ) != Decimal(values[key]):
                            errors.append(
                                f"group_subtotal_mismatch:{page_num}:{line_num}:{key}"
                            )
                    if is_group_total:
                        stated_name = label.removeprefix(
                            "Total reimbursement for"
                        ).strip()
                        expected_name = (
                            reimbursement_payee["name"] if reimbursement_payee else None
                        )
                        # The form omits registered committee names on some total
                        # labels; its explicit opening header still identifies the
                        # group. Lobbyist/registration annotations are retained in
                        # the identity and removed only for this label comparison.
                        short_name = (
                            re.sub(
                                r"\s*\(Registered Id:.*\)\s*$", "", expected_name or ""
                            )
                            .removeprefix("Lobbyist:")
                            .strip()
                        )
                        if reimbursement_payee is None or (
                            stated_name
                            and stated_name not in (expected_name, short_name)
                        ):
                            errors.append(
                                f"reimbursement_subtotal_identity_mismatch:{page_num}:{line_num}"
                            )
                        reimbursement_payee = None
                        reimbursement_rows = []
                header_ready = False
                current_row = None
                continue
            if re.match(r"^\s{0,5}\d{1,2}/\d{1,2}/\d{2,4}\b", line):
                if not m or not re.match(r"^\d{2}/\d{2}/\d{4}\s+", label):
                    errors.append(f"unreadable_transaction:{page_num}:{line_num}")
                    current_row = None
                    continue
                raw_date, purpose = label.split(None, 1)
                try:
                    day = datetime.strptime(raw_date, "%m/%d/%Y").date()
                except ValueError:
                    errors.append(f"invalid_transaction_date:{page_num}:{line_num}")
                    current_row = None
                    continue
                if not header_ready or pending or (payee is None and not blank_payee):
                    errors.append(f"transaction_without_payee:{page_num}:{line_num}")
                values = _values(m)
                if not _adds(values):
                    errors.append(f"row_arithmetic_mismatch:{page_num}:{line_num}")
                uncertainties = (
                    ["payee_not_filed", "payee_address_missing"] if blank_payee else []
                )
                if not start <= day <= end:
                    uncertainties.append("date_outside_report_period")
                for role, identity in [("payee", payee), ("vendor", vendor)]:
                    if identity is not None:
                        if not identity["address"]["lines"]:
                            uncertainties.append(role + "_address_missing")
                        elif identity["address"]["geography_status"] != "filed_us":
                            uncertainties.append(role + "_geography_unknown_or_foreign")
                        if identity["address"]["street"] is None:
                            uncertainties.append(role + "_street_not_filed")
                current_row = {
                    "source_row_id": f"{sha}:{page_num}:{line_num}",
                    "payee": payee,
                    "underlying_vendor": vendor,
                    "relationship": relationship,
                    "date": str(day),
                    "raw_date": raw_date,
                    "purpose": purpose,
                    "amounts": values,
                    "raw_amounts": {k: m[k] for k in _COLUMNS},
                    "source": [loc],
                    "payee_header_source": header_source,
                    "uncertainties": uncertainties,
                }
                rows.append(current_row)
                group_rows.append(current_row)
                if reimbursement_payee is not None:
                    reimbursement_rows.append(current_row)
                continue
            # A column-labelled but unsupported header must not become a vendor name.
            if stripped.startswith("Date ") or m:
                errors.append(f"unrecognized_table_line:{page_num}:{line_num}")
                header_ready = False
                current_row = None
                continue
            indent = len(line) - len(line.lstrip())
            if current_row is not None and 10 <= indent < 45 and not pending:
                current_row["purpose"] += "\n" + stripped
                current_row["source"].append(loc)
            else:
                # A fresh left-edge block invalidates inheritance from the prior
                # payee immediately, even if its Date header is missing or shifted.
                pending.append(loc)
                current_row = None
        # End page
    if summary_seen != 1 or result["summary_totals"] is None:
        errors.append("missing_or_ambiguous_pdf_summary")
    if not found:
        # Absent schedules are only a proved zero when the exact cover and all four
        # summary columns explicitly say zero. Expected totals alone cannot prove it.
        if result["summary_totals"] and all(
            Decimal(v) == 0 for v in result["summary_totals"].values()
        ):
            zero = {key: "0.00" for key in _COLUMNS}
            totals = {
                key: zero.copy() for key in ("itemized", "non_itemized", "schedule")
            }
            result["gaps"].append("schedule_absent_explicit_zero_summary")
        else:
            errors.append("campaign_expense_schedule_missing")
    elif not ended:
        errors.append("incomplete_schedule")
    for key in ("itemized", "non_itemized", "schedule"):
        if key not in totals:
            errors.append("missing_" + key + "_totals")
    if len(totals) == 3:
        for col in _COLUMNS:
            observed = sum((Decimal(row["amounts"][col]) for row in rows), Decimal(0))
            if observed != Decimal(totals["itemized"][col]):
                errors.append("itemized_rows_mismatch:" + col)
            combined = Decimal(totals["itemized"][col]) + Decimal(
                totals["non_itemized"][col]
            )
            if combined != Decimal(totals["schedule"][col]):
                errors.append("schedule_totals_mismatch:" + col)
            if result["summary_totals"] and combined != Decimal(
                result["summary_totals"][col]
            ):
                errors.append("summary_schedule_mismatch:" + col)
        result["itemized_totals"] = totals["itemized"]
        result["non_itemized_totals"] = totals["non_itemized"]
        result["schedule_totals"] = totals["schedule"]
    result["layout"] = "current_b1_ce_4_columns" if found else "absent_schedule"
    # Retain a concise gap index beside the proposals; exact offending lines remain
    # in source locations, and the unchanged PDF hash identifies the whole source.
    result["gaps"].extend(errors)
