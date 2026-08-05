"""Record when a user last looked at their tracked-bills page.

The tracked-bills page shows each saved bill's current status but has never said
whether anything happened since the reader last looked. Since the product cannot
send email (#36), returning to the page is the only way a person learns a bill
they saved has moved, so the page has to carry that signal itself — and that
needs a per-user comparison point (#1009).

``user_account.last_signed_in_at`` is NOT usable for this. ``alethical/api/auth.py``
overwrites it on every authenticated request, so by the time the page renders it
already reads "just now" and nothing is ever newer than it. Hence a column of its
own, written only by ``POST /me/tracked-bills/viewed``.

Additive and reversible: one nullable timestamptz on an existing table, with no
default, no backfill, no index and no constraint. Every existing row keeps NULL,
which the API reads as "first visit" — the honest state for a user who has never
had a recorded visit. The downgrade drops only this column.

Revision ID: 0025_tracked_bills_last_viewed
Revises: 0024_drop_rag_section_search
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0025_tracked_bills_last_viewed"
down_revision = "0024_drop_rag_section_search"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_account",
        sa.Column(
            "tracked_bills_last_viewed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("user_account", "tracked_bills_last_viewed_at")
