"""Keep the exact filed position in future graph summary groups.

Adds nullable metadata only. Existing summary rows stay unknown until a separately
authorized rebuild of their saved source file; no source rows, live pointers or
summary figures change here. Deploy this column before code that reads/writes it.
To undo, revert that code before dropping the column. Original payment rows retain
the filed text, so dropping this derived field loses no source evidence.

Revision ID: 0085_finance_graph_position
Revises: 0084_finance_employer_similarity
"""

from alembic import op
import sqlalchemy as sa

revision = "0085_finance_graph_position"
down_revision = "0084_finance_employer_similarity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cf_graph_money_summary", sa.Column("position", sa.Text(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("cf_graph_money_summary", "position")
