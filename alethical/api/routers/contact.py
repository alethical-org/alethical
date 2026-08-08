from __future__ import annotations

from fastapi import APIRouter, Depends, status

from alethical.api.problems import problem_exception
from alethical.api.rate_limit import rate_limit
from alethical.api.schemas import ContactMessageRequest, ContactMessageResponse
from alethical.api.services.contact import (
    ContactDeliveryUnavailable,
    send_contact_message,
)

router = APIRouter()


@router.post(
    "/contact",
    response_model=ContactMessageResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(rate_limit("contact_limiter", "contact"))],
)
def contact(message: ContactMessageRequest) -> ContactMessageResponse:
    try:
        send_contact_message(message)
    except ContactDeliveryUnavailable as exc:
        raise problem_exception(
            503,
            "Contact Delivery Unavailable",
            "We couldn't send that message. Try again, or email ask@alethical.com directly.",
            type_slug="contact-delivery-unavailable",
        ) from exc
    return ContactMessageResponse(status="accepted")
