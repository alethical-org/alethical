"""Index employer and outside-payee spelling suggestions without changing source records.

Exact employer lookups and the small-file outside-payee scan do not serve
bounded similarity reads. Build both GIN indexes concurrently; retry repairs an interrupted, invalid build. Readers
never treat a matching spelling as an identity. No source copy is replaced.

Revision ID: 0084_finance_employer_similarity
Revises: 0083_fcc_observation_station
"""

from alembic import op
from sqlalchemy import text

revision = "0084_finance_employer_similarity"
down_revision = "0083_fcc_observation_station"
branch_labels = None
depends_on = None
INDEXES = (
    (
        "ix_cf_contribution_row_employer_trgm",
        "cf_contribution_row",
        "contrib_employer_name",
    ),
    (
        "ix_cf_independent_expenditure_row_vendor_trgm",
        "cf_independent_expenditure_row",
        "vendor_name",
    ),
)


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for index, table, column in INDEXES:
            valid = op.get_bind().scalar(
                text(
                    "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:name)"
                ),
                {"name": "public." + index},
            )
            if valid is False:
                op.execute(f"DROP INDEX CONCURRENTLY public.{index}")
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {index} ON public.{table} USING gin ({column} gin_trgm_ops)"
            )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for index, _, _ in reversed(INDEXES):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS public.{index}")
