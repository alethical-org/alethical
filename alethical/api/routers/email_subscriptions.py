"""Private email choices and public, explicit unsubscribe actions."""

from email.parser import BytesParser
from email.policy import default
from typing import Literal
from urllib.parse import parse_qsl
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator
from sqlalchemy.orm import Session

from alethical.api.auth import get_current_user
from alethical.api.rate_limit import rate_limit, trusted_client_ip
from alethical.api.services import email_subscriptions as service
from alethical.db.session import get_db

router = APIRouter()


class WritePreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    research: StrictBool | None = None
    features: StrictBool | None = None
    expected_version: int = Field(ge=0)
    expected_account_id: UUID
    expected_email: str | None = Field(max_length=255)
    idempotency_key: UUID
    source: Literal["confirmation", "preferences"]

    @model_validator(mode="after")
    def choices(self):
        supplied = self.model_fields_set & {"research", "features"}
        if not supplied or any(getattr(self, name) is None for name in supplied):
            raise ValueError("Supply at least one explicit email choice")
        if self.source == "confirmation" and self.research is not True:
            raise ValueError("Confirmation must explicitly subscribe to research")
        return self


class IntentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    browser_key: str = Field(min_length=32, max_length=128)


class CompleteIntent(IntentRequest):
    reference: str = Field(min_length=32, max_length=128)


class TokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=32, max_length=128)


class UnsubscribeRequest(TokenRequest):
    action: Literal["research", "all"]


@router.get("/me/email-preferences")
def read_preferences(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return {"data": service.preferences(db, user)}


@router.post("/me/email-preferences")
def write_preferences(
    payload: WritePreferences,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    return {
        "data": service.save_preferences(
            db, user.id, payload.model_dump(exclude_unset=True)
        )
    }


@router.post(
    "/email-subscriptions/intent",
    dependencies=[
        Depends(
            rate_limit(
                "pending_action_limiter", "email-intent-create", trusted_client_ip
            )
        )
    ],
)
def start_intent(payload: IntentRequest, db: Session = Depends(get_db)):
    return {
        "data": {
            "reference": service.create_intent(db, payload.browser_key),
            "return_to": "/money",
        }
    }


@router.post("/me/email-subscription-intent/complete")
def finish_intent(
    payload: CompleteIntent,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    service.complete_intent(db, user.id, payload.reference, payload.browser_key)
    return {"data": {"show_confirmation": True, "return_to": "/money"}}


@router.post("/email-subscriptions/unsubscribe/inspect")
def inspect_token(payload: TokenRequest, db: Session = Depends(get_db)):
    service.valid_token(db, payload.token)
    return {"data": {"valid": True}}


@router.post("/email-subscriptions/unsubscribe")
def stop_email(payload: UnsubscribeRequest, db: Session = Depends(get_db)):
    service.unsubscribe(db, payload.token, payload.action)
    return {"data": {"unsubscribed": True, "action": payload.action}}


@router.post("/email-subscriptions/one-click/{token}")
async def one_click(token: str, request: Request, db: Session = Depends(get_db)):
    # RFC 8058 permits either normal form encoding. Bound the tiny request
    # before parsing, ignore extension fields, and never accept file uploads.
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 4096:
            raise HTTPException(400, "Invalid unsubscribe request")
    content_type = request.headers.get("content-type", "")
    valid = False
    try:
        if (
            content_type.split(";", 1)[0].strip().lower()
            == "application/x-www-form-urlencoded"
        ):
            fields = parse_qsl(
                body.decode("ascii").strip(),
                keep_blank_values=True,
                strict_parsing=True,
                max_num_fields=20,
            )
            valid = [value for key, value in fields if key == "List-Unsubscribe"] == [
                "One-Click"
            ]
        elif content_type.split(";", 1)[0].strip().lower() == "multipart/form-data":
            message = BytesParser(policy=default).parsebytes(
                b"Content-Type: "
                + content_type.encode("ascii")
                + b"\r\nMIME-Version: 1.0\r\n\r\n"
                + bytes(body)
            )
            parts = list(message.iter_parts())
            if not message.defects and 1 <= len(parts) <= 20:
                values = []
                safe = True
                for part in parts:
                    if (
                        part.defects
                        or part.is_multipart()
                        or part.get_filename() is not None
                    ):
                        safe = False
                        break
                    if part.get_content_disposition() != "form-data":
                        safe = False
                        break
                    if (
                        part.get_param("name", header="content-disposition")
                        == "List-Unsubscribe"
                    ):
                        values.append(part.get_payload(decode=True))
                valid = safe and values == [b"One-Click"]
    except (UnicodeError, ValueError):
        valid = False
    if len(token) < 32 or len(token) > 128 or not valid:
        raise HTTPException(400, "Invalid unsubscribe request")
    service.unsubscribe(db, token, "research")
    return {"data": {"unsubscribed": True, "action": "research"}}
