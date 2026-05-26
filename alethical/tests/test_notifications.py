from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select

from alethical.api.services.notifications import (
    create_tracked_bill_update_events,
    send_due_email_notifications,
)
from alethical.db.schema import load_schema
from alethical.db.session import get_session_factory

schema = load_schema()
NotificationEvent = schema.NotificationEvent
NotificationEventStatus = schema.NotificationEventStatus


def test_create_and_send_tracked_bill_update_notification(seed_database, monkeypatch):
    db_session = get_session_factory()()
    try:
        _run_notification_assertions(db_session, monkeypatch)
    finally:
        db_session.close()


def _run_notification_assertions(db_session, monkeypatch):
    db_session.execute(delete(NotificationEvent))
    db_session.commit()

    now = datetime(2026, 3, 21, tzinfo=timezone.utc)
    created = create_tracked_bill_update_events(db_session, now=now, lookback_hours=24 * 365)
    assert created.created >= 1

    event = db_session.scalar(select(NotificationEvent).order_by(NotificationEvent.created_at.desc()))
    assert event is not None
    assert event.status == NotificationEventStatus.pending
    assert event.subject
    assert event.body

    sent_messages = []

    def fake_send_email(to_address: str, subject: str, body: str) -> None:
        sent_messages.append({"to": to_address, "subject": subject, "body": body})

    monkeypatch.setattr("alethical.api.services.notifications._send_email", fake_send_email)
    sent = send_due_email_notifications(db_session, now=datetime(2026, 3, 29, tzinfo=timezone.utc))

    assert sent.sent >= 1
    assert sent_messages
    db_session.refresh(event)
    assert event.status == NotificationEventStatus.sent
