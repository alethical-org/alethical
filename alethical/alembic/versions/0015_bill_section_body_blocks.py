"""Add bill_version_section.body_blocks for the structure flattening destroys (#741, #752).

Net: bill text is stored as one flat string per section, which throws away the
subdivision numbers ("Subd. 2."), the marks saying which words a bill *adds*, and
the row/column shape of appropriation tables. This adds one nullable JSON column
to hold the section body as ordered blocks, keeping all three.

Why a new column instead of fixing the flat string: two paid caches hash
``bill_version_section.raw_text`` — every section's search embedding
(``rag_ingest.py``) and every bill's AI summary
(``ai_enrichment.source_version_hash``). Rewriting the flat text would invalidate
both and re-run two corpus-wide paid jobs. Nothing hashes this column, so filling
it is free.

Additive, nullable, and reversible: no backfill here (a separate free script
re-reads each bill's page from the Revisor), and no existing column is touched.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
# Keep the revision id <= 32 chars — alembic_version.version_num is varchar(32).
revision = "0015_section_body_blocks"
down_revision = "0014_status_key_action_history"
branch_labels = None
depends_on = None

TABLE = "bill_version_section"
COLUMN = "body_blocks"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    # Purely additive/nullable. On a fresh database the 0001 baseline's
    # metadata.create_all already builds this column (it's on the model), and
    # prod may carry out-of-band schema drift, so add it only where genuinely
    # missing (same coexistence guard as 0005/0010/0013).
    existing = {col["name"] for col in inspector.get_columns(TABLE)}
    if COLUMN not in existing:
        op.add_column(
            TABLE,
            sa.Column(COLUMN, postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        )


def downgrade() -> None:
    op.drop_column(TABLE, COLUMN)
