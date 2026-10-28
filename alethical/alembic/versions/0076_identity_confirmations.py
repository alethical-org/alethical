"""Hold Alethical Finance's identity confirmations, their evidence and history.

A confirmed person or organization ties records together only through a link
that names its evidence: a saved source row, its printed text and the check
date. Nothing is ever inferred from equal names or numbers. A merge keeps the
old identity as a redirect; a split keeps it as a list of what replaced it
(Finance decisions D23 and D24; docs/architecture/alethical-finance-architecture.md).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0076_identity_confirmations"
down_revision = "0075_finance_access_list"
branch_labels = None
depends_on = None

RECORD_KINDS = (
    "'donor_name','employer_name','payee_name','independent_payee_name',"
    "'committee','lobbyist','principal','legislator','public_person'"
)
EVIDENCE_SOURCES = (
    "'cf_contribution_row','cf_expenditure_row','cf_independent_expenditure_row',"
    "'cf_filer','lobbyist_row','lobbying_expenditure_row','official_page'"
)
TABLES = ("identity_entity", "identity_link", "identity_event")


def upgrade() -> None:
    op.create_table(
        "identity_entity",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        sa.Column(
            "merged_into_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("identity_entity.id"),
        ),
        sa.Column("made_by_alethical_team", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint("kind IN ('person','organization')", name="entity_kind"),
        sa.CheckConstraint(
            "status IN ('active','merged','split')", name="entity_status"
        ),
        sa.CheckConstraint(
            "(status = 'merged') = (merged_into_id IS NOT NULL)", name="entity_merge"
        ),
        sa.CheckConstraint("merged_into_id <> id", name="entity_not_self"),
        sa.CheckConstraint("length(btrim(name)) > 0", name="entity_name"),
    )
    op.create_table(
        "identity_link",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "entity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("identity_entity.id"),
            nullable=False,
        ),
        sa.Column("record_kind", sa.Text(), nullable=False),
        sa.Column("record_key", sa.Text(), nullable=False),
        sa.Column("relation", sa.Text(), nullable=False),
        sa.Column("evidence_source", sa.Text(), nullable=False),
        sa.Column("evidence_snapshot_id", postgresql.UUID(as_uuid=True)),
        sa.Column("evidence_locator", sa.Text()),
        sa.Column("evidence_url", sa.Text()),
        sa.Column("evidence_quote", sa.Text(), nullable=False),
        sa.Column("basis", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="confirmed"),
        sa.Column(
            "checked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True)),
        sa.Column("withdrawal_reason", sa.Text()),
        sa.Column("made_by_alethical_team", sa.Boolean(), nullable=False),
        sa.CheckConstraint(f"record_kind IN ({RECORD_KINDS})", name="link_record_kind"),
        sa.CheckConstraint(
            f"evidence_source IN ({EVIDENCE_SOURCES})", name="link_evidence_source"
        ),
        sa.CheckConstraint("status IN ('confirmed','withdrawn')", name="link_status"),
        sa.CheckConstraint(
            "(status = 'withdrawn') = (withdrawn_at IS NOT NULL"
            " AND withdrawal_reason IS NOT NULL)",
            name="link_withdrawal",
        ),
        sa.CheckConstraint(
            "(evidence_source = 'official_page') = (evidence_url IS NOT NULL)",
            name="link_evidence_url",
        ),
    )
    op.create_index("ix_identity_link_entity_id", "identity_link", ["entity_id"])
    # 1 standing confirmation per record: a printed spelling or registration
    # belongs to at most 1 identity at a time.
    op.create_index(
        "uq_identity_link_confirmed_record",
        "identity_link",
        ["record_kind", "record_key"],
        unique=True,
        postgresql_where=sa.text("status = 'confirmed'"),
    )
    op.create_table(
        "identity_event",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "entity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("identity_entity.id"),
            nullable=False,
        ),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("detail", postgresql.JSONB(), nullable=False),
        sa.Column("made_by_alethical_team", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "action IN ('created','linked','withdrawn','merged','split')",
            name="event_action",
        ),
    )
    op.create_index("ix_identity_event_entity_id", "identity_event", ["entity_id"])
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON TABLE {table} FROM PUBLIC")
    # These roles exist in Supabase, but not in the isolated test PostgreSQL.
    op.execute(
        "DO $$ BEGIN "
        + " ".join(
            f"IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN "
            + " ".join(f"REVOKE ALL ON TABLE {table} FROM {role};" for table in TABLES)
            + " END IF;"
            for role in ("anon", "authenticated")
        )
        + " END $$"
    )


def downgrade() -> None:
    op.drop_table("identity_event")
    op.drop_table("identity_link")
    op.drop_table("identity_entity")
