"""Drop the dead legislator.is_active column (#349).

Current-membership is driven entirely by ``LegislatorServicePeriod.is_current``
(maintained by the roster reconciliation, #332); ``Legislator.is_active`` was
never read or written. The 0001 baseline builds the schema via
``metadata.create_all``, so on a fresh database built from the current model the
column no longer exists — guard both directions like 0002/0003 so this is a
no-op where the state already matches.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0004_drop_legislator_is_active"
down_revision = "0003_one_current_per_bill"
branch_labels = None
depends_on = None

TABLE = "legislator"
COLUMN = "is_active"


def _has_column(bind) -> bool:
    return COLUMN in {col["name"] for col in sa.inspect(bind).get_columns(TABLE)}


def upgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind):
        op.drop_column(TABLE, COLUMN)


def downgrade() -> None:
    bind = op.get_bind()
    if not _has_column(bind):
        op.add_column(
            TABLE,
            sa.Column(
                "is_active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
        )
