"""Hold one signed-out Track press until a person finishes signing in."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from alethical.api.auth import get_current_user
from alethical.api.problems import problem_exception
from alethical.api.rate_limit import rate_limit, trusted_client_ip
from alethical.api.schemas import (
    DetailResponse,
    PendingActionCompleteRequest,
    PendingActionCreateRequest,
)
from alethical.api.services.pending_actions import (
    BillNotFoundError,
    PendingActionCapacityError,
    PendingActionUnavailableError,
    complete_pending_action,
    create_pending_track,
)
from alethical.db.session import get_db


router = APIRouter()


def _prevent_secret_caching(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"


@router.post(
    "/pending-actions",
    response_model=DetailResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[
        Depends(
            rate_limit(
                "pending_action_limiter",
                "pending-action-create",
                trusted_client_ip,
            )
        )
    ],
)
def create_pending_action(
    request: PendingActionCreateRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    try:
        pending = create_pending_track(
            db, bill_key=request.bill_id, return_path=request.return_path
        )
    except BillNotFoundError as exc:
        raise problem_exception(404, "Not Found", "Bill not found") from exc
    except PendingActionCapacityError as exc:
        raise problem_exception(
            503,
            "Service Unavailable",
            "We couldn't save that action. Try again in a little while.",
            type_slug="pending-action-capacity",
        ) from exc
    _prevent_secret_caching(response)
    return DetailResponse(
        data={
            "reference": pending.reference,
            "expires_at": pending.expires_at.isoformat(),
        }
    )


@router.post("/me/pending-actions/complete", response_model=DetailResponse)
def complete_pending_product_action(
    request: PendingActionCompleteRequest,
    response: Response,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    try:
        completed = complete_pending_action(
            db,
            user_id=current_user.id,
            reference=request.reference,
            requested_action=request.action,
        )
    except PendingActionUnavailableError as exc:
        raise problem_exception(
            410,
            "Gone",
            "This pending action is expired or has already been used.",
            type_slug="pending-action-unavailable",
        ) from exc
    _prevent_secret_caching(response)
    return DetailResponse(
        data={
            "action": completed.action,
            "bill_id": completed.bill_id,
            "return_path": completed.return_path,
        }
    )
