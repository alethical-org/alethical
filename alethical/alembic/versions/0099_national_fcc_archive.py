"""Private national research snapshot and member-readable original file metadata."""

import sqlalchemy as sa
from alembic import op

revision = "0099_national_fcc_archive"
down_revision = "0098_election_source_provenance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "national_fcc_snapshot",
        sa.Column("snapshot_id", sa.Text, primary_key=True),
        sa.Column("index_object_key", sa.Text, nullable=False),
        sa.Column("index_sha256", sa.String(64), nullable=False),
        sa.Column("index_bytes", sa.BigInteger, nullable=False),
        sa.Column("index_rows", sa.BigInteger, nullable=False),
        sa.Column("index_stored_bytes", sa.BigInteger, nullable=False),
        sa.Column("index_stored_sha256", sa.String(64), nullable=False),
        sa.Column("source_manifest_object_key", sa.Text, nullable=False),
        sa.Column("import_sha256", sa.String(64), nullable=False),
        sa.Column("original_count", sa.Integer, nullable=False),
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
        "uq_national_fcc_active",
        "national_fcc_snapshot",
        ["active"],
        unique=True,
        postgresql_where=sa.text("active"),
    )
    op.create_table(
        "national_fcc_original",
        sa.Column(
            "snapshot_id",
            sa.Text,
            sa.ForeignKey("national_fcc_snapshot.snapshot_id"),
            primary_key=True,
        ),
        sa.Column("record_key", sa.Text, primary_key=True),
        sa.Column("service", sa.Text, nullable=False),
        sa.Column("entity_id", sa.Text, nullable=False),
        sa.Column("file_id", sa.Text, nullable=False),
        sa.Column("call_sign", sa.Text),
        sa.Column("station_name", sa.Text, nullable=False),
        sa.Column("state", sa.Text),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("folder_path", sa.Text, nullable=False),
        sa.Column("file_year", sa.Integer),
        sa.Column("source_url", sa.Text, nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("byte_size", sa.BigInteger, nullable=False),
        sa.Column("object_key", sa.Text, nullable=False),
        sa.Column("text_object_key", sa.Text),
        sa.Column("page_count", sa.Integer),
    )
    op.create_table(
        "national_fcc_read_grant",
        sa.Column("purpose", sa.Text, primary_key=True),
        sa.Column("token", sa.Text, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("purpose = 'finance-media'", name="finance_media_only"),
    )
    for table in (
        "national_fcc_snapshot",
        "national_fcc_original",
        "national_fcc_read_grant",
    ):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON TABLE {table} FROM PUBLIC")
        # The temporary token belongs only to server-side DB connections.
        roles = (
            ("anon", "authenticated", "service_role")
            if table == "national_fcc_read_grant"
            else ("anon", "authenticated")
        )
        for role in roles:
            op.execute(f"""DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname='{role}')
              THEN REVOKE ALL ON TABLE {table} FROM {role}; END IF; END $$""")


def downgrade() -> None:
    op.drop_table("national_fcc_read_grant")
    op.drop_table("national_fcc_original")
    op.drop_table("national_fcc_snapshot")
