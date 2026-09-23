"""Keep a committee that left the Board's register, dated to when it was read."""

from alembic import op
import sqlalchemy as sa

revision = "0058_cf_filer_retention"
down_revision = "0057_lobbyist_donation_evidence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Both nullable and both additive: every existing row keeps reading as it did
    # (a NULL captured_at is its snapshot's fetch-completion time, a NULL
    # retained_from_snapshot_id is a filer the register listed in that run).
    op.add_column(
        "cf_filer",
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "cf_filer",
        sa.Column(
            "retained_from_snapshot_id",
            sa.UUID(),
            sa.ForeignKey(
                "cf_filing_snapshot.id",
                name="fk_cf_filer_retained_from_snapshot_id_cf_filing_snapshot",
                ondelete="SET NULL",
            ),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("cf_filer", "retained_from_snapshot_id")
    op.drop_column("cf_filer", "captured_at")
