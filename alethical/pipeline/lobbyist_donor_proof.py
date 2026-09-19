"""Compare complete official donor records with unchanged bulk contribution rows.

Report evidence can associate a held row with an explicit lobbyist registration.
It never manufactures a payment or removes a repeated source row.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, timedelta
from decimal import Decimal
import hashlib
import json
from typing import Any

PROOF_VERSION = 1


def normalized_name(value: str | None) -> str:
    return " ".join((value or "").casefold().split())


def source_fingerprint(rows: list[dict]) -> str:
    """Bind the exact source values used, including identity and repeated rows."""
    fields = (
        "row_number",
        "recipient_reg_num",
        "contributor",
        "contrib_reg_num",
        "contrib_type",
        "receipt_type",
        "amount",
        "receipt_date",
        "year",
        "in_kind",
    )
    values = [
        {
            field: str(row[field]) if row.get(field) is not None else None
            for field in fields
        }
        for row in sorted(rows, key=lambda row: row["row_number"])
    ]
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


def complete_periods(
    reports: list[Any], year: int, *, coverage_start: date | None = None
) -> bool:
    """Require continuous coverage through year end, with no inferred earlier zero.

    Jan 1 remains the default. A later start is accepted only when the caller has
    established it from every effective catalogue report's actual period.
    """
    next_day = coverage_start or date(year, 1, 1)
    if next_day.year != year:
        return False
    for report in sorted(reports, key=lambda item: item.period_start):
        start = max(report.period_start, date(year, 1, 1))
        end = min(report.period_end, date(year, 12, 31))
        if start != next_day or end < start:
            return False
        next_day = end + timedelta(days=1)
    return next_day == date(year + 1, 1, 1)


def _held_key(row: dict) -> tuple | None:
    if row.get("amount") is None or row.get("receipt_date") is None:
        return None
    if row.get("in_kind") not in {"No", "Yes"}:
        return None
    return (str(row["receipt_date"]), Decimal(str(row["amount"])), row["in_kind"])


def compare_donors(
    reports: list[Any],
    rows: list[dict],
    year: int,
    *,
    coverage_start: date | None = None,
) -> dict:
    """Full donor multisets with separate, unambiguous source-row associations.

    A parse failure must never call this function with partial report output.
    Caller establishes effective versions and recipient identity. A failed coverage
    check returns no verdicts. A later coverage_start must come from the complete
    known-report coverage validator, not from the dates of the held payments.
    """
    if not complete_periods(reports, year, coverage_start=coverage_start):
        return {
            "state": "unavailable",
            "reason": "report_periods_do_not_cover_year",
            "donors": {},
        }
    expected: dict[str, Counter] = defaultdict(Counter)
    names: dict[str, set[str]] = defaultdict(set)
    evidence: dict[str, list[dict]] = defaultdict(list)
    for report in reports:
        for gift in report.transactions:
            reg = gift.lobbyist_registration_number
            if reg is None:
                continue
            if not report.period_start <= gift.receipt_date <= report.period_end:
                return {
                    "state": "unavailable",
                    "reason": "report_date_outside_period",
                    "donors": {},
                }
            if gift.receipt_date.year != year:
                continue
            names[reg].add(normalized_name(gift.donor_name))
            parts = []
            if gift.cash != 0 or gift.in_kind == 0:
                parts.append((gift.cash, "No"))
            if gift.in_kind != 0:
                parts.append((gift.in_kind, "Yes"))
            for amount, kind in parts:
                expected[reg][(str(gift.receipt_date), amount, kind)] += 1
            evidence[reg].append(
                {
                    "document_hash": report.document_hash,
                    "page": gift.page,
                    "line": gift.line,
                }
            )
    assigned: dict[str, list[dict]] = defaultdict(list)
    ambiguous: set[str] = set()
    for row in rows:
        if row.get("receipt_type") != "Contribution" or row.get("year") != year:
            continue
        reg = row.get("contrib_reg_num")
        if reg and row.get("contrib_type") == "Lobbyist":
            assigned[reg].append(row)
            continue
        # Explicit IDs of other contributor types are never treated as lobbyist IDs.
        if reg or row.get("contrib_type") not in {"Individual", "Lobbyist"}:
            continue
        key = _held_key(row)
        named = [
            donor
            for donor in expected
            if normalized_name(row.get("contributor")) in names[donor]
        ]
        candidates = [donor for donor in named if key in expected[donor]]
        if len(candidates) == 1:
            assigned[candidates[0]].append(row)
        elif named:
            # A same-name source row with another amount/date is unresolved, not
            # silently dropped as though the exact matches were the complete set.
            ambiguous.update(named)
    for report in reports:
        for gift in report.transactions:
            if (
                gift.lobbyist_registration_number is None
                and gift.receipt_date.year == year
            ):
                ambiguous.update(
                    reg
                    for reg in names
                    if normalized_name(gift.donor_name) in names[reg]
                )
    verdicts = {}
    for reg in sorted(set(assigned) | set(expected)):
        held = assigned[reg]
        keys = [_held_key(row) for row in held]
        agrees = (
            reg not in ambiguous
            and None not in keys
            and Counter(keys) == expected[reg]
            and bool(held)
        )
        verdicts[reg] = {
            "status": "agrees" if agrees else "disagrees",
            "reason": "matching_donor_records"
            if agrees
            else "donor_identity_unresolved"
            if reg in ambiguous
            else "donor_records_do_not_match",
            "row_numbers": sorted(row["row_number"] for row in held) if agrees else [],
            "evidence": evidence.get(reg, []),
        }
    return {"state": "checked", "reason": None, "donors": verdicts}
