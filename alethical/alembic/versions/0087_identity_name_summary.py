"""Add up the Confirm identities queue's per-name totals once per saved payment file.

Grouping every live payment row by printed name on each queue request took 2.0 to
8.3 seconds on production (4 Nov 2026). ``cf_identity_name_summary`` holds 1 row
per exact printed name, kind and saved file, written inside the publish
transaction; ``cf_identity_name_summary_build`` marks each (file, kind) build
complete in the same transaction, so a complete build with no names differs from
an absent one. Both tables are new and empty, so their indexes build at once and
no existing table is locked. No source row changes. To undo: empty both tables
(every read then groups the raw rows), revert the code, then downgrade; the code
that reads the tables fails if they are dropped first.

Revision ID: 0087_identity_name_summary
Revises: 0086_fcc_observation_file_reads
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0087_identity_name_summary"
down_revision = "0086_fcc_observation_file_reads"
branch_labels = None
depends_on = None

TABLE = "cf_identity_name_summary"
BUILD = "cf_identity_name_summary_build"
ORDER_INDEX = "ix_cf_identity_name_summary_order"
KIND_INDEX = "ix_cf_identity_name_summary_snapshot_kind"
NAME_INDEX = "ix_cf_identity_name_summary_name_trgm"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "snapshot_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cf_snapshot.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("record_kind", sa.String(40), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("records", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric()),
        sa.Column("missing_amounts", sa.Integer(), nullable=False),
        sa.Column("undated_records", sa.Integer(), nullable=False),
        sa.Column("dated_records", sa.Integer(), nullable=False),
        sa.Column("yeared_records", sa.Integer(), nullable=False),
        sa.Column("first_year", sa.Integer()),
        sa.Column("last_year", sa.Integer()),
        sa.Column("first_date", sa.Date()),
        sa.Column("last_date", sa.Date()),
        sa.Column(
            "sort_amount",
            sa.Numeric(),
            sa.Computed(
                "CASE WHEN missing_amounts = 0 AND "
                "(dated_records = records OR yeared_records = records) THEN amount END",
                persisted=True,
            ),
        ),
    )
    op.create_index(
        ORDER_INDEX,
        TABLE,
        [sa.text("sort_amount DESC NULLS LAST"), "name", "record_kind"],
    )
    op.create_index(KIND_INDEX, TABLE, ["snapshot_id", "record_kind"])
    op.create_index(
        NAME_INDEX,
        TABLE,
        ["name"],
        postgresql_using="gin",
        postgresql_ops={"name": "gin_trgm_ops"},
    )
    op.create_table(
        BUILD,
        sa.Column(
            "snapshot_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cf_snapshot.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("record_kind", sa.String(40), primary_key=True),
        sa.Column("revision", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column(
            "built_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table(BUILD)
    op.drop_index(NAME_INDEX, table_name=TABLE)
    op.drop_index(KIND_INDEX, table_name=TABLE)
    op.drop_index(ORDER_INDEX, table_name=TABLE)
    op.drop_table(TABLE)
