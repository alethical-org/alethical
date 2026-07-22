"""Add represented_city to legislator_service_period for the Bill Profile author card (#551)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
# Keep the revision id <= 32 chars — alembic_version.version_num is varchar(32).
revision = "0010_legislator_repr_city"
down_revision = "0009_merge_0008_heads"
branch_labels = None
depends_on = None

TABLE = "legislator_service_period"
COLUMN = "represented_city"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    # Purely additive/nullable. On a fresh database the 0001 baseline's
    # metadata.create_all already builds this column (it's on the model), and
    # prod may carry out-of-band schema drift, so add it only where genuinely
    # missing (same coexistence guard as 0005).
    existing = {col["name"] for col in inspector.get_columns(TABLE)}
    if COLUMN not in existing:
        op.add_column(TABLE, sa.Column(COLUMN, sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column(TABLE, COLUMN)
