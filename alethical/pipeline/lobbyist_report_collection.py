"""Bounded, resumable collection of official catalogues and effective report bytes."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from datetime import datetime, UTC
import hashlib
import json
from pathlib import Path
import time
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db.models import CampaignFinanceFiler, CampaignFinanceFilerKind as Kind
from alethical.pipeline.campaign_finance_filings import (
    http_session,
    viewer_url,
    viewer_form,
    segment_for_year,
    parse_catalogue_payload,
)
from alethical.pipeline.campaign_finance_report_documents import (
    document_url,
    document_form,
)
from alethical.pipeline.lobbyist_evidence_publication import source_context
from alethical.pipeline.lobbyist_evidence_run import selected_reports
from alethical.pipeline.lobbyist_donor_proof import complete_periods
from alethical.pipeline.lobbyist_report_coverage import (
    _read_header,
    effective_report_inventory,
    ReportCoverageError,
)


def _collect_coverage(
    http, directory, registration, year, kind, entries, documents, catalogue_hash
) -> list[dict]:
    """Retain each earlier effective cover only when selected covers need it.

    These documents establish period boundaries, never additional transactions.
    Keep a partial manifest on download/header failure so served evidence survives.
    """
    inventory = effective_report_inventory(entries, registration, year)
    selected_keys, periods = set(), []
    for document in documents:
        report = document["report"]
        key = (
            report["report_type"],
            report["effective_amendment_index"],
            report["special_election"],
            report["cut_off_date"],
        )
        body = (directory / document["path"]).read_bytes()
        start, end = _read_header(body, registration, year)
        if end != key[3]:
            raise ReportCoverageError("coverage_document_catalogue_cutoff_mismatch")
        selected_keys.add(key)
        periods.append(SimpleNamespace(period_start=start, period_end=end))
    if complete_periods(periods, year):
        return []
    additional, errors = [], []
    for key, report in sorted(inventory.items()):
        if key in selected_keys:
            continue
        try:
            response = http.post(
                document_url(),
                data=document_form(
                    registration_number=registration,
                    filing_year=year,
                    kind=kind,
                    report_type=report.report_type,
                    amendment_index=report.effective_amendment_index,
                    special_election=report.special_election,
                ),
                timeout=25,
            )
            response.raise_for_status()
            body = response.content
            if not body.startswith(b"%PDF"):
                raise ReportCoverageError("coverage_document_not_served")
            digest = hashlib.sha256(body).hexdigest()
            (directory / f"{digest}.pdf").write_bytes(body)
            additional.append(
                {
                    "document_hash": digest,
                    "report_type": key[0],
                    "amendment_index": key[1],
                    "special_election": key[2],
                    "cut_off_date": str(key[3]),
                }
            )
            _, end = _read_header(body, registration, year)
            if end != key[3]:
                raise ReportCoverageError("coverage_document_catalogue_cutoff_mismatch")
        except Exception as error:  # noqa: BLE001 - retain other earlier report bytes
            errors.append(
                {
                    "purpose": "period_only",
                    "report": asdict(report),
                    "error": str(error)
                    if isinstance(error, ReportCoverageError)
                    else type(error).__name__,
                }
            )
        time.sleep(0.25)
    manifest = {
        "registration_number": registration,
        "year": year,
        "catalogue_hash": catalogue_hash,
        "documents": additional,
    }
    destination = directory / f"{registration}-{year}-coverage.json"
    temporary = destination.with_suffix(".pending")
    temporary.write_text(json.dumps(manifest, indent=2))
    temporary.replace(destination)
    return errors


def collect_one(
    directory: Path,
    registration: str,
    year: int,
    kind: Kind | None,
    *,
    reuse_retained: bool = False,
) -> str:
    """Refresh official versions unless the caller explicitly requests saved bytes.

    A catalogue is evidence even when its newly effective PDF is unavailable. Keep
    it independently so a failed download cannot resurrect an older comparison.
    """
    key = f"{registration}-{year}"
    destination = directory / f"{key}.json"
    if reuse_retained and destination.exists():
        return "retained"
    directory.mkdir(parents=True, exist_ok=True)
    attempts, documents, catalogues = [], [], []
    selected = []
    with http_session() as http:
        for candidate_kind in [kind] if kind else list(Kind):
            try:
                form = viewer_form(registration, segment_for_year(year), "reports_data")
                response = http.post(viewer_url(candidate_kind), data=form, timeout=25)
                response.raise_for_status()
                catalogue_bytes = response.content
                catalogue_hash = hashlib.sha256(catalogue_bytes).hexdigest()
                catalogue_name = f"{catalogue_hash}-catalogue.json"
                (directory / catalogue_name).write_bytes(catalogue_bytes)
                catalogue = {
                    "kind": candidate_kind.value,
                    "catalogue_path": catalogue_name,
                    "catalogue_hash": catalogue_hash,
                    "fetched_at": datetime.now(UTC).isoformat(),
                    "selected_reports": [],
                }
                catalogues.append(catalogue)
                entries, errors = parse_catalogue_payload(response.json(), registration)
                if errors:
                    raise ValueError("catalogue_parse_errors")
                selected = selected_reports(entries, year)
                catalogue["selected_reports"] = [asdict(report) for report in selected]
            except Exception as error:  # noqa: BLE001 - retain each bounded source failure
                attempts.append(
                    {
                        "kind": candidate_kind.value,
                        "error": str(error)
                        if isinstance(error, ValueError)
                        else type(error).__name__,
                    }
                )
                time.sleep(0.25)
                continue
            # Do not switch filer kind after a valid catalogue selected the reports.
            # A missing PDF is a failure of this selected report, not another identity.
            for report in selected:
                try:
                    form = document_form(
                        registration_number=registration,
                        filing_year=year,
                        kind=candidate_kind,
                        report_type=report.report_type,
                        amendment_index=report.effective_amendment_index,
                        special_election=report.special_election,
                    )
                    response = http.post(document_url(), data=form, timeout=25)
                    response.raise_for_status()
                    body = response.content
                    if not body.startswith(b"%PDF"):
                        raise ValueError("document_not_served")
                    digest = hashlib.sha256(body).hexdigest()
                    (directory / f"{digest}.pdf").write_bytes(body)
                    documents.append(
                        {
                            "report": asdict(report),
                            "kind": candidate_kind.value,
                            "document_hash": digest,
                            "path": f"{digest}.pdf",
                            "catalogue_path": catalogue_name,
                            "catalogue_hash": catalogue_hash,
                        }
                    )
                except Exception as error:  # noqa: BLE001 - preserve other served PDFs
                    attempts.append(
                        {
                            "kind": candidate_kind.value,
                            "report": asdict(report),
                            "error": str(error)
                            if isinstance(error, ValueError)
                            else type(error).__name__,
                        }
                    )
                time.sleep(0.25)
            if len(documents) == len(selected):
                try:
                    attempts.extend(
                        _collect_coverage(
                            http,
                            directory,
                            registration,
                            year,
                            candidate_kind,
                            entries,
                            documents,
                            catalogue_hash,
                        )
                    )
                except Exception as error:  # noqa: BLE001 - preserve selected documents
                    attempts.append(
                        {
                            "purpose": "period_only",
                            "error": str(error)
                            if isinstance(error, ReportCoverageError)
                            else type(error).__name__,
                        }
                    )
            break
    record = {
        "recipient": registration,
        "year": year,
        "documents": documents,
        "catalogues": catalogues,
        "attempts": attempts,
        "fetched_at": datetime.now(UTC).isoformat(),
    }
    temporary = destination.with_suffix(".pending")
    temporary.write_text(json.dumps(record, default=str, indent=2))
    temporary.replace(destination)
    return (
        "collected" if selected and len(documents) == len(selected) else "unavailable"
    )


def collect_reports(
    db: Session, directory: Path, years: list[int], *, reuse_retained: bool = False
) -> dict[str, int]:
    _, filings, _, targets, _ = source_context(db, years)
    kinds = {
        r: k
        for r, k in db.execute(
            select(
                CampaignFinanceFiler.registration_number, CampaignFinanceFiler.kind
            ).where(CampaignFinanceFiler.snapshot_id == filings)
        )
    }
    db.rollback()
    directory.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    # Two independent public reads at most; no paid APIs and no speculative chain.
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(
                collect_one,
                directory,
                r,
                y,
                kinds.get(r),
                reuse_retained=reuse_retained,
            )
            for r, y in targets
        ]
        for future in as_completed(futures):
            outcome = future.result()
            counts[outcome] = counts.get(outcome, 0) + 1
    return counts
