"""Read one supported native Minnesota local financial-report cover.

This extracts source facts only. It neither identifies a filing authority or a
candidacy nor approves a report. Scans, certification forms and other layouts
need separate readers. Purpose text never becomes a payee identity.
"""

from datetime import date
from decimal import Decimal
import hashlib
import re

from alethical.pipeline.election_fec_paper_identity import (
    FecPaperIdentityError,
    _native_words,
)

MAX_BYTES = 16 * 1024 * 1024
LAYOUT = "mn-local-financial-report-native-letter:v1"


class LocalFinancialFormError(ValueError):
    """The original cannot support this exact native-form extraction."""


def _require(condition, message):
    if not condition:
        raise LocalFinancialFormError(message)


def _field(words, bounds, *, optional=False, single_line=False):
    x0, y0, x1, y1 = bounds
    selected = []
    for box, text in words:
        intersects = box[0] < x1 and x0 < box[2] and box[1] < y1 and y0 < box[3]
        contains = x0 <= box[0] and y0 <= box[1] and box[2] <= x1 and box[3] <= y1
        _require(not intersects or contains, "Text crosses the supported field bounds")
        if contains:
            selected.append({"bounds": list(box), "text": text})
    text = " ".join(item["text"] for item in selected)
    _require(optional or bool(text), "Required native field is absent")
    if single_line and selected:
        centers = [(item["bounds"][1] + item["bounds"][3]) / 2 for item in selected]
        height = min(item["bounds"][3] - item["bounds"][1] for item in selected)
        _require(
            height > 0 and max(centers) - min(centers) <= height * 0.4,
            "Scalar field contains multiple or ambiguous native lines",
        )
        _require(
            all(
                left["bounds"][2] <= right["bounds"][0]
                for left, right in zip(selected, selected[1:])
            ),
            "Scalar field has overlapping or unordered native text",
        )
    return {"page": 1, "bounds": list(bounds), "text": text, "words": selected}


def _label(words, bounds, expected):
    value = _field(words, bounds)
    _require(value["text"] == expected, "Unsupported financial-report template")


def _money(field):
    raw = field["text"]
    _require(
        len(raw) <= 64
        and re.fullmatch(
            r"\$?(?:0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:,[0-9]{3})+)(?:\.[0-9]{2})?", raw
        ),
        "Amount is absent, ambiguous or unsupported",
    )
    return format(Decimal(raw.removeprefix("$").replace(",", "")), ".2f")


def _minor_units(amount):
    # Parsed amounts have exactly two decimal places. Integer arithmetic keeps
    # every cent, including when the caller changed Decimal's global precision.
    return int(amount.replace(".", ""))


def _amount(minor_units):
    sign = "-" if minor_units < 0 else ""
    absolute = abs(minor_units)
    return f"{sign}{absolute // 100}.{absolute % 100:02d}"


def _reject_unassigned(words, bounds, fields, symbols=()):
    """A value shifted into a printed cell's gutter is not a blank field."""
    known = {
        (tuple(word["bounds"]), word["text"])
        for field in fields
        for word in field["words"]
    }
    x0, y0, x1, y1 = bounds
    for box, text in words:
        if box[0] < x1 and x0 < box[2] and box[1] < y1 and y0 < box[3]:
            _require(
                (box, text) in known or text in symbols,
                "Unassigned native text in a financial value region",
            )


def _date(raw):
    match = re.fullmatch(
        r"([0-9]{1,2})\s*/\s*([0-9]{1,2})\s*/\s*([0-9]{2}|[0-9]{4})", raw
    )
    _require(match is not None, "Reporting date needs its literal year")
    month, day, year = (int(v) for v in match.groups())
    if len(match[3]) == 2:
        year += 2000
    _require(year in {2025, 2026}, "Date is outside the supported 2026 election scope")
    try:
        return date(year, month, day).isoformat()
    except ValueError as exc:
        raise LocalFinancialFormError("Invalid source calendar date") from exc


