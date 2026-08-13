"""Store a one-time signed-out Track action without storing its raw reference.

The row has no account link. It can only be attached to a signed-in account by
the completion request, which saves the tracked bill and deletes this row in one
transaction. The SHA-256 digest is the primary key so a leaked database cannot
replay the opaque reference sent to the browser.

Revision ID: 0036_pending_action
Revises: 0035_drop_legacy_auth_times
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0036_pending_action"
down_revision = "0035_drop_legacy_auth_times"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pending_action",
        sa.Column("reference_digest", sa.String(length=64), nullable=False),
        sa.Column("action_kind", sa.String(length=50), nullable=False),
        sa.Column("bill_id", sa.UUID(), nullable=False),
        sa.Column("return_path", sa.String(length=500), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "action_kind = 'track_bill'",
            name=op.f("ck_pending_action_pending_action_kind_track_bill"),
        ),
        sa.ForeignKeyConstraint(
            ["bill_id"], ["bill.id"], name=op.f("fk_pending_action_bill_id_bill")
        ),
        sa.PrimaryKeyConstraint("reference_digest", name=op.f("pk_pending_action")),
    )
    op.create_index(
        "ix_pending_action_expires_at",
        "pending_action",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_pending_action_expires_at", table_name="pending_action")
    op.drop_table("pending_action")
