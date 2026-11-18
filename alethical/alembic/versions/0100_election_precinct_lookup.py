"""Find the published races for one voting precinct."""

from alembic import op

revision = "0100_election_precinct_lookup"
down_revision = "0099_national_fcc_archive"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_election_precinct_lookup",
        "election_comparison_precinct",
        ["snapshot_id", "key"],
    )


def downgrade():
    op.drop_index(
        "ix_election_precinct_lookup", table_name="election_comparison_precinct"
    )
