from __future__ import annotations

import logging
import os

import httpx

from alethical.api.schemas import ContactMessageRequest

CONTACT_ADDRESS = "ask@alethical.com"
DEFAULT_FROM = "Alethical <ask@alethical.com>"
RESEND_BATCH_URL = "https://api.resend.com/emails/batch"

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


def send_contact_message(message: ContactMessageRequest) -> None:
    """Queue the Alethical copy and sender copy in 1 idempotent Resend call.

    Console and dry-run transports deliberately do not return success here. A
    browser confirmation says both copies are on their way, so only a live
    provider acceptance can justify it.
    """

    request_id = str(message.request_id)
    transport = os.environ.get("ALETHICAL_EMAIL_TRANSPORT", "console").strip().lower()
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if (
        not _enabled(os.environ.get("ALETHICAL_EMAIL_ENABLED"))
        or transport != "resend"
        or not api_key
    ):
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
        logger.warning("Contact delivery %s failed: %s", request_id, type(exc).__name__)
        raise ContactDeliveryUnavailable(
            "The provider did not accept both messages"
        ) from exc
