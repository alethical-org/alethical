"""Validate a late-start reporting period without claiming earlier activity was zero.

Every effective report in the year's catalogue supplies a checked period header.
Only the latest report in each series supplies transactions. Earlier cumulative
reports prove that the selection did not silently omit an earlier period; their
payments are never added again. This module reads local evidence and never fetches.
"""

from __future__ import annotations

from datetime import date, datetime
import hashlib
import io
import json
from pathlib import Path
import re
from typing import Any

from pypdf import PdfReader
from pypdf.errors import PyPdfError

from alethical.pipeline.lobbyist_donor_proof import complete_periods

_PERIOD = re.compile(
    r"Period Covered:\s*(\d{2}/\d{2}/\d{4})\s+through\s+(\d{2}/\d{2}/\d{4})"
)
_REGISTRATION = re.compile(r"Registration Number:\s*(\d+)\b")
_HASH = re.compile(r"[0-9a-f]{64}\Z")


class ReportCoverageError(ValueError):
    """An unproved coverage boundary, without source personal details."""


def _key(report_type: Any, amendment: Any, special: Any, cutoff: Any) -> tuple:
    if (
        not isinstance(report_type, str)
        or not report_type
        or type(amendment) is not int
        or amendment < 0
        or type(special) is not bool
        or type(cutoff) is not date
    ):
        raise ReportCoverageError("unknown_report_version_series_or_cutoff")
    return report_type, amendment, special, cutoff


def effective_report_inventory(
    entries: list[Any], registration: str, year: int
) -> dict[tuple, Any]:
    """Deduplicate identical catalogue entries; conflicting effective versions fail."""
    inventory: dict[tuple, Any] = {}
    slots: dict[tuple, tuple] = {}
    for entry in entries:
        if entry.filing_year != year:
            continue
        if entry.registration_number != registration:
            raise ReportCoverageError("catalogue_registration_mismatch")
        key = _key(
            entry.report_type,
            entry.effective_amendment_index,
            entry.special_election,
            entry.cut_off_date,
        )
        slot = key[0], key[2]
        if slot in slots and slots[slot] != key:
            raise ReportCoverageError("conflicting_effective_catalogue_versions")
        slots[slot] = key
        inventory[key] = entry
    if not inventory:
        raise ReportCoverageError("empty_coverage_catalogue")
    return inventory


def _document_key(document: dict) -> tuple:
    if not isinstance(document, dict):
        raise ReportCoverageError("malformed_coverage_document_metadata")
    raw_cutoff = document.get("cut_off_date", document.get("period_end"))
    try:
        cutoff = date.fromisoformat(raw_cutoff)
    except (TypeError, ValueError) as exc:
        raise ReportCoverageError("invalid_document_cutoff") from exc
    if "period_end" in document and str(cutoff) != document["period_end"]:
        raise ReportCoverageError("conflicting_document_cutoffs")
    return _key(
        document.get("report_type"),
        document.get("amendment_index"),
        document.get("special_election"),
        cutoff,
    )


def _read_header(body: bytes, registration: str, year: int) -> tuple[date, date]:
    if not body.startswith(b"%PDF"):
        raise ReportCoverageError("coverage_document_not_pdf")
    try:
        reader = PdfReader(io.BytesIO(body))
        if not reader.pages:
            raise ReportCoverageError("coverage_document_has_no_pages")
        first = reader.pages[0].extract_text(extraction_mode="layout") or ""
    except (PyPdfError, ValueError, KeyError, TypeError, OSError) as exc:
        raise ReportCoverageError("coverage_document_unreadable") from exc
    if _REGISTRATION.findall(first) != [registration]:
        raise ReportCoverageError("coverage_document_registration_mismatch")
    periods = _PERIOD.findall(first)
    if len(periods) != 1:
        raise ReportCoverageError("missing_or_ambiguous_coverage_period")
    try:
        start, end = (datetime.strptime(v, "%m/%d/%Y").date() for v in periods[0])
    except ValueError as exc:
        raise ReportCoverageError("invalid_coverage_period") from exc
    if start > end or start > date(year, 12, 31) or end < date(year, 1, 1):
        raise ReportCoverageError("coverage_period_outside_source_year")
    return start, end


