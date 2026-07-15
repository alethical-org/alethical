"""Enforce one current version per bill via a partial unique index (#285)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0003_bill_version_one_current_index"
down_revision = "0002_notification_event"
branch_labels = None
depends_on = None

INDEX_NAME = "uq_bill_version_one_current_per_bill"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    # The 0001 baseline builds every current model via metadata.create_all, so on a
    # fresh database this index already exists (it's on BillVersion.__table_args__)
    # by the time 0003 runs; create it only where it is genuinely missing (a
    # database migrated before this revision). Same coexistence dance as 0002 (#100).
    existing = {ix["name"] for ix in inspector.get_indexes("bill_version")}
    if INDEX_NAME in existing:
        return
    op.create_index(
        INDEX_NAME,
        "bill_version",
        ["bill_id"],
        unique=True,
        postgresql_where=sa.text("is_current"),
    )


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name="bill_version")
