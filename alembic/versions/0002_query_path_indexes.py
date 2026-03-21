"""Add read-path and retrieval indexes."""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0002_query_path_indexes"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
        CREATE INDEX ix_rag_chunk_embedding_embedding_hnsw
        ON rag_chunk_embedding
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_rag_chunk_embedding_embedding_hnsw")
    op.drop_index("ix_rag_chunk_embedding_embedding_model", table_name="rag_chunk_embedding")
    op.drop_index("ix_sponsorship_bill_role_source_order", table_name="sponsorship")
    op.drop_index(
        "ix_legislator_service_period_legislator_session_current",
        table_name="legislator_service_period",
    )
