"""Public editorial discussion; writes belong to confirmed accounts."""

from __future__ import annotations

import time
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator
from sqlalchemy.orm import Session

from alethical.api.auth import get_current_user
from alethical.api.routers.admin import administrator_access
from alethical.api.services import comments as service
from alethical.api.services.admin_access import administrator_menu_access
from alethical.db.session import get_db

router = APIRouter()


class Write(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_key: UUID
    expected_account_id: UUID


class Create(Write):
    body: str = Field(min_length=1, max_length=2000)
    reply_to_id: UUID | None = None
    public_name: str | None = None
    expected_profile_version: int | None = Field(default=None, ge=0)


class Change(Write):
    expected_version: int = Field(ge=0)


class Edit(Change):
    body: str = Field(min_length=1, max_length=2000)


class Name(Change):
    article_id: str = Field(min_length=1, max_length=200)
    public_name: str


class Preferences(Write):
    article_id: str = Field(min_length=1, max_length=200)
    expected_profile_version: int = Field(ge=0)
    expected_follow_version: int = Field(ge=0)
    reply_emails: StrictBool | None = None
    article_updates: StrictBool | None = None

    @model_validator(mode="after")
    def supplied_choices(self):
        keys = self.model_fields_set & {"reply_emails", "article_updates"}
        if not keys or any(getattr(self, key) is None for key in keys):
            raise ValueError("Supply at least 1 email choice")
        return self


class StopToken(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=32, max_length=128)


class Stop(StopToken):
    choice: Literal["replies", "article"]


def admin_hint(request: Request, db: Session) -> bool:
    if getattr(request.state, "auth_provider", None) != "supabase":
        return False
    return (
        administrator_menu_access(
            db, getattr(request.state, "auth_provider_subject", None)
        )
        is True
    )


def writer(request: Request, user=Depends(get_current_user)):
    # Bound floods from one confirmed account without coupling other readers.
    limiter = request.app.state.comment_limiter
    key = str(user.id)
    now = time.monotonic()
    if not limiter.allow(key, now):
        raise HTTPException(
            429,
            "Please wait before trying again",
            headers={
                "Retry-After": str(limiter.retry_after_seconds(key, now) or 1),
            },
        )
    return user


@router.get("/comments/articles/{article_id}")
def list_comments(
    article_id: str,
    cursor: str | None = Query(default=None, max_length=1024),
    db: Session = Depends(get_db),
):
    return {"data": service.list_comments(db, article_id, cursor)}


@router.get("/comments/articles/{article_id}/conversation/{comment_id}")
def conversation(article_id: str, comment_id: UUID, db: Session = Depends(get_db)):
    return {"data": service.conversation(db, article_id, comment_id)}


@router.get("/me/comments/settings")
def read_settings(
    request: Request,
    article_id: str = Query(min_length=1, max_length=200),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    return {"data": service.settings(db, user, article_id, admin_hint(request, db))}


@router.post("/comments/articles/{article_id}")
def create_comment(
    article_id: str,
    payload: Create,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(writer),
):
    return {
        "data": service.create_comment(
            db,
            user,
            article_id,
            payload.model_dump(exclude_unset=True),
            admin_hint(request, db),
        )
    }


@router.post("/comments/articles/{article_id}/{comment_id}/edit")
def edit_comment(
    article_id: str,
    comment_id: UUID,
    payload: Edit,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(writer),
):
    return {
        "data": service.change_comment(
            db,
            user,
            article_id,
            comment_id,
            payload.model_dump(),
            "edit",
            admin_hint(request, db),
        )
    }


@router.post("/comments/articles/{article_id}/{comment_id}/delete")
def delete_comment(
    article_id: str,
    comment_id: UUID,
    payload: Change,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(writer),
):
    return {
        "data": service.change_comment(
            db,
            user,
            article_id,
            comment_id,
            payload.model_dump(),
            "delete",
            admin_hint(request, db),
        )
    }


@router.post("/comments/articles/{article_id}/{comment_id}/remove")
def remove_comment(
    article_id: str,
    comment_id: UUID,
    payload: Change,
    db: Session = Depends(get_db),
    user=Depends(writer),
    is_admin: bool = Depends(administrator_access),
):
    return {
        "data": service.change_comment(
            db, user, article_id, comment_id, payload.model_dump(), "remove", is_admin
        )
    }


@router.post("/me/comments/name")
def save_name(
    payload: Name, request: Request, db: Session = Depends(get_db), user=Depends(writer)
):
    return {
        "data": service.save_name(
            db, user, payload.model_dump(), admin_hint(request, db)
        )
    }


@router.post("/me/comments/preferences")
def save_preferences(
    payload: Preferences,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(writer),
):
    return {
        "data": service.save_preferences(
            db, user, payload.model_dump(exclude_unset=True), admin_hint(request, db)
        )
    }


@router.get("/me/comments/requests/{request_key}")
def request_status(
    request_key: UUID,
    request: Request,
    article_id: str = Query(min_length=1, max_length=200),
    db: Session = Depends(get_db),
    user=Depends(writer),
):
    return {
        "data": service.request_status(
            db, user, article_id, request_key, admin_hint(request, db)
        )
    }


@router.post("/comments/email-stop/inspect")
def inspect_stop(payload: StopToken, db: Session = Depends(get_db)):
    return {"data": service.stop_choices(db, payload.token)}


@router.post("/comments/email-stop")
def stop_email(payload: Stop, db: Session = Depends(get_db)):
    return {"data": service.stop_choices(db, payload.token, payload.choice)}
