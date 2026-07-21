"""Add elected + term to legislator_service_period for the Legislator Profile (#484)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
# Keep the revision id <= 32 chars — alembic_version.version_num is varchar(32).
revision = "0005_legislator_elected_term"
down_revision = "0004_bill_session_introduced"
branch_labels = None
depends_on = None

TABLE = "legislator_service_period"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    # Purely additive/nullable. On a fresh database the 0001 baseline's
    # metadata.create_all already builds these columns (they're on the model),
    # and prod may carry out-of-band schema drift, so add each column only where
    # it's genuinely missing (same coexistence guard as 0003/0004).
    existing = {col["name"] for col in inspector.get_columns(TABLE)}
    if "elected" not in existing:
        op.add_column(TABLE, sa.Column("elected", sa.Text(), nullable=True))
    if "term" not in existing:
        op.add_column(TABLE, sa.Column("term", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column(TABLE, "term")
    op.drop_column(TABLE, "elected")
