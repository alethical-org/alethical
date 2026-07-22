"""Add rum_latency_event table for real-user read-surface monitoring (#516).

Additive and reversible: one new append-only table + one index, both dropped
cleanly on downgrade. No changes to existing tables. The table stores timing +
coarse dimensions only (no PII, no IP, no precise location, no user id) — the
privacy posture is documented on the ``RumLatencyEvent`` model and in
docs/rum-read-surface-monitoring.md.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "0010_rum_latency_event"
down_revision = "0009_merge_0008_heads"
branch_labels = None
depends_on = None

INDEX_NAME = "ix_rum_latency_event_interaction_created"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    # The 0001 baseline builds every current model via metadata.create_all, so on
    # a fresh database this table already exists by the time 0010 runs; create it
    # only where genuinely missing (a database migrated before this revision).
    # Same coexistence guard as 0002/0007.
    if inspector.has_table("rum_latency_event"):
        return
    op.create_table(
        "rum_latency_event",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("interaction", sa.String(length=32), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("ttfb_ms", sa.Integer(), nullable=True),
        sa.Column("cache_status", sa.String(length=16), nullable=False),
        sa.Column("device_class", sa.String(length=16), nullable=False),
        sa.Column("cold", sa.Boolean(), nullable=False),
        sa.Column("coarse_geo", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        INDEX_NAME,
        "rum_latency_event",
        ["interaction", "created_at"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("rum_latency_event"):
        return
    op.drop_index(INDEX_NAME, table_name="rum_latency_event")
    op.drop_table("rum_latency_event")
