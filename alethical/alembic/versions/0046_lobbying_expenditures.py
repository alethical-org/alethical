"""Hold Minnesota's lobbying principal-expenditure records as dated snapshots.

Net: our research piece *The Money Only Goes One Way* states $886 million of lobbying
spending across 3,056 organisations, summed from the Board's own published rows — and we
held none of the records behind it, so it was the only cross-member figure we publish
that no recompute of ours protects (#1862). These 4 tables hold that download the same
way the campaign-finance downloads are held: a dated snapshot with the exact bytes
retained, parsed rows keyed (snapshot_id, row_number), a single-row pointer naming the
live snapshot, and an append-only record of every fetch.

Lobbying is its own pipeline rather than a 4th slot in cf_release, whose 3-named-columns
shape deliberately cannot grow one: it comes from a different landing page on a
different filing cycle (annual, due 15 March), and nothing joins it to the
campaign-finance sets day-for-day. Source measurements:
docs/architecture/campaign-finance-system-design.md §2.2 (Lobbying).

The snapshot reuses the existing cf_snapshot_status enum, the way cf_filing_snapshot
does: the lifecycle (fetched / quarantined / loaded / pruned) is identical, and a second
enum with the same 4 values would be a second answer nobody consults. No new enum, so
the downgrade drops only the 4 tables; the enum stays with 0029, its owner.

Naming the columns object_key, compressed_hash and mirrored_at on the snapshot is what
makes the existing second-copy job cover these bodies from the day this ships (#1501).

The 3 foreign keys onto the snapshot carry explicit names because the naming
convention's fk_<table>_<column>_<referred table> exceeds Postgres's 63-character
identifier cap with these table names.

Additive only: 4 new tables, no enum, no existing row changed. The downgrade is a clean
drop, and it drops only the rows saying where the objects are — the objects themselves
stay, because docs/architecture/campaign-finance-system-design.md §4.5 retains every
stored body indefinitely. Round-tripped upgrade -> downgrade -> upgrade against real
Postgres.

Revision ID: 0046_lobbying_expenditures
Revises: 0045_committee_link_basis
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0046_lobbying_expenditures"
down_revision = "0045_committee_link_basis"
branch_labels = None
depends_on = None

# The enum already exists (0029 created it); this migration only references it.
snapshot_status = postgresql.ENUM(
    "fetched",
    "quarantined",
    "loaded",
    "pruned",
    name="cf_snapshot_status",
    create_type=False,
)


def upgrade() -> None:
    op.create_table(
        "lobbying_expenditure_snapshot",
        # Signed integer, as text: the file we want is NEGATIVE (-728390027), so
        # a \d+ pattern silently resolves a different address.
        sa.Column("download_id", sa.String(length=32), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("content_disposition_filename", sa.Text(), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("record_set_hash", sa.String(length=64), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        # The fetch window lives on the snapshot because one dataset means the
        # snapshot is the release, and publish() compares windows to refuse
        # replacing newer data with older data.
        sa.Column("fetch_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fetch_completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=True),
        sa.Column(
            "column_names", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("status", snapshot_status, nullable=False),
        sa.Column("total_spent_sum", sa.Numeric(precision=20, scale=4), nullable=True),
        sa.Column(
            "negative_amount_sum", sa.Numeric(precision=20, scale=4), nullable=True
        ),
        sa.Column("distinct_row_count", sa.Integer(), nullable=True),
        sa.Column("distinct_entity_count", sa.Integer(), nullable=True),
        sa.Column("duplicate_entity_year_count", sa.Integer(), nullable=True),
        sa.Column("total_mismatch_count", sa.Integer(), nullable=True),
        sa.Column("entity_ids_with_multiple_names_count", sa.Integer(), nullable=True),
        sa.Column("names_with_multiple_entity_ids_count", sa.Integer(), nullable=True),
        sa.Column(
            "rows_by_report_year",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "blank_counts_by_column",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("malformed_quote_record_count", sa.Integer(), nullable=True),
        sa.Column(
            "validation_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("error_text", sa.Text(), nullable=True),
        # The retained body, folded onto this row the way cf_filing_snapshot does
        # it: there is exactly one body per snapshot. No server default on
        # compression, matching the other body tables: the model's default="gzip"
        # is the one writer.
        sa.Column("object_key", sa.Text(), nullable=True),
        sa.Column("compressed_hash", sa.String(length=64), nullable=True),
        sa.Column("compressed_byte_size", sa.BigInteger(), nullable=True),
        sa.Column("compression", sa.String(length=20), nullable=False),
        sa.Column("mirrored_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lobbying_expenditure_snapshot")),
        sa.UniqueConstraint(
            "content_hash",
            name=op.f("uq_lobbying_expenditure_snapshot_content_hash"),
        ),
        sa.UniqueConstraint(
            "object_key", name=op.f("uq_lobbying_expenditure_snapshot_object_key")
        ),
    )
    # The real identity of the data. Partial, because an unparseable download has
    # no record set and more than one of those can be retained.
    op.create_index(
        "uq_lobbying_expenditure_snapshot_record_set_hash",
        "lobbying_expenditure_snapshot",
        ["record_set_hash"],
        unique=True,
        postgresql_where=sa.text("record_set_hash IS NOT NULL"),
    )
    op.create_index(
        "ix_lobbying_expenditure_snapshot_status",
        "lobbying_expenditure_snapshot",
        ["status"],
        unique=False,
    )

    op.create_table(
        "lobbying_expenditure_row",
        sa.Column("snapshot_id", sa.UUID(), nullable=False),
        # The 1-based CSV record number. With snapshot_id it traces a figure back
        # to a line in one specific dated download; it is NOT an identity across
        # downloads.
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("principal", sa.Text(), nullable=True),
        # Text exactly as printed, like every registration number here.
        sa.Column("entity_id", sa.Text(), nullable=True),
        # The calendar year the money was SPENT, not the year the report was
        # filed (§2.2).
        sa.Column("report_year", sa.Integer(), nullable=True),
        sa.Column(
            "puc_lobbying_amount", sa.Numeric(precision=18, scale=4), nullable=True
        ),
        sa.Column(
            "legislative_lobbying_amount",
            sa.Numeric(precision=18, scale=4),
            nullable=True,
        ),
        sa.Column(
            "administrative_lobbying_amount",
            sa.Numeric(precision=18, scale=4),
            nullable=True,
        ),
        sa.Column(
            "mgu_lobbying_amount", sa.Numeric(precision=18, scale=4), nullable=True
        ),
        sa.Column(
            "general_lobbying_amount", sa.Numeric(precision=18, scale=4), nullable=True
        ),
        sa.Column("total_spent", sa.Numeric(precision=18, scale=4), nullable=True),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["lobbying_expenditure_snapshot.id"],
            name="fk_lobbying_expenditure_row_snapshot",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "snapshot_id", "row_number", name=op.f("pk_lobbying_expenditure_row")
        ),
    )
    op.create_index(
        "ix_lobbying_expenditure_row_entity",
        "lobbying_expenditure_row",
        ["entity_id", "report_year"],
        unique=False,
    )

    op.create_table(
        "lobbying_expenditure_current",
        sa.Column("id", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("snapshot_id", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "id", name=op.f("ck_lobbying_expenditure_current_single_row")
        ),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["lobbying_expenditure_snapshot.id"],
            name="fk_lobbying_expenditure_current_snapshot",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lobbying_expenditure_current")),
    )

    op.create_table(
        "lobbying_fetch_observation",
        sa.Column("snapshot_id", sa.UUID(), nullable=False),
        sa.Column("ingestion_run_id", sa.UUID(), nullable=True),
        sa.Column("download_id", sa.String(length=32), nullable=False),
        sa.Column("requested_url", sa.Text(), nullable=False),
        sa.Column("final_url", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "response_headers", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("reused_existing_snapshot", sa.Boolean(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["lobbying_expenditure_snapshot.id"],
            name="fk_lobbying_fetch_observation_snapshot",
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_run_id"],
            ["ingestion_run.id"],
            name=op.f("fk_lobbying_fetch_observation_ingestion_run_id_ingestion_run"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lobbying_fetch_observation")),
    )
    op.create_index(
        "ix_lobbying_fetch_observation_started",
        "lobbying_fetch_observation",
        ["started_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("lobbying_fetch_observation")
    op.drop_table("lobbying_expenditure_current")
    op.drop_table("lobbying_expenditure_row")
    op.drop_table("lobbying_expenditure_snapshot")
    # cf_snapshot_status stays: 0029 owns it, and the cf tables still use it.
