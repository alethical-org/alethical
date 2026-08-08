from __future__ import annotations

import logging
import os

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from alethical.api.schemas import ContactMessageRequest
from alethical.db.models import EmailQuotaWarningState

CONTACT_ADDRESS = "ask@alethical.com"
DEFAULT_FROM = "Alethical <ask@alethical.com>"
RESEND_BATCH_URL = "https://api.resend.com/emails/batch"
RESEND_EMAIL_URL = "https://api.resend.com/emails"
FREE_PLAN_LIMITS = {
    "daily": ("x-resend-daily-quota", 100, "today"),
    "monthly": ("x-resend-monthly-quota", 3_000, "this month"),
}
QUOTA_WARNING_THRESHOLDS = (80, 90, 95)

logger = logging.getLogger(__name__)


class ContactDeliveryUnavailable(RuntimeError):
    """The form could not truthfully say both messages are on their way."""


def _enabled(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _allowlist() -> set[str] | None:
    raw = os.environ.get("ALETHICAL_EMAIL_ALLOWLIST", "").strip()
    if not raw:
        return None
    return {address.strip().lower() for address in raw.split(",") if address.strip()}


def _delivery_readiness() -> tuple[bool, bool, bool, bool]:
    return (
        _enabled(os.environ.get("ALETHICAL_EMAIL_ENABLED")),
        os.environ.get("ALETHICAL_EMAIL_TRANSPORT", "console").strip().lower()
        == "resend",
        bool(os.environ.get("RESEND_API_KEY", "").strip()),
        bool(os.environ.get("ALETHICAL_EMAIL_ALLOWLIST", "").strip()),
    )


def log_contact_delivery_readiness() -> None:
    enabled, transport_resend, key_present, allowlist_configured = _delivery_readiness()
    logger.info(
        "Contact delivery readiness: enabled=%s transport_resend=%s "
        "key_present=%s allowlist_configured=%s",
        enabled,
        transport_resend,
        key_present,
        allowlist_configured,
    )


def _contact_text(message: ContactMessageRequest) -> str:
    return "\n".join(
        [
            "A message arrived through the Alethical Contact us page.",
            "",
            f"Name: {message.name or 'Not provided'}",
            f"Email: {message.email}",
            f"Phone: {message.phone or 'Not provided'}",
            f"Subject: {message.subject}",
            "",
            "Message:",
            message.message,
        ]
    )


def _sender_copy_text(message: ContactMessageRequest) -> str:
    return "\n".join(
        [
            "We received your message to Alethical. This is your copy.",
            "",
            f"Subject: {message.subject}",
            "",
            message.message,
            "",
            f"Name: {message.name or 'Not provided'}",
            f"Email: {message.email}",
            f"Phone: {message.phone or 'Not provided'}",
            "",
            "You can reply to this email to reach ask@alethical.com.",
        ]
    )


def _batch(message: ContactMessageRequest) -> list[dict[str, object]]:
    sender = str(message.email)
    from_address = (
        os.environ.get("ALETHICAL_EMAIL_FROM", DEFAULT_FROM).strip() or DEFAULT_FROM
    )
    return [
        {
            "from": from_address,
            "to": [CONTACT_ADDRESS],
            "reply_to": sender,
            "subject": f"Contact us: {message.subject}",
            "text": _contact_text(message),
        },
        {
            "from": from_address,
            "to": [sender],
            "reply_to": CONTACT_ADDRESS,
            "subject": f"Your message to Alethical: {message.subject}",
            "text": _sender_copy_text(message),
        },
    ]


def _quota_value(headers: object, name: str) -> int | None:
    if not hasattr(headers, "get"):
        return None
    raw = headers.get(name)  # type: ignore[union-attr]
    if raw is None:
        return None
    try:
        return int(str(raw).split("/", 1)[0].strip())
    except ValueError:
        return None


def _warning_state(
    db: Session, *, scope: str, threshold: int
) -> EmailQuotaWarningState:
    db.execute(
        insert(EmailQuotaWarningState)
        .values(scope=scope, threshold=threshold, is_above=False, last_used=0)
        .on_conflict_do_nothing(index_elements=["scope", "threshold"])
    )
    state = db.scalar(
        select(EmailQuotaWarningState)
        .where(
            EmailQuotaWarningState.scope == scope,
            EmailQuotaWarningState.threshold == threshold,
        )
        .with_for_update()
    )
    if state is None:  # pragma: no cover - the insert and select are one transaction
        raise RuntimeError("Email quota warning state was not created")
    return state


def _send_quota_warning(
    *,
    api_key: str,
    scope: str,
    threshold: int,
    used: int,
    limit: int,
    period_label: str,
) -> None:
    from_address = (
        os.environ.get("ALETHICAL_EMAIL_FROM", DEFAULT_FROM).strip() or DEFAULT_FROM
    )
    response = httpx.post(
        RESEND_EMAIL_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Idempotency-Key": f"quota-warning-{scope}-{threshold}-{used}",
        },
        json={
            "from": from_address,
            "to": [CONTACT_ADDRESS],
            "reply_to": CONTACT_ADDRESS,
            "subject": f"Resend free plan is {threshold}% full for {period_label}",
            "text": "\n".join(
                [
                    f"Alethical has used at least {used} of {limit} emails {period_label}.",
                    "",
                    "Upgrade the Resend plan before the limit is reached so messages are not blocked.",
                    "This warning contains usage totals only. It contains no reader message data.",
                ]
            ),
        },
        timeout=float(os.environ.get("ALETHICAL_HTTP_TIMEOUT_SECONDS", "10")),
    )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict) or not data.get("id"):
        raise ValueError("The provider did not accept the quota warning")


