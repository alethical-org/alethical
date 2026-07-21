"""Merge the two 0008 migration heads.

#489 (0008_legislator_election_history) and #510 (0008_policy_area_count) were
each branched off 0007 and merged independently, leaving Alembic with two heads.
Neither PR's CI caught it — the collision only exists on main once both landed
(classic merge-skew). Two heads make ``alembic upgrade head`` fail, which breaks
prod migration and the test-suite conftest (`alembic upgrade head`). This is a
no-op merge revision that rejoins them into a single head; it changes no schema.
"""

from __future__ import annotations

# revision identifiers, used by Alembic.
# Keep the revision id <= 32 chars — alembic_version.version_num is varchar(32).
revision = "0009_merge_0008_heads"
down_revision = ("0008_legislator_election_history", "0008_policy_area_count")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
