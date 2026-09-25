"""Explicit consent with serialized writes and retries that cannot undo a stop."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.db.models import (
    AuthIdentity,
    EmailPreferenceMutation,
    EmailSubscription,
    EmailSubscriptionIntent,
    EmailUnsubscribeToken,
    UserAccount,
)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def locked_account(db: Session, user_id: uuid.UUID):
    # The account exists even before its first preference row. Locking it avoids
    # both a first-insert race and a save overtaking an email-link unsubscribe.
    return db.scalar(
        select(UserAccount)
        .where(UserAccount.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def subscription(db: Session, user_id: uuid.UUID) -> EmailSubscription:
    row = db.get(EmailSubscription, user_id, populate_existing=True)
    if row is None:
        row = EmailSubscription(user_id=user_id, version=0)
        db.add(row)
        db.flush()
    return row


def preferences(db: Session, user) -> dict:
    row = db.get(EmailSubscription, user.id, populate_existing=True)
    return {
        "account_id": str(user.id),
        "email": user.primary_email,
        "research": row.research if row else None,
        "features": row.features if row else None,
        "version": row.version if row else 0,
    }


def save_preferences(db: Session, user_id: uuid.UUID, payload: dict) -> dict:
    user = locked_account(db, user_id)
    if user is None or not user.is_active:
        raise HTTPException(401, "Sign in to save email preferences")
    if (
        str(user.id) != str(payload["expected_account_id"])
        or user.primary_email != payload["expected_email"]
    ):
        raise problem_exception(
            409,
            "Account changed",
            "Your account or email changed. Reload your email preferences before saving",
            type_slug="email-preferences-account-changed",
        )
    # Stopping emails remains possible even if an old account has no currently
    # verified address. New positive consent uses the sender's eligibility bar.
    if any(payload.get(purpose) is True for purpose in ("research", "features")):
        verified = (
            db.scalar(
                select(AuthIdentity.id).where(
                    AuthIdentity.user_id == user_id,
                    AuthIdentity.email == user.primary_email,
                    AuthIdentity.email_verified_at.is_not(None),
                )
            )
            if user.primary_email
            else None
        )
        if verified is None:
            raise problem_exception(
                422,
                "Confirmed email required",
                "A confirmed account email is required to subscribe",
                type_slug="email-preferences-email-unconfirmed",
            )
    key = uuid.UUID(str(payload["idempotency_key"]))
    hashed = digest(json.dumps(payload, sort_keys=True, default=str))
    prior = db.get(EmailPreferenceMutation, (user_id, key))
    if prior:
        if not hmac.compare_digest(prior.payload_hash, hashed):
            raise problem_exception(
                409,
                "Request key reused",
                "This request key was already used for different choices",
                type_slug="email-preferences-request-key-reused",
            )
        # Return current truth, not an earlier success which a stop superseded.
        result = preferences(db, user)
        db.commit()
        return result
    row = subscription(db, user_id)
    if row.version != payload["expected_version"]:
        db.rollback()
        raise problem_exception(
            409,
            "Preferences changed",
            "Your email preferences changed. Reload them before saving",
            type_slug="email-preferences-stale",
        )
    now = datetime.now(timezone.utc)
    for purpose in ("research", "features"):
        if purpose in payload:
            setattr(row, purpose, payload[purpose])
            setattr(row, f"{purpose}_changed_at", now)
            setattr(row, f"{purpose}_source", payload["source"])
    row.version += 1
    db.add(
        EmailPreferenceMutation(user_id=user_id, request_key=key, payload_hash=hashed)
    )
    db.flush()
    result = preferences(db, user)
    db.commit()
    return result


def create_intent(db: Session, browser_key: str) -> str:
    now = datetime.now(timezone.utc)
    db.execute(text("SELECT pg_advisory_xact_lock(1487040)"))
    db.execute(
        delete(EmailSubscriptionIntent).where(EmailSubscriptionIntent.expires_at <= now)
    )
    if (
        db.scalar(select(func.count()).select_from(EmailSubscriptionIntent)) or 0
    ) >= 10_000:
        db.rollback()
        raise HTTPException(503, "Please try again in a little while")
    reference = secrets.token_urlsafe(32)
    db.add(
        EmailSubscriptionIntent(
            reference_digest=digest(reference),
            browser_digest=digest(browser_key),
            expires_at=now + timedelta(minutes=30),
        )
    )
    db.commit()
    return reference


def complete_intent(
    db: Session, user_id: uuid.UUID, reference: str, browser_key: str
) -> None:
    row = db.scalar(
        select(EmailSubscriptionIntent)
        .where(EmailSubscriptionIntent.reference_digest == digest(reference))
        .with_for_update()
    )
    if (
        row is None
        or row.expires_at <= datetime.now(timezone.utc)
        or not hmac.compare_digest(row.browser_digest, digest(browser_key))
        or (row.completed_by is not None and row.completed_by != user_id)
    ):
        raise HTTPException(
            410, "This signup invitation expired. Open it again from Money in politics"
        )
    # Repeating completion for the same account is safe, even after a lost reply.
    # This is only permission to display the confirmation, never consent to email.
    row.completed_by = user_id
    db.commit()


def issue_unsubscribe_token(db: Session, user_id: uuid.UUID) -> str:
    token = secrets.token_urlsafe(32)
    db.add(EmailUnsubscribeToken(token_digest=digest(token), user_id=user_id))
    db.flush()
    return token


def valid_token(db: Session, token: str) -> EmailUnsubscribeToken:
    row = db.get(EmailUnsubscribeToken, digest(token), populate_existing=True)
    if row is None or row.revoked_at is not None:
        raise HTTPException(404, "We couldn’t open your unsubscribe request")
    return row


def unsubscribe(db: Session, token: str, action: str) -> None:
    token_row = valid_token(db, token)
    user = locked_account(db, token_row.user_id)
    if user is None:
        raise HTTPException(404, "We couldn’t open your unsubscribe request")
    # Recheck after acquiring the account lock, so a revoked link cannot race in.
    valid_token(db, token)
    row = subscription(db, user.id)
    now = datetime.now(timezone.utc)
    for purpose in ("research", "features") if action == "all" else ("research",):
        setattr(row, purpose, False)
        setattr(row, f"{purpose}_changed_at", now)
        setattr(row, f"{purpose}_source", "email_link")
    # Even a repeat stop fences off writes prepared before that stop.
    row.version += 1
    db.commit()
