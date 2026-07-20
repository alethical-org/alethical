"""Index bill(session_id, introduced_at, file_number) for the introduced sort (#364)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
# Keep the revision id <= 32 chars — alembic_version.version_num is varchar(32).
revision = "0004_bill_session_introduced"
down_revision = "0003_one_current_per_bill"
branch_labels = None
depends_on = None

INDEX_NAME = "ix_bill_session_introduced"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    # On a fresh database the 0001 baseline's metadata.create_all already builds
    # this index (it's on Bill.__table_args__), so create it only where genuinely
    # missing — a database migrated before this revision. Same coexistence guard
    # as 0003 (#285).
    existing = {ix["name"] for ix in inspector.get_indexes("bill")}
    if INDEX_NAME in existing:
        return
    op.create_index(
        INDEX_NAME,
        "bill",
        [
            "session_id",
            sa.text("introduced_at DESC NULLS LAST"),
            sa.text("file_number DESC"),
        ],
    )


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name="bill")
