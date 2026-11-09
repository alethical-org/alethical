"""Private political-mail upload invitations, sessions, images and submissions.

Revision ID: 0090_mail_upload
Revises: 0089_finance_research_access
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = "0090_mail_upload"
down_revision = "0089_finance_research_access"
branch_labels = None
depends_on = None
TABLES = (
    "mail_upload_quota",
    "mail_upload_invitation",
    "mail_upload_session",
    "mail_upload_submission",
    "mail_upload_image",
)


def upgrade():
    op.create_table(
        "mail_upload_quota",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reserved_bytes", sa.BigInteger(), nullable=False),
        sa.Column("storage_attempts", sa.Integer(), nullable=False),
    )
    op.execute("INSERT INTO mail_upload_quota VALUES (1, 0, 0)")
    op.create_table(
        "mail_upload_invitation",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("token_digest", sa.String(64), unique=True, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("max_sessions", sa.Integer(), nullable=False),
        sa.Column("max_bytes", sa.BigInteger(), nullable=False),
        sa.Column("reserved_bytes", sa.BigInteger(), nullable=False),
        sa.Column("storage_attempts", sa.Integer(), nullable=False),
    )
    op.create_table(
        "mail_upload_session",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "invitation_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("mail_upload_invitation.id"),
            nullable=False,
        ),
        sa.Column("client_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("client_secret_digest", sa.String(64), nullable=False),
        sa.Column("token_digest", sa.String(64), unique=True, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("invitation_id", "client_id"),
    )
    op.create_table(
        "mail_upload_submission",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("mail_upload_session.id"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("saved_at", sa.DateTime(timezone=True)),
        sa.Column("likes_ad", sa.Boolean()),
        sa.Column("comment", sa.Text()),
        sa.CheckConstraint(
            "comment IS NULL OR length(comment) <= 4000", name="comment_length"
        ),
        sa.CheckConstraint(
            "saved_at IS NULL OR likes_ad IS NOT NULL", name="saved_reaction"
        ),
    )
    op.create_index(
        "ix_mail_upload_submission_session_id", "mail_upload_submission", ["session_id"]
    )
    op.create_table(
        "mail_upload_image",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "submission_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("mail_upload_submission.id"),
            nullable=False,
        ),
        sa.Column("side", sa.String(5), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("byte_count", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(32), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False, unique=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("verified_at", sa.DateTime(timezone=True)),
        sa.Column("selected", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("submission_id", "side", "sha256"),
        sa.CheckConstraint("side IN ('front', 'back')", name="side"),
        sa.CheckConstraint(
            "byte_count > 0 AND byte_count <= 15728640", name="byte_limit"
        ),
        sa.CheckConstraint(
            "NOT selected OR verified_at IS NOT NULL", name="selected_verified"
        ),
    )
    op.create_index(
        "uq_mail_upload_selected_side",
        "mail_upload_image",
        ["submission_id", "side"],
        unique=True,
        postgresql_where=sa.text("selected"),
    )
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON TABLE {table} FROM PUBLIC")
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE {table} FROM anon; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE {table} FROM authenticated; END IF;
        END $$""")


def downgrade():
    for table in reversed(TABLES):
        op.drop_table(table)
