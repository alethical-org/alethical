# Alethical Backend API System Design

Status: v1 design draft

## Goal

Design a REST API for Alethical v1 that:

- serves web, iOS, and Android from one backend
- follows resource-oriented REST conventions
- maps cleanly to the current domain and database model
- gives the frontend economical access to every core user story
- keeps public, signed-in, and internal operational surfaces clearly separated

## Design Basis

This API design follows these practical REST rules:

- resources are identified by nouns and stable URIs
- standard HTTP methods carry the action semantics
- requests are stateless
- APIs are versioned in the URI
- errors are explicit and use appropriate status codes
- large collections support filtering, sorting, and pagination
- responses include resource links where they materially help navigation

This is aligned with the Google Cloud REST overview and best-practice guidance around resources, URIs, statelessness, versioning, HTTP methods, security, pagination, filtering, and graceful errors.

## Runtime Recommendation

### Framework

- FastAPI
- Pydantic response models
- SQLAlchemy query layer
- OpenAPI generated from the FastAPI app

### Server Process Model

Recommended default:

- FastAPI app
- Uvicorn as the ASGI server
- one Uvicorn process per container in containerized deployments

Why:

- FastAPI documents that Uvicorn can run multiple workers directly
- FastAPI also indicates that in container-orchestrated environments it is often cleaner to run one Uvicorn process per container and scale with replicas

Gunicorn is still reasonable when we deploy on a single VM and want a mature process manager, but if we do that we should use the `uvicorn-worker` package rather than the deprecated `uvicorn.workers` module.

### Deployment Modes

Local development:

```bash
uv run uvicorn alethical.api.main:create_app --factory --reload
```

Single-VM production:

```bash
uv run gunicorn alethical.api.main:create_app \
  -k uvicorn_worker.UvicornWorker \
  --workers 4 \
  --bind 0.0.0.0:8000 \
  --factory
```

Containerized production:

```bash
uv run uvicorn alethical.api.main:create_app \
  --factory \
  --host 0.0.0.0 \
  --port 8000
```

Inference:

- if we are already using Docker Compose now and likely Kubernetes or a managed platform later, one Uvicorn process per container is the better default
- Gunicorn should be an optional deployment mode, not a core architecture assumption

## API Quality Rubric

The API is acceptable only if it satisfies all of these:

### 1. User Story Coverage

Every v1 user story must have a direct API path.

### 2. Economic Frontend Access

No core screen should require excessive client orchestration.

Target:

- list pages: one request
- detail pages: one initial request, plus optional secondary requests for heavy tabs or modals
- signed-in state should be available without per-row follow-up requests

### 3. REST Correctness

- plural nouns for collections
- stable resource identifiers
- GET/POST/PATCH/PUT/DELETE used consistently
- no RPC-style `/doThing` endpoints in the public API

### 4. Clear Auth Boundaries

- public read endpoints stay public
- signed-in features live under authenticated user scope
- internal ingestion and moderation tooling use a separate internal namespace

### 5. Evolvability

- `/api/v1` versioning
- representations are decoupled from raw DB rows
- future multi-jurisdiction expansion should not require URI redesign

## Namespace Layout

Public API:

- `/api/v1/...`

Authenticated user API:

- `/api/v1/me/...`

Internal operations API:

- `/internal/v1/...`

Health and readiness:

- `/healthz`
- `/readyz`

## Resource Identity

Public identifiers should be stable and client-safe.

Recommended identifiers:

- `session_slug`: `94-2025-regular`
- `bill_id`: use canonical bill key such as `94-2025-SF1832`
- `legislator_id`: stable opaque UUID in API, plus a `slug` field for frontend routes
- `district_id`: stable opaque UUID, plus `code` like `64B`
- `chat_session_id`: stable opaque UUID

Why this split:

- bills already have a clean canonical public key
- legislators do not yet have a similarly strong human-readable immutable key, so opaque ID is safer

## Representation Rules

### Media Type

- JSON only for v1

### Casing

- public JSON uses `snake_case` for consistency with backend models and ingestion artifacts

### Timestamps

- ISO 8601 UTC timestamps

### Envelope Shape

Collection responses:

```json
{
  "data": [],
  "page": {
    "limit": 20,
    "next_cursor": "opaque-cursor-or-null",
    "has_more": true
  },
  "links": {
    "self": "/api/v1/bills?limit=20",
    "next": "/api/v1/bills?limit=20&cursor=opaque-cursor"
  }
}
```

Detail responses:

