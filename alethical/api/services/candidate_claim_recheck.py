"""One official-source recheck, with no database locks held during source I/O."""

from copy import deepcopy
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.api.services import candidate_claims as claims
from alethical.api.services.admin_access import administrator_account_access
from alethical.api.services.candidate_recheck import (
    CandidateRecheckReason,
    CandidateRecheckUnavailable,
    fetch_candidate_recheck,
)
from alethical.api.services.person_records import save_candidate_record
from alethical.db.models import CandidateClaim, CandidateRecord, UserAccount


def _admin(db: Session, user: UserAccount, expected: UUID) -> None:
    account = claims._writer(db, user, expected, owner=False)
    if not administrator_account_access(db, account.id):
        claims._fail(403, "Administrator access is required", "admin_access_required")


def _request(db: Session, claim_id: UUID, expected: int) -> CandidateClaim:
    claim = db.get(CandidateClaim, claim_id, populate_existing=True)
    if claim is None:
        claims._fail(
            404,
            "This profile claim request is unavailable",
            "profile_claim_unavailable",
        )
    claims._version(claim.version, expected)
    return claim


def recheck(
    db: Session,
    user: UserAccount,
    *,
    claim_id: UUID,
    expected_account_id: UUID,
    expected_version: int,
) -> dict:
    _admin(db, user, expected_account_id)
    claim = _request(db, claim_id, expected_version)
    row = db.get(CandidateRecord, claim.candidate_id)
    if row is None:
        claims._fail(
            404, "This candidate profile is unavailable", "candidate_unavailable"
        )
    cid, election_id, election_date = row.id, row.election_id, row.election_date
    original_payload = deepcopy(row.public_payload)
    original_hash, original_checked = row.source_sha256, row.checked_at
    # The request only read data so far. Release the account lock and connection
    # transaction before fetching the official source.
    db.commit()
    fresh, failure = None, None
    try:
        fresh = fetch_candidate_recheck(
            cid, original_payload, election_id, election_date
        )
    except CandidateRecheckUnavailable as error:
        failure = error.reason

    # Account deletion, changed role and a newer review can happen during I/O.
    _admin(db, user, expected_account_id)
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:candidate_id))"),
        {"candidate_id": cid},
    )
    row = claims._candidate(db, cid)
    _request(db, claim_id, expected_version)
    if (
        row.election_id != election_id
        or row.election_date != election_date
        or row.public_payload != original_payload
        or row.source_sha256 != original_hash
        or row.checked_at != original_checked
    ):
        claims._fail(
            409,
            "This profile claim request changed. Review the latest status before continuing.",
            "profile_claim_changed",
        )
    if failure is not None:
        if failure in {
            CandidateRecheckReason.IDENTITY_MISMATCH,
            CandidateRecheckReason.ELECTION_MISMATCH,
            CandidateRecheckReason.CANDIDATE_MISSING,
        }:
            row.claim_source_block = failure.value
        # Failure never changes the successful source payload, version or date.
        db.commit()
        claims._fail(
            503,
            "We couldn’t recheck the official candidate record",
            "official_record_recheck_failed",
        )
    if fresh is None or not fresh.matches_record(
        cid, row.public_payload, row.election_id, row.election_date
    ):
        claims._fail(
            409,
            "This profile claim request changed. Review the latest status before continuing.",
            "profile_claim_changed",
        )
    updated = save_candidate_record(
        db,
        profile=fresh.public_payload(),
        source_hash=fresh.source_sha256,
        checked_at=fresh.checked_at,
    )
    updated.claim_source_block = None
    db.commit()
    return {**claims.detail(db, claim_id), "account_id": str(expected_account_id)}
