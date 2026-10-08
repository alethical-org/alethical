"""Private, manually verified candidate ownership and separate public statements."""

from __future__ import annotations

import ipaddress
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from typing import NoReturn, cast
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select, text, func
from sqlalchemy.orm import Session, aliased

from alethical.api.problems import problem_exception
from alethical.api.services.admin_access import (
    administrator_account_access,
    eligible_administrator_account_ids,
)
from alethical.api.services.candidate_claim_events import (
    candidate_context,
    record_event,
)

from alethical.api.services.candidate_claim_identity import current_confirmed_emails

from alethical.db.models import (
    CandidateClaim,
    CandidateClaimEvent,
    CandidateRecord,
    CandidateStatement,
    CandidateStatementRevision,
    CandidateStatementReport,
    UserAccount,
)


def _fail(
    status: int, message: str, reason: str = "profile_claim_unavailable"
) -> NoReturn:
    error = problem_exception(
        status,
        "Profile claim request failed",
        message,
        type_slug=reason.replace("_", "-"),
    )
    cast(dict, error.detail)["reason"] = reason
    raise error


def _confirmed(db: Session, user: UserAccount) -> None:
    if not user.is_active:
        _fail(403, "This account has been deactivated", "account_inactive")
    found = current_confirmed_emails(db, {user.id}).get(user.id)
    if not found:
        _fail(
            403,
            "Confirm your account email before managing a candidate profile",
            "email_unconfirmed",
        )


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


def _writer(
    db: Session, user: UserAccount, expected: uuid.UUID, *, owner: bool = True
) -> UserAccount:
    if user.id != expected:
        _fail(
            409,
            "Your signed-in account changed. Reload before continuing",
            "account_changed",
        )
    account = _accounts(db, user.id).get(user.id)
    if account is None:
        _fail(401, "Sign in to continue")
    if owner and administrator_account_access(db, account.id):
        _fail(
            403,
            "Admin accounts cannot claim candidate profiles or manage campaign statements",
            "applicant_is_admin",
        )
    if owner:
        _confirmed(db, account)
    elif not account.is_active:
        _fail(403, "This account has been deactivated", "account_inactive")
    return account


