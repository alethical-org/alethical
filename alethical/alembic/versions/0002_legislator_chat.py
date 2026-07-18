"""Add legislator chat session/message tables."""

from __future__ import annotations

from alembic import op
from alethical.db import models

# revision identifiers, used by Alembic.
revision = "0002_legislator_chat"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    models.Base.metadata.create_all(
        bind=bind,
        tables=[
            models.LegislatorChatSession.__table__,
            models.LegislatorChatMessage.__table__,
        ],
    )


def downgrade() -> None:
    bind = op.get_bind()
    models.Base.metadata.drop_all(
        bind=bind,
        tables=[
            models.LegislatorChatMessage.__table__,
            models.LegislatorChatSession.__table__,
        ],
    )
