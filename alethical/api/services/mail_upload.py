"""Restricted mail upload: no account, no public originals, no political inference."""

from __future__ import annotations

import hashlib
import hmac
import io
import os
import secrets
import tempfile
import uuid
import warnings
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from PIL import Image, UnidentifiedImageError
from pillow_heif import register_heif_opener
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from alethical.api.problems import problem_exception
from alethical.db.models import (
    MailUploadImage as ImageRow,
    MailUploadInvitation as Invitation,
    MailUploadQuota as Quota,
    MailUploadSession as UploadSession,
    MailUploadSubmission as Submission,
)
from alethical.pipeline.raw_file_store import (
    RawFileStore,
    REQUIRED_ENV,
    StorageIntegrityError,
)

MAX_IMAGE_BYTES = 15 * 1024 * 1024
# 50 MP camera output can be 8192 x 6144 (50,331,648 pixels).
MAX_PIXELS = 51_000_000
GLOBAL_BYTE_LIMIT = 2 * 1024 * 1024 * 1024
GLOBAL_ATTEMPT_LIMIT = 2000
INVITATION_ATTEMPT_LIMIT = 400
MAX_SUBMISSIONS_PER_SESSION = 25
CONTENT_TYPES = ("image/jpeg", "image/png", "image/webp", "image/heic", "image/heif")
# Reuse the existing quota and revocation record for sessions from the plain URL.
# This ID is reserved for the service and never sent to a browser.
OPEN_POOL_ID = uuid.UUID("b37da61e-8ec5-4d42-bec3-8a24dc9b3159")
OPEN_SESSION_LIMIT = 1000
register_heif_opener(thumbnails=False)


def now():
    return datetime.now(timezone.utc)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def fail(status: int, detail: str, slug: str = "mail-upload-unavailable"):
    return problem_exception(status, "Mail upload", detail, type_slug=slug)


def enabled():
    if os.getenv("ALETHICAL_MAIL_UPLOAD_ENABLED", "").lower() != "true":
        raise fail(503, "Mail upload is unavailable")


@lru_cache(maxsize=1)
def stores() -> tuple[RawFileStore, RawFileStore]:
    """Separate buckets and mirror credentials; never use the public source archive."""
    import boto3
    from botocore.config import Config

    bucket = os.getenv("MAIL_UPLOAD_SUPABASE_BUCKET", "")
    mirror_bucket = os.getenv("MAIL_UPLOAD_R2_BUCKET", "")
    required = (
        "MAIL_UPLOAD_R2_ENDPOINT",
        "MAIL_UPLOAD_R2_ACCESS_KEY_ID",
        "MAIL_UPLOAD_R2_SECRET_ACCESS_KEY",
    )
    if (
        not bucket
        or bucket == "raw-source-files"
        or not mirror_bucket
        or mirror_bucket == os.getenv("CLOUDFLARE_R2_BUCKET")
        or not all(os.getenv(k) for k in required)
    ):
        raise RuntimeError("Private mail storage is not configured")
    if not all(os.getenv(name) for name in REQUIRED_ENV):
        raise RuntimeError("Private mail storage is not configured")
    primary = RawFileStore(
        boto3.client(
            "s3",
            endpoint_url=os.environ["SUPABASE_STORAGE_S3_ENDPOINT"],
            region_name=os.environ["SUPABASE_STORAGE_S3_REGION"],
            aws_access_key_id=os.environ["SUPABASE_STORAGE_S3_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY"],
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                connect_timeout=5,
                read_timeout=20,
                retries={"max_attempts": 2},
            ),
        ),
        bucket,
    )
    mirror = RawFileStore(
        boto3.client(
            "s3",
            endpoint_url=os.environ[required[0]],
            region_name="auto",
            aws_access_key_id=os.environ[required[1]],
            aws_secret_access_key=os.environ[required[2]],
            config=Config(
                signature_version="s3v4",
                connect_timeout=5,
                read_timeout=20,
                retries={"max_attempts": 2},
            ),
        ),
        mirror_bucket,
    )
    return primary, mirror


def create_invitation(
    db: Session, *, days: int = 7, max_sessions: int = 20, max_bytes: int = 536870912
):
    token = secrets.token_urlsafe(32)
    row = Invitation(
        token_digest=digest(token),
        expires_at=now() + timedelta(days=days),
        max_sessions=max_sessions,
        max_bytes=max_bytes,
    )
    db.add(row)
    db.commit()
    return row, token


