"""Private TV publication copies and independently reviewed evidence."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0070_tv_ad_records"
down_revision = "0069_candidate_person_records"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "tv_ad_publication",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("facility_id", sa.String(20), nullable=False),
        sa.Column("file_id", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column(
            "metadata_approved", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("metadata_reviewed_by", sa.Text()),
        sa.Column("metadata_reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("safe_title", sa.Text(), nullable=False),
        sa.Column("safe_folder", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("safe_pages", postgresql.JSONB(), nullable=False),
        sa.Column("artifacts", postgresql.JSONB(), nullable=False),
        sa.Column("redactions", postgresql.JSONB(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("reviewed_by", sa.Text()),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["facility_id", "file_id", "content_hash"],
            [
                "fcc_document.facility_id",
                "fcc_document.file_id",
                "fcc_document.content_hash",
            ],
        ),
        sa.CheckConstraint(
            "status IN ('draft','approved','withdrawn')", name="publication_status"
        ),
        sa.CheckConstraint(
            "status != 'approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)",
            name="publication_review",
        ),
    )
    op.create_index(
        "ix_tv_ad_publication_file",
        "tv_ad_publication",
        ["facility_id", "file_id", "status"],
    )
    op.create_index(
        "uq_tv_ad_publication_approved_version",
        "tv_ad_publication",
        ["facility_id", "file_id", "content_hash"],
        unique=True,
        postgresql_where=sa.text("status = 'approved'"),
    )
    op.create_table(
        "tv_ad_fact",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "publication_id",
            sa.UUID(),
            sa.ForeignKey("tv_ad_publication.id"),
            nullable=False,
        ),
        sa.Column("field", sa.String(40), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("organization_name", sa.Text()),
        sa.Column(
            "agency_address_reviewed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "history_publication_approved",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("qualifier", sa.Text()),
        sa.Column("role", sa.Text()),
        sa.Column("supersedes_id", sa.UUID(), sa.ForeignKey("tv_ad_fact.id")),
        sa.Column("page", sa.Integer(), nullable=False),
        sa.Column("quote", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=False),
        sa.Column("reviewed_by", sa.Text(), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "publication_approved",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('checked','withdrawn')", name="fact_status"),
        sa.CheckConstraint("page > 0", name="fact_page"),
    )
    op.create_index("ix_tv_ad_fact_publication_id", "tv_ad_fact", ["publication_id"])
    op.create_table(
        "tv_ad_connection",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("scope", sa.String(12), nullable=False),
        sa.Column("publication_id", sa.UUID(), sa.ForeignKey("tv_ad_publication.id")),
        sa.Column("facility_id", sa.String(20), nullable=False),
        sa.Column("folder_id", sa.Text(), nullable=False),
        sa.Column(
            "folder_content_hash",
            sa.String(64),
            sa.ForeignKey("fcc_source_body.content_hash"),
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("target_id", sa.Text(), nullable=False),
        sa.Column("target_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("page", sa.Integer()),
        sa.Column("quote", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=False),
        sa.Column("reviewed_by", sa.Text(), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "publication_approved",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('checked','withdrawn')", name="connection_status"
        ),
        sa.CheckConstraint(
            "kind IN ('committee','candidate','election','expense','principal','related_document','issue')",
            name="connection_kind",
        ),
        sa.CheckConstraint(
            "(scope = 'file' AND publication_id IS NOT NULL AND folder_content_hash IS NULL AND page > 0) OR (scope = 'folder' AND publication_id IS NULL AND folder_content_hash IS NOT NULL AND kind = 'committee' AND page IS NULL)",
            name="connection_scope",
        ),
    )
    op.create_index(
        "ix_tv_ad_connection_publication_id", "tv_ad_connection", ["publication_id"]
    )
    op.create_index(
        "ix_tv_ad_connection_target",
        "tv_ad_connection",
        ["kind", "target_id", "status"],
    )
    op.create_table(
        "tv_ad_review_event",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("entity_type", sa.String(20), nullable=False),
        sa.Column("entity_id", sa.UUID(), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("actor", sa.Text(), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_tv_ad_review_event_entity_id", "tv_ad_review_event", ["entity_id"]
    )
    op.create_table(
        "tv_ad_folder_approval",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("facility_id", sa.String(20), nullable=False),
        sa.Column("folder_id", sa.Text(), nullable=False),
        sa.Column(
            "content_hash",
            sa.String(64),
            sa.ForeignKey("fcc_source_body.content_hash"),
            nullable=False,
        ),
        sa.Column("safe_label", sa.Text(), nullable=False),
        sa.Column("safe_path", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("year", sa.Integer()),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("reviewed_by", sa.Text()),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('draft','approved','withdrawn')", name="folder_approval_status"
        ),
        sa.CheckConstraint(
            "status != 'approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)",
            name="folder_approval_review",
        ),
    )
    op.create_index(
        "ix_tv_ad_folder_approval_folder",
        "tv_ad_folder_approval",
        ["facility_id", "folder_id", "status"],
    )
    op.create_index(
        "uq_tv_ad_folder_approval_version",
        "tv_ad_folder_approval",
        ["facility_id", "folder_id", "content_hash"],
        unique=True,
        postgresql_where=sa.text("status = 'approved'"),
    )
    # Public evidence survives account deletion, but a review must not retain
    # the deleted account's sign-in identity. The marker identifies no person.
    op.execute("""
        CREATE FUNCTION public.anonymize_tv_review_subject(subject text)
        RETURNS void LANGUAGE plpgsql AS $$
        BEGIN
            UPDATE public.tv_ad_publication SET created_by = 'deleted-account' WHERE created_by = subject;
            UPDATE public.tv_ad_publication SET metadata_reviewed_by = 'deleted-account' WHERE metadata_reviewed_by = subject;
            UPDATE public.tv_ad_publication SET reviewed_by = 'deleted-account' WHERE reviewed_by = subject;
            UPDATE public.tv_ad_fact SET reviewed_by = 'deleted-account' WHERE reviewed_by = subject;
            UPDATE public.tv_ad_connection SET reviewed_by = 'deleted-account' WHERE reviewed_by = subject;
            UPDATE public.tv_ad_review_event SET actor = 'deleted-account' WHERE actor = subject;
            UPDATE public.tv_ad_folder_approval SET created_by = 'deleted-account' WHERE created_by = subject;
            UPDATE public.tv_ad_folder_approval SET reviewed_by = 'deleted-account' WHERE reviewed_by = subject;
            UPDATE public.fcc_expense_link SET reviewed_by = 'deleted-account' WHERE reviewed_by = subject;
            -- Older review_link versions copied the actor into generated history.
            -- Remove that field even when a later reviewer now owns reviewed_by.
            -- Match generated review headers only, preserving dates and evidence.
            UPDATE public.fcc_expense_link AS link SET evidence = (
                SELECT string_agg(
                    CASE WHEN line ~ '^Review [0-9]{4}-[0-9T:.+-]+: (accepted|rejected) by '
                        THEN replace(line, ' by ' || subject || '; ', '; ')
                        ELSE line END,
                    E'\n' ORDER BY ordinal
                )
                FROM unnest(string_to_array(link.evidence, E'\n')) WITH ORDINALITY AS history(line, ordinal)
            ) WHERE strpos(link.evidence, ' by ' || subject || '; ') > 0;
        END;
        $$;
        CREATE FUNCTION public.clear_deleted_tv_review_identity()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.provider = 'supabase' THEN
                PERFORM public.anonymize_tv_review_subject(OLD.provider_subject);
            END IF;
            RETURN OLD;
        END;
        $$;
        CREATE TRIGGER clear_deleted_tv_review_identity
        BEFORE DELETE ON public.auth_identity
        FOR EACH ROW EXECUTE FUNCTION public.clear_deleted_tv_review_identity();
        CREATE FUNCTION public.clear_deleted_tv_review_account()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE identity_row record;
        BEGIN
            FOR identity_row IN SELECT provider_subject FROM public.auth_identity
                WHERE user_id = OLD.id AND provider = 'supabase'
            LOOP
                PERFORM public.anonymize_tv_review_subject(identity_row.provider_subject);
            END LOOP;
            RETURN OLD;
        END;
        $$;
        CREATE TRIGGER clear_deleted_tv_review_account
        BEFORE DELETE ON public.user_account
        FOR EACH ROW EXECUTE FUNCTION public.clear_deleted_tv_review_account();
        REVOKE ALL ON FUNCTION public.anonymize_tv_review_subject(text) FROM PUBLIC;
        REVOKE ALL ON FUNCTION public.clear_deleted_tv_review_identity() FROM PUBLIC;
        REVOKE ALL ON FUNCTION public.clear_deleted_tv_review_account() FROM PUBLIC;
    """)
    # Neither anonymous nor ordinary authenticated Supabase clients get a second
    # database route around server authorization. Backend database role remains
    # the sole data access path, matching the private FCC archive.
    for table in (
        "tv_ad_publication",
        "tv_ad_folder_approval",
        "tv_ad_fact",
        "tv_ad_connection",
        "tv_ad_review_event",
    ):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON TABLE {table} FROM PUBLIC")
        op.execute(
            f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON {table} FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON {table} FROM authenticated; END IF; END $$"
        )


def downgrade():
    op.execute("DROP TRIGGER clear_deleted_tv_review_account ON public.user_account")
    op.execute("DROP TRIGGER clear_deleted_tv_review_identity ON public.auth_identity")
    op.execute("DROP FUNCTION public.clear_deleted_tv_review_account()")
    op.execute("DROP FUNCTION public.clear_deleted_tv_review_identity()")
    op.execute("DROP FUNCTION public.anonymize_tv_review_subject(text)")
    for table in (
        "tv_ad_review_event",
        "tv_ad_folder_approval",
        "tv_ad_connection",
        "tv_ad_fact",
        "tv_ad_publication",
    ):
        op.drop_table(table)
