"""Remember what the daily campaign-money refresh has already handled."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0062_cf_refresh_state"
down_revision = "0061_cf_filing_provenance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cf_refresh_state",
        sa.Column("key", sa.Text(), primary_key=True),
        sa.Column("value", postgresql.JSONB(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("cf_refresh_state")
