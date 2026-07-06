# Alethical — Code Review Findings

Review date: 2026-07-06. Scope: backend (`alethical/`), pipeline, frontend (`apps/frontend/`), scripts, docs, CI/deploy config. Findings are grouped by theme and ordered roughly by impact. Each item names the file(s) and a concrete recommendation.

---

## 1. Multi-cloud-provider drift (the example you flagged)

The repo carries deploy/config plumbing for **three** PaaS providers, but only one is actually used.

- `railway.json` — Railway Railpack backend deploy. The `railway-deploy.yml` workflow deploys to Railway on `main`.
- `render.yaml` — Render blueprint for the *same* `alethical-api` service. `docs/deployment.md` describes Render as the backend host and tells operators to use `render.yaml`.
- `vercel.json` + `apps/frontend/vercel.json` — Vercel for the frontend (this one is real and used by `vercel-deploy.yml`).

So the backend is double-configured for Railway **and** Render, with two divergent sets of instructions:

- `render.yaml` runs migrations inline (`uv run python -m alembic ... upgrade head && uvicorn ...`).
- `railway.json` does **not** run migrations; instead `.github/workflows/migrate.yml` runs them as a separate GitHub Actions workflow on `main`.
- `docs/deployment.md` and `CONTRIBUTING.md` disagree: the doc says "Backend: FastAPI web service on Render," while `CONTRIBUTING.md` says "the backend (Railway)".
- `POOL_D_MANUAL_REGRESSION.md` still says "Confirm production Render backend has `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`."

**Recommendation:** Pick one backend host. Delete the other's config file, deploy workflow, and doc references. If Railway is the choice, remove `render.yaml` and rewrite `docs/deployment.md`; if Render, remove `railway.json`, `.railwayignore`, and `railway-deploy.yml`. Either way, fix the `CONTRIBUTING.md`/`docs/deployment.md`/`POOL_D_MANUAL_REGRESSION.md` text so all three agree.

---

## 2. Duplicated `supabase_database_url()` across four modules

The same ~7-line function is copy-pasted in:

- `alethical/db/session.py` (canonical version, returns `postgresql+psycopg://...`)
- `alethical/pipeline/ai_enrichment.py` (returns `postgresql+psycopg://...`)
- `alethical/pipeline/committee_memberships.py` (returns `postgresql+psycopg://...`)
- `alethical/pipeline/votes.py` (returns `postgresql+psycopg://...`)

All four parse `SUPABASE_PROJECT_URL` + `SUPABASE_DB_PASSWORD` identically. The `docker-compose.yml` backend command also re-implements the same project-ref extraction inline with `sed`.

**Recommendation:** Import the one in `db/session.py` everywhere. The pipeline modules already import from `db.session` for `database_url_for_target`/`get_database_url`, so the duplication is gratuitous.

---

## 3. Hardcoded Minnesota / 94th-session defaults baked across the codebase

`"94-2025-regular"`, `"0942025"`, `"94-2025-"`, and `max_bill_number=6000` are string-literals in at least:

- `alethical/pipeline/minnesota.py` (`BillTarget.session_code`, `BillSearchResult.bill_key`, `seed_reference_data`, `ingest_roster`)
- `alethical/pipeline/oban.py` (CLI defaults)
- `alethical/pipeline/oban_workers.py` (worker fallbacks)
- `alethical/pipeline/ai_enrichment.py` (CLI defaults)
- `alethical/tests/test_api_contract.py` (assertions)
- `scripts/load_minnesota_data.py`

The README pitches Minnesota as a *pilot* for a national transparency movement, but nothing about the ingestion code is parameterized by jurisdiction — the session slug is hard-coded into bill-key construction (`f"94-2025-{file_type}{file_number}"`), so a second session or state would silently produce wrong keys.

**Recommendation:** Introduce a `SessionConfig`/`JurisdictionConfig` dataclass loaded from the `LegislativeSession` row (or env) and pass it through the pipeline. At minimum, centralize the magic strings as named constants in one module.

---

## 4. RAG embeddings are a deterministic placeholder wired into production paths

`alethical/pipeline/rag_ingest.py::_deterministic_embedding` produces a 1536-d vector from `sha256(text + counter)` — not a real embedding. It's used:

