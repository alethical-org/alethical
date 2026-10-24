"""Share the state's request limits between refresh workers."""

from alembic import op
import sqlalchemy as sa

revision = "0073_source_request_limits"
down_revision = "0072_campaign_payment_manifest"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "source_request_limits",
        sa.Column("host", sa.Text(), primary_key=True),
        sa.Column("next_request_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("blocked_until", sa.DateTime(timezone=True), nullable=False),
    )
    op.execute("ALTER TABLE source_request_limits ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("source_request_limits")
