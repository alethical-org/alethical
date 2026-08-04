"""Drop chat_session.subject_legislator_id — a column only production has (#855).

The other half of the out-of-band "representative evidence" feature (#288), applied
straight to production from the unmerged branch
``codex/representative-lookup-followups``. ``0022`` dropped that feature's table;
this drops its column. ``models.py`` has never declared it, so no database built
from this repository has it and this migration is a no-op everywhere but
production.

**Its own migration on purpose.** ``chat_session`` is a live table — signed-in
users' bill-scoped chat runs on it (``.claude/rules/grounded-answers.md`` rule 8) —
and ``ALTER TABLE ... DROP COLUMN`` takes an ACCESS EXCLUSIVE lock. Bundling it
with a drop of a table nobody touches would have hidden a real risk behind a safe
one.

``lock_timeout`` is set to 5 seconds for exactly that reason. The drop itself is
instantaneous (Postgres only marks the column dropped; it rewrites nothing), so the
only way this hurts is by *queuing* behind an open transaction on ``chat_session``
and making every request behind it queue too. With the timeout, a lock it cannot
take immediately fails the migration and the deploy, which is recoverable; without
it, the migration would wait and take live traffic down with it.

**What is in the column.** 6 of 37 chat sessions, all belonging to the seed account
``ada@example.com``, all created 2026-06-13/14 in the same hours the feature ran,
titled "Manual auth bypass test", "Patti vote test" and "… public-record AI" —
the feature's own tests, pointing at 2 legislators. They are captured before this
runs (``~/.alethical-backups/``, outside this public repository, since chat rows
belong to a user account). The remaining 31 sessions have nothing in the column.

**What downgrade can and cannot do.** It re-adds the column, nullable, with the
foreign key production had. It cannot re-add the 6 values — a revision that could
would have to carry them, and they do not belong in a public repository. The
capture file holds them as ready-to-run ``UPDATE`` statements.

Nothing reads the column. ``models.py`` does not declare it, which settles it
structurally rather than by grep: SQLAlchemy emits exactly the mapped columns, so
current code *cannot* produce a statement naming it. The statements in
``pg_stat_statements`` that do name it are the out-of-band feature's own, plus the
legislator-merge ``UPDATE`` this revision also removes. Re-confirmed over a window
of live traffic before the drop.

Revision ID: 0023_drop_chat_session_leg
Revises: 0022_drop_evidence_document
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0023_drop_chat_session_leg"
down_revision = "0022_drop_evidence_document"
branch_labels = None
depends_on = None

COLUMN = "subject_legislator_id"


def _has_column(bind) -> bool:
    return any(
        c["name"] == COLUMN for c in sa.inspect(bind).get_columns("chat_session")
    )


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_column(bind):
        return

    # Fail fast rather than block live traffic. A DROP COLUMN needs ACCESS
    # EXCLUSIVE, and a lock it cannot take immediately would otherwise queue --
    # and every reader arriving behind it queues too. Transaction-scoped, so it
    # reverts on its own.
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_column("chat_session", COLUMN)


def downgrade() -> None:
    """Re-add the column and its foreign key, empty.

    The 6 values are not here on purpose: they are rows from a user's account and
    this repository is public. They live in the capture taken before the upgrade
    ran, as ``UPDATE`` statements ready to run once this has rebuilt the column.
    """
    bind = op.get_bind()
    if _has_column(bind):
        return

    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column(
        "chat_session",
        sa.Column(COLUMN, postgresql.UUID(as_uuid=True), nullable=True),
    )
    # PostgreSQL's own default name (``*_fkey``), not this repository's
    # ``fk_<table>_<column>_<target>`` convention, because that is what the
    # out-of-band feature created. A downgrade rebuilds what was there.
    op.create_foreign_key(
        "chat_session_subject_legislator_id_fkey",
        "chat_session",
        "legislator",
        [COLUMN],
        ["id"],
    )
