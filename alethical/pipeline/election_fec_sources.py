"""Reconstruct selected FEC filing facts from retained electronic originals.

This is a source parser, not an identity review, amendment resolver or complete
FEC validator. It extracts no Schedule A donor data. Unsupported covers and
unsupported text encodings fail closed; other schedules remain unextracted.

Column numbers below were checked against both official workbooks, not inferred
from a downloaded filing. Version 8.5 changes F1S's layout at column 5. Evidence
is an explicitly structured selection of exact cells, never a fabricated quote
of an entire row. Row and column numbers are one-based.
"""

from __future__ import annotations

from copy import deepcopy
import csv
import io
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from functools import lru_cache
import hashlib
import json
import re
from urllib.parse import urlsplit


ADAPTER_ID = "fec_raw:v1"
MAX_ADDRESS_SOURCE_BYTES = 64 * 1024 * 1024
SPECIFICATIONS = {
    "8.4": "9d3775d73e9398144b0e0267415ba53e1b5c6a326110b327ce2cd58d233bf3d6",
    "8.5": "c667016493df28c186445201cf8a2bcff43563bccc41b75b2bcc06366b69132b",
}
SPECIFICATION_URL = (
    "https://docquery.fec.gov/formatspecs/FEC_EFO_Format_Specifications.xlsx"
)
_COMMITTEE = re.compile(r"C[0-9]{8}")
_CANDIDATE = re.compile(r"[HSP][0-9A-Z]{8}")
_MONEY = re.compile(r"-?[0-9]+(?:\.[0-9]{2})?")
_COVERS = {
    "F1N": ("F1", 101),
    "F1A": ("F1", 101),
    "F2N": ("F2", 43),
    "F2A": ("F2", 43),
    "F3N": ("F3", 93),
    "F3A": ("F3", 93),
    "F3T": ("F3", 93),
    "F3XN": ("F3X", 123),
    "F3XA": ("F3X", 123),
    "F3XT": ("F3X", 123),
    "F5N": ("F5", 30),
    "F5A": ("F5", 30),
    "F5T": ("F5", 30),
}


# Official main-form selectors in both retained 8.4/8.5 workbooks. Recognition
# is independent of financial extraction support: a second main cover remains
# ambiguous even when that form has no parser. Secondary forms/schedules such
# as F1S, F3Z1/2, F56/57 and F65 are deliberately outside this set.
_MAIN_COVER_TYPES = frozenset(
    {"F99"}
    | {
        f"{form}{suffix}"
        for form, suffixes in {
            "F1": "NA",
            "F1M": "NA",
            "F2": "NA",
            "F24": "NA",
            "F3": "NAT",
            "F3P": "NAT",
            "F3X": "NAT",
            "F3L": "NA",
            "F4": "NAT",
            "F5": "NAT",
            "F6": "NA",
            "F7": "NAT",
            "F9": "NA",
            "F13": "NA",
        }.items()
        for suffix in suffixes
    }
)


class FecSourceError(ValueError):
    """An original cannot prove the requested fact with this parser."""


@dataclass(frozen=True)
class FecExtraction:
    locator: dict
    facts: dict
    quote: str


@dataclass(frozen=True)
class FecFiling:
    version: str
    file_number: str
    original_report_id: str | None
    amendment_number: str | None
    records: tuple[FecExtraction, ...]
    # Only schedule codes, never the contents of an unsupported row.
    unextracted_forms: tuple[str, ...]
    unextracted_rows: tuple[FecRowIssue, ...]
    rejected_rows: tuple[FecRowIssue, ...]


@dataclass(frozen=True, slots=True)
class FecRowIssue:
    row: int
    form: str | None
    reason: str


