"""Keep public-record refresh deadlines and attempt outcomes across restarts."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0068_source_refresh"
down_revision = "0067_source_request_limits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "source_refresh_state",
        sa.Column("name", sa.Text(), primary_key=True),
        sa.Column("next_due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_started_at", sa.DateTime(timezone=True)),
        sa.Column("last_finished_at", sa.DateTime(timezone=True)),
        sa.Column("last_succeeded_at", sa.DateTime(timezone=True)),
        sa.Column("last_dispatched_at", sa.DateTime(timezone=True)),
        sa.Column("last_checked_at", sa.DateTime(timezone=True)),
        sa.Column("progress", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("finding", postgresql.JSONB()),
        sa.Column("last_status", sa.Text()),
        sa.Column("failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("token", postgresql.UUID(as_uuid=True)),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "source_refresh_attempt",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("exit_code", sa.Integer()),
        sa.Column("finding", postgresql.JSONB()),
    )
    op.create_index(
        "ix_source_refresh_attempt_name", "source_refresh_attempt", ["name"]
    )
    # Operational state is never available to anonymous Supabase browser roles.
    for table in ("source_refresh_state", "source_refresh_attempt"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("source_refresh_attempt")
    op.drop_table("source_refresh_state")
