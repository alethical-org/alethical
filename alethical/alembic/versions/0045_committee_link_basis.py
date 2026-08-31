"""Save why each legislator-committee match was confirmed, not only which one.

Net: confirming that a campaign account belongs to a named politician is the one
decision on this site that no machine may make, and the row we save records which
account was chosen without recording on what basis. These 4 columns record the basis, as
the 3 signals the review screen printed plus the snapshot they were computed from.

Why it has to land before the first sitting rather than after: the other
``_as_reviewed`` columns snapshot the committee, so which account was picked survives.
The reasoning does not. The screen is gone when a sitting ends, the Board's
contributions download changes daily, and re-running reads a different file, so on the
weaker cases a re-run may not reach the same answer. A decision's basis is either
captured as it is made or lost (#1354, #1398, campaign-finance-system-design.md 5.1).

All 4 nullable: a decision written before this landed genuinely has no stored basis, and
a backfilled guess about what a person saw would be worse than an honest blank. Zero
rows exist in production today, so nothing is being left blank in practice.

Additive only: 4 nullable columns on one table, no enum, no index, no existing row
changed. The downgrade is a clean drop of the same 4. Round-tripped
upgrade -> downgrade -> upgrade against real Postgres.

Revision ID: 0045_committee_link_basis
Revises: 0044_published_source_copy
"""

import sqlalchemy as sa
from alembic import op

revision = "0045_committee_link_basis"
down_revision = "0044_published_source_copy"
branch_labels = None
depends_on = None

TABLE = "legislator_campaign_committee"
COLUMNS = (
    # 'exact' | 'shortened' | 'published_nickname' | 'surname_only'
    ("name_evidence_as_reviewed", 30),
    # the registered-filer directory's verdict, per campaign-finance-system-design.md 9.7
    ("filer_directory_as_reviewed", 30),
    # 'agrees' | 'disagrees' | 'no_party_on_record' | 'no_party_money'
    ("party_agreement_as_reviewed", 30),
    # the newest payment date in the download read, as YYYY-MM-DD
    ("records_through_as_reviewed", 10),
)


def upgrade() -> None:
    for name, length in COLUMNS:
        op.add_column(TABLE, sa.Column(name, sa.String(length=length), nullable=True))


def downgrade() -> None:
    for name, _ in reversed(COLUMNS):
        op.drop_column(TABLE, name)
