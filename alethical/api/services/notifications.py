from __future__ import annotations

import hashlib
import os
import smtplib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from alethical.db.schema import load_schema

schema = load_schema()
Bill = schema.Bill
NotificationChannel = schema.NotificationChannel
NotificationEvent = schema.NotificationEvent
NotificationEventStatus = schema.NotificationEventStatus
NotificationFrequency = schema.NotificationFrequency
NotificationPreference = schema.NotificationPreference
TrackedBill = schema.TrackedBill
UserAccount = schema.UserAccount


@dataclass(frozen=True)
class NotificationRunResult:
    created: int = 0
    sent: int = 0
    failed: int = 0
    skipped: int = 0


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _notification_source_hash(bill) -> str:
    material = "|".join(
        [
            str(bill.id),
            bill.bill_key or "",
            bill.current_status_code or "",
            bill.current_status or "",
            bill.latest_action_at.isoformat() if bill.latest_action_at else "",
        ]
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _scheduled_for(frequency, now: datetime) -> datetime:
    if frequency == NotificationFrequency.daily_digest:
        return now + timedelta(days=1)
    if frequency == NotificationFrequency.weekly_digest:
        return now + timedelta(days=7)
    return now


def _format_bill_update_subject(bill) -> str:
    return f"Update on {bill.file_type.upper()} {bill.file_number}: {bill.title[:180]}"


def _format_bill_update_body(bill) -> str:
    status = bill.current_status or "Status updated"
    action_date = bill.latest_action_at.date().isoformat() if bill.latest_action_at else "date unavailable"
    lines = [
        f"{bill.file_type.upper()} {bill.file_number}: {bill.title}",
        "",
        f"Latest status: {status}",
        f"Latest action date: {action_date}",
    ]
    if bill.official_url:
        lines.extend(["", f"Official source: {bill.official_url}"])
    return "\n".join(lines)


def _bill_payload(bill) -> dict:
    return {
        "bill_id": bill.bill_key,
        "file_type": bill.file_type,
        "file_number": bill.file_number,
        "title": bill.title,
        "current_status": bill.current_status,
        "status_key": bill.current_status_code,
        "latest_action_at": bill.latest_action_at.isoformat() if bill.latest_action_at else None,
        "official_url": bill.official_url,
    }


def _email_preference_for(user) -> NotificationPreference | None:
    return next(
        (
            preference
            for preference in user.notification_preferences
            if preference.channel == NotificationChannel.email
        ),
        None,
    )


def create_tracked_bill_update_events(
    db: Session,
    *,
    now: datetime | None = None,
    lookback_hours: int = 48,
) -> NotificationRunResult:
    """Create pending email events for tracked bills whose latest action changed recently."""
    now = now or _utc_now()
    cutoff = now - timedelta(hours=lookback_hours)
    tracked_rows = db.scalars(
        select(TrackedBill)
        .join(TrackedBill.bill)
        .where(
            TrackedBill.alerts_enabled.is_(True),
            Bill.latest_action_at.is_not(None),
            Bill.latest_action_at >= cutoff,
        )
        .options(
            selectinload(TrackedBill.user).selectinload(UserAccount.notification_preferences),
            selectinload(TrackedBill.bill),
        )
    ).all()

    created = 0
    skipped = 0
    for tracked in tracked_rows:
        user = tracked.user
        bill = tracked.bill
        preference = _email_preference_for(user)
        if (
            preference is None
            or not preference.is_enabled
            or preference.frequency == NotificationFrequency.disabled
            or not user.primary_email
        ):
            skipped += 1
            continue

        source_hash = _notification_source_hash(bill)
        existing_event_id = db.scalar(
            select(NotificationEvent.id).where(
                NotificationEvent.user_id == user.id,
                NotificationEvent.bill_id == bill.id,
                NotificationEvent.event_type == "tracked_bill_update",
                NotificationEvent.source_hash == source_hash,
            )
        )
        if existing_event_id is not None:
            skipped += 1
            continue

        event = NotificationEvent(
            user_id=user.id,
            bill_id=bill.id,
            channel=NotificationChannel.email,
            event_type="tracked_bill_update",
            source_hash=source_hash,
            subject=_format_bill_update_subject(bill),
            body=_format_bill_update_body(bill),
            payload_json=_bill_payload(bill),
            status=NotificationEventStatus.pending,
            scheduled_for=_scheduled_for(preference.frequency, now),
        )
        db.add(event)
        created += 1

    db.commit()
    return NotificationRunResult(created=created, skipped=skipped)


def _smtp_configured() -> bool:
    return bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_FROM"))


def _send_email(to_address: str, subject: str, body: str) -> None:
    if not _smtp_configured():
        raise RuntimeError("SMTP_HOST and SMTP_FROM are required to send notification email")

    message = EmailMessage()
    message["From"] = os.environ["SMTP_FROM"]
    message["To"] = to_address
    message["Subject"] = subject
    message.set_content(body)

    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    username = os.environ.get("SMTP_USERNAME")
    password = os.environ.get("SMTP_PASSWORD")
    use_tls = os.environ.get("SMTP_USE_TLS", "true").lower() != "false"

    with smtplib.SMTP(host, port, timeout=30) as smtp:
        if use_tls:
            smtp.starttls()
        if username and password:
            smtp.login(username, password)
        smtp.send_message(message)


def send_due_email_notifications(
    db: Session,
    *,
    now: datetime | None = None,
    limit: int = 100,
) -> NotificationRunResult:
    now = now or _utc_now()
    events = db.scalars(
        select(NotificationEvent)
        .join(NotificationEvent.user)
        .where(
            NotificationEvent.channel == NotificationChannel.email,
            NotificationEvent.status == NotificationEventStatus.pending,
            NotificationEvent.scheduled_for <= now,
        )
        .order_by(NotificationEvent.created_at.asc())
        .limit(limit)
        .options(selectinload(NotificationEvent.user))
    ).all()

    sent = 0
    failed = 0
    skipped = 0
    for event in events:
        recipient = event.user.primary_email
        if not recipient:
            event.status = NotificationEventStatus.skipped
            event.failure_reason = "user has no primary email"
            skipped += 1
            continue
        try:
            _send_email(recipient, event.subject, event.body)
        except Exception as exc:  # noqa: BLE001
            event.status = NotificationEventStatus.failed
            event.failure_reason = str(exc)
            failed += 1
            continue
        event.status = NotificationEventStatus.sent
        event.sent_at = now
        event.failure_reason = None
        sent += 1

    db.commit()
    return NotificationRunResult(sent=sent, failed=failed, skipped=skipped)
