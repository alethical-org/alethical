"""Drop rag_section_document.search_text -- written on every ingest, read by nothing (#715).

Net: every RAG ingest stored a second copy of each bill section's text with a header
glued on top, and nothing in the product ever read that copy. This deletes it. Ask
retrieval is untouched: it ranks ``rag_chunk`` rows by vector similarity and never
looked at this column.

Why it is safe to drop (all verified against production, Jul 2026):
  * No reader in the repo -- no query selects or filters it; the frontend never
    names it; the Grounded-Ask path runs on ``rag_chunk.search_text`` via
    ``semantic_rag_chunk_stmt``, a different column on a different table.
  * No reader in the database -- zero ``pg_depend`` entries on the column, and no
    view, materialized view, rule, index, generated column, default, check
    constraint, trigger, RLS policy, extended statistic, or replication publication
    touches it.
  * No ad-hoc reader -- ``pg_stat_statements`` (recording since 2026-03-29) holds no
    hand-written query against it. The only statements naming it are SQLAlchemy
    whole-entity loads, which list every mapped column whether or not the caller
    reads the attribute. The table is also RLS-enabled with zero policies, so the
    Supabase REST API returns no rows from it to any client.
  * No planned reader -- the hybrid keyword-retrieval plan (#380) indexes
    ``rag_chunk.search_text``, because its lexical arm must rank the same units as
    the vector arm it fuses with (chunks) for Reciprocal Rank Fusion to join them.

What it cost: 80 MB of the table's 239 MB, at ~1781 bytes/row across 47,265 rows --
larger than the ``clean_text`` it wrapped (~1079 bytes/row), because the header
re-stored the bill's full long title once per section. Every ORM load of a section
row shipped it over the pooler unread, including Ask retrieval's ``selectinload``.

Reversibility: the downgrade restores the column and its NOT NULL constraint, so the
schema round-trips exactly. It cannot restore the original *strings* -- it backfills
each row from ``clean_text``, without the header. That loses nothing recoverable:
every one of the 47,265 production rows was exactly
``full_section_prefix(...) + "\\n\\n" + clean_text`` (checked: 47,265/47,265 both
start with "Bill: " and end with their own ``clean_text``), and re-running RAG
ingestion rewrites the column from source anyway. Pre-drop code writes this column
and never reads it, so a rolled-back deploy is unaffected by the filler value.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
# Keep the revision id <= 32 chars -- alembic_version.version_num is varchar(32).
revision = "0015_drop_rag_section_search"
down_revision = "0014_status_key_action_history"
branch_labels = None
depends_on = None

TABLE = "rag_section_document"
COLUMN = "search_text"


def _has_column(bind) -> bool:
    return COLUMN in {col["name"] for col in sa.inspect(bind).get_columns(TABLE)}


def upgrade() -> None:
    bind = op.get_bind()
    # On a fresh database the 0001 baseline builds this table from the ORM metadata,
    # which no longer declares the column -- so there is nothing to drop there. Guard
    # for that (and for prod schema drift), same coexistence pattern as 0010/0013.
    if _has_column(bind):
        op.drop_column(TABLE, COLUMN)


def downgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind):
        return
    op.add_column(TABLE, sa.Column(COLUMN, sa.Text(), nullable=True))
    # Filler, not a restore: the header (bill number, bill title, article/section
    # headings) is gone. See the module docstring -- pre-drop code writes this column
    # and never reads it, and a RAG re-ingest overwrites it from source.
    op.execute(f"UPDATE {TABLE} SET {COLUMN} = clean_text WHERE {COLUMN} IS NULL")
    op.alter_column(TABLE, COLUMN, nullable=False)
