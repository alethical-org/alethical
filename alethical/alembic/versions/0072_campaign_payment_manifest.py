"""Keep each accepted payment file's source receipt and totals pairing."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0072_campaign_payment_manifest"
down_revision = "0071_private_search_measurements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cf_release",
        sa.Column(
            "file_manifest",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("cf_release", "file_manifest")
