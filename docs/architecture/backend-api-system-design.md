# Alethical Backend API System Design

<!-- describes: alethical/api/routers/*.py, alethical/api/problems.py, alethical/api/serializers.py, alethical/api/services/representative_lookup.py, alethical/api/auth.py, alethical/api/services/auth.py -->

Status: **design reference, not an inventory of what exists.** Much of this document is the
target shape rather than the shipped API, and the two used to be indistinguishable here: it
previously claimed the endpoint list was "spot-verified", while documenting nine routes that
were never built and listing filter parameters the handlers silently ignore. A full audit
against `alethical/api/routers/` on Aug 3 2026 corrected thirteen such claims and marked every
unbuilt endpoint **NOT BUILT** inline.

**So read it this way:** a route or parameter with no NOT BUILT marker was verified present on
Aug 3 2026. Anything marked NOT BUILT is design intent with no code behind it — do not build a
client against it, and do not treat a "Status: pass" user story below as evidence it works.
When you add or change a route, update the entry here in the same PR (`.claude/rules/workflow.md`
rule 6); when you find drift, fix it rather than adding another hedge.

## Goal

Design a REST API for Alethical v1 that:

- serves the web client from one backend, and stays client-agnostic so native iOS and Android ([#91](https://github.com/alethical-org/alethical/issues/91)) can consume the same API when built
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

Every user story below must have a direct API path.

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
- `legislator_id`: the readable `slug` (`melissa-hortman`) is the canonical public identifier and what frontend routes use (`/legislators/{slug}`, SEO-friendly like the bill key); the `{legislator_id}` path segment on every legislator endpoint resolves **either** the slug **or** the stable opaque UUID, so links shared before the slug switch keep working
- `district_id`: stable opaque UUID, plus `code` like `64B`
- `chat_session_id`: stable opaque UUID

Why this split:

- bills already have a clean canonical public key
- legislators do not yet have a similarly strong human-readable immutable key, so opaque ID is safer

## Representation Rules

### Media Type

- JSON only

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

Use RFC 7807 style problem details. As shipped (verified against production, Jul 29 2026 — `GET /api/v1/bills?sort=bad`):

```json
{
  "type": "https://api.alethical.com/problems/validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "Request validation failed",
  "instance": "/api/v1/bills",
  "errors": [
    {
      "field": "query.sort",
      "message": "Input should be 'relevance', 'latest_action', 'progress' or 'introduced'"
    }
  ]
}
```

Note the shipped shape differs from this section's original sketch: a bad query parameter is **422** (FastAPI validation), not 400; `title` is the generic `"Validation Error"` with the specifics in `errors[]`; `field` is namespaced (`query.sort`); and there is no `request_id` member.

### Pagination

Use cursor pagination for growing collections:

- bills
- legislators
- tracked bills
- notifications
- chat sessions
- chat messages

#### Bill-list pagination — offset, deliberately

The first production implementation for bill-card lists uses offset pagination instead of opaque cursors. This is intentional for the current surfaces because the affected lists are read-only, have stable sort orders, and need a minimal fix for users who could only see the first 20 bills.

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
- `?sort=relevance` — also `latest_action` (the no-query default), `progress`, `introduced`. Each ordering is self-contained (direction included), so there is **no** separate `order` param; `relevance` is best-keyword-match-first and is what a free-text `q` resolves to when `sort` is omitted. See `docs/product-onboarding/bill-search-screen-spec.md` (Filters — Sort order) for why relevance is scoped to its own value.

### Caching

Public GET endpoints should support:

- `ETag` — **NOT BUILT.** Nothing in `alethical/api/` sets this header, and a live response
  carries none. A `last-modified` does come back in production, but Cloudflare's edge cache
  adds it, not the app.
- `Last-Modified` — see above: edge-supplied, not application-supplied.
- `Cache-Control` — real, set by the app.

Signed-in endpoints should default to non-shared caching.

## Auth Model

The backend does not own passwords.

Recommended approach:

- Supabase Auth as the primary auth provider
- backend receives a Supabase bearer token
- backend verifies the token against Supabase Auth
- backend resolves token subject to `auth_identity`
- backend creates or loads `user_account`

### How a token becomes an account

Verified present Aug 5 2026 (`alethical/api/auth.py`, `alethical/api/services/auth.py`),
and pinned by `alethical/tests/test_auth_multi_user_isolation.py`,
`alethical/tests/test_auth_token_verification.py` and
`alethical/tests/test_auth_read_path.py`.

`SupabaseAuthService.authenticate` maps the token's claims onto an
`AuthenticatedPrincipal` (`provider`, `provider_subject`, `email`, `email_verified`).
`get_optional_current_user` then takes one of two paths, and the split matters:

- **Resolution** — an `auth_identity` row already exists for
  `(provider, provider_subject)`. Load its `user_account` and return it. This is
  every authenticated read, and it must stay side-effect-free: it commits only
  when `_reconcile_identity_fields` finds a field genuinely different, because
  assigning an equal value still marks the row dirty and issues an UPDATE. Bumping
  `last_used_at` / `last_signed_in_at` per request was the read-path write removed
  by [#990](https://github.com/alethical-org/alethical/pull/990)
  ([#108](https://github.com/alethical-org/alethical/issues/108)); both columns are
  now written at provisioning only.
- **Provisioning** — first sign-in for that identity. Look for an existing
  `user_account` whose `primary_email` equals the principal's **confirmed** email;
  create one if there is none; then create the `auth_identity` and commit once.

**The email lookup is deliberate.** One person who signs in with Google today and a
second method tomorrow gets two `auth_identity` rows on the *same* `user_account`,
rather than silently starting over with an empty one — which is the whole reason
`user_account` and `auth_identity` are separate tables. `user_account.primary_email`
is `unique=True`, so at most one account can hold a given address and the lookup
cannot pick the wrong one of two.

**Only a confirmed address may take part in it**
([#1039](https://github.com/alethical-org/alethical/issues/1039), Aug 5 2026). The
address is the *only* thing the join trusts, so `_confirmed_email` gates both halves of
it, and the second half is the one easy to miss:

- **Matching.** The lookup runs only when `principal.email_verified` is true. An
  identity whose address the provider never confirmed cannot present it to reach an
  existing account and its tracked bills, chat sessions and saved places.
- **Claiming.** `primary_email` is never *written* from an unconfirmed address either
  — not at provisioning, not by `_reconcile_identity_fields`. Guarding only the match
  leaves the same hole facing backwards: an unconfirmed identity arriving first would
  reserve the address, and the person who genuinely owns it would join *their* account
  on arrival. So an account provisioned from an unconfirmed sign-in has
  `primary_email = NULL`; the claimed address is still recorded on `auth_identity.email`,
  which is not unique and grants nothing.

**An unconfirmed sign-in gets its own new account, not a refusal.** A refusal punishes a
real person for provider state they can neither see nor fix and leaves them nowhere to
go; a separate account is recoverable, because two accounts can be merged later and a
dead end cannot be undone. There is no merge tooling today — an account-merge flow is the
follow-on this decision implies, not something it delivers.

**Confirming later does not merge, and must not 500.** Once an account exists with
`primary_email = NULL`, `_reconcile_identity_fields` will try to claim the address the
moment the provider starts reporting it confirmed. The column is unique, so an unguarded
claim would raise on commit and turn every authenticated read for that person into a 500.
It therefore skips the claim when another account already holds the address; the person
stays in their own account and the address stays unclaimed.

**A deactivated account is refused on both paths**
([#1043](https://github.com/alethical-org/alethical/issues/1043), Aug 6 2026).
`user_account.is_active` shipped in the first migration and nothing read it, so it was a
switch that looked like a lock and was not one. `_refuse_if_deactivated` now runs on
every request that resolves a user, returning `403` with the problem type
`account-deactivated`. Three details are load-bearing and each has its own test:

- **On the resolution path it runs *before* `_reconcile_identity_fields`.** Move it after
  and a locked account still writes a row on its way to being refused — refused in the
  response, active in the database. Every other deactivation test stays green through
  that move, which is why the ordering is pinned separately.
- **On the provisioning path it runs on the *joined* account, before the `auth_identity`
  row is written.** A locked account still owns its confirmed address, and joining on
  that address is exactly how a second sign-in method reaches an existing account, so
  without this "sign in with something else" walks straight back in.
- **On the optional-auth endpoints it resolves to anonymous rather than erroring, and
  the difference is carried on the request instead.** Those three call sites
  (`public.py` bill list and bill detail, `ask.py`) take a token only to personalise an
  otherwise public page. Erroring there would lock someone out of the *public
  legislative record* because their account is locked, which is the opposite of what
  this product is for (`docs/philosophy.md`), and "they can sign out and read it" is a
  workaround for a break we chose to create.

  Falling back to anonymous alone would recreate the exact silent failure #1043 exists
  to remove: a locked account and a reader with no token both arrive as `None`, so the
  app shows "please sign in", the reader signs in, and it works. So
  `_mark_deactivated` sets `request.state.account_deactivated`, and `get_current_user`
  reads it — **signed out is a 401 that signing in fixes, locked is a 403 that signing
  in never will.** `GET /me` is required-auth, so that is where the frontend learns to
  clear the session and say what happened.

There is deliberately **no interface for flipping it**: the decision was to make the
switch behave as labelled, not to build a lockout console. Who may flip it, and where
that is recorded, belong to
[#1040](https://github.com/alethical-org/alethical/issues/1040) (account deletion).

**`email_verified` means a confirmed email and nothing else.** It used to be set from
`email_confirmed_at` **or** `phone_confirmed_at`, so a phone-verified account with an
unconfirmed address arrived claiming the address was proven — and that flag is precisely
what now decides whether an identity may join an existing account. It reads
`email_confirmed_at` alone.

**Still outstanding, and it bounds the guard rather than merely sizing it.** Whether an
unconfirmed account can obtain a token at all is a Supabase project setting this
repository neither controls nor records. Two of the three possible answers make the guard
insurance that never fires. The third defeats it: with Supabase's **Confirm email** turned
*off*, every new sign-up is marked confirmed without anything being checked, so
`email_confirmed_at` arrives set on an address nobody proved and `email_verified` cannot
tell the difference. **A guard on a claim is only as good as whoever issues the claim.**
The setting has not been read — steps and how to read the result are in
`docs/operations/deployment.md` § "Can an unconfirmed account sign in?".

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

Session summaries include `session_number`, `year_start`, and `year_end` alongside the
stored session name. Clients build display labels from those fields so regular bienniums
use one site-wide range format without rewriting the stored record.

### Bills

#### `GET /api/v1/bills`

Purpose:

- bill list, search, browse, and filtering

Filters (the handler's real signature; `bills()` in `alethical/api/routers/public.py`):

- `session`
- `q`
- `chamber`
- `status`
- `policy_area` — repeatable, several are OR'd. This section long called it `topic`, which the
  handler silently ignores, so a client sending `?topic=Education` gets the unfiltered list back
  and no error.
- `omnibus` — likewise not `is_omnibus`, which is silently ignored.
- `sort`
- `limit`
- `offset`
- `updated_after` — **NOT BUILT**
- `order` — **NOT BUILT**, and this entry contradicted the Filtering and Sorting section above,
  which correctly says each `sort` value carries its own direction so no `order` param exists.
- `cursor` — **NOT BUILT**; reserved for a later cursor-backed implementation.

Optional includes:

- `include=tracking`
- `include=chief_sponsors` — accepted, but **not optional in effect**: `bill_list_item()`
  (`alethical/api/serializers.py`) always populates `chief_sponsors`, and the route never checks
  the include set for it. Every list response carries it whether you ask or not.

Response fields (`BillListItem`, `alethical/api/schemas.py`):

- bill id
- bill number
- title
- current status
- latest action date
- chief sponsor preview
- effective date, for enacted bills with a groundable value
- tracked state when authenticated and requested
- stats
- also present and previously undocumented here: `status_key`, `official_url`, `is_omnibus`,
  `co_author_count`, `companion`, `ai_analysis`, `actions`
- ~~chamber~~ and ~~session~~ — **NOT RETURNED** on a list item, despite being listed here for
  months. Chamber is recoverable from the bill number's HF/SF prefix; session comes from the
  `session` you filtered by. The bill *detail* response is the one that carries them.

#### `GET /api/v1/bills/{bill_id}`

Purpose:

- main bill detail screen

Optional includes — the branches `bill_detail()` actually implements are
`all_sponsors`, `actions`, `versions`, `progress`, `tracking`:

- `include=all_sponsors,actions,versions,progress,tracking`
- `include=topics` — **NOT BUILT**; no branch reads it, so it changes nothing.
- `include=ai_summary` — **NOT BUILT** as an include, because it is unconditional: the AI
  analysis payload ships on the response whether or not you ask.
- `include=progress` is real and was undocumented here until the Aug 3 2026 audit.

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

#### `GET /api/v1/bills/{bill_id}/votes/{vote_event_id}` — **NOT BUILT**

Purpose:

- vote-event detail with roll-call records

Never needed: `GET /bills/{bill_id}/votes` already embeds each event's full per-voter `records`
array, so a detail route would only re-slice a response the client already has.

### Legislators

#### `GET /api/v1/legislators`

Purpose:

- legislator directory and search

Filters (`legislators()` takes exactly these five):

- `session`
- `q`
- `chamber`
- `limit`
- `offset`
- `district` — **NOT BUILT**. Silently ignored, so `?district=64B` returns the whole directory.
- `party` — **NOT BUILT**, same silent pass-through.
- `sort` — **NOT BUILT**
- `order` — **NOT BUILT**
- `cursor` — **NOT BUILT**; reserved for a later cursor-backed implementation.

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
- `limit`
- `offset` — real, and undocumented here until the Aug 3 2026 audit.
- `sort` — **NOT BUILT**
- `order` — **NOT BUILT**
- `cursor` — **NOT BUILT** (the route paginates by `offset`)

#### `GET /api/v1/legislators/{legislator_id}/votes`

Purpose:

- vote history for legislator profile

Each row includes the member's `vote_value` and `vote_event_id`, plus the joined
record facts a profile can render without guessing: `bill_id`, `bill_code`,
`occurred_at`, and the vote event's `chamber`.

Filters (`legislator_votes()` takes two):

- `session`
- `limit`
- `bill_id` — **NOT BUILT**. Silently ignored, so the filtered call returns the same rows as
  the unfiltered one.
- `vote_value` — **NOT BUILT**, same silent pass-through.
- `cursor` — **NOT BUILT**

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

- find my legislator by full street address or pinned map location

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

### Grounded Ask

Both routes are public and real, and both were missing from this document until the Aug 3 2026
audit — even though `alethical/api/routers/ask.py` is named in the `describes:` comment at the
top. That made the product's flagship surface the largest gap here.

#### `POST /api/v1/ask`

Purpose:

- the one-shot grounded answer: classify the question, retrieve, synthesize, and return an answer
  that carries citations or refuses

Contract, invariants, and answer-page states live in
`docs/product-onboarding/grounded-ask-spec.md`; the cite-or-refuse rule it must satisfy is
`.claude/rules/grounded-answers.md` rule 1.

#### `POST /api/v1/ask/classify`

Purpose:

- routing only — which intent a question resolves to, without producing an answer

### Policy Areas

#### `GET /api/v1/policy-areas`

Purpose:

- the issue list with a live bill count each, backing the bill-search issue pills
  (`docs/product-onboarding/bill-search-screen-spec.md`, Filters — Policy area)

Real, and undocumented here until the Aug 3 2026 audit.

## Authenticated User API

### Current User

#### `GET /api/v1/me`

Purpose:

- signed-in user profile, feature flags, and defaults

### Tracked Bills

#### `GET /api/v1/me/tracked-bills`

Purpose:

- tracked bills screen

The shipped endpoint returns **every** bill the user tracks, in one page, newest-tracked first (`tracked_bills_stmt` in `alethical/db/models.py` orders by `tracked_bill.created_at DESC, id DESC`). Two things this deliberately does not do, both since [#1007](https://github.com/alethical-org/alethical/issues/1007): it does not order by the bill's own latest action (useful, but it reshuffles as the Legislature acts), and it does not gate on `Bill.has_current_summary` the way the browse and search statements do — a bill the reader saved appears whether or not we have written its AI summary yet.

"What changed since you last looked" is no longer a gap here — it shipped as [#1009](https://github.com/alethical-org/alethical/issues/1009), but as a client-side grouping rather than a server-side order. The response is unchanged; the frontend compares each bill's own actions against the reader's previous visit (`changesSince` in `apps/frontend/src/lib/billDetail.ts`) and groups the page itself. The one piece the server owns is the comparison point, below.

Filters (**planned, none built yet** — the shipped endpoint takes no query parameters):

- `sort` — would follow the `/bills` values (`relevance` / `latest_action` / `progress` / `introduced`), not the `updated_at|latest_action_at` sketched here
- `limit`
- `cursor`

#### `POST /api/v1/me/tracked-bills/viewed`

Purpose:

- give the tracked-bills screen its comparison point for "what moved since you last looked"

Takes no body. Returns the user's **previous** visit and advances the mark to now in one call:

```json
{ "previous_viewed_at": "2026-03-12T14:00:00+00:00", "viewed_at": "2026-08-05T17:33:31+00:00" }
```

`previous_viewed_at` is `null` for a user with no recorded visit — their first look, which the page states as such rather than reporting every bill as having just moved.

Read and advance are deliberately one call. Split into a GET and a PUT they could interleave — two tabs opening at once, or a retry — and hand the second caller a mark the first had just written, which reads on screen as "nothing has moved". The client asks once per browser session and holds the answer in `sessionStorage`, so reloading the page does not erase what changed.

Backed by `user_account.tracked_bills_last_viewed_at` (alembic `0025`), a column of its own. `last_signed_in_at` cannot serve, and has been unusable for two opposite reasons in turn: it used to be rewritten by `alethical/api/auth.py` on every authenticated request, so it always read "just now" and nothing could ever be newer than it; since [#990](https://github.com/alethical-org/alethical/pull/990) ([#108](https://github.com/alethical-org/alethical/issues/108)) the read path does not write at all, so it is set only when an identity is first provisioned and barely moves. Either way it answers "when did you sign in", never "when did you last look at your tracked list".

##### Before you add a SECOND surface that shows "what moved"

Written down in advance because the signed-in homepage is designed to carry a "Session watch" card using the same change blocks, and because the first mistake here is invisible in review. Decided Aug 2026 between the sessions that built #1009 and the homepage design; nothing below is built yet.

**Only the tracked list may advance the mark.** A surface showing a *subset* must read without advancing. The homepage card shows up to two bills; if a glance at it moved the mark for the whole set, a reader with six moved bills would see two and the other four would never be reported — information loss dressed as a feature.

**The trap: a missing comparison point currently reads as "first visit", which renders as "nothing moved".** `readHeldLastVisit` (`apps/frontend/src/lib/trackedBillsLastVisit.ts`) is pure and never triggers the POST, so it is safe to call — but on a cold load with nothing held it returns `null`, `lastVisitDate(null)` returns `null`, and `groupTrackedBillsByChange` reads a null comparison point as a first visit and puts **every bill in the unchanged group**. So a card doing the obvious `lastVisitDate(readHeldLastVisit(userId))` would state that nothing had moved on a session where six bills had. Every individual line of that is correct, which is why it would pass review. **A second surface needs a third condition — "we have not asked yet" — that renders neither a change nor an absence.**

**The read-only path is built, and it is two things** (#1034 part 1, [#1035](https://github.com/alethical-org/alethical/pull/1035) — this paragraph used to describe it as unbuilt). `GET /api/v1/me/tracked-bills/last-viewed` returns the mark without touching it; **and** the client holds two facts apart. One held value used to mean both "here is the comparison point" and "this session has already advanced the mark", so a homepage that loaded first and held what it read would make the tracked list skip its POST, and the mark would never advance again for that browser session. They are now separate: the comparison point (shared, written by whichever surface asks first) and an advanced-this-session flag (written only by the tracked list), both in `apps/frontend/src/lib/trackedBillsLastVisit.ts`.

**The two hooks keep SEPARATE React Query keys, and that is load-bearing.** `useTrackedBillsLastVisit` advances; `useLastVisitWithoutAdvancing` does not. Given one shared key the same bug returns a layer up: both cache with `staleTime: Infinity`, so the homepage's cached read satisfies the tracked page and its write never runs. The state the two surfaces share is the module-level hold, never the query cache.

**The window is deliberately allowed to grow without bound.** Someone who only ever glances at the homepage never advances the mark, so their "since your last visit" window keeps widening and eventually reports months of activity. That is honest — they genuinely have not looked at the list — and it is the choice that can never lose a change. The alternative, a homepage glance advancing the mark for the bills it showed, needs a mark per tracked bill rather than one per user: much larger, and it can drop a change. Recorded as a decision, not a default.

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

- store a user's per-channel notification preference. Storing one is all that happens: no
  channel delivers anything yet ([#36](https://github.com/alethical-org/alethical/issues/36)),
  so a preference set here changes nothing a user receives.

#### `GET /api/v1/me/notification-events` — **NOT BUILT**

Purpose:

- user notification history

The `NotificationEvent` model and a writer service (`alethical/api/services/notifications.py`)
both exist, but **no event has ever been recorded and none can be** — the writer has no
caller outside its own tests, and it compares a column (`Bill.current_status_code`) that is
NULL on all 10,517 production bills, so it returns empty on every call. Production holds 0
rows. Nothing can read them back over HTTP either. Story 7 below depends on this route and
was marked "Status: pass" regardless. Both faults and the fix are in
`docs/product-onboarding/tracked-bill-notifications-spec.md` §1.1-§1.2 and are being closed
by [#1048](https://github.com/alethical-org/alethical/issues/1048).

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

- support SSE when `Accept: text/event-stream` is sent — **NOT BUILT.** There is no
  `StreamingResponse` or `text/event-stream` handling anywhere in `alethical/api/`.
  `ChatMessageCreateRequest.stream` exists in the schema but `create_chat_message()` never reads
  it, so the field is dead and a client setting it gets an ordinary buffered reply.

## Internal Operations API

These endpoints should not be exposed to public clients.

`alethical/api/routers/internal.py` registers exactly **three** routes. Six of the eight this
section originally listed were never built, and two that exist were never listed.

### Ingestion and Data Review

#### `GET /internal/v1/ingestion-runs`

#### `GET /internal/v1/oban/jobs`

Background-job rows. Real, and absent from this doc until the Aug 3 2026 audit.

#### `GET /internal/v1/oban`

The HTML job dashboard (`response_class=HTMLResponse`). Real, and likewise undocumented until
that audit.

#### `GET /internal/v1/ingestion-runs/{run_id}` — **NOT BUILT**

#### `GET /internal/v1/parser-failures` — **NOT BUILT**

#### `GET /internal/v1/manual-overrides` — **NOT BUILT**

#### `POST /internal/v1/manual-overrides` — **NOT BUILT**

### Reprocessing

Nothing in this subsection exists. Reprocessing is done by running the pipeline directly
(`docs/product-onboarding/data-ingestion-onboarding.md`), not over HTTP.

#### `POST /internal/v1/bills/{bill_id}/reingest` — **NOT BUILT**

#### `POST /internal/v1/legislators/{legislator_id}/reingest` — **NOT BUILT**

#### `POST /internal/v1/rag/bills/{bill_id}/rebuild` — **NOT BUILT**

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
- optional `GET /api/v1/bills/{bill_id}/votes` — the whole roll call, per-voter records included
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
- one bounded request for the newest profile vote when the profile opens

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
- `POST /api/v1/me/tracked-bills/viewed`
- `PATCH /api/v1/me/tracked-bills/{bill_id}`
- `DELETE /api/v1/me/tracked-bills/{bill_id}`

Economic access:

- one request to mutate
- one request to load the tracked bills screen, plus one `viewed` call on the FIRST load of a browser session (the client holds its answer in `sessionStorage` and does not ask again)

### 7. Receive Basic Updates

Status: **partial** — a user can set preferences but cannot read a single delivered update.

Frontend access path:

- `GET /api/v1/me/notification-preferences`
- `PUT /api/v1/me/notification-preferences/{channel}`
- `GET /api/v1/me/notification-events` — **NOT BUILT**, so the history half of this story has no
  endpoint behind it. It was marked "pass" anyway.

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

Status: **not built** — every endpoint below is missing, so nothing validates this story. It read
"pass" until the Aug 3 2026 audit. Parser failures are reviewed by reading ingestion logs and the
`GET /internal/v1/oban` job dashboard.

Frontend access path:

- `GET /internal/v1/parser-failures` — **NOT BUILT**
- `GET /internal/v1/manual-overrides` — **NOT BUILT**
- `POST /internal/v1/manual-overrides` — **NOT BUILT**

### 10. Reprocess Bad Records

Status: **not built over HTTP** — it read "pass" until the Aug 3 2026 audit. Reprocessing is real
but happens by running the pipeline directly
(`docs/product-onboarding/data-ingestion-onboarding.md`), not through these routes.

Frontend access path:

- `POST /internal/v1/bills/{bill_id}/reingest` — **NOT BUILT**
- `POST /internal/v1/legislators/{legislator_id}/reingest` — **NOT BUILT**
- `POST /internal/v1/rag/bills/{bill_id}/rebuild` — **NOT BUILT**

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
