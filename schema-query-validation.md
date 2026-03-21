# Alethical Schema Query Validation

Date: 2026-03-21

Validation sources:

- runtime validator: `scripts/validate_query_rubric.py`
- machine-readable output: `prototype-output/schema-query-validation.json`

## Outcome

The current schema and query layer pass the rubric.

This is not just a document-level claim. The validation was executed against the live Docker Postgres instance after:

- applying Alembic migrations through `0002_query_path_indexes`
- reloading sample bill, legislator, user, and RAG data
- populating deterministic sample embeddings

## Rubric Result

- `product_query_coverage`: pass
- `n_plus_1_safety`: pass
- `ingestion_compatibility`: pass
- `rag_compatibility`: pass
- `auditability`: pass
- `evolvability`: pass

## Surface Results

### Bill List

Status: pass

- signed-in bill list helper includes tracked state
- sponsor preview is limited to chief sponsors
- sample execution used `5` SQL statements

### Bill Detail

Status: pass

- detail helper includes sponsors, actions, versions, votes, topics, AI enrichments, and tracked state
- sample execution used `10` SQL statements
- statements are bounded eager loads, not per-row lazy loads

### Legislator Directory

Status: pass

- query path is `legislator -> current legislator_service_period -> district`
- stats are session-filtered
- current-state service data is constrained to the requested session
- sample execution used `4` SQL statements

### Legislator Profile

Status: pass

- dedicated helpers exist for profile root, sponsored bills, and vote history
- current-state service data is session-filtered
- sample execution used `10` SQL statements

### Find My Legislator

Status: pass

- direct query path is `district -> legislator_service_period -> legislator`
- sample execution used `3` SQL statements
- GIS remains the correct upstream boundary for district resolution

### Tracked Bills

Status: pass

- tracked bills are a clean signed-in join surface
- cards reuse the same chief-sponsor preview path as the main bill list
- sample execution used `5` SQL statements

### Chat Retrieval

Status: pass

- semantic retrieval helper exists
- `rag_chunk_embedding` rows are populated in sample data
- vector index `ix_rag_chunk_embedding_embedding_hnsw` exists
- sample execution used `2` SQL statements

## What Changed To Get To Pass

### Query Ergonomics

- added signed-in bill-list support for tracked-state reads
- added chief-sponsor preview relationship and used it on list surfaces
- constrained legislator directory/profile reads to current session state
- added dedicated legislator sponsored-bills and vote-history helpers
- added a dedicated find-my-legislator helper

### Retrieval Readiness

- added semantic chunk retrieval helper
- added vector and read-path indexes in Alembic migration `0002_query_path_indexes`
- populated sample embeddings so semantic retrieval is actually executable

### Ingestion Repeatability

- fixed sample-data reloads to be idempotent for source artifacts
- fixed delete ordering between canonical sections and derived RAG rows
- fixed repeat loads so embeddings and chunk rows can be rebuilt safely

## Remaining Engineering Risks

The rubric passes, but a few realistic risks remain:

- query plans on the tiny sample dataset do not prove large-session production performance
- vote history is modeled correctly but still needs real chamber vote ingests to stress the read path
- the initial Alembic revision is still metadata-driven rather than explicit DDL, which is acceptable for prototype stage but not ideal long-term

Those are next-stage hardening concerns, not blockers for the current schema direction.
