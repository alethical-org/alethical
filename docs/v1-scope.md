# Alethical Rebuild V1 Scope

Status: discussion draft

## Goal

Rebuild Alethical from scratch as a trustworthy Minnesota legislative intelligence platform with a clean data model, reliable ingestion, a scalable backend, and a responsive web product. V1 ships web only; native iOS and Android apps are post-MVP ([#91](https://github.com/alethical-org/alethical/issues/91)). The backend APIs, auth model, and design system stay client-agnostic so mobile can follow without a rewrite.

V1 should optimize for:

- Data accuracy over feature breadth
- Minnesota depth over national breadth
- Structured legislative data first, AI second
- One backend platform serving all clients
- Clear provenance for every important fact shown to users

## Product Definition

V1 is successful if a user can:

- Search and browse Minnesota bills
- Open a bill and understand what it does, who sponsored it, where it is in the process, and how votes broke down when roll calls exist
- Search legislators and inspect their profiles and sponsored bills
- Find their representatives by address or city
- Sign in to track bills and receive basic updates
- Ask grounded questions about Minnesota legislation and get answers with citations back to official or ingested sources; persistent chat sessions (history, follow-ups) require sign-in

V1 is not trying to be a full political accountability platform yet. It is a reliable legislative data and analysis product.

## Core Principles

### 1. Minnesota First

The rebuild should focus on one jurisdiction done well. Minnesota should be the only fully supported jurisdiction in v1.

### 2. Canonical Data Model

All UI and AI features should sit on top of one normalized domain model for bills, people, actions, votes, documents, and sessions.

### 3. Provenance by Default

Every generated summary, extracted field, and chat answer should be traceable to source material.

### 4. Shared Platform, Client-Agnostic Backend

The MVP ships one client: a responsive web app. The backend APIs, auth model, and domain concepts stay client-agnostic so that post-MVP iOS and Android apps ([#91](https://github.com/alethical-org/alethical/issues/91)) can consume the same platform without a rewrite.

### 5. AI as a Layer, Not the Source of Truth

LLM output should enrich the product, not define the canonical record.

## Recommended V1 Scope

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

V1 canonical ingestion is only acceptable if it meets all of the following:

- Source fidelity:
  - raw source artifacts are stored before destructive transformation
  - canonical records retain source URLs, source identifiers, fetch timestamps, and ingestion run IDs
  - canonical records can be reproduced from retained source artifacts
- Completeness:
  - all discovered source records needed for v1 product use cases are fetched or explicitly marked failed
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

Every canonical ingestion build in v1 should emit a machine-readable validation report that checks:

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

### Out of Scope

- 50-state ingestion
- Full federal legislative ingestion as a first-class dataset
- Campaign website scraping
- Donor or lobbying influence ingestion
- Social media ingestion
- Real-time streaming ingestion if scheduled refresh is sufficient
- Fully autonomous extraction from arbitrary web sources

### 2. Domain Design

### In Scope

The v1 domain model should cover these core entities:

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

### Out of Scope

- Broad political knowledge graph of people, donors, PACs, and organizations
- Candidate promise tracking
- Trust or corruption scoring
- Relationship graph exploration tools
- Multi-jurisdiction abstractions beyond what is needed for Minnesota and future extensibility

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
- Avoid introducing separate search infrastructure in v1 unless performance demands it
- Separate canonical data from derived AI data
- Store raw source payloads so parsers can be re-run without re-scraping when possible

### Out of Scope

- Data warehouse as part of the critical path
- Event sourcing for the whole platform
- Premature microservice decomposition
- Dedicated search stack like Elasticsearch or OpenSearch on day one
- Complex graph database

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

V1 RAG ingestion is only acceptable if it meets all of the following:

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

Every RAG ingestion build in v1 should emit a machine-readable validation report that checks:

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

### Out of Scope

- Open-ended political analysis with no grounding requirement
- Promise-vs-vote scoring
- Corruption or influence detection
- Multi-model adjudication framework
- User-facing debate mode or opinion mode
- Agentic research across the public web

### 5. Frontend Scope

### In Scope

V1 ships a single client:

- Responsive web app (desktop and mobile-web breakpoints)

Native iOS and Android apps are **out of scope for the MVP** and deferred to post-MVP ([#91](https://github.com/alethical-org/alethical/issues/91)). See "Post-MVP: iOS and Android" below.

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
- Primary admin and operational surface in early v1

### Post-MVP: iOS and Android

Native iOS and Android apps are deferred to post-MVP ([#91](https://github.com/alethical-org/alethical/issues/91)). The frontend is already an Expo/React Native codebase capable of targeting all three platforms, and styling is centralized in `theme/tokens.ts`, so mobile can be added without a rewrite. When the native apps ship they will:

- Share the mobile app architecture with common backend APIs
- Cover the core read and track flows: browse, search, bill detail, legislator profile, tracked bills, chat
- Support authentication and basic account settings

### Frontend Expectations

- Responsive design across desktop and mobile-web breakpoints
- Consistent navigation and domain terminology
- Clear distinction between official data and AI-generated analysis
- Strong source linking from bill and chat experiences

### Out of Scope

- Native iOS and Android apps (post-MVP — see above)
- Distinct feature sets by platform
- Tablet-specific custom product surfaces
- Heavy native-only features on first release
- Complex personalization
- Social features
- Community commenting

### 6. User Accounts and Notifications

### In Scope

- Account creation and sign-in
- Basic profile
- Track and untrack bills
- Email notifications for meaningful bill status updates
- Saved chat history for signed-in users if implementation is straightforward

### Out of Scope

- Team accounts and enterprise permissions
- Paid plans and billing
- Push notifications as a hard v1 requirement
- Fine-grained notification preferences

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

### Out of Scope

- Full editorial CMS
- Rich business analytics dashboard
- Fully self-serve prompt management UI for non-technical users

## Recommended V1 Architecture Shape

V1 should likely be a modular monolith, not a microservice system.

Recommended major components:

- API application
- Ingestion workers
- AI enrichment workers
- Shared PostgreSQL database
- Shared object storage
- Queue for async jobs
- Shared auth system
- Web client
- Mobile clients (post-MVP — [#91](https://github.com/alethical-org/alethical/issues/91))

This keeps the system simple enough to ship while still separating concerns.

## Suggested Scope Cuts If Timeline or Budget Tightens

Native iOS and Android apps are already out of the MVP (see § Frontend Scope). If we need to cut further, cut in this order:

1. Rich AI analysis sections beyond summary and citations
2. Legislator committee and historical data depth
3. Email notifications
4. Bill comparison UI

The last things we should cut are:

- Canonical data model
- Ingestion reliability
- Bill detail correctness
- Legislator lookup
- Grounded chat with citations

## Explicitly Out of Scope for V1

- Native iOS and Android apps (deferred to post-MVP — [#91](https://github.com/alethical-org/alethical/issues/91))
- Campaign promise tracking
- Promise-vs-vote scoring
- Corruption, fraud, or conflict-of-interest detection
- Multi-model consensus engine
- Broad federal product parity with Minnesota
- Monetization and subscription billing
- Lobbyist workflow features
- Public commenting or social sharing loops
- Advanced recommendation engine
- Dedicated data warehouse
- Full enterprise admin and permissions

## V1 Success Criteria

V1 should be considered complete when:

- Minnesota bill and legislator data refresh reliably on a scheduled basis
- Core bill pages are accurate and traceable to source data
- Users can search, browse, and track bills in the responsive web app (desktop and mobile web)
- Users can find their legislators
- Users can ask grounded legislative questions and get cited answers
- The product can be maintained by a small team without manual heroics

## Open Questions for Scope Discussion

- Should federal bills be fully out of scope, or should we keep a minimal read-only federal surface?
- Is bill comparison a must-have for v1, or can chat handle comparison questions initially?
- Should push notifications be a launch requirement, or is email enough for the first release?
- How many historical sessions do we need in the first cut to make legislator profiles credible?
- Do we want committee data in v1 only if it is clean, or do we treat it as required data?
- How much admin tooling do we need before launch versus command-line or internal-only tools?

## Proposed Next Step

Use this document to make scope decisions first. After that, produce:

1. A system architecture document
2. A domain model and schema draft
3. An ingestion architecture spec
4. A client platform plan for the responsive web app (with iOS and Android as post-MVP targets — [#91](https://github.com/alethical-org/alethical/issues/91))
5. A chat and retrieval design
