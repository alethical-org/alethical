"""Replace the RAG vector index: ivfflat(lists=50) -> HNSW (#584).

The bill-resolution retrieval path (Grounded Ask) searches ``rag_chunk_embedding``
by cosine distance. The original ivfflat index used ``lists = 50`` for ~92k
vectors — far too few (rule of thumb ~sqrt(rows) ≈ 300), so each probe scanned a
large slice of the table. Measured on the #399 eval harness that cost both recall
(R@5 0.90 vs 1.00 under exact search) and latency (~9s mean per query). An HNSW
index recovers the recall and cuts latency dramatically.

Additive + reversible: adds the HNSW index and drops the ivfflat one; downgrade
restores the ivfflat index and drops HNSW. On production the HNSW index is built
out-of-band with ``CREATE INDEX CONCURRENTLY`` (no table lock — safe alongside
live ingestion writes), so ``IF NOT EXISTS`` here makes this migration a no-op
there; on fresh/CI databases the corpus is tiny, so the non-concurrent build and
the brief lock are negligible. ``SET LOCAL`` lifts the statement timeout and build
memory for the (single) migration transaction so the build can't be cancelled.
"""

from alembic import op

revision = "0012_rag_hnsw_index"
down_revision = "0011_search_trigram_idx"
branch_labels = None
depends_on = None

HNSW = "ix_rag_chunk_embedding_embedding_hnsw"
IVFFLAT = "ix_rag_chunk_embedding_embedding_ivfflat"


def upgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL maintenance_work_mem = '256MB'")
    op.execute("SET LOCAL max_parallel_maintenance_workers = 0")
    op.execute(
        f"CREATE INDEX IF NOT EXISTS {HNSW} ON rag_chunk_embedding "
        "USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)"
    )
    op.execute(f"DROP INDEX IF EXISTS {IVFFLAT}")


def downgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL maintenance_work_mem = '256MB'")
    op.execute(
        f"CREATE INDEX IF NOT EXISTS {IVFFLAT} ON rag_chunk_embedding "
        "USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)"
    )
    op.execute(f"DROP INDEX IF EXISTS {HNSW}")
