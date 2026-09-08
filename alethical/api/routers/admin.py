from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from supabase_auth.errors import AuthApiError, AuthInvalidJwtError

from alethical.api.auth import get_auth_service
from alethical.api.problems import problem_exception
from alethical.api.services.admin_access import ADMIN_EMAILS, configured_admin_subjects
from alethical.api.services.admin_accounts import (
    load_account_inventory,
    search_reader_accounts,
)
from alethical.db.session import get_db

router = APIRouter(prefix="/admin")


def administrator_access(
    authorization: str | None = Header(default=None),
    auth_service=Depends(get_auth_service),
    db: Session = Depends(get_db),
) -> bool:
    if not authorization or not authorization.startswith("Bearer "):
        raise problem_exception(401, "Unauthorized", "Sign in to continue.")
    if auth_service is None:
        raise problem_exception(
            503, "Service Unavailable", "Account access is temporarily unavailable."
        )
    token = authorization[7:]
    if not token.strip():
        raise problem_exception(401, "Unauthorized", "Sign in to continue.")
    try:
        principal = auth_service.authenticate(token)
    except (ValueError, AuthApiError, AuthInvalidJwtError) as exc:
        if isinstance(exc, AuthApiError) and int(exc.status) >= 500:
            raise problem_exception(
                503, "Service Unavailable", "Account access is temporarily unavailable."
            ) from None
        raise problem_exception(
            401, "Unauthorized", "Sign in again to continue."
        ) from None
    except Exception:
        raise problem_exception(
            503, "Service Unavailable", "Account access is temporarily unavailable."
        ) from None
    allowed_subjects = configured_admin_subjects()
    if (
        principal.provider != "supabase"
        or principal.provider_subject not in allowed_subjects
    ):
        return False
    # A signed subject AND a fresh confirmed exact email are both required.
    # No grants from browser metadata, editable profile fields, or mailbox aliases.
    try:
        confirmed = auth_service.resolve_confirmed_email(token, principal)
    except (ValueError, AuthApiError, AuthInvalidJwtError) as exc:
        if isinstance(exc, AuthApiError) and int(exc.status) >= 500:
            raise problem_exception(
                503, "Service Unavailable", "Account access is temporarily unavailable."
            ) from None
        raise problem_exception(
            401, "Unauthorized", "Sign in again to continue."
        ) from None
    except Exception:
        raise problem_exception(
            503, "Service Unavailable", "Account access is temporarily unavailable."
        ) from None
    if not (
        confirmed.provider == "supabase"
        and confirmed.provider_subject == principal.provider_subject
        and confirmed.email_verified
        and (confirmed.email or "").lower() in ADMIN_EMAILS
    ):
        return False
    try:
        active = db.scalar(
            text("""
            SELECT true FROM auth.users u
            WHERE u.id = CAST(:subject AS uuid)
              AND u.deleted_at IS NULL AND NOT u.is_anonymous
              AND u.email_confirmed_at IS NOT NULL
              AND lower(u.email) = :email
              AND (u.banned_until IS NULL OR u.banned_until <= CURRENT_TIMESTAMP)
              AND NOT EXISTS (
                SELECT 1 FROM public.auth_identity a
                JOIN public.user_account p ON p.id = a.user_id
                WHERE a.provider = 'supabase' AND a.provider_subject = u.id::text
                  AND NOT p.is_active
              )
            """),
            {"subject": principal.provider_subject, "email": confirmed.email.lower()},
        )
    except Exception:
        raise problem_exception(
            503, "Service Unavailable", "Account access is temporarily unavailable."
        ) from None
    return active is True


def require_admin(is_admin: bool = Depends(administrator_access)) -> None:
    if not is_admin:
        raise problem_exception(403, "Forbidden", "Administrator access is required.")


class AccountSearch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(default="", max_length=254)
    status: Literal["all", "confirmed", "pending"] = "all"
    created_within_days: Literal[7, 30] | None = None
    offset: int = Field(default=0, ge=0, le=1_000_000)
    limit: int = Field(default=25, ge=1, le=100)


@router.get("/access")
def admin_access(is_admin: bool = Depends(administrator_access)) -> dict:
    return {"data": {"is_admin": is_admin}}


@router.post("/users/search", dependencies=[Depends(require_admin)])
def admin_users(search: AccountSearch, db: Session = Depends(get_db)) -> dict:
    try:
        inventory = load_account_inventory(db)
    except Exception:
        raise problem_exception(
            503,
            "Service Unavailable",
            "Accounts are temporarily unavailable. Try again.",
        ) from None
    return {
        **search_reader_accounts(inventory.included, **search.model_dump()),
        "excluded_accounts": [
            {"id": account.id, "email": account.email} for account in inventory.excluded
        ],
    }
