"""Hold the email addresses Alethical lets into Alethical Finance.

The list lives only in the database because a client's address names the client
and this repository is public (docs/architecture/alethical-finance-architecture.md
§3). Entries are added and revoked with ``scripts/finance_access.py``.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0075_finance_access_list"
down_revision = "0074_source_refresh"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "finance_access_entry",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column(
            "is_alethical_team",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "granted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("email", name="uq_finance_access_entry_email"),
        sa.CheckConstraint(
            "email = lower(btrim(email)) AND email LIKE '_%@_%'",
            name="email_normalized",
        ),
        sa.CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= granted_at",
            name="revoked_after_granted",
        ),
    )
    # Client addresses are never readable through Supabase's browser roles.
    op.execute("ALTER TABLE finance_access_entry ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE finance_access_entry FROM PUBLIC")
    # These roles exist in Supabase, but not in the isolated test PostgreSQL.
    op.execute("""
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            REVOKE ALL ON TABLE finance_access_entry FROM anon;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            REVOKE ALL ON TABLE finance_access_entry FROM authenticated;
          END IF;
        END $$
    """)


def downgrade() -> None:
    op.drop_table("finance_access_entry")
