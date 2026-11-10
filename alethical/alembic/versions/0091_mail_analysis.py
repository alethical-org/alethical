"""Private durable mail analysis, without public grants or original changes."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = "0091_mail_analysis"
down_revision = "0090_mail_upload"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "mail_upload_analysis",
        sa.Column(
            "submission_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("mail_upload_submission.id"),
            primary_key=True,
        ),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("result", pg.JSONB(), nullable=False),
        sa.Column("creative_id", pg.UUID(as_uuid=True)),
        sa.Column(
            "confirmed_entity_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("identity_entity.id"),
        ),
        sa.Column("confirmation_evidence", sa.Text()),
        sa.CheckConstraint(
            "status IN ('pending','processing','ready','partial','failed')",
            name="mail_analysis_status",
        ),
        sa.CheckConstraint(
            "attempts >= 0 AND attempts <= 3", name="mail_analysis_attempts"
        ),
    )
    op.create_index(
        "ix_mail_upload_analysis_creative_id", "mail_upload_analysis", ["creative_id"]
    )
    op.execute("ALTER TABLE mail_upload_analysis ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON mail_upload_analysis FROM PUBLIC")
    op.execute("""DO $$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON mail_upload_analysis FROM anon; END IF;
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON mail_upload_analysis FROM authenticated; END IF;
    END $$""")


def downgrade():
    op.drop_table("mail_upload_analysis")
