# Alethical Ingestion Pipeline System Design

Status: discussion draft

## Goal

Define a production-oriented ingestion pipeline for Alethical v1 that can reliably pull Minnesota legislative data from official sources, normalize it into a canonical domain model, retain provenance, and publish data that is usable by:

- web
- iOS
- Android
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
- bill text version count should be monotonic
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

### Stage 7. Publication

Purpose:

- expose stable downstream contracts

Consumers:

- product APIs
- mobile clients
- web client
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

Tables:

- `bill_search_document`
- `legislator_search_document`
- `bill_text_chunk`
- `embedding`
- `ai_enrichment`
- `tracking_event`

Responsibility:

- fast product reads and retrieval

## Rough Prototype Findings

To validate the design, I built rough prototype ingestors against the live official sources:

- [mn_ingestion_prototype.py](/Users/ada/fun/alethical/prototypes/mn_ingestion_prototype.py)

Generated sample outputs:

- [bill-hf2136.json](/Users/ada/fun/alethical/prototype-output/bill-hf2136.json)
- [legislator-roster.json](/Users/ada/fun/alethical/prototype-output/legislator-roster.json)
- [house-member-15518.json](/Users/ada/fun/alethical/prototype-output/house-member-15518.json)
- [senate-member-10002.json](/Users/ada/fun/alethical/prototype-output/senate-member-10002.json)
- [validation-report.json](/Users/ada/fun/alethical/prototype-output/validation-report.json)

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

## Prototype Commands

Generate the sample artifacts:

```bash
python3 prototypes/mn_ingestion_prototype.py bill --out prototype-output/bill-hf2136.json
python3 prototypes/mn_ingestion_prototype.py roster --out prototype-output/legislator-roster.json
python3 prototypes/mn_ingestion_prototype.py member --url https://www.house.mn.gov/members/profile/15518 --out prototype-output/house-member-15518.json
python3 prototypes/mn_ingestion_prototype.py member --url 'http://www.senate.leg.state.mn.us/members/member_bio.php?leg_id=10002' --out prototype-output/senate-member-10002.json
python3 prototypes/mn_ingestion_prototype.py validate --out prototype-output/validation-report.json
```

## Design Implications

### What the prototypes de-risk

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

## Recommended V1 Build Order

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

## Out of Scope for the First Ingestion Milestone

- federal ingestion
- campaign website scraping
- donor and lobbying data
- social media data
- corruption or influence graphs
- non-official web crawling

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

The prototypes show that the design is sound enough to move into a formal schema and implementation plan.
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
uv run python scripts/bootstrap_db.py
uv run python scripts/load_minnesota_data.py --legislator-limit 10 --bill HF2136 --bill SF1832
```

The implementation lives in `alethical/ingestion/minnesota.py`; `scripts/load_sample_data.py` remains a deterministic local fixture loader for tests and offline demos.
