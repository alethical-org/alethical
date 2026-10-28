"""Alethical Finance's signed-out sign-in steps: ask for an emailed code, prove it.

The only Finance routes without the access check, because their caller has not
signed in yet. They sit under ``/api/v1/finance/``, so their answers are private
and never cached, and neither answer shows whether an address is on the list.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, BackgroundTasks, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.rate_limit import rate_limit, trusted_client_ip
from alethical.api.services import finance_sign_in
from alethical.api.services.finance_sign_in import (
    CodeNotAccepted,
    SignInCodeUnavailable,
)
from alethical.db.session import get_db

router = APIRouter(
    prefix="/finance/sign-in",
    dependencies=[
        Depends(
            rate_limit("finance_sign_in_limiter", "finance-sign-in", trusted_client_ip)
        )
    ],
)

# Every refused code is answered after at least this long, so no difference in
# the work behind a refusal shows whether an address is listed.
REFUSAL_SECONDS = 0.5


class CodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(max_length=320)


class CodeProof(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(max_length=320)
    code: str = Field(max_length=32)


def _unavailable():
    return problem_exception(
        503,
        "Service Unavailable",
        "Sign-in by email code is not available right now.",
        type_slug="service-unavailable",
    )


@router.post("/code", status_code=status.HTTP_202_ACCEPTED)
def request_code(payload: CodeRequest, background: BackgroundTasks) -> dict:
    """202 for every address; a code is emailed only when the address is listed."""
    try:
        email = finance_sign_in.check_request(payload.email)
    except ValueError:
        raise problem_exception(
            422, "Unprocessable Entity", "Enter an email address."
        ) from None
    except SignInCodeUnavailable:
        raise _unavailable() from None
    background.add_task(finance_sign_in.deliver_code, email)
    return {"data": {"status": "accepted"}}


@router.post("/verify")
def verify_code(payload: CodeProof, db: Session = Depends(get_db)) -> dict:
    """A 1-time Supabase sign-in token for a proved code; 1 refusal for all else."""
    started = time.monotonic()
    try:
        token = finance_sign_in.prove_code(db, payload.email, payload.code)
    except CodeNotAccepted:
        time.sleep(max(0.0, REFUSAL_SECONDS - (time.monotonic() - started)))
        raise problem_exception(
            400,
            "Bad Request",
            "That code is not right or has expired. Ask for a new code.",
            type_slug="finance-code-not-accepted",
        ) from None
    except ValueError:
        raise problem_exception(
            422, "Unprocessable Entity", "Enter an email address."
        ) from None
    except (SignInCodeUnavailable, SQLAlchemyError):
        db.rollback()
        raise _unavailable() from None
    return {"data": token}
