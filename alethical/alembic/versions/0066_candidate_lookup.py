"""Public candidate records and private profile ownership requests.

Revision ID: 0066_candidate_lookup
Revises: 0065_editorial_comments
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0066_candidate_lookup"
down_revision = "0065_editorial_comments"
branch_labels = None
depends_on = None
TABLES = (
    "candidate_snapshot",
    "candidate_record",
    "candidate_claim",
    "candidate_statement",
    "candidate_statement_revision",
    "candidate_statement_report",
)


def upgrade():
    op.create_table(
        "candidate_snapshot",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("election_id", sa.String(20), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("public_payload", postgresql.JSONB(), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "candidate_record",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("election_id", sa.String(20), nullable=False),
        sa.Column("election_date", sa.Date(), nullable=False),
        sa.Column("public_payload", postgresql.JSONB(), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_candidate_record_election_id", "candidate_record", ["election_id"]
    )
    op.create_table(
        "candidate_claim",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "candidate_id",
            sa.String(64),
            sa.ForeignKey("candidate_record.id"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.UUID(),
            sa.ForeignKey("user_account.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("evidence_url", sa.Text(), nullable=False),
        sa.Column("request_note", sa.Text(), nullable=False),
        sa.Column("review_note", sa.Text()),
        sa.Column(
            "reviewed_by",
            sa.UUID(),
            sa.ForeignKey("user_account.id", ondelete="SET NULL"),
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("candidate_id", "user_id"),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'withdrawn', 'revoked')",
            name="status",
        ),
    )
    op.create_index(
        "ix_candidate_claim_candidate_id", "candidate_claim", ["candidate_id"]
    )
    op.create_index("ix_candidate_claim_user_id", "candidate_claim", ["user_id"])
    op.create_index(
        "uq_candidate_claim_approved",
        "candidate_claim",
        ["candidate_id"],
        unique=True,
        postgresql_where=sa.text("status = 'approved'"),
    )
    op.create_table(
        "candidate_statement",
        sa.Column(
            "candidate_id",
            sa.String(64),
            sa.ForeignKey("candidate_record.id"),
            primary_key=True,
        ),
        sa.Column(
            "claim_id",
            sa.UUID(),
            sa.ForeignKey("candidate_claim.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.CheckConstraint("length(body) <= 2000", name="body_length"),
    )
    op.create_table(
        "candidate_statement_revision",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "candidate_id",
            sa.String(64),
            sa.ForeignKey("candidate_record.id"),
            nullable=False,
        ),
        sa.Column(
            "claim_id",
            sa.UUID(),
            sa.ForeignKey("candidate_claim.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("action IN ('published', 'removed')", name="action"),
    )
    op.create_index(
        "ix_candidate_statement_revision_claim_id",
        "candidate_statement_revision",
        ["claim_id"],
    )
    op.create_table(
        "candidate_statement_report",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "candidate_id",
            sa.String(64),
            sa.ForeignKey("candidate_record.id"),
            nullable=False,
        ),
        sa.Column(
            "claim_id",
            sa.UUID(),
            sa.ForeignKey("candidate_claim.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("statement_body", sa.Text(), nullable=False),
        sa.Column("statement_version", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
    )
    # Public records are read through the API. No direct browser database grants,
    # including private claim evidence and the administrator's decision notes.
    for name in TABLES:
        op.execute(f'ALTER TABLE public."{name}" ENABLE ROW LEVEL SECURITY')
    table_names = ", ".join(f"'{name}'" for name in TABLES)
    op.execute(f"""
        DO $$ BEGIN
            IF (
                SELECT count(*) FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind = 'r'
                  AND c.relname IN ({table_names}) AND c.relrowsecurity
            ) <> 6 OR EXISTS (
                SELECT 1 FROM pg_policy p
                JOIN pg_class c ON c.oid = p.polrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname IN ({table_names})
            ) THEN
                RAISE EXCEPTION 'Candidate records require RLS enabled and zero policies';
            END IF;
        END $$;
    """)


def downgrade():
    for name in reversed(TABLES):
        op.drop_table(name)