```json
{
  "data": {},
  "links": {
    "self": "/api/v1/bills/94-2025-SF1832"
  }
}
```

### Links

Use lightweight hypermedia where it adds value:

- `self`
- `official_source`
- child-resource links like `actions`, `versions`, `votes`

This is a practical HATEOAS-lite approach, not a full hypermedia system.

### Error Format

Use RFC 7807 style problem details:

```json
{
  "type": "https://api.alethical.com/problems/validation-error",
  "title": "Invalid query parameter",
  "status": 400,
  "detail": "sort must be one of latest_action_at, file_number",
  "instance": "/api/v1/bills?sort=bad",
  "request_id": "req_123",
  "errors": [
    {
      "field": "sort",
      "message": "unsupported value"
    }
  ]
}
```

### Pagination

Use cursor pagination for growing collections:

- bills
- legislators
- tracked bills
- notifications
- chat sessions
- chat messages

#### V1 bill-list pagination

The first production implementation for bill-card lists uses offset pagination instead of opaque cursors. This is intentional for the current V1 surfaces because the affected lists are read-only, have stable sort orders, and need a minimal fix for users who could only see the first 20 bills.

Applies to:

- `GET /api/v1/bills`
- `GET /api/v1/legislators/{legislator_id}/bills`

Contract:

- clients send `limit` and `offset`
- the backend fetches `limit + 1` rows
- responses return only `limit` rows
- `page.has_more` is true when the extra row exists
- `page.offset` echoes the requested offset
- sorting must include a deterministic tie-breaker so moving between offsets does not repeat or skip rows under stable data

Cursor pagination remains the preferred long-term shape for high-churn collections, but clients must not implement local pagination over a single bounded response.

### Filtering and Sorting

Use query parameters only.

Examples:

- `?session=94-2025-regular`
- `?q=education`
- `?chamber=senate`
- `?sort=latest_action_at`
- `?order=desc`

### Caching

Public GET endpoints should support:

- `ETag`
- `Last-Modified`
- `Cache-Control`

Signed-in endpoints should default to non-shared caching.

## Auth Model

The backend should not own passwords in v1.

Recommended approach:

- Supabase Auth as the primary auth provider
- backend receives a Supabase bearer token
- backend verifies the token against Supabase Auth
- backend resolves token subject to `auth_identity`
- backend creates or loads `user_account`

Public endpoints:

- no auth required

Signed-in endpoints:

- auth required

Internal endpoints:

- stronger internal auth or allowlist required

## Public REST API

### Meta and Discovery

#### `GET /api/v1/meta`

Purpose:

- return API version, current session, supported jurisdiction, and useful links

#### `GET /api/v1/sessions`

Purpose:

- list supported legislative sessions

#### `GET /api/v1/sessions/current`

Purpose:

- resolve the current session in one call

### Bills

#### `GET /api/v1/bills`

Purpose:

- bill list, search, browse, and filtering

Filters:

- `session`
- `q`
- `chamber`
- `status`
- `topic`
- `is_omnibus`
- `updated_after`
- `sort`
- `order`
- `limit`
- `offset`
- `cursor` reserved for a later cursor-backed implementation

Optional includes:

- `include=chief_sponsors`
- `include=tracking`

Response fields:

- bill id
- bill number
- title
- chamber
- session
- current status
- latest action date
- chief sponsor preview
- tracked state when authenticated and requested
- stats

#### `GET /api/v1/bills/{bill_id}`

Purpose:

- main bill detail screen

Optional includes:

- `include=all_sponsors,actions,versions,topics,tracking,ai_summary`

Default shape:

- enough for initial bill detail render

Heavy secondary data:

- roll-call detail should stay on vote endpoints
- full text should stay on version-text endpoints

#### `GET /api/v1/bills/{bill_id}/actions`

Purpose:

- full bill timeline

#### `GET /api/v1/bills/{bill_id}/versions`

Purpose:

- list available bill versions

#### `GET /api/v1/bills/{bill_id}/versions/{version_code}`

Purpose:

- metadata for one version

#### `GET /api/v1/bills/{bill_id}/versions/{version_code}/text`

Purpose:

- cleaned section/article text for display

Query params:

- `format=structured|plain`

#### `GET /api/v1/bills/{bill_id}/votes`

Purpose:

- list vote events for a bill

#### `GET /api/v1/bills/{bill_id}/votes/{vote_event_id}`

Purpose:

- vote-event detail with roll-call records

### Legislators

#### `GET /api/v1/legislators`