def _read_words(words, fingerprint):
    # Fixed labels and native page coordinates identify this form. The caller
    # cannot supply a layout, field box, expected value or executable command.
    labels = [
        (
            (130, 10, 485, 66),
            "Campaign Financial Report All information in this report is public.",
        ),
        ((25, 75, 150, 94), "Report Information"),
        ((30, 101, 196, 116), "Name of candidate or committee"),
        ((30, 124, 96, 139), "Office sought"),
        ((25, 200, 175, 221), "Contributions Received"),
        ((35, 294, 224, 312), "DURING REPORTING PERIOD"),
        ((38, 313, 230, 330), "MONETARY CONTRIBUTIONS"),
        ((38, 330, 230, 347), "IN-KIND CONTRIBUTIONS VALUE"),
        ((38, 347, 230, 364), "TOTAL AMOUNT RECEIVED"),
        ((307, 312, 521, 330), "CURRENT TOTAL AMOUNT ON HAND"),
        ((25, 377, 125, 397), "Disbursements"),
        ((38, 425, 75, 444), "Date"),
        ((115, 425, 175, 444), "Purpose"),
        ((478, 425, 535, 444), "Amount"),
        ((234, 617, 270, 637), "Total"),
    ]
    for box, expected in labels:
        _label(words, box, expected)
    identity = {
        "name": _field(words, (197, 98, 585, 115), single_line=True),
        "office": _field(words, (97, 121, 585, 137), single_line=True),
    }
    dates = _field(words, (393, 170, 585, 188), single_line=True)
    match = re.fullmatch(r"From (.+) to (.+)", dates["text"])
    _require(match is not None, "The full reporting interval is absent")
    start, end = _date(match[1]), _date(match[2])
    _require(start <= end, "Source reporting interval is reversed")

    figures = {}
    for name, label, box in [
        ("monetary_contributions", "MONETARY CONTRIBUTIONS", (258, 312, 305, 330)),
        ("in_kind_contributions", "IN-KIND CONTRIBUTIONS VALUE", (258, 330, 305, 347)),
        ("total_received", "TOTAL AMOUNT RECEIVED", (258, 347, 305, 364)),
        ("amount_on_hand", "CURRENT TOTAL AMOUNT ON HAND", (532, 311, 585, 330)),
        ("disbursements", "Total disbursements", (480, 617, 580, 638)),
    ]:
        source = _field(words, box, optional=True, single_line=True)
        figures[name] = {
            "label": label,
            "amount": _money(source) if source["text"] else None,
            "currency": "USD",
            "source": source,
        }
    _reject_unassigned(
        words,
        (230, 311, 306, 365),
        [
            figures[k]["source"]
            for k in (
                "monetary_contributions",
                "in_kind_contributions",
                "total_received",
            )
        ],
        symbols=("$", "+", "="),
    )
    _reject_unassigned(
        words,
        (521, 310, 585, 331),
        [figures["amount_on_hand"]["source"]],
        symbols=("$",),
    )
    _reject_unassigned(
        words, (469, 615, 581, 640), [figures["disbursements"]["source"]]
    )
    # Row boundaries are the printed cells, not guessed from a nearby number.
    rows = []
    row_fields = []
    boundaries = (443.5, 464.5, 485.5, 507, 528, 549.5, 571, 592, 615)
    for index, (top, bottom) in enumerate(zip(boundaries, boundaries[1:]), 1):
        fields = {
            "date": _field(
                words, (31, top, 105, bottom), optional=True, single_line=True
            ),
            "purpose": _field(words, (106, top, 468, bottom), optional=True),
            "amount": _field(
                words, (469, top, 580, bottom), optional=True, single_line=True
            ),
        }
        row_fields.extend(fields.values())
        if not any(f["text"] for f in fields.values()):
            continue
        _require(all(f["text"] for f in fields.values()), "Incomplete disbursement row")
        value_date = _date(fields["date"]["text"])
        _require(
            start <= value_date <= end, "Disbursement is outside the stated interval"
        )
        rows.append(
            {
                "source_row_id": f"{fingerprint}:page1:disbursements:{index}",
                "date": value_date,
                "purpose": fields["purpose"]["text"],
                "amount": _money(fields["amount"]),
                "currency": "USD",
                "payee": None,
                "payee_address": None,
                "source": fields,
            }
        )
    _reject_unassigned(words, (30, 443.5, 581, 615), row_fields)
    listed = sum(_minor_units(r["amount"]) for r in rows) if rows else None
    total = figures["disbursements"]["amount"]
    receipts = [
        figures[k]["amount"]
        for k in ("monetary_contributions", "in_kind_contributions", "total_received")
    ]
    receipts_match = (
        None
        if any(v is None for v in receipts)
        else _minor_units(receipts[0]) + _minor_units(receipts[1])
        == _minor_units(receipts[2])
    )
    listed_match = (
        None if listed is None or total is None else listed == _minor_units(total)
    )
    gaps = [
        "report_kind_mark_not_checked",
        "reporting_kind_mark_not_checked",
        "payees_not_in_this_table",
        "attachments_not_checked",
    ]
    gaps.extend(
        f"{name}_not_in_source"
        for name, figure in figures.items()
        if figure["amount"] is None
    )
    if not rows:
        gaps.append("no_disbursement_rows_in_first_page_table")
    if receipts_match is False:
        gaps.append("receipt_totals_do_not_reconcile")
    if listed_match is False:
        gaps.append("first_page_rows_do_not_sum_to_printed_disbursements")
    return {
        "layout": LAYOUT,
        "source_sha256": fingerprint,
        "source_page": 1,
        "name": identity["name"]["text"],
        "office": identity["office"]["text"],
        "identity_sources": identity,
        "period_start": start,
        "period_end": end,
        "period_source": dates,
        # Native text alone does not prove a radio/check mark's visual meaning.
        "report_kind": None,
        "reporting_kind": None,
        "figures": figures,
        "listed_disbursements": rows,
        "listed_disbursement_total": _amount(listed) if listed is not None else None,
        "listed_minus_reported": _amount(listed - _minor_units(total))
        if listed is not None and total is not None
        else None,
        "receipts_reconcile": receipts_match,
        "listed_disbursements_reconcile": listed_match,
        "reconciliation_scope": "first_page_rows_against_printed_total",
        "attachment_coverage": "not_checked",
        "identity_or_authority_approved": False,
        "financial_figures_approved": False,
        "gaps": gaps,
    }


def read_native_local_report(body: bytes):
    """Return exact first-page facts; never fall back to unchecked OCR text."""
    _require(
        isinstance(body, bytes)
        and 0 < len(body) <= MAX_BYTES
        and body.startswith(b"%PDF-"),
        "Expected bounded original PDF bytes",
    )
    try:
        words = _native_words(body)
    except FecPaperIdentityError as exc:
        raise LocalFinancialFormError(
            "Unsupported or unreadable native local report"
        ) from exc
    return _read_words(words, hashlib.sha256(body).hexdigest())
