"""Read one atomically published, source-bound donor-proof run."""

from __future__ import annotations

from typing import Any
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.pipeline.lobbyist_donor_proof import PROOF_VERSION


def active_evidence(db: Session, snapshot_id: UUID, row_count: int) -> dict | None:
    run = schema.LobbyistDonationEvidence
    current = schema.LobbyistDonationEvidenceCurrent
    filings = schema.CampaignFinanceFilingCurrentSnapshot
    current_filings = (
        select(filings.snapshot_id).where(filings.id.is_(True)).scalar_subquery()
    )
    row = db.execute(
        select(
            run.evidence,
            run.id,
            run.created_at,
            run.filings_snapshot_id,
            current_filings.label("current_filings_id"),
        )
        .join(current, current.evidence_id == run.id)
        .where(
            current.id.is_(True),
            run.contributions_snapshot_id == snapshot_id,
            run.source_row_count == row_count,
            run.proof_version == PROOF_VERSION,
        )
    ).first()
    if row is None:
        return None
    evidence: dict[str, Any] = {
        **row.evidence,
        "id": str(row.id),
        "checked_at": row.created_at,
    }
    if row.filings_snapshot_id == row.current_filings_id:
        return {**evidence, "proof_state": "current"}
    # A filing refresh invalidates positive proof, but cannot erase known donor
    # relationships. Keep only negative closure until fresh proof is activated.
    unresolved = {
        (
            item["donor_registration_number"],
            item["recipient_registration_number"],
            item["year"],
        ): dict(item)
        for item in evidence.get("unresolved_donors", [])
    }
    for recipient in evidence["recipients"]:
        for donor in recipient["donors"]:
            key = donor, recipient["registration_number"], recipient["year"]
            unresolved.setdefault(
                key,
                {
                    "donor_registration_number": donor,
                    "recipient_registration_number": recipient["registration_number"],
                    "year": recipient["year"],
                    "previous_evidence_id": str(row.id),
                },
            )
    return {
        **evidence,
        "proof_state": "stale_filings",
        "recipients": [],
        "unresolved_donors": [unresolved[key] for key in sorted(unresolved)],
    }


def matched_row_numbers(
    evidence: dict | None, registration_number: str | None = None
) -> dict[int, str]:
    """Extra identity associations and original rows, shared by amount and profile."""
    matches: dict[int, str] = {}
    if evidence is None:
        return matches
    for recipient in evidence["recipients"]:
        for donor, proof in recipient["donors"].items():
            if proof["status"] != "agrees" or (
                registration_number is not None and donor != registration_number
            ):
                continue
            for number in proof["row_numbers"]:
                matches[number] = donor
    return matches
