"""Date each retained committee-year to when it was read, and say where a
termination date came from."""

from alembic import op
import sqlalchemy as sa

revision = "0061_cf_filing_provenance"
down_revision = "0060_cf_notices_and_statements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # All nullable and additive: every existing row keeps reading as it did.
    op.add_column(
        "cf_filing",
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "cf_filing",
        sa.Column(
            "retained_from_snapshot_id",
            sa.UUID(),
            sa.ForeignKey(
                "cf_filing_snapshot.id",
                name="fk_cf_filing_retained_from_snapshot_id_cf_filing_snapshot",
                ondelete="SET NULL",
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "cf_filer",
        sa.Column("termination_source", sa.String(length=80), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cf_filer", "termination_source")
    op.drop_column("cf_filing", "retained_from_snapshot_id")
    op.drop_column("cf_filing", "captured_at")
