"""Authenticated claim requests and administrator verification, never automatic claims."""

from __future__ import annotations

import time
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from alethical.api.auth import get_current_user, get_auth_service
from alethical.api.routers.admin import require_admin, administrator_access
from alethical.api.services import candidate_claims as service
from alethical.db.session import get_db

router = APIRouter()
Status = Literal["pending", "approved", "rejected", "withdrawn", "revoked", "all"]


def claim_database(db: Session = Depends(get_db)):
    """Prevent database diagnostics from exposing private application evidence."""
    try:
        yield db
    except SQLAlchemyError:
        try:
            db.rollback()
        except SQLAlchemyError:
            pass
        # SQL errors can embed values from notes and reports, even when query
        # parameter logging is disabled. Never hand that exception to the server.
        raise HTTPException(
            503, "Candidate records are temporarily unavailable. Please try again."
        ) from None


class Write(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_account_id: UUID
    expected_version: int = Field(ge=0)


class Apply(Write):
    candidate_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    evidence_url: str = Field(min_length=1, max_length=2000)
    request_note: str = Field(min_length=20, max_length=2000)


class Statement(Write):
    body: str = Field(max_length=2000)


class Review(Write):
    action: Literal["approve", "reject", "revoke"]
    review_note: str = Field(min_length=20, max_length=2000)
    identity_verified: StrictBool = False


def writer(request: Request, user=Depends(get_current_user)):
    limiter = request.app.state.comment_limiter
    key = f"candidate-claim:{user.id}"
    now = time.monotonic()
    if not limiter.allow(key, now):
        raise HTTPException(
            429,
            "Please wait before trying again",
            headers={
                "Retry-After": str(limiter.retry_after_seconds(key, now) or 1),
            },
        )
    return user


@router.get("/candidate-claims/me")
def mine(
    candidate_id: str | None = Query(default=None, pattern=r"^[a-f0-9]{64}$"),
    user=Depends(get_current_user),
    db: Session = Depends(claim_database),
):
    return service.mine(db, user, candidate_id)


@router.post("/candidate-claims")
def apply(payload: Apply, user=Depends(writer), db: Session = Depends(claim_database)):
    return service.apply(db, user, **payload.model_dump())


@router.post("/candidate-claims/{claim_id}/withdraw")
def withdraw(
    claim_id: UUID,
    payload: Write,
    user=Depends(writer),
    db: Session = Depends(claim_database),
):
    return service.withdraw(db, user, claim_id=claim_id, **payload.model_dump())


@router.get("/candidate-statements/{candidate_id}")
def statement(
    candidate_id: str, response: Response, db: Session = Depends(claim_database)
):
    # Ownership changes must be reflected on the very next read.
    response.headers["Cache-Control"] = "no-store"
    return service.public_statement(db, candidate_id)


@router.put("/candidate-claims/{claim_id}/statement")
def update_statement(
    claim_id: UUID,
    payload: Statement,
    user=Depends(writer),
    db: Session = Depends(claim_database),
):
    return service.write_statement(db, user, claim_id=claim_id, **payload.model_dump())


@router.get("/admin/candidate-claims", dependencies=[Depends(require_admin)])
def queue(
    status: Status = "pending",
    offset: int = Query(default=0, ge=0, le=1000000),
    limit: int = Query(default=25, ge=1, le=100),
    user=Depends(get_current_user),
    db: Session = Depends(claim_database),
):
    return {
        **service.queue(db, status=status, offset=offset, limit=limit),
        "account_id": str(user.id),
    }


@router.post(
    "/admin/candidate-claims/{claim_id}/review", dependencies=[Depends(require_admin)]
)
def review(
    claim_id: UUID,
    payload: Review,
    user=Depends(writer),
    db: Session = Depends(claim_database),
):
    return service.review(db, user, claim_id=claim_id, **payload.model_dump())


@router.delete("/candidate-claims/{claim_id}/statement")
def remove_statement(
    claim_id: UUID,
    payload: Write,
    user=Depends(writer),
    db: Session = Depends(claim_database),
):
    return service.write_statement(
        db, user, claim_id=claim_id, body="", **payload.model_dump()
    )


@router.get("/candidate-claims/{claim_id}/statement")
def private_statement(
    claim_id: UUID,
    request: Request,
    user=Depends(get_current_user),
    db: Session = Depends(claim_database),
    auth_service=Depends(get_auth_service),
):
    # Owners need no administrator lookup. Other readers pass the same fresh
    # administrator check as the review queue, never a browser role hint.
    claim = db.get(service.CandidateClaim, claim_id)
    admin = False
    if claim is not None and claim.user_id != user.id:
        admin = administrator_access(
            request.headers.get("authorization"), auth_service, db
        )
    return service.private_statement(db, user, claim_id, admin=admin)


class Report(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1, max_length=2000)
    expected_version: int = Field(ge=1)


class Resolve(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_account_id: UUID


@router.post("/candidate-statements/{candidate_id}/reports")
def report_statement(
    candidate_id: str,
    payload: Report,
    request: Request,
    db: Session = Depends(claim_database),
):
    from alethical.api.rate_limit import trusted_client_ip

    limiter = request.app.state.comment_limiter
    key = f"candidate-report:{trusted_client_ip(request)}"
    now = time.monotonic()
    if not limiter.allow(key, now):
        raise HTTPException(
            429,
            "Please wait before reporting again",
            headers={
                "Retry-After": str(limiter.retry_after_seconds(key, now) or 1),
            },
        )
    return service.report_statement(
        db, candidate_id, payload.reason, expected_version=payload.expected_version
    )


@router.get("/admin/candidate-statement-reports", dependencies=[Depends(require_admin)])
def reports(
    offset: int = Query(default=0, ge=0, le=1000000),
    limit: int = Query(default=25, ge=1, le=100),
    user=Depends(get_current_user),
    db: Session = Depends(claim_database),
):
    return {
        **service.reports(db, offset=offset, limit=limit),
        "account_id": str(user.id),
    }


@router.post(
    "/admin/candidate-statement-reports/{report_id}/resolve",
    dependencies=[Depends(require_admin)],
)
def resolve_report(
    report_id: UUID,
    payload: Resolve,
    user=Depends(writer),
    db: Session = Depends(claim_database),
):
    return service.resolve_report(db, user, report_id, payload.expected_account_id)
