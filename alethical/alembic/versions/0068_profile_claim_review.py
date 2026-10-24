"""Retain private profile claim events and transactionally queue notifications."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0068_profile_claim_review"
down_revision = "0067_fcc_political_files"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("candidate_record", sa.Column("claim_source_block", sa.String(32)))
    op.create_table(
        "candidate_claim_event",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "claim_id",
            sa.UUID(),
            sa.ForeignKey("candidate_claim.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("claim_version", sa.Integer(), nullable=False),
        sa.Column(
            "actor_id", sa.UUID(), sa.ForeignKey("user_account.id", ondelete="SET NULL")
        ),
        sa.Column("evidence_url", sa.Text(), nullable=False),
        sa.Column("request_note", sa.Text(), nullable=False),
        sa.Column("review_note", sa.Text()),
        sa.Column("identity_verified", sa.Boolean(), nullable=False),
        sa.Column("statement_removed", sa.Boolean(), nullable=False),
        sa.Column("candidate_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("claim_id", "claim_version"),
        sa.CheckConstraint(
            "kind IN ('submitted', 'resubmitted', 'withdrawn', 'given_up', 'approved', 'rejected', 'revoked')",
            name="kind",
        ),
    )
    op.create_index(
        "ix_candidate_claim_event_claim_id", "candidate_claim_event", ["claim_id"]
    )
    op.create_table(
        "candidate_claim_email_delivery",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "event_id",
            sa.UUID(),
            sa.ForeignKey("candidate_claim_event.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.UUID(),
            sa.ForeignKey("user_account.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("recipient_kind", sa.String(16), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("provider_id", sa.String(200)),
        sa.Column("message_payload", postgresql.JSONB()),
        sa.Column("attempted_at", sa.DateTime(timezone=True)),
        sa.Column(
            "next_attempt_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("event_id", "user_id"),
        sa.CheckConstraint(
            "recipient_kind IN ('admin', 'applicant')", name="recipient_kind"
        ),
    )
    op.create_index(
        "ix_candidate_claim_email_delivery_pending",
        "candidate_claim_email_delivery",
        ["state", "next_attempt_at"],
    )
    # Clear copied reviewer names when the account is deleted, even if the
    # sender is disabled. An attempted message cannot change under the same
    # provider key; an unattempted message may be prepared without the name.
    op.execute("""
        CREATE FUNCTION public.clear_deleted_profile_claim_reviewer()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            UPDATE public.candidate_claim_email_delivery AS delivery
            SET message_payload = NULL,
                state = CASE WHEN delivery.attempt_count > 0
                    THEN 'cancelled' ELSE 'pending' END
            FROM public.candidate_claim_event AS event
            WHERE delivery.event_id = event.id
                AND event.actor_id = OLD.id
                AND event.kind IN ('approved', 'rejected', 'revoked')
                AND delivery.recipient_kind = 'admin'
                AND delivery.state IN ('pending', 'sending')
                AND delivery.message_payload IS NOT NULL;
            RETURN OLD;
        END;
        $$;
        CREATE TRIGGER clear_deleted_profile_claim_reviewer
        BEFORE DELETE ON public.user_account
        FOR EACH ROW EXECUTE FUNCTION public.clear_deleted_profile_claim_reviewer();
    """)
    for table in ("candidate_claim_event", "candidate_claim_email_delivery"):
        op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')
    op.execute("""
        DO $$ BEGIN
            IF (SELECT count(*) FROM pg_class c
                JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relname IN
                    ('candidate_claim_event', 'candidate_claim_email_delivery')
                    AND c.relrowsecurity) <> 2 THEN
                RAISE EXCEPTION 'Profile claim history requires row-level security';
            END IF;
            IF EXISTS (
                SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relname IN
                    ('candidate_claim_event', 'candidate_claim_email_delivery')
            ) THEN
                RAISE EXCEPTION 'Profile claim history requires zero public policies';
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER clear_deleted_profile_claim_reviewer ON public.user_account"
    )
    op.execute("DROP FUNCTION public.clear_deleted_profile_claim_reviewer()")
    op.drop_table("candidate_claim_email_delivery")
    op.drop_table("candidate_claim_event")
    op.drop_column("candidate_record", "claim_source_block")