Purpose:

- legislator directory and search

Filters:

- `session`
- `q`
- `chamber`
- `district`
- `party`
- `sort`
- `order`
- `limit`
- `offset`
- `cursor` reserved for a later cursor-backed implementation

Response fields:

- legislator id
- slug
- display name
- current chamber
- current district
- current party
- current contact preview
- stats

#### `GET /api/v1/legislators/{legislator_id}`

Purpose:

- main legislator profile shell

Optional includes:

- `include=current_service,committees,stats`

#### `GET /api/v1/legislators/{legislator_id}/bills`

Purpose:

- sponsored bills for legislator profile

Filters:

- `session`
- `role=chief|all`
- `sort`
- `order`
- `limit`
- `cursor`

#### `GET /api/v1/legislators/{legislator_id}/votes`

Purpose:

- vote history for legislator profile

Filters:

- `session`
- `bill_id`
- `vote_value`
- `limit`
- `cursor`

### Districts and Lookup

#### `GET /api/v1/districts`

Purpose:

- district lookup by code if needed by clients

#### `GET /api/v1/districts/{district_id}`

Purpose:

- district detail

#### `GET /api/v1/districts/{district_id}/legislators`

Purpose:

- current legislators for a known district

Filters:

- `session`

#### `POST /api/v1/representative-lookups`

Purpose:

- find my legislator by address, city, or pinned map location

Request body:

```json
{
  "address_text": "75 Rev Dr Martin Luther King Jr Blvd, Saint Paul, MN"
}
```

Pinned location request body:

```json
{
  "latitude": 44.9537,
  "longitude": -93.0900
}
```

Response:

- normalized place
- input mode used for lookup
- resolved districts
- current house and senate legislators

Rationale:

- this is a noun resource, not an RPC verb endpoint
- POST is appropriate because the lookup payload can be structured and may exceed simple query-string ergonomics
- map-pin lookup should bypass address geocoding and resolve districts directly from latitude and longitude

### Cross-Entity Search

#### `GET /api/v1/search`

Purpose:

- one search bar across bills and legislators

Filters:

- `q`
- `types=bills,legislators`
- `session`
- `limit`

Response:

- grouped results by resource type

## Authenticated User API

### Current User

#### `GET /api/v1/me`

Purpose:

- signed-in user profile, feature flags, and defaults

### Tracked Bills

#### `GET /api/v1/me/tracked-bills`

Purpose:

- tracked bills screen

Filters:

- `sort=updated_at|latest_action_at`
- `order`
- `limit`
- `cursor`

#### `PUT /api/v1/me/tracked-bills/{bill_id}`

Purpose:

- idempotently start tracking a bill

Request body:

```json
{
  "alerts_enabled": true,
  "note": "optional note"
}
```

#### `PATCH /api/v1/me/tracked-bills/{bill_id}`

Purpose:

- update note or alerts setting

#### `DELETE /api/v1/me/tracked-bills/{bill_id}`

Purpose:

- stop tracking a bill

### Saved Places

#### `GET /api/v1/me/saved-places`

#### `POST /api/v1/me/saved-places`

#### `PATCH /api/v1/me/saved-places/{place_id}`

#### `DELETE /api/v1/me/saved-places/{place_id}`

Purpose:

- persist home, work, or district contexts

### Notification Preferences

#### `GET /api/v1/me/notification-preferences`

#### `PUT /api/v1/me/notification-preferences/{channel}`

Purpose:

- manage email-first v1 notifications

#### `GET /api/v1/me/notification-events`

Purpose:

- user notification history

### Chat

#### `GET /api/v1/me/chat-sessions`

Purpose:

- chat session list

#### `POST /api/v1/me/chat-sessions`

Purpose:

- create a new chat session

Request body:

```json
{
  "title": "Jobs omnibus",
  "subject_bill_id": "94-2025-SF1832"
}
```

#### `GET /api/v1/me/chat-sessions/{chat_session_id}`

Purpose:

- session metadata and recent messages

#### `GET /api/v1/me/chat-sessions/{chat_session_id}/messages`

Purpose:

- paginated chat transcript

#### `POST /api/v1/me/chat-sessions/{chat_session_id}/messages`

Purpose:

- send a user message and receive a grounded assistant answer

Request body:

```json
{
  "content": "What does this bill do for workforce development?",
  "stream": false
}
```

Response:

- assistant message
- citations
- retrieval metadata summary

Streaming option:

- support SSE when `Accept: text/event-stream` is sent

