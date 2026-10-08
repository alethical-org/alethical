"""Private profile claim notifications, with durable, bounded provider retries.

Resend keeps idempotency keys for 24 hours. Never retry an uncertain delivery after
23 hours or with changed content/recipients. No request handler sends email.
https://resend.com/docs/dashboard/emails/idempotency-keys
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from html import escape
import logging
import os
import threading
import time
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from alethical.api.services.admin_access import eligible_administrator_accounts
from alethical.api.services.candidate_claim_identity import current_confirmed_emails
from alethical.api.services.comment_email import DRAIN_LOCK
from alethical.api.services.contact import _allowlist, _enabled, _provider_error_name
from alethical.db.models import (
    CandidateClaim,
    CandidateClaimEmailDelivery,
    CandidateClaimEvent,
    UserAccount,
)
from alethical.db.session import get_session_factory

logger = logging.getLogger(__name__)
ADDRESS = "ask@alethical.com"
SENDER = f"Alethical <{ADDRESS}>"
ORIGIN = "https://www.alethical.com"
RESEND_URL = "https://api.resend.com/emails"
RETRY_WINDOW = timedelta(hours=23)
REQUEST_SPACING = 0.55
DECISIONS = {"approved", "rejected", "revoked"}
ADMIN_FOOTER = "Sign in with an Alethical administrator account to review this profile claim request"
APPLICANT_FOOTER = "Sign in with the account that submitted this profile claim request"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ready() -> bool:
    return (
        _enabled(os.getenv("ALETHICAL_PROFILE_CLAIM_EMAIL_ENABLED"))
        and _enabled(os.getenv("ALETHICAL_EMAIL_ENABLED"))
        and os.getenv("ALETHICAL_EMAIL_TRANSPORT", "").strip().lower() == "resend"
        and bool(os.getenv("RESEND_API_KEY", "").strip())
    )


def current_confirmed_email(db: Session, user_id) -> str | None:
    """Resolve current provider evidence, not an old copied profile address.

    Multiple distinct confirmed identities require an explicit account choice;
    skip delivery rather than selecting an arbitrary address. Errors propagate.
    """
    return current_confirmed_emails(db, {user_id}).get(user_id)


def _eligible(db: Session, row: CandidateClaimEmailDelivery) -> str | None:
    user = db.scalar(
        select(UserAccount)
        .where(UserAccount.id == row.user_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    event = db.get(CandidateClaimEvent, row.event_id, populate_existing=True)
    claim = db.get(CandidateClaim, event.claim_id) if event else None
    if not user or not user.is_active or event is None or claim is None:
        return None
    if row.recipient_kind == "admin":
        if event.kind not in DECISIONS | {"submitted", "resubmitted"}:
            return None
        if event.kind in DECISIONS and row.user_id == event.actor_id:
            return None
        return next(
            (
                item.email
                for item in eligible_administrator_accounts(db)
                if item.user_id == row.user_id
            ),
            None,
        )
    if (
        row.recipient_kind != "applicant"
        or row.user_id != claim.user_id
        or event.kind not in DECISIONS
    ):
        return None
    return current_confirmed_email(db, row.user_id)


def _line(value: object) -> str:
    return " ".join(str(value or "").split())


def _date(value: str) -> str:
    parsed = date.fromisoformat(value)
    return f"{parsed.strftime('%B')} {parsed.day}, {parsed.year}"


def _actor(db: Session, event: CandidateClaimEvent) -> str:
    account = (
        db.get(UserAccount, event.actor_id, populate_existing=True)
        if event.actor_id
        else None
    )
    return (
        _line(account.display_name or str(account.id))
        if account
        else "an administrator"
    )


def _content(db: Session, row: CandidateClaimEmailDelivery) -> dict:
    event = db.get(CandidateClaimEvent, row.event_id, populate_existing=True)
    if event is None:
        raise ValueError("Profile claim event unavailable")
    candidate = event.candidate_snapshot
    fields = [
        ("Candidate", _line(candidate["candidate_name"])),
        ("Office", _line(candidate["office"])),
        ("Voting area", _line(candidate["voting_area"])),
        (
            "Election",
            f"{_line(candidate['election_name'])} · {_date(candidate['election_date'])}",
        ),
    ]
    if row.recipient_kind == "admin":
        link = f"{ORIGIN}/admin/candidate-claims?claim={event.claim_id}"
        footer = ADMIN_FOOTER
        if event.kind == "submitted":
            subject = "New candidate profile claim request"
            message = "A new profile claim request is ready for review"
            action = "Review profile claim request"
        elif event.kind == "resubmitted":
            subject = "Candidate profile claim request resubmitted"
            message = "A profile claim request has been resubmitted for review"
            action = "Review profile claim request"
        elif event.kind in DECISIONS:
            subject = (
                "Profile claim revoked"
                if event.kind == "revoked"
                else f"Profile claim request {event.kind}"
            )
            message = subject
            action = "View profile claim request"
            when = event.created_at.astimezone(ZoneInfo("America/Chicago"))
            fields.extend(
                [
                    ("Decision", event.kind),
                    ("Reviewed by", _actor(db, event)),
                    (
                        "Decision saved",
                        f"{when.strftime('%B')} {when.day}, {when.year}, {when.strftime('%I:%M %p %Z').lstrip('0')}",
                    ),
                ]
            )
        else:
            raise ValueError("Unsupported profile claim email")
    else:
        footer = APPLICANT_FOOTER
        if event.kind == "approved":
            subject = "Your profile claim was approved"
            message = "Your profile claim was approved. You can now add, edit or remove your campaign statement on this candidate profile."
            action, destination = "Manage this profile", "manage"
        elif event.kind == "rejected":
            subject = "Your profile claim request was not approved"
            message = "Your profile claim request was not approved. View your profile claim status for available next steps."
            action, destination = "View profile claim status", "claim"
        elif event.kind == "revoked":
            subject = "Your profile claim was revoked"
            message = "Your profile claim was revoked. You no longer have campaign access to manage this candidate profile’s statement."
            action, destination = "View profile claim status", "claim"
        else:
            raise ValueError("Unsupported profile claim email")
        link = f"{ORIGIN}/candidates/{candidate['candidate_id']}/{destination}"
    return dict(
        subject=subject,
        message=message,
        action=action,
        link=link,
        footer=footer,
        fields=fields,
    )


def _html(content: dict) -> str:
    """Email-safe table layout from the approved profile claim email drawing."""
    rows = "".join(
        f'<tr><td style="padding:{"14px" if i == 0 else "4px"} 16px {"14px" if i == len(content["fields"]) - 1 else "4px"};font-size:15px;line-height:1.5;color:#2c322c;overflow-wrap:anywhere"><strong style="color:#11150f">{escape(label)}:</strong> {escape(value)}</td></tr>'
        for i, (label, value) in enumerate(content["fields"])
    )
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    a.claim-button:hover{{background:#28bf71!important;border-color:#28bf71!important}}
    a:focus-visible{{outline:2px solid #7c5cff;outline-offset:2px}}
    @media(max-width:480px){{.outer{{padding:14px 10px!important}}.brand{{padding:16px 18px!important}}.body{{padding:20px 18px!important}}.message{{font-size:19px!important}}a.claim-button{{display:block!important}}}}
    </style></head><body style="margin:0;background:#f1f2f4;font-family:'Libre Franklin',Helvetica,Arial,sans-serif;color:#11150f">
    <table role="presentation" style="width:100%;border-collapse:collapse"><tr><td class="outer" style="padding:28px 24px">
    <table role="presentation" style="width:100%;max-width:600px;margin:0 auto;background:white;border:1px solid #e8e9e8;border-radius:14px;border-spacing:0;overflow:hidden">
    <tr><td class="brand" style="padding:20px 28px;border-bottom:1px solid #e8e9e8"><img src="https://www.alethical.com/profile-claim-email-mark.png" width="22" height="22" alt="" style="display:inline-block;vertical-align:middle;margin-right:10px"><span style="vertical-align:middle;font-weight:600;font-size:16px;letter-spacing:.15em;color:#11150f">ALETHICAL</span></td></tr>
    <tr><td class="body" style="padding:26px 28px"><p class="message" style="margin:0;font-size:21px;line-height:1.45;font-weight:800;letter-spacing:-.01em">{escape(content["message"])}</p>
    <table role="presentation" style="margin-top:20px;width:100%;border-collapse:collapse;background:#f7f8fa;border:1px solid #e8e9e8;border-radius:12px;font-variant-numeric:tabular-nums">{rows}</table>
    <a class="claim-button" href="{escape(content["link"], quote=True)}" style="margin-top:22px;display:inline-block;min-height:48px;box-sizing:border-box;padding:14px 24px;background:#2ed47e;border:1px solid #2ed47e;border-radius:12px;font-size:16px;line-height:1.2;font-weight:700;color:#06231a;text-align:center;text-decoration:none">{escape(content["action"])}</a>
    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e8e9e8;font-size:14px;line-height:1.5;color:#4f5651">{escape(content["footer"])}</p>
    </td></tr></table></td></tr></table></body></html>'''


def _payload(db: Session, row: CandidateClaimEmailDelivery, recipient: str) -> dict:
    content = _content(db, row)
    body = "\n".join(
        [
            content["message"],
            "",
            *[f"{key}: {value}" for key, value in content["fields"]],
            "",
            f"{content['action']}: {content['link']}",
            "",
            content["footer"],
        ]
    )
    return {
        "from": SENDER,
        "to": [recipient],
        "reply_to": ADDRESS,
        "subject": content["subject"],
        "text": body,
        "html": _html(content),
    }


def _finish(row: CandidateClaimEmailDelivery, state: str) -> None:
    row.state = state
    row.message_payload = None


def _prepare(db: Session, row: CandidateClaimEmailDelivery) -> bool:
    recipient = _eligible(db, row)
    if recipient is None:
        _finish(row, "cancelled")
        return False
    payload = _payload(db, row, recipient)
    if row.attempted_at is not None and row.attempt_count:
        if _now() - row.attempted_at >= RETRY_WINDOW:
            _finish(row, "uncertain")
            return False
        if row.message_payload != payload:
            # This also prevents a deleted actor's saved name from being sent
            # again, and never changes recipient/content under an uncertain key.
            _finish(row, "cancelled")
            return False
    allowed = _allowlist()
    if allowed is not None and recipient.lower() not in allowed:
        row.state = "pending"
        row.next_attempt_at = _now() + timedelta(minutes=5)
        return False
    if not row.attempt_count:
        row.message_payload = payload
        row.attempted_at = _now()
    row.state = "sending"
    row.next_attempt_at = _now() + timedelta(minutes=1)
    return True


def _attempt(db: Session, row: CandidateClaimEmailDelivery) -> None:
    recipient = _eligible(db, row)
    if recipient is None or row.message_payload is None:
        _finish(row, "cancelled")
        return
    payload = _payload(db, row, recipient)
    if row.attempt_count and (
        row.attempted_at is None or _now() - row.attempted_at >= RETRY_WINDOW
    ):
        _finish(row, "uncertain")
        return
    if row.attempt_count and row.message_payload != payload:
        _finish(row, "cancelled")
        return
    allowed = _allowlist()
    if allowed is not None and recipient.lower() not in allowed:
        row.state = "pending"
        row.next_attempt_at = _now() + timedelta(minutes=5)
        return
    if not row.attempt_count:
        row.message_payload = payload
    row.attempt_count += 1
    delivery_id = row.id
    request_payload = row.message_payload
    db.commit()  # Persist exact request before HTTP; release account locks.
    try:
        response = httpx.post(
            RESEND_URL,
            headers={
                "Authorization": f"Bearer {os.environ['RESEND_API_KEY'].strip()}",
                "Idempotency-Key": f"profile-claim-email/{delivery_id}",
            },
            json=request_payload,
            timeout=httpx.Timeout(8.0, connect=3.0),
        )
    except httpx.HTTPError:
        response = None
    # Deletion during an in-flight send cannot recall that email. It must not
    # recreate the deleted account's delivery record when the response returns.
    db.expire_all()
    current = db.scalar(
        select(CandidateClaimEmailDelivery)
        .where(CandidateClaimEmailDelivery.id == delivery_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if current is None or current.state != "sending":
        return
    row = current
    if response is not None and 200 <= response.status_code < 300:
        try:
            provider_id = response.json().get("id")
        except (ValueError, AttributeError):
            provider_id = None
        if isinstance(provider_id, str) and provider_id:
            row.provider_id = provider_id
            _finish(row, "sent")
            return
    if response is not None and 400 <= response.status_code < 500:
        retryable = response.status_code in {408, 429} or (
            response.status_code == 409
            and _provider_error_name(response) == "concurrent_idempotent_requests"
        )
        if not retryable:
            _finish(row, "failed")
            return
    row.state = "pending"
    row.next_attempt_at = _now() + timedelta(
        seconds=min(3600, 30 * (2 ** min(row.attempt_count - 1, 7)))
    )


def drain_once(limit: int = 20, *, _stop: threading.Event | None = None) -> int:
    if not _ready():
        return 0
    factory, sent = get_session_factory(), 0
    with factory() as owner:
        # Share the existing sender's lock so the two queues do not each consume
        # the provider's whole request allowance at the same time.
        if not owner.scalar(select(text(f"pg_try_advisory_xact_lock({DRAIN_LOCK})"))):
            return 0
        for _ in range(max(0, min(limit, 100))):
            if _stop is not None and _stop.is_set():
                break
            owner.execute(select(1))
            with factory() as db:
                row = db.scalar(
                    select(CandidateClaimEmailDelivery)
                    .where(
                        CandidateClaimEmailDelivery.state.in_(("pending", "sending")),
                        CandidateClaimEmailDelivery.next_attempt_at <= func.now(),
                    )
                    .order_by(
                        CandidateClaimEmailDelivery.next_attempt_at,
                        CandidateClaimEmailDelivery.id,
                    )
                    .with_for_update(skip_locked=True)
                    .limit(1)
                )
                if row is None:
                    break
                ready, row_id = _prepare(db, row), row.id
                db.commit()
                if not ready:
                    continue
                row = db.scalar(
                    select(CandidateClaimEmailDelivery)
                    .where(CandidateClaimEmailDelivery.id == row_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
                if row is None or row.state != "sending":
                    continue
                _attempt(db, row)
                current = db.get(CandidateClaimEmailDelivery, row_id)
                sent += bool(current and current.state == "sent")
                db.commit()
                time.sleep(REQUEST_SPACING)
    return sent


@asynccontextmanager
async def candidate_claim_email_lifespan(app):
    stop, wake = threading.Event(), asyncio.Event()

    async def worker():
        while not stop.is_set():
            try:
                await asyncio.to_thread(drain_once, _stop=stop)
            except Exception:
                logger.error(
                    "Profile claim email delivery failed; pending messages retained"
                )
            try:
                await asyncio.wait_for(wake.wait(), timeout=10)
            except TimeoutError:
                pass

    task = asyncio.create_task(worker())
    try:
        yield
    finally:
        stop.set()
        wake.set()
        await task
