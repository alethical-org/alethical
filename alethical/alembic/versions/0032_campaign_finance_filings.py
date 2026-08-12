"""Store what each committee itself reported, and Minnesota's registered-filer list.

Net: the 3 download tables hold the payments Minnesota itemized. These 6 tables hold
what each committee said it raised and spent in total, plus the state's own list of
registered filers. Without them no page may print a total at all, because roughly 4
dollars in 10 that a sitting member raised has no name attached and
`.claude/rules/grounded-answers.md` rule 12 requires both numbers on the screen.

They also turn on the 2 checks the download loader has been recording as "not run"
since #1328: every registration number can now be resolved against a real filer list,
and every filer's itemized rows can be checked against that filer's own reported
total. Those are the only checks that watch one committee's money rather than the
whole file's shape, which is what a file with 2 committees' amounts swapped between
them slipped past.

Additive only: 6 new tables, 1 new enum, and 1 nullable column on `cf_release` naming
the figures a published download set was reconciled against. No existing row changes
and nothing existing is rewritten, so the downgrade is a clean drop. Round-tripped
upgrade -> downgrade -> upgrade against real Postgres.

Design: docs/architecture/campaign-finance-system-design.md §9 (Filed reports: where
the official totals come from).

Revision ID: 0032_campaign_finance_filings
Revises: 0031_cf_record_set_hash
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0032_campaign_finance_filings"
down_revision = "0031_cf_record_set_hash"
branch_labels = None
depends_on = None

# Reused from #1328 rather than redefined, so a filings snapshot moves through the same
# 4 states a download snapshot does and an operator reads one vocabulary.
SNAPSHOT_STATUS = postgresql.ENUM(
    "fetched",
    "quarantined",
    "loaded",
    "pruned",
    name="cf_snapshot_status",
    create_type=False,
)
FILER_KIND = postgresql.ENUM(
    "candidate_committee",
    "party_unit",
    "political_committee_or_fund",
    name="cf_filer_kind",
    create_type=False,
)


def upgrade() -> None:
    FILER_KIND.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "cf_filing_snapshot",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("fetch_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fetch_completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", SNAPSHOT_STATUS, nullable=False),
        sa.Column("record_set_hash", sa.String(length=64), nullable=True),
        sa.Column("years", postgresql.JSONB(), nullable=True),
        sa.Column("segments", postgresql.JSONB(), nullable=True),
        sa.Column("filer_count", sa.Integer(), nullable=True),
        sa.Column("report_count", sa.Integer(), nullable=True),
        sa.Column("filing_count", sa.Integer(), nullable=True),
        sa.Column("figure_count", sa.Integer(), nullable=True),
        sa.Column("filer_years_without_figures", sa.Integer(), nullable=True),
        sa.Column("reported_contributions_sum", sa.Numeric(20, 4), nullable=True),
        sa.Column("measurements", postgresql.JSONB(), nullable=False),
        sa.Column("validation_json", postgresql.JSONB(), nullable=False),
        sa.Column("error_text", sa.Text(), nullable=True),
        sa.Column("ingestion_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("object_key", sa.Text(), nullable=True),
        sa.Column("compressed_hash", sa.String(length=64), nullable=True),
        sa.Column("compressed_byte_size", sa.BigInteger(), nullable=True),
        sa.Column("compression", sa.String(length=20), nullable=False),
        sa.Column("response_count", sa.Integer(), nullable=True),
        sa.Column("mirrored_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["ingestion_run_id"], ["ingestion_run.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    # Partial, because a run whose responses could not be read has no record set and
    # more than one of those may be retained. Where there is one, it is the run's
    # identity, and it is what makes re-running on unchanged figures publish nothing.
    op.create_index(
        "uq_cf_filing_snapshot_record_set_hash",
        "cf_filing_snapshot",
        ["record_set_hash"],
        unique=True,
        postgresql_where=sa.text("record_set_hash IS NOT NULL"),
    )
    op.create_index("ix_cf_filing_snapshot_status", "cf_filing_snapshot", ["status"])

    op.create_table(
        "cf_filing_current",
        sa.Column("id", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("snapshot_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("id", name="single_row"),
        sa.ForeignKeyConstraint(["snapshot_id"], ["cf_filing_snapshot.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "cf_filer",
        sa.Column("snapshot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("registration_number", sa.String(length=20), nullable=False),
        sa.Column("kind", FILER_KIND, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("candidate_name", sa.Text(), nullable=True),
        sa.Column("party", sa.String(length=20), nullable=True),
        sa.Column("office", sa.String(length=60), nullable=True),
        sa.Column("district", sa.String(length=20), nullable=True),
        sa.Column("registration_date", sa.Date(), nullable=True),
        sa.Column("termination_date", sa.Date(), nullable=True),
        sa.Column("is_incumbent", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(
            ["snapshot_id"], ["cf_filing_snapshot.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("snapshot_id", "registration_number"),
    )

    op.create_table(
        "cf_filing_report",
        sa.Column("snapshot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("registration_number", sa.String(length=20), nullable=False),
        sa.Column("filing_year", sa.Integer(), nullable=False),
        sa.Column("report_type", sa.String(length=8), nullable=False),
        sa.Column("report_name", sa.Text(), nullable=True),
        sa.Column("cut_off_date", sa.Date(), nullable=True),
        sa.Column("special_election", sa.Boolean(), nullable=False),
        # Nullable: NULL means the catalogue carries no amendment record for this
        # report, which is ordinary before 2008, and 0 would wrongly assert that the
        # original version is the effective one.
        sa.Column("effective_amendment_index", sa.Integer(), nullable=True),
        sa.Column("amendment_count", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["snapshot_id"], ["cf_filing_snapshot.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("snapshot_id", "row_number"),
    )
    op.create_index(
        "ix_cf_filing_report_filer_year",
        "cf_filing_report",
        ["snapshot_id", "registration_number", "filing_year"],
    )

    op.create_table(
        "cf_filing",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("snapshot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("registration_number", sa.String(length=20), nullable=False),
        sa.Column("filer_kind", FILER_KIND, nullable=False),
        sa.Column("filing_year", sa.Integer(), nullable=False),
        sa.Column("segment_start", sa.Integer(), nullable=False),
        sa.Column("segment_end", sa.Integer(), nullable=False),
        sa.Column("block_heading", sa.Text(), nullable=False),
        sa.Column("reported_through", sa.Date(), nullable=True),
        sa.Column("response_hash", sa.String(length=64), nullable=False),
        sa.Column("archive_line", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["snapshot_id"], ["cf_filing_snapshot.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "snapshot_id",
            "registration_number",
            "filing_year",
            name="uq_cf_filing_snapshot_filer_year",
        ),
    )

    # Which set of reported figures a published download release was reconciled
    # against. Nullable, so every existing row keeps its meaning: a release published
    # before the figures existed genuinely has no answer.
    op.add_column(
        "cf_release",
        sa.Column("filing_snapshot_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_cf_release_filing_snapshot_id_cf_filing_snapshot",
        "cf_release",
        "cf_filing_snapshot",
        ["filing_snapshot_id"],
        ["id"],
    )

    op.create_table(
        "cf_filing_figure",
        sa.Column("filing_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("line_key", sa.String(length=48), nullable=False),
        sa.Column("label_as_served", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.ForeignKeyConstraint(["filing_id"], ["cf_filing.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("filing_id", "line_key"),
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_cf_release_filing_snapshot_id_cf_filing_snapshot", "cf_release", type_="foreignkey"
    )
    op.drop_column("cf_release", "filing_snapshot_id")
    op.drop_table("cf_filing_figure")
    op.drop_table("cf_filing")
    op.drop_index("ix_cf_filing_report_filer_year", table_name="cf_filing_report")
    op.drop_table("cf_filing_report")
    op.drop_table("cf_filer")
    op.drop_table("cf_filing_current")
    op.drop_index("ix_cf_filing_snapshot_status", table_name="cf_filing_snapshot")
    op.drop_index(
        "uq_cf_filing_snapshot_record_set_hash", table_name="cf_filing_snapshot"
    )
    op.drop_table("cf_filing_snapshot")
    # Dropped after its last user, and only this migration created it. The snapshot
    # status enum is left alone: #1328's tables still use it.
    FILER_KIND.drop(op.get_bind(), checkfirst=True)
