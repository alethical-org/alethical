from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.services.auth import get_supabase_auth_service
from alethical.db.schema import load_schema
from alethical.db.session import get_db

schema = load_schema()
AuthIdentity = schema.AuthIdentity
UserAccount = schema.UserAccount


def get_auth_service():
    try:
        return get_supabase_auth_service()
    except RuntimeError:
        return None


def get_optional_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
    auth_service=Depends(get_auth_service),
):
    if not authorization:
        return None
    if not authorization.startswith("Bearer "):
        raise problem_exception(401, "Unauthorized", "Bearer token required")
    token = authorization.removeprefix("Bearer ").strip()
    if auth_service is None:
        raise problem_exception(
            503,
            "Service Unavailable",
            "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY are required unless ALETHICAL_DEV_AUTH_TOKEN is set for local development",
            type_slug="service-unavailable",
        )
    try:
        principal = auth_service.authenticate(token)
    except RuntimeError as exc:
        raise problem_exception(
            503, "Service Unavailable", str(exc), type_slug="service-unavailable"
        ) from exc
    except Exception as exc:
        raise problem_exception(401, "Unauthorized", str(exc)) from exc

    identity = db.scalar(
        select(AuthIdentity).where(
            AuthIdentity.provider == principal.provider,
            AuthIdentity.provider_subject == principal.provider_subject,
        )
    )
    if identity is not None:
        user = db.scalar(select(UserAccount).where(UserAccount.id == identity.user_id))
        if user is None:
            raise problem_exception(
                401, "Unauthorized", "Mapped user account not found"
            )
    else:
        user = None
        if principal.email:
            user = db.scalar(
                select(UserAccount).where(
                    UserAccount.primary_email == principal.email.lower()
                )
            )
        if user is None:
            display_name = principal.email.split("@", 1)[0] if principal.email else None
            user = UserAccount(
                display_name=display_name,
                primary_email=principal.email.lower() if principal.email else None,
            )
            db.add(user)
            db.flush()
        identity = AuthIdentity(
            user_id=user.id,
            provider=principal.provider,
            provider_subject=principal.provider_subject,
            email=principal.email.lower() if principal.email else None,
            email_verified_at=datetime.now(timezone.utc)
            if principal.email_verified
            else None,
        )
        db.add(identity)

    if principal.email:
        normalized_email = principal.email.lower()
        user.primary_email = user.primary_email or normalized_email
        identity.email = normalized_email
    if principal.email_verified and identity.email_verified_at is None:
        identity.email_verified_at = datetime.now(timezone.utc)
    identity.last_used_at = datetime.now(timezone.utc)
    user.last_signed_in_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user


def get_current_user(user=Depends(get_optional_current_user)):
    if user is None:
        raise problem_exception(401, "Unauthorized", "Authentication required")
    return user
