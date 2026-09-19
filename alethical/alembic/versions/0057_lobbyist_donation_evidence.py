"""Keep reviewed donor proof separate from original campaign contribution rows."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0057_lobbyist_donation_evidence"
down_revision = "0056_cf_recipient_year_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lobbyist_donation_evidence",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "contributions_snapshot_id",
            sa.UUID(),
            sa.ForeignKey("cf_snapshot.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "filings_snapshot_id",
            sa.UUID(),
            sa.ForeignKey("cf_filing_snapshot.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_row_count", sa.BigInteger(), nullable=False),
        sa.Column("proof_version", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("evidence", postgresql.JSONB(), nullable=False),
        sa.Column("audit_object_key", sa.Text(), nullable=False),
        sa.Column("audit_compressed_hash", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_table(
        "lobbyist_donation_evidence_current",
        sa.Column("id", sa.Boolean(), primary_key=True),
        sa.Column(
            "evidence_id",
            sa.UUID(),
            sa.ForeignKey("lobbyist_donation_evidence.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("id = true", name="singleton"),
    )


def downgrade() -> None:
    op.drop_table("lobbyist_donation_evidence_current")
    op.drop_table("lobbyist_donation_evidence")
