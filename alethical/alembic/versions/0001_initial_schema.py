"""Initial Alethical schema, as explicit DDL (#100).

Net: this revision used to build the whole schema by calling
``Base.metadata.create_all()``. That is a snapshot of whatever ``models.py`` said
at the moment it ran, not a diff, so Alembic could neither detect nor version a
schema change -- and production drifted away from the repo in eleven places with
no error anywhere. The evidence, and which side was right in each case, is
``docs/operations/production-database-schema-drift.md``.

What this file is: a transcription, not a redesign. It creates exactly the tables,
columns, constraints and indexes ``create_all`` created, so a fresh database comes
out the same as before. What changes is that the migration history can now
*describe* the schema, which makes three things possible that were not:
``alembic revision --autogenerate`` produces a real diff, a future migration's
``upgrade()`` actually runs on a fresh database instead of finding the work
already done, and ``scripts/check_schema_drift.py`` can fail a pull request that
lets the models and the migrations disagree again.

**This revision never runs against production.** Production is stamped
``0016_section_keyed_on_pos``; ``alembic upgrade head`` starts from the stamp and
walks forward, so a revision behind it is not in the path and is not executed.
The proof is in the pull request that landed this file: the offline SQL for
``0016_section_keyed_on_pos:head`` contains no statement from this revision.

Three things are deliberately *not* folded in, because each would be a behaviour
change rather than a transcription:

* ``0002_notification_event`` and ``0008_legislator_election_history`` still skip
  themselves when their table already exists. This baseline still creates every
  table ``models.py`` declares -- the same set ``create_all`` created -- so on a
  fresh database those two still find their table present. Removing a table from
  here so a later revision can create it changes what an existing database gets.
* The three composite indexes at the end of ``upgrade()`` are created by hand
  rather than declared on the models, exactly as before. Declaring them in
  ``models.py`` would make ``create_all`` build them first and the later
  ``create_index`` fail.
* The ivfflat vector index is created here and replaced with an HNSW one by
  ``0012_rag_hnsw_index``. A column can carry one index declaration, not a before
  and an after, which is why ``scripts/check_schema_drift.py`` lists both names in
  its migration-only set.
"""

from __future__ import annotations

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None

# Every table this revision creates, in creation order, for the downgrade to
# remove in reverse. Listed literally rather than read back from
# ``models.py``: a revision that imports the models describes whatever that file
# says today, which is the whole defect this change exists to remove.
TABLES = (
    "ingestion_run",
    "jurisdiction",
    "user_account",
    "auth_identity",
    "chamber",
    "legislative_session",
    "legislator",
    "notification_preference",
    "source_artifact",
    "bill",
    "committee",
    "district",
    "legislator_election_history",
    "legislator_stats",
    "policy_area_count",
    "bill_action",
    "bill_stats",
    "bill_version",
    "chat_session",
    "committee_membership",
    "legislator_service_period",
    "notification_event",
    "saved_place",
    "sponsorship",
    "tracked_bill",
    "ai_enrichment",
    "bill_version_section",
    "chat_message",
    "vote_event",
    "rag_section_document",
    "vote_record",
    "rag_chunk",
    "rag_chunk_embedding",
)

