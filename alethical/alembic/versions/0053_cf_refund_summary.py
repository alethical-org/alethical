"""Hold Minnesota's yearly Political Contribution Refund summaries.

Net: adds 3 tables so a legislator's campaign money tab can later show how much the
state refunded to the people who gave to their committee, year by year. Minnesota
publishes those figures once a year as PDFs and nowhere else, so the rows are read off
the printed page and kept exactly as printed.

``cf_refund_summary`` is one copy of one published file, and carries ``object_key``,
``compressed_hash`` and ``mirrored_at``, which is the whole contract for a new kind of
stored body: the second-copy job reads which tables hold one out of the schema rather
than from a list, so the Cloudflare R2 mirror covers these files from the day they ship
(``docs/architecture/campaign-finance-system-design.md`` §4.5).
``cf_refund_row`` is one printed line. ``cf_refund_not_published`` records a year the
Board published nothing for, so "Minnesota published none" can never be confused with
"we have not loaded it yet".

Additive only: 3 new tables and 2 new enum types, nothing existing is altered or
dropped. Round-tripped upgrade -> downgrade -> upgrade against real Postgres.

Revision ID: 0053_cf_refund_summary
Revises: 0052_site_metric_history
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
# Keep the revision id <= 32 chars — alembic_version.version_num is varchar(32).
revision = "0053_cf_refund_summary"
down_revision = "0052_site_metric_history"
branch_labels = None
depends_on = None

SUMMARY = "cf_refund_summary"
ROW = "cf_refund_row"
NOT_PUBLISHED = "cf_refund_not_published"

REFUND_KIND = postgresql.ENUM(
    "candidate",
    "party_unit",
    name="cf_refund_kind",
    create_type=False,
)
REFUND_STATUS = postgresql.ENUM(
    "fetched",
    "published",
    "superseded",
    "quarantined",
    name="cf_refund_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    REFUND_KIND.create(bind, checkfirst=True)
    REFUND_STATUS.create(bind, checkfirst=True)

    op.create_table(
        SUMMARY,
        # No server default: the model's UUIDPrimaryKeyMixin generates the id in
        # Python, matching every other table here.
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("kind", REFUND_KIND, nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("compressed_hash", sa.String(length=64), nullable=False),
        sa.Column("compressed_byte_size", sa.BigInteger(), nullable=False),
        # No server default on compression, matching the other body tables: the
        # model's default="gzip" is applied in Python, so a server default here would
        # be a second answer to one question.
        sa.Column("compression", sa.String(length=20), nullable=False),
        sa.Column("mirrored_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fetched_on", sa.Date(), nullable=False),
        sa.Column("fetch_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fetch_completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column(
            "unreadable_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("prints_cents", sa.Boolean(), nullable=False),
        sa.Column(
            "printed_total_amount", sa.Numeric(precision=18, scale=2), nullable=True
        ),
        sa.Column("printed_total_count", sa.Integer(), nullable=True),
        sa.Column("status", REFUND_STATUS, nullable=False),
        sa.Column(
            "validation_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("ingestion_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["ingestion_run_id"],
            ["ingestion_run.id"],
            name=op.f("fk_cf_refund_summary_ingestion_run_id_ingestion_run"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cf_refund_summary")),
        sa.UniqueConstraint(
            "year", "kind", "content_hash", name="uq_cf_refund_summary_year_kind_hash"
        ),
    )
    # One published file per year and kind, so a person's page can never add 2 copies of
    # one year together. Partial, because superseded and quarantined copies are kept.
    op.create_index(
        "uq_cf_refund_summary_published",
        SUMMARY,
        ["year", "kind"],
        unique=True,
        postgresql_where=sa.text("status = 'published'"),
    )

    op.create_table(
        ROW,
        sa.Column("summary_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("printed_name", sa.Text(), nullable=False),
        sa.Column("printed_line", sa.Text(), nullable=False),
        sa.Column("office_sought", sa.Text(), nullable=True),
        sa.Column("office", sa.String(length=60), nullable=True),
        sa.Column("district", sa.String(length=20), nullable=True),
        sa.Column("party", sa.String(length=40), nullable=True),
        sa.Column("section_heading", sa.Text(), nullable=True),
        # Nullable on purpose: the whole 2024 candidate summary publishes no count, and a
        # missing count is never written down as 0.
        sa.Column("contribution_count", sa.Integer(), nullable=True),
        sa.Column("refunded_amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("matched_registration_number", sa.String(length=20), nullable=True),
        sa.Column("name_evidence", sa.String(length=30), nullable=True),
        sa.Column("register_verdict", sa.String(length=30), nullable=True),
        sa.Column("party_agreement", sa.String(length=30), nullable=True),
        sa.Column(
            "matched_against_filing_snapshot_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("matched_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["summary_id"],
            [f"{SUMMARY}.id"],
            name=op.f("fk_cf_refund_row_summary_id_cf_refund_summary"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["matched_against_filing_snapshot_id"],
            ["cf_filing_snapshot.id"],
            name="fk_cf_refund_row_filing_snapshot",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint(
            "summary_id", "row_number", name=op.f("pk_cf_refund_row")
        ),
    )
    op.create_index(
        "ix_cf_refund_row_match", ROW, ["matched_registration_number", "summary_id"]
    )

    op.create_table(
        NOT_PUBLISHED,
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("kind", REFUND_KIND, nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("observed_on", sa.Date(), nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("served_media_type", sa.String(length=120), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
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
        sa.PrimaryKeyConstraint(
            "year", "kind", name=op.f("pk_cf_refund_not_published")
        ),
    )


def downgrade() -> None:
    op.drop_table(NOT_PUBLISHED)
    op.drop_index("ix_cf_refund_row_match", table_name=ROW)
    op.drop_table(ROW)
    op.drop_index("uq_cf_refund_summary_published", table_name=SUMMARY)
    op.drop_table(SUMMARY)
    bind = op.get_bind()
    REFUND_STATUS.drop(bind, checkfirst=True)
    REFUND_KIND.drop(bind, checkfirst=True)
