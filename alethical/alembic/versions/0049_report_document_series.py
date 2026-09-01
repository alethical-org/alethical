"""Say which report series a kept document belongs to (#1886).

Net: a candidate in a special election files a whole second series of reports, so one
committee can file two year-end reports for the same year -- the regular one and the
special-election one. ``cf_report_document`` records a document's filer, year, report
type and amendment index and nothing else, and those 4 values are identical for both, so
the two documents are indistinguishable in the store. That is not a tidiness problem: on
Minnesota's live catalogue, measured 1 September 2026, **7 filer-year-amendments carry
both a regular and a special-election year-end report**, and a pass keeping documents
would either drop one of each pair or write 2 rows nothing can tell apart -- and
``DocumentLibrary.body_for`` raises on the second, because it expects one row per filing.

Why it matters now rather than whenever: Minnesota is taking every report filed since
1 January 2022 off its website, redacting donors' street addresses and reposting it,
finishing about 19 November 2026. The Board publishes no archive
(``campaign-finance-system-design.md`` 4.5), so a document not copied before the repost
reaches it exists nowhere afterwards. 28 of the 2,215 year-end documents still to fetch
belong to a special-election series.

**Existing rows are the regular series, and that is a measured fact rather than an
assumption.** All 3,643 documents held today were fetched by 2 paths, and both request
the regular series outright: ``campaign_finance_stated_split.py`` selects its report with
``r.special_election IS FALSE`` and posts ``special_election=False``, and #1501's backfill
posted the same. So ``false`` is what those rows are, which is why the default fills them
truthfully instead of leaving a column nobody can interpret.

Additive: 1 boolean column on 1 table, with a default, so Postgres records it in the
catalogue without rewriting the table and no existing row is touched. The downgrade is a
clean drop of the same column. Round-tripped upgrade -> downgrade -> upgrade against real
Postgres.

Revision ID: 0049_report_document_series
Revises: 0048_cf_stated_spending
"""

import sqlalchemy as sa
from alembic import op

revision = "0049_report_document_series"
down_revision = "0048_cf_stated_spending"
branch_labels = None
depends_on = None

TABLE = "cf_report_document"
COLUMN = "special_election"


def upgrade() -> None:
    op.add_column(
        TABLE,
        sa.Column(
            COLUMN,
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column(TABLE, COLUMN)
