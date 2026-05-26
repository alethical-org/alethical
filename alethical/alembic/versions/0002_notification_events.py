"""Add notification events."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0002_notification_events"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("notification_event"):
        return

    event_status = postgresql.ENUM(
        "pending",
        "sent",
        "failed",
        "skipped",
        name="notification_event_status",
    )
    event_status.create(bind, checkfirst=True)

    op.create_table(
        "notification_event",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("bill_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "channel",
            postgresql.ENUM("email", "push", name="notification_channel", create_type=False),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("source_hash", sa.String(length=128), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(
                "pending",
                "sent",
                "failed",
                "skipped",
                name="notification_event_status",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["bill_id"], ["bill.id"], name=op.f("fk_notification_event_bill_id_bill")),
        sa.ForeignKeyConstraint(["user_id"], ["user_account.id"], name=op.f("fk_notification_event_user_id_user_account")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notification_event")),
        sa.UniqueConstraint("user_id", "bill_id", "event_type", "source_hash", name=op.f("uq_notification_event_user_id_bill_id_event_type_source_hash")),
    )
    op.create_index("ix_notification_event_status_channel", "notification_event", ["status", "channel"])
    op.create_index("ix_notification_event_user_created", "notification_event", ["user_id", "created_at"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("notification_event"):
        op.drop_index("ix_notification_event_user_created", table_name="notification_event")
        op.drop_index("ix_notification_event_status_channel", table_name="notification_event")
        op.drop_table("notification_event")
    postgresql.ENUM(name="notification_event_status").drop(op.get_bind(), checkfirst=True)
