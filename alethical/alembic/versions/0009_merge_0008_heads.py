"""Merge the two concurrent 0008 migration heads into one.

#510 (0008_policy_area_count) and #489 (0008_legislator_election_history) were
authored in parallel sessions and both chain from 0007_denormalize_bill_signals,
so after both merged, main had two alembic heads. That makes `alembic upgrade
head` ambiguous -- it breaks conftest's DB setup (backend CI) and the migrate
workflow. This is an empty merge revision that unifies the two heads; it changes
no schema. Both 0008 tables/columns already exist independently.
"""

from __future__ import annotations

# revision identifiers, used by Alembic.
# Keep the revision id <= 32 chars -- alembic_version.version_num is varchar(32).
revision = "0009_merge_0008_heads"
down_revision = ("0008_policy_area_count", "0008_legislator_election_history")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
