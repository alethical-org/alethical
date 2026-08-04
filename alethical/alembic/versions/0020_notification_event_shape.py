"""Replace production's fossil notification_event with the shape the code expects.

Production runs a 12-column email-delivery-queue table (``channel``, ``subject``,
``body``, ``payload_json``, ``status``, ``scheduled_for``, ``source_hash``,
``failure_reason``), from a design the product abandoned. ``models.py`` declares a
7-column status-change log. The two have never matched, and nothing noticed because
``0002_notification_event`` skips itself whenever the table already exists — a guard
that was correct while ``0001`` built every table from the models, and the exact
mechanism by which a fossil survives. #100 removed that cause; this removes the fossil.

Recorded as findings D2, D11 and R5 in
``docs/operations/production-database-schema-drift.md``. **19 of that audit's 39 raw
differences are this one table**, the single largest divergence between repo and
production.

Why DROP and CREATE rather than a column-by-column ALTER: the two tables describe
different things. An email queue and a status-change log happen to share a name; six of
production's columns are NOT NULL with no default, so there is no meaningful conversion
of one into the other. Altering would dress a replacement up as an evolution.

**Why this is safe: the table holds 0 rows**, verified against production Aug 4 2026, and
nothing references it — no inbound foreign key, no view, no rule, no trigger, no stored
function, no row-level-security policy (all checked directly in ``pg_depend``,
``pg_rewrite``, ``pg_proc`` and ``pg_policies``). The upgrade re-checks emptiness itself
and aborts rather than dropping rows, because "0 rows" measured earlier is not the same
as "0 rows now".

The landmine this clears (finding R5): ``record_bill_status_change`` in
``alethical/api/services/notifications.py`` writes ``old_status_code``,
``new_status_code``, ``old_status`` and ``new_status``. Production's table has none of
them and requires six other columns to be non-null, so the insert fails outright. It has
never fired — the function's only caller is its own test — so whoever wires up #36 would
have hit it on the first real write.

``0002_notification_event`` is deliberately left alone. Rewriting an applied revision
changes history other databases have already run; a new revision that supersedes it is
the honest way to say the shape changed.

Revision ID: 0020_notification_event_shape
Revises: 0019_ai_enrichment_identity
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0020_notification_event_shape"
down_revision = "0019_ai_enrichment_identity"
branch_labels = None
depends_on = None


def _table_exists(bind) -> bool:
    return sa.inspect(bind).has_table("notification_event")


def upgrade() -> None:
    bind = op.get_bind()

    if _table_exists(bind):
        # Re-check now rather than trusting the count taken when this was written.
        # Dropping a table someone has started using is the one way this loses data.
        rows = bind.execute(sa.text("SELECT count(*) FROM notification_event")).scalar()
        if rows:
            raise RuntimeError(
                f"notification_event holds {rows} rows. This revision replaces the "
                "table wholesale and was written on the basis that it is empty "
                "(verified Aug 4 2026). Migrate the rows deliberately, then re-run."
            )
        # No CASCADE on purpose: an unexpected dependency should stop this migration
        # rather than be swept away by it.
        op.drop_table("notification_event")

    # Drop ONLY notification_event_status (finding D11). It exists solely for the
    # column dropped above: in production it is used by notification_event.status and
    # nothing else, and locally it is used by nothing at all.
    #
    # notification_channel is deliberately NOT dropped, though the fossil also used it.
    # `notification_preference.channel` is a live column on a live table (1 row in
    # production), so the type outlives this table. A first draft dropped both and the
    # local round trip failed with "Use DROP ... CASCADE" — which is precisely the
    # value of not writing CASCADE: an unexpected dependency stops the migration
    # instead of being swept away by it.
    op.execute("DROP TYPE IF EXISTS notification_event_status")

    op.create_table(
        "notification_event",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), nullable=False, primary_key=True
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("bill_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("old_status_code", sa.String(length=50), nullable=True),
        sa.Column("new_status_code", sa.String(length=50), nullable=True),
        sa.Column("old_status", sa.String(length=200), nullable=True),
        sa.Column("new_status", sa.String(length=200), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user_account.id"],
            name="fk_notification_event_user_id_user_account",
        ),
        sa.ForeignKeyConstraint(
            ["bill_id"], ["bill.id"], name="fk_notification_event_bill_id_bill"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_notification_event"),
    )
    op.create_index(
        "ix_notification_event_user_unsent",
        "notification_event",
        ["user_id", "sent_at"],
    )


def downgrade() -> None:
    """Rebuild production's fossil shape, transcribed from the live table.

    Honest about its limit: this restores the *shape*, not any rows written while the
    new shape was in place. Those columns do not exist on the old table, so there is
    nowhere to put them. Downgrading after real use is a deliberate data decision, not
    something a revision can make safe on its own.
    """
    bind = op.get_bind()
    if _table_exists(bind):
        op.drop_index(
            "ix_notification_event_user_unsent", table_name="notification_event"
        )
        op.drop_table("notification_event")

    # notification_channel was never dropped by the upgrade (notification_preference
    # still uses it), so it is here already; created defensively only for a database
    # that never had it.
    op.execute(
        "DO $$ BEGIN "
        "CREATE TYPE notification_channel AS ENUM ('email'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
    )
    op.execute(
        "DO $$ BEGIN "
        "CREATE TYPE notification_event_status AS ENUM "
        "('pending', 'sent', 'failed'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
    )
    op.create_table(
        "notification_event",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), nullable=False, primary_key=True
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("bill_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "channel",
            postgresql.ENUM(name="notification_channel", create_type=False),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("source_hash", sa.String(length=128), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("payload_json", postgresql.JSONB(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(name="notification_event_status", create_type=False),
            nullable=False,
        ),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_notification_event"),
    )
