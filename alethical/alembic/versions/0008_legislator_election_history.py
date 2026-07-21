"""Add legislator_election_history table (issue #486).

Stores each member's scraped Legislative Service history — one row per chamber
tenure, ordered by period_sequence — so multi-chamber members (House → Senate)
are represented and the current-chamber term is carried alone. Purely additive:
a new table, no change to any existing table.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers, used by Alembic.
revision = "0008_legislator_election_history"
down_revision = "0007_denormalize_bill_signals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    # The 0001 baseline runs metadata.create_all, so on a fresh database this
    # table already exists (the model is in models.py) by the time this revision
    # runs; create it only where genuinely missing — an existing/production
    # database migrated before this revision (mirrors 0002/#100).
    if inspector.has_table("legislator_election_history"):
        return
    op.create_table(
        "legislator_election_history",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "legislator_id",
            UUID(as_uuid=True),
            sa.ForeignKey("legislator.id"),
            nullable=False,
        ),
        sa.Column(
            "chamber_id",
            UUID(as_uuid=True),
            sa.ForeignKey("chamber.id"),
            nullable=False,
        ),
        sa.Column("period_sequence", sa.Integer(), nullable=False),
        sa.Column("initial_year", sa.Integer(), nullable=False),
        sa.Column(
            "reelection_years",
            JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "is_current_chamber",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("term_number", sa.Integer()),
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
        sa.UniqueConstraint(
            "legislator_id",
            "period_sequence",
            name="uq_legislator_election_history_leg_seq",
        ),
    )
    op.create_index(
        "ix_legislator_election_history_legislator_id",
        "legislator_election_history",
        ["legislator_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("legislator_election_history"):
        return
    op.drop_index(
        "ix_legislator_election_history_legislator_id",
        table_name="legislator_election_history",
    )
    op.drop_table("legislator_election_history")
