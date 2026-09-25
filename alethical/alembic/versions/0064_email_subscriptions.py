"""Explicit email choices, browser-bound signup intent, and delivery records.

Additive only. Existing accounts remain unselected and no email is sent.
"""

import sqlalchemy as sa
from alembic import op

revision = "0064_email_subscriptions"
down_revision = "0063_cf_statement_report_period"
branch_labels = None
depends_on = None


def user_column(primary_key=False):
    return sa.Column(
        "user_id",
        sa.UUID(),
        sa.ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        primary_key=primary_key,
    )


def timestamp(name):
    return sa.Column(
        name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def upgrade():
    op.create_table(
        "email_subscription",
        user_column(True),
        sa.Column("research", sa.Boolean()),
        sa.Column("features", sa.Boolean()),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("research_changed_at", sa.DateTime(timezone=True)),
        sa.Column("features_changed_at", sa.DateTime(timezone=True)),
        sa.Column("research_source", sa.String(24)),
        sa.Column("features_source", sa.String(24)),
    )
    op.create_table(
        "email_preference_mutation",
        user_column(True),
        sa.Column("request_key", sa.UUID(), primary_key=True),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        timestamp("created_at"),
    )
    op.create_table(
        "email_subscription_intent",
        sa.Column("reference_digest", sa.String(64), primary_key=True),
        sa.Column("browser_digest", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "completed_by",
            sa.UUID(),
            sa.ForeignKey("user_account.id", ondelete="CASCADE"),
        ),
    )
    op.create_index(
        "ix_email_subscription_intent_expires_at",
        "email_subscription_intent",
        ["expires_at"],
    )
    op.create_table(
        "email_unsubscribe_token",
        sa.Column("token_digest", sa.String(64), primary_key=True),
        user_column(),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        timestamp("created_at"),
    )
    op.create_index(
        "ix_email_unsubscribe_token_user_id", "email_unsubscribe_token", ["user_id"]
    )
    op.create_table(
        "unconcealed_delivery",
        sa.Column("id", sa.UUID(), primary_key=True),
        user_column(),
        sa.Column("campaign_key", sa.String(200), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("state", sa.String(32), nullable=False),
        sa.Column("provider_id", sa.String(200)),
        sa.Column("attempted_at", sa.DateTime(timezone=True)),
        timestamp("created_at"),
        timestamp("updated_at"),
        sa.UniqueConstraint("campaign_key", "user_id"),
    )


def downgrade():
    for table in (
        "unconcealed_delivery",
        "email_unsubscribe_token",
        "email_subscription_intent",
        "email_preference_mutation",
        "email_subscription",
    ):
        op.drop_table(table)
