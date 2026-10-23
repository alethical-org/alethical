"""Bounded private search exports, separate from public application tables."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0071_private_search_measurements"
down_revision = "0070_tv_ad_records"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE SCHEMA search_measurement_private")
    op.execute("REVOKE ALL ON SCHEMA search_measurement_private FROM PUBLIC")
    op.create_table(
        "snapshot",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("view", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("raw_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=True),
        sa.Column("summary", postgresql.JSONB(), nullable=False),
        sa.CheckConstraint("provider IN ('google', 'bing')", name="provider_allowed"),
        sa.CheckConstraint(
            "view IN ('queries', 'pages', 'query-pages')", name="view_allowed"
        ),
        sa.CheckConstraint(
            "status IN ('success', 'unavailable')", name="status_allowed"
        ),
        schema="search_measurement_private",
    )
    op.create_index(
        "ix_search_snapshot_fetched_at",
        "snapshot",
        ["fetched_at"],
        schema="search_measurement_private",
    )
    op.execute(
        "ALTER TABLE search_measurement_private.snapshot ENABLE ROW LEVEL SECURITY"
    )
    op.execute("REVOKE ALL ON TABLE search_measurement_private.snapshot FROM PUBLIC")
    op.create_table(
        "maintenance",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("raw_cleared", sa.Integer(), nullable=False),
        sa.Column("summaries_removed", sa.Integer(), nullable=False),
        schema="search_measurement_private",
    )
    op.execute(
        "ALTER TABLE search_measurement_private.maintenance ENABLE ROW LEVEL SECURITY"
    )
    op.execute("REVOKE ALL ON TABLE search_measurement_private.maintenance FROM PUBLIC")
    # These roles exist in Supabase, but not in the isolated test PostgreSQL.
    op.execute("""
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          REVOKE ALL ON SCHEMA search_measurement_private FROM anon;
          REVOKE ALL ON TABLE search_measurement_private.snapshot FROM anon;
          REVOKE ALL ON TABLE search_measurement_private.maintenance FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          REVOKE ALL ON SCHEMA search_measurement_private FROM authenticated;
          REVOKE ALL ON TABLE search_measurement_private.snapshot FROM authenticated;
          REVOKE ALL ON TABLE search_measurement_private.maintenance FROM authenticated;
        END IF;
      END $$
    """)


def downgrade():
    # Only this feature's data is removed; export retained private data before rollback.
    op.drop_table("maintenance", schema="search_measurement_private")
    op.drop_table("snapshot", schema="search_measurement_private")
    op.execute("DROP SCHEMA search_measurement_private")