def _candidate(db: Session, candidate_id: str) -> CandidateRecord:
    row = db.scalar(
        select(CandidateRecord)
        .where(CandidateRecord.id == candidate_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None:
        _fail(404, "This candidate profile is unavailable", "candidate_unavailable")
    return row


def _current(row: CandidateRecord, *, fresh: bool = False) -> None:
    now = datetime.now(timezone.utc)
    if row.election_date < now.astimezone(ZoneInfo("America/Chicago")).date():
        _fail(
            409,
            "This election has ended, so this profile claim request can no longer be approved",
            "election_ended",
        )
    if row.claim_source_block is not None:
        _fail(
            409,
            "The official candidate record could not be confirmed, so this profile claim request cannot be approved",
            "official_record_mismatch",
        )
    if fresh and row.checked_at < now - timedelta(hours=24):
        _fail(
            409,
            "The official candidate record must be checked again before this profile claim request can be approved",
            "official_record_stale",
        )


def _version(actual: int, expected: int) -> None:
    if actual != expected:
        _fail(
            409,
            "This profile claim request changed. Review the latest status before continuing.",
            "profile_claim_changed",
        )


def public_url(value: str) -> str:
    """Validate evidence links without fetching an applicant-controlled address."""
    value = value.strip()
    if not value:
        _fail(
            422,
            "Add a link to a campaign website or official record",
            "evidence_url_required",
        )
    if len(value) > 2000:
        _fail(
            422,
            "Use a web address with no more than 2000 characters",
            "evidence_url_too_long",
        )
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
        _fail(
            422,
            "Enter a valid public campaign or official-record web address",
            "evidence_url_invalid",
        )
    return value


def _email_confirmed_ids(db: Session, account_ids: set[uuid.UUID]) -> set[uuid.UUID]:
    return set(current_confirmed_emails(db, account_ids))


def _approval_block(
    candidate: CandidateRecord,
    account: UserAccount,
    *,
    is_admin: bool,
    confirmed: bool,
    other_owner: bool,
) -> dict | None:
    now = datetime.now(timezone.utc)
    if candidate.election_date < now.astimezone(ZoneInfo("America/Chicago")).date():
        return {
            "reason": "election_ended",
            "message": "This election has ended, so this profile claim request can no longer be approved",
        }
    if is_admin:
        return {
            "reason": "applicant_is_admin",
            "message": "Admin accounts cannot claim candidate profiles",
        }
    if not account.is_active:
        return {
            "reason": "account_inactive",
            "message": "This account has been deactivated",
        }
    if not confirmed:
        return {
            "reason": "email_unconfirmed",
            "message": "The applicant must confirm their account email before this profile claim request can be approved",
        }
    if candidate.claim_source_block is not None:
        return {
            "reason": "official_record_mismatch",
            "message": "The official candidate record could not be confirmed, so this profile claim request cannot be approved",
        }
    if candidate.checked_at < now - timedelta(hours=24):
        return {
            "reason": "official_record_stale",
            "message": "The official candidate record must be checked again before this profile claim request can be approved",
        }
    if other_owner:
        return {
            "reason": "profile_already_claimed",
            "message": "This candidate profile already has an approved profile claim. Review the existing profile claim before approving another account.",
        }
    return None


def _read_claims(db: Session, query, *, admin: bool = False) -> list[dict]:
    # Each list uses joined reads plus bounded batch lookups, not queries per row.
    rows = db.execute(
        query.join(
            CandidateRecord, CandidateRecord.id == CandidateClaim.candidate_id
        ).join(UserAccount, UserAccount.id == CandidateClaim.user_id)
    ).all()
    if not rows:
        return []
    admin_ids = eligible_administrator_account_ids(db)
    confirmed_emails = current_confirmed_emails(
        db, {account.id for _, _, account in rows}
    )
    confirmed_ids = set(confirmed_emails)
    owners = {
        candidate_id: owner_id
        for candidate_id, owner_id in db.execute(
            select(CandidateClaim.candidate_id, CandidateClaim.id).where(
                CandidateClaim.candidate_id.in_(
                    {candidate.id for _, candidate, _ in rows}
                ),
                CandidateClaim.status == "approved",
            )
        ).all()
    }
    latest_events = {
        event.claim_id: event
        for event in db.scalars(
            select(CandidateClaimEvent)
            .where(CandidateClaimEvent.claim_id.in_({claim.id for claim, _, _ in rows}))
            .distinct(CandidateClaimEvent.claim_id)
            .order_by(
                CandidateClaimEvent.claim_id, CandidateClaimEvent.claim_version.desc()
            )
        )
    }
    submitted_at = (
        {
            claim_id: created_at
            for claim_id, created_at in db.execute(
                select(
                    CandidateClaimEvent.claim_id,
                    func.max(CandidateClaimEvent.created_at),
                )
                .where(
                    CandidateClaimEvent.claim_id.in_(
                        {claim.id for claim, _, _ in rows}
                    ),
                    CandidateClaimEvent.kind.in_(("submitted", "resubmitted")),
                )
                .group_by(CandidateClaimEvent.claim_id)
            ).all()
        }
        if admin
        else {}
    )
    values = []
    for claim, candidate, account in rows:
        ended = (
            candidate.election_date
            < datetime.now(timezone.utc).astimezone(ZoneInfo("America/Chicago")).date()
        )
        eligible = (
            account.is_active
            and account.id in confirmed_ids
            and account.id not in admin_ids
        )
        last_event = latest_events.get(claim.id)
        value = {
            "id": str(claim.id),
            **candidate_context(candidate),
            "status": claim.status,
            "evidence_url": claim.evidence_url,
            "request_note": claim.request_note,
            "version": claim.version,
            "created_at": claim.created_at.isoformat(),
            "updated_at": claim.updated_at.isoformat(),
            "election_ended": ended,
            "can_manage": bool(eligible and claim.status == "approved"),
            "can_request_review": bool(
                eligible
                and not ended
                and candidate.claim_source_block is None
                and claim.status in {"rejected", "withdrawn", "revoked"}
            ),
            "last_event_kind": last_event.kind if last_event else None,
            "statement_removed": last_event.statement_removed if last_event else False,
        }
        if admin:
            value.update(
                user_id=str(account.id),
                account_email=confirmed_emails.get(account.id),
                applicant_is_admin=account.id in admin_ids,
                submitted_at=submitted_at.get(claim.id, claim.created_at).isoformat(),
                review_note=claim.review_note,
                reviewed_at=claim.reviewed_at.isoformat()
                if claim.reviewed_at
                else None,
                approval_block=_approval_block(
                    candidate,
                    account,
                    is_admin=account.id in admin_ids,
                    confirmed=account.id in confirmed_ids,
                    other_owner=candidate.id in owners
                    and owners[candidate.id] != claim.id,
                )
                if claim.status == "pending"
                else None,
            )
        values.append(value)
    return values


def _serialize(db: Session, claim: CandidateClaim, *, admin: bool = False) -> dict:
    return _read_claims(
        db,
        select(CandidateClaim, CandidateRecord, UserAccount).where(
            CandidateClaim.id == claim.id
        ),
        admin=admin,
    )[0]


def mine(db: Session, user: UserAccount, candidate_id: str | None) -> dict:
    query = select(CandidateClaim, CandidateRecord, UserAccount).where(
        CandidateClaim.user_id == user.id
    )
    candidate = None
    if candidate_id is not None:
        candidate = db.get(CandidateRecord, candidate_id)
        if candidate is None:
            _fail(404, "This candidate profile is unavailable", "candidate_unavailable")
        query = query.where(CandidateClaim.candidate_id == candidate_id)
    rows = _read_claims(db, query.order_by(CandidateClaim.updated_at.desc()).limit(100))
    is_admin = administrator_account_access(db, user.id)
    result = {"account_id": str(user.id), "claims": rows, "is_admin": is_admin}
    if candidate is not None:
        ended = (
            candidate.election_date
            < datetime.now(timezone.utc).astimezone(ZoneInfo("America/Chicago")).date()
        )
        confirmed = user.id in _email_confirmed_ids(db, {user.id})
        reason = (
            "applicant_is_admin"
            if is_admin
            else "account_inactive"
            if not user.is_active
            else "email_unconfirmed"
            if not confirmed
            else "election_ended"
            if ended
            else "official_record_unavailable"
            if candidate.claim_source_block is not None
            else "profile_claim_pending"
            if rows and rows[0]["status"] == "pending"
            else "profile_claim_approved"
            if rows and rows[0]["status"] == "approved"
            else None
        )
        result["request_eligibility"] = {"allowed": reason is None, "reason": reason}
        result["already_claimed"] = (
            db.scalar(
                select(CandidateClaim.id).where(
                    CandidateClaim.candidate_id == candidate_id,
                    CandidateClaim.status == "approved",
                    CandidateClaim.user_id != user.id,
                )
            )
            is not None
        )
    return result


def _validate_request_note(request_note: str) -> str:
    note = request_note.strip()
    role, separator, explanation = note.partition("\n\n")
    if role not in {"Candidate", "Authorized campaign representative"} or not separator:
        _fail(422, "Choose your role", "role_required")
    explanation = explanation.strip()
    if len(explanation) < 20:
        _fail(
            422,
            "Explain your role and how Alethical can confirm it in at least 20 characters",
            "explanation_too_short",
        )
    if len(explanation) > 1900 or len(note) > 2000:
        _fail(
            422,
            "Keep your explanation to 1900 characters or fewer",
            "explanation_too_long",
        )
    return role + "\n\n" + explanation


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
        _fail(
            409, "You already manage this candidate profile", "profile_claim_approved"
        )
    if claim and claim.status == "pending":
        # Opening or retrying a pending request never overwrites private evidence.
        return {
            "claim": _serialize(db, claim),
            "account_id": str(user.id),
            "already_submitted": True,
        }
    _current(candidate)
    evidence_url = public_url(evidence_url)
    request_note = _validate_request_note(request_note)
    event_kind = "submitted" if claim is None else "resubmitted"
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
    record_event(db, claim, candidate, kind=event_kind, actor_id=user.id)
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
        _fail(
            404,
            "This profile claim request is unavailable",
            "profile_claim_unavailable",
        )
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
        _fail(
            409, "This profile claim request is already closed", "profile_claim_closed"
        )
    kind = "given_up" if claim.status == "approved" else "withdrawn"
    claim.status = "withdrawn"
    claim.version += 1
    removed = _remove_owned_statement(db, claim)
    db.flush()
    candidate = db.get(CandidateRecord, claim.candidate_id)
    assert candidate is not None  # The candidate is locked and referenced by the claim.
    record_event(
        db,
        claim,
        candidate,
        kind=kind,
        actor_id=user.id,
        statement_removed=removed,
    )
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
            UserAccount.id.not_in(eligible_administrator_account_ids(db)),
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
        _fail(
            403,
            "An approved profile claim is required to edit this candidate profile",
            "profile_claim_not_approved",
        )
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


def _remove_owned_statement(db: Session, claim: CandidateClaim) -> bool:
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
        return True
    return False


def private_statement(
    db: Session, user: UserAccount, claim_id: uuid.UUID, *, admin: bool = False
) -> dict:
    claim = db.get(CandidateClaim, claim_id)
    if claim is None or (claim.user_id != user.id and not admin):
        _fail(
            404,
            "This profile claim request is unavailable",
            "profile_claim_unavailable",
        )
    if not admin and administrator_account_access(db, user.id):
        _fail(
            403,
            "Admin accounts cannot claim candidate profiles or manage campaign statements",
            "applicant_is_admin",
        )
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


def queue(
    db: Session,
    *,
    status: str,
    offset: int,
    limit: int = 25,
    candidate_id: str | None = None,
) -> dict:
    query = select(CandidateClaim, CandidateRecord, UserAccount)
    candidate = None
    if candidate_id is not None:
        candidate = db.get(CandidateRecord, candidate_id)
        if candidate is None:
            _fail(404, "This candidate profile is unavailable", "candidate_unavailable")
        query = query.where(CandidateClaim.candidate_id == candidate_id)
    if status != "all":
        query = query.where(CandidateClaim.status == status)
    rows = _read_claims(
        db,
        query.order_by(CandidateClaim.created_at, CandidateClaim.id)
        .offset(offset)
        .limit(limit + 1),
        admin=True,
    )
    return {
        "claims": rows[:limit],
        "offset": offset,
        "has_more": len(rows) > limit,
        "candidate": candidate_context(candidate) if candidate else None,
    }


def pending_count(db: Session) -> dict:
    return {
        "pending_count": db.scalar(
            select(func.count())
            .select_from(CandidateClaim)
            .where(CandidateClaim.status == "pending")
        )
        or 0
    }


def detail(db: Session, claim_id: uuid.UUID) -> dict:
    claim = db.get(CandidateClaim, claim_id, populate_existing=True)
    if claim is None:
        _fail(
            404,
            "This profile claim request is unavailable",
            "profile_claim_unavailable",
        )
    value = _serialize(db, claim, admin=True)
    value["has_published_statement"] = (
        db.scalar(
            select(CandidateStatement.candidate_id).where(
                CandidateStatement.claim_id == claim.id,
                CandidateStatement.body != "",
            )
        )
        is not None
    )
    actor = aliased(UserAccount)
    events = db.execute(
        select(CandidateClaimEvent, actor)
        .outerjoin(actor, actor.id == CandidateClaimEvent.actor_id)
        .where(CandidateClaimEvent.claim_id == claim.id)
        .order_by(CandidateClaimEvent.claim_version.desc())
    ).all()
    value["history"] = [
        {
            "id": str(event.id),
            "kind": event.kind,
            "claim_version": event.claim_version,
            "actor_id": str(event.actor_id) if event.actor_id else None,
            "actor_name": person.display_name if person else None,
            "evidence_url": event.evidence_url,
            "request_note": event.request_note,
            "review_note": event.review_note,
            "identity_verified": event.identity_verified,
            "statement_removed": event.statement_removed,
            "candidate": event.candidate_snapshot,
            "created_at": event.created_at.isoformat(),
        }
        for event, person in events
    ]
    value["history_complete"] = any(
        event.kind == "submitted" and event.claim_version == 1 for event, _ in events
    )
    return {"claim": value}


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
        _fail(
            409,
            "Your signed-in account changed. Reload before continuing",
            "account_changed",
        )
    claim = db.get(CandidateClaim, claim_id)
    if claim is None:
        _fail(
            404,
            "This profile claim request is unavailable",
            "profile_claim_unavailable",
        )
    if claim.user_id == user.id:
        _fail(
            403,
            "An administrator cannot review their own candidate profile claim",
            "self_review_forbidden",
        )
    accounts = _accounts(db, user.id, claim.user_id)
    administrator = accounts.get(user.id)
    if administrator is None:
        _fail(401, "Sign in to continue")
    # The router already resolves a fresh confirmed admin identity; an account
    # may have multiple identities without losing its authoritative admin role.
    if not administrator.is_active:
        _fail(403, "This account has been deactivated", "account_inactive")
    candidate = _candidate(db, claim.candidate_id)
    db.refresh(claim)
    _version(claim.version, expected_version)
    review_note = review_note.strip()
    if len(review_note) < 20:
        _fail(
            422,
            "Write a private review note with at least 20 characters",
            "review_note_too_short",
        )
    if len(review_note) > 2000:
        _fail(
            422,
            "Keep the private review note to 2000 characters or fewer",
            "review_note_too_long",
        )
    removed = False
    if action == "approve":
        if claim.status != "pending":
            _fail(
                409,
                "Only a pending profile claim request can be approved",
                "profile_claim_changed",
            )
        if not identity_verified:
            _fail(
                422,
                "Confirm that you independently verified the applicant’s identity and campaign authority before approving",
                "identity_verification_required",
            )
        claimant = accounts.get(claim.user_id)
        if claimant is None:
            _fail(409, "The requesting account no longer exists")
        if administrator_account_access(db, claimant.id):
            _fail(
                403,
                "Admin accounts cannot claim candidate profiles",
                "applicant_is_admin",
            )
        _confirmed(db, claimant)
        _current(candidate, fresh=True)
        approved = db.scalar(
            select(CandidateClaim.id).where(
                CandidateClaim.candidate_id == candidate.id,
                CandidateClaim.status == "approved",
            )
        )
        if approved:
            _fail(
                409,
                "This candidate profile already has an approved profile claim. Review the existing profile claim before approving another account.",
                "profile_already_claimed",
            )
        claim.status = "approved"
        db.execute(
            delete(CandidateStatement).where(
                CandidateStatement.candidate_id == candidate.id
            )
        )
    elif action == "reject":
        if claim.status != "pending":
            _fail(
                409,
                "Only a pending profile claim request can be rejected",
                "profile_claim_changed",
            )
        claim.status = "rejected"
    elif action == "revoke":
        if claim.status != "approved":
            _fail(
                409,
                "Only an approved profile claim can be revoked",
                "profile_claim_changed",
            )
        claim.status = "revoked"
        removed = _remove_owned_statement(db, claim)
    else:
        _fail(422, "Choose approve, reject, or revoke")
    claim.review_note = review_note
    claim.reviewed_by = user.id
    claim.reviewed_at = datetime.now(timezone.utc)
    claim.version += 1
    db.flush()
    record_event(
        db,
        claim,
        candidate,
        kind=claim.status,
        actor_id=user.id,
        identity_verified=action == "approve" and identity_verified,
        statement_removed=removed,
    )
    result = {**detail(db, claim.id), "account_id": str(user.id)}
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
    _writer(db, user, expected_account_id, owner=False)
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
