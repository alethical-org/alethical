"""Add the 3 campaign finance row tables each download is copied into.

Net: one table per downloaded file, holding that file's columns and nothing else,
so a figure on a page traces back to a numbered line in one specific dated
download. The key is (snapshot_id, row_number) because Minnesota publishes no
per-transaction identifier and a single official download contains 20,524 rows
identical to another row -- so any key built from a row's contents would delete
real money. Design: docs/architecture/campaign-finance-system-design.md §4.2 (Why
replace rather than merge) (#1328).

Additive only. Three new tables, nothing existing is touched, so the downgrade is
a clean drop.

Revision ID: 0030_campaign_finance_rows
Revises: 0029_campaign_finance_snapshots
"""

import sqlalchemy as sa
from alembic import op

revision = "0030_campaign_finance_rows"
down_revision = "0029_campaign_finance_snapshots"
branch_labels = None
depends_on = None


def _snapshot_key() -> list[sa.Column]:
    """The 2 columns every row table shares.

    ``row_number`` is the 1-based CSV *record* number, not a physical line: 720
    newlines sit inside quoted fields, so the two differ. Both are in the primary
    key, which also means a second importer copying the same snapshot's rows dies
    on a duplicate key instead of silently doubling every total.
    """
    return [
        sa.Column("snapshot_id", sa.UUID(), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "cf_contribution_row",
        *_snapshot_key(),
        sa.Column("recipient_reg_num", sa.Text(), nullable=True),
        sa.Column("recipient", sa.Text(), nullable=True),
        sa.Column("recipient_type", sa.Text(), nullable=True),
        sa.Column("recipient_subtype", sa.Text(), nullable=True),
        sa.Column("amount", sa.Numeric(precision=18, scale=4), nullable=True),
        sa.Column("receipt_date", sa.Date(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("contributor", sa.Text(), nullable=True),
        sa.Column("contrib_reg_num", sa.Text(), nullable=True),
        sa.Column("contrib_type", sa.Text(), nullable=True),
        sa.Column("receipt_type", sa.Text(), nullable=True),
        sa.Column("in_kind", sa.Text(), nullable=True),
        sa.Column("in_kind_descr", sa.Text(), nullable=True),
        sa.Column("contrib_zip", sa.Text(), nullable=True),
        sa.Column("contrib_employer_name", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["cf_snapshot.id"],
            name=op.f("fk_cf_contribution_row_snapshot_id_cf_snapshot"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "snapshot_id", "row_number", name=op.f("pk_cf_contribution_row")
        ),
    )
    op.create_index(
        "ix_cf_contribution_row_recipient",
        "cf_contribution_row",
        ["recipient_reg_num", "year"],
        unique=False,
    )
    op.create_table(
        "cf_expenditure_row",
        *_snapshot_key(),
        sa.Column("committee_reg_num", sa.Text(), nullable=True),
        sa.Column("committee_name", sa.Text(), nullable=True),
        sa.Column("entity_type", sa.Text(), nullable=True),
        sa.Column("entity_sub_type", sa.Text(), nullable=True),
        sa.Column("vendor_name", sa.Text(), nullable=True),
        sa.Column("vendor_city", sa.Text(), nullable=True),
        sa.Column("vendor_state", sa.Text(), nullable=True),
        sa.Column("vendor_zip", sa.Text(), nullable=True),
        sa.Column("amount", sa.Numeric(precision=18, scale=4), nullable=True),
        sa.Column("unpaid_amount", sa.Numeric(precision=18, scale=4), nullable=True),
        sa.Column("date", sa.Date(), nullable=True),
        sa.Column("purpose", sa.Text(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("type", sa.Text(), nullable=True),
        sa.Column("in_kind_descr", sa.Text(), nullable=True),
        sa.Column("in_kind", sa.Text(), nullable=True),
        sa.Column("affected_committee_name", sa.Text(), nullable=True),
        sa.Column("affected_committee_reg_num", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["cf_snapshot.id"],
            name=op.f("fk_cf_expenditure_row_snapshot_id_cf_snapshot"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "snapshot_id", "row_number", name=op.f("pk_cf_expenditure_row")
        ),
    )
    op.create_index(
        "ix_cf_expenditure_row_committee",
        "cf_expenditure_row",
        ["committee_reg_num", "year"],
        unique=False,
    )
    op.create_table(
        "cf_independent_expenditure_row",
        *_snapshot_key(),
        sa.Column("spender", sa.Text(), nullable=True),
        sa.Column("spender_reg_num", sa.Text(), nullable=True),
        sa.Column("spender_type", sa.Text(), nullable=True),
        sa.Column("spender_sub_type", sa.Text(), nullable=True),
        sa.Column("affected_committee_name", sa.Text(), nullable=True),
        sa.Column("affected_committee_reg_num", sa.Text(), nullable=True),
        sa.Column("for_against", sa.Text(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("date", sa.Date(), nullable=True),
        sa.Column("type", sa.Text(), nullable=True),
        sa.Column("amount", sa.Numeric(precision=18, scale=4), nullable=True),
        sa.Column("unpaid_amount", sa.Numeric(precision=18, scale=4), nullable=True),
        sa.Column("in_kind", sa.Text(), nullable=True),
        sa.Column("in_kind_descr", sa.Text(), nullable=True),
        sa.Column("purpose", sa.Text(), nullable=True),
        sa.Column("vendor_name", sa.Text(), nullable=True),
        sa.Column("vendor_city", sa.Text(), nullable=True),
        sa.Column("vendor_state", sa.Text(), nullable=True),
        sa.Column("vendor_zip", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["cf_snapshot.id"],
            name=op.f("fk_cf_independent_expenditure_row_snapshot_id_cf_snapshot"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "snapshot_id", "row_number", name=op.f("pk_cf_independent_expenditure_row")
        ),
    )
    op.create_index(
        "ix_cf_independent_expenditure_row_spender",
        "cf_independent_expenditure_row",
        ["spender_reg_num", "year"],
        unique=False,
    )
    op.create_index(
        "ix_cf_independent_expenditure_row_affected",
        "cf_independent_expenditure_row",
        ["affected_committee_reg_num", "year"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_cf_independent_expenditure_row_affected",
        table_name="cf_independent_expenditure_row",
    )
    op.drop_index(
        "ix_cf_independent_expenditure_row_spender",
        table_name="cf_independent_expenditure_row",
    )
    op.drop_table("cf_independent_expenditure_row")
    op.drop_index("ix_cf_expenditure_row_committee", table_name="cf_expenditure_row")
    op.drop_table("cf_expenditure_row")
    op.drop_index("ix_cf_contribution_row_recipient", table_name="cf_contribution_row")
    op.drop_table("cf_contribution_row")
