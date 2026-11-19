"""Release pointer for the Finance search file covering every indexed FCC filing."""

import sqlalchemy as sa
from alembic import op

revision = "0101_national_fcc_search_release"
down_revision = "0100_election_precinct_lookup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "national_fcc_search_release",
        sa.Column("release_id", sa.Text, primary_key=True),
        sa.Column("object_key", sa.Text, nullable=False),
        sa.Column("sqlite_sha256", sa.String(64), nullable=False),
        sa.Column("sqlite_bytes", sa.BigInteger, nullable=False),
        sa.Column("stored_sha256", sa.String(64), nullable=False),
        sa.Column("stored_bytes", sa.BigInteger, nullable=False),
        sa.Column("filings", sa.BigInteger, nullable=False),
        sa.Column("saved", sa.BigInteger, nullable=False),
        sa.Column("unavailable", sa.BigInteger, nullable=False),
        sa.Column("unchecked", sa.BigInteger, nullable=False),
        sa.Column("index_through", sa.Date, nullable=False),
        sa.Column("saved_updated", sa.Date, nullable=False),
        sa.Column(
            "active", sa.Boolean, nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "uq_national_fcc_search_active",
        "national_fcc_search_release",
        ["active"],
        unique=True,
        postgresql_where=sa.text("active"),
    )
    op.execute("ALTER TABLE national_fcc_search_release ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE national_fcc_search_release FROM PUBLIC")
    for role in ("anon", "authenticated"):
        op.execute(f"""DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname='{role}')
          THEN REVOKE ALL ON TABLE national_fcc_search_release FROM {role}; END IF; END $$""")


def downgrade() -> None:
    op.drop_table("national_fcc_search_release")