def read_known_report_coverage(
    directory: Path,
    registration: str,
    year: int,
    entries: list[Any],
    selected_documents: list[dict],
    catalogue_hash: str,
) -> dict:
    """Return a validated coverage_start and all period-evidence hashes for audit.

    ``selected_documents`` uses read_recipient's standard flat document metadata.
    Additional earlier effective PDFs are indexed by the local, separately collected
    ``<registration>-<year>-coverage.json`` manifest. Its catalogue_hash must equal
    the exact catalogue already validated by read_recipient. Missing evidence fails.

    The return's documents must be retained in the immutable audit store, including
    those marked period_only. Use coverage_start explicitly in compare_donors.
    """
    if not isinstance(catalogue_hash, str) or _HASH.fullmatch(catalogue_hash) is None:
        raise ReportCoverageError("invalid_coverage_catalogue_hash")
    if not registration.isdigit():
        raise ReportCoverageError("invalid_coverage_registration")
    inventory = effective_report_inventory(entries, registration, year)
    selected = {_document_key(d): d for d in selected_documents}
    if len(selected) != len(selected_documents) or not selected:
        raise ReportCoverageError("duplicate_or_empty_selected_reports")
    expected_selection = set()
    for special in {key[2] for key in inventory}:
        series = [key for key in inventory if key[2] == special]
        cutoff = max(key[3] for key in series)
        latest = [key for key in series if key[3] == cutoff]
        if len(latest) != 1:
            raise ReportCoverageError("ambiguous_latest_coverage_report")
        expected_selection.add(latest[0])
    if set(selected) != expected_selection:
        raise ReportCoverageError("incomplete_or_superseded_selected_series")

    additional = []
    if set(inventory) != set(selected):
        try:
            manifest = json.loads(
                (directory / f"{registration}-{year}-coverage.json").read_text()
            )
            if (
                manifest["registration_number"] != registration
                or manifest["year"] != year
                or manifest["catalogue_hash"] != catalogue_hash
            ):
                raise ReportCoverageError("coverage_manifest_identity_mismatch")
            additional = manifest["documents"]
        except (FileNotFoundError, KeyError, TypeError, json.JSONDecodeError) as exc:
            raise ReportCoverageError("missing_or_malformed_coverage_manifest") from exc
        if not isinstance(additional, list):
            raise ReportCoverageError("malformed_coverage_document_metadata")

    all_documents = dict(selected)
    for document in additional:
        key = _document_key(document)
        if key in all_documents:
            raise ReportCoverageError("duplicate_coverage_document")
        all_documents[key] = document
    if set(all_documents) != set(inventory):
        raise ReportCoverageError("effective_coverage_document_set_incomplete")

    audit, periods = [], {}
    for key, document in sorted(all_documents.items()):
        digest = document.get("document_hash", "")
        if not isinstance(digest, str) or _HASH.fullmatch(digest) is None:
            raise ReportCoverageError("invalid_coverage_document_hash")
        try:
            body = (directory / f"{digest}.pdf").read_bytes()
        except FileNotFoundError as exc:
            raise ReportCoverageError("missing_coverage_document") from exc
        if hashlib.sha256(body).hexdigest() != digest:
            raise ReportCoverageError("coverage_document_hash_changed")
        start, end = _read_header(body, registration, year)
        if end != key[3]:
            raise ReportCoverageError("coverage_document_catalogue_cutoff_mismatch")
        if key in selected and (
            document.get("period_start") != str(start)
            or document.get("period_end") != str(end)
        ):
            raise ReportCoverageError("selected_coverage_header_changed")
        periods[key] = start, end
        audit.append(
            {
                "document_hash": digest,
                "registration_number": registration,
                "filing_year": year,
                "report_type": key[0],
                "amendment_index": key[1],
                "special_election": key[2],
                "period_start": str(start),
                "period_end": str(end),
                "purpose": "selected_transactions"
                if key in selected
                else "period_only",
            }
        )

    # Every earlier period must be superseded by the chosen report in ITS series,
    # not merely hidden beneath an unrelated special/regular report's dates.
    for key, (start, end) in periods.items():
        latest_key = next(k for k in selected if k[2] == key[2])
        latest_start, latest_end = periods[latest_key]
        if start < latest_start or end > latest_end:
            raise ReportCoverageError("earlier_report_extends_outside_selected_period")
    coverage_start = max(min(start for start, _ in periods.values()), date(year, 1, 1))
    from types import SimpleNamespace

    chosen_periods = [
        SimpleNamespace(period_start=periods[k][0], period_end=periods[k][1])
        for k in selected
    ]
    if not complete_periods(chosen_periods, year, coverage_start=coverage_start):
        raise ReportCoverageError("known_report_coverage_has_gap_overlap_or_early_end")
    return {
        "kind": "known_report_periods",
        "catalogue_hash": catalogue_hash,
        "coverage_start": coverage_start,
        "coverage_end": date(year, 12, 31),
        "documents": audit,
    }
