"""Editorial discussion and serialized account-owned mutations.

Every mutation commits its delivery records with the contribution. Nothing here
calls an email provider, and no contribution enters Alethical's factual records.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import (
    String,
    and_,
    cast,
    exists,
    func,
    insert,
    literal,
    or_,
    select,
    text,
)
from sqlalchemy.orm import Session, aliased

from alethical.db.models import (
    AuthIdentity,
    CommentArticleFollow,
    CommentEmailDelivery,
    CommentMutation,
    CommentProfile,
    CommentStopToken,
    EditorialComment,
    UserAccount,
)

MANIFEST = Path(__file__).resolve().parents[2] / "data" / "editorial_articles.json"
PAGE_SIZE = 10


@lru_cache(maxsize=1)
def _articles() -> dict[str, dict]:
    records = json.loads(MANIFEST.read_text())
    result = {}
    for record in records:
        article_id, title, path = (
            record[key] for key in ("article_id", "title", "path")
        )
        if (
            not all(
                isinstance(value, str) and value.strip()
                for value in (article_id, title, path)
            )
            or article_id in result
            or len(article_id) > 200
            or not path.startswith("/read/")
            or len(path.strip("/").split("/")) < 3
            or any(char in path for char in ("?", "#", "\\"))
        ):
            raise RuntimeError("Invalid editorial article manifest")
        result[article_id] = record
    return result


def article(article_id: str) -> dict:
    found = _articles().get(article_id)
    if found is None:
        raise HTTPException(404, "Article not found")
    return found


def _confirmed(db: Session, user: UserAccount) -> None:
    if not user.is_active:
        raise HTTPException(403, "This account has been deactivated")
    identity = (
        db.scalar(
            select(AuthIdentity.id)
            .where(
                AuthIdentity.user_id == user.id,
                AuthIdentity.email == user.primary_email,
                AuthIdentity.email_verified_at.is_not(None),
            )
            .limit(1)
        )
        if user.primary_email
        else None
    )
    if identity is None:
        raise HTTPException(403, "Confirm your account email before commenting")


def _lock_account(db: Session, user_id: uuid.UUID) -> UserAccount:
    db.execute(text("SET LOCAL lock_timeout = '5s'"))
    user = db.scalar(
        select(UserAccount)
        .where(UserAccount.id == user_id)
        # Serialize this account's mutations without blocking the foreign-key
        # checks when another reader queues an email to this account.
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise HTTPException(401, "Sign in to continue")
    return user


def settings(
    db: Session, user: UserAccount, article_id: str, is_admin: bool = False
) -> dict:
    article(article_id)
    _confirmed(db, user)
    profile = db.get(CommentProfile, user.id, populate_existing=True)
    follow = db.get(CommentArticleFollow, (user.id, article_id), populate_existing=True)
    return {
        "account_id": str(user.id),
        "public_name": profile.public_name if profile else None,
        "reply_emails": profile.reply_emails if profile else True,
        "article_updates": follow.enabled if follow else False,
        "profile_version": profile.version if profile else 0,
        "follow_version": follow.version if follow else 0,
        "is_admin": is_admin,
    }


def _profile(db: Session, user_id: uuid.UUID) -> CommentProfile:
    row = db.get(CommentProfile, user_id, populate_existing=True)
    if row is None:
        row = CommentProfile(
            user_id=user_id, public_name=None, reply_emails=True, version=0
        )
        db.add(row)
        db.flush()
    return row


def _follow(db: Session, user_id: uuid.UUID, article_id: str) -> CommentArticleFollow:
    row = db.get(CommentArticleFollow, (user_id, article_id), populate_existing=True)
    if row is None:
        row = CommentArticleFollow(
            user_id=user_id, article_id=article_id, enabled=False, version=0
        )
        db.add(row)
        db.flush()
    return row


def _serialize(db: Session, rows: list[EditorialComment]) -> list[dict]:
    author_ids = {
        row.author_id for row in rows if row.status == "live" and row.author_id
    }
    target_ids = {row.reply_to_id for row in rows if row.reply_to_id}
    targets = (
        {
            row.id: row
            for row in db.scalars(
                select(EditorialComment).where(EditorialComment.id.in_(target_ids))
            )
        }
        if target_ids
        else {}
    )
    author_ids.update(
        row.author_id
        for row in targets.values()
        if row.status == "live" and row.author_id
    )
    names = (
        {
            row.user_id: row.public_name
            for row in db.scalars(
                select(CommentProfile).where(CommentProfile.user_id.in_(author_ids))
            )
        }
        if author_ids
        else {}
    )
    result = []
    for row in rows:
        live = row.status == "live"
        target = targets.get(row.reply_to_id)
        result.append(
            {
                "id": str(row.id),
                "article_id": row.article_id,
                "author_id": str(row.author_id) if live and row.author_id else None,
                "name": names.get(row.author_id) if live else None,
                "body": row.body if live else None,
                "root_id": str(row.root_id) if row.root_id else None,
                "reply_to_id": str(row.reply_to_id) if row.reply_to_id else None,
                "reply_to_name": names.get(target.author_id)
                if live and target and target.status == "live"
                else None,
                "posted_at": row.posted_at.isoformat(),
                "edited_at": row.edited_at.isoformat()
                if live and row.edited_at
                else None,
                "status": row.status,
                "version": row.version,
            }
        )
    return result


def _visible(rows: list[EditorialComment]) -> list[EditorialComment]:
    """Keep only living contributions and the erased ancestors they depend on."""
    by_id = {row.id: row for row in rows}
    visible = {row.id for row in rows if row.status == "live"}
    pending = list(visible)
    while pending:
        row = by_id[pending.pop()]
        for parent_id in (row.root_id, row.reply_to_id):
            if (
                parent_id is not None
                and parent_id in by_id
                and parent_id not in visible
            ):
                visible.add(parent_id)
                pending.append(parent_id)
    return [row for row in rows if row.id in visible]


def _conversation_rows(
    db: Session, roots: list[EditorialComment]
) -> list[EditorialComment]:
    if not roots:
        return []
    replies = list(
        db.scalars(
            select(EditorialComment)
            .where(EditorialComment.root_id.in_([root.id for root in roots]))
            .order_by(EditorialComment.posted_at, EditorialComment.id)
        )
    )
    grouped: dict[uuid.UUID, list] = {root.id: [] for root in roots}
    for reply in replies:
        assert reply.root_id is not None
        grouped[reply.root_id].append(reply)
    return _visible([row for root in roots for row in (root, *grouped[root.id])])


def list_comments(db: Session, article_id: str, cursor: str | None = None) -> dict:
    article(article_id)
    reply = aliased(EditorialComment)
    query = select(EditorialComment).where(
        EditorialComment.article_id == article_id,
        EditorialComment.root_id.is_(None),
        or_(
            EditorialComment.status == "live",
            exists(
                select(reply.id).where(
                    reply.root_id == EditorialComment.id, reply.status == "live"
                )
            ),
        ),
    )
    if cursor:
        try:
            decoded = json.loads(
                base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
            )
            if decoded[0] != article_id:
                raise ValueError("Wrong article")
            stamp = datetime.fromisoformat(decoded[1])
            key = uuid.UUID(decoded[2])
            if stamp.tzinfo is None:
                raise ValueError("Missing timezone")
        except (ValueError, TypeError, IndexError, KeyError, UnicodeError) as exc:
            raise HTTPException(400, "Invalid comments cursor") from exc
        query = query.where(
            or_(
                EditorialComment.posted_at > stamp,
                and_(EditorialComment.posted_at == stamp, EditorialComment.id > key),
            )
        )
    roots = list(
        db.scalars(
            query.order_by(EditorialComment.posted_at, EditorialComment.id).limit(
                PAGE_SIZE + 1
            )
        )
    )
    next_cursor = None
    if len(roots) > PAGE_SIZE:
        roots = roots[:PAGE_SIZE]
        last = roots[-1]
        next_cursor = (
            base64.urlsafe_b64encode(
                json.dumps(
                    [article_id, last.posted_at.isoformat(), str(last.id)]
                ).encode()
            )
            .decode()
            .rstrip("=")
        )
    return {
        "items": _serialize(db, _conversation_rows(db, roots)),
        "next_cursor": next_cursor,
    }


def conversation(db: Session, article_id: str, comment_id: uuid.UUID) -> dict:
    article(article_id)
    row = db.get(EditorialComment, comment_id)
    if row is None or row.article_id != article_id:
        raise HTTPException(404, "Comment not found")
    root = db.get(EditorialComment, row.root_id) if row.root_id else row
    if root is None:
        raise HTTPException(404, "Comment not found")
    rows = _conversation_rows(db, [root])
    if not any(item.id == comment_id for item in rows):
        raise HTTPException(404, "Comment not found")
    return {"items": _serialize(db, rows), "next_cursor": None}


def _result(
    db: Session,
    user: UserAccount,
    article_id: str,
    comment_id: uuid.UUID | None,
    is_admin: bool,
) -> dict:
    row = (
        db.get(EditorialComment, comment_id, populate_existing=True)
        if comment_id
        else None
    )
    return {
        "comment": _serialize(db, [row])[0] if row else None,
        "settings": settings(db, user, article_id, is_admin),
    }


def request_status(
    db: Session,
    user: UserAccount,
    article_id: str,
    request_key: uuid.UUID,
    is_admin: bool = False,
) -> dict:
    article(article_id)
    # Wait for a concurrent write by this account before claiming it did not save.
    user = _lock_account(db, user.id)
    _confirmed(db, user)
    mutation = db.get(CommentMutation, (user.id, request_key))
    if mutation is None:
        # Fence off a late original POST before telling the reader to retry.
        # Empty hash means this key can never authorize a write, including one
        # whose network request had not reached the API when this check ran.
        db.add(
            CommentMutation(
                user_id=user.id,
                request_key=request_key,
                article_id=article_id,
                payload_hash="",
            )
        )
        result = {"state": "not_found", "result": None}
    elif mutation.article_id != article_id or not mutation.payload_hash:
        result = {"state": "not_found", "result": None}
    else:
        result = {
            "state": "saved",
            "result": _result(db, user, article_id, mutation.comment_id, is_admin),
        }
    db.commit()
    return result


def _begin(
    db: Session,
    user: UserAccount,
    article_id: str,
    payload: dict,
    action: str,
    is_admin: bool,
):
    article(article_id)
    user = _lock_account(db, user.id)
    _confirmed(db, user)
    if str(user.id) != str(payload["expected_account_id"]):
        raise HTTPException(409, "Your account changed. Sign in again")
    digest = hashlib.sha256(
        json.dumps(
            {"action": action, "article_id": article_id, **payload},
            sort_keys=True,
            default=str,
        ).encode()
    ).hexdigest()
    key = uuid.UUID(str(payload["request_key"]))
    prior = db.get(CommentMutation, (user.id, key))
    if prior:
        if not prior.payload_hash:
            raise HTTPException(
                409, "This submission was not saved. Try again with a new request"
            )
        if not hmac.compare_digest(prior.payload_hash, digest):
            raise HTTPException(
                409, "This request key was already used for a different action"
            )
        result = _result(db, user, article_id, prior.comment_id, is_admin)
        db.commit()
        return user, None, result
    # One article lock serializes reply/delete races without coupling unrelated pieces.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:article, 8407))"),
        {"article": article_id},
    )
    mutation = CommentMutation(
        user_id=user.id, request_key=key, article_id=article_id, payload_hash=digest
    )
    db.add(mutation)
    return user, mutation, None


def _finish(
    db: Session,
    user: UserAccount,
    article_id: str,
    mutation: CommentMutation,
    row: EditorialComment | None,
    is_admin: bool,
) -> dict:
    mutation.comment_id = row.id if row else None
    db.flush()
    result = _result(db, user, article_id, mutation.comment_id, is_admin)
    db.commit()
    return result


def _body(value: str) -> str:
    value = value.strip()
    if not value or len(value) > 2000:
        raise HTTPException(422, "Write between 1 and 2,000 characters")
    return value


def _name(value: str) -> str:
    value = value.strip()
    if not value:
        raise HTTPException(422, "Enter a public name")
    return value


def _version(actual: int, expected: int | None) -> None:
    if expected != actual:
        raise HTTPException(
            409, "This changed since you opened it. Reload and try again"
        )


def _queue_emails(
    db: Session, row: EditorialComment, request_key: uuid.UUID, event_kind: str
) -> None:
    recipient_ids = select(CommentArticleFollow.user_id).where(
        CommentArticleFollow.article_id == row.article_id,
        CommentArticleFollow.enabled.is_(True),
        CommentArticleFollow.user_id != row.author_id,
    )
    direct_recipient = None
    if event_kind == "new_reply":
        target = db.get(EditorialComment, row.reply_to_id)
        if (
            target
            and target.status == "live"
            and target.author_id
            and target.author_id != row.author_id
        ):
            profile = db.get(CommentProfile, target.author_id)
            if profile is None or profile.reply_emails:
                direct_recipient = target.author_id
                recipient_ids = recipient_ids.union(select(literal(target.author_id)))
    event_key = uuid.uuid5(
        uuid.NAMESPACE_URL, f"alethical-comment:{row.author_id}:{request_key}"
    )
    common = {
        "event_key": event_key,
        "actor_id": row.author_id,
        "article_id": row.article_id,
        "comment_id": row.id,
        "event_kind": event_kind,
    }
    db.add(
        CommentEmailDelivery(
            **common,
            recipient_key="admin:ask",
            is_admin=True,
            direct_reply=False,
            article_update=False,
        )
    )
    # Fanout stays in PostgreSQL: no unbounded recipient list in API memory,
    # one atomic insert rather than a Python object/write per follower.
    recipients = recipient_ids.subquery()
    followed = exists(
        select(CommentArticleFollow.user_id).where(
            CommentArticleFollow.user_id == recipients.c.user_id,
            CommentArticleFollow.article_id == row.article_id,
            CommentArticleFollow.enabled.is_(True),
        )
    )
    db.execute(
        insert(CommentEmailDelivery).from_select(
            [
                "id",
                "event_key",
                "recipient_key",
                "user_id",
                "is_admin",
                "actor_id",
                "article_id",
                "comment_id",
                "event_kind",
                "direct_reply",
                "article_update",
                "state",
                "next_attempt_at",
                "attempt_count",
                "created_at",
            ],
            select(
                func.gen_random_uuid(),
                literal(event_key),
                literal("user:") + cast(recipients.c.user_id, String),
                recipients.c.user_id,
                literal(False),
                literal(row.author_id),
                literal(row.article_id),
                literal(row.id),
                literal(event_kind),
                recipients.c.user_id == direct_recipient
                if direct_recipient
                else literal(False),
                followed,
                literal("pending"),
                func.clock_timestamp(),
                literal(0),
                func.clock_timestamp(),
            )
            .join(UserAccount, UserAccount.id == recipients.c.user_id)
            .where(UserAccount.is_active.is_(True)),
            include_defaults=False,
        )
    )


def create_comment(
    db: Session,
    user: UserAccount,
    article_id: str,
    payload: dict,
    is_admin: bool = False,
) -> dict:
    user, mutation, prior = _begin(db, user, article_id, payload, "create", is_admin)
    if prior is not None:
        return prior
    profile = _profile(db, user.id)
    if profile.public_name is None:
        _version(profile.version, payload.get("expected_profile_version"))
        profile.public_name = _name(payload.get("public_name") or "")
        profile.version += 1
    elif (
        payload.get("public_name") is not None
        and _name(payload["public_name"]) != profile.public_name
    ):
        raise HTTPException(409, "Your public name changed. Reload and try again")
    target_id = payload.get("reply_to_id")
    target = db.get(EditorialComment, uuid.UUID(str(target_id))) if target_id else None
    if target_id and (
        target is None or target.article_id != article_id or target.status != "live"
    ):
        raise HTTPException(
            404, "The comment you are replying to is no longer available"
        )
    row = EditorialComment(
        article_id=article_id,
        author_id=user.id,
        body=_body(payload["body"]),
        posted_at=db.scalar(select(func.clock_timestamp())),
        root_id=(target.root_id or target.id) if target else None,
        reply_to_id=target.id if target else None,
    )
    db.add(row)
    db.flush()
    _queue_emails(
        db, row, mutation.request_key, "new_reply" if target else "new_comment"
    )
    return _finish(db, user, article_id, mutation, row, is_admin)


def change_comment(
    db: Session,
    user: UserAccount,
    article_id: str,
    comment_id: uuid.UUID,
    payload: dict,
    action: str,
    is_admin: bool = False,
) -> dict:
    if action == "remove" and not is_admin:
        raise HTTPException(403, "Administrator access is required")
    user, mutation, prior = _begin(
        db, user, article_id, payload, f"{action}:{comment_id}", is_admin
    )
    if prior is not None:
        return prior
    row = db.get(EditorialComment, comment_id, populate_existing=True)
    if row is None or row.article_id != article_id:
        raise HTTPException(404, "Comment not found")
    if action != "remove" and row.author_id != user.id:
        raise HTTPException(403, "You can change only your own comments")
    if row.status != "live":
        if action == "edit":
            raise HTTPException(409, "This comment is no longer available")
        return _finish(db, user, article_id, mutation, row, is_admin)
    _version(row.version, payload["expected_version"])
    if action == "edit":
        new_body = _body(payload["body"])
        if new_body != row.body:
            row.body = new_body
            row.edited_at = datetime.now(timezone.utc)
            row.version += 1
            _queue_emails(
                db,
                row,
                mutation.request_key,
                "edit_reply" if row.root_id else "edit_comment",
            )
    else:
        row.status = "removed" if action == "remove" else "deleted"
        row.body = None
        row.edited_at = None
        row.version += 1
    return _finish(db, user, article_id, mutation, row, is_admin)


def save_name(
    db: Session, user: UserAccount, payload: dict, is_admin: bool = False
) -> dict:
    article_id = payload["article_id"]
    user, mutation, prior = _begin(db, user, article_id, payload, "name", is_admin)
    if prior is not None:
        return prior
    profile = _profile(db, user.id)
    _version(profile.version, payload["expected_version"])
    profile.public_name = _name(payload["public_name"])
    profile.version += 1
    return _finish(db, user, article_id, mutation, None, is_admin)


def save_preferences(
    db: Session, user: UserAccount, payload: dict, is_admin: bool = False
) -> dict:
    article_id = payload["article_id"]
    user, mutation, prior = _begin(
        db, user, article_id, payload, "preferences", is_admin
    )
    if prior is not None:
        return prior
    profile, follow = _profile(db, user.id), _follow(db, user.id, article_id)
    _version(profile.version, payload["expected_profile_version"])
    _version(follow.version, payload["expected_follow_version"])
    if "reply_emails" in payload:
        profile.reply_emails = payload["reply_emails"]
        profile.version += 1
    if "article_updates" in payload:
        follow.enabled = payload["article_updates"]
        follow.version += 1
    return _finish(db, user, article_id, mutation, None, is_admin)


def stop_choices(db: Session, token: str, choice: str | None = None) -> dict:
    digest = hashlib.sha256(token.encode()).hexdigest()
    row = db.get(CommentStopToken, digest)
    if row is None:
        raise HTTPException(404, "We couldn’t open your email choices")
    piece = article(row.article_id)
    # Inspection is read-only; stopping serializes with all preference writes.
    user = (
        _lock_account(db, row.user_id) if choice else db.get(UserAccount, row.user_id)
    )
    if user is None:
        raise HTTPException(404, "We couldn’t open your email choices")
    profile = db.get(CommentProfile, user.id, populate_existing=True)
    follow = db.get(
        CommentArticleFollow, (user.id, row.article_id), populate_existing=True
    )
    if choice == "replies":
        profile = _profile(db, user.id)
        profile.reply_emails = False
        profile.version += 1
    elif choice == "article":
        follow = _follow(db, user.id, row.article_id)
        follow.enabled = False
        follow.version += 1
    result = {
        "article_id": row.article_id,
        "article_title": piece["title"],
        "article_path": piece["path"],
        "link_choice": row.link_choice,
        "reply_emails": profile.reply_emails if profile else True,
        "article_updates": follow.enabled if follow else False,
    }
    if choice:
        db.commit()
    return result
