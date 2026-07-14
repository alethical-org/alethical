"""Add notification_event table."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "0002_notification_event"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    # The 0001 baseline builds every current model via metadata.create_all, so on a
    # fresh database this table already exists by the time 0002 runs; create it only
    # where it is genuinely missing (a database migrated before this revision). This
    # coexistence dance goes away once the create_all baseline is replaced (#100).
    if inspector.has_table("notification_event"):
        return
    op.create_table(
        "notification_event",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("user_account.id"),
            nullable=False,
        ),
        sa.Column(
            "bill_id", UUID(as_uuid=True), sa.ForeignKey("bill.id"), nullable=False
        ),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("old_status_code", sa.String(length=50)),
        sa.Column("new_status_code", sa.String(length=50)),
        sa.Column("old_status", sa.String(length=200)),
        sa.Column("new_status", sa.String(length=200)),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_notification_event_user_unsent",
        "notification_event",
        ["user_id", "sent_at"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("notification_event"):
        return
    op.drop_index("ix_notification_event_user_unsent", table_name="notification_event")
    op.drop_table("notification_event")
