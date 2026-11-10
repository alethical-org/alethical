"""File reuse changes references, never existing originals or private access."""

import os
from pathlib import Path
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from alethical.db.models import (
    MailUploadImage,
    MailUploadInvitation,
    MailUploadSession,
    MailUploadSubmission,
)
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]


def test_file_reuse_migration_preserves_legacy_rows_and_refuses_destructive_downgrade():
    with ScratchDatabase(_local_base_url(), "mail_file_reuse") as scratch:
        engine = scratch.engine()
        try:

            def migrate(direction, revision, *, succeeds=True):
                result = subprocess.run(
                    [
                        sys.executable,
                        "-m",
                        "alembic",
                        "-c",
                        "alembic.ini",
                        direction,
                        revision,
                    ],
                    cwd=ROOT,
                    env={
                        **os.environ,
                        "DATABASE_URL": scratch.url.render_as_string(
                            hide_password=False
                        ),
                        "ALETHICAL_DATABASE_TARGET": "local",
                    },
                    capture_output=True,
                    text=True,
                    check=False,
                )
                assert (result.returncode == 0) is succeeds, (
                    result.stdout + result.stderr
                )

            migrate("upgrade", "0091_mail_analysis")
            # Real old-schema data includes separately stored duplicate originals.
            with Session(engine) as db:
                invite = MailUploadInvitation(
                    token_digest="a" * 64,
                    expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                )
                db.add(invite)
                db.flush()
                session = MailUploadSession(
                    invitation_id=invite.id,
                    client_id=uuid.uuid4(),
                    client_secret_digest="b" * 64,
                    token_digest="c" * 64,
                    expires_at=invite.expires_at,
                )
                db.add(session)
                db.flush()
                row = MailUploadSubmission(id=uuid.uuid4(), session_id=session.id)
                db.add(row)
                db.flush()
                for side in ("front", "back"):
                    # Use actual 0091 columns, not today's ORM defaults.
                    db.execute(
                        text(
                            "INSERT INTO mail_upload_image "
                            "(id, submission_id, side, sha256, byte_count, content_type, "
                            "width, height, object_key, verified_at, selected) "
                            "VALUES (:id, :submission, :side, :sha, 100, 'image/png', "
                            "32, 24, :key, now(), true)"
                        ),
                        {
                            "id": uuid.uuid4(),
                            "submission": row.id,
                            "side": side,
                            "sha": "d" * 64,
                            "key": f"originals/legacy/{side}",
                        },
                    )
                session_id = session.id
                db.commit()

            def snapshot():
                with engine.connect() as db:
                    return db.execute(
                        text(
                            "SELECT id, submission_id, side, sha256, byte_count, content_type, "
                            "width, height, object_key, created_at, verified_at, selected "
                            "FROM mail_upload_image ORDER BY id"
                        )
                    ).all()

            before = snapshot()
            migrate("upgrade", "0092_mail_file_reuse")
            assert snapshot() == before
            with engine.connect() as db:
                assert (
                    db.scalar(
                        text(
                            "SELECT bool_and(verification_generation = 0) FROM mail_upload_image"
                        )
                    )
                    is True
                )
            assert "uq_mail_upload_image_object_key" not in {
                item["name"]
                for item in inspect(engine).get_unique_constraints("mail_upload_image")
            }
            assert "ix_mail_upload_image_sha256" in {
                item["name"]
                for item in inspect(engine).get_indexes("mail_upload_image")
            }
            migrate("downgrade", "0091_mail_analysis")
            assert snapshot() == before
            assert "verification_generation" not in {
                item["name"]
                for item in inspect(engine).get_columns("mail_upload_image")
            }
            assert "uq_mail_upload_image_object_key" in {
                item["name"]
                for item in inspect(engine).get_unique_constraints("mail_upload_image")
            }
            migrate("upgrade", "0092_mail_file_reuse")
            with Session(engine) as db:
                old = db.scalar(
                    select(MailUploadImage).where(MailUploadImage.side == "front")
                )
                fresh = MailUploadSubmission(id=uuid.uuid4(), session_id=session_id)
                db.add(fresh)
                db.flush()
                # A new pending reference shares bytes but cannot become selected
                # until both objects have been verified by the upload service.
                db.add(
                    MailUploadImage(
                        submission_id=fresh.id,
                        side="front",
                        sha256=old.sha256,
                        byte_count=old.byte_count,
                        content_type=old.content_type,
                        width=old.width,
                        height=old.height,
                        object_key=old.object_key,
                    )
                )
                db.commit()
            shared = snapshot()
            migrate("downgrade", "0091_mail_analysis", succeeds=False)
            assert snapshot() == shared
            with engine.connect() as db:
                assert (
                    db.scalar(text("SELECT version_num FROM alembic_version"))
                    == "0092_mail_file_reuse"
                )
                assert (
                    db.scalar(
                        text(
                            "SELECT relrowsecurity FROM pg_class WHERE relname='mail_upload_image'"
                        )
                    )
                    is True
                )
                assert not db.scalar(
                    text(
                        "SELECT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='mail_upload_image')"
                    )
                )
        finally:
            engine.dispose()
