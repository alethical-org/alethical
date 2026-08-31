"""Store the date the Board received each report, so a feed can order by it (#1670).

Net: we hold every report Minnesota catalogues but no record of when any of them was
filed, so the newest-filings feed orders by the period a report covers instead. Every
2026 pre-primary report shares the period end 20 Jul 2026, so the top of that feed is
one large tie broken alphabetically rather than a chronology of arrivals, and a 2023
report filed in 2026 sorts below every 2026 report.

Where the date comes from, measured 31 Aug 2026: the Board's report catalogue serves 17
fields per report and none of them is a filing date, so this cannot be loaded with the
rest of the catalogue. The date is printed inside the report document, on its own line,
as ``Received by the Board July 24, 2026``. That is a different fact from the ``Printed``
line 1 line below it -- filer 11880's 2026 pre-primary was received 24 Jul and printed
27 Jul -- so only the received line may be read.

Nullable, and NULL is the ordinary answer rather than a fault. Three separate causes,
none of them ours to fix: the Board serves no document at all before 2023 for most
reports, it answers HTTP 200 with an HTML page when it will not serve one
(``campaign-finance-system-design.md`` 9.4), and a document it does serve is sometimes a
scan carrying no text -- filer 13481's 2025 year-end is 1,511,095 bytes over 1 page with
0 readable lines. So a blank here never means the report was not filed, and nothing may
fill it from the period end: that is the fabricated fact #1670 exists to prevent.

Additive only: 1 nullable column on 1 table, no enum, no index, no existing row changed.
The downgrade is a clean drop of the same column. Round-tripped
upgrade -> downgrade -> upgrade against real Postgres.

Revision ID: 0046_report_filed_date
Revises: 0045_committee_link_basis
"""

import sqlalchemy as sa
from alembic import op

revision = "0046_report_filed_date"
down_revision = "0045_committee_link_basis"
branch_labels = None
depends_on = None

TABLE = "cf_filing_report"
COLUMN = "filed_date"


def upgrade() -> None:
    op.add_column(TABLE, sa.Column(COLUMN, sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column(TABLE, COLUMN)
