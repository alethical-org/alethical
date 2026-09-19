"""Recompute a donor-proof artifact from saved official bytes and held source rows."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict
from datetime import date, datetime
import hashlib
import json
from pathlib import Path
from typing import Any

from alethical.pipeline.campaign_finance_filings import parse_catalogue_payload
from alethical.pipeline.lobbyist_donor_proof import (
    PROOF_VERSION,
    compare_donors,
    complete_periods,
    source_fingerprint,
)
from alethical.pipeline.lobbyist_report_evidence import (
    parse_lobbyist_report_evidence,
    ReportEvidenceError,
)


def selected_reports(entries: list[Any], year: int) -> list[Any]:
    """Use the latest effective report from every series, never sum YTD overlaps."""
    entries = [r for r in entries if r.filing_year == year]
    if not entries:
        raise ValueError("empty_catalogue")
    selected = []
    for special in sorted({r.special_election for r in entries}):
        series = [r for r in entries if r.special_election == special]
        if any(
            r.cut_off_date is None or r.effective_amendment_index is None
            for r in series
        ):
            raise ValueError("catalogue_has_unknown_version_or_cutoff")
        cutoff = max(r.cut_off_date for r in series)
        chosen = [r for r in series if r.cut_off_date == cutoff]
        if len({(r.report_type, r.effective_amendment_index) for r in chosen}) != 1:
            raise ValueError("ambiguous_latest_period")
        selected.append(chosen[0])
    return selected


def _read_manifest(directory: Path, registration: str, year: int) -> dict:
    record = json.loads((directory / f"{registration}-{year}.json").read_text())
    if record["recipient"] != registration or record["year"] != year:
        raise ValueError("recipient_manifest_identity_mismatch")
    collected = datetime.fromisoformat(record["fetched_at"])
    if collected.tzinfo is None:
        raise ValueError("collection_time_missing_timezone")
    return record


def _hash_path(directory: Path, name: str, expected: str, label: str) -> bytes:
    if Path(name).name != name:
        raise ValueError(f"invalid_{label}_filename")
    body = (directory / name).read_bytes()
    if hashlib.sha256(body).hexdigest() != expected:
        raise ValueError(f"{label}_hash_changed")
    return body


def source_audit(directory: Path, registration: str, year: int) -> dict:
    """Retain independently readable source evidence even when donor proof fails.

    The JSON catalogue body is hash-checked and its selection recomputed; manifest
    selection claims are never trusted. PDF references are body-hash-checked but
    need not parse, because a served, unparseable PDF is itself audit evidence.
    """
    result: dict[str, Any] = {
        "collected_at": None,
        "catalogues": [],
        "documents": [],
        "audit_errors": [],
    }
    record = {}
    try:
        record = _read_manifest(directory, registration, year)
    except (ValueError, KeyError, TypeError, FileNotFoundError) as error:
        result["audit_errors"].append(str(error)[:200])
    else:
        result["collected_at"] = record["fetched_at"]
    refs = [*record.get("catalogues", []), *record.get("documents", [])]
    seen = set()
    for ref in refs:
        try:
            digest = ref["catalogue_hash"]
            identity = (digest, ref["kind"])
            if identity in seen:
                continue
            body = _hash_path(directory, ref["catalogue_path"], digest, "catalogue")
            payload = json.loads(body)
            catalogue = {
                "hash": digest,
                "payload": payload,
                "fetched_at": ref.get("fetched_at", record["fetched_at"]),
                "kind": ref["kind"],
                "selected_reports": [],
            }
            result["catalogues"].append(catalogue)
            seen.add(identity)
            try:
                entries, errors = parse_catalogue_payload(payload, registration)
                if errors:
                    raise ValueError("catalogue_parse_errors")
                catalogue["selected_reports"] = [
                    asdict(report) for report in selected_reports(entries, year)
                ]
            except (ValueError, KeyError, TypeError) as error:
                catalogue["selection_error"] = str(error)[:200]
        except (ValueError, KeyError, TypeError, FileNotFoundError) as error:
            result["audit_errors"].append(str(error)[:200])
    for document in record.get("documents", []):
        try:
            digest = document["document_hash"]
            if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
                raise ValueError("invalid_document_hash")
            body = _hash_path(directory, f"{digest}.pdf", digest, "document")
            if not body.startswith(b"%PDF"):
                raise ValueError("document_not_served")
            report = document["report"]
            if (
                report.get("registration_number", registration) != registration
                or report.get("filing_year", year) != year
            ):
                raise ValueError("document_manifest_identity_mismatch")
            result["documents"].append(
                {
                    "document_hash": digest,
                    "registration_number": registration,
                    "filing_year": year,
                    "report_type": report["report_type"],
                    "amendment_index": report["effective_amendment_index"],
                    "special_election": report["special_election"],
                }
            )
        except (ValueError, KeyError, TypeError, FileNotFoundError) as error:
            result["audit_errors"].append(str(error)[:200])
    coverage_path = directory / f"{registration}-{year}-coverage.json"
    if coverage_path.exists():
        try:
            coverage_bytes = coverage_path.read_bytes()
            coverage = json.loads(coverage_bytes)
            # Preserve the manifest's actual claims even when validation refuses
            # them. This is audit data, never a positive recipient identity.
            result["coverage_manifest"] = coverage
            result["coverage_manifest_hash"] = hashlib.sha256(
                coverage_bytes
            ).hexdigest()
            if (
                coverage["registration_number"] != registration
                or coverage["year"] != year
            ):
                raise ValueError("coverage_manifest_identity_mismatch")
            catalogues = [
                c
                for c in result["catalogues"]
                if c["hash"] == coverage["catalogue_hash"]
            ]
            if not catalogues:
                raise ValueError("coverage_catalogue_not_verified")
            entries, errors = parse_catalogue_payload(
                catalogues[0]["payload"], registration
            )
            if errors:
                raise ValueError("coverage_catalogue_parse_errors")
            inventory = {
                (
                    r.report_type,
                    r.effective_amendment_index,
                    r.special_election,
                    str(r.cut_off_date),
                )
                for r in entries
                if r.filing_year == year
            }
            if not isinstance(coverage["documents"], list):
                raise ValueError("malformed_coverage_document_metadata")
            for document in coverage["documents"]:
                try:
                    if (
                        document.get("registration_number", registration)
                        != registration
                        or document.get("filing_year", year) != year
                    ):
                        raise ValueError("coverage_document_manifest_identity_mismatch")
                    key = (
                        document["report_type"],
                        document["amendment_index"],
                        document["special_election"],
                        document.get("cut_off_date", document.get("period_end")),
                    )
                    if (
                        type(key[1]) is not int
                        or key[1] < 0
                        or type(key[2]) is not bool
                        or key not in inventory
                    ):
                        raise ValueError("coverage_document_not_in_verified_catalogue")
                    digest = document["document_hash"]
                    if len(digest) != 64 or any(
                        c not in "0123456789abcdef" for c in digest
                    ):
                        raise ValueError("invalid_coverage_document_hash")
                    body = _hash_path(
                        directory, f"{digest}.pdf", digest, "coverage_document"
                    )
                    if not body.startswith(b"%PDF"):
                        raise ValueError("coverage_document_not_pdf")
                    canonical = {
                        "document_hash": digest,
                        "registration_number": registration,
                        "filing_year": year,
                        "report_type": key[0],
                        "amendment_index": key[1],
                        "special_election": key[2],
                        "purpose": "period_only",
                    }
                    if canonical not in result["documents"]:
                        result["documents"].append(canonical)
                except (
                    ValueError,
                    KeyError,
                    TypeError,
                    AttributeError,
                    FileNotFoundError,
                ) as error:
                    result["audit_errors"].append(str(error)[:200])
        except (ValueError, KeyError, TypeError, FileNotFoundError) as error:
            result["audit_errors"].append(str(error)[:200])
    return result


def read_recipient(
    directory: Path, registration: str, year: int, rows: list[dict]
) -> dict:
    record = _read_manifest(directory, registration, year)
    if not record["documents"]:
        raise ValueError("recipient_source_missing")
    parsed = []
    documents = []
    catalogue_hashes = set()
    selected_keys = set()
    actual_keys = []
    catalogues = []
    for document in record["documents"]:
        # Filenames are content hashes or locally generated names, never remote paths.
        catalogue_path = Path(document["catalogue_path"])
        if catalogue_path.name != str(catalogue_path):
            raise ValueError("invalid_catalogue_filename")
        catalogue_bytes = (directory / catalogue_path).read_bytes()
        catalogue_hash = hashlib.sha256(catalogue_bytes).hexdigest()
        if catalogue_hash != document["catalogue_hash"]:
            raise ValueError("catalogue_hash_changed")
        if catalogue_hash not in catalogue_hashes:
            payload = json.loads(catalogue_bytes)
            entries, errors = parse_catalogue_payload(payload, registration)
            if errors:
                raise ValueError("catalogue_parse_errors")
            chosen = selected_reports(entries, year)
            selected_keys.update(
                (
                    r.report_type,
                    r.effective_amendment_index,
                    r.special_election,
                    str(r.cut_off_date),
                )
                for r in chosen
            )
            catalogue_hashes.add(catalogue_hash)
            catalogues.append(
                {
                    "hash": catalogue_hash,
                    "payload": payload,
                    "fetched_at": next(
                        (
                            c["fetched_at"]
                            for c in record.get("catalogues", [])
                            if c["catalogue_hash"] == catalogue_hash
                            and c["kind"] == document["kind"]
                            and c.get("fetched_at")
                        ),
                        record["fetched_at"],
                    ),
                    "kind": document["kind"],
                    "selected_reports": [asdict(report) for report in chosen],
                }
            )
        r = document["report"]
        key = (
            r["report_type"],
            r["effective_amendment_index"],
            r["special_election"],
            r["cut_off_date"],
        )
        actual_keys.append(key)
        digest = document["document_hash"]
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("invalid_document_hash")
        body = (directory / f"{digest}.pdf").read_bytes()
        if hashlib.sha256(body).hexdigest() != digest:
            raise ValueError("document_hash_changed")
        report = parse_lobbyist_report_evidence(
            body, registration_number=registration, filing_year=year
        )
        if report.period_end != date.fromisoformat(r["cut_off_date"]):
            raise ValueError("document_catalogue_period_disagrees")
        parsed.append(report)
        documents.append(
            {
                "document_hash": digest,
                "registration_number": registration,
                "filing_year": year,
                "report_type": r["report_type"],
                "amendment_index": r["effective_amendment_index"],
                "special_election": r["special_election"],
                "period_start": str(report.period_start),
                "period_end": str(report.period_end),
            }
        )
    if (
        len(catalogue_hashes) != 1
        or len(actual_keys) != len(set(actual_keys))
        or set(actual_keys) != selected_keys
    ):
        raise ValueError("effective_report_set_incomplete_or_ambiguous")
    coverage = None
    if not complete_periods(parsed, year):
        from alethical.pipeline.lobbyist_report_coverage import (
            read_known_report_coverage,
        )

        # Earlier effective reports establish a late start; held payment dates do not.
        coverage = read_known_report_coverage(
            directory,
            registration,
            year,
            entries,
            documents,
            next(iter(catalogue_hashes)),
        )
    proof = compare_donors(
        parsed,
        rows,
        year,
        coverage_start=coverage["coverage_start"] if coverage else None,
    )
    if proof["state"] != "checked":
        raise ValueError(proof["reason"])
    return {
        "registration_number": registration,
        "year": year,
        "source_fingerprint": source_fingerprint(rows),
        "collected_at": record["fetched_at"],
        "documents": documents,
        "catalogues": catalogues,
        "donors": proof["donors"],
        "coverage": coverage,
    }


def build_run(
    directory: Path, rows: list[dict], targets: list[tuple[str, int]]
) -> dict:
    grouped: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for row in rows:
        grouped[row["recipient_reg_num"], row["year"]].append(row)
    recipients, failures = [], []
    for registration, year in sorted(set(targets)):
        try:
            recipients.append(
                read_recipient(
                    directory, registration, year, grouped[registration, year]
                )
            )
        except (ValueError, KeyError, FileNotFoundError, ReportEvidenceError) as error:
            failures.append(
                {
                    "registration_number": registration,
                    "year": year,
                    "reason": str(error)[:200],
                    "source_fingerprint": source_fingerprint(
                        grouped[registration, year]
                    ),
                    **source_audit(directory, registration, year),
                }
            )
    # One source row cannot gain 2 different identities, even across bad artifacts.
    owners = {}
    for recipient in recipients:
        for donor, verdict in recipient["donors"].items():
            for number in verdict["row_numbers"]:
                if number in owners:
                    raise ValueError("source_row_has_multiple_proofs")
                owners[number] = donor
    return {"version": PROOF_VERSION, "recipients": recipients, "failures": failures}


def superseded_comparisons(
    directory: Path, targets: list[tuple[str, int]], comparisons: dict
) -> list[dict]:
    """A newer catalogue invalidates an older pass even if its PDF is unavailable."""
    withheld = []
    for registration, year in sorted(set(targets)):
        old = comparisons.get((registration, year))
        if not old or old["status"] != "agrees":
            continue
        audit = source_audit(directory, registration, year)
        changed = False
        for catalogue in audit["catalogues"]:
            reports = catalogue["selected_reports"]
            if catalogue.get("selection_error") or not reports:
                continue
            changed = (
                changed
                or len(reports) != 1
                or any(
                    r["report_type"] != old["report_type"]
                    or r["effective_amendment_index"] != old["amendment_index"]
                    or r["special_election"]
                    or (
                        old.get("cut_off_date") is not None
                        and str(r["cut_off_date"]) != str(old["cut_off_date"])
                    )
                    for r in reports
                )
            )
        # Identical catalogue versions can still serve changed bytes. A verified
        # changed body can withhold an amount, never authorize one.
        changed = changed or any(
            d["report_type"] != old["report_type"]
            or d["amendment_index"] != old["amendment_index"]
            or d["special_election"]
            or d["document_hash"] != old["document_hash"]
            for d in audit["documents"]
            if d.get("purpose") != "period_only"
        )
        if changed:
            withheld.append(
                {
                    "registration_number": registration,
                    "year": year,
                    "reason": "recipient_comparison_uses_other_report_evidence",
                }
            )
    return withheld
