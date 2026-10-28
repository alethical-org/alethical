"""Alethical Finance's signed-out sign-in step: ask for an emailed code.

The only Finance route without the access check, because its caller has not
signed in yet. It sits under ``/api/v1/finance/``, so its answers are private
and never cached, and it answers every address the same way.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.rate_limit import rate_limit, trusted_client_ip
from alethical.api.services.finance_sign_in import (
    SignInCodeUnavailable,
    code_request_for,
    send_code,
)
from alethical.db.session import get_db

router = APIRouter(prefix="/finance/sign-in")


class CodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(max_length=320)


@router.post(
    "/code",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[
        Depends(
            rate_limit("finance_sign_in_limiter", "finance-sign-in", trusted_client_ip)
        )
    ],
)
def request_code(
    payload: CodeRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict:
    """202 for every address; a code is sent only when the address is listed."""
    try:
        pending = code_request_for(db, payload.email)
    except ValueError:
        raise problem_exception(
            422, "Unprocessable Entity", "Enter an email address."
        ) from None
    except SignInCodeUnavailable:
        raise problem_exception(
            503,
            "Service Unavailable",
            "Sign-in by email code is not available right now.",
            type_slug="service-unavailable",
        ) from None
    except SQLAlchemyError:
        db.rollback()
        raise problem_exception(
            503,
            "Service Unavailable",
            "Sign-in by email code is not available right now.",
            type_slug="service-unavailable",
        ) from None
    if pending is not None:
        background.add_task(send_code, pending)
    return {"data": {"status": "accepted"}}
