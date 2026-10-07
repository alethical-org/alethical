"""Share the state's request limits between refresh workers."""

from alembic import op
import sqlalchemy as sa

revision = "0067_source_request_limits"
down_revision = "0066_candidate_lookup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "source_request_limits",
        sa.Column("host", sa.Text(), primary_key=True),
        sa.Column("next_request_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("blocked_until", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("source_request_limits")
