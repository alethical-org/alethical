"""Let a signed-in reader follow a campaign committee, as a bookmark.

Net: a reader can already save a bill to their Tracked list; this adds the table that
remembers which campaign committees they follow (#1943). One row per reader per
registration number, and nothing else -- no alerts flag and no note, because following
a committee notifies nobody and the page that lists these says so.

Keyed on the Board's registration number rather than a foreign key into ``cf_filer``,
because the register is replaced whole on every snapshot and a row pointing at one
snapshot's filer would be orphaned by the next load. ``legislator_campaign_committee``
makes the same choice for the same reason.

Additive: one new table, no existing row read or written. Round-tripped
upgrade -> downgrade -> upgrade against real Postgres.

Revision ID: 0051_tracked_committee
Revises: 0050_committee_link_withdrawal
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0051_tracked_committee"
down_revision = "0050_committee_link_withdrawal"
branch_labels = None
depends_on = None

TABLE = "tracked_committee"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("registration_number", sa.String(length=20), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
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
            name=op.f("fk_tracked_committee_user_id_user_account"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tracked_committee")),
        sa.UniqueConstraint(
            "user_id",
            "registration_number",
            name=op.f("uq_tracked_committee_user_id_registration_number"),
        ),
    )


def downgrade() -> None:
    op.drop_table(TABLE)
