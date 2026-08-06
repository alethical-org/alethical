"""Store reusable answers only for public, system-suggested Ask questions.

Reader-written questions are never stored or fingerprinted. The identity uses the
bill's current text version, current summary row, suggestion position, prompt and
model settings, so a change to any answer input causes a fresh answer.

Revision ID: 0026_ask_suggested_answer_cache
Revises: 0025_tracked_bills_last_viewed
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0026_ask_suggested_answer_cache"
down_revision = "0025_tracked_bills_last_viewed"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ask_suggested_answer_cache",
        sa.Column("bill_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("bill_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "bill_summary_enrichment_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("suggestion_index", sa.SmallInteger(), nullable=False),
        sa.Column("suggestion_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("bill_text_fingerprint", sa.String(length=128), nullable=False),
        sa.Column("prompt_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("answer_model", sa.String(length=100), nullable=False),
        sa.Column("embedding_model", sa.String(length=100), nullable=False),
        sa.Column("answer_payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), nullable=False, primary_key=True
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
        sa.ForeignKeyConstraint(["bill_id"], ["bill.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["bill_version_id"], ["bill_version.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["bill_summary_enrichment_id"],
            ["ai_enrichment.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "bill_id",
            "bill_version_id",
            "bill_summary_enrichment_id",
            "suggestion_index",
            "suggestion_fingerprint",
            "bill_text_fingerprint",
            "prompt_fingerprint",
            "answer_model",
            "embedding_model",
            name="uq_ask_suggested_answer_cache_identity",
        ),
    )


def downgrade() -> None:
    op.drop_table("ask_suggested_answer_cache")
