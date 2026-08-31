"""Store privacy-safe Site Metrics action names.

Revision ID: 0038_site_metric_event
Revises: 0037_cf_stated_split
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0038_site_metric_event"
down_revision = "0037_cf_stated_split"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


EVENT_KINDS = (
    "bill_search_with_results",
    "legislator_search_with_results",
    "find_my_legislator_with_results",
    "official_source_opened",
)


def upgrade() -> None:
    op.create_table(
        "site_metric_event",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_kind", sa.String(length=60), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "event_kind IN (" + ", ".join(f"'{kind}'" for kind in EVENT_KINDS) + ")",
            name=op.f("ck_site_metric_event_event_kind_allowed"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_site_metric_event"),
    )
    op.create_index(
        "ix_site_metric_event_kind_created",
        "site_metric_event",
        ["event_kind", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_site_metric_event_kind_created", table_name="site_metric_event")
    op.drop_table("site_metric_event")
