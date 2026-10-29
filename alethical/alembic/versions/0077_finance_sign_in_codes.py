"""Hold Alethical Finance's emailed sign-in codes and their challenges, only as hashes.

Alethical sends its own codes, and only to an address on the access list, so
answering a request never reveals whether an address is a Finance client
(docs/architecture/alethical-finance-architecture.md §3). A code is never stored,
only its salted hash, with an expiry. Each code request's challenge is stored only
as a SHA-256, pointing at the code it proves, with its own count of wrong tries.
Rows stay for 2 days so the sending caps can count them.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0077_finance_sign_in_codes"
down_revision = "0076_identity_confirmations"
branch_labels = None
depends_on = None


_BROWSER_ROLES_REVOKE = """
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON TABLE {table} FROM anon;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON TABLE {table} FROM authenticated;
      END IF;
    END $$
"""


def upgrade() -> None:
    op.create_table(
        "finance_sign_in_code",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "email = lower(btrim(email)) AND email LIKE '_%@_%'",
            name="email_normalized",
        ),
        sa.CheckConstraint("expires_at > created_at", name="expires_after_created"),
    )
    op.create_index(
        "ix_finance_sign_in_code_email_created",
        "finance_sign_in_code",
        ["email", "created_at"],
    )
    op.create_table(
        "finance_sign_in_challenge",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "code_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("finance_sign_in_code.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("challenge_hash", sa.Text(), nullable=False),
        sa.Column("wrong_tries", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "challenge_hash", name="uq_finance_sign_in_challenge_challenge_hash"
        ),
        sa.CheckConstraint("wrong_tries >= 0", name="wrong_tries_counted"),
    )
    op.create_index(
        "ix_finance_sign_in_challenge_code_id",
        "finance_sign_in_challenge",
        ["code_id"],
    )
    for table in ("finance_sign_in_code", "finance_sign_in_challenge"):
        # Addresses and hashes are never readable through Supabase's browser roles.
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON TABLE {table} FROM PUBLIC")
        # These roles exist in Supabase, but not in the isolated test PostgreSQL.
        op.execute(_BROWSER_ROLES_REVOKE.format(table=table))


def downgrade() -> None:
    op.drop_table("finance_sign_in_challenge")
    op.drop_table("finance_sign_in_code")
