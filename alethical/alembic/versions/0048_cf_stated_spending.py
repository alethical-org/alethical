"""Record whether each committee's own filing agrees with the payments out we hold.

Net: money coming in has had a stored per-committee-year verdict since ``cf_stated_split``
(#1433). Money going out has had none. The check was run for the first time on 31 August
2026 across 3,643 committee-years and its answers lived only in that run's terminal
output, so nobody could read them the next day and nothing re-checked them. This is the
table that keeps them (#1645).

Additive only: 1 new table and 1 new enum. No existing row changes and nothing existing
is rewritten, so the downgrade is a clean drop. Round-tripped upgrade -> downgrade ->
upgrade against real Postgres.

Design: docs/architecture/campaign-finance-system-design.md §9.9 (what has and has not
been reconciled).

Revision ID: 0048_cf_stated_spending
Revises: 0047_report_filed_date
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0048_cf_stated_spending"
down_revision = "0047_report_filed_date"
branch_labels = None
depends_on = None

# The same 4 answers as cf_stated_split_status, and deliberately its own type: "split"
# names the money-in question of named against unnamed donors and has no money-out
# meaning, and one shared type would tie either table's downgrade to the other's.
STATED_SPENDING_STATUS = postgresql.ENUM(
    "agrees",
    "disagrees",
    "not_checked",
    "reader_unproven",
    name="cf_stated_spending_status",
    create_type=False,
)


def upgrade() -> None:
    STATED_SPENDING_STATUS.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "cf_stated_spending",
        # Keyed on the EXPENDITURES snapshot, where the money-in table keys on the
        # contributions one, because the verdict is about those rows. A new download
        # replaces them, so every verdict about the old ones is void and the cascade
        # takes it away rather than leaving a stale claim behind.
        sa.Column("snapshot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("registration_number", sa.String(length=20), nullable=False),
        sa.Column("filing_year", sa.Integer(), nullable=False),
        sa.Column("filings_snapshot_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", STATED_SPENDING_STATUS, nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("self_test", sa.String(length=20), nullable=True),
        sa.Column("report_type", sa.String(length=8), nullable=True),
        sa.Column("amendment_index", sa.Integer(), nullable=True),
        sa.Column("cut_off_date", sa.Date(), nullable=True),
        sa.Column("document_hash", sa.String(length=64), nullable=True),
        sa.Column("document_byte_size", sa.Integer(), nullable=True),
        sa.Column("stated_itemized", sa.Numeric(18, 4), nullable=True),
        sa.Column("stated_itemized_paid", sa.Numeric(18, 4), nullable=True),
        sa.Column("stated_non_itemized", sa.Numeric(18, 4), nullable=True),
        sa.Column("ours_itemized", sa.Numeric(18, 4), nullable=True),
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
    # spending figure of ours", which is a status scan inside one snapshot.
    op.create_index(
        "ix_cf_stated_spending_status", "cf_stated_spending", ["snapshot_id", "status"]
    )


def downgrade() -> None:
    op.drop_index("ix_cf_stated_spending_status", table_name="cf_stated_spending")
    op.drop_table("cf_stated_spending")
    STATED_SPENDING_STATUS.drop(op.get_bind(), checkfirst=True)
