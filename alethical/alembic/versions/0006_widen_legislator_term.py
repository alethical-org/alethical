"""Widen legislator_service_period.term to Text (annotations like "3rd (non-consecutive)")."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0006_widen_legislator_term"
down_revision = "0005_legislator_elected_term"
branch_labels = None
depends_on = None

TABLE = "legislator_service_period"


def upgrade() -> None:
    # Some members' "Term:" value carries an annotation (e.g. "3rd
    # (non-consecutive)") that overflows the original varchar(20). Widen to Text.
    # Guarded so it's a no-op where the column is already Text (fresh DBs build
    # it from the model, prod carried the varchar from 0005).
    bind = op.get_bind()
    col = next(
        (c for c in sa.inspect(bind).get_columns(TABLE) if c["name"] == "term"), None
    )
    if col is not None and not isinstance(col["type"], sa.Text):
        op.alter_column(
            TABLE, "term", type_=sa.Text(), existing_type=sa.String(length=20)
        )


def downgrade() -> None:
    op.alter_column(TABLE, "term", type_=sa.String(length=20), existing_type=sa.Text())
