"""Add committee_name to bill_action so referral actions can name the committee (#599)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
# Keep the revision id <= 32 chars — alembic_version.version_num is varchar(32).
revision = "0013_bill_action_committee"
down_revision = "0012_rag_hnsw_index"
branch_labels = None
depends_on = None

TABLE = "bill_action"
COLUMN = "committee_name"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    # Purely additive/nullable. On a fresh database the 0001 baseline's
    # metadata.create_all already builds this column (it's on the model), and
    # prod may carry out-of-band schema drift, so add it only where genuinely
    # missing (same coexistence guard as 0005/0010).
    existing = {col["name"] for col in inspector.get_columns(TABLE)}
    if COLUMN not in existing:
        op.add_column(TABLE, sa.Column(COLUMN, sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column(TABLE, COLUMN)
