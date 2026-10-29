"""Alethical Finance's signed-out sign-in steps: ask for an emailed code, prove it.

The only Finance routes without the access check, because their caller has not
signed in yet. They sit under ``/api/v1/finance/``, so their answers are private
and never cached, and neither answer shows whether an address is on the list.
Both routes are async: neither holds a worker thread while it waits.
"""

from __future__ import annotations

import asyncio
import time

import anyio
from fastapi import APIRouter, BackgroundTasks, Depends, status
from fastapi.concurrency import run_in_threadpool
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

# Every answer to a proof except a sign-in token or "busy" is sent after at
# least this long, so no difference in the work behind it shows whether an
# address is listed or has a code waiting.
REFUSAL_SECONDS = 0.5
# Proofs checked at once in this API process, each holding its place through its
# minimum wait. A proof that finds every place taken is answered 429 at once:
# busy says nothing about the address.
MAX_PROOFS_AT_ONCE = 3
_proofs = asyncio.Semaphore(MAX_PROOFS_AT_ONCE)


class CodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(max_length=320)


class CodeProof(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(max_length=320)
    code: str = Field(max_length=32)
    # Missing is refused like a wrong challenge, never as a malformed request.
    challenge: str = Field(default="", max_length=128)


def _unavailable():
    return problem_exception(
        503,
        "Service Unavailable",
        "Sign-in by email code is not available right now.",
        type_slug="service-unavailable",
    )


def _not_an_address():
    return problem_exception(422, "Unprocessable Entity", "Enter an email address.")


@router.post("/code", status_code=status.HTTP_202_ACCEPTED)
async def request_code(payload: CodeRequest, background: BackgroundTasks) -> dict:
    """202 and a new challenge for every address; a code is emailed only to a listed one."""
    try:
        email = finance_sign_in.check_request(payload.email)
    except ValueError:
        raise _not_an_address() from None
    except SignInCodeUnavailable:
        raise _unavailable() from None
    challenge = finance_sign_in.new_challenge()
    # Only the hand-off waits for the answer to go, and it takes no time; the
    # list check, the caps and the email run on Finance's own sending threads.
    background.add_task(finance_sign_in.schedule_delivery, email, challenge)
    return {"data": {"status": "accepted", "challenge": challenge}}


def _prove(db: Session, payload: CodeProof) -> dict:
    """The proof itself, on a worker thread; a failed transaction is undone here."""
    try:
        return finance_sign_in.prove_code(
            db, payload.email, payload.code, payload.challenge
        )
    except (SignInCodeUnavailable, SQLAlchemyError):
        try:
            db.rollback()
        except SQLAlchemyError:
            pass
        raise SignInCodeUnavailable from None


@router.post("/verify")
async def verify_code(payload: CodeProof, db: Session = Depends(get_db)) -> dict:
    """A 1-time Supabase sign-in token for a proved code; 1 refusal for all else."""
    if _proofs.locked():
        raise problem_exception(
            429,
            "Too Many Requests",
            "Too many sign-in codes are being checked. Try again in a moment.",
            type_slug="rate-limited",
            headers={"Retry-After": "1"},
        )
    # No await between checking and taking a place, so none is waited for.
    async with _proofs:
        started = time.monotonic()
        try:
            token = await run_in_threadpool(_prove, db, payload)
        except CodeNotAccepted:
            failure = problem_exception(
                400,
                "Bad Request",
                "That code is not right or has expired. Ask for a new code.",
                type_slug="finance-code-not-accepted",
            )
        except ValueError:
            failure = _not_an_address()
        except SignInCodeUnavailable:
            failure = _unavailable()
        else:
            return {"data": token}
        # The wait holds no worker thread and no database connection.
        await anyio.sleep(max(0.0, REFUSAL_SECONDS - (time.monotonic() - started)))
    raise failure
