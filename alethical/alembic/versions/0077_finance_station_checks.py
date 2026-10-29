"""Hold the checks Alethical Finance accounts make on original TV station files.

Each check is keyed by the exact original version it quotes (station, FCC file id,
content hash), never by an alethical.com public copy, so a copy's approval or
withdrawal never changes it (docs/architecture/alethical-finance-architecture.md §5).
Rows are append-only: a correction is a new row naming the one it replaces, and a
withdrawal sets its date and reason once. The trigger below refuses every other
change and every delete, whatever code path asks.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0077_finance_station_checks"
down_revision = "0076_identity_confirmations"
branch_labels = None
depends_on = None

TABLES = ("finance_tv_fact", "finance_tv_connection")


def _common():
    """The columns every Finance check carries: its exact version, its evidence,
    whether a team account made it, and its 1 withdrawal."""
    return [
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("facility_id", sa.String(20), nullable=False),
        sa.Column("file_id", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("page", sa.Integer(), nullable=False),
        sa.Column("quote", sa.Text(), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=False),
        sa.Column("made_by_alethical_team", sa.Boolean(), nullable=False),
        sa.Column(
            "checked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True)),
        sa.Column("withdrawal_reason", sa.Text()),
    ]


def _version_key():
    return sa.ForeignKeyConstraint(
        ["facility_id", "file_id", "content_hash"],
        [
            "fcc_document.facility_id",
            "fcc_document.file_id",
            "fcc_document.content_hash",
        ],
    )


def upgrade() -> None:
    op.create_table(
        "finance_tv_fact",
        *_common(),
        sa.Column("field", sa.String(40), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("organization_name", sa.Text()),
        sa.Column(
            "agency_address_reviewed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("qualifier", sa.Text()),
        sa.Column("role", sa.Text()),
        # 1 correction per check, so a corrected value has 1 successor.
        sa.Column(
            "supersedes_id",
            sa.UUID(),
            sa.ForeignKey("finance_tv_fact.id"),
            unique=True,
        ),
        _version_key(),
        sa.CheckConstraint("page > 0", name="finance_fact_page"),
        sa.CheckConstraint(
            "(withdrawn_at IS NULL) = (withdrawal_reason IS NULL)",
            name="finance_fact_withdrawal",
        ),
    )
    op.create_index(
        "ix_finance_tv_fact_version",
        "finance_tv_fact",
        ["facility_id", "file_id", "content_hash"],
    )
    op.create_table(
        "finance_tv_connection",
        *_common(),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("target_id", sa.Text(), nullable=False),
        sa.Column("target_snapshot", postgresql.JSONB(), nullable=False),
        _version_key(),
        sa.CheckConstraint("page > 0", name="finance_connection_page"),
        sa.CheckConstraint(
            "(withdrawn_at IS NULL) = (withdrawal_reason IS NULL)",
            name="finance_connection_withdrawal",
        ),
        sa.CheckConstraint(
            "kind IN ('committee','candidate','election','expense','principal',"
            "'related_document','issue')",
            name="finance_connection_kind",
        ),
    )
    op.create_index(
        "ix_finance_tv_connection_version",
        "finance_tv_connection",
        ["facility_id", "file_id", "content_hash"],
    )
    op.create_index(
        "ix_finance_tv_connection_target",
        "finance_tv_connection",
        ["kind", "target_id"],
    )
    # Append-only: the only change a row accepts is its 1 withdrawal, and no row
    # is deleted. TRUNCATE stays a schema owner's operation.
    op.execute("""
        CREATE FUNCTION public.finance_tv_check_append_only()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Finance station-file checks are never deleted';
          END IF;
          IF OLD.withdrawn_at IS NOT NULL
             OR NEW.withdrawn_at IS NULL
             OR NEW.withdrawal_reason IS NULL
             OR (to_jsonb(NEW) - 'withdrawn_at' - 'withdrawal_reason')
                IS DISTINCT FROM
                (to_jsonb(OLD) - 'withdrawn_at' - 'withdrawal_reason') THEN
            RAISE EXCEPTION
              'A Finance station-file check changes only by its 1 withdrawal';
          END IF;
          RETURN NEW;
        END $$;
        REVOKE ALL ON FUNCTION public.finance_tv_check_append_only() FROM PUBLIC;
    """)
    for table in TABLES:
        op.execute(f"""
            CREATE TRIGGER {table}_append_only
            BEFORE UPDATE OR DELETE ON public.{table}
            FOR EACH ROW EXECUTE FUNCTION public.finance_tv_check_append_only()
        """)
        # Never readable through Supabase's browser roles.
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON TABLE {table} FROM PUBLIC")
        # These roles exist in Supabase, but not in the isolated test PostgreSQL.
        op.execute(f"""
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                REVOKE ALL ON TABLE {table} FROM anon;
              END IF;
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                REVOKE ALL ON TABLE {table} FROM authenticated;
              END IF;
            END $$
        """)


def downgrade() -> None:
    op.drop_table("finance_tv_connection")
    op.drop_table("finance_tv_fact")
    op.execute("DROP FUNCTION public.finance_tv_check_append_only()")
