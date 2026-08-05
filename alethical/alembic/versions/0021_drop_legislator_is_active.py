"""Drop the dead legislator.is_active column.

Whether someone currently holds office is answered by
``LegislatorServicePeriod.is_current`` (#332). ``legislator.is_active`` has never
answered anything: all 206 production rows are ``true``, no index or constraint uses
it, and nothing reads the value. It only survives because the ORM lists every model
column in its ``SELECT``, so it rides along in every legislator query the site serves
and looks busy in ``pg_stat_statements`` while meaning nothing.

Closes #349. Supersedes the draft in #354, which built the same change in July and was
held because production's alembic history had diverged (#288). That divergence was
resolved, and #100 replaced the ``create_all`` baseline the draft's guard was written
against, so this is rebuilt on the current head rather than rebased across 396 commits.

**The deploy-order window this closes, which the earlier draft could not.**
In production the column is ``NOT NULL`` with **no server default** (verified Aug 4
2026). Removing it from ``models.py`` stops the app sending a value, and the backend
deploy and ``migrate.yml`` are triggered by the same merge — so if the app reaches
production first, every ``INSERT INTO legislator`` fails on the not-null constraint
until the migration lands. Roster ingestion is human-triggered, so the window is
narrow rather than certain, which is exactly the kind of risk that gets waved through.

Setting a server default *before* dropping was meant to remove that window entirely:
an insert arriving in it would get ``true`` from the database instead of an error.

**Correction (#715, Aug 2026): it does not, and the default below is a no-op.** Both
statements run inside one transaction -- ``env.py`` wraps each migration in
``context.begin_transaction()`` and PostgreSQL DDL is transactional -- so no other
connection ever observes the intermediate state. Every outside session sees either the
column with no default or no column at all, exactly as if the default were never set.
The window this claimed to close stayed open; it did not bite, because roster ingestion
is human-triggered and nothing was running. The statement is left in place because this
revision is already applied and removing it would change nothing.

What *does* close a window like this is staging the change across releases behind a
``mapped_column(..., deferred=True)`` field: deferred keeps the column in
``Base.metadata`` so ``scripts/check_schema_drift.py`` stays green, while dropping it
out of whole-entity ``SELECT``\\ s. The full shape is written up in
``0024_drop_rag_section_search_text``.

Revision ID: 0021_drop_legislator_is_active
Revises: 0020_notification_event_shape
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0021_drop_legislator_is_active"
down_revision = "0020_notification_event_shape"
branch_labels = None
depends_on = None


def _has_column(bind) -> bool:
    return any(
        c["name"] == "is_active" for c in sa.inspect(bind).get_columns("legislator")
    )


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_column(bind):
        return

    # A no-op, kept because this revision is already applied. It was meant to let an
    # insert arriving between the app deploy and this migration take the default
    # instead of failing, but both statements share one transaction, so no other
    # connection ever sees the default. See the module docstring's correction.
    op.execute("ALTER TABLE legislator ALTER COLUMN is_active SET DEFAULT true")
    op.drop_column("legislator", "is_active")


def downgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind):
        return

    # Re-added with a server default and backfilled to true, matching every production
    # row's value. Without the default this would fail on a non-empty table, and the
    # downgrade would only work on an empty database, which is not a downgrade.
    op.add_column(
        "legislator",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
