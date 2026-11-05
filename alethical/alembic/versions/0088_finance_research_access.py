"""Add private operator-managed Finance research accounts and revocable sessions.

Only new tables are created. No existing user, access entry or record changes.
Undo by reverting application code, then downgrading; dropping these tables ends
research access and loses its password hashes and sessions, not source records.

Revision ID: 0088_finance_research_access
Revises: 0087_identity_name_summary
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0088_finance_research_access"
down_revision = "0087_identity_name_summary"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "finance_research_account",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.Text(), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column(
            "password_changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "email = lower(btrim(email)) AND email LIKE '_%@_%'",
            name="email_normalized",
        ),
    )
    op.create_table(
        "finance_research_session",
        sa.Column("token_digest", sa.String(64), primary_key=True),
        sa.Column(
            "account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("finance_research_account.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_finance_research_session_account_id",
        "finance_research_session",
        ["account_id"],
    )
    for table in ("finance_research_account", "finance_research_session"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON TABLE {table} FROM PUBLIC")
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                REVOKE ALL ON TABLE {table} FROM anon;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                REVOKE ALL ON TABLE {table} FROM authenticated;
            END IF;
        END $$""")


def downgrade() -> None:
    op.drop_table("finance_research_session")
    op.drop_table("finance_research_account")