- At ingestion (`build_rag_rows_for_bill_keys`, `backfill_rag_bulk.py`).
- At **query time** in the API: `alethical/api/routers/me.py` imports `_deterministic_embedding` (underscore-prefixed private) and uses it for `build_query_embedding`. So the chat endpoint's "grounded" retrieval is cosine-similarity over hash noise — semantically random results.
- The model name `demo-minilm-1536` is misleading: there's no minilm anywhere; it's a hash. `rag_ingest._build_embeddings` even silently rewrites any other model to `DEFAULT_RAG_MODEL` "to remain stable and uniform."
- The ivfflat index in `0001_initial_schema.py` is built over these hash vectors, so the index is also meaningless.

`docs/data-ingestion-onboarding.md` admits "embeddings = PLACEHOLDER" in the diagram, but the API ships this to users as a chat feature.

**Recommendation:** Either (a) wire a real embedding model (OpenAI `text-embedding-3-small` is already in the dependency story since `OPENAI_API_KEY` is used for chat), or (b) gate the chat endpoint behind a feature flag and return a clear "not available" until embeddings are real. Don't ship hash-based retrieval as grounded answers.

---

## 5. Sync SQLAlchemy + blocking `requests` inside an async FastAPI app

- `alethical/db/session.py` builds a synchronous `create_engine` + `sessionmaker`; `get_db` is a sync generator. Every router handler is `def` (not `async def`), which is fine — FastAPI runs them in a threadpool.
- But `alethical/api/routers/me.py::synthesize_grounded_answer` calls `requests.post(...)` synchronously inside a sync handler — fine for threadpool, but it's a 30s blocking call with no timeout-retry, no circuit breaker, and no streaming. The same pattern in `public.py` for representative lookup.
- `psycopg_pool.AsyncConnectionPool` is used only by `oban.py`. The API never uses async DB. This is consistent but means the "async" stack (FastAPI + uvicorn) is essentially running a sync app under the hood.

**Recommendation:** Either commit to async end-to-end (async SQLAlchemy 2.x + `httpx.AsyncClient` + async Supabase calls) or document that the API is intentionally sync-in-threadpool and stop importing `psycopg_pool` in app code paths. The current mix is fine *technically* but invites future contributors to write `async def` handlers that block.

---

## 6. `oban.toml` is dead config

`oban.toml` defines queues and pool sizes, but no code reads it — `grep` for `oban.toml`, `tomllib`, `queues =` finds only a doc reference. The actual queue/concurrency config lives in `oban.py::drain` (`Oban(pool=pool, queues={args.queue: args.concurrency})`) and in `oban_workers.py` `@worker(queue=...)` decorators. The file is misleading.

**Recommendation:** Delete `oban.toml` or wire it up. If kept, load it in `oban.py` and use it for `drain` defaults and worker queue definitions.

---

## 7. `psycopg-pool` is an undeclared direct dependency

`alethical/pipeline/oban.py` imports `from psycopg_pool import AsyncConnectionPool`. `pyproject.toml` only lists `psycopg[binary]` — `psycopg-pool` is currently pulled in transitively via `oban` (see `uv.lock` lines 824-832). If `oban` ever drops or extras that dependency, `oban.py` breaks with no warning from `uv` since it's not a declared project dep.

**Recommendation:** Add `psycopg-pool` to `pyproject.toml` dependencies (you import it directly), or import it only through `oban`'s re-exports if it provides one.

---

## 8. Internal API auth has a weak default and accepts tokens in query strings

- `alethical/api/routers/internal.py::require_internal_token` falls back to `"dev-internal-token"` when `INTERNAL_API_TOKEN` is unset. The `/internal/v1/oban` HTML dashboard and `/internal/v1/oban/jobs` JSON endpoint both rely on this. A misconfigured prod deploy with no env var silently exposes ingestion-run listing and Oban job inspection.
- `require_internal_dashboard_token` accepts the token via `?token=...` query param. The code comment even notes "tokens in query parameters may leak in logs." This is the dashboard route — the one most likely to be shared/linked.

**Recommendation:** Remove the default; fail closed when `INTERNAL_API_TOKEN` is unset (or refuse to start in prod). Drop the query-param auth path for the dashboard; header-only.

---

## 9. `readyz` is a stub

`alethical/api/main.py::readyz` returns `{"status": "ready"}` unconditionally — no DB ping, no Oban check, no Supabase check. The Railway/Render healthchecks use `/healthz` (which is also a constant), so deploy-time readiness is decoupled from actual subsystem health. A broken DB still serves "ready."

