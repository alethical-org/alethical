"""Editorial-only discussion, private choices and durable email deliveries.

Additive: no existing account identity or email consent is changed.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0065_editorial_comments"
down_revision = "0064_email_subscriptions"
branch_labels = None
depends_on = None

COMMENT_TABLES = (
    "comment_profile",
    "editorial_comment",
    "comment_article_follow",
    "comment_mutation",
    "comment_stop_token",
    "comment_email_delivery",
)


def user(name="user_id", *, primary_key=False, nullable=False, ondelete="CASCADE"):
    return sa.Column(
        name,
        sa.UUID(),
        sa.ForeignKey("user_account.id", ondelete=ondelete),
        primary_key=primary_key,
        nullable=nullable,
    )


def stamp(name="created_at"):
    return sa.Column(
        name, sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def upgrade():
    op.create_table(
        "comment_profile",
        user(primary_key=True),
        sa.Column("public_name", sa.Text()),
        sa.Column("reply_emails", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
    )
    op.create_table(
        "editorial_comment",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("article_id", sa.String(200), nullable=False),
        user("author_id", nullable=True, ondelete="SET NULL"),
        sa.Column("root_id", sa.UUID(), sa.ForeignKey("editorial_comment.id")),
        sa.Column("reply_to_id", sa.UUID(), sa.ForeignKey("editorial_comment.id")),
        sa.Column("body", sa.Text()),
        stamp("posted_at"),
        sa.Column("edited_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.CheckConstraint("status IN ('live', 'deleted', 'removed')", name="status"),
        sa.CheckConstraint(
            "(root_id IS NULL AND reply_to_id IS NULL) OR (root_id IS NOT NULL AND reply_to_id IS NOT NULL)",
            name="reply_shape",
        ),
        sa.CheckConstraint(
            "status != 'live' OR (body IS NOT NULL AND length(body) BETWEEN 1 AND 2000)",
            name="body_length",
        ),
    )
    op.create_index(
        "ix_editorial_comment_article_order",
        "editorial_comment",
        ["article_id", "posted_at", "id"],
    )
    op.create_index("ix_editorial_comment_root_id", "editorial_comment", ["root_id"])
    op.create_index(
        "ix_editorial_comment_reply_to_id", "editorial_comment", ["reply_to_id"]
    )
    op.create_table(
        "comment_article_follow",
        user(primary_key=True),
        sa.Column("article_id", sa.String(200), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
    )
    op.create_index(
        "ix_comment_article_follow_article_id", "comment_article_follow", ["article_id"]
    )
    op.create_table(
        "comment_mutation",
        user(primary_key=True),
        sa.Column("request_key", sa.UUID(), primary_key=True),
        sa.Column("article_id", sa.String(200), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("comment_id", sa.UUID(), sa.ForeignKey("editorial_comment.id")),
        stamp(),
    )
    op.create_table(
        "comment_stop_token",
        sa.Column("token_digest", sa.String(64), primary_key=True),
        user(),
        sa.Column("article_id", sa.String(200), nullable=False),
        sa.Column("link_choice", sa.String(12), nullable=False),
        stamp(),
    )
    op.create_index("ix_comment_stop_token_user_id", "comment_stop_token", ["user_id"])
    op.create_table(
        "comment_email_delivery",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("event_key", sa.UUID(), nullable=False),
        sa.Column("recipient_key", sa.String(80), nullable=False),
        user(nullable=True),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        user("actor_id", nullable=True, ondelete="SET NULL"),
        sa.Column("article_id", sa.String(200), nullable=False),
        sa.Column(
            "comment_id",
            sa.UUID(),
            sa.ForeignKey("editorial_comment.id"),
            nullable=False,
        ),
        sa.Column("event_kind", sa.String(24), nullable=False),
        sa.Column("direct_reply", sa.Boolean(), nullable=False),
        sa.Column("article_update", sa.Boolean(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("provider_id", sa.String(200)),
        sa.Column("message_payload", postgresql.JSONB()),
        sa.Column("attempted_at", sa.DateTime(timezone=True)),
        stamp("next_attempt_at"),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        stamp(),
        sa.UniqueConstraint("event_key", "recipient_key"),
    )
    op.create_index(
        "ix_comment_email_delivery_pending",
        "comment_email_delivery",
        ["state", "next_attempt_at"],
    )
    # Account removal erases that account's words without deleting replies by
    # anybody else. The remaining structural rows have no public identity.
    op.execute("""
        CREATE FUNCTION erase_deleted_account_comments() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
            UPDATE editorial_comment SET body = NULL, author_id = NULL,
                edited_at = NULL, status = 'deleted', version = version + 1
            WHERE author_id = OLD.id;
            RETURN OLD;
        END $$;
        CREATE TRIGGER erase_deleted_account_comments
        BEFORE DELETE ON user_account FOR EACH ROW
        EXECUTE FUNCTION erase_deleted_account_comments();
    """)
    # Direct client database access is denied before these tables become visible.
    # The trusted API connects as their owner, so FORCE RLS is deliberately absent.
    # Do not rely on a hosting provider's CREATE TABLE event trigger.
    for table in COMMENT_TABLES:
        op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')
    table_names = ", ".join(f"'{table}'" for table in COMMENT_TABLES)
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
                RAISE EXCEPTION
                    'Editorial comments require RLS enabled and zero policies on all 6 tables';
            END IF;
        END $$;
    """)


def downgrade():
    op.execute("DROP TRIGGER erase_deleted_account_comments ON user_account")
    op.execute("DROP FUNCTION erase_deleted_account_comments()")
    for table in (
        "comment_email_delivery",
        "comment_stop_token",
        "comment_mutation",
        "comment_article_follow",
        "editorial_comment",
        "comment_profile",
    ):
        op.drop_table(table)
