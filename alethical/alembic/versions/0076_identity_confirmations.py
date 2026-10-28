"""Hold Alethical Finance's identity confirmations, their evidence and history.

A confirmed person or organization ties records together only through a
confirmation that names its evidence: a saved source row or official page, the
words it prints and the reviewer's basis. A printed name is confirmed record by
record, each record kept as a content fingerprint that at most 1 active
confirmation may hold; a registration number or held id is confirmed whole.
Confirmations are append-only apart from their 1-time withdrawal. A merge keeps
the old identity and its confirmations behind a redirect; a split withdraws each
confirmation and makes a replacement on the part that takes it (Finance decisions
D23 and D24; docs/architecture/alethical-finance-architecture.md §4).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0076_identity_confirmations"
down_revision = "0075_finance_access_list"
branch_labels = None
depends_on = None

PRINTED_NAME_KINDS = (
    "'donor_name','employer_name','payee_name','independent_payee_name'"
)
IDENTIFIER_KINDS = "'committee','lobbyist','principal','legislator','public_person'"
EVIDENCE_SOURCES = (
    "'cf_contribution_row','cf_expenditure_row','cf_independent_expenditure_row',"
    "'cf_filer','lobbyist_row','lobbying_expenditure_row','official_page'"
)
TABLES = (
    "identity_entity",
    "identity_confirmation",
    "identity_confirmed_record",
    "identity_event",
)


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


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
        _created_at(),
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
        "identity_confirmation",
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
        sa.Column(
            "replaces_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("identity_confirmation.id"),
        ),
        sa.Column(
            "active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "checked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True)),
        sa.Column("withdrawal_reason", sa.Text()),
        sa.Column("made_by_alethical_team", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            f"record_kind IN ({PRINTED_NAME_KINDS},{IDENTIFIER_KINDS})",
            name="confirmation_record_kind",
        ),
        sa.CheckConstraint(
            f"evidence_source IN ({EVIDENCE_SOURCES})",
            name="confirmation_evidence_source",
        ),
        sa.CheckConstraint(
            "active = (withdrawn_at IS NULL)", name="confirmation_active"
        ),
        sa.CheckConstraint(
            "(withdrawn_at IS NULL) = (withdrawal_reason IS NULL)",
            name="confirmation_withdrawal",
        ),
        sa.CheckConstraint(
            "(evidence_source = 'official_page') = (evidence_url IS NOT NULL)",
            name="confirmation_evidence_url",
        ),
        sa.CheckConstraint("replaces_id <> id", name="confirmation_not_self"),
        # The target of each confirmed record's foreign key below.
        sa.UniqueConstraint("id", "record_kind", "active"),
    )
    op.create_index(
        "ix_identity_confirmation_entity_id", "identity_confirmation", ["entity_id"]
    )
    op.create_index(
        "ix_identity_confirmation_record",
        "identity_confirmation",
        ["record_kind", "record_key"],
    )
    # A registration number, principal id or held id: 1 active confirmation.
    op.create_index(
        "uq_identity_confirmation_identifier",
        "identity_confirmation",
        ["record_kind", "record_key"],
        unique=True,
        postgresql_where=sa.text(f"active AND record_kind IN ({IDENTIFIER_KINDS})"),
    )
    # A split replaces each confirmation at most once.
    op.create_index(
        "uq_identity_confirmation_replaces",
        "identity_confirmation",
        ["replaces_id"],
        unique=True,
        postgresql_where=sa.text("replaces_id IS NOT NULL"),
    )
    op.create_table(
        "identity_confirmed_record",
        sa.Column("confirmation_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("fingerprint", sa.Text(), primary_key=True),
        sa.Column("record_kind", sa.Text(), nullable=False),
        sa.Column(
            "active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column("fields", postgresql.JSONB(), nullable=False),
        # A withdrawal sets the confirmation inactive, and this carries it to
        # every record it holds in the same statement.
        sa.ForeignKeyConstraint(
            ["confirmation_id", "record_kind", "active"],
            [
                "identity_confirmation.id",
                "identity_confirmation.record_kind",
                "identity_confirmation.active",
            ],
            onupdate="CASCADE",
            name="fk_identity_confirmed_record_confirmation",
        ),
        sa.CheckConstraint(
            f"record_kind IN ({PRINTED_NAME_KINDS})", name="record_printed_name"
        ),
        sa.CheckConstraint("fingerprint ~ '^[0-9a-f]{64}$'", name="record_fingerprint"),
    )
    # A record belongs to at most 1 active confirmation.
    op.create_index(
        "uq_identity_confirmed_record_active",
        "identity_confirmed_record",
        ["fingerprint"],
        unique=True,
        postgresql_where=sa.text("active"),
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
        _created_at(),
        sa.CheckConstraint(
            "action IN ('created','confirmed','withdrawn','merged','split')",
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
    op.drop_table("identity_confirmed_record")
    op.drop_table("identity_confirmation")
    op.drop_table("identity_entity")
