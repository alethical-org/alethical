# Alethical Backend API System Design

<!-- describes: alethical/api/routers/*.py, alethical/api/problems.py, alethical/api/serializers.py, alethical/api/services/representative_lookup.py, alethical/api/services/contact.py, alethical/api/services/independent_spending.py, alethical/api/services/committee_finance.py, alethical/api/services/campaign_finance_payments.py, alethical/api/services/campaign_finance_register.py, alethical/api/auth.py, alethical/api/services/auth.py -->

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

`SupabaseAuthService.authenticate` maps the token's signed claims onto an
`AuthenticatedPrincipal` (`provider`, `provider_subject`, `email`, `email_verified`).
The token proves the subject and reported address, but it does not carry Supabase's trusted
`email_confirmed_at` value. When Alethical needs to establish confirmation, it asks Supabase
for the user record with the same bearer token and verifies that record's subject still matches
the token. A person-editable profile field never counts as confirmation.
`get_optional_current_user` then takes one of two paths, and the split matters:

- **Resolution** — an `auth_identity` row already exists for
  `(provider, provider_subject)`. Load its `user_account` and return it. This is
  every authenticated read, and it must stay side-effect-free: it commits only
  when `_reconcile_identity_fields` finds a field genuinely different, because
  assigning an equal value still marks the row dirty and issues an UPDATE. The 2
  identity-link dates now say exactly what the code records:
  `auth_identity.linked_at` is set when that identity row is created, and
  `user_account.last_identity_linked_at` is set when the account gains its latest
  identity. Neither is a sign-in activity record. Building real login-event tracking
  belongs to [issue #991](https://github.com/alethical-org/alethical/issues/991) only
  if a product feature later needs it. The one repair exception is an identity whose
  `email_verified_at` is still empty: Alethical asks Supabase again and fills the confirmed
  email once. Later reads stay local. This lets the 2 accounts affected before
  [#1466](https://github.com/alethical-org/alethical/issues/1466) repair themselves on their
  next authenticated request, without a bulk production rewrite.
- **Provisioning** — first sign-in for that identity. Look for an existing
  `user_account` whose `primary_email` equals the principal's **confirmed** email;
  create one if there is none; then create the `auth_identity` and commit once.

**The email lookup is deliberate.** One person who signs in with Google today and a
second method tomorrow gets two `auth_identity` rows on the _same_ `user_account`,
rather than silently starting over with an empty one — which is the whole reason
`user_account` and `auth_identity` are separate tables. `user_account.primary_email`
is `unique=True`, so at most one account can hold a given address and the lookup
cannot pick the wrong one of two.

**Only a confirmed address may take part in it**
([#1039](https://github.com/alethical-org/alethical/issues/1039), Aug 5 2026). The
address is the _only_ thing the join trusts, so `_confirmed_email` gates both halves of
it, and the second half is the one easy to miss:

- **Matching.** The lookup runs only when `principal.email_verified` is true. An
  identity whose address the provider never confirmed cannot present it to reach an
  existing account and its tracked bills, chat sessions and saved places.
- **Claiming.** `primary_email` is never _written_ from an unconfirmed address either
  — not at provisioning, not by `_reconcile_identity_fields`. Guarding only the match
  leaves the same hole facing backwards: an unconfirmed identity arriving first would
  reserve the address, and the person who genuinely owns it would join _their_ account
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

- **On the resolution path it runs _before_ `_reconcile_identity_fields`.** Move it after
  and a locked account still writes a row on its way to being refused — refused in the
  response, active in the database. Every other deactivation test stays green through
  that move, which is why the ordering is pinned separately.
- **On the provisioning path it runs on the _joined_ account, before the `auth_identity`
  row is written.** A locked account still owns its confirmed address, and joining on
  that address is exactly how a second sign-in method reaches an existing account, so
  without this "sign in with something else" walks straight back in.
- **On the optional-auth endpoints it resolves to anonymous rather than erroring, and
  the difference is carried on the request instead.** Those three call sites
  (`public.py` bill list and bill detail, `ask.py`) take a token only to personalise an
  otherwise public page. Erroring there would lock someone out of the _public
  legislative record_ because their account is locked, which is the opposite of what
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
`email_confirmed_at` only from Supabase's trusted user record. Supabase does not put that
field in the access token, and any lookalike in `user_metadata` is ignored because the signed-in
person can edit it ([#1466](https://github.com/alethical-org/alethical/issues/1466)).

**Still outstanding, and it bounds the guard rather than merely sizing it.** Whether an
unconfirmed account can obtain a token at all is a Supabase project setting this
repository neither controls nor records. Two of the three possible answers make the guard
insurance that never fires. The third defeats it: with Supabase's **Confirm email** turned
_off_, every new sign-up is marked confirmed without anything being checked, so
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

#### `GET /api/v1/sitemap`

Purpose:

- return every bill id and legislator slug that has a public page, each with the date its
  record really last changed, plus the exact Bills and Legislators directory totals, in a single
  response

This exists for `api/sitemap.ts`, the Vercel function that builds `sitemap.xml`
([#1325](https://github.com/alethical-org/alethical/issues/1325)). Without it that function
would page `/bills` 100 rows at a time — about 105 round trips for the ~10,517 bills alone,
every time the sitemap cache expires.

Deliberately unlike every other collection endpoint here:

- **Not paginated.** A sitemap that lists a page of bills is not a sitemap. The response is
  the whole corpus, about 1 MB before compression, well inside the sitemap format's 50,000-URL
  and 50 MB limits.
- **Not serialized through the bill serializer.** Two column-only address selects plus one bill
  directory count
  (`select(Bill.bill_key, Bill.latest_action_at, Bill.updated_at)` and the legislator
  directory statement narrowed to `slug` + `updated_at`), never whole ORM rows, which is what
  keeps it cheap at that size.

`lastmod` is a plain `YYYY-MM-DD` calendar date in UTC. For a bill it is `latest_action_at`
when set, otherwise `updated_at`; for a legislator, `updated_at`. It is omitted rather than
sent as null. The driver can return a `timestamptz` in the session's own timezone, so the
instant is normalized to UTC before its date is read — taking `.date()` directly off a
midnight-UTC timestamp reported the previous day.

The legislator list comes from the same `legislator_directory_stmt` the `/legislators` list
endpoint uses, so the two counts always agree.

### Bills

#### `GET /api/v1/bills`

Purpose:

- bill list, search, browse, and filtering

Filters (the handler's real signature; `bills()` in `alethical/api/routers/public.py`):

- `session`
- `scope` — `session` or the whole current Legislature
- `q`
- `topic` — older shared links keep working; it uses the same hidden Issue-label filter as
  `policy_area`
- `chamber`
- `status`
- `policy_area` — repeatable, several are OR'd. This section long called it `topic`, which the
  handler silently ignores, so a client sending `?topic=Education` gets the unfiltered list back
  and no error.
- `omnibus` — likewise not `is_omnibus`, which is silently ignored.
- `sort`
- `view` — `cards` for the full app cards, or `directory` for the small first-response link list
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

Response fields for `view=cards` (`BillListItem`, `alethical/api/schemas.py`):

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
- ~~chamber~~ — **NOT RETURNED** on a list item, despite being listed here for months. Chamber is
  recoverable from the bill number's HF/SF prefix. A whole-Legislature response includes `session`
  only for a special-session bill, so a repeated bill number stays distinguishable.

Response fields for `view=directory`:

- bill id
- current status and status key
- special-session identity when applicable
- plain-language short title

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

#### `GET /api/v1/legislators/{legislator_id}/independent-spending`

Shipped Aug 12 2026 ([#1332](https://github.com/alethical-org/alethical/issues/1332)), after
the Aug 3 audit — so the preamble's "verified present on Aug 3 2026" does not cover it.

Purpose:

- money spent to support or oppose this legislator, for one calendar year, by groups that are
  not their own campaign. It passes through no filing the campaign makes.

`year` is **required** (`ge=2015, le=2100`, no default), which makes this the only public GET
here with a required query param: a call without it is a 422, not a default year. Deliberate —
a defaulted year would silently answer about a different period than the caller meant.

**Read `state` before any figure. It carries the whole contract, and a client that reads
`supporting` without branching on it will print "$0 spent against Senator X" out of an absent
release:**

- `unavailable` — a gap of ours, never a figure about a person. Two ways to reach it: no usable
  published release, including the stale case in
  `docs/product-onboarding/data-ingestion-onboarding.md` section H where a release id held across
  2 publishes finds no rows; or we hold a row about one of this member's committees whose amount
  is blank, so every total is short by an unknown amount and all of them are withheld rather than
  one being published short
  ([#1454](https://github.com/alethical-org/alethical/issues/1454)). One committee is enough,
  because the figures are sums across all of them.
- `link_unconfirmed` — no human-confirmed link between this legislator and a campaign
  committee, so no payment can be attributed to them. **Today this is every legislator**:
  `legislator_campaign_committee` holds 0 rows in production (measured 12 Aug 2026), and it
  drains as [#1354](https://github.com/alethical-org/alethical/issues/1354)'s review lands.
- `reported` — real figures, and here a **0 is a measured 0**.

Every money field and every count is `null` in every state except `reported`.

**Three money figures, and between them they hold every row this endpoint reads.**
`supporting`, `opposing`, and `direction_not_recorded` for money whose "For" or "Against" cannot
be read — defined as the complement of the other two, so nothing can fall between them. All
41,130 rows of the live release record one or the other and none is blank, so the third figure is
0 for every committee today and **a surface renders it only when it is not**; reserving permanent
space for it would imply the source leaves the question open. It exists because the alternatives
are both worse: attributing an unreadable row to a side invents a claim about a person, and
dropping it (what the code did until
[#1454](https://github.com/alethical-org/alethical/issues/1454)) leaves the total short while the
answer still reads as complete.

`payment_count` counts the payments behind `supporting` and `opposing` **only**; a payment with
no readable direction is in `direction_not_recorded_payments`. A client prints both counts or
neither, because printing the first alone beside a non-zero third figure describes more money in
fewer payments than it names.

Returns `legislator_id`, `year`, `state`, `supporting`, `opposing`, `direction_not_recorded`,
`payment_count`, `direction_not_recorded_payments`, `source_url`, `fetched_at`, and
`committees[]`. Each committee carries `registration_number`, `committee_name`, `office`, its own
`supporting` / `opposing` / `direction_not_recorded`, `supporting_payments`,
`opposing_payments`, `direction_not_recorded_payments`, `first_payment_on`, `last_payment_on` —
because a member can hold several committees at once and §7 of
`docs/architecture/campaign-finance-system-design.md` (Display rules) requires a figure to say
which committee it belongs to rather than only which year.

**Not wired to any client yet.** No file under `apps/frontend/src` references it; the display
belongs to [#1329](https://github.com/alethical-org/alethical/issues/1329)'s campaign money tab.
So Story 3's access path below is still the complete list of what a profile screen calls.

### Campaign committees

#### `GET /api/v1/committees/{registration_number}/finance`

Shipped Aug 12 2026 ([#1442](https://github.com/alethical-org/alethical/issues/1442)), after
the Aug 3 audit — so the preamble's "verified present on Aug 3 2026" does not cover it.

Purpose:

- one campaign committee's money in and money out for one calendar year, keyed on Minnesota's
  registration number

**Why a committee and not a legislator.** A registration number identifies a committee on its
own, so nothing on this path waits on the human review in
[#1354](https://github.com/alethical-org/alethical/issues/1354) that decides which committee
belongs to which person. `legislator_campaign_committee` holds 0 rows in production (measured
12 Aug 2026); this endpoint is unaffected by that, which is what takes 4 roadmap stages off
that gate. A legislator's tab is this view with a confirmed name over it.

`registration_number` is text, never an integer. 283 of the numbers in the live release are
**negative** 11-digit values the Board assigns to local candidates it does not register, and
they are reachable only as the target of an independent expenditure.

`year` is **required** (`ge=2015, le=2100`, no default), for the same reason as the endpoint
above: a defaulted year silently answers about a different period than the caller meant.

**No figure here is summed by the API layer.** Every total comes from
`alethical/pipeline/campaign_finance_reader.py` ([#1330](https://github.com/alethical-org/alethical/issues/1330)),
which is the single home for the source behaviours that make a plausible query silently wrong.
This endpoint adds only what a page needs and a command-line reader does not: who a
registration number belongs to, a per-block state instead of an exception, what an empty answer
*means*, and independent spending aimed **at** the committee (a different question from the
reader's `independent_spending_by`, which is money the filer *spent*).

**Every figure is a sum of itemized rows, never a committee's total.** Minnesota names a donor
only once their giving passes $200 in aggregate within a calendar year, so the listed payments
always add up to less than the committee reported raising — around 4 dollars in 10 go unnamed
on a typical filing (`docs/architecture/campaign-finance-system-design.md` §9.5). Every field
carries `itemized` in its own name and there is deliberately no field a client could mistake
for a grand total.

**Rule 12's second number is served, and it is live.** `money_in.reported_total` is what the
filer itself reported taking in, from its own filed report rather than from the download, with
`reported_through` naming the date it runs to. Show both; never add them together and never
reconcile them into one figure. Measured against production on Aug 12 2026: HRCC's 2025 is
$1,488,168.08 itemized against $1,747,196.69 reported, and Senator Lindsey Port's is $5,100.00
against $10,155.00 — the gap in each is legitimate small-donor money, not an error.
`reported_total` is `null` when no filings snapshot is published, and also for a
special-election filer whose second report series the Board's route does not return, because
§9.5 is explicit that those read "Not reported" rather than being compared.

**Read each block's `state` before its numbers:**

- `reported` — we hold itemized rows and the figures are real.
- `not_reported` — we hold none for this committee-year, in a year the download does cover.
  **Never render as 0.** Senator Omar Fateh's Senate committee (18488) is the live case: its
  2025 filing itemizes $2,300.00 that the bulk download does not carry, so a zero here would
  print "$0 raised" over a real filing.
- `unavailable` — a gap of ours, never a figure about the committee. Three ways to reach it,
  and the second and third were found by an adversarial review rather than by the first build:
  our copy of that download is stale; the download holds nothing at all for the year asked for;
  or a row in the committee's own set has a blank amount, so the total cannot be computed and is
  withheld rather than understated. Judged per dataset, because the 3 downloads are pruned
  independently — one stale download must not blank the other two, which is why this endpoint
  carries a state per block where the reader raises.

  Staleness itself is the reader's judgement, and it is sharper than a row check: each snapshot
  records the row count it published, so "published 583,152 rows and holds none now" is a
  replaced set, while "published 0" is a file that was legitimately empty. A release naming a
  snapshot that is no longer `loaded` is refused outright.

The year check matters most on `independent_spending`, because an empty answer there is a
published finding rather than a gap. The downloads reach 2015 to the present and this route
accepts years to 2100, so without it a request for 2027 reports "no independent spending was
reported about this committee" about a year nobody has filed for — and a page defaulting to
"this year" reaches 2027 on 1 January. Asked only when a committee's own rows come back empty,
so a populated request costs nothing extra.

**The whole request reads one instant of the database** (`SET TRANSACTION ISOLATION LEVEL
REPEATABLE READ`, issued as the first statement of the request's transaction). Resolving the
release once fixes *which* release is read; this fixes *whether its rows are still there* from
the first statement to the last. Without it, 2 publishes landing mid-request take the named
release's rows away halfway through, and money out reads "not reported" after money in has
already reported a figure — section H's exact forbidden case, arrived at by a race rather than
a bad query. Verified through production's Supabase transaction pooler on Aug 12 2026: the
default is `read committed`, the pin makes it `repeatable read`, and the next transaction on
that pooled connection is back to `read committed`, so it cannot leak into another reader's
request. It is a `SET TRANSACTION` statement rather than an engine or session setting for
exactly that reason — the same hazard that makes a session-level advisory lock unsafe in
`alethical/pipeline/campaign_finance.py`.

`money_in.itemized_contribution_total` counts only rows the source types `Contribution`,
compared case-insensitively and trimmed. The other 3 receipt types are real money the filing
carries on separate schedules — most often a candidate's loan to their own campaign — and are
returned under `other_receipts` with the source's own label rather than dropped or folded in.
A receipt label we do not recognise lands there too, so a changed spelling mislabels money
instead of inflating the headline figure. `state` here describes the **contribution figure
alone**: 218 committee-years in the live release hold receipts of which not one is a
contribution, and deciding this from "does the committee appear" would print $0 across all of
them.

`money_out.itemized_payment_total` sums **every** row whatever its `Type`, with the source's
own labels in `by_type`. In 2025 candidate committees filed 6,781 rows typed
`Campaign Expenditure` and none typed `General Expenditure` while party units filed 7,524 the
other way round, so any single-label filter reports a whole kind of filer as having spent
nothing. `unpaid_total` is a separate column of the filing and not a subset of the total: the
download's `Amount` is the filing's *total* column and a row can be unpaid.

`independent_spending` is money others spent supporting or opposing this committee, served by
[#1332](https://github.com/alethical-org/alethical/issues/1332)'s query
(`alethical/api/services/independent_spending.py`) with the registration number handed in
directly. It is the one block where a committee with no rows reads as a measured **0**: nobody
filed an independent expenditure about them at all, which is a finding rather than a gap.
**Not "none over $200".** That qualifier was here and was false: the $200 in
`.claude/rules/grounded-answers.md` rule 12 is a *donor's* yearly aggregate on the
**contributions** file and is not a floor on this one — 17,194 of this file's 41,130 rows are
under $200, 13,393 under $100, minimum $0.00 (measured 13 Aug 2026). So a surface may not
describe these figures as only the large payments.
It carries the same 3 figures as the legislator endpoint above, including
`direction_not_recorded` and `direction_not_recorded_payments`, because both pages read one query
rather than two — a figure surfacing on only one of them would leave the other with the silent
omission [#1454](https://github.com/alethical-org/alethical/issues/1454) closed. That the empty
answer here is a published finding is exactly why the blank-amount refusal matters most on this
block: a figure short by an unknown amount would read as a measured result about a named
organisation.

**No date on a figure is one this layer invented.** The period a total covers is
`reported_through`, the filing's own answer. An earlier version derived a range from the span of
the rows it happened to hold; that approximated a fact the source states exactly, and a surface
would have shown the approximation as the period. Almost every Minnesota report runs from
1 January and a special-election filer's does not — filer 19223 reports from 11 July 2025 — so
no surface may hardcode 1 January either. `fetched_at` is the release's single freshness date
and is never the period a figure covers: that is per filing and always earlier.

The whole response resolves from **one** release id, returned as `release_id`. Section H is
explicit that re-resolving per query can pair one day's income with another day's spending.

- **404** — this registration number appears in no dataset of the current release. A statement
  about our records: the Board's registered-filer directory (§9.7) decides whether a committee
  exists and nothing here reads it yet, so no client may phrase it as "no such committee".
- **503** — no usable release at all. Also a fact about us.

**Not wired to any client yet.** No file under `apps/frontend/src` references it; the display
belongs to [#1329](https://github.com/alethical-org/alethical/issues/1329)'s campaign money tab.

#### `GET /api/v1/committees/{registration_number}/payments`

Shipped Aug 12 2026 ([#1331](https://github.com/alethical-org/alethical/issues/1331)), served by
`alethical/api/services/campaign_finance_payments.py`.

Purpose:

- the individual payments behind the figures above, one direction per request:
  `direction=received` (who paid this committee), `direction=made` (who it paid), or
  `direction=independent` (what others spent about it)

**This endpoint returns no total of any kind, and that is the design.** Every figure a surface
may print comes from the `finance` endpoint above, where
`alethical/pipeline/campaign_finance_reader.py` enforces the source's traps once. What this adds
is rows, each with its own amount, its own date, its own label in the source's own words, and a
`record_number` that traces it to one line of one dated download. So the traps cannot bite here:
no receipt type is filtered out and no expenditure label is either, because there is no figure
for a dropped row to fall out of.

`year` is **optional** here, unlike on `finance`, and its absence means every year the download
holds (2015 to 2026 today). The reason the two differ: a figure without a period is a wrong
number, while a payment carries its own date and reads honestly in a list spanning years — and a
donor's payments are not confined to one year, which is the whole point of the reverse direction
below.

`linkable_registration_numbers` lists the counterparty numbers on this page that this release
also holds as a filer, and **only those may be rendered as links.** Contribution rows carry a
number for a lobbyist as readily as for a party unit: all 912 distinct numbers arriving on rows
typed `Lobbyist` in the live release appear nowhere as a committee's registration number, so a
client linking every number it is handed would produce a wrong link rather than a dead one. The
check is against the rows we hold rather than against the contributor-type column, because that
column is not a reliable sorter either — 11 of 521 `Political Committee/Fund` numbers resolve
nowhere.

#### `GET /api/v1/campaign-finance/payments-under-name`

Shipped Aug 12 2026 ([#1331](https://github.com/alethical-org/alethical/issues/1331)). The
reverse direction: every payment recorded under exactly one printed name.

`name` is matched **character for character**. No trimming, no case folding, no initial matching,
no fuzzy anything, and the reason is measured rather than cautious. The live release holds
"Messinger, Alida" (121 payments to 39 committees), "Messinger, Alida R" (10 to 6) and
"Messinger, Alida Rockefelle" (4 to 1) as 3 separate strings, and it also holds
"Messinger, William Frye" beside "Messinger, Wiiiam Frey" — so any rule loose enough to join the
first three joins those two as well.
`docs/architecture/campaign-finance-system-design.md` §5 (Identity) is the governing rule: a
person, an employer and a vendor carry no identifier in Minnesota's data, so the printed string
is the whole of the key. **A client labels the result with the string it asked for and never with
a person**, and never says it is everything that person gave.

`role` picks the column:

- `contributor` — who money came from. Each row names the committee that received it, and those
  numbers are all linkable, because these are those committees' own filings.
- `vendor` — a supplier a committee paid, from the expenditures download.
- `independent_vendor` — a supplier paid out of independent spending. **A separate role on
  purpose.** 491 independent-expenditure rows share a spender, vendor, amount and date with an
  expenditures row (and 166 the reverse), and whether those are one payment filed twice or two
  payments that coincide is not established — so the 2 downloads are 2 answers and a client
  cannot add them by accident.
- `employer` — payments whose donor typed this string in the employer box. That column is free
  text holding statuses and occupations as much as employers: its 4 commonest values are
  "Not Employed" (67,342 rows), "Retired" (36,517), "Self employed Retired" (16,788) and "Lawyer"
  (9,276), and 87,419 rows carry nothing at all. **Never present it as a company's giving or as a
  count of its employees.**

**Both endpoints use a detail envelope rather than a collection envelope, deliberately.** `state`
decides whether `payments` may be read at all, and the 3 values are the 3 different facts an
empty list can be: `reported`, `not_reported` (we hold none — **never a zero**, and under a name
it means only that this spelling matched nothing), and `unavailable` (our copy of that download
is stale, or it does not reach the year asked for). A top-level `data: []` invites a client to
render the list without reading the state, which is
`.claude/rules/grounded-answers.md` rule 12's missing-versus-zero failure arriving through the
envelope. So `state` is a sibling of `payments`, and the paging keys keep the names and the place
this document's offset contract already gives them: `page.limit`, `page.offset`, `page.has_more`,
with `limit + 1` fetched and a deterministic tie-breaker.

That tie-breaker is the row's date and then its `record_number`, and it may **never** be the
row's contents: 15,786 contribution rows in the live release are content-identical to at least
one other, in 6,464 groups, and one group holds 119 identical rows. Nothing deduplicates, and
`record_number` is a citation into one dated file rather than a stable id a client may store
(§4.2). `release_id` comes back on every page so a client can see when a later page came from a
different day's data.

- **200 with `state: "not_reported"`** on the name route — no row carries this exact spelling.
  Deliberately not a 404: the Board's directory decides whether a *committee* exists and nothing
  decides whether a *person* does, so all we know is that the string matched nothing.
- **404 on the committee route** — this registration number appears in no dataset of the current
  release, resolved with the same `find_committee` the `finance` route uses so the 2 cannot
  disagree about whether a committee exists. Without it an unknown number reads as
  `not_reported`, which invents a committee and then reports its silence: the reader sees no rows
  either way and cannot tell the 2 apart. Live case, found by an automated review: `30161`
  circulates as "Alliance for a Better MN" and is in no dataset of the release (the Alliance's
  committees are 41360 and 80024). The 404 is a statement about **our records**, never about the
  Board's. A **stale** release does not 404, because denying a committee's existence on the
  strength of our own pruning is the same failure one level up; it reads `unavailable`.
- **422** — a `direction` or `role` we do not serve, never a silent fallback to a different
  question.
- **503** — no usable release at all. A fact about us.

**Neither is wired to any client yet.** Nothing under `apps/frontend/src` references either; the
clicking belongs to [#1331](https://github.com/alethical-org/alethical/issues/1331)'s remaining
half, which waits on [#1329](https://github.com/alethical-org/alethical/issues/1329).

#### `GET /api/v1/campaign-finance/summary`

Shipped Aug 19 2026. What the `/money` landing page opens with: 3 counted blocks and 2 dates,
for the lane cards, the confirmation sentence and the "files last copied" line drawn in
`docs/design/handoff-campaign-money/Campaign money IA.dc.html` section 01.

Purpose:

- how many filers Minnesota's register holds, in total and per register kind
- how many sitting members have a committee a person has confirmed is theirs, out of how many
  are sitting
- when each copy of Minnesota's data was last taken

No parameters. **No amount of any kind is served**, so no total summed across members or filers
can reach a lane card (`.claude/rules/grounded-answers.md` rule 12, and
`docs/architecture/campaign-finance-system-design.md` §7, which forbids ranking members whose
filing calendars differ).

**Every figure is counted at read time.** A pasted count is how that page once said 1,336
registered filers on a day the register held 1,603
([#1661](https://github.com/alethical-org/alethical/issues/1661)), so `filer_count` and
`by_kind` are one grouped count over `cf_filer` in the published snapshot.

**Three blocks, 3 states, deliberately not one state for the response.** They read 3
independent things — the Board's register, our own confirmation log, and the 3 bulk downloads —
and one missing piece must not blank the other 2 lanes, the same per-block rule
`/committees/{registration_number}/finance` follows.

- `register` — `state`, `filer_count`, `by_kind` (all 3 of `candidate_committee`, `party_unit`,
  `political_committee_or_fund`, including a kind counting 0, which is a measured zero because
  the register is loaded whole per snapshot), `as_of`, `snapshot_id`, `reason`.
- `legislator_committee_confirmations` — `state`, `confirmed_member_count`,
  `sitting_member_count`, `newest_confirmation_at`, `reason`. **The only figure on the product
  that speaks about the whole set**; every per-member surface speaks about that member alone.
  `sitting_member_count` is filtered exactly as `legislator_directory_stmt` filters the
  `/legislators` directory this lane opens, so the 2 cannot describe different populations; it
  counts people once each, which differs from the directory's row count only if a member holds 2
  current service periods in one session. Rejected links are stored in the same table and are
  deliberately not counted: "we looked and it is not theirs" is not a confirmed committee.
- `freshness` — `downloads_fetched_at` (the landing's "files last copied" date,
  [#861](https://github.com/alethical-org/alethical/issues/861)), `register_fetched_at`,
  `release_id`. Two runs, copied on the same day today and still 2 sources, so one date does not
  stand in for both. Neither is the period any money covers: every period ends earlier. Both are
  normalized to UTC, because Postgres returns a `timestamptz` in the session's own timezone and
  an unnormalized read names the wrong **day** for any run that finished in the small hours.

**A count we could not compute is `null`, never 0**, with the block's `reason` naming which of
our gaps it was: `no_filings_snapshot` (no register loaded at all), `rows_replaced` (the
snapshot we resolved has been replaced under this read, which its rows survive exactly one
further publish), `no_current_legislative_session`. A **0 confirmed** is served as `0`, because
the confirmation log is ours and its emptiness is a fact we know.

**No 503**, unlike the committee routes: a missing download release only empties the freshness
dates, and an explicit `null` beside a `reason` cannot be read as a zero.

#### `GET /api/v1/campaign-finance/filings`

Shipped Aug 19 2026. The landing's "filings as they arrive" list.

Purpose:

- the filed reports we hold with the latest periods, newest period end first, each carrying its
  filer's name, the report, and the period it covers

`limit` (default 10, max 100) and `offset`. **There is no sort parameter and no row carries an
amount**: 5 rows with 5 dollar figures is a ranking whether anyone sorted it or not, and these
rows are why it would mislead — 2 periods can end 20 Jul 2026 while 2 more end 31 Dec 2025,
nearly 7 months earlier.

**`ordered_by` is served because the order is not the one the design asked for.** The design
draws a filed date on every row and **we hold none**: the Board's report catalogue serves 17
fields per report and no filing date among them
(`docs/architecture/campaign-finance-system-design.md` §9.6), and the "Received by the Board"
date is printed inside the report document, which is served only from 2023 and answers a failure
with HTTP 200 and an HTML page. So this is ordered by `period_end` and **no filing-date field
exists here at all** — a period end relabelled as a filing date would be a fabricated fact about
a named committee. Storing a real one is
[#1670](https://github.com/alethical-org/alethical/issues/1670); until it lands no surface may
print "filed on" beside these rows.

**Only reports somebody actually filed.** The catalogue is a schedule: it lists a report from the
moment its filing period opens, filed or not, and 7 of the 1,261 catalogued 2026 pre-primary
reports were unfiled when the filing-calendars module measured them. An unfiled report carries no
amendment record while every filed one carries at least `['0']` (§9.6), so rows with no amendment
record are excluded — which also drops genuinely filed 2002–2007 reports whose amendment record
the catalogue does not serve, the safe direction on a list of the newest filings. Rows with no
period end are excluded too, since nothing orders them and no row can be drawn from them.

**And only periods that have ended**, with the cutoff served as `periods_ended_on_or_before`.
Measured on production on 19 Aug 2026: the 5 newest rows were 2026 year-end reports covering
"1 Jan – 31 Dec 2026", 7 such rows in all. Those are real filings — a terminating committee files
its final report at termination rather than waiting for the period to close, and Paul Novotny's is
the measured case (`docs/architecture/campaign-finance-system-design.md` §9.8) — but a list of the
newest filings whose top row covers 4 months of the future reads as an error or as a claim about
money nobody has raised. It is the missing filing date again: "newest" can only mean the latest
period, and an unfinished period outranks every finished one.

Each row: `registration_number`, `filer_name`, `filer_kind`, `report_name`, `report_type`,
`filing_year`, `period_end`, `period_start`, `period_start_source`, `special_election`,
`amendment_count`, `effective_amendment_index`.

**`period_start` is `null` on many rows and that is a designed state**, not a gap: the row then
reads "covers through {period_end}". §7 forbids hardcoding 1 January, so a start is served only
where one of the Board's own transcribed disclosure calendars prints it against that period end
(`period_start_source: "board_calendar"`, from `CALENDARS` in
`alethical/pipeline/campaign_finance_filing_calendars.py`), and never for a filer with a
special-election report that year — filer 19223's 2025 period opens 11 July (§9.5). Only the 2026
calendars are transcribed, so 2024 and earlier carry no start.

`state` decides whether `filings` may be read: `reported` means the rows are real, `unavailable`
with a `reason` means `no_filings_snapshot` or `rows_replaced`. An empty list is never a claim
that nobody has filed. `page` keeps this document's offset contract (`limit`, `offset`,
`has_more`, with `limit + 1` fetched).

**Neither endpoint is wired to a client in this PR.** The `/money` landing that reads them is
built in parallel by the frontend half of the campaign money phase 1 work.

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
  "longitude": -93.09
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
- address lookup first asks the US Census for the address as typed; if it finds nothing, punctuation-free Minnesota input is split into house, street, city, state, and ZIP before Census retries the house and street with Minnesota
- each address source gets 2 short retries after 0.2s and 0.6s for timeouts, connection failures, and `408`/`425`/`5xx` responses; a Census outage then uses the Minnesota address-point source instead of ending the lookup immediately
- the parser ignores commas, periods, repeated spaces, common street abbreviations, and full street endings found in Minnesota's official address list; `St`, `Mt`, and `Ft` city forms are normalized for ranking
- if Census finds nothing or stays unavailable, the backend asks Minnesota's public statewide address-point list using only the exact house number and street name; it tries an exact street first, then allows 1 added, missing, changed, or swapped character only in a word with at least 5 characters
- exact ZIP and close city matches rank official results, while the supplied street type and direction break remaining ties; equally close addresses become choices, and an incomplete state result list is refused rather than guessed
- House, Senate, and Congress are read from the Minnesota Legislative Coordinating Commission's official 2022 boundary files stored with the backend, including the May 26, 2023 legislative corrections; a person's precise point is not sent to the commission during a lookup
- single-digit House and Senate numbers from that map are padded before the saved district lookup (`4A`/`4` becomes `04A`/`04`), matching the official records instead of falsely reporting no address match
- the bundled map is refused unless it has all 134 House and 67 Senate district codes and valid shapes; each returned shape must cover the selected point, and the smaller browser copy is made only after that check
- the browser shares identical requests already in progress and reuses a successful result for 60s; the API still allows 10 lookup requests per public IP in 60s and returns the remaining wait in `Retry-After` when the limit is reached

#### `POST /api/v1/address-suggestions`

Purpose:

- complete a partial Minnesota street address before a legislator lookup

Request body:

```json
{
  "address_text": "3040 Ex"
}
```

Response:

- up to 5 unique active addresses from Minnesota's official statewide address points
- the full official address and its latitude and longitude for each choice

Rationale:

- suggestions start only after an exact house number plus 2 street-name characters, or
  1 digit for a numbered street
- the state request contains the house number and street-name prefix, not the city or ZIP;
  supplied city and ZIP text rank the returned choices inside Alethical
- choosing a suggestion gives the existing representative lookup its official point, so
  the reader does not need a second click or another geocoding request
- the endpoint has its own 60-requests-per-public-IP-per-60-seconds limit, separate from
  the 10 full representative lookups

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

#### `GET /api/v1/ask/suggestions/{bill_id}/{suggestion_index}`

Purpose:

- return an existing saved answer for one of a bill's public suggested questions without
  classifying, generating, or saving anything on a miss

Contract:

- the path carries only the public bill key and suggestion position; question text is rejected
- a hit rebuilds the current question, bill card, vote count, source date, session, and cited-section
  availability around the saved prose, citations, and coverage in one self-contained response
- a hit is publicly cacheable for 60 seconds; a miss returns `404` with `Cache-Control: no-store`
- a reader-written question never enters this GET path

#### `POST /api/v1/ask/classify`

Purpose:

- routing only — which intent a question resolves to, without producing an answer

### Contact

#### `POST /api/v1/contact`

Purpose:

- accept a public Contact us message, deliver it to `ask@alethical.com`, and send the writer a copy

Contract:

- name and phone are optional; email, subject, and message are required and checked by the server
- 1 request identity covers both emails, so retrying a lost response does not create duplicates
- success means the email provider accepted both messages; disabled or partial delivery returns `503`
- requests are limited separately from Ask and address lookups
- message text is never written to the Alethical database or logs
- on the free plan, accepted messages trigger 1 warning to `ask@alethical.com` at 80%, 90%, and 95% of daily or monthly capacity
- warning failures never turn an already accepted contact message into a failed form submission
- delivery logs keep only the request id, status, short provider error name, safe key-shape checks, and acceptance result

### Policy Areas

#### `GET /api/v1/policy-areas`

Purpose:

- the issue list with a live bill count each, backing the bill-search issue pills
  (`docs/product-onboarding/bill-search-screen-spec.md`, Filters — Policy area)

Real, and undocumented here until the Aug 3 2026 audit.

## Authenticated User API

### Pending signed-out actions

#### `POST /api/v1/pending-actions`

Creates a random, short-lived reference for a signed-out Track press. The request contains
`action: "track_bill"`, `bill_id`, and a checked internal `return_path`. The response returns
the opaque reference and expiration time. The raw reference is never stored, the row is not
attached to an account, and creation is limited per internet address.

#### `POST /api/v1/me/pending-actions/complete`

After sign-in, atomically saves the tracked bill and consumes the reference. A used or expired
reference returns `410 pending-action-unavailable`. A failed save rolls back both changes so a
safe retry remains possible.

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
{
  "previous_viewed_at": "2026-03-12T14:00:00+00:00",
  "viewed_at": "2026-08-05T17:33:31+00:00"
}
```

`previous_viewed_at` is `null` for a user with no recorded visit — their first look, which the page states as such rather than reporting every bill as having just moved.

Read and advance are deliberately one call. Split into a GET and a PUT they could interleave — two tabs opening at once, or a retry — and hand the second caller a mark the first had just written, which reads on screen as "nothing has moved". The client asks once per browser session and holds the answer in `sessionStorage`, so reloading the page does not erase what changed.

Backed by `user_account.tracked_bills_last_viewed_at` (alembic `0025`), a column of its own. `user_account.last_identity_linked_at` cannot serve because it records when the account most recently gained a sign-in identity, never when someone looked at their tracked list.

##### Before you add a SECOND surface that shows "what moved"

Written down in advance because the signed-in homepage is designed to carry a "Session watch" card using the same change blocks, and because the first mistake here is invisible in review. Decided Aug 2026 between the sessions that built #1009 and the homepage design; nothing below is built yet.

**Only the tracked list may advance the mark.** A surface showing a _subset_ must read without advancing. The homepage card shows up to two bills; if a glance at it moved the mark for the whole set, a reader with six moved bills would see two and the other four would never be reported — information loss dressed as a feature.

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

- `POST /api/v1/address-suggestions` while a reader types a partial address
- `POST /api/v1/representative-lookups`
- request may include `address_text` or `latitude` plus `longitude`

Economic access:

- one debounced suggestion request after a typing pause, cached for 60s per partial address
- one representative lookup after the reader chooses a suggestion or submits a full address

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
