"""Save private transition evidence and intended notifications in the same transaction."""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from alethical.api.services.admin_access import eligible_administrator_accounts
from alethical.db.models import (
    CandidateClaim,
    CandidateClaimEmailDelivery,
    CandidateClaimEvent,
    CandidateRecord,
)


def candidate_context(candidate: CandidateRecord) -> dict:
    payload = candidate.public_payload
    election = payload.get("election", {})
    return {
        "candidate_id": candidate.id,
        "candidate_name": payload.get("candidate", {}).get("name", "Candidate"),
        "office": payload.get("office", ""),
        "voting_area": payload.get("votingArea", ""),
        "election_id": candidate.election_id,
        "election_name": election.get("name") or election.get("label", ""),
        "election_date": candidate.election_date.isoformat(),
        "official_source": payload.get("source", {}),
        "official_checked_at": candidate.checked_at.isoformat(),
    }


def record_event(
    db: Session,
    claim: CandidateClaim,
    candidate: CandidateRecord,
    *,
    kind: str,
    actor_id: UUID,
    identity_verified: bool = False,
    statement_removed: bool = False,
) -> CandidateClaimEvent:
    """The caller commits the event, request and queued rows together."""
    event = CandidateClaimEvent(
        claim_id=claim.id,
        kind=kind,
        claim_version=claim.version,
        actor_id=actor_id,
        evidence_url=claim.evidence_url,
        request_note=claim.request_note,
        review_note=claim.review_note
        if kind in {"approved", "rejected", "revoked"}
        else None,
        identity_verified=identity_verified,
        statement_removed=statement_removed,
        candidate_snapshot=candidate_context(candidate),
        created_at=datetime.now(timezone.utc),
    )
    db.add(event)
    db.flush()
    if kind not in {"submitted", "resubmitted", "approved", "rejected", "revoked"}:
        return event
    recipients = {
        recipient.user_id: "admin" for recipient in eligible_administrator_accounts(db)
    }
    if kind in {"approved", "rejected", "revoked"}:
        recipients.pop(actor_id, None)
        recipients[claim.user_id] = "applicant"
    for user_id, recipient_kind in recipients.items():
        db.add(
            CandidateClaimEmailDelivery(
                event_id=event.id,
                user_id=user_id,
                recipient_kind=recipient_kind,
                state="pending",
                attempt_count=0,
            )
        )
    db.flush()
    return event
