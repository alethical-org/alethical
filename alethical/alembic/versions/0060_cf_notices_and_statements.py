"""Large-contribution notices and disclosure statements (#2347).

Six new tables and one new enum, all additive: nothing existing is altered, so the
downgrade drops exactly what the upgrade created.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0060_cf_notices_and_statements"
down_revision = "0058_cf_filer_retention"
branch_labels = None
depends_on = None

FILER_KIND = postgresql.ENUM(
    "candidate_committee",
    "party_unit",
    "political_committee_or_fund",
    name="cf_filer_kind",
    create_type=False,
)
READING_STATE = postgresql.ENUM(
    "gift_identified",
    "read",
    name="cf_statement_reading_state",
    create_type=False,
)


def _timestamps() -> list[sa.Column]:
    return [
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
    ]


def upgrade() -> None:
    READING_STATE.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "cf_notice_list_copy",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("page_sha256", sa.String(length=64), nullable=False),
        sa.Column("notice_count", sa.Integer(), nullable=False),
        sa.Column("covered_years", postgresql.JSONB(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_cf_notice_list_copy"),
    )

    op.create_table(
        "cf_contribution_notice",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("registration_number", sa.String(length=20), nullable=False),
        sa.Column("filer_kind", FILER_KIND, nullable=False),
        sa.Column("filing_year", sa.Integer(), nullable=False),
        sa.Column("notice_period", sa.String(length=20), nullable=False),
        sa.Column(
            "special_election",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("board_notice_id", sa.String(length=40), nullable=False),
        sa.Column("committee_name_as_listed", sa.Text(), nullable=True),
        sa.Column("listed_on", sa.Date(), nullable=True),
        sa.Column("first_listed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_listed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("committee_name_as_filed", sa.Text(), nullable=True),
        sa.Column("treasurer_name", sa.Text(), nullable=True),
        sa.Column("period_start", sa.Date(), nullable=True),
        sa.Column("period_end", sa.Date(), nullable=True),
        sa.Column("submitted_on", sa.Date(), nullable=True),
        sa.Column("received_on", sa.Date(), nullable=True),
        sa.Column("contributor_name", sa.Text(), nullable=True),
        sa.Column(
            "contributor_registration_number", sa.String(length=20), nullable=True
        ),
        sa.Column("employer", sa.Text(), nullable=True),
        sa.Column("city", sa.Text(), nullable=True),
        sa.Column("state", sa.Text(), nullable=True),
        sa.Column("zip_code", sa.Text(), nullable=True),
        sa.Column("contribution_date", sa.Date(), nullable=True),
        sa.Column("amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("in_kind", sa.Boolean(), nullable=True),
        sa.Column("in_kind_description", sa.Text(), nullable=True),
        sa.Column("loan", sa.Boolean(), nullable=True),
        sa.Column("parse_error", sa.Text(), nullable=True),
        sa.Column("amendment_index", sa.Integer(), nullable=True),
        sa.Column("earlier_contributor_name", sa.Text(), nullable=True),
        sa.Column("earlier_contribution_date", sa.Date(), nullable=True),
        sa.Column("earlier_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("document_hash", sa.String(length=64), nullable=True),
        sa.Column("object_key", sa.Text(), nullable=True),
        sa.Column("compressed_hash", sa.String(length=64), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mirrored_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_cf_contribution_notice"),
        sa.UniqueConstraint(
            "registration_number",
            "filing_year",
            "notice_period",
            "special_election",
            "board_notice_id",
            name="uq_cf_contribution_notice_board_id",
        ),
    )
    op.create_index(
        "ix_cf_contribution_notice_filer_year",
        "cf_contribution_notice",
        ["registration_number", "filing_year"],
    )

    op.create_table(
        "cf_notice_window_exclusion",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("registration_number", sa.String(length=20), nullable=False),
        sa.Column("election_year", sa.Integer(), nullable=False),
        sa.Column("window", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.String(length=40), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("determined_at", sa.DateTime(timezone=True), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_cf_notice_window_exclusion"),
        sa.UniqueConstraint(
            "registration_number",
            "election_year",
            "window",
            name="uq_cf_notice_window_exclusion_filer_window",
        ),
    )

    op.create_table(
        "cf_statement_scan",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("catalogues_read", sa.Integer(), nullable=False),
        sa.Column("statements_listed", sa.Integer(), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_cf_statement_scan"),
    )

    op.create_table(
        "cf_disclosure_statement",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "recipient_registration_number", sa.String(length=20), nullable=False
        ),
        sa.Column("filing_year", sa.Integer(), nullable=False),
        sa.Column("statement_number", sa.Integer(), nullable=False),
        sa.Column("listed_under_reports", postgresql.JSONB(), nullable=False),
        sa.Column("first_listed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_listed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("document_hash", sa.String(length=64), nullable=True),
        sa.Column("object_key", sa.Text(), nullable=True),
        sa.Column("compressed_hash", sa.String(length=64), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mirrored_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_cf_disclosure_statement"),
        sa.UniqueConstraint(
            "recipient_registration_number",
            "filing_year",
            "statement_number",
            name="uq_cf_disclosure_statement_number",
        ),
    )

    op.create_table(
        "cf_disclosure_statement_reading",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("statement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("state", READING_STATE, nullable=False),
        sa.Column("donor_name", sa.Text(), nullable=False),
        sa.Column("gift_date", sa.Date(), nullable=False),
        sa.Column("gift_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("box", sa.SmallInteger(), nullable=True),
        sa.Column("line_a", sa.Numeric(18, 2), nullable=True),
        sa.Column("line_b", sa.Numeric(18, 2), nullable=True),
        sa.Column("line_c", sa.Numeric(18, 2), nullable=True),
        sa.Column("signed_on", sa.Date(), nullable=True),
        sa.Column("received_on", sa.Date(), nullable=True),
        sa.Column("reviewed_by", sa.String(length=120), nullable=False),
        sa.Column(
            "reviewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("evidence", sa.Text(), nullable=False),
        sa.Column("document_hash_read", sa.String(length=64), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_cf_disclosure_statement_reading"),
        sa.ForeignKeyConstraint(
            ["statement_id"],
            ["cf_disclosure_statement.id"],
            name="fk_cf_statement_reading_statement",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "statement_id", name="uq_cf_disclosure_statement_reading_statement_id"
        ),
        sa.CheckConstraint(
            "box IS NULL OR box IN (1, 2, 3)",
            name="box_is_a_form_box",
        ),
        sa.CheckConstraint(
            "state <> 'read' OR (box IS NOT NULL AND received_on IS NOT NULL)",
            name="a_read_statement_has_its_box",
        ),
    )

    op.create_table(
        "cf_disclosure_statement_source",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reading_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("city", sa.Text(), nullable=True),
        sa.Column("state", sa.String(length=2), nullable=True),
        sa.Column("amount", sa.Numeric(18, 2), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_cf_disclosure_statement_source"),
        sa.ForeignKeyConstraint(
            ["reading_id"],
            ["cf_disclosure_statement_reading.id"],
            name="fk_cf_statement_source_reading",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "reading_id",
            "position",
            name="uq_cf_disclosure_statement_source_position",
        ),
    )


def downgrade() -> None:
    op.drop_table("cf_disclosure_statement_source")
    op.drop_table("cf_disclosure_statement_reading")
    op.drop_table("cf_disclosure_statement")
    op.drop_table("cf_statement_scan")
    op.drop_table("cf_notice_window_exclusion")
    op.drop_index(
        "ix_cf_contribution_notice_filer_year", table_name="cf_contribution_notice"
    )
    op.drop_table("cf_contribution_notice")
    op.drop_table("cf_notice_list_copy")
    READING_STATE.drop(op.get_bind(), checkfirst=True)