# ``create_table`` creates an enum type implicitly the first time a column
# references it; ``drop_table`` does not remove it. Dropping them by hand is what
# makes an upgrade -> downgrade -> upgrade round trip work -- without it the
# second upgrade fails with "type already exists".
ENUM_TYPES = (
    "artifact_type",
    "chamber_type",
    "chat_role",
    "enrichment_type",
    "ingestion_run_status",
    "notification_channel",
    "notification_frequency",
    "session_type",
    "sponsorship_role",
    "vote_value",
)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "ingestion_run",
        sa.Column("adapter", sa.String(length=100), nullable=False),
        sa.Column("target_type", sa.String(length=100), nullable=False),
        sa.Column("target_key", sa.String(length=200), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "queued",
                "running",
                "succeeded",
                "failed",
                "cancelled",
                name="ingestion_run_status",
            ),
            nullable=False,
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stats", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("error_text", sa.Text(), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ingestion_run")),
    )
    op.create_table(
        "jurisdiction",
        sa.Column("slug", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("subdivision_code", sa.String(length=10), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_jurisdiction")),
        sa.UniqueConstraint("slug", name=op.f("uq_jurisdiction_slug")),
    )
    op.create_table(
        "user_account",
        sa.Column("display_name", sa.String(length=200), nullable=True),
        sa.Column("primary_email", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("last_signed_in_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_account")),
        sa.UniqueConstraint(
            "primary_email", name=op.f("uq_user_account_primary_email")
        ),
    )
    op.create_table(
        "auth_identity",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.String(length=100), nullable=False),
        sa.Column("provider_subject", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
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
            ["user_id"],
            ["user_account.id"],
            name=op.f("fk_auth_identity_user_id_user_account"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_identity")),
        sa.UniqueConstraint(
            "provider",
            "provider_subject",
            name=op.f("uq_auth_identity_provider_provider_subject"),
        ),
        sa.UniqueConstraint(
            "user_id",
            "provider",
            "provider_subject",
            name=op.f("uq_auth_identity_user_id_provider_provider_subject"),
        ),
    )
    op.create_table(
        "chamber",
        sa.Column("jurisdiction_id", sa.UUID(), nullable=False),
        sa.Column(
            "chamber_type",
            sa.Enum("house", "senate", "joint", name="chamber_type"),
            nullable=False,
        ),
        sa.Column("slug", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("short_name", sa.String(length=20), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
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
            ["jurisdiction_id"],
            ["jurisdiction.id"],
            name=op.f("fk_chamber_jurisdiction_id_jurisdiction"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_chamber")),
        sa.UniqueConstraint(
            "jurisdiction_id",
            "chamber_type",
            name=op.f("uq_chamber_jurisdiction_id_chamber_type"),
        ),
        sa.UniqueConstraint(
            "jurisdiction_id", "slug", name=op.f("uq_chamber_jurisdiction_id_slug")
        ),
    )
    op.create_table(
        "legislative_session",
        sa.Column("jurisdiction_id", sa.UUID(), nullable=False),
        sa.Column("slug", sa.String(length=50), nullable=False),
        sa.Column("session_number", sa.Integer(), nullable=False),
        sa.Column(
            "session_type",
            sa.Enum("regular", "special", name="session_type"),
            nullable=False,
        ),
        sa.Column("year_start", sa.Integer(), nullable=False),
        sa.Column("year_end", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False),
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
            ["jurisdiction_id"],
            ["jurisdiction.id"],
            name=op.f("fk_legislative_session_jurisdiction_id_jurisdiction"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_legislative_session")),
        sa.UniqueConstraint(
            "jurisdiction_id",
            "session_number",
            "year_start",
            "session_type",
            name=op.f(
                "uq_legislative_session_jurisdiction_id_session_number_year_start_session_type"
            ),
        ),
        sa.UniqueConstraint(
            "jurisdiction_id",
            "slug",
            name=op.f("uq_legislative_session_jurisdiction_id_slug"),
        ),
    )
    op.create_table(
        "legislator",
        sa.Column("jurisdiction_id", sa.UUID(), nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=False),
        sa.Column("external_key", sa.String(length=100), nullable=True),
        sa.Column("full_name", sa.String(length=200), nullable=False),
        sa.Column("sort_name", sa.String(length=200), nullable=False),
        sa.Column("first_name", sa.String(length=100), nullable=True),
        sa.Column("last_name", sa.String(length=100), nullable=True),
        sa.Column("preferred_name", sa.String(length=100), nullable=True),
        sa.Column("biography", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
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
            ["jurisdiction_id"],
            ["jurisdiction.id"],
            name=op.f("fk_legislator_jurisdiction_id_jurisdiction"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_legislator")),
        sa.UniqueConstraint(
            "jurisdiction_id",
            "external_key",
            name=op.f("uq_legislator_jurisdiction_id_external_key"),
        ),
        sa.UniqueConstraint(
            "jurisdiction_id", "slug", name=op.f("uq_legislator_jurisdiction_id_slug")
        ),
    )
    op.create_table(
        "notification_preference",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "channel",
            sa.Enum("email", "push", name="notification_channel"),
            nullable=False,
        ),
        sa.Column(
            "frequency",
            sa.Enum(
                "realtime",
                "daily_digest",
                "weekly_digest",
                "disabled",
                name="notification_frequency",
            ),
            nullable=False,
        ),
        sa.Column("is_enabled", sa.Boolean(), nullable=False),
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
            ["user_id"],
            ["user_account.id"],
            name=op.f("fk_notification_preference_user_id_user_account"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notification_preference")),
        sa.UniqueConstraint(
            "user_id",
            "channel",
            name=op.f("uq_notification_preference_user_id_channel"),
        ),
    )
    op.create_table(
        "source_artifact",
        sa.Column("run_id", sa.UUID(), nullable=False),
        sa.Column("adapter", sa.String(length=100), nullable=False),
        sa.Column(
            "artifact_type",
            sa.Enum(
                "xml", "html", "pdf", "json", "image", "other", name="artifact_type"
            ),
            nullable=False,
        ),
        sa.Column("source_key", sa.String(length=200), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=128), nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("content_type", sa.String(length=255), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column(
            "metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
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
            ["run_id"],
            ["ingestion_run.id"],
            name=op.f("fk_source_artifact_run_id_ingestion_run"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_source_artifact")),
        sa.UniqueConstraint(
            "adapter",
            "source_url",
            "content_hash",
            name=op.f("uq_source_artifact_adapter_source_url_content_hash"),
        ),
    )
    op.create_index(
        "ix_source_artifact_source_key",
        "source_artifact",
        ["adapter", "source_key"],
        unique=False,
    )
    op.create_table(
        "bill",
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("chamber_id", sa.UUID(), nullable=False),
        sa.Column("bill_key", sa.String(length=100), nullable=False),
        sa.Column("file_type", sa.String(length=20), nullable=False),
        sa.Column("file_number", sa.Integer(), nullable=False),
        sa.Column("revisor_number", sa.String(length=50), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("current_status", sa.String(length=200), nullable=True),
        sa.Column("current_status_code", sa.String(length=50), nullable=True),
        sa.Column(
            "has_current_summary",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("status_key", sa.String(length=50), nullable=True),
        sa.Column("status_rank", sa.SmallInteger(), nullable=True),
        sa.Column("latest_action_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("introduced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("official_url", sa.Text(), nullable=True),
        sa.Column("is_omnibus", sa.Boolean(), nullable=False),
        sa.Column("companion_bill_id", sa.UUID(), nullable=True),
        sa.Column("ingestion_run_id", sa.UUID(), nullable=True),
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
            ["chamber_id"], ["chamber.id"], name=op.f("fk_bill_chamber_id_chamber")
        ),
        sa.ForeignKeyConstraint(
            ["companion_bill_id"],
            ["bill.id"],
            name=op.f("fk_bill_companion_bill_id_bill"),
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_run_id"],
            ["ingestion_run.id"],
            name=op.f("fk_bill_ingestion_run_id_ingestion_run"),
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["legislative_session.id"],
            name=op.f("fk_bill_session_id_legislative_session"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bill")),
        sa.UniqueConstraint("bill_key", name=op.f("uq_bill_bill_key")),
        sa.UniqueConstraint(
            "session_id",
            "file_type",
            "file_number",
            name=op.f("uq_bill_session_id_file_type_file_number"),
        ),
    )
    op.create_index("ix_bill_latest_action", "bill", ["latest_action_at"], unique=False)
    op.create_index(
        "ix_bill_session_introduced",
        "bill",
        [
            "session_id",
            sa.literal_column("introduced_at DESC NULLS LAST"),
            sa.literal_column("file_number DESC"),
        ],
        unique=False,
    )
    op.create_index(
        "ix_bill_session_progress",
        "bill",
        [
            "session_id",
            "status_rank",
            sa.literal_column("latest_action_at DESC NULLS LAST"),
            "file_number",
            "id",
        ],
        unique=False,
        postgresql_where=sa.text("has_current_summary"),
    )
    op.create_index(
        "ix_bill_session_status",
        "bill",
        ["session_id", "current_status_code"],
        unique=False,
    )
    op.create_table(
        "committee",
        sa.Column("chamber_id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("external_key", sa.String(length=100), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=True),
        sa.Column("profile_url", sa.Text(), nullable=True),
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
            ["chamber_id"], ["chamber.id"], name=op.f("fk_committee_chamber_id_chamber")
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["legislative_session.id"],
            name=op.f("fk_committee_session_id_legislative_session"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_committee")),
        sa.UniqueConstraint(
            "session_id",
            "chamber_id",
            "name",
            name=op.f("uq_committee_session_id_chamber_id_name"),
        ),
    )
    op.create_table(
        "district",
        sa.Column("jurisdiction_id", sa.UUID(), nullable=False),
        sa.Column("chamber_id", sa.UUID(), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("gis_identifier", sa.String(length=100), nullable=True),
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_to", sa.Date(), nullable=True),
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
            ["chamber_id"], ["chamber.id"], name=op.f("fk_district_chamber_id_chamber")
        ),
        sa.ForeignKeyConstraint(
            ["jurisdiction_id"],
            ["jurisdiction.id"],
            name=op.f("fk_district_jurisdiction_id_jurisdiction"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_district")),
        sa.UniqueConstraint(
            "jurisdiction_id",
            "chamber_id",
            "code",
            name=op.f("uq_district_jurisdiction_id_chamber_id_code"),
        ),
    )
    op.create_table(
        "legislator_election_history",
        sa.Column("legislator_id", sa.UUID(), nullable=False),
        sa.Column("chamber_id", sa.UUID(), nullable=False),
        sa.Column("period_sequence", sa.Integer(), nullable=False),
        sa.Column("initial_year", sa.Integer(), nullable=False),
        sa.Column(
            "reelection_years",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        # No server default, and the long generated constraint name below, even
        # though models.py now declares both the other way. Both are what
        # create_all actually built, and this revision transcribes create_all.
        # Production has always had them; 0017 is what carries them across.
        # Audit findings D7 and D8.
        sa.Column("is_current_chamber", sa.Boolean(), nullable=False),
        sa.Column("term_number", sa.Integer(), nullable=True),
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
            ["chamber_id"],
            ["chamber.id"],
            name=op.f("fk_legislator_election_history_chamber_id_chamber"),
        ),
        sa.ForeignKeyConstraint(
            ["legislator_id"],
            ["legislator.id"],
            name=op.f("fk_legislator_election_history_legislator_id_legislator"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_legislator_election_history")),
        sa.UniqueConstraint(
            "legislator_id",
            "period_sequence",
            name="uq_legislator_election_history_legislator_id_period_sequence",
        ),
    )
    op.create_index(
        op.f("ix_legislator_election_history_legislator_id"),
        "legislator_election_history",
        ["legislator_id"],
        unique=False,
    )
    op.create_table(
        "legislator_stats",
        sa.Column("legislator_id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("chief_bill_count", sa.Integer(), nullable=False),
        sa.Column("total_bill_count", sa.Integer(), nullable=False),
        sa.Column("vote_record_count", sa.Integer(), nullable=False),
        sa.Column("committee_count", sa.Integer(), nullable=False),
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
            ["legislator_id"],
            ["legislator.id"],
            name=op.f("fk_legislator_stats_legislator_id_legislator"),
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["legislative_session.id"],
            name=op.f("fk_legislator_stats_session_id_legislative_session"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_legislator_stats")),
        sa.UniqueConstraint(
            "legislator_id",
            "session_id",
            name=op.f("uq_legislator_stats_legislator_id_session_id"),
        ),
    )
    op.create_table(
        "policy_area_count",
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("canonical_name", sa.String(length=100), nullable=False),
        sa.Column("bill_count", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["legislative_session.id"],
            name=op.f("fk_policy_area_count_session_id_legislative_session"),
        ),
        sa.PrimaryKeyConstraint(
            "session_id", "canonical_name", name=op.f("pk_policy_area_count")
        ),
    )
    op.create_index(
        "ix_policy_area_count_session_count",
        "policy_area_count",
        ["session_id", sa.literal_column("bill_count DESC"), "canonical_name"],
        unique=False,
    )
    op.create_table(
        "bill_action",
        sa.Column("bill_id", sa.UUID(), nullable=False),
        sa.Column("chamber_id", sa.UUID(), nullable=True),
        sa.Column("committee_id", sa.UUID(), nullable=True),
        sa.Column("source_artifact_id", sa.UUID(), nullable=True),
        sa.Column("action_number", sa.Integer(), nullable=False),
        sa.Column("action_group", sa.String(length=100), nullable=True),
        sa.Column("action_text", sa.Text(), nullable=False),
        sa.Column("action_description", sa.Text(), nullable=True),
        sa.Column("committee_name", sa.Text(), nullable=True),
        sa.Column("action_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("journal_page", sa.String(length=50), nullable=True),
        sa.Column("roll_call_text", sa.String(length=50), nullable=True),
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
            ["bill_id"], ["bill.id"], name=op.f("fk_bill_action_bill_id_bill")
        ),
        sa.ForeignKeyConstraint(
            ["chamber_id"],
            ["chamber.id"],
            name=op.f("fk_bill_action_chamber_id_chamber"),
        ),
        sa.ForeignKeyConstraint(
            ["committee_id"],
            ["committee.id"],
            name=op.f("fk_bill_action_committee_id_committee"),
        ),
        sa.ForeignKeyConstraint(
            ["source_artifact_id"],
            ["source_artifact.id"],
            name=op.f("fk_bill_action_source_artifact_id_source_artifact"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bill_action")),
        sa.UniqueConstraint(
            "bill_id",
            "action_number",
            "chamber_id",
            name=op.f("uq_bill_action_bill_id_action_number_chamber_id"),
        ),
    )
    op.create_index(
        "ix_bill_action_bill_order",
        "bill_action",
        ["bill_id", "action_number"],
        unique=False,
    )
    op.create_table(
        "bill_stats",
        sa.Column("bill_id", sa.UUID(), nullable=False),
        sa.Column("sponsor_count", sa.Integer(), nullable=False),
        sa.Column("action_count", sa.Integer(), nullable=False),
        sa.Column("version_count", sa.Integer(), nullable=False),
        sa.Column("vote_event_count", sa.Integer(), nullable=False),
        sa.Column("tracked_user_count", sa.Integer(), nullable=False),
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
            ["bill_id"], ["bill.id"], name=op.f("fk_bill_stats_bill_id_bill")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bill_stats")),
        sa.UniqueConstraint("bill_id", name=op.f("uq_bill_stats_bill_id")),
    )
    op.create_table(
        "bill_version",
        sa.Column("bill_id", sa.UUID(), nullable=False),
        sa.Column("version_code", sa.String(length=50), nullable=False),
        sa.Column("version_name", sa.String(length=200), nullable=True),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("document_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("html_url", sa.Text(), nullable=True),
        sa.Column("pdf_url", sa.Text(), nullable=True),
        sa.Column("source_artifact_id", sa.UUID(), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False),
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
            ["bill_id"], ["bill.id"], name=op.f("fk_bill_version_bill_id_bill")
        ),
        sa.ForeignKeyConstraint(
            ["source_artifact_id"],
            ["source_artifact.id"],
            name=op.f("fk_bill_version_source_artifact_id_source_artifact"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bill_version")),
        sa.UniqueConstraint(
            "bill_id", "version_code", name=op.f("uq_bill_version_bill_id_version_code")
        ),
    )
    op.create_index(
        "ix_bill_version_bill_sequence",
        "bill_version",
        ["bill_id", "sequence_number"],
        unique=False,
    )
    op.create_index(
        "uq_bill_version_one_current_per_bill",
        "bill_version",
        ["bill_id"],
        unique=True,
        postgresql_where=sa.text("is_current"),
    )
    op.create_table(
        "chat_session",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("subject_bill_id", sa.UUID(), nullable=True),
        sa.Column(
            "retrieval_profile", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
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
            ["subject_bill_id"],
            ["bill.id"],
            name=op.f("fk_chat_session_subject_bill_id_bill"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user_account.id"],
            name=op.f("fk_chat_session_user_id_user_account"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_chat_session")),
    )
    op.create_table(
        "committee_membership",
        sa.Column("committee_id", sa.UUID(), nullable=False),
        sa.Column("legislator_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False),
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
            ["committee_id"],
            ["committee.id"],
            name=op.f("fk_committee_membership_committee_id_committee"),
        ),
        sa.ForeignKeyConstraint(
            ["legislator_id"],
            ["legislator.id"],
            name=op.f("fk_committee_membership_legislator_id_legislator"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_committee_membership")),
        sa.UniqueConstraint(
            "committee_id",
            "legislator_id",
            "role",
            name=op.f("uq_committee_membership_committee_id_legislator_id_role"),
        ),
    )
    op.create_table(
        "legislator_service_period",
        sa.Column("legislator_id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("chamber_id", sa.UUID(), nullable=False),
        sa.Column("district_id", sa.UUID(), nullable=False),
        sa.Column("period_sequence", sa.Integer(), nullable=False),
        sa.Column("party", sa.String(length=50), nullable=True),
        sa.Column("caucus_name", sa.String(length=100), nullable=True),
        sa.Column("title", sa.String(length=100), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("photo_url", sa.Text(), nullable=True),
        sa.Column("profile_url", sa.Text(), nullable=True),
        sa.Column("office_address", sa.Text(), nullable=True),
        sa.Column("elected", sa.Text(), nullable=True),
        sa.Column("term", sa.Text(), nullable=True),
        sa.Column("represented_city", sa.String(length=120), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False),
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
            ["chamber_id"],
            ["chamber.id"],
            name=op.f("fk_legislator_service_period_chamber_id_chamber"),
        ),
        sa.ForeignKeyConstraint(
            ["district_id"],
            ["district.id"],
            name=op.f("fk_legislator_service_period_district_id_district"),
        ),
        sa.ForeignKeyConstraint(
            ["legislator_id"],
            ["legislator.id"],
            name=op.f("fk_legislator_service_period_legislator_id_legislator"),
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["legislative_session.id"],
            name=op.f("fk_legislator_service_period_session_id_legislative_session"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_legislator_service_period")),
        sa.UniqueConstraint(
            "legislator_id",
            "session_id",
            "period_sequence",
            name=op.f(
                "uq_legislator_service_period_legislator_id_session_id_period_sequence"
            ),
        ),
    )
    op.create_index(
        "ix_legislator_service_period_current",
        "legislator_service_period",
        ["session_id", "is_current", "chamber_id", "district_id"],
        unique=False,
    )
    op.create_table(
        "notification_event",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("bill_id", sa.UUID(), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("old_status_code", sa.String(length=50), nullable=True),
        sa.Column("new_status_code", sa.String(length=50), nullable=True),
        sa.Column("old_status", sa.String(length=200), nullable=True),
        sa.Column("new_status", sa.String(length=200), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
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
            ["bill_id"], ["bill.id"], name=op.f("fk_notification_event_bill_id_bill")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user_account.id"],
            name=op.f("fk_notification_event_user_id_user_account"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notification_event")),
    )
    op.create_index(
        "ix_notification_event_user_unsent",
        "notification_event",
        ["user_id", "sent_at"],
        unique=False,
    )
    op.create_table(
        "saved_place",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("address_text", sa.Text(), nullable=True),
        sa.Column("city", sa.String(length=100), nullable=True),
        sa.Column("state_code", sa.String(length=10), nullable=True),
        sa.Column("postal_code", sa.String(length=20), nullable=True),
        sa.Column("latitude", sa.Numeric(precision=9, scale=6), nullable=True),
        sa.Column("longitude", sa.Numeric(precision=9, scale=6), nullable=True),
        sa.Column("house_district_id", sa.UUID(), nullable=True),
        sa.Column("senate_district_id", sa.UUID(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False),
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
            ["house_district_id"],
            ["district.id"],
            name=op.f("fk_saved_place_house_district_id_district"),
        ),
        sa.ForeignKeyConstraint(
            ["senate_district_id"],
            ["district.id"],
            name=op.f("fk_saved_place_senate_district_id_district"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user_account.id"],
            name=op.f("fk_saved_place_user_id_user_account"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_saved_place")),
    )
    op.create_table(
        "sponsorship",
        sa.Column("bill_id", sa.UUID(), nullable=False),
        sa.Column("legislator_id", sa.UUID(), nullable=True),
        sa.Column("committee_id", sa.UUID(), nullable=True),
        sa.Column(
            "role",
            sa.Enum("chief_author", "co_author", "sponsor", name="sponsorship_role"),
            nullable=False,
        ),
        sa.Column("source_order", sa.Integer(), nullable=False),
        sa.Column("source_chamber", sa.String(length=20), nullable=True),
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
        sa.CheckConstraint(
            "(legislator_id IS NOT NULL) OR (committee_id IS NOT NULL)",
            name=op.f("ck_sponsorship_sponsorship_has_target"),
        ),
        sa.ForeignKeyConstraint(
            ["bill_id"], ["bill.id"], name=op.f("fk_sponsorship_bill_id_bill")
        ),
        sa.ForeignKeyConstraint(
            ["committee_id"],
            ["committee.id"],
            name=op.f("fk_sponsorship_committee_id_committee"),
        ),
        sa.ForeignKeyConstraint(
            ["legislator_id"],
            ["legislator.id"],
            name=op.f("fk_sponsorship_legislator_id_legislator"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sponsorship")),
        sa.UniqueConstraint(
            "bill_id",
            "legislator_id",
            "committee_id",
            "role",
            name=op.f("uq_sponsorship_bill_id_legislator_id_committee_id_role"),
        ),
    )
    op.create_table(
        "tracked_bill",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("bill_id", sa.UUID(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("alerts_enabled", sa.Boolean(), nullable=False),
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
            ["bill_id"], ["bill.id"], name=op.f("fk_tracked_bill_bill_id_bill")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user_account.id"],
            name=op.f("fk_tracked_bill_user_id_user_account"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tracked_bill")),
        sa.UniqueConstraint(
            "user_id", "bill_id", name=op.f("uq_tracked_bill_user_id_bill_id")
        ),
    )
    op.create_table(
        "ai_enrichment",
        sa.Column("bill_id", sa.UUID(), nullable=True),
        sa.Column("legislator_id", sa.UUID(), nullable=True),
        sa.Column("bill_version_id", sa.UUID(), nullable=True),
        sa.Column(
            "enrichment_type",
            sa.Enum(
                "bill_summary",
                "talking_points",
                "benefits_concerns",
                "topic_classification",
                "stakeholder_extraction",
                name="enrichment_type",
            ),
            nullable=False,
        ),
        sa.Column("model_name", sa.String(length=100), nullable=False),
        sa.Column(
            "content_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("source_version_hash", sa.String(length=64), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False),
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
            ["bill_id"], ["bill.id"], name=op.f("fk_ai_enrichment_bill_id_bill")
        ),
        sa.ForeignKeyConstraint(
            ["bill_version_id"],
            ["bill_version.id"],
            name=op.f("fk_ai_enrichment_bill_version_id_bill_version"),
        ),
        sa.ForeignKeyConstraint(
            ["legislator_id"],
            ["legislator.id"],
            name=op.f("fk_ai_enrichment_legislator_id_legislator"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_enrichment")),
    )
    # No ix_ai_enrichment_bill_summary_current_unique here, though models.py now
    # declares it. Production has had it all along and create_all never built it,
    # so it is a real change to every other database and belongs in a revision
    # that can be reasoned about on its own -- 0017. Audit finding D6.
    op.create_table(
        "bill_version_section",
        sa.Column("bill_version_id", sa.UUID(), nullable=False),
        sa.Column("section_id_text", sa.String(length=100), nullable=False),
        sa.Column("source_order", sa.Integer(), nullable=False),
        sa.Column("article_id_text", sa.String(length=100), nullable=True),
        sa.Column("article_number", sa.String(length=50), nullable=True),
        sa.Column("article_heading", sa.Text(), nullable=True),
        sa.Column("section_heading", sa.Text(), nullable=True),
        sa.Column("statute_heading", sa.Text(), nullable=True),
        sa.Column("cite_heading", sa.Text(), nullable=True),
        sa.Column("effective_date_heading", sa.Text(), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column(
            "body_blocks", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("source_hash", sa.String(length=64), nullable=True),
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
            ["bill_version_id"],
            ["bill_version.id"],
            name=op.f("fk_bill_version_section_bill_version_id_bill_version"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bill_version_section")),
        sa.UniqueConstraint(
            "bill_version_id",
            "source_order",
            name=op.f("uq_bill_version_section_bill_version_id_source_order"),
        ),
    )
    op.create_index(
        "ix_bill_version_section_order",
        "bill_version_section",
        ["bill_version_id", "source_order"],
        unique=False,
    )
    op.create_index(
        "ix_bill_version_section_text",
        "bill_version_section",
        ["bill_version_id", "section_id_text"],
        unique=False,
    )
    op.create_table(
        "chat_message",
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column(
            "role",
            sa.Enum("system", "user", "assistant", "tool", name="chat_role"),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("model_name", sa.String(length=100), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column(
            "citation_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
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
            ["session_id"],
            ["chat_session.id"],
            name=op.f("fk_chat_message_session_id_chat_session"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_chat_message")),
    )
    op.create_index(
        "ix_chat_message_session_created",
        "chat_message",
        ["session_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "vote_event",
        sa.Column("bill_id", sa.UUID(), nullable=False),
        sa.Column("bill_action_id", sa.UUID(), nullable=True),
        sa.Column("chamber_id", sa.UUID(), nullable=False),
        sa.Column("motion_text", sa.Text(), nullable=True),
        sa.Column("result_text", sa.String(length=100), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("official_url", sa.Text(), nullable=True),
        sa.Column("source_artifact_id", sa.UUID(), nullable=True),
        sa.Column("yes_count", sa.Integer(), nullable=False),
        sa.Column("no_count", sa.Integer(), nullable=False),
        sa.Column("absent_count", sa.Integer(), nullable=False),
        sa.Column("excused_count", sa.Integer(), nullable=False),
        sa.Column("present_count", sa.Integer(), nullable=False),
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
            ["bill_action_id"],
            ["bill_action.id"],
            name=op.f("fk_vote_event_bill_action_id_bill_action"),
        ),
        sa.ForeignKeyConstraint(
            ["bill_id"], ["bill.id"], name=op.f("fk_vote_event_bill_id_bill")
        ),
        sa.ForeignKeyConstraint(
            ["chamber_id"],
            ["chamber.id"],
            name=op.f("fk_vote_event_chamber_id_chamber"),
        ),
        sa.ForeignKeyConstraint(
            ["source_artifact_id"],
            ["source_artifact.id"],
            name=op.f("fk_vote_event_source_artifact_id_source_artifact"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vote_event")),
    )
    op.create_index(
        "ix_vote_event_bill_occurred",
        "vote_event",
        ["bill_id", "occurred_at"],
        unique=False,
    )
    op.create_table(
        "rag_section_document",
        sa.Column("bill_id", sa.UUID(), nullable=False),
        sa.Column("bill_version_id", sa.UUID(), nullable=False),
        sa.Column("bill_version_section_id", sa.UUID(), nullable=True),
        sa.Column("citation_label", sa.Text(), nullable=False),
        sa.Column("clean_text", sa.Text(), nullable=False),
        sa.Column("search_text", sa.Text(), nullable=False),
        sa.Column("cleaning_version", sa.String(length=50), nullable=False),
        sa.Column("source_hash", sa.String(length=64), nullable=False),
        sa.Column("word_count", sa.Integer(), nullable=False),
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
            ["bill_id"], ["bill.id"], name=op.f("fk_rag_section_document_bill_id_bill")
        ),
        sa.ForeignKeyConstraint(
            ["bill_version_id"],
            ["bill_version.id"],
            name=op.f("fk_rag_section_document_bill_version_id_bill_version"),
        ),
        sa.ForeignKeyConstraint(
            ["bill_version_section_id"],
            ["bill_version_section.id"],
            name=op.f(
                "fk_rag_section_document_bill_version_section_id_bill_version_section"
            ),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rag_section_document")),
        sa.UniqueConstraint(
            "bill_version_id",
            "bill_version_section_id",
            "cleaning_version",
            name=op.f(
                "uq_rag_section_document_bill_version_id_bill_version_section_id_cleaning_version"
            ),
        ),
    )
    op.create_index(
        "ix_rag_section_bill_version",
        "rag_section_document",
        ["bill_id", "bill_version_id"],
        unique=False,
    )
    op.create_table(
        "vote_record",
        sa.Column("vote_event_id", sa.UUID(), nullable=False),
        sa.Column("legislator_id", sa.UUID(), nullable=False),
        sa.Column(
            "vote_value",
            sa.Enum(
                "yes",
                "no",
                "absent",
                "excused",
                "present",
                "abstain",
                name="vote_value",
            ),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False),
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
            ["legislator_id"],
            ["legislator.id"],
            name=op.f("fk_vote_record_legislator_id_legislator"),
        ),
        sa.ForeignKeyConstraint(
            ["vote_event_id"],
            ["vote_event.id"],
            name=op.f("fk_vote_record_vote_event_id_vote_event"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vote_record")),
        sa.UniqueConstraint(
            "vote_event_id",
            "legislator_id",
            name=op.f("uq_vote_record_vote_event_id_legislator_id"),
        ),
    )
    op.create_table(
        "rag_chunk",
        sa.Column("rag_section_document_id", sa.UUID(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("citation_label", sa.Text(), nullable=False),
        sa.Column("chunk_text", sa.Text(), nullable=False),
        sa.Column("search_text", sa.Text(), nullable=False),
        sa.Column("chunking_version", sa.String(length=50), nullable=False),
        sa.Column("word_count", sa.Integer(), nullable=False),
        sa.Column("token_estimate", sa.Integer(), nullable=True),
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
            ["rag_section_document_id"],
            ["rag_section_document.id"],
            name=op.f("fk_rag_chunk_rag_section_document_id_rag_section_document"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rag_chunk")),
        sa.UniqueConstraint(
            "rag_section_document_id",
            "chunk_index",
            "chunking_version",
            name=op.f(
                "uq_rag_chunk_rag_section_document_id_chunk_index_chunking_version"
            ),
        ),
    )
    op.create_index(
        "ix_rag_chunk_section_order",
        "rag_chunk",
        ["rag_section_document_id", "chunk_index"],
        unique=False,
    )
    op.create_table(
        "rag_chunk_embedding",
        sa.Column("rag_chunk_id", sa.UUID(), nullable=False),
        sa.Column("embedding_model", sa.String(length=100), nullable=False),
        sa.Column(
            "embedding", pgvector.sqlalchemy.vector.VECTOR(dim=1536), nullable=False
        ),
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
            ["rag_chunk_id"],
            ["rag_chunk.id"],
            name=op.f("fk_rag_chunk_embedding_rag_chunk_id_rag_chunk"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rag_chunk_embedding")),
        sa.UniqueConstraint(
            "rag_chunk_id", name=op.f("uq_rag_chunk_embedding_rag_chunk_id")
        ),
    )

    # Created by hand, not from the models: see the module docstring. Each is a
    # composite index no model declares, so create_all never built it and the
    # original create_all baseline added them here in exactly this order.
    op.create_index(
        "ix_legislator_service_period_legislator_session_current",
        "legislator_service_period",
        ["legislator_id", "session_id", "is_current"],
    )
    op.create_index(
        "ix_sponsorship_bill_role_source_order",
        "sponsorship",
        ["bill_id", "role", "source_order"],
    )
    op.create_index(
        "ix_rag_chunk_embedding_embedding_model",
        "rag_chunk_embedding",
        ["embedding_model"],
    )
    op.execute(
        """
        CREATE INDEX ix_rag_chunk_embedding_embedding_ivfflat
        ON rag_chunk_embedding
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 50)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_rag_chunk_embedding_embedding_ivfflat")
    op.drop_index(
        "ix_rag_chunk_embedding_embedding_model", table_name="rag_chunk_embedding"
    )
    op.drop_index("ix_sponsorship_bill_role_source_order", table_name="sponsorship")
    op.drop_index(
        "ix_legislator_service_period_legislator_session_current",
        table_name="legislator_service_period",
    )
    # Reverse creation order, so a table is gone before the table it points at.
    # Every index and constraint on a table goes with it, so only the four
    # indexes above -- which 0012 may already have swapped or dropped -- need
    # naming.
    for table in reversed(TABLES):
        op.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')
    for enum_name in ENUM_TYPES:
        op.execute(f'DROP TYPE IF EXISTS "{enum_name}"')
