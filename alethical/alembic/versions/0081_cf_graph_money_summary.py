"""Add up the Finance money graph's groups once per saved payment file.

Grouping every live payment row on each graph request read 469 MB against a
256 MB buffer pool and spilled to temp files, so the first signed-in broad page
took 14 s (2 Nov 2026). This table holds 1 row per distinct set of node inputs
and filing year for a saved file, written inside the publish transaction and
deleted with the file's pruned rows. No source row changes. To undo: empty the
table (every read then groups the raw rows), revert the code, then downgrade;
the code that reads the table fails if the table is dropped first.

Revision ID: 0081_cf_graph_money_summary
Revises: 0080_cf_graph_metadata_index
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0081_cf_graph_money_summary"
down_revision = "0080_cf_graph_metadata_index"
branch_labels = None
depends_on = None

TABLE = "cf_graph_money_summary"
INDEX = "ix_cf_graph_money_summary_snapshot_year"
ACCOUNT_INDEX = "ix_cf_graph_money_summary_snapshot_account"


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
        sa.Column(
            "dataset",
            postgresql.ENUM(
                "contributions",
                "expenditures",
                "independent_expenditures",
                name="cf_dataset",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("account_number", sa.Text()),
        sa.Column("account_name", sa.Text()),
        sa.Column("printed_name", sa.Text()),
        sa.Column("donor_number", sa.Text()),
        sa.Column("payment_type", sa.Text()),
        sa.Column("transfer_number", sa.Text()),
        sa.Column("transfer_name", sa.Text()),
        sa.Column("year", sa.Integer()),
        sa.Column("record_count", sa.Integer(), nullable=False),
        sa.Column("amount_sum", sa.Numeric(20, 4)),
        sa.Column("missing_amount_count", sa.Integer(), nullable=False),
        sa.Column("first_date", sa.Date()),
        sa.Column("last_date", sa.Date()),
        sa.Column("undated_count", sa.Integer(), nullable=False),
    )
    op.create_index(INDEX, TABLE, ["snapshot_id", "year"])
    op.create_index(ACCOUNT_INDEX, TABLE, ["snapshot_id", "account_number"])


def downgrade() -> None:
    op.drop_index(ACCOUNT_INDEX, table_name=TABLE)
    op.drop_index(INDEX, table_name=TABLE)
    op.drop_table(TABLE)
