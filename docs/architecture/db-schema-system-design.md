# Alethical DB Schema System Design

Status: first relational design draft

## Goal

Define a Postgres schema and SQLAlchemy model layout for Alethical v1 that is:

- queryable from real frontend user stories
- safe for ingestion and reprocessing
- explicit about provenance
- compatible with RAG ingestion and retrieval
- resistant to accidental N+1 query patterns

This document treats a schema as good only if it can support the main product surfaces with predictable query plans.

## What A Good Schema Means

A good schema for Alethical is not just "normalized" or "pretty." It should satisfy all of these:

### 1. It Can Field The Product Queries

The schema should be able to answer the core user-facing queries without awkward data reconstruction in application code.

Examples:

- list bills for a session with filters and status
- open one bill and show sponsors, actions, versions, votes, and tracked state
- list legislators with current district and party
- open one legislator and show current committees and sponsored bills
- answer "who represents me" from a district lookup result
- retrieve clean citation-safe bill text chunks for signed-in chat

### 2. It Avoids N+1 By Design

The schema should make the happy path easy for SQLAlchemy:

- one list query plus bounded eager loads
- detail pages loaded with `selectinload` or explicit secondary queries
- counts and badges served from derived stats tables where needed
- no dependence on per-row follow-up queries for sponsors, committees, or tracked state

### 3. It Separates Write Shapes From Read Shapes

Canonical write models should stay normalized, but list pages should not rely on expensive live aggregation across large join trees.

That means:

- canonical tables for bills, legislators, actions, votes, and versions
- derived stats tables for hot counts
- separate RAG tables for cleaned sections and chunks

### 4. It Preserves Provenance

Every important record should point back to:

- the ingestion run
- the source artifact
- the official source URL or identifier

### 5. It Supports Reprocessing

The schema should allow:

- re-running parsers from raw artifacts
- rebuilding RAG documents from canonical bill-version sections
- re-running embeddings without touching canonical data

### 6. It Is Honest About History

Legislative data changes over time. The schema should preserve:

- session boundaries
- bill-version history
- legislator term and committee membership history
- ingestion timestamps and override history

## Query-Driven Design Inputs

The schema should be validated against these v1 query shapes.

### 1. Bill List

UI needs:

- bill number
- chamber
- title
- current status
- latest action date
- sponsor preview
- tracked state for the current user
- optional counts for actions, versions, votes

Target query plan:

- one main `bill` query with filters
- one bounded eager load for chief sponsors
- optional left join for `tracked_bill`
- optional join to `bill_stats`

### 2. Bill Detail

UI needs:

- bill header and current status
- all sponsors
- timeline actions
- versions and source documents
- vote events and vote records
- topic tags and AI enrichments

Target query plan:

- one `bill` query
- bounded eager loads for:
  - `sponsorships -> legislator`
  - `actions`
  - `versions -> documents`
  - `vote_events -> vote_records`
- tracked state fetched separately or joined once

### 3. Legislator Directory

UI needs:

- current legislator identity
- district
- party
- chamber
- committee count
- sponsored bill count

Target query plan:

- one query against `legislator` joined to current `legislator_term`
- left join to `legislator_stats`

### 4. Legislator Profile

UI needs:

- legislator identity and office info
- current service period
- committee memberships
- sponsored bills
- vote history or vote summaries

Target query plan:

- one `legislator` query
- bounded eager loads for `terms`, `committee_memberships`
- explicit bill list query by `sponsorship`
- explicit vote list query by `vote_record`

### 5. Find My Legislator

UI needs:

- district result from GIS lookup
- current house and senate members for those districts
- optional pinned map latitude and longitude input, using the same GIS district resolution path as address lookup after geocoding

Target query plan:

- one query by `district.code`
- eager load current `legislator_term -> legislator`

### 6. Tracked Bills

UI needs:

- user tracked bills
- bill card fields
- last update and tracked metadata

Target query plan:

- one `tracked_bill` query joined to `bill`
- eager load chief sponsors if displayed

### 7. Chat Retrieval

System needs:

- retrieve cleaned sections and chunks by bill, legislator, topic, and semantic similarity
- preserve citation labels and source links
- assume an authenticated user and persisted chat session

Target query plan:

- semantic search on `rag_chunk`
- join to `rag_section_document`
- optional join to `bill`, `bill_version`, and `legislator`

## Proposed Table Groups

### 1. Reference Tables

- `jurisdiction`
- `chamber`
- `legislative_session`
- `district`
- `topic`

### 2. People and Organization Tables

- `legislator`
- `legislator_service_period`
- `committee`
- `committee_membership`

### 3. Bill Tables

- `bill`
- `bill_version`
- `bill_version_section`
- `bill_document`
- `bill_action`
- `sponsorship`
- `bill_topic`
- `bill_stats`

### 4. Vote Tables

- `vote_event`
- `vote_record`