**Recommendation:** Make `/readyz` actually probe the database (`select 1`) and return 503 on failure. Keep `/healthz` as the liveness constant.

---

## 10. Frontend still depends on `mockData.ts` for real features

`apps/frontend/src/hooks/useAppQueries.ts` imports `getNotificationPreference`, `listSavedPlaces`, `updateNotificationPreference` from `data/mockData.ts`. The backend has real endpoints for these (`/me/notification-preferences`, `/me/saved-places` in `routers/me.py`). So notification preferences and saved places are mock-only in the UI even though the API exists.

`mockData.ts` also still defines a full `legislators` array and `demoUserId = 'user-demo-1'`, suggesting other screens may fall back to it.

**Recommendation:** Wire the three me-endpoint features to the real API (the `api.ts` patterns are already there for tracked bills and chat). Audit other `mockData` imports and either delete the file or scope it to storybook/empty-state fixtures.

---

## 11. `TrackedBillModel` is a redundant alias

`alethical/api/routers/me.py` defines both `TrackedBill = schema.TrackedBill` and `TrackedBillModel = schema.TrackedBill` (lines 36-37), then uses both names interchangeably. Dead-weight indirection that makes grep harder.

**Recommendation:** Delete `TrackedBillModel`; use `TrackedBill` everywhere.

---

## 12. `alembic.ini` hardcodes a localhost DSN

`alembic.ini` line 4 sets `sqlalchemy.url = postgresql+psycopg://alethical:alethical@localhost:54329/alethical`. `alembic/env.py` overrides it from `DATABASE_URL` if set, so it works in CI and prod — but anyone running `alembic` without `DATABASE_URL` (e.g., from a different host port) gets a confusing failure, and the file leaks the local dev password pattern.

**Recommendation:** Set `sqlalchemy.url =` empty in `alembic.ini` and require `DATABASE_URL` (or fall back to the same `get_database_url()` helper). The env override already does the right thing.

---

## 13. CI type-checks only `alethical/db`

`.github/workflows/ci.yml` runs `uvx ty check alethical/db` — only the `db` subpackage. The rest of the backend (`api/`, `pipeline/`, `scripts/`) is not type-checked. Given the heavy use of `Any`, `dict[str, Any]` job args, and dynamic `schema = load_schema()` module-attribute pattern (`Bill = schema.Bill` etc.), type errors in routers and workers will not be caught.

**Recommendation:** Expand `ty check` to `alethical/api alethical/pipeline alethical/db scripts` (or the whole package). If errors flood in, fix them incrementally rather than excluding whole trees.

---

## 14. Single Alembic migration uses `metadata.create_all`

`alethical/alembic/versions/0001_initial_schema.py` calls `models.Base.metadata.create_all(bind=bind)` in `upgrade()` and `drop_all` in `downgrade()`. This is an anti-pattern: it bypasses Alembic's diff/autogenerate story, makes future schema changes awkward (you'd have to hand-write `op` calls *around* a `create_all` baseline), and means `alembic revision --autogenerate` against the current models will produce empty migrations.

**Recommendation:** Replace `0001_initial_schema.py` with an explicit `op.create_table` migration generated from the models. From then on, all schema changes go through normal Alembic revisions.

---

## 15. `docker-compose.yml` backend command is a 3-line shell soup

The `backend.command` does `uv sync` → conditional Supabase DSN rewrite via `sed` → conditional migration → `uvicorn --reload` in one `sh -c`. It mixes prod-target logic (Supabase pooler host, `ALETHICAL_DATABASE_TARGET=production`) into the *dev* compose file. The `--reload` flag also fights with `uv sync` on every container restart.

**Recommendation:** Move the Supabase-DSN derivation into `db/session.py` (it already exists there as `supabase_database_url()` — see item 2) and let the compose command be just `uvicorn ... --reload`. Drop the in-line `sed` project-ref extraction.

---

## 16. OpenAI model identifiers are inconsistent and some look fictional

