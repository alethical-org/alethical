"""Index the name columns the campaign-finance lookups and the money search read.

Net: looking up or searching a donor, vendor or employer by name reads every one of the
583,152 rows of Minnesota's contributions file, because no index covers the columns
holding those names. Nobody notices while no page calls it; the money section's search
box calls it on every keystroke. Five indexes turn each of those reads into a direct
lookup ([#1486](https://github.com/alethical-org/alethical/issues/1486)).

Two kinds, because the 2 questions are different:

* **3 B-tree indexes on ``(snapshot_id, <name column>)``**, snapshot first because every
  query filters both and the snapshot narrows first. These serve the exact-equality
  lookups behind ``/campaign-finance/payments-under-name``, which is #1486's own ask.
  Snapshot-first also means the index prunes the way the rows do: a superseded
  snapshot's entries leave the index when its rows are deleted.
* **2 trigram GIN indexes**, which serve the substring match behind
  ``/campaign-finance/search``. A B-tree cannot answer ``ILIKE '%name%'`` at all, and
  that is the query the search box makes.

The independent-expenditures file is deliberately left unindexed: 41,130 rows, measured
at 53 ms warm for the same substring query, so an index would cost the nightly load more
than it saves a reader.

Measured on production, warm, with ``EXPLAIN (ANALYZE)``, 19 Aug 2026:

===========================================  ========  =======
lookup                                        before    after
===========================================  ========  =======
donor-name substring (``contributor``)         431 ms   5.7 ms
donor-name exact                                87 ms   2.3 ms
vendor-name substring (``vendor_name``)        286 ms   1.9 ms
vendor-name exact                               65 ms   3.4 ms
employer-name exact                            100 ms  10.6 ms
===========================================  ========  =======

Additive and reversible: 5 indexes and 1 extension, no table, no column, no row changed.
Round-tripped upgrade -> downgrade -> upgrade against real Postgres.

**Already built on production**, out of band with ``CREATE INDEX CONCURRENTLY`` so no
write lock was taken alongside live ingestion (19.4 s for all 5, 65 MB total). A
migration runs inside one transaction and cannot use CONCURRENTLY, so this uses
``IF NOT EXISTS``: a no-op on production, and the real build on CI and any fresh
database. ``SET LOCAL statement_timeout = 0`` because a migration is one transaction and
the pooler's 2-minute default would cancel a build on a database where these are new.

Design: docs/architecture/campaign-finance-system-design.md §5 (identity: a printed name
is the whole of the key) and §4.2 (why the rows are replaced rather than merged).

Revision ID: 0040_cf_name_indexes
Revises: 0039_cf_report_document
"""

from alembic import op

revision = "0040_cf_name_indexes"
down_revision = "0039_cf_report_document"
branch_labels = None
depends_on = None

#: (index name, table, the DDL fragment after the table name).
INDEXES = (
    (
        "ix_cf_contribution_row_snapshot_contributor",
        "cf_contribution_row",
        "(snapshot_id, contributor)",
    ),
    (
        "ix_cf_contribution_row_snapshot_employer",
        "cf_contribution_row",
        "(snapshot_id, contrib_employer_name)",
    ),
    (
        "ix_cf_expenditure_row_snapshot_vendor",
        "cf_expenditure_row",
        "(snapshot_id, vendor_name)",
    ),
    (
        "ix_cf_contribution_row_contributor_trgm",
        "cf_contribution_row",
        "USING gin (contributor gin_trgm_ops)",
    ),
    (
        "ix_cf_expenditure_row_vendor_trgm",
        "cf_expenditure_row",
        "USING gin (vendor_name gin_trgm_ops)",
    ),
)


def upgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    # The 2 GIN indexes below need it. Migration 0011 already installs it for the bill
    # and legislator name searches, so this is a no-op everywhere today; declared anyway
    # so this migration states its own dependency rather than inheriting one.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    for name, table, definition in INDEXES:
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} {definition}")


def downgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    for name, _table, _definition in INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")
    # The extension is deliberately left installed. Dropping it would fail on any
    # database where something else created a trigram index, and an installed extension
    # nobody uses costs nothing.