def exchange(
    db: Session, invitation_token: str | None, client_id: uuid.UUID, client_secret: str
):
    enabled()
    if invitation_token is None:
        if db.get(Invitation, OPEN_POOL_ID) is None:
            db.execute(
                insert(Invitation)
                .values(
                    id=OPEN_POOL_ID,
                    token_digest=secrets.token_hex(32),
                    expires_at=datetime(9999, 1, 1, tzinfo=timezone.utc),
                    max_sessions=OPEN_SESSION_LIMIT,
                    max_bytes=536870912,
                )
                .on_conflict_do_nothing(index_elements=[Invitation.id])
            )
        scope = Invitation.id == OPEN_POOL_ID
        # The browser secret alone is sufficient for this tab's retry. The
        # domain label separates these tokens from the legacy invite exchange.
        key = bytes.fromhex(client_secret)
        message = f"mail-upload:open:{client_id}".encode()
    else:
        scope = Invitation.token_digest == digest(invitation_token)
        key = invitation_token.encode()
        message = f"{client_id}:{client_secret}".encode()
    row = db.scalar(select(Invitation).where(scope).with_for_update())
    if row is None or row.revoked_at is not None or row.expires_at <= now():
        raise fail(
            401, "This demo session is no longer available", "mail-upload-access"
        )
    session = db.scalar(
        select(UploadSession).where(
            UploadSession.invitation_id == row.id, UploadSession.client_id == client_id
        )
    )
    secret_digest = digest(client_secret)
    token = hmac.new(key, message, hashlib.sha256).hexdigest()
    if session is not None:
        if (
            not hmac.compare_digest(session.client_secret_digest, secret_digest)
            or session.expires_at <= now()
        ):
            raise fail(
                401, "This demo session is no longer available", "mail-upload-access"
            )
    else:
        count = (
            db.scalar(
                select(func.count())
                .select_from(UploadSession)
                .where(UploadSession.invitation_id == row.id)
            )
            or 0
        )
        if count >= row.max_sessions:
            raise fail(
                429, "This demo has reached its session limit", "mail-upload-limit"
            )
        session = UploadSession(
            invitation_id=row.id,
            client_id=client_id,
            client_secret_digest=secret_digest,
            token_digest=digest(token),
            expires_at=min(row.expires_at, now() + timedelta(hours=24)),
        )
        db.add(session)
    db.commit()
    return {
        "data": {
            "token": token,
            "expires_at": session.expires_at.isoformat(),
            "supported_content_types": list(CONTENT_TYPES),
            "max_image_bytes": MAX_IMAGE_BYTES,
        }
    }


def authorize(db: Session, token: str) -> UploadSession:
    enabled()
    session = db.scalar(
        select(UploadSession)
        .join(Invitation)
        .where(
            UploadSession.token_digest == digest(token),
            UploadSession.expires_at > now(),
            Invitation.expires_at > now(),
            Invitation.revoked_at.is_(None),
        )
    )
    if session is None:
        raise fail(
            401, "This demo session is no longer available", "mail-upload-access"
        )
    return session


