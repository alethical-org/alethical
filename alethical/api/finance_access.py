"""The 1 access check every Alethical Finance endpoint depends on.

Finance has 1 access level: an account is in when its current confirmed address
is an active entry on the access list, and out otherwise
(docs/architecture/alethical-finance-architecture.md §3). The list is read on
every request, so a revocation applies to the next one.
"""

from __future__ import annotations

import os

import httpx
from fastapi import Depends, Header, Request
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from supabase_auth.errors import AuthApiError, AuthRetryableError

from alethical.api.auth import get_auth_service
from alethical.api.problems import problem_exception
from alethical.api.services.finance_access import (
    FinanceAccount,
    confirmed_address_access,
    supabase_account_access,
)
from alethical.db.session import get_db

NO_ACCESS_DETAIL = "This account does not have access to Alethical Finance."


def _unavailable(request: Request):
    request.state.failure_area = "auth"
    return problem_exception(
        503,
        "Service Unavailable",
        "Account access is temporarily unavailable.",
        type_slug="service-unavailable",
    )


def _signed_out(detail: str = "Sign in to continue."):
    return problem_exception(401, "Unauthorized", detail)


def no_access():
    # 1 answer for every refused account: unlisted, revoked, unconfirmed,
    # banned, deleted or locked. The reason is never named to the caller.
    return problem_exception(
        403, "Forbidden", NO_ACCESS_DETAIL, type_slug="finance-no-access"
    )


def require_finance_access(
    request: Request,
    authorization: str | None = Header(default=None),
    auth_service=Depends(get_auth_service),
    db: Session = Depends(get_db),
) -> FinanceAccount:
    if not authorization or not authorization.startswith("Bearer "):
        raise _signed_out()
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise _signed_out()
    if auth_service is None:
        raise _unavailable(request)
    try:
        principal = auth_service.authenticate(token)
    except (RuntimeError, AuthRetryableError, httpx.HTTPError):
        raise _unavailable(request) from None
    except AuthApiError as exc:
        if int(exc.status) >= 500:
            raise _unavailable(request) from None
        raise _signed_out("Sign in again to continue.") from None
    except Exception:
        # Anything else is a token the provider could not read, including a
        # forged one missing claims: the caller signs in again, as on /me.
        raise _signed_out("Sign in again to continue.") from None

    try:
        if principal.provider == "supabase":
            account = supabase_account_access(db, principal.provider_subject)
        elif (
            principal.email_verified
            and principal.email
            and os.environ.get("ALETHICAL_DATABASE_TARGET", "").strip() != "production"
        ):
            account = confirmed_address_access(
                db, principal.provider_subject, principal.email
            )
        else:
            account = None
    except SQLAlchemyError:
        db.rollback()
        raise _unavailable(request) from None
    if account is None:
        raise no_access()
    return account