## Internal Operations API

These endpoints should not be exposed to public clients.

### Ingestion and Data Review

#### `GET /internal/v1/ingestion-runs`

#### `GET /internal/v1/ingestion-runs/{run_id}`

#### `GET /internal/v1/parser-failures`

#### `GET /internal/v1/manual-overrides`

#### `POST /internal/v1/manual-overrides`

### Reprocessing

#### `POST /internal/v1/bills/{bill_id}/reingest`

#### `POST /internal/v1/legislators/{legislator_id}/reingest`

#### `POST /internal/v1/rag/bills/{bill_id}/rebuild`

Purpose:

- support the early v1 admin and data-ops workflow

## Screen-to-Endpoint Validation

## Public User Stories

### 1. Search and Browse Bills

Status: pass

Frontend access path:

- `GET /api/v1/bills`
- optional `GET /api/v1/search`

Economic access:

- one request for the main bill list screen

### 2. Open a Bill and Understand It

Status: pass

Frontend access path:

- `GET /api/v1/bills/{bill_id}`
- optional `GET /api/v1/bills/{bill_id}/votes/{vote_event_id}`
- optional `GET /api/v1/bills/{bill_id}/versions/{version_code}/text`

Economic access:

- one request for initial detail render
- one additional request only when the user opens heavy secondary surfaces

### 3. Search Legislators and Inspect Profiles

Status: pass

Frontend access path:

- `GET /api/v1/legislators`
- `GET /api/v1/legislators/{legislator_id}`
- `GET /api/v1/legislators/{legislator_id}/bills`
- `GET /api/v1/legislators/{legislator_id}/votes`

Economic access:

- one request for directory
- one request for profile shell
- lazy secondary tab loads

### 4. Find My Legislator

Status: pass

Frontend access path:

- `POST /api/v1/representative-lookups`
- request may include `address_text` or `latitude` plus `longitude`

Economic access:

- one request

### 5. Cross-Entity Search

Status: pass

Frontend access path:

- `GET /api/v1/search`

Economic access:

- one request

## Signed-In User Stories

### 6. Track Bills

Status: pass

Frontend access path:

- `PUT /api/v1/me/tracked-bills/{bill_id}`
- `GET /api/v1/me/tracked-bills`
- `PATCH /api/v1/me/tracked-bills/{bill_id}`
- `DELETE /api/v1/me/tracked-bills/{bill_id}`

Economic access:

- one request to mutate
- one request to load the tracked bills screen

### 7. Receive Basic Updates

Status: pass

Frontend access path:

- `GET /api/v1/me/notification-preferences`
- `PUT /api/v1/me/notification-preferences/{channel}`
- `GET /api/v1/me/notification-events`

### 8. Ask Grounded Questions With Citations

Status: pass

Frontend access path:

- `POST /api/v1/me/chat-sessions`
- `POST /api/v1/me/chat-sessions/{chat_session_id}/messages`
- `GET /api/v1/me/chat-sessions/{chat_session_id}`
- `GET /api/v1/me/chat-sessions/{chat_session_id}/messages`

Economic access:

- one request to create or resume session
- one request per user turn

## Internal User Stories

### 9. Review Parser Failures and Overrides

Status: pass

Frontend access path:

- `GET /internal/v1/parser-failures`
- `GET /internal/v1/manual-overrides`
- `POST /internal/v1/manual-overrides`

### 10. Reprocess Bad Records

Status: pass

Frontend access path:

- `POST /internal/v1/bills/{bill_id}/reingest`
- `POST /internal/v1/legislators/{legislator_id}/reingest`
- `POST /internal/v1/rag/bills/{bill_id}/rebuild`

## API Layering Recommendation

Use a modular monolith, not microservices.

Suggested package shape:

```text
alethical/api/
  main.py
  deps/
  routers/
    meta.py
    bills.py
    legislators.py
    districts.py
    search.py
    me.py
    tracking.py
    notifications.py
    chat.py
    internal_ingestion.py
  schemas/
  services/
  repositories/
  auth/
```

Rules:

- routers should not contain business logic
- services should assemble resource representations
- repositories should own query construction
- Pydantic schemas should be API contracts, not raw ORM models

## Recommended Next Build Step

Implement the FastAPI skeleton with:

1. app factory
2. auth dependency stub
3. health and meta routes
4. bills and legislators read routes
5. tracked bills and chat routes
6. OpenAPI generation and contract tests

That is enough to turn this design into an executable API surface without prematurely building every internal endpoint.
