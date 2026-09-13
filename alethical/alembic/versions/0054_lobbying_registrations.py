"""Keep contact-free active lobbyists and publish the two lobbying copies together.

Net: additive tables keep only names and registered organisations, and one pointer
names the active list and spending copy that were validated in the same run.

Revision ID: 0054_lobbying_registrations
Revises: 0053_cf_refund_summary
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0054_lobbying_registrations"
down_revision = "0053_cf_refund_summary"
branch_labels = None
depends_on = None


def timestamps():
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "lobbyist_snapshot",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("download_id", sa.String(32), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("record_set_hash", sa.String(64)),
        sa.Column("fetch_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fetch_completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("association_count", sa.Integer(), nullable=False),
        sa.Column("unparsed_association_count", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(name="cf_snapshot_status", create_type=False),
            nullable=False,
        ),
        sa.Column("validation_json", postgresql.JSONB(), nullable=False),
        *timestamps(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lobbyist_snapshot")),
    )
    op.create_index(
        "ix_lobbyist_snapshot_copied", "lobbyist_snapshot", ["fetch_completed_at"]
    )
    op.create_table(
        "lobbyist_row",
        sa.Column("snapshot_id", sa.UUID(), nullable=False),
        sa.Column("registration_number", sa.String(20), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("formatted_name", sa.Text(), nullable=False),
        sa.Column("first_name", sa.Text()),
        sa.Column("middle_initial", sa.Text()),
        sa.Column("last_name", sa.Text()),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["lobbyist_snapshot.id"],
            ondelete="CASCADE",
            name=op.f("fk_lobbyist_row_snapshot_id_lobbyist_snapshot"),
        ),
        sa.PrimaryKeyConstraint(
            "snapshot_id", "registration_number", name=op.f("pk_lobbyist_row")
        ),
    )
    op.create_index("ix_lobbyist_row_name", "lobbyist_row", ["name"])
    op.create_table(
        "lobbyist_association",
        sa.Column("snapshot_id", sa.UUID(), nullable=False),
        sa.Column("registration_number", sa.String(20), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("principal_name", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["snapshot_id", "registration_number"],
            ["lobbyist_row.snapshot_id", "lobbyist_row.registration_number"],
            name="fk_lobbyist_association_row",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "snapshot_id",
            "registration_number",
            "position",
            name=op.f("pk_lobbyist_association"),
        ),
    )
    op.create_index(
        "ix_lobbyist_association_entity",
        "lobbyist_association",
        ["entity_id", "snapshot_id"],
    )
    op.create_table(
        "lobbying_release",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("previous_release_id", sa.UUID(), nullable=True),
        sa.Column("expenditure_snapshot_id", sa.UUID(), nullable=False),
        sa.Column("lobbyist_snapshot_id", sa.UUID(), nullable=False),
        sa.Column("fetch_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("copied_at", sa.DateTime(timezone=True), nullable=False),
        *timestamps(),
        sa.ForeignKeyConstraint(
            ["expenditure_snapshot_id"],
            ["lobbying_expenditure_snapshot.id"],
            name="fk_lobbying_release_expenditure",
        ),
        sa.ForeignKeyConstraint(
            ["lobbyist_snapshot_id"],
            ["lobbyist_snapshot.id"],
            name=op.f("fk_lobbying_release_lobbyist_snapshot_id_lobbyist_snapshot"),
        ),
        sa.ForeignKeyConstraint(
            ["previous_release_id"],
            ["lobbying_release.id"],
            name="fk_lobbying_release_previous",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lobbying_release")),
    )
    op.create_index("ix_lobbying_release_copied", "lobbying_release", ["copied_at"])
    op.create_table(
        "lobbying_current_release",
        sa.Column("id", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("release_id", sa.UUID()),
        *timestamps(),
        sa.CheckConstraint("id", name=op.f("ck_lobbying_current_release_single_row")),
        sa.ForeignKeyConstraint(
            ["release_id"],
            ["lobbying_release.id"],
            name=op.f("fk_lobbying_current_release_release_id_lobbying_release"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lobbying_current_release")),
    )


def downgrade() -> None:
    op.drop_table("lobbying_current_release")
    op.drop_table("lobbying_release")
    op.drop_table("lobbyist_association")
    op.drop_table("lobbyist_row")
    op.drop_table("lobbyist_snapshot")