### 5. Ingestion and Audit Tables

- `ingestion_job`
- `ingestion_run`
- `source_artifact`
- `parser_failure`
- `manual_override`

### 6. User Product Tables

- `user_account`
- `auth_identity`
- `tracked_bill`
- `saved_place`
- `notification_preference`
- `notification_endpoint`
- `notification_event`
- `chat_session`
- `chat_message`

### 7. AI and Retrieval Tables

- `ai_enrichment`
- `rag_section_document`
- `rag_chunk`
- `rag_chunk_embedding`
- `legislator_stats`

## Core Modeling Decisions

### Canonical Bill Identity

`bill` should have a stable unique external key like `94-2025-HF2136`. That key is the canonical bill spine for product and ingestion code.

### Stable Identity, Historical Service State

`legislator` should represent the stable human identity.

Time-varying political and office state should not live on the root row. Party, district, chamber assignment, caucus, profile URL, office address, and contact details should live on `legislator_service_period`.

That model handles:

- party switches
- redistricting
- chamber changes
- office-contact changes
- temporary replacements within a session

Current state should be derived from the latest active service-period row, not stored by overwriting historical data.

### Session-Scoped Committees

Committees and committee memberships should stay session-scoped. A legislator can serve on different committees across sessions or even within the same session.

### Bill Versions Need Sections

RAG ingestion should not parse directly from raw HTML every time. Canonical `bill_version_section` rows should preserve section IDs, article info, headings, and raw section text.

### Stats Belong In Derived Tables

Counts shown on directory or list pages should come from small derived tables like `bill_stats` and `legislator_stats`, not live `COUNT(*)` over multiple joins on every request.

### Manual Overrides Must Be First-Class

When data conflicts across official sources, the system needs an auditable override table rather than silent mutation.

### Auth Must Be Separate From App User State

`user_account` should represent the product user. External auth should live in `auth_identity`.

That gives us:

- flexibility to change auth vendors
- support for multiple identities per user if needed
- no legislative-data coupling to a specific auth provider

### Chat Is A Signed-In Feature

Chat should not be available to anonymous users in v1.

That means:

- every `chat_session` belongs to a `user_account`
- every `chat_message` belongs to a persisted session
- retrieval and citation data can be logged and rate-limited per authenticated user

## Anti-N+1 Rules

The schema should be used with these rules:

1. list pages should query root entities plus stats
2. multi-row child collections should load with `selectinload`
3. counts and badges should come from stats tables
4. tracked state should be joined once per list, not queried per row
5. vote records should only be loaded on bill detail or vote detail pages, not on every bill card
6. RAG chunks should be retrieved directly from `rag_chunk`, not reconstructed from section text at request time

## Validation Rubric

A schema is acceptable for v1 only if it passes all of these checks.

### Product Query Coverage

- every core surface has a direct query path
- no surface requires application-side reconstruction across unrelated tables

### N+1 Safety

- list pages can be served with one root query plus bounded eager loads
- all "count" fields on hot paths have a direct source

### Ingestion Compatibility

- raw artifacts, canonical records, and derived records have separate homes
- canonical entities can be upserted from source-specific parsers without violating product integrity

### RAG Compatibility

- section-level canonical text exists
- cleaned section and chunk tables can point back to canonical version sections

### Auditability

- source provenance exists on canonical records
- overrides and failures are explicit

### Evolvability

- future federal or multi-state expansion would add new jurisdictions and sessions without rewriting bill identity semantics

## Validation Against The Proposed Schema

### Bill List

Pass.

Reason:

- `bill` carries list-level fields
- `bill_stats` supplies counts
- `sponsorship` supports bounded eager load of chief sponsors
- `tracked_bill` can be joined on `(user_id, bill_id)`

### Bill Detail

Pass.

Reason:

- all detail children are explicit tables
- query can be composed from one root bill row plus bounded eager loads

### Legislator Directory

Pass.

Reason:

- current service-period data lives in `legislator_service_period`
- profile counts come from `legislator_stats`

### Legislator Profile

Pass.

Reason:

- committees, sponsored bills, and vote history all have direct query paths

### Find My Legislator

Pass.

Reason:

- GIS returns district codes
- pinned map lookup can resolve districts directly from coordinates without a geocoder step
- `district -> legislator_service_period -> legislator` is direct

### Tracked Bills

Pass.

Reason:

- `tracked_bill` is a first-class join table with room for user-specific metadata

### Chat Retrieval

Pass.

Reason:

- `rag_chunk` and `rag_section_document` are explicit derived tables
- provenance back to canonical sections is preserved
- `chat_session` is already tied to an authenticated user

## Residual Risks

- list pages with too many live child collections can still become heavy if application code ignores eager-loading rules
- vote-detail screens may need separate query functions rather than giant eager-load trees
- some counts may eventually be better served by materialized views if write volume grows

Those are acceptable v1 risks. They do not require a different relational model.
