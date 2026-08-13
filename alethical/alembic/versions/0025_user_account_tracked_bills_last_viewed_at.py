"""Record when a user last looked at their tracked-bills page.

The tracked-bills page shows each saved bill's current status but has never said
whether anything happened since the reader last looked. Since the product cannot
send email (#36), returning to the page is the only way a person learns a bill
they saved has moved, so the page has to carry that signal itself — and that
needs a per-user comparison point (#1009).

``user_account.last_signed_in_at`` is NOT usable for this. Hence a column of its own,
written only by ``POST /me/tracked-bills/viewed``.

(As written, this revision said the reason was that ``alethical/api/auth.py``
overwrote that column on every authenticated request, so it always read "just now".
That was true when this shipped and stopped being true days later: #990 (#108) removed
the read-path writes, so it is now set only when an identity is first provisioned.
The conclusion is unchanged and the migration is unaffected — the note is corrected
here rather than rewritten away, because an applied revision is a record of what was
believed when it ran. Revision 0034 later adds ``last_identity_linked_at`` beside
this old name so the application can switch safely; a later cleanup removes the
old name only after every Railway copy uses the honest one.)

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
