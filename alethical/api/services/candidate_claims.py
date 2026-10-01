"""Private, manually verified candidate ownership and separate public statements."""

from __future__ import annotations

import ipaddress
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from typing import NoReturn
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from alethical.db.models import (
    AuthIdentity,
    CandidateClaim,
    CandidateRecord,
    CandidateStatement,
    CandidateStatementRevision,
    CandidateStatementReport,
    UserAccount,
)


def _fail(status: int, message: str) -> NoReturn:
    raise HTTPException(status, message)


def _confirmed(db: Session, user: UserAccount) -> None:
    if not user.is_active:
        _fail(403, "This account has been deactivated")
    found = user.primary_email and db.scalar(
        select(AuthIdentity.id)
        .where(
            AuthIdentity.user_id == user.id,
            AuthIdentity.email == user.primary_email,
            AuthIdentity.email_verified_at.is_not(None),
        )
        .limit(1)
    )
    if not found:
        _fail(403, "Confirm your account email before managing a candidate profile")


def _accounts(db: Session, *ids: uuid.UUID) -> dict[uuid.UUID, UserAccount]:
    # Account locks precede candidate locks, including administrator operations.
    db.execute(text("SET LOCAL lock_timeout = '5s'"))
    rows = db.scalars(
        select(UserAccount)
        .where(UserAccount.id.in_(ids))
        .order_by(UserAccount.id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    ).all()
    return {row.id: row for row in rows}


def _writer(db: Session, user: UserAccount, expected: uuid.UUID) -> UserAccount:
    if user.id != expected:
        _fail(409, "Your signed-in account changed. Reload before continuing")
    account = _accounts(db, user.id).get(user.id)
    if account is None:
        _fail(401, "Sign in to continue")
    _confirmed(db, account)
    return account


def _candidate(db: Session, candidate_id: str) -> CandidateRecord:
    row = db.scalar(
        select(CandidateRecord)
        .where(CandidateRecord.id == candidate_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None:
        _fail(404, "Candidate profile not found")
    return row


def _current(row: CandidateRecord, *, fresh: bool = False) -> None:
    now = datetime.now(timezone.utc)
    if row.election_date < now.astimezone(ZoneInfo("America/Chicago")).date():
        _fail(
            409,
            "This election has ended. Find the candidate's current election profile",
        )
    if fresh and row.checked_at < now - timedelta(hours=24):
        _fail(
            409,
            "Refresh this candidate's official ballot record before approving ownership",
        )


def _version(actual: int, expected: int) -> None:
    if actual != expected:
        _fail(409, "This record changed. Reload before continuing")


def public_url(value: str) -> str:
    """Validate evidence links without fetching an applicant-controlled address."""
    value = value.strip()
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower().rstrip(".")
        port = parsed.port
        if (
            parsed.scheme not in {"https", "http"}
            or not host
            or parsed.username is not None
            or parsed.password is not None
            or port not in {None, 80, 443}
            or any(ord(char) < 33 or char == "\\" for char in value)
        ):
            raise ValueError
        if "." not in host or host.endswith(
            (".localhost", ".local", ".internal", ".test", ".invalid")
        ):
            raise ValueError
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            # Numeric alternate IPv4 forms are not public campaign domains.
            if host.replace(".", "").isdigit():
                raise ValueError from None
            host.encode("idna")
        else:
            if not address.is_global:
                raise ValueError
    except (ValueError, UnicodeError):
        _fail(422, "Use a public campaign or official filing web address")
    return value


def _serialize(db: Session, claim: CandidateClaim, *, admin: bool = False) -> dict:
    candidate = db.get(CandidateRecord, claim.candidate_id)
    payload = candidate.public_payload if candidate else {}
    value = {
        "id": str(claim.id),
        "candidate_id": claim.candidate_id,
        "status": claim.status,
        "evidence_url": claim.evidence_url,
        "request_note": claim.request_note,
        "version": claim.version,
        "candidate_name": payload.get("candidate", {}).get("name", "Candidate"),
        "office": payload.get("office", ""),
        "created_at": claim.created_at.isoformat(),
        "updated_at": claim.updated_at.isoformat(),
    }
    if admin:
        account = db.get(UserAccount, claim.user_id)
        value.update(
            user_id=str(claim.user_id),
            account_email=account.primary_email if account else None,
            review_note=claim.review_note,
            reviewed_at=claim.reviewed_at.isoformat() if claim.reviewed_at else None,
        )
    return value


def mine(db: Session, user: UserAccount, candidate_id: str | None) -> dict:
    query = select(CandidateClaim).where(CandidateClaim.user_id == user.id)
    if candidate_id is not None:
        query = query.where(CandidateClaim.candidate_id == candidate_id)
    rows = db.scalars(query.order_by(CandidateClaim.updated_at.desc()).limit(100)).all()
    return {"account_id": str(user.id), "claims": [_serialize(db, row) for row in rows]}


def apply(
    db: Session,
    user: UserAccount,
    *,
    candidate_id: str,
    evidence_url: str,
    request_note: str,
    expected_account_id: uuid.UUID,
    expected_version: int,
) -> dict:
    user = _writer(db, user, expected_account_id)
    candidate = _candidate(db, candidate_id)
    _current(candidate)
    evidence_url = public_url(evidence_url)
    request_note = request_note.strip()
    if len(request_note) < 20:
        _fail(422, "Explain how Alethical can verify that you are this candidate")
    claim = db.scalar(
        select(CandidateClaim)
        .where(
            CandidateClaim.candidate_id == candidate_id,
            CandidateClaim.user_id == user.id,
        )
        .execution_options(populate_existing=True)
    )
    _version(claim.version if claim else 0, expected_version)
    if claim and claim.status == "approved":
        _fail(409, "You already manage this candidate profile")
    if claim is None:
        claim = CandidateClaim(
            candidate_id=candidate_id,
            user_id=user.id,
            evidence_url=evidence_url,
            request_note=request_note,
            status="pending",
            version=1,
        )
        db.add(claim)
    else:
        claim.status = "pending"
        claim.evidence_url = evidence_url
        claim.request_note = request_note
        claim.review_note = None
        claim.reviewed_by = None
        claim.reviewed_at = None
        claim.version += 1
    db.flush()
    result = {"claim": _serialize(db, claim), "account_id": str(user.id)}
    db.commit()
    return result


def _owned(db: Session, user: UserAccount, claim_id: uuid.UUID) -> CandidateClaim:
    claim = db.scalar(
        select(CandidateClaim).where(
            CandidateClaim.id == claim_id, CandidateClaim.user_id == user.id
        )
    )
    if claim is None:
        _fail(404, "Claim request not found")
    _candidate(db, claim.candidate_id)
    db.refresh(claim)
    return claim


def withdraw(
    db: Session,
    user: UserAccount,
    *,
    claim_id: uuid.UUID,
    expected_account_id: uuid.UUID,
    expected_version: int,
) -> dict:
    user = _writer(db, user, expected_account_id)
    claim = _owned(db, user, claim_id)
    _version(claim.version, expected_version)
    if claim.status not in {"pending", "approved"}:
        _fail(409, "This claim request is already closed")
    claim.status = "withdrawn"
    claim.version += 1
    _remove_owned_statement(db, claim)
    db.flush()
    result = {"claim": _serialize(db, claim), "account_id": str(user.id)}
    db.commit()
    return result


def _statement(row: CandidateStatement | None) -> dict | None:
    return (
        {
            "body": row.body,
            "updated_at": row.updated_at.isoformat(),
            "version": row.version,
        }
        if row
        else None
    )


def public_statement(db: Session, candidate_id: str) -> dict:
    if db.get(CandidateRecord, candidate_id) is None:
        _fail(404, "Candidate profile not found")
    row = db.scalar(
        select(CandidateStatement)
        .join(CandidateClaim, CandidateClaim.id == CandidateStatement.claim_id)
        .join(UserAccount, UserAccount.id == CandidateClaim.user_id)
        .where(
            CandidateStatement.candidate_id == candidate_id,
            CandidateClaim.candidate_id == candidate_id,
            CandidateClaim.status == "approved",
            UserAccount.is_active.is_(True),
            CandidateStatement.body != "",
        )
    )
    return {"statement": _statement(row)}


def write_statement(
    db: Session,
    user: UserAccount,
    *,
    claim_id: uuid.UUID,
    body: str,
    expected_account_id: uuid.UUID,
    expected_version: int,
) -> dict:
    user = _writer(db, user, expected_account_id)
    claim = _owned(db, user, claim_id)
    if claim.status != "approved":
        _fail(403, "An approved claim is required to edit this candidate profile")
    row = db.get(CandidateStatement, claim.candidate_id, populate_existing=True)
    _version(row.version if row else 0, expected_version)
    if row is not None and row.claim_id != claim.id:
        _fail(409, "Profile ownership changed. Reload before continuing")
    if any(ord(char) < 32 and char not in "\n\t\r" for char in body):
        _fail(422, "Use plain text for the candidate statement")
    body = body.strip()
    if len(body) > 2000:
        _fail(422, "Keep the candidate statement within 2000 characters")
    if row is None:
        row = CandidateStatement(
            candidate_id=claim.candidate_id,
            claim_id=claim.id,
            body=body,
            updated_at=datetime.now(timezone.utc),
            version=1,
        )
        db.add(row)
    else:
        row.body = body
        row.version += 1
        row.updated_at = datetime.now(timezone.utc)
    db.add(
        CandidateStatementRevision(
            candidate_id=claim.candidate_id,
            claim_id=claim.id,
            body=body,
            action="published" if body else "removed",
            created_at=datetime.now(timezone.utc),
        )
    )
    db.flush()
    result = {"statement": _statement(row), "account_id": str(user.id)}
    db.commit()
    return result


def _remove_owned_statement(db: Session, claim: CandidateClaim) -> None:
    row = db.get(CandidateStatement, claim.candidate_id, populate_existing=True)
    if row is not None and row.claim_id == claim.id and row.body:
        row.body = ""
        row.version += 1
        row.updated_at = datetime.now(timezone.utc)
        db.add(
            CandidateStatementRevision(
                candidate_id=claim.candidate_id,
                claim_id=claim.id,
                body="",
                action="removed",
                created_at=row.updated_at,
            )
        )


def private_statement(
    db: Session, user: UserAccount, claim_id: uuid.UUID, *, admin: bool = False
) -> dict:
    claim = db.get(CandidateClaim, claim_id)
    if claim is None or (claim.user_id != user.id and not admin):
        _fail(404, "Claim request not found")
    row = db.get(CandidateStatement, claim.candidate_id)
    if row is not None and row.claim_id != claim.id:
        row = None
    history = db.scalars(
        select(CandidateStatementRevision)
        .where(CandidateStatementRevision.claim_id == claim.id)
        .order_by(
            CandidateStatementRevision.created_at.desc(),
            CandidateStatementRevision.id.desc(),
        )
        .limit(25)
    ).all()
    return {
        "account_id": str(user.id),
        "statement": _statement(row),
        "history": [
            {
                "id": str(item.id),
                "body": item.body,
                "action": item.action,
                "created_at": item.created_at.isoformat(),
            }
            for item in history
        ],
    }


def queue(db: Session, *, status: str, offset: int, limit: int) -> dict:
    query = select(CandidateClaim)
    if status != "all":
        query = query.where(CandidateClaim.status == status)
    rows = db.scalars(
        query.order_by(CandidateClaim.created_at, CandidateClaim.id)
        .offset(offset)
        .limit(limit + 1)
    ).all()
    return {
        "claims": [_serialize(db, row, admin=True) for row in rows[:limit]],
        "offset": offset,
        "has_more": len(rows) > limit,
    }


def review(
    db: Session,
    user: UserAccount,
    *,
    claim_id: uuid.UUID,
    action: str,
    review_note: str,
    identity_verified: bool,
    expected_version: int,
    expected_account_id: uuid.UUID,
) -> dict:
    if user.id != expected_account_id:
        _fail(409, "Your signed-in account changed. Reload before continuing")
    claim = db.get(CandidateClaim, claim_id)
    if claim is None:
        _fail(404, "Claim request not found")
    if claim.user_id == user.id:
        _fail(403, "An administrator cannot review their own candidate claim")
    accounts = _accounts(db, user.id, claim.user_id)
    administrator = accounts.get(user.id)
    if administrator is None:
        _fail(401, "Sign in to continue")
    _confirmed(db, administrator)
    candidate = _candidate(db, claim.candidate_id)
    db.refresh(claim)
    _version(claim.version, expected_version)
    review_note = review_note.strip()
    if len(review_note) < 20:
        _fail(422, "Record the independent verification or reason for this decision")
    if action == "approve":
        if claim.status != "pending":
            _fail(409, "Only a pending claim can be approved")
        if not identity_verified:
            _fail(422, "Independently verify the candidate's identity before approval")
        claimant = accounts.get(claim.user_id)
        if claimant is None:
            _fail(409, "The requesting account no longer exists")
        _confirmed(db, claimant)
        _current(candidate, fresh=True)
        approved = db.scalar(
            select(CandidateClaim.id).where(
                CandidateClaim.candidate_id == candidate.id,
                CandidateClaim.status == "approved",
            )
        )
        if approved:
            _fail(409, "This candidate profile already has an approved owner")
        claim.status = "approved"
        db.execute(
            delete(CandidateStatement).where(
                CandidateStatement.candidate_id == candidate.id
            )
        )
    elif action == "reject":
        if claim.status != "pending":
            _fail(409, "Only a pending claim can be rejected")
        claim.status = "rejected"
    elif action == "revoke":
        if claim.status != "approved":
            _fail(409, "Only approved ownership can be revoked")
        claim.status = "revoked"
        _remove_owned_statement(db, claim)
    else:
        _fail(422, "Choose approve, reject, or revoke")
    claim.review_note = review_note
    claim.reviewed_by = user.id
    claim.reviewed_at = datetime.now(timezone.utc)
    claim.version += 1
    db.flush()
    result = {"claim": _serialize(db, claim, admin=True), "account_id": str(user.id)}
    db.commit()
    return result


def report_statement(
    db: Session, candidate_id: str, reason: str, *, expected_version: int
) -> dict:
    candidate = _candidate(db, candidate_id)
    row = db.get(CandidateStatement, candidate.id, populate_existing=True)
    if row is None or not public_statement(db, candidate_id)["statement"]:
        _fail(404, "Published candidate statement not found")
    if row.version != expected_version:
        _fail(409, "The campaign statement changed: reload it before reporting")
    reason = reason.strip()
    if not reason:
        _fail(422, "Explain what should be reviewed")
    db.add(
        CandidateStatementReport(
            candidate_id=candidate_id,
            claim_id=row.claim_id,
            reason=reason,
            statement_body=row.body,
            statement_version=row.version,
            created_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    return {"received": True}


def reports(db: Session, *, offset: int, limit: int) -> dict:
    rows = db.scalars(
        select(CandidateStatementReport)
        .where(CandidateStatementReport.resolved_at.is_(None))
        .order_by(CandidateStatementReport.created_at, CandidateStatementReport.id)
        .offset(offset)
        .limit(limit + 1)
    ).all()
    items = []
    for row in rows[:limit]:
        candidate = db.get(CandidateRecord, row.candidate_id)
        payload = candidate.public_payload if candidate else {}
        items.append(
            {
                "id": str(row.id),
                "candidate_id": row.candidate_id,
                "claim_id": str(row.claim_id),
                "reason": row.reason,
                "statement_body": row.statement_body,
                "statement_version": row.statement_version,
                "created_at": row.created_at.isoformat(),
                "candidate_name": payload.get("candidate", {}).get("name", "Candidate"),
                "office": payload.get("office", ""),
            }
        )
    return {"reports": items, "offset": offset, "has_more": len(rows) > limit}


def resolve_report(
    db: Session, user: UserAccount, report_id: uuid.UUID, expected_account_id: uuid.UUID
) -> dict:
    _writer(db, user, expected_account_id)
    row = db.scalar(
        select(CandidateStatementReport)
        .where(CandidateStatementReport.id == report_id)
        .with_for_update()
    )
    if row is None:
        _fail(404, "Statement report not found")
    row.resolved_at = row.resolved_at or datetime.now(timezone.utc)
    db.commit()
    return {"resolved": True}
