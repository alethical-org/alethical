"""Private invitation demo and existing-administrator inspection."""

from __future__ import annotations

import asyncio
import tempfile
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from alethical.api.rate_limit import rate_limit, trusted_client_ip
from alethical.api.routers.admin import require_admin
from alethical.api.services import mail_upload as service
from alethical.db.models import MailUploadImage, MailUploadSubmission
from alethical.db.session import get_db


class PrivateRoute(APIRoute):
    """Never let database/provider exceptions expose upload parameters in logs."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_handler(request):
            try:
                return await handler(request)
            except (HTTPException, RequestValidationError):
                raise
            except Exception:
                # The normal HTTP handler reports a value-free operational error.
                # Catch here: a 500 handler alone still lets ASGI re-raise the
                # original exception (including SQL parameters) to access logs.
                raise service.fail(503, "Mail upload is unavailable") from None

        return private_handler


router = APIRouter(
    prefix="/mail-upload",
    route_class=PrivateRoute,
    dependencies=[
        Depends(rate_limit("mail_upload_limiter", "mail-upload", trusted_client_ip))
    ],
)
admin_router = APIRouter(
    prefix="/admin/mail-upload",
    route_class=PrivateRoute,
    dependencies=[Depends(require_admin)],
)


class Exchange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    invitation_token: str = Field(
        min_length=32, max_length=128, pattern=r"^[A-Za-z0-9_-]+$"
    )
    client_id: uuid.UUID
    client_secret: str = Field(pattern=r"^[0-9a-f]{64}$")


class SubmissionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    likes_ad: StrictBool
    comment: str | None = Field(default=None, max_length=4000, pattern=r"^[^\x00]*$")


def bearer(authorization: str | None = Header(default=None)) -> str:
    if (
        not authorization
        or not authorization.startswith("Bearer ")
        or len(authorization) != 71
    ):
        raise service.fail(
            401, "This demo session is no longer available", "mail-upload-access"
        )
    return authorization[7:]


@router.post("/sessions")
def exchange(body: Exchange, db: Session = Depends(get_db)):
    return service.exchange(
        db, body.invitation_token, body.client_id, body.client_secret
    )


@router.put("/submissions/{submission_id}")
def create(
    submission_id: uuid.UUID,
    token: str = Depends(bearer),
    db: Session = Depends(get_db),
):
    return service.create_submission(db, service.authorize(db, token), submission_id)


@router.get("/submissions/{submission_id}")
def read(
    submission_id: uuid.UUID,
    token: str = Depends(bearer),
    db: Session = Depends(get_db),
):
    return service.response(
        db, service.owned(db, service.authorize(db, token), submission_id)
    )


@router.put("/submissions/{submission_id}/images/{side}")
async def image(
    submission_id: uuid.UUID,
    side: Literal["front", "back"],
    request: Request,
    token: str = Depends(bearer),
    db: Session = Depends(get_db),
):
    await run_in_threadpool(service.authorize, db, token)
    # Release the connection while receiving the body. One image at a time per
    # process bounds decoding memory; shared DB quotas bound all replicas.
    db.rollback()
    gate = request.app.state.mail_upload_image_gate
    if gate.locked():
        raise service.fail(
            429, "Another photo is saving. Try again", "mail-upload-busy"
        )
    async with gate:
        body = bytearray()
        try:
            async with asyncio.timeout(45):
                async for chunk in request.stream():
                    if len(body) + len(chunk) > service.MAX_IMAGE_BYTES:
                        raise service.fail(
                            413,
                            "Choose a photo smaller than 15 MB",
                            "mail-upload-image-size",
                        )
                    body.extend(chunk)
        except TimeoutError:
            raise service.fail(408, "The photo took too long. Try again") from None
        return await run_in_threadpool(
            service.save_image,
            db,
            token,
            submission_id,
            side,
            bytes(body),
            request.headers.get("content-type", "application/octet-stream")
            .split(";", 1)[0]
            .lower(),
        )


@router.post("/submissions/{submission_id}/submit")
def submit(
    submission_id: uuid.UUID,
    body: SubmissionBody,
    token: str = Depends(bearer),
    db: Session = Depends(get_db),
):
    return service.submit(
        db, service.authorize(db, token), submission_id, body.likes_ad, body.comment
    )


@admin_router.get("/submissions")
def inventory(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(MailUploadSubmission)
        .order_by(MailUploadSubmission.created_at.desc())
        .limit(100)
    )
    return {
        "data": [
            {
                **service.response(db, row)["data"],
                "created_at": row.created_at.isoformat(),
                "saved_at": row.saved_at.isoformat() if row.saved_at else None,
            }
            for row in rows
        ]
    }


@admin_router.get("/submissions/{submission_id}/images/{side}")
def original(
    submission_id: uuid.UUID,
    side: Literal["front", "back"],
    db: Session = Depends(get_db),
):
    image = db.scalar(
        select(MailUploadImage).where(
            MailUploadImage.submission_id == submission_id,
            MailUploadImage.side == side,
            MailUploadImage.selected.is_(True),
        )
    )
    if image is None:
        raise service.fail(404, "Photo not found")
    try:
        primary, _ = service.stores()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "original"
            primary.get(image.object_key, str(path), max_bytes=service.MAX_IMAGE_BYTES)
            body = path.read_bytes()
        import hashlib

        if hashlib.sha256(body).hexdigest() != image.sha256:
            raise ValueError("Integrity check failed")
    except Exception:
        raise service.fail(503, "Photo is unavailable") from None
    return Response(
        body,
        media_type=image.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{image.id}"',
            "X-Content-Type-Options": "nosniff",
        },
    )
