"""Drop rag_section_document.search_text -- written on every ingest, read by nothing (#715).

Net: every RAG ingest stored a second copy of each bill section's text with a
citation header glued on top, and nothing in the product ever read that copy. This
deletes it. Grounded Ask is untouched: it ranks ``rag_chunk`` rows by vector
similarity and never looked at this column.

Why it is safe to drop (re-verified against production Aug 4 2026, at 51,076 rows):
  * No reader in the repo -- no query selects, filters or orders by it. The
    retrieval path reads ``rag_chunk.search_text`` via ``semantic_rag_chunk_stmt``,
    a different column on a different table. The API's only reads of this table
    name ``citation_label`` and ``clean_text`` explicitly
    (``alethical/api/routers/public.py``).
  * No reader in the database -- zero ``pg_depend`` entries on the column, and no
    view, materialized view, rule, index, generated column, default, check
    constraint, trigger, RLS policy, extended statistic or replication publication
    touches it.
  * No ad-hoc reader -- of the 12 statements in ``pg_stat_statements`` naming it,
    every one is either an INSERT or a SQLAlchemy whole-entity load. A whole-entity
    load lists every *mapped* column whether or not the caller reads the attribute,
    so removing the column from ``models.py`` is what stops those statements naming
    it.
  * No planned reader -- the hybrid keyword-retrieval plan (#380) indexes
    ``rag_chunk.search_text``, because its lexical arm must rank the same units as
    the vector arm it fuses with (chunks) for Reciprocal Rank Fusion to join them.

**Two deploy-order windows, one closed here and one that cannot be.** The backend
deploy (``railway-deploy.yml``) and this migration (``migrate.yml``) are triggered by
the same merge with no ordering between them, so both directions have to be reasoned
about -- the same problem ``0021_drop_legislator_is_active`` closed for
``legislator.is_active``.

*App first, migration later.* New code omits the column from its INSERTs while the
column is still ``NOT NULL`` with no default, so an insert arriving in that window
would fail. ``SET DEFAULT ''`` before the drop removes this entirely: an insert in
the window takes the empty string from the database instead of erroring, and a moment
later the column is gone. Two statements, one transaction, no coordination. Straight
from 0021.

*Migration first, app still rolling out.* Old code still declares the column, so its
whole-entity load of ``RagSectionDocument`` (``select(RagChunk).options(selectinload
(RagChunk.rag_section_document))``, ``alethical/db/models.py``) names a column that no
longer exists, and Grounded Ask retrieval errors until the rollout finishes. This one
is **not** closable by staging the change across releases, which is worth writing down
because it looks like it should be: the release that would fix it is one where
``models.py`` has stopped naming the column while the column still exists, and
``scripts/check_schema_drift.py`` fails exactly that state -- it diffs an ``alembic
upgrade head`` database against a ``create_all`` one column by column, comparing type,
nullability and default, so a model edit without its migration is a red build by
design (#100). The window is therefore inherent to this repo's drift guard, self-heals
when the rollout completes, and is the same one 0021 shipped with a day earlier on a
column that rode along in every legislator query the site serves.

**No immediate disk saving.** PostgreSQL's ``DROP COLUMN`` only marks the column
dropped; it rewrites no rows, so the 91 MB the column occupies inside the 240 MB table
comes back gradually as rows are updated, or at once only under ``VACUUM FULL`` or a
fresh RAG re-ingest. What lands immediately is that ingestion stops writing it and
every whole-entity load stops shipping it over the pooler unread.

What it cost while it lived: ~1,781 bytes/row across 51,076 rows -- larger than the
``clean_text`` it wrapped (~1,079 bytes/row), because the header re-stored the bill's
full long title once per section, roughly 4.5 times per bill.

**Reversibility.** The downgrade restores the column so a rolled-back deploy runs; it
does not restore the strings, and does not pretend to. It re-adds the column
*nullable and empty* rather than backfilling 51,076 rows from ``clean_text``: that
UPDATE would hold the table's ACCESS EXCLUSIVE lock for its whole duration, rewrite
every row, and leave the old copies behind as bloat -- all to populate a column that
pre-drop code writes and never reads. Nothing is lost that was recoverable: every one
of the 51,076 production rows was exactly ``full_section_prefix(...) + "\\n\\n" +
clean_text`` (checked: 51,076/51,076 both start with "Bill: " and end with their own
``clean_text``), and a RAG re-ingest rewrites the column from source anyway. Same
honest-nullable shape as ``0023_drop_chat_session_subject_legislator_id``.

Revision ID: 0024_drop_rag_section_search
Revises: 0023_drop_chat_session_leg
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
# Keep the revision id <= 32 chars -- alembic_version.version_num is varchar(32).
revision = "0024_drop_rag_section_search"
down_revision = "0023_drop_chat_session_leg"
branch_labels = None
depends_on = None

TABLE = "rag_section_document"
COLUMN = "search_text"


def _has_column(bind) -> bool:
    return COLUMN in {col["name"] for col in sa.inspect(bind).get_columns(TABLE)}


def upgrade() -> None:
    bind = op.get_bind()
    # Idempotent so a re-run and a drifted database both behave. Note this is *not*
    # a fresh-database no-op guard: since #100 replaced the ``create_all`` baseline
    # with explicit DDL, ``0001`` creates this column outright, so the drop below
    # genuinely fires on a brand-new database too.
    if not _has_column(bind):
        return

    # Fail fast rather than block live traffic. DROP COLUMN needs ACCESS EXCLUSIVE,
    # and a lock it cannot take immediately would queue -- with every reader arriving
    # behind it queueing too. Transaction-scoped (``env.py`` runs each migration
    # inside ``context.begin_transaction()``), so it reverts on its own.
    op.execute("SET LOCAL lock_timeout = '5s'")
    # Close the app-first window before opening it, per 0021.
    op.execute(f"ALTER TABLE {TABLE} ALTER COLUMN {COLUMN} SET DEFAULT ''")
    op.drop_column(TABLE, COLUMN)


def downgrade() -> None:
    """Re-add the column nullable and empty, so a rolled-back deploy runs.

    Deliberately not a restore: see the module docstring. Pre-drop code supplies a
    value on every insert and reads the column nowhere, so nullable is sufficient and
    a 51,076-row backfill would cost a full table rewrite for a value nothing reads.
    """
    bind = op.get_bind()
    if _has_column(bind):
        return

    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column(TABLE, sa.Column(COLUMN, sa.Text(), nullable=True))
