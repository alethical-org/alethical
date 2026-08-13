from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, Header, Request
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


def _resolve_confirmed_email(auth_service, token: str, principal):
    """Ask the provider only while Alethical still lacks trusted confirmation."""
    if principal.email_verified:
        return principal
    resolver = getattr(auth_service, "resolve_confirmed_email", None)
    if resolver is None:
        return principal
    try:
        return resolver(token, principal)
    except RuntimeError as exc:
        raise problem_exception(
            503,
            "Service Unavailable",
            str(exc),
            type_slug="service-unavailable",
        ) from exc
    except Exception as exc:
        raise problem_exception(401, "Unauthorized", str(exc)) from exc


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


def _mark_deactivated(request: Request) -> None:
    """Record that this request's token belongs to a locked account, and go on.

    ``user_account.is_active`` existed from the first migration and nothing read
    it, so it was a switch that looked like a lock and was not one (#1043). It is
    read here rather than per-router, so there is one place to change and no
    endpoint can be added that forgets.

    **A locked account resolves to anonymous, it does not error.** Three of the
    call sites take a token only to personalise an otherwise public page
    (``alethical/api/routers/public.py`` bill list and bill detail,
    ``alethical/api/routers/ask.py``). Erroring there would lock someone out of
    the *public legislative record* because their account is locked, and public
    legibility of that record is what this product is for (``docs/philosophy.md``).
    "They can sign out and read it" is a workaround for a break we chose to
    create.

    Resolving to anonymous also gets the no-write property for free: the caller
    returns before ``_reconcile_identity_fields`` runs, so a locked account
    cannot leave a row behind.

    The flag is what stops this collapsing back into the silent failure #1043
    exists to remove. Without it, "no token" and "token for a locked account"
    both arrive as ``None`` and nothing can tell a signed-out reader from a
    locked-out one. ``get_current_user`` reads it and refuses loudly, so every
    genuinely authenticated endpoint -- including ``GET /me``, which is how the
    frontend learns to clear the session and say what happened -- still says
    *deactivated* rather than *signed out*.
    """
    request.state.account_deactivated = True


def get_optional_current_user(
    request: Request,
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
        # Before the reconcile, so a locked account cannot write on its way out.
        if not user.is_active:
            _mark_deactivated(request)
            return None
        if identity.email_verified_at is None:
            principal = _resolve_confirmed_email(auth_service, token, principal)
        if _reconcile_identity_fields(db, user, identity, principal):
            db.commit()
        return user

    # Provisioning path (first sign-in for this identity): create the user
    # and/or identity and commit once. The two link timestamps describe this
    # event and are never login or request activity markers (#1045).
    #
    # The join is on the *confirmed* address only. An unconfirmed one falls
    # through to a brand-new account with no primary_email, which is recoverable
    # (the accounts can be merged later) where a refusal would leave a real
    # person stuck behind provider state they cannot see or fix (#1039).
    principal = _resolve_confirmed_email(auth_service, token, principal)
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
        if not user.is_active:
            _mark_deactivated(request)
            return None
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
        linked_at=now,
    )
    db.add(identity)
    _reconcile_identity_fields(db, user, identity, principal)
    user.last_identity_linked_at = now
    db.commit()
    db.refresh(user)
    return user


def get_current_user(request: Request, user=Depends(get_optional_current_user)):
    if user is None:
        # A locked account also arrives as None, and the two must not read the
        # same. Signed-out is a 401 the caller fixes by signing in; locked is a
        # 403 that signing in again will never fix, and the frontend needs to
        # tell the reader which one happened (#1043).
        if getattr(request.state, "account_deactivated", False):
            raise problem_exception(
                403,
                "Forbidden",
                "This account has been deactivated.",
                type_slug="account-deactivated",
            )
        raise problem_exception(401, "Unauthorized", "Authentication required")
    return user
