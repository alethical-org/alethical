"""Create and atomically complete one-time product actions after sign-in."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
import uuid

from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from alethical.db.schema import load_schema


schema = load_schema()
Bill = schema.Bill
PendingAction = schema.PendingAction
TrackedBill = schema.TrackedBill

TRACK_BILL = "track_bill"
PENDING_ACTION_LIFETIME = timedelta(hours=24)
PENDING_ACTION_MAX_ACTIVE = 10_000
PENDING_ACTION_CREATE_LOCK = 1_487_036


class BillNotFoundError(Exception):
    pass


class PendingActionUnavailableError(Exception):
    pass


class PendingActionCapacityError(Exception):
    pass


@dataclass(frozen=True)
class CreatedPendingAction:
    reference: str
    expires_at: datetime


@dataclass(frozen=True)
class CompletedPendingAction:
    action: str
    bill_id: str
    return_path: str


def reference_digest(reference: str) -> str:
    return hashlib.sha256(reference.encode("utf-8")).hexdigest()


def create_pending_track(
    db: Session, *, bill_key: str, return_path: str
) -> CreatedPendingAction:
    bill = db.scalar(select(Bill).where(Bill.bill_key == bill_key))
    if bill is None:
        raise BillNotFoundError

    now = datetime.now(timezone.utc)
    # The per-address request limit handles ordinary abuse. This database lock
    # and hard cap are the non-bypassable backstop: even if an attacker can use
    # many addresses, pending rows can never grow without bound.
    db.execute(
        text("SELECT pg_advisory_xact_lock(:lock_key)"),
        {"lock_key": PENDING_ACTION_CREATE_LOCK},
    )
    # A creation request is a cheap place to remove dead, ownerless rows. This
    # keeps abandoned sign-in attempts from growing the table forever without a
    # separate scheduled cleanup job.
    db.execute(delete(PendingAction).where(PendingAction.expires_at <= now))
    active_count = db.scalar(select(func.count()).select_from(PendingAction)) or 0
    if active_count >= PENDING_ACTION_MAX_ACTIVE:
        db.rollback()
        raise PendingActionCapacityError

    reference = secrets.token_urlsafe(32)
    expires_at = now + PENDING_ACTION_LIFETIME
    db.add(
        PendingAction(
            reference_digest=reference_digest(reference),
            action_kind=TRACK_BILL,
            bill_id=bill.id,
            return_path=return_path,
            expires_at=expires_at,
        )
    )
    db.commit()
    return CreatedPendingAction(reference=reference, expires_at=expires_at)


def _insert_tracked_bill(db: Session, *, user_id: uuid.UUID, bill_id: uuid.UUID):
    """Save the bill once even if it was already tracked before sign-in."""
    statement = (
        insert(TrackedBill)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            bill_id=bill_id,
            alerts_enabled=True,
        )
        .on_conflict_do_nothing(index_elements=["user_id", "bill_id"])
    )
    db.execute(statement)


def complete_pending_action(
    db: Session, *, user_id: uuid.UUID, reference: str, requested_action: str
) -> CompletedPendingAction:
    digest = reference_digest(reference)
    pending = db.scalar(
        select(PendingAction)
        .where(PendingAction.reference_digest == digest)
        .with_for_update()
    )
    if pending is None:
        raise PendingActionUnavailableError

    now = datetime.now(timezone.utc)
    if pending.expires_at <= now:
        db.delete(pending)
        db.commit()
        raise PendingActionUnavailableError
    if pending.action_kind != requested_action:
        raise PendingActionUnavailableError

    result = CompletedPendingAction(
        action=pending.action_kind,
        bill_id=pending.bill.bill_key,
        return_path=pending.return_path,
    )
    _insert_tracked_bill(db, user_id=user_id, bill_id=pending.bill_id)
    db.delete(pending)
    db.commit()
    return result
