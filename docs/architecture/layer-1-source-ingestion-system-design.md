# Layer 1 — Source Ingestion System Design

Status: discussion draft

*Layer 1 of two ingestion layers: official Minnesota sources → canonical records. Layer 2, `docs/architecture/layer-2-rag-ingestion-system-design.md`, turns those canonical records into retrieval chunks for chat. This layer feeds that one.*

## Goal

Define a production-oriented ingestion pipeline for Alethical v1 that can reliably pull Minnesota legislative data from official sources, normalize it into a canonical domain model, retain provenance, and publish data that is usable by:

- the web client (and native iOS and Android clients when built — [#91](https://github.com/alethical-org/alethical/issues/91))
- search
- bill comparison
- RAG chat

This document focuses on ingestion and data publication, not the full application architecture.

## Executive Summary

The right v1 ingestion design is a staged pipeline with a clear split between:

1. source acquisition
2. raw artifact storage
3. normalization into canonical tables
4. validation and reconciliation
5. AI-ready derivations
6. publication to product APIs and retrieval indexes

The key design choice is to treat official Minnesota legislative systems as a set of complementary sources rather than expect a single perfect upstream API.

Recommended authoritative source split:

- Bills and bill actions: Revisor Bill Status API
- Bill text versions: Revisor bill version HTML and PDF
- Current legislator roster: joint Legislature directory
- Rich member detail: House and Senate member profile pages
- District lookup: LCC-GIS
- Roll call and floor verification: House and Senate journals and chamber vote pages

The rough prototype now validates this design across multiple live examples, not just a single bill.

## Design Principles

- Canonical records must be reproducible from raw source artifacts
- Every normalized record should retain source URLs and ingestion run IDs
- Parsing logic should be source-specific and isolated
- AI enrichment should run after canonical ingestion, not during scraping
- Human review and overrides should exist for source conflicts and parser failures
- The pipeline should be idempotent and backfillable
- Network access should include retries and light backoff for transient upstream failures
- Parser behavior should be regression-tested against a fixed fixture set of live-source examples

## Data Sources

## Bills

Primary:

- Revisor Bill Status API search endpoint
- Revisor bill XML endpoint discovered through search results
- Revisor bill version HTML pages
- Revisor bill version PDF pages

Examples:

- `https://www.revisor.mn.gov/bills/status_result.php?...&format=xml`
- `https://api.revisor.mn.gov/bills/v1/94/2025/0/HF/2136/`
- `https://www.revisor.mn.gov/bills/94/2025/0/HF/2136/versions/0/`

Extracted fields:

- bill identity
- session
- chamber
- revisor number
- companion bill
- description
- authors
- actions
- text versions
- official bill text

## Legislators

Reconciling the roster into current-member state has its own design:
`docs/architecture/legislator-roster-canonical-membership-spec.md`.

Primary:

- Joint Legislature current member directory
- House member profile pages
- Senate member profile pages

Examples:

- `https://www.leg.mn.gov/leg/legislators`
- `https://www.house.mn.gov/members/profile/15518`
- `http://www.senate.leg.state.mn.us/members/member_bio.php?leg_id=10002`

Extracted fields:

- current roster
- chamber
- district
- profile URLs
- photo URLs
- office block
- party
- contact information
- committee assignments
- authored bill report links

## Campaign Finance and Lobbying

Full design: `docs/architecture/campaign-finance-system-design.md`. Plain-language plan:
`docs/product-onboarding/campaign-finance-roadmap.md`. This section states only what a reader
of *this* document needs to know, which is where these sources behave differently from every
other source above.

Primary:

- `https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/`
- `https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/`

Both are free CSV downloads covering 2015 to present, needing no credentials. Resolve the
download link from the landing page on every run rather than storing it.

**The departure: these sources replace whole sets, they do not update rows.** Every other
source in this document is fetched per record and normalized into an upsert. Campaign finance
downloads a complete file, stores it as a dated snapshot, validates it, and publishes it by
replacing the previous set entirely. Related files release together as one set.

The reason is a property of the source, not a preference: **Minnesota publishes no
per-transaction identifier**, and two payments can be legitimately identical (same donor,
same date, same amount). No key derived from a row's contents can separate a genuine repeat
payment from a re-imported one, so a row-level merge cannot be made correct. The design doc
carries the measured evidence of what happens when one is attempted.

Consequences for this pipeline:

- Stage 2 (Raw Acquisition) stores the whole file, not a per-record artifact.
- Stage 4 (Canonical Normalization) has no upsert path for these sources.
- Stage 5 (Validation and Reconciliation) gates publication: a snapshot that fails is retained
  for diagnosis and never published.
- Nothing human may be stored on an imported row, since the set is rebuilt. Durable links
  (registration number, legislator id) live outside the imported set.

## District Lookup

Primary:

- LCC-GIS district tools and district finder services

Use:

- find-my-legislator flow
- district normalization
- district metadata

## Votes

Primary:

- Revisor bill action roll call references where present
- House journal and chamber vote systems
- Senate journal and chamber vote systems

Important note:

The Revisor XML is sufficient for bill status and some roll call summary references, but not consistently sufficient for full legislator-level vote reconstruction. Vote detail needs a dedicated chamber-specific adapter.

## Proposed Pipeline

### Stage 1. Source Discovery

Purpose:

- determine which records need to be fetched
- discover the canonical source URLs for each bill, member, or session artifact

Inputs:

- scheduled jobs
- manual backfill requests
- session configuration

Outputs:

- fetch queue entries with source type and URL

Examples:

- discover bill XML URI from Revisor search results
- discover latest bill version page from bill XML
- discover current roster member profile URLs from the joint roster page

### Stage 2. Raw Acquisition

Purpose:

- fetch upstream documents exactly as delivered

Artifact types:

- XML
- HTML
- PDF
- CSV if available
- images only when required for profile display

Raw storage requirements:

- immutable object storage path
- content hash
- source URL
- fetched_at
- HTTP status
- content type
- ingestion run ID

This stage should not perform business normalization. Its job is durable capture.

Robustness requirements:

- retry transient failures like `429`, `500`, `502`, `503`, and `504`
- record upstream response metadata for debugging
- avoid partial writes when a fetch fails midway
- support re-fetching a single artifact without re-running the full pipeline

### Stage 3. Source Parsing

Purpose:

- translate source-specific formats into structured parser outputs

Examples:

- Revisor bill XML parser
- Revisor bill HTML text parser
- joint directory roster parser
- House member page parser
- Senate member page parser
- House journal vote parser
- Senate journal vote parser

Output shape:

- parser output should still be source-shaped, but typed and structured
- parser output should not yet decide cross-source conflicts

Robustness requirements:

- keep separate adapters for Revisor, joint roster, House members, Senate members, and votes
- maintain fixture-driven regression checks for each adapter
- tolerate missing optional fields without failing the whole record
- fail loudly on broken critical structure like malformed bill XML

### Stage 4. Canonical Normalization

Purpose:

- map parsed outputs into the Alethical canonical model

Canonical entities created or updated here:

- legislative_session
- legislator
- district
- bill
- bill_version
- bill_document
- sponsorship
- bill_action
- vote_event
- vote_record
- committee
- legislator_committee_membership

Normalization rules:

- stable external IDs where possible
- preserve source-specific identifiers separately
- do not overwrite canonical records without recording source freshness and provenance
- maintain temporal history for changes like committee assignments and contact info

### Stage 5. Validation and Reconciliation

Purpose:

- detect source conflicts and parser anomalies before data becomes user-visible

Validation examples:

- legislator chamber and district must match known district formats
- bill authors in member pages should reconcile with legislator records
- bill companion numbers should match expected file type patterns
- 1 response may not lower a stored bill's action, author, text-version or section count;
  the same lower source facts must arrive twice before they are accepted
- actions should be ordered by action number and date

Reconciliation examples:

- joint roster is authoritative for current membership existence
- chamber profile page is authoritative for richer member detail
- Revisor is authoritative for bill status and text version inventory
- vote detail adapters can augment, but not replace, canonical bill actions

Failure handling:

- hard-fail malformed source payloads
- soft-fail missing optional fields
- route ambiguous records to review tables
- keep a stored bill description when a later response leaves it blank
- reject only the affected bill after 2 differing thin responses, while the rest of its
  chunk continues; expose that post-retry rejection for the scheduled refresh to report

Recommended review signals:

- roster member count drops unexpectedly
- chamber counts diverge from 134 House and 67 Senate current-member expectations
- a bill loses all actions or all authors after a refresh
- bill text parsing returns zero sections for an official version page
- a member profile loses district, party, or contact details unexpectedly

### Stage 6. Derived Outputs

Purpose:

- produce product-optimized and AI-optimized derivatives from canonical data

Derived outputs:

- bill search documents
- denormalized bill detail views
- legislator profile aggregates
- change events for tracked bills
- extracted bill plain text
- chunked bill text for embeddings
- retrieval metadata for chat citations

The retrieval derivations — cleaned section documents, chunks, embeddings, and the retrieval index — are specified in their own doc, `docs/architecture/layer-2-rag-ingestion-system-design.md`. This pipeline produces the canonical bill text and versions that the RAG pipeline consumes; it does not itself define the chunking, cleaning, or index.

### Stage 7. Publication

Purpose:

- expose stable downstream contracts

Consumers:

- product APIs
- web client
- mobile clients (not built yet)
- notification jobs
- retrieval service

## Recommended Data Model Boundaries

## Raw Layer

Tables or collections:

- `source_fetch_job`
- `source_artifact`
- `source_parse_result`

Responsibility:

- exact capture and parser visibility

## Canonical Layer

Tables:

- `legislator`
- `legislator_identifier`
- `district`
- `committee`
- `legislator_committee_membership`
- `bill`
- `bill_version`
- `bill_document`
- `sponsorship`
- `bill_action`
- `vote_event`
- `vote_record`

Responsibility:

- trusted product data

## Derived Layer

Tables (as implemented in `alethical/db/models.py`):

- `bill_stats`, `legislator_stats`, `policy_area_count` — precomputed aggregates for fast product reads
- `ai_enrichment` — model-generated summaries and key points (see "AI Enrichment Status" below)
- `rag_section_document`, `rag_chunk`, `rag_chunk_embedding` — retrieval artifacts, **specified in `docs/architecture/layer-2-rag-ingestion-system-design.md`**, not here

Responsibility:

- fast product reads and retrieval

Search is Postgres FTS over the canonical tables plus these stats aggregates — there is no separate search-document table.

## Prototype Findings

The original source-ingestion prototype has been retired. Its validated parsing behavior was promoted into [`alethical/pipeline/minnesota.py`](../../alethical/pipeline/minnesota.py).

Generated sample outputs:

- [bill-hf2136.json](../../alethical/tests/fixtures/bill-hf2136.json)
- [legislator-roster.json](../../alethical/tests/fixtures/legislator-roster.json)
- [house-member-15518.json](../../alethical/tests/fixtures/house-member-15518.json)
- [senate-member-10002.json](../../alethical/tests/fixtures/senate-member-10002.json)
- [validation-report.json](../../alethical/tests/fixtures/validation-report.json)

### Prototype Result 1. Revisor Bill XML Is Strong Enough To Be The Canonical Bill Spine

Validated on `HF 2136`.

The prototype successfully extracted:

- bill identity and session
- revisor number
- companion bill
- description
- authors with legislator keys
- action history
- text version inventory

This is strong enough to anchor the canonical `bill`, `sponsorship`, `bill_action`, and `bill_version` tables.

### Prototype Result 2. Bill Text HTML Is Legible Enough For Structured Section Extraction

The prototype pulled the Revisor bill version HTML and extracted:

- page title
- bill title text
- section headings
- section text

This is sufficient for:

- bill detail rendering
- plain text indexing
- chunking for RAG

It is not yet a final legal-text parser, but it proves the source is usable.

### Prototype Result 3. The Joint Legislature Directory Works Well As The Current Roster Source

The prototype parsed the current roster page into:

- chamber
- display name
- district
- profile URL
- image URL

This is a good discovery source for current members.

### Prototype Result 4. House and Senate Profile Pages Are Parseable But Need Separate Adapters

The prototype extracted from member profile pages:

- name
- party
- district
- office block
- office phone
- email or mail-form reference
- legislative assistant summary
- committee assignments

The parsing works, but the HTML structure differs enough between House and Senate that they should remain separate adapters.

### Prototype Result 5. The Adapters Hold Across a Small Fixture Set

The validation harness was run against:

- 6 bills
- 6 member profiles
- the full current legislator roster page

Observed results from the generated report:

- 6 of 6 bill ingests succeeded
- 6 of 6 member profile ingests succeeded
- roster parsing succeeded with 134 House members and 67 senators
- examples covered both House and Senate bills
- examples covered a bill with a roll call reference and bills with multiple text versions

## Design Implications

### What the prototype findings de-risked

- official bill ingestion is feasible without brittle browser automation
- legislator discovery can begin from a stable official roster page
- member detail enrichment is feasible with chamber-specific parsers
- bill text is parseable enough for indexing and retrieval

### What remains higher risk

- full legislator-level vote extraction
- district finder integration details
- committee historical change tracking
- text parsing for all version variants and engrossments
- resilient handling of HTML template changes across sessions

## Recommended Build Order

1. Revisor bill discovery and XML ingestion
2. Revisor bill text version ingestion
3. Joint roster ingestion
4. House profile enrichment
5. Senate profile enrichment
6. Canonical normalization and validation layer
7. Search and bill detail publication
8. Bill text chunking and retrieval index
9. Vote-detail adapters
10. District lookup adapter

## Out of Scope for Ingestion

- federal ingestion
- campaign website scraping
- social media data
- unsupported corruption, motive, or causal-influence findings
- non-official web crawling

Official campaign-finance filings and lobbying disclosures are allowed by
`docs/product-onboarding/product-scope.md` § "Not built yet — ingestion." They do not
belong in this bill-and-legislator loader, so they enter through a separate set of
reviewed public-record source adapters that preserve the filing behind every record and
relationship ([#1269](https://github.com/alethical-org/alethical/issues/1269)). Those
adapters are designed in `docs/architecture/campaign-finance-system-design.md`; the section
below states the one way they depart from the pipeline described here.

## Open Questions

- Do we want to ingest only the current biennium initially, or include prior sessions for legislator credibility?
- Should vote detail be a required launch dependency, or can v1 ship with bill status plus roll call totals only?
- Do we want district lookup in the ingestion stack, or as a separate online lookup service?
- Do we need PDF OCR fallback in v1, or can we rely on HTML and machine-readable text for current Minnesota bills?

## Recommendation

Proceed with a source-adapter architecture around:

- Revisor
- joint Legislature roster
- House member pages
- Senate member pages
- chamber vote and journal sources

The prototype findings showed that the design was sound enough to move into a formal schema and implementation plan.
# Live Minnesota Loader

The v0 canonical loader now has a runnable live-data entrypoint:

```bash
uv run python scripts/load_minnesota_data.py
```

That command fetches the current Minnesota legislator roster, member profile pages, and a default smoke set of 94th Legislature bills from authoritative Minnesota Legislature/Revisor sources, then upserts the canonical tables used by the public API. It is safe to rerun: bills, versions, actions, sponsors, legislators, service periods, committees, stats, ingestion runs, and source artifacts are updated without duplicating canonical records.

Useful variants:

```bash
# Fast smoke run: two legislators plus one bill.
uv run python scripts/load_minnesota_data.py --legislator-limit 2 --bill HF2136

# Bills only.
uv run python scripts/load_minnesota_data.py --skip-legislators --bill SF1832 --bill SF2483

# Roster identity/service rows only, without fetching every profile page.
uv run python scripts/load_minnesota_data.py --roster-only --skip-bills
```

Run after migrations/bootstrap in a fresh environment:

```bash
uv run python -m alembic -c alembic.ini upgrade head
uv run python scripts/load_minnesota_data.py --legislator-limit 10 --bill HF2136 --bill SF1832
```

The implementation lives in `alethical/pipeline/minnesota.py`; `scripts/load_sample_data.py` remains a deterministic local fixture loader for tests and offline demos.

The full-session bill discovery path is exposed through Oban as `full-bill-sync`. By default it discovers all Revisor House/Senate bills for the session and enqueues no downstream work directly; it ingests only missing bills unless `--refresh-existing` is passed.

Each accepted chunk reports `bill_keys` for every canonical write and
`text_changed_bill_keys` for the subset whose current version ID or ordered section-text hashes
changed. A rejected thin refresh appears in neither list. When inline RAG is enabled, the worker
flushes the accepted canonical rows, rebuilds only `text_changed_bill_keys` through the same
database session, and commits both layers once. The worker refuses a separate RAG database because
2 connections cannot make that publication atomic ([#1320](https://github.com/alethical-org/alethical/issues/1320)).

That same accepted text-change subset retires any current `bill_summary` before the transaction
commits. The database then clears `Bill.has_current_summary`, so product reads show the current
official record with no summary until a later enrichment lands. Metadata-only changes and rejected
thin responses do not retire a still-matching summary. Ingestion does not start paid enrichment;
the later missing-current batch can select the bill. Refresh and summary apply take the same bill-row
lock, so a result that finishes while a refresh is committing must wait and then check the committed
text rather than restoring an old summary ([#1321](https://github.com/alethical-org/alethical/issues/1321)).

```bash
# Single read-only pipeline entry point.
just pipeline local --dry-run
just pipeline-work local

# Write missing bills after reviewing the dry-run result.
just pipeline local --write --allow-writes
just pipeline-work local
```

The coordinator job records its child jobs in Oban metadata, then each stage runs as its own queued job. This keeps source sync, committee refresh, vote refresh, and AI batch preparation independently observable. AI enrichment remains split into prepare/submit/apply steps so token usage, provider batch IDs, output files, and eventual `ai_enrichment` writes can be tracked separately from canonical ingestion.

# One-Time Backfills Promoted From Source Checks

Two data sets were backfilled during schema validation and should be treated as normal ingestion stages going forward.

## Committee Memberships

Committee memberships come from the same member profile pages used by the live Minnesota roster loader:

- House member profile pages expose committee assignment links under "Committee Assignments."
- Senate member profile pages expose committee assignment links under "Committee Assignments."
- A legislator can validly have zero committee assignments; that should remain `committee_count = 0`, not a synthetic membership row.

The reusable implementation lives in `alethical.pipeline.committee_memberships`; for focused debugging use:

```bash
uv run python -m alethical.pipeline.committee_memberships --cleanup-orphans
```

This should be folded into regular roster ingestion. The intended steady-state flow is:

1. ingest the joint roster
2. fetch each member profile
3. upsert `legislator`, `legislator_service_period`, `committee`, and `committee_membership`
4. refresh `legislator_stats.committee_count`

The current standalone script exists because we needed an idempotent repair/backfill against an already-populated Supabase database.

## Roll-Call Vote Motions

Bill actions from Revisor can include a roll-call total such as `34-33`, but Revisor is not enough by itself to reconstruct individual legislator votes. The current deterministic backfill uses chamber-specific official sources:

- House: House vote detail pages, parsed into affirmative and negative member lists
- Senate: Senate journal pages, resolved through the Senate journal page API and parsed from PDF text

The reusable implementation lives in `alethical.pipeline.votes`; for focused debugging use:

```bash
uv run python -m alethical.pipeline.votes
```

This should be folded into regular bill ingestion as a post-action stage:

1. ingest bills and `bill_action` rows from Revisor
2. find actions with deterministic roll-call totals
3. resolve the chamber-specific official vote source
4. create one `vote_event` for the action
5. create `vote_record` rows for each unambiguously matched legislator
6. refresh `bill_stats.vote_event_count` and `legislator_stats.vote_record_count`

Votes remain optional. A bill can have zero vote events if it never receives a recorded roll call, if the action was not a roll call, or if the official source cannot be matched deterministically.

# AI Enrichment Status

The database and API are ready to serve AI enrichment. Enrichment is intentionally separate from canonical source ingestion: bill text, actions, votes, and committees are synced first; AI summaries are generated later from the canonical bill corpus.

What exists today:

- `ai_enrichment` table and `EnrichmentType` enum in `alethical/db/models.py`
- bill detail API support for `include=ai_summary` in `alethical/api/routers/public.py`
- frontend mapping for `ai_summary` in `apps/frontend/src/data/api.ts`
- RAG section/chunk construction in `alethical/pipeline/rag.py`
- OpenAI Batch API preparation, submission, status, and apply code in `alethical.pipeline.ai_enrichment`
- local Codex headless execution support in `alethical.pipeline.codex_enrichment` and the Oban `ai_codex` queue

What does not exist yet:

- no scheduled enrichment stage runs after canonical ingestion
- no deployed worker process around the full enrichment lifecycle

The intended production shape is a separate enrichment stage after canonical ingestion and RAG preparation. It should read canonical bill text/RAG rows, call the selected model or runner, write `ai_enrichment` rows with `model_name`, `content_json`, `source_version_hash`, and `is_current`, and leave official bill/action/vote data as the source of truth.

There are two supported enrichment backends:

1. OpenAI Batch API.
   Use this when the organization has enough batch token capacity and wants provider-managed asynchronous execution.

2. Codex headless local runner.
   Use this when the Batch API limit is constrained or when local control/parallelism is preferred. This uses local Oban for the work queue and local files for prompts/outputs. Production is only touched at the final `ai-apply` step.

Both backends use the same prompt/schema and the same final apply path.

## OpenAI Batch API Backend

The Batch API implementation lives in [`alethical.pipeline.ai_enrichment`](../../alethical/pipeline/ai_enrichment.py). It uses the Responses endpoint with structured JSON output and keeps the 24-hour asynchronous boundary explicit.

Prepare a batch JSONL file and manifest:

```bash
uv run python -m alethical.pipeline.oban --target production enqueue ai-prepare \
  --model gpt-4o-mini \
  --session 94-2025-regular \
  --output-dir .tmp/openai-batches-production \
  --only-missing-current-ai

uv run python -m alethical.pipeline.oban --target production drain ai_batch
```

Useful smaller run:

```bash
uv run python -m alethical.pipeline.oban --target production enqueue ai-prepare \
  --model gpt-4o-mini \
  --bill-key 94-2025-SF1832 \
  --output-dir .tmp/openai-batches-production \
  --force-enrichment
```

Submit the generated JSONL file:

```bash
uv run python -m alethical.pipeline.ai_enrichment submit .tmp/openai-batches/ai-enrichment-YYYYMMDDTHHMMSSZ.jsonl
```

Check status:

```bash
uv run python -m alethical.pipeline.ai_enrichment status batch_...
```

Apply completed output back into `ai_enrichment`:

```bash
uv run python -m alethical.pipeline.oban --target production enqueue ai-apply \
  --manifest-path .tmp/openai-batches/ai-enrichment-YYYYMMDDTHHMMSSZ.manifest.json \
  --batch-id batch_... \
  --write \
  --allow-writes

uv run python -m alethical.pipeline.oban --target production drain ai_apply
```

The script skips current enrichments when `model_name` and `source_version_hash` already match unless `--force` is passed. Before applying output, it verifies that the manifest still names the bill's current version and derives both supported source-hash forms directly from the current official section text. The 64-character form is used before retrieval rows exist; retrieval uses the same hash shortened to 16 characters. Accepting both means adding a search index cannot make unchanged output look old, while changed, missing or reordered official text still fails the check. Outdated output is counted and skipped, leaving the bill without a summary instead of letting a job prepared before a later refresh restore stale words. A matching output marks older current `bill_summary` rows for the bill non-current, then upserts the completed enrichment for the exact bill version and source hash ([#1321](https://github.com/alethical-org/alethical/issues/1321)).

## Codex Headless Backend

The Codex backend starts from the same prepared JSONL/manifest files but executes requests through the local Codex CLI. Use local Oban for this queue; do not use production Oban for local Codex execution.

Prepare the same request file first, usually against production so missing/current detection is based on production data:

```bash
uv run python -m alethical.pipeline.oban --target production enqueue ai-prepare \
  --model gpt-4o-mini \
  --session 94-2025-regular \
  --output-dir .tmp/openai-batches-production \
  --only-missing-current-ai

uv run python -m alethical.pipeline.oban --target production drain ai_batch
```

Then enqueue and run Codex locally:

```bash
uv run python -m alethical.pipeline.oban --target local enqueue codex-ai-enqueue \
  --manifest-path .tmp/openai-batches-production/ai-enrichment-YYYYMMDDTHHMMSSZ.manifest.json \
  --jsonl-path .tmp/openai-batches-production/ai-enrichment-YYYYMMDDTHHMMSSZ.jsonl \
  --run-dir .tmp/codex-ai-runs/production-missing-current-mini \
  --codex-model gpt-5.4-mini \
  --codex-model-name codex:gpt-5.4-mini

uv run python -m alethical.pipeline.oban --target local drain ai_batch
uv run python -m alethical.pipeline.oban --target local drain ai_codex --concurrency 18
```

Combine and validate local outputs:

```bash
uv run python -m alethical.pipeline.oban --target local enqueue codex-ai-combine \
  --run-dir .tmp/codex-ai-runs/production-missing-current-mini

uv run python -m alethical.pipeline.oban --target local drain ai_codex
```

Apply the combined output to production:

```bash
uv run python -m alethical.pipeline.oban --target production enqueue ai-apply \
  --manifest-path .tmp/codex-ai-runs/production-missing-current-mini/ai-enrichment-YYYYMMDDTHHMMSSZ.manifest.codex.manifest.json \
  --output-path .tmp/codex-ai-runs/production-missing-current-mini/combined.output.jsonl \
  --write \
  --allow-writes

uv run python -m alethical.pipeline.oban --target production drain ai_apply
```
