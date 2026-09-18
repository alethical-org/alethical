"""Answer a committee-year's money from the index, without reading the table.

Net: the money pages ask what one committee, or every committee in a race, received in
a year. Those rows are scattered: on the live release one committee's 305 rows for 2026
sit on 302 separate pages, and the race page's 27,889 rows sit on 11,658 of the
snapshot's 12,458 pages. So the reading was almost entirely the table, not the index,
and it cost 1,713 ms cold and 69 ms warm on production (``EXPLAIN (ANALYZE, BUFFERS)``,
18 Sep 2026). This index carries the 4 values those reads add up, so they never open the
table at all.

One B-tree on ``(snapshot_id, recipient_reg_num, year)`` with ``receipt_type``,
``amount``, ``receipt_date`` and ``in_kind`` carried along (``INCLUDE``). Snapshot
first because every reader filters it and it narrows first, and so a superseded
snapshot's entries leave the index when its rows are deleted (the shape of migrations
0040 and 0055).

**The carried columns are the point, and a plain index would be worse than none.**
Measured on a local copy at production's volume (1,166,374 rows, 2 snapshots, the same
per-year spread): the race page's question touches 3,217 blocks today, 15,609 with a
plain ``(snapshot_id, recipient_reg_num, year)`` index -- which trades one scan of the
table for 27,889 scattered fetches from it -- and 2,500 with this one, which reads
nothing but the index. On production, where the rows are scattered far worse, today's
figure is 13,308 blocks.

An index answers on its own only where Postgres knows the rows are visible to everyone.
It does here: 99.8% of this table's 26,464 pages are marked all-visible, because the
loader replaces rows in bulk and autovacuum marks the table minutes later. Where that
is not yet true the planner can see it (``pg_class.relallvisible``) and simply picks
today's plan, so a load in flight makes this index do nothing rather than something
wrong.

The cost, stated plainly: about 86 MB beside a 207 MB table, and 1 more index for the
loader to fill on each nightly load.

Additive and reversible: 1 index, no table, no column, no row changed. Round-tripped
upgrade -> downgrade -> upgrade against real Postgres.

Built with ``CREATE INDEX CONCURRENTLY``, which Postgres refuses inside a transaction,
so the build runs in Alembic's ``autocommit_block``. A build interrupted halfway leaves
an *invalid* index that ``IF NOT EXISTS`` would skip on the retry; ``pg_index.indisvalid``
says so, and ``DROP INDEX`` followed by a rerun is the repair.

Revision ID: 0056_cf_recipient_year_index
Revises: 0055_cf_contributor_number_index
"""

from alembic import op

revision = "0056_cf_recipient_year_index"
down_revision = "0055_cf_contributor_number_index"
branch_labels = None
depends_on = None

INDEX = "ix_cf_contribution_row_snapshot_recipient_year"


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("SET statement_timeout = 0")
        op.execute(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {INDEX} "
            "ON cf_contribution_row (snapshot_id, recipient_reg_num, year) "
            "INCLUDE (receipt_type, amount, receipt_date, in_kind)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("SET statement_timeout = 0")
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX}")
