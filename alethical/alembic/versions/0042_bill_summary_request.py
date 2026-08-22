"""Store appendix context and one request for each exact official bill text.

Net: a saved bill-text change can create one replacement-summary request that
survives restarts, records its bounded provider use, and cannot be duplicated for
the same bill, current version, source-text fingerprint, prompt-context version,
and prepared-prompt fingerprint.

Revision ID: 0042_bill_summary_request
Revises: 0041_confirmation_password_guard
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0042_bill_summary_request"
down_revision = "0041_confirmation_password_guard"
branch_labels = None
depends_on = None

REQUEST_STATUS = postgresql.ENUM(
    "waiting_for_search",
    "ready",
    "processing",
    "completed",
    "failed",
    "ambiguous",
    "superseded",
    name="bill_summary_request_status",
    create_type=False,
)


def upgrade() -> None:
    REQUEST_STATUS.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "bill_version",
        sa.Column("appendix_parser_version", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "bill_version",
        sa.Column("appendix_source_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "bill_version",
        sa.Column(
            "appendix_parse_complete",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "bill_version",
        sa.Column("appendix_present", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "bill_version",
        sa.Column("change_role_parser_version", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "bill_version",
        sa.Column(
            "change_role_parse_complete",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "bill_version",
        sa.Column(
            "bill_summary_context_baselined",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "bill_version_section",
        sa.Column(
            "change_role_segments",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "bill_version_section",
        sa.Column("change_role_source_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "bill_version_section",
        sa.Column(
            "change_role_parse_complete",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.create_table(
        "bill_version_appendix_reference",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("bill_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_order", sa.Integer(), nullable=False),
        sa.Column("reference_kind", sa.String(length=30), nullable=False),
        sa.Column("official_reference", sa.Text(), nullable=False),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column(
            "body_blocks",
            postgresql.JSONB(astext_type=sa.Text(), none_as_null=True),
            nullable=True,
        ),
        sa.Column("source_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "bill_version_section_id", postgresql.UUID(as_uuid=True), nullable=True
        ),
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
            "reference_kind IN ('repealed_statute', "
            "'repealed_session_law', 'repealed_rule')",
            name=op.f("ck_bill_version_appendix_reference_reference_kind"),
        ),
        sa.CheckConstraint(
            "(bill_version_section_id IS NOT NULL AND raw_text IS NULL "
            "AND body_blocks IS NULL) OR "
            "(bill_version_section_id IS NULL AND raw_text IS NOT NULL)",
            name=op.f("ck_bill_version_appendix_reference_one_content_source"),
        ),
        sa.ForeignKeyConstraint(
            ["bill_version_id"],
            ["bill_version.id"],
            name=op.f(
                "fk_bill_version_appendix_reference_bill_version_id_bill_version"
            ),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["bill_version_section_id"],
            ["bill_version_section.id"],
            name=op.f(
                "fk_bill_version_appendix_reference_bill_version_section_id_bill_version_section"
            ),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bill_version_appendix_reference")),
        sa.UniqueConstraint(
            "bill_version_id",
            "source_order",
            name="uq_bill_version_appendix_reference_order",
        ),
    )
    op.create_index(
        "ix_bill_version_appendix_reference_section",
        "bill_version_appendix_reference",
        ["bill_version_section_id"],
        unique=False,
    )

    op.create_table(
        "bill_summary_request",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        # Historical identity values, deliberately not foreign keys. Source-data
        # cleanup must never erase paid-use, budget, or exact-once evidence.
        sa.Column("bill_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("bill_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_text_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("prompt_context_version", sa.String(length=50), nullable=False),
        sa.Column("prepared_prompt_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("model_name", sa.String(length=100), nullable=False),
        sa.Column("status", REQUEST_STATUS, nullable=False),
        sa.Column(
            "provider_attempt_limit",
            sa.SmallInteger(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "provider_attempts",
            sa.SmallInteger(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "provider_call_started_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column("provider_claim_job_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "provider_call_finished_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column("failure_kind", sa.String(length=80), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("cache_creation_input_tokens", sa.Integer(), nullable=True),
        sa.Column("cache_read_input_tokens", sa.Integer(), nullable=True),
        sa.Column(
            "provider_response_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "reserved_cost_microusd",
            sa.BigInteger(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("actual_cost_microusd", sa.BigInteger(), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bill_summary_request")),
        sa.UniqueConstraint(
            "bill_id",
            "bill_version_id",
            "source_text_fingerprint",
            "prompt_context_version",
            "prepared_prompt_fingerprint",
            name="uq_bill_summary_request_exact_prompt",
        ),
    )
    op.create_index(
        "ix_bill_summary_request_status",
        "bill_summary_request",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_bill_summary_request_status", table_name="bill_summary_request")
    op.drop_table("bill_summary_request")
    op.drop_index(
        "ix_bill_version_appendix_reference_section",
        table_name="bill_version_appendix_reference",
    )
    op.drop_table("bill_version_appendix_reference")
    op.drop_column("bill_version_section", "change_role_parse_complete")
    op.drop_column("bill_version_section", "change_role_source_hash")
    op.drop_column("bill_version_section", "change_role_segments")
    op.drop_column("bill_version", "bill_summary_context_baselined")
    op.drop_column("bill_version", "change_role_parse_complete")
    op.drop_column("bill_version", "change_role_parser_version")
    op.drop_column("bill_version", "appendix_present")
    op.drop_column("bill_version", "appendix_parse_complete")
    op.drop_column("bill_version", "appendix_source_hash")
    op.drop_column("bill_version", "appendix_parser_version")
    REQUEST_STATUS.drop(op.get_bind(), checkfirst=True)
