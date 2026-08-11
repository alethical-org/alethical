"""Give each campaign finance snapshot an order-independent hash of its records.

Net: the Board's downloads are byte-unstable. Fetching the same file 3 times
seconds apart returned 3 different sha256 hashes at an identical byte size and an
identical set of records in a different order (41,130 records, 35,905 of 41,130
positions differing, measured 11 Aug 2026). So a hash of the response bytes cannot
answer "did the data change" -- every run would look like a new file, republish,
and renumber every row. This column answers it: a hash over the file's records,
sorted, so it is the same whenever the records are the same and changes the moment
one of them does. The raw byte hash stays, because it identifies the exact bytes we
kept (#1328).

Additive only: one nullable column and one partial unique index, so the downgrade
is a clean drop. Nullable because a download that cannot be parsed has no record
set, and those are retained too.

Revision ID: 0031_cf_record_set_hash
Revises: 0030_campaign_finance_rows
"""

import sqlalchemy as sa
from alembic import op

revision = "0031_cf_record_set_hash"
down_revision = "0030_campaign_finance_rows"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cf_snapshot", sa.Column("record_set_hash", sa.String(length=64), nullable=True)
    )
    # Partial, because an unparseable download has no record set and several of
    # those may exist per dataset. Where there is one, it is the dataset's identity.
    op.create_index(
        "uq_cf_snapshot_dataset_record_set_hash",
        "cf_snapshot",
        ["dataset", "record_set_hash"],
        unique=True,
        postgresql_where=sa.text("record_set_hash IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_cf_snapshot_dataset_record_set_hash", table_name="cf_snapshot")
    op.drop_column("cf_snapshot", "record_set_hash")
