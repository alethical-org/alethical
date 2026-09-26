"""Durable comment mail, sent outside request handling with bounded safe retries.

Resend retains idempotency keys for 24 hours:
https://resend.com/docs/dashboard/emails/idempotency-keys
The shorter retry window leaves room for network time and clock differences.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import logging
import os
import secrets
import threading
import time
from urllib.parse import urlencode

import httpx
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from alethical.api.services.contact import _allowlist, _enabled, _provider_error_name
from alethical.db.models import (
    AuthIdentity,
    CommentArticleFollow,
    CommentEmailDelivery,
    CommentProfile,
    CommentStopToken,
    EditorialComment,
    UserAccount,
)
from alethical.db.session import get_session_factory

logger = logging.getLogger(__name__)
ADDRESS = "ask@alethical.com"
SENDER = f"Alethical <{ADDRESS}>"
ORIGIN = "https://www.alethical.com"
RESEND_URL = "https://api.resend.com/emails"
RETRY_WINDOW = timedelta(hours=23)
# A transaction-level lock works through the production transaction pooler.
DRAIN_LOCK = 1396919629
REQUEST_SPACING = 0.55
EVENT_LABELS = {
    "new_comment": "New comment",
    "new_reply": "New reply",
    "edit_comment": "Comment edited",
    "edit_reply": "Reply edited",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ready() -> bool:
    return (
        _enabled(os.getenv("ALETHICAL_COMMENT_EMAIL_ENABLED"))
        and _enabled(os.getenv("ALETHICAL_EMAIL_ENABLED"))
        and os.getenv("ALETHICAL_EMAIL_TRANSPORT", "").strip().lower() == "resend"
        and bool(os.getenv("RESEND_API_KEY", "").strip())
    )


def _article(article_id: str) -> dict:
    # Import here because comment writes enqueue deliveries but never send them.
    from alethical.api.services.comments import article

    return article(article_id)


def _account(db: Session, row: CommentEmailDelivery) -> UserAccount | None:
    if row.user_id is None:
        return None
    return db.scalar(
        select(UserAccount)
        .where(UserAccount.id == row.user_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )


def _eligible(db: Session, row: CommentEmailDelivery) -> tuple[str, bool, bool] | None:
    comment = db.get(EditorialComment, row.comment_id, populate_existing=True)
    if comment is None or comment.status != "live":
        return None
    if row.is_admin:
        return ADDRESS, False, False
    user = _account(db, row)
    if user is None or not user.is_active or not user.primary_email:
        return None
    if row.user_id == row.actor_id:
        return None
    verified = db.scalar(
        select(AuthIdentity.id).where(
            AuthIdentity.user_id == user.id,
            AuthIdentity.email == user.primary_email,
            AuthIdentity.email_verified_at.is_not(None),
        )
    )
    if verified is None:
        return None
    profile = db.get(CommentProfile, user.id, populate_existing=True)
    follow = db.get(
        CommentArticleFollow, (user.id, row.article_id), populate_existing=True
    )
    target = (
        db.get(EditorialComment, comment.reply_to_id, populate_existing=True)
        if comment.reply_to_id
        else None
    )
    direct = bool(
        row.direct_reply
        and row.event_kind == "new_reply"
        and (profile.reply_emails if profile else True)
        and target
        and target.status == "live"
        and target.author_id == user.id
    )
    updates = bool(row.article_update and follow and follow.enabled)
    return (user.primary_email, direct, updates) if direct or updates else None


def _name(db: Session, user_id) -> str:
    profile = db.get(CommentProfile, user_id) if user_id else None
    # Names may contain whitespace; they cannot add email header/body lines.
    return " ".join((profile.public_name or "Reader").split()) if profile else "Reader"


def _stop_link(db: Session, row: CommentEmailDelivery, choice: str) -> str:
    token = secrets.token_urlsafe(32)
    db.add(
        CommentStopToken(
            token_digest=hashlib.sha256(token.encode()).hexdigest(),
            user_id=row.user_id,
            article_id=row.article_id,
            link_choice=choice,
        )
    )
    return f"{ORIGIN}/comment-emails#{urlencode({'token': token, 'choice': choice})}"


def _payload(
    db: Session,
    row: CommentEmailDelivery,
    eligible: tuple[str, bool, bool],
    piece: dict,
) -> dict:
    recipient, direct, updates = eligible
    title = " ".join(piece["title"].split())
    link = f"{ORIGIN}{piece['path']}#comment-{row.comment_id}"
    kind = "reply" if row.event_kind.endswith("reply") else "comment"
    subject = f"{EVENT_LABELS[row.event_kind]} on “{title}”"
    if row.is_admin:
        body = f"View {kind}:\n{link}"
    elif direct:
        subject = f"{_name(db, row.actor_id)} replied to your comment on Alethical"
        body = (
            f"Article: {title}\n\nView reply:\n{link}\n\n"
            f"Stop reply emails:\n{_stop_link(db, row, 'replies')}"
        )
        if updates:
            body += (
                "\n\nYou also receive new or edited comments and replies on this article."
                f"\n\nStop updates for this article:\n{_stop_link(db, row, 'article')}"
            )
    else:
        subject += " on Alethical"
        name = _name(db, row.actor_id)
        if row.event_kind == "new_comment":
            description = f"{name} commented."
        elif row.event_kind == "new_reply":
            comment = db.get(EditorialComment, row.comment_id)
            target = (
                db.get(EditorialComment, comment.reply_to_id, populate_existing=True)
                if comment
                else None
            )
            if target and target.status == "live":
                description = f"{name} replied to {_name(db, target.author_id)}."
            else:
                # Erased identities must not reappear in mail awaiting delivery.
                description = f"{name} replied."
        else:
            description = f"{name} edited their {kind}."
        body = (
            f"{description}\n\nView {kind}:\n{link}\n\n"
            "You chose to receive new or edited comments and replies on this article."
            f"\n\nStop updates for this article:\n{_stop_link(db, row, 'article')}"
        )
    return {
        "from": SENDER,
        "to": [recipient],
        "reply_to": ADDRESS,
        "subject": subject,
        "text": body,
    }


def _finish(row: CommentEmailDelivery, state: str) -> None:
    row.state = state
    # Pending mail needs its exact body for retries. Terminal rows retain neither
    # private stop-link capabilities nor recipient addresses and public names.
    row.message_payload = None


def _reply_target_erased(db: Session, row: CommentEmailDelivery) -> bool:
    if row.is_admin or row.event_kind != "new_reply":
        return False
    comment = db.get(EditorialComment, row.comment_id, populate_existing=True)
    target = (
        db.get(EditorialComment, comment.reply_to_id, populate_existing=True)
        if comment and comment.reply_to_id
        else None
    )
    return target is None or target.status != "live"


def _prepare(db: Session, row: CommentEmailDelivery) -> bool:
    from fastapi import HTTPException

    try:
        piece = _article(row.article_id)
    except HTTPException:
        _finish(row, "cancelled")
        return False
    if row.event_kind not in EVENT_LABELS:
        _finish(row, "failed")
        return False
    eligible = _eligible(db, row)
    if eligible is None:
        _finish(row, "cancelled")
        return False
    recipient, direct, updates = eligible
    allowed = _allowlist()
    if allowed is not None and recipient.lower() not in allowed:
        row.next_attempt_at = _now() + timedelta(minutes=5)
        return False
    if row.attempted_at is not None:
        if _reply_target_erased(db, row):
            _finish(row, "cancelled")
            return False
        if _now() - row.attempted_at >= RETRY_WINDOW:
            _finish(row, "uncertain")
            return False
        if (
            row.message_payload is None
            or row.message_payload.get("to") != [recipient]
            or (row.direct_reply, row.article_update) != (direct, updates)
        ):
            # An uncertain request may already have succeeded. A changed payload
            # or a new key could send a second email or override a later stop.
            _finish(row, "cancelled")
            return False
    else:
        row.direct_reply, row.article_update = direct, updates
        row.message_payload = _payload(db, row, eligible, piece)
        row.attempted_at = _now()
    row.state = "sending"
    row.next_attempt_at = _now() + timedelta(minutes=1)
    return True


def _attempt(db: Session, row: CommentEmailDelivery) -> None:
    # A stop committed before this final account-locked check wins. Commit the
    # sending claim before HTTP, releasing the account so a slow email request
    # never holds up this reader's next comment, edit or stop confirmation.
    # Stopping cannot recall a message whose delivery has already begun.
    eligible = _eligible(db, row)
    if (
        eligible is None
        or row.message_payload is None
        or row.message_payload.get("to") != [eligible[0]]
        or (row.direct_reply, row.article_update) != eligible[1:]
    ):
        _finish(row, "cancelled")
        return
    if _reply_target_erased(db, row):
        if row.attempt_count:
            _finish(row, "cancelled")
            return
        # No provider request has begun yet, so replace a prepared target name
        # with the anonymous fallback. Once attempted, the payload must not vary.
        row.message_payload = _payload(db, row, eligible, _article(row.article_id))
    row.attempt_count += 1
    db.commit()
    try:
        response = httpx.post(
            RESEND_URL,
            headers={
                "Authorization": f"Bearer {os.environ['RESEND_API_KEY'].strip()}",
                "Idempotency-Key": f"comment-email/{row.id}",
            },
            json=row.message_payload,
            timeout=httpx.Timeout(8.0, connect=3.0),
        )
    except httpx.HTTPError:
        response = None
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
    delay = min(3600, 30 * (2 ** min(row.attempt_count - 1, 7)))
    row.next_attempt_at = _now() + timedelta(seconds=delay)


def drain_once(limit: int = 20, *, _stop: threading.Event | None = None) -> int:
    """Process at most ``limit`` durable rows; return provider-accepted count.

    Call in a worker thread. A separate transaction keeps one sender active across
    API processes while per-delivery commits survive a crash between HTTP and SQL.
    """
    if not _ready():
        return 0
    factory = get_session_factory()
    sent = 0
    with factory() as owner:
        if not owner.scalar(select(text(f"pg_try_advisory_xact_lock({DRAIN_LOCK})"))):
            return 0
        for _ in range(max(0, min(limit, 100))):
            if _stop is not None and _stop.is_set():
                break
            # Keep ownership alive between bounded requests; a lost connection
            # must stop this worker before another worker can take over.
            owner.execute(select(1))
            with factory() as db:
                row = db.scalar(
                    select(CommentEmailDelivery)
                    .where(
                        CommentEmailDelivery.state.in_(("pending", "sending")),
                        CommentEmailDelivery.next_attempt_at <= func.now(),
                    )
                    .order_by(
                        CommentEmailDelivery.next_attempt_at, CommentEmailDelivery.id
                    )
                    .with_for_update(skip_locked=True)
                    .limit(1)
                )
                if row is None:
                    break
                ready = _prepare(db, row)
                row_id = row.id
                db.commit()  # The exact request exists durably before HTTP starts.
                if not ready:
                    continue
                row = db.scalar(
                    select(CommentEmailDelivery)
                    .where(CommentEmailDelivery.id == row_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
                if row is None or row.state != "sending":
                    continue
                _attempt(db, row)
                sent += row.state == "sent"
                db.commit()
                # Keep the global sender lock through cooldown, also between runs.
                time.sleep(REQUEST_SPACING)
    return sent


@asynccontextmanager
async def comment_email_lifespan(app):
    """Recover pending rows at startup and after failures, without blocking HTTP."""
    stop = threading.Event()
    wake = asyncio.Event()

    async def worker():
        while not stop.is_set():
            try:
                await asyncio.to_thread(drain_once, _stop=stop)
            except Exception:
                # Database/provider exceptions can include private SQL parameters.
                logger.error("Comment email drain failed; pending deliveries retained")
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
