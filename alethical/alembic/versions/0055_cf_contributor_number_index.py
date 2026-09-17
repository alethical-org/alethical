"""Index the contributor's registration number on the contributions file.

Net: a lobbyist's page lists the campaign donations that lobbyist made, and finding them
read the whole live contributions file, because no index covered the column holding the
donor's own registration number. On production that one question walked 583,222 rows
and took 0.5 s of a 0.7 s page (`EXPLAIN (ANALYZE, BUFFERS)`, 17 Sep 2026). With the
index it is a direct lookup.

One partial B-tree index on ``(snapshot_id, contrib_reg_num)``, snapshot first because
every reader filters both and the snapshot narrows first, so a superseded snapshot's
entries leave the index when its rows are deleted (the same shape as migration 0040).
Partial on ``contrib_reg_num IS NOT NULL`` because 497,451 of the live file's 583,222
rows are individuals with no number at all, and an index need not hold the rows no
lookup by number can match; the planner proves ``contrib_reg_num = '1733'`` implies the
predicate on its own.

Additive and reversible: 1 index, no table, no column, no row changed. Round-tripped
upgrade -> downgrade -> upgrade against real Postgres.

Built with ``CREATE INDEX CONCURRENTLY``, which Postgres refuses inside a transaction,
so the build runs in Alembic's ``autocommit_block``: the migration's own transaction is
committed first and reopened afterwards. This is what lets the deployment build it
without taking the write lock a plain ``CREATE INDEX`` holds for the whole build, so
the nightly load is never blocked. The cost of that choice is that a build interrupted
halfway leaves an *invalid* index behind, which ``IF NOT EXISTS`` would then skip on
the retry; ``pg_index.indisvalid`` says so, and ``DROP INDEX`` followed by a rerun is
the repair.

Revision ID: 0055_cf_contributor_number_index
Revises: 0054_lobbying_registrations
"""

from alembic import op

revision = "0055_cf_contributor_number_index"
down_revision = "0054_lobbying_registrations"
branch_labels = None
depends_on = None

INDEX = "ix_cf_contribution_row_snapshot_contrib_number"


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("SET statement_timeout = 0")
        op.execute(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {INDEX} "
            "ON cf_contribution_row (snapshot_id, contrib_reg_num) "
            "WHERE contrib_reg_num IS NOT NULL"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("SET statement_timeout = 0")
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX}")