def owned(db: Session, session: UploadSession, submission_id: uuid.UUID, *, lock=False):
    query = select(Submission).where(
        Submission.id == submission_id, Submission.session_id == session.id
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    row = db.scalar(query)
    if row is None:
        raise fail(404, "Submission not found", "mail-upload-not-found")
    return row


def selected_images(db: Session, row: Submission):
    return {
        image.side: image
        for image in db.scalars(
            select(ImageRow).where(
                ImageRow.submission_id == row.id, ImageRow.selected.is_(True)
            )
        )
    }


def response(db: Session, row: Submission):
    images = selected_images(db, row)

    def side(name):
        image = images.get(name)
        return (
            None
            if image is None
            else {
                "sha256": image.sha256,
                "content_type": image.content_type,
                "bytes": image.byte_count,
            }
        )

    return {
        "data": {
            "id": str(row.id),
            "status": "saved" if row.saved_at else "draft",
            "front": side("front"),
            "back": side("back"),
            "likes_ad": row.likes_ad,
            "comment": row.comment,
        }
    }


def create_submission(db: Session, session: UploadSession, submission_id: uuid.UUID):
    # Serialize per-tab creation; a retry keeps the existing row and count.
    db.execute(
        select(UploadSession.id).where(UploadSession.id == session.id).with_for_update()
    )
    existing = db.get(Submission, submission_id)
    if existing is not None:
        if existing.session_id != session.id:
            raise fail(404, "Submission not found", "mail-upload-not-found")
        return response(db, existing)
    count = (
        db.scalar(
            select(func.count())
            .select_from(Submission)
            .where(Submission.session_id == session.id)
        )
        or 0
    )
    if count >= MAX_SUBMISSIONS_PER_SESSION:
        raise fail(429, "This demo session has reached its limit", "mail-upload-limit")
    row = Submission(id=submission_id, session_id=session.id)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise fail(404, "Submission not found", "mail-upload-not-found") from None
    return response(db, row)


def validate_image(body: bytes, declared: str):
    if len(body) > MAX_IMAGE_BYTES:
        raise fail(413, "Choose a photo smaller than 15 MB", "mail-upload-image-size")
    if not body or declared not in (*CONTENT_TYPES, "application/octet-stream"):
        raise fail(422, "Choose a JPEG, PNG, WebP or HEIC photo", "mail-upload-image")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(
                io.BytesIO(body), formats=["JPEG", "PNG", "WEBP", "HEIF"]
            ) as image:
                width, height = image.size
                if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
                    raise ValueError("Image dimensions")
                fmt = image.format
                image.load()  # Reject truncated data; header/MIME checks alone are insufficient.
                if fmt != "HEIF" and getattr(image, "n_frames", 1) != 1:
                    raise ValueError("Animated image")
        mime = {
            "JPEG": "image/jpeg",
            "PNG": "image/png",
            "WEBP": "image/webp",
            "HEIF": "image/heic",
        }[fmt]
        if declared not in (mime, "application/octet-stream") and not (
            mime == "image/heic" and declared == "image/heif"
        ):
            raise ValueError("MIME mismatch")
    except (
        ValueError,
        OSError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        KeyError,
    ):
        raise fail(422, "We couldn’t open this photo", "mail-upload-image") from None
    return mime, width, height


def invalidate_corrupt_draft_references(db: Session, key: str):
    """Withdraw proven-bad receipts without changing files or saved history."""
    # submit() locks this same row. Ordered locks avoid deadlocks when two
    # corrupt originals belong to the same drafts. A concurrent save that already
    # won its lock remains historical; no saved submission is rewritten here.
    draft_ids = list(
        db.scalars(
            select(Submission.id)
            .where(
                Submission.saved_at.is_(None),
                select(ImageRow.id)
                .where(
                    ImageRow.submission_id == Submission.id,
                    ImageRow.object_key == key,
                )
                .exists(),
            )
            .order_by(Submission.id)
            .with_for_update()
        )
    )
    if draft_ids:
        db.execute(
            update(ImageRow)
            .where(ImageRow.submission_id.in_(draft_ids), ImageRow.object_key == key)
            .values(
                selected=False,
                verified_at=None,
                verification_generation=ImageRow.verification_generation + 1,
            )
        )
    db.commit()


def save_image(
    db: Session,
    token: str,
    submission_id: uuid.UUID,
    side: str,
    body: bytes,
    declared: str,
):
    mime, width, height = validate_image(body, declared)
    sha = hashlib.sha256(body).hexdigest()
    session = authorize(db, token)
    # One lock order across writers: global quota, invitation, submission.
    quota = db.scalar(select(Quota).where(Quota.id == 1).with_for_update())
    invite = db.scalar(
        select(Invitation)
        .where(Invitation.id == session.invitation_id)
        .with_for_update()
    )
    row = owned(db, session, submission_id, lock=True)
    if row.saved_at:
        raise fail(409, "This submission is already saved", "mail-upload-saved")
    if invite.revoked_at is not None or invite.expires_at <= now():
        raise fail(401, "This demo link is no longer available", "mail-upload-access")
    image = db.scalar(
        select(ImageRow).where(
            ImageRow.submission_id == row.id,
            ImageRow.side == side,
            ImageRow.sha256 == sha,
        )
    )
    if quota is None:
        raise fail(503, "Mail upload is unavailable")
    if (
        quota.storage_attempts >= GLOBAL_ATTEMPT_LIMIT
        or invite.storage_attempts >= INVITATION_ATTEMPT_LIMIT
    ):
        raise fail(429, "The demo upload limit has been reached", "mail-upload-limit")
    if image is None:
        # Logical reservations deliberately ignore reuse. Discounting a shared
        # file would let capacity responses reveal somebody else's private upload,
        # including through the shared plain-URL invitation. Retries reuse their
        # own reference and reservation; every fresh side reserves its full bytes.
        if (
            quota.reserved_bytes + len(body) > GLOBAL_BYTE_LIMIT
            or invite.reserved_bytes + len(body) > invite.max_bytes
        ):
            raise fail(
                429, "The demo storage limit has been reached", "mail-upload-limit"
            )
        # The global quota lock serializes allocation across API replicas. Commit
        # this reference before I/O so concurrent/retried requests share even a
        # partially written original. Legacy duplicate keys remain untouched;
        # fresh references consistently choose the oldest retained original.
        original = db.scalar(
            select(ImageRow)
            .where(ImageRow.sha256 == sha)
            .order_by(ImageRow.created_at, ImageRow.id)
            .limit(1)
        )
        if original is not None and (
            original.byte_count != len(body)
            or original.content_type != mime
            or original.width != width
            or original.height != height
        ):
            raise fail(
                503, "We couldn’t save this photo. Try again", "mail-upload-storage"
            )
        image_id = uuid.uuid4()
        image = ImageRow(
            id=image_id,
            submission_id=row.id,
            side=side,
            sha256=sha,
            byte_count=len(body),
            content_type=mime,
            width=width,
            height=height,
            object_key=(
                original.object_key
                if original is not None
                else f"originals/{row.id}/{image_id}"
            ),
        )
        db.add(image)
        quota.reserved_bytes += len(body)
        invite.reserved_bytes += len(body)
    quota.storage_attempts += 1
    invite.storage_attempts += 1
    db.commit()  # Durable pending object and quotas; no DB connection during remote I/O.
    image_id, key, generation = (
        image.id,
        image.object_key,
        image.verification_generation,
    )
    db.commit()
    try:
        primary, mirror = stores()
        with tempfile.NamedTemporaryFile() as handle:
            handle.write(body)
            handle.flush()
            # Each store has its own client/file handle. Keep the source and the
            # image gate alive until both bounded storage operations finish,
            # including when either one fails. Selection still requires both.
            # Always read back both copies, including reuse and selected retries.
            # Missing copies are repaired from the exact incoming bytes; corrupt
            # existing copies fail closed in put_and_verify, never overwritten.
            with ThreadPoolExecutor(max_workers=2) as copies:
                verified = [
                    copies.submit(store.put_and_verify, key, handle.name, sha)
                    for store in (primary, mirror)
                ]
                errors = [copied.exception() for copied in verified]
                # Inspect both outcomes: a temporary failure in one store must
                # not hide a proven hash mismatch reported by the other store.
                for error in errors:
                    if isinstance(error, StorageIntegrityError):
                        raise error
                for error in errors:
                    if error is not None:
                        raise error
    except StorageIntegrityError:
        invalidate_corrupt_draft_references(db, key)
        raise fail(
            503, "We couldn’t save this photo. Try again", "mail-upload-storage"
        ) from None
    except Exception:
        # Private keys/provider errors never enter logs or response bodies.
        raise fail(
            503, "We couldn’t save this photo. Try again", "mail-upload-storage"
        ) from None
    session = authorize(db, token)  # Revocation/expiry can happen during remote I/O.
    row = owned(db, session, submission_id, lock=True)
    if row.saved_at:
        raise fail(409, "This submission is already saved", "mail-upload-saved")
    image = db.get(ImageRow, image_id, populate_existing=True)
    if image.verification_generation != generation:
        # Another worker proved these bytes corrupt after this attempt started.
        # Its withdrawal wins even if our earlier read-back had already passed.
        raise fail(503, "We couldn’t save this photo. Try again", "mail-upload-storage")
    db.execute(
        update(ImageRow)
        .where(
            ImageRow.submission_id == row.id,
            ImageRow.side == side,
            ImageRow.selected.is_(True),
        )
        .values(selected=False)
    )
    image.verified_at = now()
    image.selected = True
    db.commit()
    return response(db, row)


def submit(
    db: Session,
    session: UploadSession,
    submission_id: uuid.UUID,
    likes_ad: bool,
    comment: str | None,
):
    row = owned(db, session, submission_id, lock=True)
    comment = comment.strip() or None if comment else None
    if row.saved_at:
        if row.likes_ad != likes_ad or row.comment != comment:
            raise fail(409, "This submission is already saved", "mail-upload-saved")
        return response(db, row)
    if set(selected_images(db, row)) != {"front", "back"}:
        raise fail(
            422, "Add both photos before submitting", "mail-upload-missing-images"
        )
    row.likes_ad, row.comment, row.saved_at = likes_ad, comment, now()
    db.commit()
    return response(db, row)
