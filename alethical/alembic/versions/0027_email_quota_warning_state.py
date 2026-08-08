"""Remember which free email-capacity warnings have already been sent.

Revision ID: 0027_email_quota_warning_state
Revises: 0026_ask_suggested_answer_cache
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0027_email_quota_warning_state"
down_revision = "0026_ask_suggested_answer_cache"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_quota_warning_state",
        sa.Column("scope", sa.String(length=10), nullable=False),
        sa.Column("threshold", sa.SmallInteger(), nullable=False),
        sa.Column("is_above", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("scope", "threshold"),
    )


def downgrade() -> None:
    op.drop_table("email_quota_warning_state")
