"""Read graph years and transfer numbers without scanning expenditure text.

The graph needs all saved years and the numbers named by outgoing contributions.
Carry those fields in one index so the metadata read does not fetch wide payment
rows. No source rows change. Build concurrently to keep ingestion and reads open.
An interrupted build's invalid index is removed on retry before rebuilding.

Revision ID: 0080_cf_graph_metadata_index
Revises: 0079_finance_copy_withdrawal
"""

from alembic import op
from sqlalchemy import text

revision = "0080_cf_graph_metadata_index"
down_revision = "0079_finance_copy_withdrawal"
branch_labels = None
depends_on = None

INDEX = "ix_cf_expenditure_row_snapshot_year_metadata"


def upgrade() -> None:
    with op.get_context().autocommit_block():
        valid = op.get_bind().scalar(
            text(
                "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:name)"
            ),
            {"name": "public." + INDEX},
        )
        if valid is False:
            op.execute(f"DROP INDEX CONCURRENTLY public.{INDEX}")
        op.execute(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {INDEX} "
            "ON public.cf_expenditure_row (snapshot_id, year) "
            "INCLUDE (type, affected_committee_reg_num)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS public.{INDEX}")