class _Row:
    def __init__(self, raw: bytes, number: int, width: int):
        self.number = number
        self.cells = raw.split(b"\x1c")
        # A final separator is not a new unspecified field.
        if len(self.cells) == width + 1 and self.cells[-1] == b"":
            self.cells.pop()
        if len(self.cells) > width:
            raise FecSourceError(f"Row {number} has unspecified columns")
        # The specification expressly permits unused trailing fields to be absent.
        self.cells.extend([b""] * (width - len(self.cells)))
        self.selected: dict[int, str] = {}

    def text(self, column: int, *, required=False, limit=200) -> str:
        try:
            value = self.cells[column - 1].decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise FecSourceError(
                f"Row {self.number} column {column} has unsupported encoding"
            ) from exc
        if (
            (required and not value)
            or len(value) > limit
            or any(ord(char) < 32 for char in value)
        ):
            raise FecSourceError(f"Row {self.number} column {column} is invalid")
        self.selected[column] = value
        return value

    def identifier(self, column: int, *, candidate=False, required=False):
        value = self.text(column, required=required, limit=9)
        pattern = _CANDIDATE if candidate else _COMMITTEE
        if value and pattern.fullmatch(value) is None:
            raise FecSourceError(f"Row {self.number} has an invalid FEC identifier")
        return value or None

    def day(self, column: int, *, required=False):
        value = self.text(column, required=required, limit=8)
        if not value:
            return None
        try:
            if re.fullmatch(r"[0-9]{8}", value) is None:
                raise ValueError
            return date(int(value[:4]), int(value[4:6]), int(value[6:])).isoformat()
        except ValueError as exc:
            raise FecSourceError(f"Row {self.number} has an invalid date") from exc

    def money(self, column: int, *, required=False):
        value = self.text(column, required=required, limit=12)
        if not value:
            return None
        if _MONEY.fullmatch(value) is None:
            raise FecSourceError(f"Row {self.number} has an invalid amount")
        # Decimal never passes through a float; retain the filed precision.
        return format(Decimal(value), "f")

    def extraction(self, kind: str, facts: dict, *, column: int | None = None):
        locator: dict = {"kind": kind, "row": self.number}
        if column is not None:
            locator["column"] = column
        cells = [
            {"row": self.number, "column": index, "raw": value}
            for index, value in sorted(self.selected.items())
        ]
        quote = json.dumps(
            {"format": "fec-selected-cells-v1", "cells": cells},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return FecExtraction(locator, facts, quote)


def _name(row: _Row, first_column: int):
    parts = {
        name: row.text(first_column + offset, limit=limit)
        for offset, (name, limit) in enumerate(
            [
                ("last", 30),
                ("first", 20),
                ("middle", 20),
                ("prefix", 10),
                ("suffix", 10),
            ]
        )
    }
    # This is a display rendering, never a matching key or an alias decision.
    return parts, " ".join(
        parts[key]
        for key in ("prefix", "first", "middle", "last", "suffix")
        if parts[key]
    )


def _office(
    row: _Row,
    office_col: int,
    state_col: int,
    district_col: int,
    *,
    blank_optional_district=False,
):
    office = row.text(office_col, limit=1)
    state = row.text(state_col, limit=2)
    district = row.text(district_col, limit=2)
    if blank_optional_district and not office and not state and district in {" ", "  "}:
        # Optional SB geography only; preserve the literal selected cell.
        district = ""
    if (
        (office and office not in {"H", "S", "P"})
        or (state and re.fullmatch(r"[A-Z]{2}", state) is None)
        or (district and re.fullmatch(r"[0-9]{2}", district) is None)
    ):
        raise FecSourceError(f"Row {row.number} has invalid office fields")
    return {
        "office": office or None,
        "state": state or None,
        "district": district or None,
    }


def _identity(row: _Row, form: str) -> FecExtraction:
    row.text(1, required=True, limit=4)
    if form == "F1":
        facts = {
            "authority": "fec",
            "account_id": row.identifier(2, required=True),
            "name": row.text(4, required=True),
            "effective_date": row.day(15),
            "signed_date": row.day(21),
            "committee_type": row.text(22, required=True, limit=1),
            "source_candidate_id": row.identifier(23, candidate=True),
        }
        if facts["committee_type"] not in set("ABCDEFGHIJ"):
            raise FecSourceError("F1 has an unsupported committee type")
        parts, display = _name(row, 24)
        facts.update(candidate_name=display or None, candidate_name_parts=parts)
        facts.update(_office(row, 29, 30, 31))
        facts["designation"] = {"A": "principal", "B": "authorized"}.get(
            facts["committee_type"], "not_an_authorized_designation"
        )
    else:
        candidate_id = row.identifier(2, candidate=True, required=True)
        parts, display = _name(row, 3)
        if not parts["last"] or not parts["first"]:
            raise FecSourceError("F2 lacks required candidate name fields")
        year = row.text(23, required=True, limit=4)
        if re.fullmatch(r"[12][0-9]{3}", year) is None:
            raise FecSourceError("F2 has an invalid election year")
        facts = {
            "authority": "fec",
            "source_candidate_id": candidate_id,
            "candidate_name": display,
            "candidate_name_parts": parts,
            "election_year": year,
            "party_code": row.text(19, limit=3),
            "signed_date": row.day(43, required=True),
            "principal_account_id": row.identifier(24),
            "principal_account_name": row.text(25),
            "authorized_account_id": row.identifier(31),
            "authorized_account_name": row.text(32),
        }
        facts.update(_office(row, 20, 21, 22))
    return row.extraction("identity", facts)


# Exact labels and columns from the source workbooks. Summary duplicates are
# deliberately not additional measures. Column B is preserved separately below.
_FIGURES = {
    "F3": {
        39: ("contributions", "11(e) Total Contributions"),
        46: ("receipts", "16. Total Receipts"),
        47: ("operating_expenditures", "17. Operating Expenditures"),
        57: ("total_disbursements", "22. Total Disbursements"),
        58: ("cash_on_hand_beginning", "23. Cash Beginning Reporting Period"),
        62: ("cash_on_hand_close", "27. Cash on hand at Close Period"),
    },
    "F3X": {
        35: ("contributions", "11(d) Total Contributions"),
        45: ("receipts", "19. Total Receipts"),
        46: ("federal_receipts", "20. Total Federal Receipts"),
        50: ("operating_expenditures", "21(c)  Total Operating Expenditures"),
        66: ("total_disbursements", "31. Total Disbursements"),
        67: ("federal_disbursements", "32. Total Federal Disbursements"),
        71: (
            "federal_operating_expenditures",
            "36. Total Federal Operating Expenditures",
        ),
        23: ("cash_on_hand_beginning", "6(b) Cash on Hand beginning"),
        27: ("cash_on_hand_close", "8. Cash on Hand at Close"),
    },
}
_YTD_FIGURES = {
    85: ("contributions", "11(d) Total Contributions"),
    95: ("receipts", "19. Total Receipts"),
    96: ("federal_receipts", "20. Total Federal Receipts"),
    100: ("operating_expenditures", "21(c) Total operating Expenditures"),
    116: ("total_disbursements", "31. Total Disbursements"),
    117: ("federal_disbursements", "32. Total Federal Disbursements"),
    121: ("federal_operating_expenditures", "36. Total Federal Operating Expenditures"),
    74: ("cash_on_hand_beginning", " 6(a) Cash on Hand Jan 1, 19"),
    79: ("cash_on_hand_close", "8. Cash on Hand Close"),
}


def _report(row: _Row, form: str, file_number: str):
    if form == "F5":
        return _f5_report(row, file_number)
    row.text(1, required=True, limit=5)
    account = row.identifier(2, required=True)
    name = row.text(3, required=True)
    code_col, start_col, signed_col = (12, 16, 23) if form == "F3" else (10, 14, 22)
    code = row.text(code_col, required=True, limit=3)
    if re.fullmatch(r"[A-Z0-9]{1,3}", code) is None:
        raise FecSourceError("Cover has an invalid report code")
    start, end = (
        row.day(start_col, required=True),
        row.day(start_col + 1, required=True),
    )
    if start > end:
        raise FecSourceError("Cover reporting dates are reversed")
    signed = row.day(signed_col, required=True)
    amounts = {}
    for column in range(signed_col + 1, len(row.cells) + 1):
        if form == "F3X" and column == 75:
            continue
        amounts[str(column)] = row.money(column)
    # Raw cumulative cells remain named by their actual column. An F3 original
    # supplies no start date for Column B, so no start is manufactured here.
    cumulative_year_raw = row.text(75, limit=200) if form == "F3X" else None
    cumulative_year = cumulative_year_raw
    cumulative_gap = bool(cumulative_year) and (
        re.fullmatch(r"[12][0-9]{3}", cumulative_year) is None
        or int(cumulative_year) > int(end[:4])
    )
    if cumulative_gap:
        cumulative_year = None
    cover = row.extraction(
        "cover",
        {
            "authority": "fec",
            "account_id": account,
            "name": name,
            "source_report_id": file_number,
            "form": form,
            "form_type": row.selected[1],
            "report_code": code,
            "report_type": f"{form}:{code}",
            "period_start": start,
            "period_end": end,
            "signed_date": signed,
            "amounts_by_column": amounts,
            "cumulative_year_raw": cumulative_year_raw,
            "cumulative_status": "unsupported"
            if cumulative_gap
            else "stated"
            if cumulative_year
            else "not_stated",
            "cumulative_start": f"{cumulative_year}-01-01" if cumulative_year else None,
            "cumulative_first_column": 63 if form == "F3" else 74,
        },
    )
    gaps = []
    if cumulative_gap:
        selected = row.selected
        row.selected = {c: selected[c] for c in (1, 2, start_col, start_col + 1, 75)}
        gaps.append(
            row.extraction(
                "gap",
                {
                    "authority": "fec",
                    "account_id": account,
                    "source_report_id": file_number,
                    "scope": "calendar_year_to_date",
                    "reason": "invalid_cumulative_year",
                    "raw_value": cumulative_year_raw,
                },
                column=75,
            )
        )
        row.selected = selected
    figures = []
    column_figures = [
        (column, measure, label, "report_period", start)
        for column, (measure, label) in _FIGURES[form].items()
    ]
    if form == "F3X" and cumulative_year:
        column_figures.extend(
            (
                column,
                f"ytd_{measure}",
                label,
                "calendar_year_to_date",
                f"{cumulative_year}-01-01",
            )
            for column, (measure, label) in _YTD_FIGURES.items()
        )
    for column, measure, label, basis, figure_start in column_figures:
        value = amounts[str(column)]
        if value is None:
            continue
        # Each figure proves its exact cell and the source reporting period.
        selected = row.selected
        evidence_columns = (1, 2, start_col, start_col + 1, column)
        if basis == "calendar_year_to_date":
            evidence_columns = (*evidence_columns, 75)
        row.selected = {c: selected[c] for c in evidence_columns}
        figures.append(
            row.extraction(
                "figure",
                {
                    "authority": "fec",
                    "account_id": account,
                    "source_report_id": file_number,
                    "measure": f"fec_{measure}",
                    "label": label,
                    "value": value,
                    "unit": "dollars",
                    "currency": "USD",
                    "basis": basis,
                    "source_column": column,
                    "period_start": figure_start,
                    "period_end": end,
                },
                column=column,
            )
        )
        row.selected = selected
    return [cover, *gaps, *figures]


def _f5_report(row: _Row, file_number: str):
    form_type = row.text(1, required=True, limit=4)
    account = row.identifier(2, required=True)
    entity = row.text(3, required=True, limit=3)
    if entity not in {"IND", "ORG"}:
        raise FecSourceError("F5 has an unsupported filer entity type")
    name = row.text(4) if entity == "ORG" else _name(row, 5)[1]
    if not name:
        raise FecSourceError("F5 lacks a named filer")
    periodic = row.text(18, limit=3)
    notice = row.text(19, limit=2)
    if (
        bool(periodic) == bool(notice)
        or (periodic and periodic not in {"Q1", "Q2", "Q3", "Q4", "YE"})
        or (notice and notice not in {"24", "48"})
    ):
        raise FecSourceError("F5 needs one supported periodic or notice report code")
    original_date = row.day(20, required=form_type == "F5A")
    start, end = row.day(21, required=True), row.day(22, required=True)
    if start > end:
        raise FecSourceError("F5 reporting dates are reversed")
    signed = row.day(30, required=True)
    amounts = {"23": row.money(23), "24": row.money(24, required=True)}
    code = periodic or notice
    basis = "report_period" if periodic else "notice_period"
    cover = row.extraction(
        "cover",
        {
            "authority": "fec",
            "account_id": account,
            "name": name,
            "source_report_id": file_number,
            "form": "F5",
            "form_type": form_type,
            "report_code": code,
            "report_type": f"F5:{code}",
            "period_start": start,
            "period_end": end,
            "signed_date": signed,
            "original_amendment_date": original_date,
            "basis": basis,
            "entity_type": entity,
            "amounts_by_column": amounts,
        },
    )
    figures = []
    for column, measure, label in (
        (23, "contributions", "Total Contribution"),
        (24, "independent_expenditures", "Total Independent Expenditure"),
    ):
        value = amounts[str(column)]
        if value is None:
            continue
        selected = row.selected
        row.selected = {c: selected[c] for c in (1, 2, 18, 19, 21, 22, column)}
        figure_measure = f"fec_{measure}" if periodic else f"fec_notice_{measure}"
        figures.append(
            row.extraction(
                "figure",
                {
                    "authority": "fec",
                    "account_id": account,
                    "source_report_id": file_number,
                    "measure": figure_measure,
                    "label": label,
                    "value": value,
                    "unit": "dollars",
                    "currency": "USD",
                    "basis": basis,
                    "source_column": column,
                    "period_start": start,
                    "period_end": end,
                },
                column=column,
            )
        )
        row.selected = selected
    return [cover, *figures]


def _f57_payment(row: _Row, cover: dict, file_number: str):
    row.text(1, required=True, limit=3)
    account = row.identifier(2, required=True)
    if account != cover["account_id"]:
        raise FecSourceError("F57 filer differs from its cover")
    transaction = row.text(3, required=True, limit=20)
    entity = row.text(4, required=True, limit=3)
    if entity not in {"CAN", "CCM", "COM", "IND", "ORG", "PAC", "PTY"}:
        raise FecSourceError("F57 has an unsupported payee entity type")
    organization = row.text(5)
    parts, person = _name(row, 6)
    payee = person if entity in {"IND", "CAN"} else organization
    if not payee:
        raise FecSourceError("F57 has no payee")
    election = row.text(16, required=True, limit=5)
    if re.fullmatch(r"[GPO][12][0-9]{3}", election) is None:
        raise FecSourceError("F57 has an unsupported election code")
    day = row.day(18, required=True)
    amount = row.money(19, required=True)
    ytd = row.money(20)
    purpose = row.text(21, limit=100)
    category = row.text(22, limit=3)
    payee_committee = row.identifier(23)
    support = row.text(24, limit=1)
    if support not in {"", "S", "O"}:
        raise FecSourceError("F57 has an invalid support/oppose code")
    target = row.identifier(25, candidate=True)
    target_parts, target_name = _name(row, 26)
    office = _office(row, 31, 32, 33)
    # The inspected F57 specification has no memo or back-reference columns.
    # F3X Schedule E retains its independently specified memo/back-reference fields.
    return row.extraction(
        "payment",
        {
            "authority": "fec",
            "account_id": account,
            "source_row_id": str(row.number),
            "source_report_id": file_number,
            "transaction_id": transaction,
            "schedule": "F57",
            "date": day,
            "dissemination_date": day,
            "disbursement_date": None,
            "target_source_candidate_id": target,
            "target_candidate_name": target_name or None,
            "target_candidate_name_parts": target_parts,
            "target_office": office,
            "entity_type": entity,
            "payee": payee,
            "payee_name_parts": parts,
            "purpose": purpose,
            "amount": amount,
            "currency": "USD",
            "direction": {"S": "independent_for", "O": "independent_against"}.get(
                support, "unknown"
            ),
            "transaction_type": f"F5:{cover['report_code']}:F57",
            "election_code": election,
            "support_oppose_code": support or None,
            "calendar_ytd_per_election_office": ytd,
            "category_code": category,
            "payee_committee_id": payee_committee,
            "memo": {
                "code": None,
                "text": None,
                "back_reference_transaction_id": None,
                "back_reference_schedule": None,
            },
        },
    )


def _payment(row: _Row, form: str, cover: dict, file_number: str):
    schedule = row.text(1, required=True, limit=8)
    account = row.identifier(2, required=True)
    if account != cover["account_id"]:
        raise FecSourceError("Schedule filer differs from its cover")
    transaction = row.text(3, required=True, limit=20)
    back = row.text(4, limit=20)
    back_schedule = row.text(5, limit=8)
    entity = row.text(6, required=True, limit=3)
    if entity not in {"CAN", "CCM", "COM", "IND", "ORG", "PAC", "PTY"}:
        raise FecSourceError("Schedule has an unsupported entity type")
    organization = row.text(7)
    parts, person = _name(row, 8)
    payee = person if entity in {"IND", "CAN"} else organization
    if not payee:
        raise FecSourceError("Schedule has no payee")
    election = row.text(18, limit=5)
    if election and re.fullmatch(r"[GPRSCEO][12][0-9]{3}", election) is None:
        raise FecSourceError("Schedule has an invalid election code")
    amount = row.money(21, required=True)
    if form == "SE":
        dissemination, disbursement = row.day(20), row.day(22)
        if not (dissemination or disbursement):
            raise FecSourceError("Schedule E has neither event date")
        support = row.text(27, limit=1)
        if support not in {"", "S", "O"}:
            raise FecSourceError("Schedule E has an invalid support/oppose code")
        target = row.identifier(28, candidate=True)
        target_parts, target_name = _name(row, 29)
        office = _office(row, 34, 36, 35)
        purpose = row.text(24, limit=100)
        memo_code, memo_text = row.text(43, limit=1), row.text(44, limit=100)
        direction = {"S": "independent_for", "O": "independent_against"}.get(
            support, "unknown"
        )
        day = dissemination or disbursement
        extra = {
            "dissemination_date": dissemination,
            "disbursement_date": disbursement,
            "calendar_ytd_per_election_office": row.money(23),
            "support_oppose_code": support or None,
            "payee_committee_id": row.identifier(26),
        }
    else:
        day = row.day(20, required=True)
        target = row.identifier(27, candidate=True)
        target_parts, target_name = _name(row, 28)
        office = _office(row, 33, 34, 35, blank_optional_district=target is None)
        purpose = row.text(23, limit=100)
        memo_code, memo_text = row.text(42, limit=1), row.text(43, limit=100)
        # A candidate beneficiary alone never turns spending into a contribution.
        direction = "unknown"
        extra = {
            "beneficiary_committee_id": row.identifier(25),
            "beneficiary_committee_name": row.text(26),
            "category_code": row.text(24, limit=3),
        }
    if memo_code not in {"", "X"}:
        raise FecSourceError("Schedule has an invalid memo code")
    return row.extraction(
        "payment",
        {
            "authority": "fec",
            "account_id": account,
            "source_row_id": str(row.number),
            "source_report_id": file_number,
            "transaction_id": transaction,
            "schedule": schedule,
            "date": day,
            "target_source_candidate_id": target,
            "target_candidate_name": target_name or None,
            "target_candidate_name_parts": target_parts,
            "target_office": office,
            "entity_type": entity,
            "payee": payee,
            "payee_name_parts": parts,
            "purpose": purpose,
            "amount": amount,
            "currency": "USD",
            "direction": direction,
            "transaction_type": f"{cover['form']}:{schedule}",
            "election_code": election or None,
            "memo": {
                "code": memo_code or None,
                "text": memo_text or None,
                "back_reference_transaction_id": back or None,
                "back_reference_schedule": back_schedule or None,
            },
            **extra,
        },
    )


def parse_filing(
    body: bytes, file_number: str, *, strict_schedules: bool = False
) -> FecFiling:
    """Parse supported covers; no fetching, identity matching, or arithmetic.

    A rejected schedule never supplies payment facts and has an explicit issue
    locator; independent valid cover figures remain available. Set
    strict_schedules=True to reject the entire filing on any schedule error.
    Only LF/CRLF terminate records. Python's str.splitlines also splits FEC's
    field separator, so it must never be used on decoded filing text.
    """
    if not isinstance(body, bytes) or not re.fullmatch(r"[1-9][0-9]*", file_number):
        raise FecSourceError("Filing needs original bytes and its exact file number")
    rows = body.split(b"\n")
    while rows and rows[-1] in {b"", b"\r"}:
        rows.pop()
    rows = [raw.removesuffix(b"\r") for raw in rows]
    if len(rows) < 2:
        raise FecSourceError("Filing has no header and cover")
    header = _Row(rows[0], 1, 8)
    if header.text(1) != "HDR" or header.text(2) != "FEC":
        raise FecSourceError("Original is not an FEC electronic filing")
    raw_version = header.text(3, limit=4)
    # Narrow reader recovery for the observed A/N-4 selector padding only.
    # Quotes and original bytes retain the literal token; no general strip.
    version = raw_version.removesuffix(" ")
    if version not in SPECIFICATIONS:
        raise FecSourceError("FEC format version is unsupported")
    original, sequence = header.text(6, limit=16), header.text(7, limit=3)
    if original and re.fullmatch(r"FEC-[1-9][0-9]*", original) is None:
        raise FecSourceError("Header amendment original ID is invalid")
    if sequence and re.fullmatch(r"[0-9]{1,3}", sequence) is None:
        raise FecSourceError("Header amendment sequence is invalid")
    try:
        form_type = rows[1].split(b"\x1c", 1)[0].decode("ascii")
    except UnicodeDecodeError as exc:
        raise FecSourceError("Unsupported cover") from exc
    if form_type not in _COVERS:
        raise FecSourceError("Unsupported cover; no facts extracted")
    form, width = _COVERS[form_type]
    row = _Row(rows[1], 2, width)
    records = [
        header.extraction(
            "header",
            {
                "version": version,
                "raw_version": raw_version,
                "format_warnings": ["trailing_ascii_space_version_padding"]
                if raw_version != version
                else [],
                "original_report_id": original or None,
                "amendment_number": sequence or None,
                "form_type": form_type,
            },
        )
    ]
    if form in {"F1", "F2"}:
        records.append(_identity(row, form))
    else:
        records.extend(_report(row, form, file_number))
    cover = records[1].facts
    unextracted = set()
    unextracted_rows = []
    rejected_rows = []
    transaction_counts: dict[bytes, int] = {}
    for raw in rows[2:]:
        cells = raw.split(b"\x1c", 3)
        if len(cells) >= 3 and (
            cells[0].startswith(b"SB") or cells[0] in {b"SE", b"F57"}
        ):
            transaction_counts[cells[2]] = transaction_counts.get(cells[2], 0) + 1
    for number, raw in enumerate(rows[2:], 3):
        if not raw.strip():
            continue
        try:
            code = raw.split(b"\x1c", 1)[0].decode("ascii")
        except UnicodeDecodeError as exc:
            if strict_schedules:
                raise FecSourceError(
                    f"Row {number} has an unsupported record code"
                ) from exc
            rejected_rows.append(
                FecRowIssue(number, None, "Unsupported record code encoding")
            )
            continue
        try:
            extraction = _schedule(raw, number, code, form, version, cover, file_number)
            if extraction is not None:
                if extraction.locator["kind"] == "payment":
                    transaction = extraction.facts["transaction_id"].encode("utf-8")
                    if transaction_counts[transaction] > 1:
                        raise FecSourceError(
                            "Duplicate spending transaction ID within filing"
                        )
                records.append(extraction)
            else:
                unextracted.add(code)
                unextracted_rows.append(
                    FecRowIssue(
                        number,
                        code,
                        "Schedule is outside this parser's supported extraction",
                    )
                )
        except FecSourceError as exc:
            if strict_schedules:
                raise
            rejected_rows.append(
                FecRowIssue(
                    number,
                    code if re.fullmatch(r"[A-Z0-9/]+", code) else None,
                    str(exc),
                )
            )
    return FecFiling(
        version,
        file_number,
        original or None,
        sequence or None,
        tuple(records),
        tuple(sorted(unextracted)),
        tuple(unextracted_rows),
        tuple(rejected_rows),
    )


def _schedule(raw, number, code, form, version, cover, file_number):
    if form == "F5" and code == "F57":
        return _f57_payment(_Row(raw, number, 33), cover, file_number)
    if form == "F5" and code == "F56":
        return None
    if form in {"F3", "F3X"} and (code.startswith("SB") or code == "SE"):
        if not re.fullmatch(r"SB[0-9]+[A-Za-z]*|SE", code):
            raise FecSourceError(f"Row {number} has an unsupported schedule")
        return _payment(
            _Row(raw, number, 44),
            "SE" if code == "SE" else "SB",
            cover,
            file_number,
        )
    elif form == "F1" and code == "F1S":
        supplement = _Row(raw, number, 37 if version == "8.5" else 36)
        supplement.text(1, required=True, limit=3)
        account = supplement.identifier(2, required=True)
        if account != cover["account_id"]:
            raise FecSourceError("F1S filer differs from F1")
        shift = 1 if version == "8.5" else 0
        facts = {
            "account_id": account,
            "joint_participant_name": supplement.text(3),
            "joint_participant_id": supplement.identifier(4),
            "joint_participant_type": supplement.text(5, limit=1) if shift else None,
            "affiliated_committee_id": supplement.identifier(5 + shift),
            "affiliated_committee_name": supplement.text(6 + shift),
            "affiliated_candidate_id": supplement.identifier(7 + shift, candidate=True),
            "affiliated_relationship": supplement.text(18 + shift, limit=3),
        }
        return supplement.extraction("organization_supplement", facts)
    elif form == "F2" and code == "F2S":
        supplement = _Row(raw, number, 9)
        supplement.text(1, required=True, limit=3)
        candidate = supplement.identifier(2, candidate=True, required=True)
        if candidate != cover["source_candidate_id"]:
            raise FecSourceError("F2S candidate differs from F2")
        facts = {
            "source_candidate_id": candidate,
            "account_id": supplement.identifier(3, required=True),
            "name": supplement.text(4, required=True),
            "designation": "authorized",
        }
        return supplement.extraction("candidacy_supplement", facts)
    elif re.fullmatch(
        r"SA[A-Z0-9]+|SC[/A-Z0-9]*|SD[A-Z0-9]+|SF[A-Z0-9]*|SH[A-Z0-9]+|H[1-6]|SL[A-Z0-9]*|TEXT",
        code,
    ):
        return None
    else:
        # No unknown cover, free-form text block, or schedule is reinterpreted.
        raise FecSourceError(f"Row {number} has an unsupported record type")


@lru_cache(maxsize=4)
def _body_sha256(body: bytes):
    # A bytes key is immutable. Rechecking thousands of locators must not rehash
    # a 20 MB original thousands of times. Changed bytes always have another key.
    return hashlib.sha256(body).hexdigest()


@lru_cache(maxsize=4)
def _parsed_source(body: bytes, file_number: str):
    filing = parse_filing(body, file_number)
    index = {
        json.dumps(record.locator, sort_keys=True): record for record in filing.records
    }
    return filing, index


@lru_cache(maxsize=1)
def _address_rows(body: bytes):
    # One already bounded immutable filing; avoid splitting it for every payee.
    return tuple(body.split(b"\n"))


def _source_file(body: bytes, source: dict) -> str:
    if not isinstance(body, bytes):
        raise FecSourceError("Source must contain immutable original bytes")
    url = source.get("url")
    if not isinstance(url, str):
        raise FecSourceError("Source has no official filing URL")
    parsed = urlsplit(url)
    match = re.fullmatch(r"/dcdev/posted/([1-9][0-9]*)\.fec", parsed.path)
    try:
        valid_port = parsed.port in {None, 443}
    except ValueError as exc:
        raise FecSourceError("Invalid source port") from exc
    if (
        source.get("authority") != "fec"
        or parsed.scheme != "https"
        or parsed.hostname != "docquery.fec.gov"
        or not valid_port
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or match is None
        or any(ord(c) < 32 for c in url)
        or source.get("sha256") != _body_sha256(body)
    ):
        raise FecSourceError("Source is not the exact retained official FEC original")
    return match[1]


def extract_fec_source(body: bytes, source: dict, locator: dict):
    """Trusted registry callback; locator selects code-defined source facts only.

    `cover`, `identity`, `header` and supplements expose literal parser records
    for review. `report`, `payment`, `account` and `designation` expose
    source-backed subsets of the foundation's claims. F2 account/designation
    selectors specify principal or authorized; these never search by name.
    `filer_account` identifies only the literal F1/report filer with null candidate
    association. It is separate from the authorized candidate account/designation
    selectors. F5 organization identities are supported; individual filer name
    rendering is not used as an identity claim.
    `payment_dates` returns separate dissemination/disbursement evidence for SE
    and F57; it never changes the existing payment date subset.
    `payment_election_context` preserves the filed election code and target
    geography for SE/F57. It does not infer an election from report dates.
    Figures retain separate report-period and explicitly dated YTD measures.
    No effective flag,
    receipt timestamp, identity alias, predecessor key or account interval is
    inferred from a cover.
    """
    from alethical.pipeline.election_external_finance import CheckedExtraction

    if (
        locator.get("kind") == "payment_address"
        and isinstance(body, bytes)
        and len(body) > MAX_ADDRESS_SOURCE_BYTES
    ):
        raise FecSourceError("Address source exceeds the bounded reader size")
    file_number = _source_file(body, source)
    filing, index = _parsed_source(body, file_number)
    wanted = dict(locator)
    kind = wanted.get("kind")
    designation = None
    filer_form = None
    if kind == "filer_account":
        if (
            set(wanted) != {"kind", "row"}
            or type(wanted.get("row")) is not int
            or wanted["row"] != 2
        ):
            raise FecSourceError("Filer account needs the exact cover-row locator")
        if any(issue.form in _MAIN_COVER_TYPES for issue in filing.rejected_rows):
            raise FecSourceError(
                "Multiple main covers cannot establish one filer identity"
            )
        filer_form = _COVERS[filing.records[0].facts["form_type"]][0]
        if filer_form not in {"F1", "F3", "F3X", "F5"}:
            raise FecSourceError("This cover does not identify an issued filer account")
        wanted["kind"] = "identity" if filer_form == "F1" else "cover"
    if kind in {"account", "designation"}:
        designation = wanted.pop("designation", None)
    if kind in {"report", "account", "designation"}:
        wanted["kind"] = "cover" if kind == "report" else "identity"
    if kind == "authority":
        wanted["kind"] = "header"
    if kind in {"payment_dates", "payment_address", "payment_election_context"}:
        if set(wanted) != {"kind", "row"} or type(wanted.get("row")) is not int:
            raise FecSourceError("Payment detail requires an exact row locator")
        wanted["kind"] = "payment"
    match = index.get(json.dumps(wanted, sort_keys=True))
    if match is None and kind in {"account", "designation"} and designation is None:
        wanted["kind"] = "candidacy_supplement"
        supplement = index.get(json.dumps(wanted, sort_keys=True))
        if supplement is not None:
            identity = next(
                r for r in filing.records if r.locator == {"kind": "identity", "row": 2}
            )
            cells = (
                json.loads(identity.quote)["cells"]
                + json.loads(supplement.quote)["cells"]
            )
            match = FecExtraction(
                dict(locator),
                {**identity.facts, **supplement.facts},
                json.dumps(
                    {"format": "fec-selected-cells-v1", "cells": cells},
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ),
            )
    if match is None:
        raise FecSourceError("Locator does not identify a supported source extraction")
    facts = deepcopy(match.facts)
    quote = match.quote
    if kind == "authority":
        facts = {
            "key": "fec",
            "name": "Federal Election Commission",
            "jurisdiction": "United States",
            "publisher_url": "https://www.fec.gov/",
        }
    if designation is not None:
        if (
            designation not in {"principal", "authorized"}
            or match.facts.get("election_year") is None
        ):
            raise FecSourceError(
                "Designation selector requires an explicit F2 committee"
            )
        account = facts.get(f"{designation}_account_id")
        name = facts.get(f"{designation}_account_name")
        if not account or not name:
            raise FecSourceError("F2 has no named committee for this designation")
        facts.update(account_id=account, name=name, designation=designation)
    if kind == "report":
        facts = {
            key: facts[key]
            for key in (
                "authority",
                "account_id",
                "source_report_id",
                "report_type",
                "period_start",
                "period_end",
            )
        }
    elif kind == "filer_account":
        name_column = 4 if filer_form in {"F1", "F5"} else 3
        columns = {1, 2, name_column}
        if filer_form == "F5":
            columns.add(3)
        cells = [
            cell
            for cell in json.loads(match.quote)["cells"]
            if cell["row"] == 2 and cell["column"] in columns
        ]
        raw = {cell["column"]: cell["raw"] for cell in cells}
        account = raw.get(2)
        name = raw.get(name_column)
        if (
            set(raw) != columns
            or not isinstance(account, str)
            or _COMMITTEE.fullmatch(account) is None
            or not isinstance(name, str)
            or not name.strip()
            or len(name) > 200
            or (filer_form == "F5" and raw.get(3) != "ORG")
        ):
            raise FecSourceError("Unsupported or incomplete literal filer identity")
        # This claim deliberately does not assert a candidate relationship, even
        # if a separate F1 designation extraction can prove one. No field from
        # source metadata or the locator can supply an ID/name/association.
        facts = {
            "authority": "fec",
            "account_id": account,
            "name": name,
            "source_candidate_id": None,
            "candidate_name": None,
            "issued_id": True,
            "reviewed_key_basis": None,
            "jurisdiction": "United States",
        }
        quote = json.dumps(
            {"format": "fec-selected-cells-v1", "cells": cells},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    elif kind in {"account", "designation"}:
        if facts.get("designation") not in {"principal", "authorized"}:
            raise FecSourceError(
                "This record is not an authorized candidate designation"
            )
        if not facts.get("source_candidate_id") or not facts.get("candidate_name"):
            raise FecSourceError("Designation lacks an exact candidate identifier/name")
        if kind == "designation":
            keys = (
                "authority",
                "account_id",
                "source_candidate_id",
                "office",
                "state",
                "district",
            )
            if facts.get("election_year"):
                keys = (*keys, "election_year")
            facts = {key: facts[key] for key in keys}
            if "election_year" in facts:
                facts["election_year"] = int(facts["election_year"])
            if facts["office"] in {"S", "P"} and facts["district"] is None:
                # Statewide/national offices have no numbered House district.
                facts["district"] = "00"
        else:
            facts = {
                key: facts[key]
                for key in (
                    "authority",
                    "account_id",
                    "name",
                    "source_candidate_id",
                    "candidate_name",
                )
            }
            facts.update(
                issued_id=True, reviewed_key_basis=None, jurisdiction="United States"
            )
    elif kind == "payment_address":
        # A separate locator preserves every existing v1 payment quote/hash.
        # Only a successfully parsed payment row can supply these literal cells.
        raw = _address_rows(body)[wanted["row"] - 1].removesuffix(b"\r")
        row = _Row(raw, wanted["row"], len(raw.split(b"\x1c")))
        row.identifier(2, required=True)
        start = 11 if facts.get("schedule") == "F57" else 13
        address = {}
        for offset, key in enumerate(
            ("street_1", "street_2", "city", "state", "postal_code")
        ):
            column = start + offset
            try:
                value = row.cells[column - 1].decode("utf-8", errors="strict")
            except UnicodeDecodeError as exc:
                raise FecSourceError("Address has unsupported encoding") from exc
            # One retained official street contains a horizontal TAB. Preserve it
            # literally in both fact and quote; never normalize or extend this
            # narrow allowance to other parser fields or control characters.
            if len(value) > 200 or any(ord(c) < 32 and c != "\t" for c in value):
                raise FecSourceError("Address has an unsupported control or length")
            row.selected[column] = value
            address[key] = value or None
        facts = {
            key: facts[key]
            for key in ("authority", "account_id", "source_row_id", "source_report_id")
        } | {"payee_address": address}
        quote = row.extraction("payment_address", facts).quote
    elif kind == "payment_election_context":
        if facts.get("schedule") not in {"SE", "F57"}:
            raise FecSourceError(
                "This schedule has no supported target election context"
            )
        facts = {
            key: facts[key]
            for key in (
                "authority",
                "account_id",
                "source_row_id",
                "source_report_id",
                "target_source_candidate_id",
                "election_code",
                "target_office",
            )
        }
    elif kind == "payment_dates":
        if facts.get("schedule") not in {"SE", "F57"}:
            raise FecSourceError("This schedule has no separate event-date fields")
        facts = {
            key: facts[key]
            for key in (
                "authority",
                "account_id",
                "source_row_id",
                "source_report_id",
                "dissemination_date",
                "disbursement_date",
            )
        }
    elif kind == "payment":
        facts = {
            key: facts[key]
            for key in (
                "authority",
                "account_id",
                "source_row_id",
                "source_report_id",
                "date",
                "target_source_candidate_id",
                "payee",
                "purpose",
                "amount",
                "currency",
                "direction",
                "transaction_type",
                "memo",
            )
        }
    return CheckedExtraction(facts=facts, quote=quote)


BULK_ADAPTER_ID = "fec_bulk_summary:v1"
# Exact published 98-column House/Senate summary layout, including both CAND_ID
# columns. This is the header's hash, not an assumption about mutable data rows.
_SUMMARY_HEADER_SHA256 = (
    "b8391b228dbb15d267c43c97a1664f30be36b2c3c025ccaac5d71cc0d977be3a"
)
_BULK_HOST = "cg-519a459a-0ea3-42c2-b7bc-fa1143481f74.s3-us-gov-west-1.amazonaws.com"
_SUMMARY_COLUMNS = (3, 4, 6, 13, 14, 15, 77)


@lru_cache(maxsize=1)
def _summary_rows(body: bytes):
    try:
        reader = csv.reader(
            io.StringIO(body.decode("utf-8-sig"), newline=""), strict=True
        )
        header = next(reader)
        digest = hashlib.sha256(
            json.dumps(header, separators=(",", ":")).encode()
        ).hexdigest()
        if digest != _SUMMARY_HEADER_SHA256:
            raise FecSourceError("Unsupported FEC summary CSV layout")
        # Retain selected identity fields only, never address or donor values.
        rows = []
        for cells in reader:
            if len(cells) != len(header):
                rows.append(None)
            else:
                rows.append(tuple(cells[column - 1] for column in _SUMMARY_COLUMNS))
        return tuple(rows)
    except (UnicodeDecodeError, csv.Error, StopIteration) as exc:
        raise FecSourceError("Invalid FEC summary CSV") from exc


def extract_fec_bulk_source(body: bytes, source: dict, locator: dict):
    """Reconstruct a summary account or candidate-year designation subset.

    Locator record is one-based CSV data-record ordinal (header excluded), not
    a physical text line. CAND_ELECTION_YR supplies the year; the file's cycle
    and RPT_YR never do. Office, state and district need another exact joined
    designation binding. No report amendment, effective status or filing
    identity is inferred from this summary or its generic LINK_IMAGE value.
    """
    from alethical.pipeline.election_external_finance import CheckedExtraction

    if not isinstance(body, bytes) or len(body) > 64 * 1024 * 1024:
        raise FecSourceError("Summary requires bounded immutable original bytes")
    url = source.get("url")
    if not isinstance(url, str):
        raise FecSourceError("Summary has no official publisher URL")
    parsed = urlsplit(url)
    try:
        valid_port = parsed.port in {None, 443}
    except ValueError as exc:
        raise FecSourceError("Invalid summary source port") from exc
    path = re.fullmatch(
        r"/bulk-downloads/([12][0-9]{3})/([12][0-9]{3})_HOUSE_SENATE_CAMPAIGNS_DOWNLOAD\.csv",
        parsed.path,
    )
    if (
        source.get("authority") != "fec"
        or parsed.scheme != "https"
        or parsed.hostname != _BULK_HOST
        or not valid_port
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or any(ord(char) < 32 for char in url)
        or path is None
        or path[1] != path[2]
        or source.get("sha256") != _body_sha256(body)
    ):
        raise FecSourceError("Summary is not its retained official FEC original")
    if (
        set(locator) != {"kind", "record"}
        or locator.get("kind") not in {"account", "designation"}
        or type(locator.get("record")) is not int
        or locator["record"] < 1
    ):
        raise FecSourceError("Unsupported summary identity locator")
    rows = _summary_rows(body)
    ordinal = locator["record"]
    if ordinal > len(rows) or rows[ordinal - 1] is None:
        raise FecSourceError("Summary locator does not identify a complete record")
    selected = rows[ordinal - 1]
    assert selected is not None
    name, account, designation, candidate, candidate_name, year, repeated = selected
    if (
        _COMMITTEE.fullmatch(account) is None
        or _CANDIDATE.fullmatch(candidate) is None
        or candidate != repeated
        or designation not in {"P", "A"}
        or re.fullmatch(r"[12][0-9]{3}", year) is None
        or any(any(ord(char) < 32 for char in value) for value in selected)
        or not name
        or len(name) > 200
        or not candidate_name
        or len(candidate_name) > 200
    ):
        raise FecSourceError("Summary record lacks exact authorized candidate identity")
    facts = {
        "authority": "fec",
        "account_id": account,
        "source_candidate_id": candidate,
    }
    if locator["kind"] == "designation":
        facts["election_year"] = int(year)
        quote_columns = (4, 6, 13, 15, 77)
    else:
        facts.update(
            name=name,
            candidate_name=candidate_name,
            issued_id=True,
            reviewed_key_basis=None,
            jurisdiction="United States",
        )
        quote_columns = (3, 4, 6, 13, 14, 77)
    values = dict(zip(_SUMMARY_COLUMNS, selected, strict=True))
    quote = json.dumps(
        {
            "format": "fec-selected-csv-cells-v1",
            "record": ordinal,
            "cells": [
                {
                    "column": column,
                    "field": {
                        3: "CMTE_NM",
                        4: "CMTE_ID",
                        6: "CMTE_DSGN",
                        13: "CAND_ID",
                        14: "CAND_NAME",
                        15: "CAND_ELECTION_YR",
                        77: "CAND_ID",
                    }[column],
                    "raw": values[column],
                }
                for column in quote_columns
            ],
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return CheckedExtraction(facts=facts, quote=quote)
