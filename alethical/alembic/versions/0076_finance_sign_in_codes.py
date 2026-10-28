"""Hold Alethical Finance's emailed sign-in codes, only as salted hashes.

Alethical sends its own codes, and only to an address on the access list, so
answering a request never reveals whether an address is a Finance client
(docs/architecture/alethical-finance-architecture.md §3). A code is never stored,
only its hash, with an expiry and a count of wrong tries.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0076_finance_sign_in_codes"
down_revision = "0075_finance_access_list"
branch_labels = None
depends_on = None


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
        sa.Column("wrong_tries", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "email = lower(btrim(email)) AND email LIKE '_%@_%'",
            name="email_normalized",
        ),
        sa.CheckConstraint("expires_at > created_at", name="expires_after_created"),
        sa.CheckConstraint("wrong_tries >= 0", name="wrong_tries_counted"),
    )
    op.create_index(
        "ix_finance_sign_in_code_email_created",
        "finance_sign_in_code",
        ["email", "created_at"],
    )
    # Addresses and code hashes are never readable through Supabase's browser roles.
    op.execute("ALTER TABLE finance_sign_in_code ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE finance_sign_in_code FROM PUBLIC")
    # These roles exist in Supabase, but not in the isolated test PostgreSQL.
    op.execute("""
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            REVOKE ALL ON TABLE finance_sign_in_code FROM anon;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            REVOKE ALL ON TABLE finance_sign_in_code FROM authenticated;
          END IF;
        END $$
    """)


def downgrade() -> None:
    op.drop_table("finance_sign_in_code")
