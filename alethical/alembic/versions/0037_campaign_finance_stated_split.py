"""Record whether each committee's own filing agrees with the payments we hold.

Net: a committee's own filed report states how much of its money it named donors for.
Comparing that to the payments we hold is the only way to see our records being SHORT,
and a shortfall is the dangerous direction: the missing money lands in the derived "no
donor named" figure and reads as ordinary small-donor money under a real politician's
name. This one table stores that per-committee-year answer so a page can act on it
without fetching a document (#1433).

Additive only: 1 new table and 1 new enum. No existing row changes and nothing existing
is rewritten, so the downgrade is a clean drop. Round-tripped upgrade -> downgrade ->
upgrade against real Postgres.

Design: docs/architecture/campaign-finance-system-design.md §9.4 (Report PDFs are a
fallback, not a route).

Revision ID: 0037_cf_stated_split
Revises: 0036_pending_action
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0037_cf_stated_split"
down_revision = "0036_pending_action"
branch_labels = None
depends_on = None

STATED_SPLIT_STATUS = postgresql.ENUM(
    "agrees",
    "disagrees",
    "not_checked",
    "reader_unproven",
    name="cf_stated_split_status",
    create_type=False,
)


def upgrade() -> None:
    STATED_SPLIT_STATUS.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "cf_stated_split",
        # Keyed on the contributions snapshot because the verdict is about those rows.
        # A new download replaces them, so every verdict about the old ones is void and
        # the cascade takes it away rather than leaving a stale claim behind.
        sa.Column("snapshot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("registration_number", sa.String(length=20), nullable=False),
        sa.Column("filing_year", sa.Integer(), nullable=False),
        sa.Column("filings_snapshot_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", STATED_SPLIT_STATUS, nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("self_test", sa.String(length=20), nullable=True),
        sa.Column("report_type", sa.String(length=8), nullable=True),
        sa.Column("amendment_index", sa.Integer(), nullable=True),
        sa.Column("cut_off_date", sa.Date(), nullable=True),
        sa.Column("document_hash", sa.String(length=64), nullable=True),
        sa.Column("document_byte_size", sa.Integer(), nullable=True),
        sa.Column("stated_itemized", sa.Numeric(18, 4), nullable=True),
        sa.Column("stated_itemized_cash", sa.Numeric(18, 4), nullable=True),
        sa.Column("stated_non_itemized", sa.Numeric(18, 4), nullable=True),
        sa.Column("ours_itemized", sa.Numeric(18, 4), nullable=True),
        sa.Column("ours_itemized_cash", sa.Numeric(18, 4), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["snapshot_id"], ["cf_snapshot.id"], ondelete="CASCADE"
        ),
        # SET NULL rather than CASCADE: the filings snapshot only proved the reader, so
        # losing it must not delete a verdict about payments that are still published.
        sa.ForeignKeyConstraint(
            ["filings_snapshot_id"],
            ["cf_filing_snapshot.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("snapshot_id", "registration_number", "filing_year"),
    )
    # The read a page makes is "which committee-years of this release must not show a
    # split", which is a status scan inside one snapshot.
    op.create_index(
        "ix_cf_stated_split_status", "cf_stated_split", ["snapshot_id", "status"]
    )


def downgrade() -> None:
    op.drop_index("ix_cf_stated_split_status", table_name="cf_stated_split")
    op.drop_table("cf_stated_split")
    STATED_SPLIT_STATUS.drop(op.get_bind(), checkfirst=True)
