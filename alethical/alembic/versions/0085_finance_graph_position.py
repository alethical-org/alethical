"""Keep the exact filed position in future graph summary groups.

Adds nullable metadata only. Existing summary rows stay unknown until a separately
authorized rebuild of their saved source file; no source rows, live pointers or
summary figures change here. Deploy this column before code that reads/writes it.
Undo behavior with a forward release that retains migrations 0084/0085 and this
additive schema: readiness requires the database and code migration heads to match.
Do not redeploy a pre-migration API image. Drop the column only after a compatible
reader/writer release and planned migration rollback. Source rows retain the text.

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
