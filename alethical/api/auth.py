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


def _confirmed_email(principal) -> str | None:
    """The principal's address, normalized, but only if the provider confirmed it.

    ``user_account.primary_email`` is the key one identity joins another's
    account on, so an unconfirmed address must never reach that column -- not to
    match a row, and not to claim one for a later sign-in to match (#1039).
    Claiming is the same hole facing the other way: reserve an address you never
    proved you own, and the person who does own it joins *your* account when they
    arrive. An unconfirmed address is still recorded on ``auth_identity.email``,
    which is not unique and grants nothing.
    """
    if principal.email and principal.email_verified:
        return principal.email.lower()
    return None


def _reconcile_identity_fields(db: Session, user, identity, principal) -> bool:
    """Backfill email fields only when a value actually changes.

    Assigning an equal value would still mark the row dirty, so each branch
    guards on a real difference. Returns whether anything changed, so callers
    on the read path can skip committing when nothing did.
    """
    changed = False
    if principal.email:
        normalized_email = principal.email.lower()
        if identity.email != normalized_email:
            identity.email = normalized_email
            changed = True
    confirmed_email = _confirmed_email(principal)
    if confirmed_email and user.primary_email is None:
        # The column is unique, so claiming an address another account already
        # holds would raise on commit and turn an ordinary authenticated read
        # into a 500. Accounts are never merged here; the address simply stays
        # unclaimed on this one.
        already_held = db.scalar(
            select(UserAccount.id).where(
                UserAccount.primary_email == confirmed_email,
                UserAccount.id != user.id,
            )
        )
        if already_held is None:
            user.primary_email = confirmed_email
            changed = True
    if principal.email_verified and identity.email_verified_at is None:
        identity.email_verified_at = datetime.now(timezone.utc)
        changed = True
    return changed


def _refuse_if_deactivated(user) -> None:
    """Stop a deactivated account being used, on every path that resolves one.

    ``user_account.is_active`` existed from the first migration and nothing read
    it, so it was a switch that looked like a lock and was not one (#1043). It is
    honoured here rather than per-router so there is one place to read and no
    endpoint can be added that forgets.

    Deliberately a hard refusal even on the endpoints that take a token
    *optionally*, rather than quietly falling back to treating the request as
    signed-out. Silently anonymous means the caller can never tell "signed out"
    from "locked out" -- the same class of silent failure this column already
    was. It costs a locked-out reader nothing real: every optional-auth endpoint
    is public, so the same pages are there without a token at all.
    """
    if not user.is_active:
        raise problem_exception(
            403,
            "Forbidden",
            "This account has been deactivated.",
            type_slug="account-deactivated",
        )


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
        # Resolution path (the common case, including every read request):
        # look the user up read-only and commit only if a field genuinely
        # changed, so authenticated GETs are side-effect-free (#108).
        user = db.scalar(select(UserAccount).where(UserAccount.id == identity.user_id))
        if user is None:
            raise problem_exception(
                401, "Unauthorized", "Mapped user account not found"
            )
        # Before the reconcile, so a deactivated account cannot write either.
        _refuse_if_deactivated(user)
        if _reconcile_identity_fields(db, user, identity, principal):
            db.commit()
        return user

    # Provisioning path (first sign-in for this identity): create the user
    # and/or identity and commit once. last_used_at / last_signed_in_at are set
    # here rather than per request -- nothing reads them, and per-request bumps
    # were the read-path write this dependency used to do on every call.
    #
    # The join is on the *confirmed* address only. An unconfirmed one falls
    # through to a brand-new account with no primary_email, which is recoverable
    # (the accounts can be merged later) where a refusal would leave a real
    # person stuck behind provider state they cannot see or fix (#1039).
    confirmed_email = _confirmed_email(principal)
    user = None
    if confirmed_email:
        user = db.scalar(
            select(UserAccount).where(UserAccount.primary_email == confirmed_email)
        )
    if user is not None:
        # A second sign-in method must not become a way back into a locked
        # account. Checked before the identity row is written, so a refused
        # sign-in leaves nothing behind.
        _refuse_if_deactivated(user)
    else:
        display_name = principal.email.split("@", 1)[0] if principal.email else None
        user = UserAccount(
            display_name=display_name,
            primary_email=confirmed_email,
        )
        db.add(user)
        db.flush()
    now = datetime.now(timezone.utc)
    identity = AuthIdentity(
        user_id=user.id,
        provider=principal.provider,
        provider_subject=principal.provider_subject,
        email=principal.email.lower() if principal.email else None,
        email_verified_at=now if principal.email_verified else None,
        last_used_at=now,
    )
    db.add(identity)
    _reconcile_identity_fields(db, user, identity, principal)
    user.last_signed_in_at = now
    db.commit()
    db.refresh(user)
    return user


def get_current_user(user=Depends(get_optional_current_user)):
    if user is None:
        raise problem_exception(401, "Unauthorized", "Authentication required")
    return user
