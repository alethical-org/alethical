"""Tests for tracked-bill notification-event recording (#36, slice 1)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from alethical.api.services.notifications import (
    EVENT_BILL_STATUS_CHANGE,
    record_bill_status_change,
)
from alethical.db import models
from alethical.db.session import get_session_factory


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    try:
        yield session
    finally:
        # Everything these tests create is rolled back so the session-scoped
        # sample data stays pristine for other tests.
        session.rollback()
        session.close()


def _make_user(db) -> models.UserAccount:
    user = models.UserAccount(primary_email=f"{uuid.uuid4()}@example.com")
    db.add(user)
    db.flush()
    return user


def _email_pref(user, *, frequency, is_enabled=True) -> models.NotificationPreference:
    return models.NotificationPreference(
        user_id=user.id,
        channel=models.NotificationChannel.email,
        frequency=frequency,
        is_enabled=is_enabled,
    )


def _a_bill(db) -> models.Bill:
    bill = db.scalars(select(models.Bill).limit(1)).first()
    assert bill is not None, "sample data should include at least one bill"
    return bill


def test_status_change_queues_events_only_for_email_alert_trackers(db) -> None:
    bill = _a_bill(db)

    # Qualifies: tracks with alerts on + enabled realtime email preference.
    included = _make_user(db)
    db.add(
        models.TrackedBill(user_id=included.id, bill_id=bill.id, alerts_enabled=True)
    )
    db.add(_email_pref(included, frequency=models.NotificationFrequency.realtime))

    # Excluded: email preference frequency is disabled.
    freq_off = _make_user(db)
    db.add(
        models.TrackedBill(user_id=freq_off.id, bill_id=bill.id, alerts_enabled=True)
    )
    db.add(_email_pref(freq_off, frequency=models.NotificationFrequency.disabled))

    # Excluded: email preference toggled off.
    pref_off = _make_user(db)
    db.add(
        models.TrackedBill(user_id=pref_off.id, bill_id=bill.id, alerts_enabled=True)
    )
    db.add(
        _email_pref(
            pref_off, frequency=models.NotificationFrequency.realtime, is_enabled=False
        )
    )

    # Excluded: tracks the bill but alerts are off.
    alerts_off = _make_user(db)
    db.add(
        models.TrackedBill(user_id=alerts_off.id, bill_id=bill.id, alerts_enabled=False)
    )
    db.add(_email_pref(alerts_off, frequency=models.NotificationFrequency.daily_digest))

    # Excluded: only a push preference, no email preference.
    push_only = _make_user(db)
    db.add(
        models.TrackedBill(user_id=push_only.id, bill_id=bill.id, alerts_enabled=True)
    )
    db.add(
        models.NotificationPreference(
            user_id=push_only.id,
            channel=models.NotificationChannel.push,
            frequency=models.NotificationFrequency.realtime,
            is_enabled=True,
        )
    )

    # Excluded: wants email alerts but does not track this bill.
    not_tracking = _make_user(db)
    db.add(_email_pref(not_tracking, frequency=models.NotificationFrequency.realtime))

    db.flush()

    created_ids = {
        included.id,
        freq_off.id,
        pref_off.id,
        alerts_off.id,
        push_only.id,
        not_tracking.id,
    }

    events = record_bill_status_change(
        db,
        bill_id=bill.id,
        old_status_code="introduced",
        new_status_code="passed_house",
        old_status="Introduced",
        new_status="Passed House",
    )

    # Of the users this test created, only `included` qualifies. (Sample data may
    # add its own trackers of this bill; scope the assertion to our users.)
    assert {event.user_id for event in events} & created_ids == {included.id}
    (event,) = [event for event in events if event.user_id == included.id]
    assert event.event_type == EVENT_BILL_STATUS_CHANGE
    assert event.old_status_code == "introduced"
    assert event.new_status_code == "passed_house"
    assert event.new_status == "Passed House"
    assert event.sent_at is None

    # The event is persisted and queryable as unsent.
    stored = db.scalars(
        select(models.NotificationEvent).where(
            models.NotificationEvent.user_id == included.id,
            models.NotificationEvent.sent_at.is_(None),
        )
    ).all()
    assert len(stored) == 1


def test_no_event_when_status_code_unchanged(db) -> None:
    bill = _a_bill(db)
    user = _make_user(db)
    db.add(models.TrackedBill(user_id=user.id, bill_id=bill.id, alerts_enabled=True))
    db.add(_email_pref(user, frequency=models.NotificationFrequency.realtime))
    db.flush()

    events = record_bill_status_change(
        db,
        bill_id=bill.id,
        old_status_code="in_committee",
        new_status_code="in_committee",
    )

    assert events == []
