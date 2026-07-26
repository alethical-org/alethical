# Alethical Product Scope

Status: current. This describes **what the product is**, the principles behind it, and
what it deliberately does not do.

**How to read the boundaries in this doc.** Every "out of scope" list below is now
labelled by *which of three jobs it does*, because they are not the same thing:

- **Permanent non-goals** — we are not building this, ever. A mission boundary.
- **Not built yet** — we intend to, it isn't built, and the item names what it waits on.
- **Standing defaults** — the simpler choice holds until a measurement says otherwise.
  These are not sequencing; they are engineering positions with a named trigger.

Nothing here defers work by naming a release. Milestones group and report work; they do
not gate it (`.claude/rules/workflow.md` rule 13). If you find a boundary in this doc
phrased as "not until v-something," that is a bug in the doc.

## Goal

Rebuild Alethical from scratch as a trustworthy Minnesota legislative intelligence platform with a clean data model, reliable ingestion, a scalable backend, and a responsive web product. The first release ships web only; native iOS and Android apps are not built yet ([#91](https://github.com/alethical-org/alethical/issues/91), milestone `v9 tbd`). The backend APIs, auth model, and design system stay client-agnostic so mobile can follow without a rewrite.

The product optimizes for:

- Data accuracy over feature breadth
- Minnesota depth over national breadth
- Structured legislative data first, AI second
- One backend platform serving all clients
- Clear provenance for every important fact shown to users

## Product Definition

The product is successful if a user can:

- Search and browse Minnesota bills
- Open a bill and understand what it does, who sponsored it, where it is in the process, and how votes broke down when roll calls exist
- Search legislators and inspect their profiles and sponsored bills
- Find their representatives by address or city
- Sign in to track bills and receive basic updates
- Ask grounded questions about Minnesota legislation and get answers with citations back to official or ingested sources; persistent chat sessions (history, follow-ups) require sign-in

Alethical is a reliable legislative data and analysis product. It is deliberately not a
political accountability platform — see Permanent non-goals below, which is a statement
of what we don't do rather than a list of things we haven't got to.

## Core Principles

### 1. Minnesota First

Focus on one jurisdiction done well. Minnesota is the only fully supported jurisdiction.

### 2. Canonical Data Model

All UI and AI features should sit on top of one normalized domain model for bills, people, actions, votes, documents, and sessions.

### 3. Provenance by Default

Every generated summary, extracted field, and chat answer should be traceable to source material.

### 4. Shared Platform, Client-Agnostic Backend

One client ships first: a responsive web app. The backend APIs, auth model, and domain concepts stay client-agnostic so native iOS and Android apps ([#91](https://github.com/alethical-org/alethical/issues/91)) can consume the same platform without a rewrite whenever they are built.

### 5. AI as a Layer, Not the Source of Truth

LLM output should enrich the product, not define the canonical record.

## Scope by area

### 1. Ingestion Pipeline

### In Scope

- Automated ingestion for Minnesota legislative data
- Support for current and recent legislative sessions needed for product usefulness
- Bill metadata:
  - bill number
  - chamber
  - session
  - title
  - status
  - summary or description
  - official source URL
- Bill lifecycle data:
  - actions
  - referrals
  - status transitions
  - key dates
- Sponsorship data:
  - chief author
  - co-authors
  - chamber affiliation
  - party affiliation
- Legislator data:
  - name
  - chamber
  - district
  - party
  - contact info
  - committee memberships if available from stable sources
- Vote data:
  - vote totals
  - roll call data when available
  - legislator-level vote records when available
- Bill documents:
  - official summaries
  - bill text versions
  - PDFs and HTML pages
- Raw source retention for reprocessing and auditability
- Scheduled refresh jobs
- Idempotent upserts and backfills
- Parser failure tracking and retry support
- Manual override path for known bad records

### In Scope Implementation Expectations

- Source adapters should be isolated from the domain model
- Raw source artifacts should be stored before normalization
- Normalized records should carry source metadata and timestamps
- AI enrichment should run after canonical data ingestion, not during scraping

### Canonical Ingestion Quality Rubric

Canonical ingestion is only acceptable if it meets all of the following:

- Source fidelity:
  - raw source artifacts are stored before destructive transformation
  - canonical records retain source URLs, source identifiers, fetch timestamps, and ingestion run IDs
  - canonical records can be reproduced from retained source artifacts
- Completeness:
  - all discovered source records needed for the product's use cases are fetched or explicitly marked failed
  - every ingested bill version, legislator profile, roster record, and vote artifact is either normalized or surfaced as a parser failure
  - no canonical bill or legislator record silently drops critical required fields
- Correctness:
  - canonical identity fields are stable and deterministic
  - actions remain ordered
  - bill versions remain tied to the correct bill and session
  - legislator, chamber, district, and party data reconcile across official sources or are flagged for review
  - vote totals and legislator-level vote records match the official source used
- Robustness:
  - transient upstream failures are retried
  - ingestion is idempotent
  - single-record re-fetch and re-parse are possible without rerunning the whole pipeline
  - parser failures are tracked and reviewable
- Auditability:
  - canonical data and manual overrides are distinguishable
  - normalization decisions can be traced back to the originating source artifact
  - downstream RAG and product records can point back to canonical source records

### Canonical Ingestion Validation Requirements

Every canonical ingestion build should emit a machine-readable validation report that checks:

- source fetch success and failure counts by adapter
- parser success and failure counts by adapter
- bill, legislator, roster, and vote fixture coverage
- required-field presence for canonical records
- cross-source reconciliation checks for key identity fields
- monotonicity and ordering checks for actions and versions
- duplicate-record detection on stable external IDs
- unmatched or orphaned canonical references

The prototype standard for this workstream should be:

- validated against multiple live bills, including omnibus bills
- validated against both House and Senate member pages
- validated against the current joint roster
- validation output written as a machine-readable artifact before the pipeline is considered production-ready

### Permanent non-goals — ingestion

We do not ingest these, and not because of sequencing. Each one would pull the product
toward inference about people rather than the legislative record:

- 50-state ingestion — Minnesota depth is the point (Core Principle 1)
- Campaign website scraping
- Donor or lobbying influence ingestion
- Social media ingestion
- Fully autonomous extraction from arbitrary web sources — every source gets a reviewed adapter

### Not built yet — ingestion

- **Federal legislative data as a first-class dataset.** Genuinely undecided rather than
  refused: the open question is whether a minimal read-only federal surface is worth it
  (see Open questions below). Nothing is built, and nothing blocks starting.

### Standing defaults — ingestion

- **Scheduled refresh, not real-time streaming.** Polling on a schedule is the default and
  stays the default. Revisit if users need sub-hour freshness, or if a source starts
  offering a push feed cheaper than polling it.

### 2. Domain Design

### In Scope

The domain model should cover these core entities:

- Jurisdiction
- Legislative session
- Chamber
- District
- Legislator
- Legislator service period
- Committee
- Bill
- Bill version
- Bill document
- Bill action
- Bill status
- Sponsorship
- Vote event
- Vote record
- Topic or category
- User
- Auth identity
- Tracked bill
- Saved place
- Notification preference
- Notification endpoint
- Notification event
- Chat session
- Chat message
- Source artifact
- AI enrichment record

### Required Domain Behaviors

- Bills can have many versions, actions, sponsors, votes, and source documents
- Legislator identity must be stable even if party, district, chamber assignment, office contact info, or caucus changes over time
- Time-varying legislator state must be preserved historically rather than overwritten
- The current legislator state shown in product surfaces should be derived from the latest active service-period record
- Legislators can belong to multiple committees over time
- Vote records must tie a legislator to a vote event and a specific bill
- AI outputs must be versioned and tied to the bill, legislator, or document they summarize
- Entities should support historical snapshots where data changes over time
- Auth identities must remain separate from app-user state so the auth provider can change without rewriting product tables
- Chat sessions must belong to signed-in users only

### Permanent non-goals — domain model

The model describes the legislative record. It does not model influence or character:

- Broad political knowledge graph of people, donors, PACs, and organizations
- Candidate promise tracking
- Trust or corruption scoring
- Relationship graph exploration tools

### Standing defaults — domain model

- **Abstract for Minnesota, not for every jurisdiction.** Keep multi-jurisdiction
  abstraction to what Minnesota needs plus cheap extensibility. Revisit when a second
  jurisdiction is actually being added — not in anticipation of one.

### 3. Database and Storage Design

### In Scope

- PostgreSQL as the canonical transactional database
- Relational schema for core legislative entities
- `pgvector` for embeddings and retrieval
- Object storage for raw artifacts:
  - HTML
  - PDFs
  - extracted text
  - derived JSON payloads
- Full-text search using PostgreSQL initially
- Ingestion job and run tables for operational visibility
- AI enrichment tables for summaries, chunks, embeddings, citations, and prompt metadata
- Audit fields on important records:
  - created_at
  - updated_at
  - source_updated_at
  - ingestion_run_id

### Recommended Design Direction

- Keep the source of truth in Postgres
- Avoid introducing separate search infrastructure unless performance demands it (see Standing defaults below)
- Separate canonical data from derived AI data
- Store raw source payloads so parsers can be re-run without re-scraping when possible

### Standing defaults — storage and search

All five of these are engineering positions, not deferred work. Each says *the simpler
thing holds until something measurable says otherwise* — so each carries its trigger.
Read them as defaults to be argued out of with evidence, never as "not yet."

- **Postgres full-text search, not a dedicated search stack.** No Elasticsearch or
  OpenSearch. Revisit when search latency or relevance on the real corpus demonstrably
  fails to hold — measured, not anticipated.
- **Postgres is the source of truth; no data warehouse on the critical path.** Revisit if
  analytical queries start competing with serving traffic.
- **No event sourcing for the platform.** Provenance and audit come from source artifacts
  and ingestion-run records, which is cheaper and already sufficient.
- **Modular monolith, not microservices.** Revisit when a component's scaling or
  deploy cadence genuinely diverges from the rest.
- **Relational, not a graph database.** Revisit if a shipped feature needs multi-hop
  traversal that SQL expresses badly — noting that the relationship-graph features which
  would want one are permanent non-goals.

### 4. AI and RAG Chat

### In Scope

- Grounded question answering over Minnesota legislative data. Persistent chat
  sessions (history, follow-ups, saved context) are signed-in only. Anonymous
  visitors may receive a single stateless, rate-limited, cited answer as a
  conversion teaser — no session is persisted, and follow-ups, history, and
  tracking require sign-in.
- A separate RAG ingestion pipeline layered on canonical legislative ingestion
- Retrieval over:
  - bill metadata
  - bill text
  - summaries
  - actions
  - sponsorships
  - vote records
  - legislator profiles
- Citations in every answer
- Basic follow-up conversation within a chat session for authenticated users
- Narrowly scoped question classes:
  - What does this bill do?
  - What happened to this bill?
  - Who sponsored this bill?
  - How did a legislator vote?
  - What bills exist on a topic?
  - Compare two bills
- Guardrails that prefer saying "not enough data" over making unsupported claims
- Prompt and retrieval configuration that can be tuned without rewriting the whole system

### In Scope RAG Ingestion

- Consume canonical bill and legislator records rather than scraping live sources directly
- Derive retrieval-safe text from canonical sections and documents
- Preserve section-level provenance:
  - bill key
  - bill version source URL
  - article ID when present
  - section ID
  - citation label
- Produce cleaned section documents before chunking
- Produce final chunk records for embedding and retrieval
- Record `cleaning_version`, `chunking_version`, and source hashes so the pipeline can be re-run deterministically
- Keep canonical data and RAG-derived data separate in storage and processing

### RAG Ingestion Quality Rubric

RAG ingestion is only acceptable if it meets all of the following:

- Fidelity:
  - every source section produces at least one cleaned RAG section document
  - every source section is covered by at least one final chunk
  - chunk and section records preserve enough metadata to reconstruct a user-facing citation
- Cleanliness:
  - zero raw HTML tags in cleaned text or chunk text
  - zero raw `new text begin/end` markers
  - zero raw `deleted text begin/end` markers
  - whitespace and punctuation noise are materially reduced from source-shaped extraction
- Legibility:
  - section headings remain readable
  - article headings remain readable when present
  - amendatory text remains interpretable
  - appendix material remains retrievable
  - appropriation and table-like material is converted into readable grouped text rather than raw line-noise
- Retrieval quality:
  - chunking respects section boundaries first
  - large sections are split on paragraph-like or clause-like boundaries, not arbitrary character boundaries
  - chunks stay within a bounded target size
  - low-information chunks are only allowed when the source section itself is genuinely short
- Reprocessability:
  - the RAG pipeline can be re-run from canonical data without re-scraping
  - the outputs are versioned so retrieval changes can be audited

### RAG Ingestion Validation Requirements

Every RAG ingestion build should emit a machine-readable validation report that checks:

- source section count equals cleaned section-document count
- every section has at least one chunk
- banned marker count is zero
- HTML tag count is zero
- oversize chunk count is zero
- duplicate chunk count is zero
- before/after newline noise is measured and reduced

The current prototype standard for this workstream is already established:

- validated against at least two omnibus bills
- full section coverage
- machine-readable validation report
- measurable reduction in formatting noise before embeddings

### In Scope AI Enrichment

- Bill summary generation
- Key talking points
- Potential benefits and concerns
- Topic classification
- Stakeholder extraction when grounded in the bill text or canonical metadata

### Permanent non-goals — AI

These are the sharpest boundaries in the product. Every one of them would require the
system to assert something it cannot cite, which the grounded-answer invariants forbid
outright (`.claude/rules/grounded-answers.md` rules 1 and 3):

- Open-ended political analysis with no grounding requirement
- Promise-vs-vote scoring
- Corruption or influence detection
- User-facing debate mode or opinion mode
- Agentic research across the open web
- Multi-model adjudication or consensus engine — the answer to "is this true?" is a
  citation, not a vote among models

### 5. Frontend Scope

### In Scope

One client ships today:

- Responsive web app (desktop and mobile-web breakpoints)

Native iOS and Android apps are **not built yet** ([#91](https://github.com/alethical-org/alethical/issues/91)). See "Native iOS and Android" below.

### Product Surfaces In Scope

- Public home and search
- Bill list and filtering
- Bill detail
- Legislator directory
- Legislator profile
- Find my legislator
- User account
- Tracked bills
- Chat

### Web

- Responsive web app
- Full core functionality
- Primary admin and operational surface

### Native iOS and Android — not built yet

Native iOS and Android apps are not built yet ([#91](https://github.com/alethical-org/alethical/issues/91)). The frontend is already an Expo/React Native codebase capable of targeting all three platforms, and styling is centralized in `theme/tokens.ts`, so mobile can be added without a rewrite. When the native apps ship they will:

- Share the mobile app architecture with common backend APIs
- Cover the core read and track flows: browse, search, bill detail, legislator profile, tracked bills, chat
- Support authentication and basic account settings

### Frontend Expectations

- Responsive design across desktop and mobile-web breakpoints
- Consistent navigation and domain terminology
- Clear distinction between official data and AI-generated analysis
- Strong source linking from bill and chat experiences

### Permanent non-goals — frontend

- Social features
- Community commenting or public comment threads
- **Distinct feature sets by platform.** One product across clients, not three that
  diverge — the same commitment as Core Principle 4 and the shared design language.

### Not built yet — frontend

- **Native iOS and Android apps** ([#91](https://github.com/alethical-org/alethical/issues/91)) —
  see "Native iOS and Android" above. The codebase already targets them.

### Standing defaults — frontend

- **No tablet-specific product surfaces.** Responsive breakpoints cover tablets. Revisit
  if tablet traffic turns out to be a real share of use.
- **Personalization stays minimal** — tracked bills and saved places, not a recommendation
  surface. Revisit only against evidence that users want more.

### 6. User Accounts and Notifications

### In Scope

- Account creation and sign-in
- Basic profile
- Track and untrack bills
- Email notifications for meaningful bill status updates
- Saved chat history for signed-in users if implementation is straightforward

### Not built yet — accounts and notifications

None of these is refused; none is built. Email-first notification is the shipped default,
so each of these is an addition rather than a change of direction:

- Push notifications — email covers the current need; nothing blocks adding push
- Fine-grained notification preferences — one channel toggle today
- Team accounts and enterprise permissions
- Paid plans and billing

### 7. Admin and Operations

### In Scope

- Internal admin surface or tooling for:
  - ingestion run status
  - failed jobs
  - parser errors
  - reprocessing a bill or legislator
  - reviewing AI enrichment failures
- Observability:
  - logs
  - metrics
  - error tracking
- Basic health checks and alerts

### Not built yet — admin and operations

Operations run through the CLI and internal endpoints today. These are unbuilt tooling,
not rejected ideas — each becomes worth building when a non-engineer needs to do the job:

- Full editorial CMS
- Rich business analytics dashboard
- Self-serve prompt management UI for non-technical users

## Architecture shape

A modular monolith, not a microservice system.

Recommended major components:

- API application
- Ingestion workers
- AI enrichment workers
- Shared PostgreSQL database
- Shared object storage
- Queue for async jobs
- Shared auth system
- Web client
- Mobile clients (not built yet — [#91](https://github.com/alethical-org/alethical/issues/91))

This keeps the system simple enough to ship while still separating concerns.

## What matters most — priorities under pressure

A statement of relative importance, useful whenever effort has to be spent somewhere and
not somewhere else.

**Protect these first.** They are what makes the product trustworthy, and degrading any of
them costs more than any feature gains:

- Canonical data model
- Ingestion reliability and freshness
- Bill detail correctness
- Legislator lookup
- Grounded answers with citations

**Give ground here first, if something has to give:** depth of AI analysis beyond summary
and citations · legislator committee and historical data depth · notification breadth ·
bill comparison UI.

(This replaces a "cut in this order if timeline or budget tightens" list. The ordering was
written against a fixed launch date that no longer governs, but the underlying judgment —
what is load-bearing versus what is enhancement — still holds, so it is kept as a
priorities statement.)

## Permanent non-goals — the consolidated list

The single answer to "will Alethical ever do X?" Everything here is a deliberate boundary,
not a backlog. They cluster into one idea: **Alethical reports the legislative record; it
does not adjudicate people.**

- Campaign promise tracking, and promise-vs-vote scoring
- Corruption, fraud, or conflict-of-interest detection
- Trust, integrity, or accountability scoring of legislators
- Multi-model consensus or adjudication engine
- Open-ended political analysis with no grounding requirement
- User-facing debate or opinion mode
- Agentic research across the open web
- Donor, lobbying, or influence-relationship modelling
- Public commenting, comment threads, or social sharing loops
- 50-state ingestion

**Not on this list, and deliberately so** — these are unbuilt, not refused, and each is
covered under a "Not built yet" heading above: native mobile apps
([#91](https://github.com/alethical-org/alethical/issues/91)) · federal data · monetization
and billing · enterprise admin and permissions · lobbyist workflow features · a
recommendation surface · admin tooling depth.

> **Candidate data is not promise tracking.** Candidate *profiles, search, and tracking* are
> a planned direction, not built yet — [#147](https://github.com/alethical-org/alethical/issues/147)
> (profiles/search) and [#148](https://github.com/alethical-org/alethical/issues/148)
> (tracking), both on the `v8 candidates` milestone. What is permanently out is
> *promise tracking and promise-vs-vote scoring* — the accountability-scoring features,
> not candidate data surfaces.

> **Candidates vs. promise tracking:** candidate *profiles, search, and tracking* are a planned direction, not built yet ([#147](https://github.com/alethical-org/alethical/issues/147) profiles/search and [#148](https://github.com/alethical-org/alethical/issues/148) tracking, both on the `v8 candidates` milestone — there is no `Elections` milestone, despite what an earlier version of this line said). What stays out of scope above is *campaign/candidate promise tracking and promise-vs-vote scoring* specifically — the accountability-scoring features, not candidate data surfaces.

## Success criteria

The product is working when:

- Minnesota bill and legislator data refresh reliably on a scheduled basis
- Core bill pages are accurate and traceable to source data
- Users can search, browse, and track bills in the responsive web app (desktop and mobile web)
- Users can find their legislators
- Users can ask grounded legislative questions and get cited answers
- The product can be maintained by a small team without manual heroics

## Open questions

Still genuinely undecided:

- **Federal data:** fully out, or a minimal read-only federal surface? Nothing built either
  way; this is the one item in the ingestion section that is undecided rather than refused.
- **Committee data:** required, or included only when it reconciles cleanly? Relevant
  because committee `role` is not currently ingested at all (always null), so any surface
  depending on it is blocked on ingestion work, not on a product decision.
- **Historical depth:** how many past sessions make legislator profiles credible? The
  corpus is the 94th biennium today.

**Since resolved** — kept because the answers are load-bearing:

- *Bill comparison as a distinct feature?* No. Comparison questions route through Grounded
  Ask; cross-bill synthesis is tracked as
  [#87](https://github.com/alethical-org/alethical/issues/87) and until it ships those
  questions get a cited bill list.
- *Push notifications at launch?* Email-first, and that is what shipped. Push is unbuilt,
  not required.
- *How much admin tooling before launch?* CLI and internal endpoints have been sufficient;
  richer tooling is listed under "Not built yet — admin and operations."

*(A "Proposed Next Step" section listing five documents to produce was removed on
2026-07-26: all five exist — `docs/backend-api-system-design.md`,
`docs/db-schema-system-design.md`, `docs/ingestion-pipeline-system-design.md`,
`docs/frontend-screen-system-design.md`, and `docs/rag-ingestion-system-design.md` /
`docs/grounded-ask-spec.md`.)*
