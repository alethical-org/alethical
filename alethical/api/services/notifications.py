"""Recording of tracked-bill notification events.

First slice of tracked-bill notifications (#36): when a tracked bill's status
changes, record a :class:`~alethical.db.models.NotificationEvent` for each user
tracking it who wants email alerts. Delivery — a digest job that emails the
unsent events and stamps ``sent_at`` — is a later slice and stays behind config,
so recording an event here sends nothing.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db import models

# Known NotificationEvent.event_type values (the column is a plain string; see
# the model docstring for why it is not a PG enum).
EVENT_BILL_STATUS_CHANGE = "bill_status_change"


def record_bill_status_change(
    db: Session,
    *,
    bill_id: uuid.UUID,
    old_status_code: str | None,
    new_status_code: str | None,
    old_status: str | None = None,
    new_status: str | None = None,
) -> list[models.NotificationEvent]:
    """Queue a status-change notification for every user tracking ``bill_id`` who
    wants email alerts.

    A user qualifies when they track the bill with ``alerts_enabled`` and have an
    enabled ``email`` notification preference whose frequency is not ``disabled``.
    Returns the created (flushed, uncommitted) events; the caller owns the
    transaction. No-op returning ``[]`` when the status code is unchanged.
    """
    if old_status_code == new_status_code:
        return []

    user_ids = db.scalars(
        select(models.TrackedBill.user_id)
        .join(
            models.NotificationPreference,
            models.NotificationPreference.user_id == models.TrackedBill.user_id,
        )
        .where(
            models.TrackedBill.bill_id == bill_id,
            models.TrackedBill.alerts_enabled.is_(True),
            models.NotificationPreference.channel == models.NotificationChannel.email,
            models.NotificationPreference.is_enabled.is_(True),
            models.NotificationPreference.frequency
            != models.NotificationFrequency.disabled,
        )
    ).all()

    events = [
        models.NotificationEvent(
            user_id=user_id,
            bill_id=bill_id,
            event_type=EVENT_BILL_STATUS_CHANGE,
            old_status_code=old_status_code,
            new_status_code=new_status_code,
            old_status=old_status,
            new_status=new_status,
        )
        for user_id in user_ids
    ]
    db.add_all(events)
    db.flush()
    return events
