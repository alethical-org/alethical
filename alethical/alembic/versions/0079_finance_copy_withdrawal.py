"""Withdraw public-copy checks only inside Finance, leaving public records intact.

Each withdrawal is immutable, unique to its check and private to the API.
"""

from alembic import op
import sqlalchemy as sa

revision = "0079_finance_copy_withdrawal"
down_revision = "0078_finance_station_checks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "finance_tv_copy_withdrawal",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("fact_id", sa.UUID(), sa.ForeignKey("tv_ad_fact.id"), unique=True),
        sa.Column(
            "connection_id",
            sa.UUID(),
            sa.ForeignKey("tv_ad_connection.id"),
            unique=True,
        ),
        sa.Column(
            "withdrawn_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("withdrawal_reason", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "(fact_id IS NULL) != (connection_id IS NULL)",
            name="finance_copy_withdrawal_check",
        ),
    )
    op.execute("""
        CREATE FUNCTION public.finance_tv_copy_withdrawal_immutable()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'Finance copy-check withdrawals are immutable';
        END $$;
        REVOKE ALL ON FUNCTION public.finance_tv_copy_withdrawal_immutable() FROM PUBLIC;
        CREATE TRIGGER finance_tv_copy_withdrawal_immutable
        BEFORE UPDATE OR DELETE ON public.finance_tv_copy_withdrawal
        FOR EACH ROW EXECUTE FUNCTION public.finance_tv_copy_withdrawal_immutable();
        ALTER TABLE finance_tv_copy_withdrawal ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON TABLE finance_tv_copy_withdrawal FROM PUBLIC;
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            REVOKE ALL ON TABLE finance_tv_copy_withdrawal FROM anon;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            REVOKE ALL ON TABLE finance_tv_copy_withdrawal FROM authenticated;
          END IF;
        END $$;
    """)


def downgrade() -> None:
    op.drop_table("finance_tv_copy_withdrawal")
    op.execute("DROP FUNCTION public.finance_tv_copy_withdrawal_immutable()")
