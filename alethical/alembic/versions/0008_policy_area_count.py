"""Precompute GET /policy-areas issue-chip counts into policy_area_count (#501).

Additive + reversible: a new derived cache table (session_id, canonical_name,
bill_count) plus an ordering index, backfilled from ai_enrichment.content_json
already in the database (zero-cost -- no API calls, no paid run).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

# revision identifiers, used by Alembic.
# Keep the revision id <= 32 chars -- alembic_version.version_num is varchar(32).
revision = "0008_policy_area_count"
down_revision = "0007_denormalize_bill_signals"
branch_labels = None
depends_on = None

TABLE = "policy_area_count"
INDEX_NAME = "ix_policy_area_count_session_count"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    # On a fresh database the 0001 baseline's metadata.create_all already builds
    # this table (it's a model), so create it only where genuinely missing -- a
    # database migrated before this revision. Same coexistence guard as 0003/0004.
    if TABLE not in inspector.get_table_names():
        op.create_table(
            TABLE,
            sa.Column(
                "session_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey(
                    "legislative_session.id",
                    name="fk_policy_area_count_session_id_legislative_session",
                ),
                primary_key=True,
                nullable=False,
            ),
            sa.Column("canonical_name", sa.String(length=100), primary_key=True),
            sa.Column("bill_count", sa.Integer(), nullable=False),
        )

    existing_idx = {ix["name"] for ix in inspector.get_indexes(TABLE)}
    if INDEX_NAME not in existing_idx:
        op.create_index(
            INDEX_NAME,
            TABLE,
            ["session_id", sa.text("bill_count DESC"), "canonical_name"],
        )

    # Backfill from ai_enrichment.content_json already in the DB (zero-cost). Reuses
    # the exact rollup the endpoint uses, so stored counts are byte-identical to the
    # live aggregation. On a fresh DB (data seeded after migrations) this is a no-op
    # and the endpoint falls back to computing live until the next refresh.
    from alethical.pipeline.policy_area_counts import refresh_all_counts

    refresh_all_counts(Session(bind=bind))


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name=TABLE)
    op.drop_table(TABLE)
