"""Publish a recomputed evidence run atomically, retaining its complete audit bytes."""

from __future__ import annotations

import gzip
import hashlib
import json
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from alethical.api.services.committee_finance import current_release
from alethical.db import models as schema
from alethical.pipeline.lobbyist_donor_proof import PROOF_VERSION, source_fingerprint
from alethical.pipeline.lobbyist_evidence_run import build_run, superseded_comparisons
from alethical.pipeline.campaign_finance_report_document_store import (
    gzip_bytes_to,
    store_document,
    read_document,
)

SOURCE_COLUMNS = (
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


def source_context(db: Session, years: list[int]) -> tuple:
    release = current_release(db)
    if release is None:
        raise ValueError("no_campaign_release")
    source = release.contributions
    gifts = schema.CampaignFinanceContributionRow
    count = db.scalar(
        select(func.count())
        .select_from(gifts)
        .where(gifts.snapshot_id == source.snapshot_id)
    )
    if count != source.row_count:
        raise ValueError("contribution_snapshot_partly_pruned")
    filings = db.scalar(
        select(schema.CampaignFinanceFilingCurrentSnapshot.snapshot_id).where(
            schema.CampaignFinanceFilingCurrentSnapshot.id.is_(True)
        )
    )
    if filings is None:
        raise ValueError("no_filing_snapshot")
    # Include every recipient of a held lobbyist contribution, irrespective of the
    # current roster. A person leaving the roster does not erase proof provenance.
    targets = list(
        db.execute(
            select(gifts.recipient_reg_num, gifts.year)
            .where(
                gifts.snapshot_id == source.snapshot_id,
                gifts.year.in_(years),
                gifts.receipt_type == "Contribution",
                gifts.contrib_type == "Lobbyist",
                gifts.contrib_reg_num.is_not(None),
                gifts.recipient_reg_num.is_not(None),
            )
            .distinct()
        ).all()
    )
    recipients = sorted({r for r, _ in targets})
    rows = [
        dict(r)
        for r in db.execute(
            select(*(getattr(gifts, c) for c in SOURCE_COLUMNS)).where(
                gifts.snapshot_id == source.snapshot_id,
                gifts.year.in_(years),
                gifts.receipt_type == "Contribution",
                gifts.recipient_reg_num.in_(recipients),
            )
        ).mappings()
    ]
    compared = schema.CampaignFinanceStatedSplit
    comparisons = {
        (r.registration_number, r.filing_year): {
            "status": r.status.value,
            "report_type": r.report_type,
            "amendment_index": r.amendment_index,
            "document_hash": r.document_hash,
            "cut_off_date": r.cut_off_date,
        }
        for r in db.scalars(
            select(compared).where(
                compared.snapshot_id == source.snapshot_id,
                compared.filings_snapshot_id == filings,
                compared.filing_year.in_(years),
            )
        )
    }
    return release, filings, rows, targets, comparisons


def inherited_unresolved_donors(
    run: dict, previous_evidence: dict, previous_id: str
) -> list[dict]:
    """Do not forget known donor relationships when replacement proof cannot read them.

    Only a current donor verdict resolves a prior relationship. Existing unresolved
    relationships retain their original evidence ID so repeated preparation is stable.
    """
    current = {
        (donor, recipient["registration_number"], recipient["year"])
        for recipient in run["recipients"]
        for donor in recipient["donors"]
    }
    inherited = {
        (
            item["donor_registration_number"],
            item["recipient_registration_number"],
            item["year"],
        ): dict(item)
        for item in previous_evidence.get("unresolved_donors", [])
    }
    for recipient in previous_evidence.get("recipients", []):
        for donor in recipient["donors"]:
            key = donor, recipient["registration_number"], recipient["year"]
            inherited.setdefault(
                key,
                {
                    "donor_registration_number": donor,
                    "recipient_registration_number": recipient["registration_number"],
                    "year": recipient["year"],
                    "previous_evidence_id": previous_id,
                },
            )
    return [inherited[key] for key in sorted(inherited) if key not in current]


def _previous_same_source_evidence(db: Session, snapshot_id):
    # A pre-deployment dry run must work before the additive migration exists.
    if (
        db.scalar(text("SELECT to_regclass('lobbyist_donation_evidence_current')"))
        is None
    ):
        return None
    return db.scalar(
        select(schema.LobbyistDonationEvidence)
        .join(
            schema.LobbyistDonationEvidenceCurrent,
            schema.LobbyistDonationEvidenceCurrent.evidence_id
            == schema.LobbyistDonationEvidence.id,
        )
        .where(
            schema.LobbyistDonationEvidenceCurrent.id.is_(True),
            schema.LobbyistDonationEvidence.contributions_snapshot_id == snapshot_id,
        )
    )


def prepare_run(db: Session, directory: Path, years: list[int]) -> dict:
    release, filings, rows, targets, comparisons = source_context(db, years)
    run = build_run(directory, rows, targets)
    run.update(
        contributions_snapshot_id=str(release.contributions.snapshot_id),
        filings_snapshot_id=str(filings),
        source_row_count=release.contributions.row_count,
        release_id=str(release.id),
        years=years,
    )
    run["withheld_recipients"] = superseded_comparisons(directory, targets, comparisons)
    previous = _previous_same_source_evidence(db, release.contributions.snapshot_id)
    run["unresolved_donors"] = (
        inherited_unresolved_donors(run, previous.evidence, str(previous.id))
        if previous is not None
        else []
    )
    return run


def runtime_evidence(run: dict) -> dict:
    """Keep large catalogue bodies in the audit object, not in every directory read."""
    return {
        "version": run["version"],
        "withheld_recipients": run["withheld_recipients"],
        "unresolved_donors": run.get("unresolved_donors", []),
        "collection_versions": {
            f"{r['registration_number']}:{r['year']}": r["collected_at"]
            for r in run["recipients"] + run.get("failures", [])
            if r.get("collected_at")
        },
        "recipients": [
            {
                "registration_number": r["registration_number"],
                "year": r["year"],
                "documents": r["documents"],
                "donors": r["donors"],
            }
            for r in run["recipients"]
        ],
    }


def audit_digest(run: dict) -> str:
    return hashlib.sha256(
        json.dumps(run, sort_keys=True, default=str).encode()
    ).hexdigest()


def reject_older_collection(current: dict, proposed: dict) -> None:
    """An ordinary publish cannot remove coverage or restore older report evidence."""
    old = current.get("collection_versions", {})
    new = proposed.get("collection_versions", {})
    for key, timestamp in old.items():
        if key not in new or datetime.fromisoformat(new[key]) < datetime.fromisoformat(
            timestamp
        ):
            raise ValueError("evidence_collection_would_move_backwards")


def failed_document_key(digest: str) -> str:
    return f"campaign-finance/lobbyist-evidence/documents/{digest}.pdf.gz"


def publish_run(
    db: Session,
    store,
    directory: Path,
    run: dict,
    *,
    reviewed_hash: str,
    allow_rollback: bool = False,
) -> str:
    """Store proof bytes first, then activate one complete immutable run in a commit.

    Call only with prepare_run's recomputed output, never a supplied JSON artifact.
    A source recheck after object storage prevents activation against replaced rows.
    Old runs and original source data remain intact for rollback and audit.
    """
    from uuid import UUID

    body = json.dumps(run, sort_keys=True, default=str).encode()
    digest = hashlib.sha256(body).hexdigest()
    if digest != reviewed_hash:
        raise ValueError("reviewed_evidence_changed")
    proposed = runtime_evidence(run)
    key = f"campaign-finance/lobbyist-evidence/{digest}.json.gz"
    with TemporaryDirectory() as temp:
        # Positive and withdrawn verdicts both retain the source bytes behind them.
        stored_hashes = set()
        for recipient in run["recipients"]:
            for doc in recipient.get("documents", []) + (
                recipient.get("coverage") or {}
            ).get("documents", []):
                if doc["document_hash"] in stored_hashes:
                    continue
                stored_hashes.add(doc["document_hash"])
                pdf = (directory / f"{doc['document_hash']}.pdf").read_bytes()
                if hashlib.sha256(pdf).hexdigest() != doc["document_hash"]:
                    raise ValueError("document_changed_before_storage")
                store_document(
                    db,
                    store,
                    temp,
                    body=pdf,
                    **{
                        k: doc[k]
                        for k in (
                            "document_hash",
                            "registration_number",
                            "filing_year",
                            "report_type",
                            "amendment_index",
                            "special_election",
                        )
                    },
                )
                saved = db.get(
                    schema.CampaignFinanceReportDocument, doc["document_hash"]
                )
                if (
                    saved is None
                    or hashlib.sha256(read_document(store, saved, temp)).hexdigest()
                    != doc["document_hash"]
                ):
                    raise ValueError("stored_document_not_available")
        # A refused PDF can name a different committee. Keep its bytes without
        # asserting the requested committee identity in the shared document table.
        for failure in run.get("failures", []):
            for doc in failure.get("documents", []):
                digest_pdf = doc["document_hash"]
                pdf = (directory / f"{digest_pdf}.pdf").read_bytes()
                if hashlib.sha256(pdf).hexdigest() != digest_pdf:
                    raise ValueError("document_changed_before_storage")
                path_pdf = str(Path(temp) / "failed.pdf.gz")
                compressed_pdf_hash, _ = gzip_bytes_to(pdf, path_pdf)
                failure_key = failed_document_key(digest_pdf)
                store.put_and_verify(failure_key, path_pdf, compressed_pdf_hash)
                stored_path = str(Path(temp) / "failed-readback.pdf.gz")
                store.get(failure_key, stored_path)
                if (
                    hashlib.sha256(
                        gzip.decompress(Path(stored_path).read_bytes())
                    ).hexdigest()
                    != digest_pdf
                ):
                    raise ValueError("stored_document_not_available")
        path = str(Path(temp) / "evidence.json.gz")
        compressed_hash, _ = gzip_bytes_to(body, path)
        store.put_and_verify(key, path, compressed_hash)
    # One source-aware writer activates the result. No source pointer is changed.
    db.execute(text("SELECT pg_advisory_xact_lock(2325, 1)"))
    release = current_release(db)
    filings = db.scalar(
        select(schema.CampaignFinanceFilingCurrentSnapshot.snapshot_id).where(
            schema.CampaignFinanceFilingCurrentSnapshot.id.is_(True)
        )
    )
    if (
        release is None
        or str(release.id) != run["release_id"]
        or str(filings) != run["filings_snapshot_id"]
    ):
        raise ValueError("sources_changed_before_activation")
    count = db.scalar(
        select(func.count())
        .select_from(schema.CampaignFinanceContributionRow)
        .where(
            schema.CampaignFinanceContributionRow.snapshot_id
            == release.contributions.snapshot_id
        )
    )
    if count != run["source_row_count"]:
        raise ValueError("source_rows_changed_before_activation")
    from collections import defaultdict

    held_rows = defaultdict(list)
    gifts = schema.CampaignFinanceContributionRow
    checked = run["recipients"] + run.get("failures", [])
    recipients = {r["registration_number"] for r in checked}
    for row in db.execute(
        select(*(getattr(gifts, c) for c in SOURCE_COLUMNS)).where(
            gifts.snapshot_id == release.contributions.snapshot_id,
            gifts.year.in_(run["years"]),
            gifts.receipt_type == "Contribution",
            gifts.recipient_reg_num.in_(recipients),
        )
    ).mappings():
        held_rows[row["recipient_reg_num"], row["year"]].append(dict(row))
    for recipient in checked:
        if (
            source_fingerprint(
                held_rows[recipient["registration_number"], recipient["year"]]
            )
            != recipient["source_fingerprint"]
        ):
            raise ValueError("source_values_changed_before_activation")
    pointer = db.scalar(
        select(schema.LobbyistDonationEvidenceCurrent)
        .where(schema.LobbyistDonationEvidenceCurrent.id.is_(True))
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if pointer is not None and not allow_rollback:
        previous = db.get(schema.LobbyistDonationEvidence, pointer.evidence_id)
        if previous is not None:
            reject_older_collection(previous.evidence, proposed)
            if str(previous.contributions_snapshot_id) == run[
                "contributions_snapshot_id"
            ] and inherited_unresolved_donors(
                run, previous.evidence, str(previous.id)
            ) != run.get("unresolved_donors", []):
                raise ValueError("known_donor_relationships_changed_before_activation")
    existing = db.scalar(
        select(schema.LobbyistDonationEvidence).where(
            schema.LobbyistDonationEvidence.content_hash == digest
        )
    )
    if existing is None:
        existing = schema.LobbyistDonationEvidence(
            contributions_snapshot_id=UUID(run["contributions_snapshot_id"]),
            filings_snapshot_id=UUID(run["filings_snapshot_id"]),
            source_row_count=count,
            proof_version=PROOF_VERSION,
            content_hash=digest,
            evidence=proposed,
            audit_object_key=key,
            audit_compressed_hash=compressed_hash,
        )
        db.add(existing)
        db.flush()
    if pointer is None:
        db.add(schema.LobbyistDonationEvidenceCurrent(id=True, evidence_id=existing.id))
    else:
        pointer.evidence_id = existing.id
    result = str(existing.id)
    db.commit()
    return result
