"""Key each disclosure statement on its report period as well as its number (#2347).

The Board numbers a committee's statements afresh for every report: Restore Sanity's
2026 1st Quarter, June, Pre-Primary and September reports each list a statement 1, and
each is a different document, fetched with that report's own period code
(`period=A` .. `period=D`). The first collection keyed statements on (recipient, year,
number) and fetched every one with `period=D`, which folded up to 4 documents into one
row and never reached periods A to C.

Those rows are removed here rather than repaired: none was ever shown to a reader, no
reading of any was stored, and every one is re-read from the Board by the next
collection. Their kept PDFs stay in the bucket, content-addressed, so nothing held is
lost. Downgrade removes the re-keyed rows for the same reason and restores the old key.
"""

import sqlalchemy as sa
from alembic import op

revision = "0063_cf_statement_report_period"
down_revision = "0062_cf_refresh_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM cf_disclosure_statement")
    op.execute("DELETE FROM cf_statement_scan")
    op.add_column(
        "cf_disclosure_statement",
        sa.Column("report_period", sa.String(length=8), nullable=False),
    )
    op.add_column(
        "cf_disclosure_statement", sa.Column("report_name", sa.Text(), nullable=True)
    )
    op.add_column(
        "cf_disclosure_statement", sa.Column("report_cut_off", sa.Date(), nullable=True)
    )
    op.drop_constraint(
        "uq_cf_disclosure_statement_number", "cf_disclosure_statement", type_="unique"
    )
    op.create_unique_constraint(
        "uq_cf_disclosure_statement_period_number",
        "cf_disclosure_statement",
        [
            "recipient_registration_number",
            "filing_year",
            "report_period",
            "statement_number",
        ],
    )
    # A form with no received stamp states no received date, so a read statement
    # needs its box and nothing more.
    op.drop_constraint(
        "a_read_statement_has_its_box",
        "cf_disclosure_statement_reading",
        type_="check",
    )
    op.create_check_constraint(
        "a_read_statement_has_its_box",
        "cf_disclosure_statement_reading",
        "state <> 'read' OR box IS NOT NULL",
    )
    op.add_column(
        "cf_disclosure_statement_reading",
        sa.Column("recipient_name", sa.Text(), nullable=True),
    )
    op.add_column(
        "cf_disclosure_statement_reading",
        sa.Column("repeat_of_period", sa.String(length=8), nullable=True),
    )
    op.add_column(
        "cf_disclosure_statement_reading",
        sa.Column("repeat_of_number", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.execute("DELETE FROM cf_disclosure_statement")
    op.execute("DELETE FROM cf_statement_scan")
    op.drop_constraint(
        "a_read_statement_has_its_box",
        "cf_disclosure_statement_reading",
        type_="check",
    )
    op.create_check_constraint(
        "a_read_statement_has_its_box",
        "cf_disclosure_statement_reading",
        "state <> 'read' OR (box IS NOT NULL AND received_on IS NOT NULL)",
    )
    op.drop_column("cf_disclosure_statement_reading", "repeat_of_number")
    op.drop_column("cf_disclosure_statement_reading", "repeat_of_period")
    op.drop_column("cf_disclosure_statement_reading", "recipient_name")
    op.drop_constraint(
        "uq_cf_disclosure_statement_period_number",
        "cf_disclosure_statement",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_cf_disclosure_statement_number",
        "cf_disclosure_statement",
        ["recipient_registration_number", "filing_year", "statement_number"],
    )
    op.drop_column("cf_disclosure_statement", "report_cut_off")
    op.drop_column("cf_disclosure_statement", "report_name")
    op.drop_column("cf_disclosure_statement", "report_period")
