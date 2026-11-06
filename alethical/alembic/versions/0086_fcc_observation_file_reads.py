"""Read the TV-file collector's per-file history without grouping every scan.

Each collector run chose its downloads by grouping every saved file observation
(about 1.1 million rows): the newest download attempt per file, the newest
baseline per file as whole rows, and the first scan that listed each file. They
averaged 4.3, 38.3 and 4.2 seconds a run, and slowed every other read of the
table. The collector now looks up only the files the run listed, 1 at a time.
Two partial indexes serve those lookups: the download attempts alone, and every
file observation keyed in the baseline's newest-first order. No source rows
change. Build concurrently to keep scans and reads open. An interrupted build's
invalid index is removed on retry before rebuilding.

Revision ID: 0086_fcc_observation_file_reads
Revises: 0085_finance_graph_position
"""

from alembic import op
from sqlalchemy import text

revision = "0086_fcc_observation_file_reads"
down_revision = "0085_finance_graph_position"
branch_labels = None
depends_on = None

INDEXES = {
    "ix_fcc_observation_file_attempt": (
        "(facility_id, (details ->> 'file_id'), observed_at DESC) "
        "WHERE kind = 'file' AND status NOT IN ('unchanged', 'deferred')"
    ),
    "ix_fcc_observation_file_history": (
        "(facility_id, (details ->> 'file_id'), observed_at DESC, scan_id DESC) "
        "WHERE kind = 'file'"
    ),
}


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for name, definition in INDEXES.items():
            valid = op.get_bind().scalar(
                text(
                    "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:name)"
                ),
                {"name": "public." + name},
            )
            if valid is False:
                op.execute(f"DROP INDEX CONCURRENTLY public.{name}")
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} "
                f"ON public.fcc_observation {definition}"
            )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name in INDEXES:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS public.{name}")