def _warn_when_free_plan_fills(
    *, response: httpx.Response, db: Session, api_key: str
) -> None:
    headers = getattr(response, "headers", None)
    daily_used = _quota_value(headers, FREE_PLAN_LIMITS["daily"][0])
    if daily_used is None:
        return

    usage = {
        "daily": daily_used,
        "monthly": _quota_value(headers, FREE_PLAN_LIMITS["monthly"][0]),
    }
    for scope, used in usage.items():
        if used is None:
            continue
        _, limit, period_label = FREE_PLAN_LIMITS[scope]
        for threshold in QUOTA_WARNING_THRESHOLDS:
            state = _warning_state(db, scope=scope, threshold=threshold)
            now_above = used * 100 >= limit * threshold
            if now_above and not state.is_above:
                _send_quota_warning(
                    api_key=api_key,
                    scope=scope,
                    threshold=threshold,
                    used=used,
                    limit=limit,
                    period_label=period_label,
                )
                state.is_above = True
            elif not now_above and state.is_above:
                state.is_above = False
            state.last_used = used
    db.commit()


def send_contact_message(message: ContactMessageRequest, db: Session) -> None:
    """Queue the Alethical copy and sender copy in 1 idempotent Resend call.

    Console and dry-run transports deliberately do not return success here. A
    browser confirmation says both copies are on their way, so only a live
    provider acceptance can justify it.
    """

    request_id = str(message.request_id)
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    enabled, transport_resend, key_present, allowlist_configured = _delivery_readiness()
    if not enabled or not transport_resend or not key_present:
        logger.warning(
            "Contact delivery %s not configured: enabled=%s transport_resend=%s "
            "key_present=%s allowlist_configured=%s",
            request_id,
            enabled,
            transport_resend,
            key_present,
            allowlist_configured,
        )
        raise ContactDeliveryUnavailable("Live contact delivery is not configured")

    recipients = {CONTACT_ADDRESS, str(message.email).lower()}
    allowlist = _allowlist()
    if allowlist is not None and not recipients.issubset(allowlist):
        logger.warning("Contact delivery %s refused by the email allowlist", request_id)
        raise ContactDeliveryUnavailable("A contact recipient is outside the allowlist")

    try:
        response = httpx.post(
            RESEND_BATCH_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Idempotency-Key": f"contact-{request_id}",
            },
            json=_batch(message),
            timeout=float(os.environ.get("ALETHICAL_HTTP_TIMEOUT_SECONDS", "10")),
        )
        response.raise_for_status()
        data = response.json().get("data", [])
        if (
            not isinstance(data, list)
            or len(data) != 2
            or not all(item.get("id") for item in data)
        ):
            raise ContactDeliveryUnavailable(
                "The provider did not accept both messages"
            )
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as exc:
        provider_status = (
            exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
        )
        logger.warning(
            "Contact delivery %s failed: error_type=%s provider_status=%s",
            request_id,
            type(exc).__name__,
            provider_status,
        )
        raise ContactDeliveryUnavailable(
            "The provider did not accept both messages"
        ) from exc

    try:
        _warn_when_free_plan_fills(response=response, db=db, api_key=api_key)
    except (
        httpx.HTTPError,
        SQLAlchemyError,
        RuntimeError,
        ValueError,
        TypeError,
    ) as exc:
        db.rollback()
        logger.warning(
            "Contact delivery %s quota warning failed: %s",
            request_id,
            type(exc).__name__,
        )