Across the pipeline:
- `ai_enrichment.py`: `DEFAULT_MODEL = "gpt-5.2"`, batch endpoint `/v1/responses`.
- `oban.py` CLI default: `OPENAI_AI_ENRICHMENT_MODEL` env or `"gpt-4o-mini"`.
- `oban_workers.py` worker fallback: `"gpt-4o-mini"`.
- `oban.py` `--codex-model` default: `"gpt-5.5"`.
- `me.py` RAG chat: `OPENAI_RAG_CHAT_MODEL` env or `"gpt-4o-mini"`.

So the batch path defaults to `gpt-5.2`, the codex path to `gpt-5.5`, and the live chat to `gpt-4o-mini`. The `gpt-5.x` identifiers are not real OpenAI model names as of the public API. Either this is internal aliasing or aspirational naming — either way it's a footgun for a new operator.

**Recommendation:** Centralize model selection in one config module with env overrides and document the actual model names. Pick one default for enrichment and one for chat.

---

## 17. `requests` is used in async-adjacent code and tests; `httpx` is already a dependency

`httpx` is in `pyproject.toml` (used by FastAPI's `TestClient`). The pipeline and API nonetheless use synchronous `requests` everywhere, including in `oban_workers.CodexAiEnqueueWorker.prepare_files` which calls `requests.get(item.custom_id)` inside a sync `run()` threaded via `asyncio.to_thread`. Mixing `requests` (sync) and `httpx` (sync+async) is fine, but it's odd to ship both when `httpx` would unify sync/async and give you connection pooling/retries for free.

**Recommendation:** Not urgent, but consider migrating HTTP calls to `httpx` (sync `Client` in the sync paths, `AsyncClient` if you go async per item 5). Drop `requests` from `pyproject.toml` once migrated.

---

## 18. Logging only goes to a rotating file, not stdout

`alethical/logging.py::configure_logging` clears `root_logger.handlers` and adds only a `RotatingFileHandler` to `logs/alethical-backend.log`. In container deploys (Railway/Render), logs go to a file inside the container and are lost on redeploy. Railway/Render both ingest stdout/stderr. Uvicorn's `--log-level warning` in the compose command further suppresses request logs.

**Recommendation:** Add a `StreamHandler` to stdout alongside the file handler, or make the file handler optional via env. Container platforms need stdout.

---

## 19. Minor / housekeeping

- `apps/frontend/src/data/api.ts` uses 4-space indentation while the rest of the frontend uses 2-space — likely a copy-paste artifact; `tsc` won't catch it but prettier would.
- `apps/frontend/package.json` declares `private: true` and `packageManager` at both root and frontend — fine, but the root `package.json` has no `version`/`license`/`repository` fields, which makes npm metadata sparse.
- `pyproject.toml` lists `pytest`, `pytest-asyncio`, and `httpx` as runtime dependencies rather than dev dependencies. With `[tool.uv] package = false`, there's no dev group set up; consider a `[dependency-groups] dev = [...]` section so prod images don't ship test deps.
- `scripts/` contains one-shot loaders (`load_minnesota_data.py`, `load_sample_data.py`) and a `backfill_rag_bulk.py` that re-implements RAG ingestion outside the Oban pipeline. Either fold these into Oban workers or document them as deprecated in favor of `just pipeline ...`.
- `docs/` has 18 markdown files including `android-prototype-handoff.md`, `ios-release.md`, `local-dev-windows.md`, `mvp-redesign-plan.md` — some likely stale. A periodic doc-triage pass (the `CONTRIBUTING.md` already prescribes this for issues) would help.
- `README.md` ends with `<!-- deploy test: 2026-06-23 -->` — a deploy-test marker that should not be in `main` history.
- `.gitignore` ignores `alethical.db` (a SQLite file) but the project is Postgres-only; harmless but confusing.

---

## Summary of highest-leverage fixes

1. **Pick one backend host** (Railway or Render) and delete the other's config + docs (item 1).
2. **Replace the hash-based RAG embeddings** or gate the chat feature — it currently returns random retrieval as "grounded" (item 4).
3. **Fail closed on `INTERNAL_API_TOKEN`** and drop query-string token auth (item 8).
4. **Make `/readyz` actually probe the DB** so deploys catch broken infrastructure (item 9).
5. **Parameterize the Minnesota/session constants** before any second jurisdiction is attempted (item 3).
6. **Expand `ty check` to the whole backend** so the routers/workers type-unsafe areas get coverage (item 13).
7. **Deduplicate `supabase_database_url()`** and clean up the compose command (items 2, 15).
