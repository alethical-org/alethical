"""Retain anonymous account/follow totals and short-lived action retry keys.

Revision ID: 0052_site_metric_history
Revises: 0051_tracked_committee
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0052_site_metric_history"
down_revision = "0051_tracked_committee"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EVENT_KINDS = (
    "bill_search_with_results",
    "legislator_search_with_results",
    "find_my_legislator_with_results",
    "official_source_opened",
    "money_search_with_results",
)
CREATION_KINDS = ("account_created", "bill_watch_created", "committee_watch_created")


def _event_constraint(kinds: tuple[str, ...]) -> None:
    op.create_check_constraint(
        op.f("ck_site_metric_event_event_kind_allowed"),
        "site_metric_event",
        "event_kind IN (" + ", ".join(f"'{kind}'" for kind in kinds) + ")",
    )


def upgrade() -> None:
    op.create_table(
        "site_metric_hourly_count",
        sa.Column("metric_kind", sa.String(60), primary_key=True),
        sa.Column("bucket_started_at", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("count", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "metric_kind IN ("
            + ", ".join(f"'{kind}'" for kind in CREATION_KINDS)
            + ")",
            name=op.f("ck_site_metric_hourly_count_metric_kind_allowed"),
        ),
        sa.CheckConstraint(
            "count >= 0", name=op.f("ck_site_metric_hourly_count_count_nonnegative")
        ),
    )
    op.create_table(
        "site_metric_coverage",
        sa.Column("metric_kind", sa.String(60), primary_key=True),
        sa.Column("recording_started_at", sa.DateTime(timezone=True), nullable=False),
    )
    # No inventory backfill: deleted accounts/follows are genuinely unknowable.
    # Existing browser events remain countable, but their earliest row does not
    # prove when collection began. Claim coverage only from this installation.
    coverage = sa.table(
        "site_metric_coverage",
        sa.column("metric_kind", sa.String),
        sa.column("recording_started_at", sa.DateTime(timezone=True)),
    )
    for kind in (*EVENT_KINDS, *CREATION_KINDS):
        op.execute(
            coverage.insert().values(
                metric_kind=kind, recording_started_at=sa.func.now()
            )
        )
    op.create_table(
        "site_metric_receipt",
        sa.Column("event_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_site_metric_receipt_expires_at", "site_metric_receipt", ["expires_at"]
    )
    op.drop_constraint(
        op.f("ck_site_metric_event_event_kind_allowed"),
        "site_metric_event",
        type_="check",
    )
    _event_constraint(EVENT_KINDS)


def downgrade() -> None:
    # The old fixed-name contract cannot hold money-search events.
    op.execute(
        "DELETE FROM site_metric_event WHERE event_kind = 'money_search_with_results'"
    )
    op.drop_constraint(
        op.f("ck_site_metric_event_event_kind_allowed"),
        "site_metric_event",
        type_="check",
    )
    _event_constraint(EVENT_KINDS[:-1])
    op.drop_table("site_metric_receipt")
    op.drop_table("site_metric_coverage")
    op.drop_table("site_metric_hourly_count")
