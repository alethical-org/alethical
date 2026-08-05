"""Drop rag_section_document.search_text -- written on every ingest, read by nothing (#715).

Net: every RAG ingest stored a second copy of each bill section's text with a
citation header glued on top, and nothing in the product ever read that copy. This
deletes it. Grounded Ask is untouched: it ranks ``rag_chunk`` rows by vector
similarity and never looked at this column.

Why it is safe to drop (re-verified against production Aug 4 2026, at 51,076 rows):
  * No reader in the repo -- no query selects, filters or orders by it. The
    retrieval path reads ``rag_chunk.search_text`` via ``semantic_rag_chunk_stmt``,
    a different column on a different table. The API reads this table for
    ``citation_label``, ``clean_text``, ``bill_id`` and ``bill_version_section_id``
    (``alethical/api/routers/public.py``, ``ask.py``, ``me.py``) -- never this column.
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

**Two deploy-order windows, both left open, and how to close them next time.** The
backend deploy (``railway-deploy.yml``) and this migration (``migrate.yml``) are
triggered by the same merge with no ordering between them, so both directions matter:

* *App first, migration later.* New code omits the column from its INSERTs while the
  column is still ``NOT NULL`` with no default, so an insert in that window fails.
* *Migration first, app still rolling out.* Old code still declares the column, so its
  whole-entity load of ``RagSectionDocument`` (``select(RagChunk).options(selectinload
  (RagChunk.rag_section_document))``, ``alethical/db/models.py``) names a column that is
  gone, and Grounded Ask retrieval errors until the rollout finishes.

Neither is closed here, and two earlier accounts of that were wrong. Correcting them
because both would mislead the next person dropping a *busier* column:

**A ``SET DEFAULT`` in the same transaction as the ``DROP`` does nothing.** This
revision originally ran ``ALTER COLUMN search_text SET DEFAULT ''`` immediately before
the drop, copied from ``0021_drop_legislator_is_active``, on the reasoning that an
insert arriving mid-window would take the default instead of erroring. It cannot:
``env.py`` runs each migration inside one ``context.begin_transaction()`` and
PostgreSQL DDL is transactional, so no other connection ever observes the intermediate
state. Every outside session sees either the column with no default or no column at
all. The statement was removed as the no-op it was; ``0021``'s docstring carries the
same mistaken claim and is corrected in place.

**Staging this across releases IS possible -- via a deferred column.** An earlier
version of this note claimed it was impossible, because the intermediate release needs
``models.py`` to stop naming the column while the column still exists, and
``scripts/check_schema_drift.py`` fails exactly that state (it diffs an ``alembic
upgrade head`` database against a ``create_all`` one column by column, comparing type,
nullability and default, with no per-column allowlist -- #100). That reasoning missed
``mapped_column(..., deferred=True)``: a deferred column stays in ``Base.metadata``, so
the drift check still sees it and stays green, while dropping out of whole-entity
``SELECT``\\ s -- which is precisely the statement the migration-first window breaks.
Verified against the installed SQLAlchemy. The three-release shape is: (1) add the
database default, declare it on a ``deferred=True`` column, keep every writer; (2)
remove the writers, keeping the deferred field and its default; (3) remove the field
and drop the column once every release-2 instance is live. One caveat if you use it:
an ``INSERT`` still names a deferred column in its ``RETURNING`` clause, so the field
must be gone from the model by the release that drops the column -- which step 3 does.

Shipped single-release anyway, deliberately: the exposure is a few minutes of Ask
retrieval errors on a pre-launch product, and it self-heals when the rollout finishes.
That is a judgement about *this* column's traffic, not a reason the staged path does
not exist. Use it for a column that matters.

**No immediate disk saving.** PostgreSQL's ``DROP COLUMN`` only marks the column
dropped; it rewrites no rows, so the 91 MB the column occupied inside the 240 MB table
comes back only as rows are rewritten -- and the ordinary paths do not rewrite them:
RAG re-ingest skips sections whose ``source_hash`` already matches, and the writes it
does make are upserts, not a table rebuild. ``VACUUM FULL`` is what reclaims it at
once. What lands immediately is that ingestion stops writing it and every whole-entity
load stops shipping it over the pooler unread.

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

    # Fail rather than block live traffic. DROP COLUMN needs ACCESS EXCLUSIVE, and a
    # lock it cannot get would otherwise queue indefinitely -- with every reader
    # arriving behind it queueing too. Five seconds, then the migration and the deploy
    # fail, which is recoverable. Transaction-scoped (``env.py`` runs each migration
    # inside ``context.begin_transaction()``), so it reverts on its own.
    op.execute("SET LOCAL lock_timeout = '5s'")
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
