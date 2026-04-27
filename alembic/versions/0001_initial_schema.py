"""Initial Alethical schema."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from alembic import op

# revision identifiers, used by Alembic.
revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "prototypes" / "alethical_schema_sqlalchemy.py"


def load_schema_module():
    spec = importlib.util.spec_from_file_location("alethical_schema_sqlalchemy", SCHEMA_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def upgrade() -> None:
    schema = load_schema_module()
    bind = op.get_bind()
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    schema.Base.metadata.create_all(bind=bind)
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
    schema = load_schema_module()
    bind = op.get_bind()
    op.execute("DROP INDEX IF EXISTS ix_rag_chunk_embedding_embedding_hnsw")
    op.drop_index("ix_rag_chunk_embedding_embedding_model", table_name="rag_chunk_embedding")
    op.drop_index("ix_sponsorship_bill_role_source_order", table_name="sponsorship")
    op.drop_index(
        "ix_legislator_service_period_legislator_session_current",
        table_name="legislator_service_period",
    )
    schema.Base.metadata.drop_all(bind=bind)
