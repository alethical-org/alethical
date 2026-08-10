# Backend stack

<!-- describes: pyproject.toml, Dockerfile.backend, docker-compose.yml, railway.json, oban.toml, alethical/api/main.py, alethical/db/session.py, alethical/api/rate_limit.py -->

**Net:** The backend is one Python web service that answers requests, one Postgres database
that stores everything, and a set of jobs that pull the Minnesota legislative record in.
The web service is FastAPI on Uvicorn, hosted on Railway. The database is Postgres with the
`pgvector` add-on, hosted by Supabase in production and in a container locally. Supabase also
handles sign-in. The jobs run through a Postgres-backed queue (`oban`) and are started by a
person or by a scheduled GitHub Actions run, never by a worker that sits running all day.
Outside paid services are exactly three: Anthropic and OpenAI for AI text and search, and
Resend for outbound email.

This is the map. Every part has a deeper doc, listed in
[Where each part is documented](#where-each-part-is-documented) at the bottom; read this page
first and follow the link for the part you need.

## The parts at a glance

| Job | What we use | Where it is set |
| --- | --- | --- |
| Language | Python 3.12 | `pyproject.toml` (`requires-python`) |
| Installing packages | `uv`, with exact versions frozen in a lock file | `pyproject.toml`, `uv.lock` |
| Answering web requests | FastAPI, run by the Uvicorn server | `alethical/api/main.py` |
| Checking request and response shapes | Pydantic | `alethical/api/schemas.py` |
| Talking to the database | SQLAlchemy | `alethical/db/models.py`, `alethical/db/session.py` |
| Changing database structure safely | Alembic | `alethical/alembic/versions/` |
| Storing data | Postgres 17 with the `pgvector` add-on | `docker-compose.yml` (local), Supabase (production) |
| Sign-in | Supabase Auth | `alethical/api/auth.py`, `alethical/api/services/auth.py` |
| Background jobs | `oban`, a queue that lives in Postgres | `oban.toml`, `alethical/pipeline/oban.py` |
| Writing bill summaries | Anthropic (Claude) | `alethical/pipeline/anthropic_enrichment.py` |
| Making bill text searchable by meaning | OpenAI embeddings | `alethical/pipeline/rag_ingest.py` |
| Sending email | Resend | `alethical/api/services/contact.py` |
| Hosting | Railway, one service | `railway.json` |
| Releasing | GitHub Actions | `.github/workflows/` |
| Tests | pytest | `alethical/tests/` |

## 1. Language and packages

Python, version 3.12 or newer. Packages are installed by `uv`, a fast replacement for `pip`.
Two files control this: `pyproject.toml` lists what we need and the oldest version of each we
accept, and `uv.lock` pins the exact version every machine installs, so a laptop, the test
runner, and production all get the same code.

Some entries in `pyproject.toml` carry a comment explaining why they are listed by name. The
pattern behind those: a package we import directly must be declared directly, even when it
already arrives as a side effect of something else needing it. Otherwise a release of that
other package can drop it and break us with no visible change on our side.

## 2. The web service

FastAPI builds the API. Uvicorn is the program that actually listens for requests and hands
them to FastAPI. One Uvicorn process runs per container.

- The app is assembled in one function (`create_app` in `alethical/api/main.py`), which the
  start command calls. This is what lets tests build a fresh app instead of importing a
  half-configured one.
- Public and signed-in routes sit under `/api/v1`. Operations routes we use ourselves sit
  under `/internal/v1`. The version number is in the address so a future change can ship
  beside the old one instead of breaking every client at once.
- Five route files, split by who the caller is: open data (`public.py`), question answering
  (`ask.py`), signed-in features (`me.py`), the contact form (`contact.py`), and our own
  operations checks (`internal.py`).
- Which websites may call the API is set by an environment variable
  (`ALETHICAL_CORS_ORIGINS`), not hard-coded, so a new frontend address is a setting change.
- Errors come back in one consistent shape (`alethical/api/problems.py`) rather than
  whatever each route happened to raise.
- Requests are capped per minute on the routes that cost money or hit outside services:
  question answering, address lookup, address suggestions, and the contact form. **The count
  is kept in the memory of a single process**, so with several processes or replicas the real
  ceiling is that number multiplied by how many are running. That is on purpose as a first
  step against runaway clients, and it is not a security boundary. A shared counter is the
  follow-up (`alethical/api/rate_limit.py`).

## 3. The database

Postgres, with the `pgvector` add-on so bill text can be searched by meaning and not just by
matching words. Search vectors are 1,536 numbers long, which is what the OpenAI embedding
model we use produces (`VECTOR_DIMENSIONS` in `alethical/pipeline/rag_ingest.py`).

- **Locally** it runs in a container on port 54329, from the `pgvector/pgvector:pg17` image
  (`docker-compose.yml`).
- **In production** it is Supabase's hosted Postgres. The backend reaches it through
  Supabase's connection pooler, which shares a small number of real database connections
  between many callers.
- That pooler has a trap worth knowing: it reuses connections underneath us, so Postgres's
  normal habit of remembering a prepared query by name breaks under load. Every connection we
  open therefore turns that habit off (`NO_PREPARED_STATEMENTS` in `alethical/db/session.py`).
  Skipping it produces a confusing duplicate-name error that only appears in production.
- Which database a command talks to is chosen by one setting
  (`ALETHICAL_DATABASE_TARGET`, `local` or `production`), and there is a guard that stops
  tests writing to production (`alethical/tests/local_database_guard.py`).
- Structure changes go through Alembic, 29 change files as of Aug 10 2026. Merging one to
  `main` applies it to production automatically through the `migrate.yml` workflow.

## 4. Sign-in

Supabase Auth holds accounts and passwords. We never store a password.

The frontend signs the reader in with Supabase directly and gets a token. Every request to a
signed-in route carries that token, and the backend asks Supabase whether it is real before
trusting it (`alethical/api/auth.py`, `alethical/api/services/auth.py`). An address only
counts as the reader's identity once Supabase says it was confirmed, which is what stops one
person claiming another person's account by typing their address.

## 5. Background jobs

The record-fetching work runs as queued jobs, not inside a web request, because a single bill
fetch can take minutes.

- The queue lives in Postgres itself (the `oban` package), so there is no separate queue
  server to run or pay for.
- Lanes are named per kind of work, each with its own limit on how many run at once: bills 8
  at a time, everything else 1 at a time (`oban.toml`). Bill fetching is the slow part, so it
  gets the width; the rest is kept single-file to stay polite to the state's websites.
- The job types are one per source: bills, roll-call votes, committee memberships, the
  legislator roster, the search index, and the AI summary batches
  (`alethical/pipeline/oban_workers.py`).
- **Nothing runs these on a timer.** Railway hosts one service and its only job is the web
  API (`railway.json`), so a full ingest is started by a person from a laptop
  (`alethical/pipeline/oban.py`). Four GitHub Actions workflows cover the narrow slices that
  can be done safely without a person: a nightly roll-call vote top-up
  (`vote-backfill.yml`), a manual residence-city fill (`legislator-city-backfill.yml`), and
  two checks that only open an issue when they find a hole (`bill-section-gaps.yml`,
  `rag-coverage-gaps.yml`).
- That hand-started design is the reason a bill can sit at a stale status: fetches skip bills
  already stored unless told otherwise. Keeping the corpus current is a decision someone
  makes, not something that happens on its own
  (`.claude/rules/grounded-answers.md` rule 7).

## 6. AI providers

Two, used for different jobs.

- **Anthropic (Claude)** writes the plain-language bill summaries and key points. The current
  default is Claude Sonnet 5, and the runner can go through either the paid API or the Claude
  Code command-line tool (`alethical/pipeline/anthropic_enrichment.py`).
- **OpenAI** turns bill text into the number lists that power meaning-based search
  (`text-embedding-3-small`). With no key set on a laptop, the code falls back to a fake
  vector made from the text's fingerprint so local work runs without spending anything, and
  labels those rows honestly as `deterministic-sha256` so they are never mistaken for real
  ones. Pointed at production, a missing key stops the run instead of quietly filling the
  search index with fakes (`alethical/pipeline/rag_ingest.py`).
- Older summary code still names OpenAI models as its default
  (`alethical/pipeline/ai_enrichment.py`, `alethical/pipeline/codex_enrichment.py`). The
  summaries actually in the database were produced with Claude. Which rail costs what is laid
  out in `docs/product-onboarding/ai-models-and-billing.md`.

## 7. Outbound email

Resend sends the contact-form messages (`alethical/api/services/contact.py`). Real sending
takes three settings agreeing: sending is switched on (`ALETHICAL_EMAIL_ENABLED`), the
transport is set to Resend rather than the printing-to-the-log default
(`ALETHICAL_EMAIL_TRANSPORT`), and a key is present (`RESEND_API_KEY`). The service logs at
startup which of those is missing, so a misconfigured key shows up in the log instead of as
silently lost mail. The free plan's daily and monthly caps are read back from Resend's own
response headers rather than assumed.

## 8. Hosting and release

- One Railway service runs the API. It restarts on failure, up to 10 times, and Railway
  checks it is alive by calling `/healthz` (`railway.json`).
- The build runs `uv sync --frozen`, which installs exactly the locked versions and fails
  rather than quietly resolving something newer.
- Pushing to `main` triggers the deploy (`railway-deploy.yml`). A push that touches database
  structure separately triggers the migration (`migrate.yml`).
- The frontend deploys separately to Vercel, so a backend release and a frontend release are
  two independent events.

## 9. Tests

pytest, 36 test files under `alethical/tests/`. Two groups matter more than the rest:

- `test_api_contract.py` and `test_ask_scenarios.py` hold the product promises: an answer
  must cite a real source or refuse, and a signed-in chat must keep working
  (`.claude/rules/grounded-answers.md` rules 1 and 8).
- Tests that write to the database need the local Postgres container running. Tests that only
  check logic do not.

## What the backend deliberately does not have

Named so nobody adds one by reflex, and so a real need is easy to spot:

- **No separate queue or cache server.** The job queue is Postgres tables. Rate limiting is
  in process memory. Both are deliberate for one small service; the moment we run more than
  one replica, the rate limit is the first thing that needs a shared store.
- **No always-on worker process.** See section 5 for why, and for what that costs us.
- **No second database.** Search vectors, records, accounts, and the job queue all live in
  the same Postgres.

## Where each part is documented

| To understand | Read |
| --- | --- |
| The routes, what each returns, and which ones are designed but not built | [Backend API system design](backend-api-system-design.md) |
| The tables and how they relate | [Database schema system design](db-schema-system-design.md) |
| How official records become our records | [Ingestion layer 1](layer-1-source-ingestion-system-design.md) |
| How records become searchable text | [Ingestion layer 2](layer-2-rag-ingestion-system-design.md) |
| Running an ingest yourself, with the source URLs | [Data ingestion onboarding](../product-onboarding/data-ingestion-onboarding.md) |
| Which AI model does what, and what it costs | [AI models & billing](../product-onboarding/ai-models-and-billing.md) |
| What we buy versus build, and what would reverse each call | [AI platform position](ai-platform-position.md) |
| Deploying, and every environment variable each service needs | [Deployment](../operations/deployment.md) |
| Settings that control the project but are not in the repo | [Repo and service settings](../operations/repo-and-service-settings.md) |
| Cloudflare in front of the API, and email authentication records | [API CDN setup](../operations/api-cdn-setup.md) |
| Ways production and the code have disagreed before | [Production database schema drift](../operations/production-database-schema-drift.md) |
| Everything we store about a reader and for how long | [What we keep about readers](../product-onboarding/user-data-retention-policy.md) |
| Reconciling who currently holds office | [Canonical legislator membership](legislator-roster-canonical-membership-spec.md) |
