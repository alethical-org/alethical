"""Build the RAG HNSW vector index on production, CONCURRENTLY (#584).

Why a script and not just the Alembic migration: on production the corpus is ~92k
vectors, and a non-concurrent CREATE INDEX (what a migration runs, inside its
transaction) would hold an ACCESS EXCLUSIVE lock on ``rag_chunk_embedding`` for
the whole build — blocking live ingestion/enrichment writes. This builds the index
with ``CREATE INDEX CONCURRENTLY`` (no write lock) out-of-band, so the deploy
migration (0012) then finds it already present (``IF NOT EXISTS`` → no-op) and only
drops the old ivfflat index.

Apply order for production (#584):
  1. Run this script against prod (builds HNSW concurrently, ~10-15 min, no lock).
  2. Merge the PR → migrate.yml applies migration 0012 (no-op create + drops ivfflat).

Safe + reversible: additive index; on failure the partial/invalid index is dropped
so nothing lingers; to revert, drop the HNSW index and recreate the ivfflat one
(migration 0012 downgrade does exactly this).

Usage:
  ALETHICAL_DATABASE_TARGET=production uv run python scripts/build_rag_hnsw_index.py
  ALETHICAL_DATABASE_TARGET=production uv run python scripts/build_rag_hnsw_index.py --drop   # revert
"""

from __future__ import annotations

import argparse
import os
import time
from urllib.parse import urlparse

from sqlalchemy import URL, create_engine, text

from alethical.db.session import load_dotenv_if_present

IDX = "ix_rag_chunk_embedding_embedding_hnsw"
IVFFLAT = "ix_rag_chunk_embedding_embedding_ivfflat"


def _session_pooler_engine():
    """Engine on the SESSION pooler (port 5432) so explicit SET persists across
    statements and CONCURRENTLY runs in a stable backend. (The transaction pooler
    on 6543 multiplexes backends, dropping session SETs; the pooler also strips
    libpq startup ``options``, so SET must be issued as statements.)"""
    load_dotenv_if_present()
    project_url = os.environ["SUPABASE_PROJECT_URL"]
    ref = (
        os.environ.get("SUPABASE_PROJECT_REF")
        or urlparse(project_url).hostname.split(".")[0]
    )
    host = os.environ.get("SUPABASE_POOLER_HOST", "aws-1-us-east-2.pooler.supabase.com")
    url = URL.create(
        "postgresql+psycopg",
        username=f"postgres.{ref}",
        password=os.environ["SUPABASE_DB_PASSWORD"],
        host=host,
        port=5432,
        database="postgres",
        query={"sslmode": "require"},
    ).render_as_string(hide_password=False)
    return create_engine(
        url, isolation_level="AUTOCOMMIT", connect_args={"prepare_threshold": None}
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--drop", action="store_true", help="revert: drop HNSW, recreate ivfflat"
    )
    args = parser.parse_args()

    engine = _session_pooler_engine()
    with engine.connect() as c:
        # Lift the 2min statement timeout and give the single-process build memory.
        # Parallel build is disabled: it allocates a shared-memory segment sized to
        # maintenance_work_mem that this instance's shared memory can't fit (DiskFull).
        c.execute(text("set statement_timeout = 0"))
        c.execute(text("set maintenance_work_mem = '256MB'"))
        c.execute(text("set max_parallel_maintenance_workers = 0"))

        if args.drop:
            print(f"reverting: dropping {IDX}, recreating {IVFFLAT} ...", flush=True)
            c.execute(
                text(
                    f"create index concurrently if not exists {IVFFLAT} on rag_chunk_embedding "
                    "using ivfflat (embedding vector_cosine_ops) with (lists = 50)"
                )
            )
            c.execute(text(f"drop index concurrently if exists {IDX}"))
            print("reverted.", flush=True)
            return

        state = c.execute(
            text(
                "select indisvalid from pg_class i join pg_index ix on ix.indexrelid=i.oid where i.relname=:n"
            ),
            {"n": IDX},
        ).scalar()
        if state is True:
            print(f"{IDX} already exists and is valid — nothing to do.", flush=True)
            return
        if state is False:
            print(
                f"{IDX} is INVALID (prior partial build) — dropping first.", flush=True
            )
            c.execute(text(f"drop index concurrently if exists {IDX}"))

        print(f"building {IDX} (m=16, ef_construction=64) CONCURRENTLY ...", flush=True)
        t0 = time.time()
        try:
            c.execute(
                text(
                    f"create index concurrently {IDX} on rag_chunk_embedding "
                    "using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64)"
                )
            )
        except Exception:
            print("build failed — dropping any invalid leftover.", flush=True)
            c.execute(text(f"drop index concurrently if exists {IDX}"))
            raise
        size = c.execute(
            text("select pg_size_pretty(pg_relation_size(:n))"), {"n": IDX}
        ).scalar()
        print(f"DONE in {(time.time() - t0) / 60:.1f} min — size {size}.", flush=True)
        print(
            "Next: merge the PR so migration 0012 drops the old ivfflat index.",
            flush=True,
        )


if __name__ == "__main__":
    main()
