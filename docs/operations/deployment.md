<!-- describes: apps/frontend/public/index.html, apps/frontend/App.tsx, apps/frontend/src/components/AppErrorBoundary.tsx, apps/frontend/src/data/api.ts, apps/frontend/src/hooks/useAppQueries.ts, apps/frontend/src/lib/authRestore.ts, apps/frontend/src/lib/publicRead.ts, apps/frontend/src/providers/AuthProvider.tsx, api/page.ts, alethical/api/routers/me.py, alethical/api/services/ask_router.py, alethical/pipeline/rag_ingest.py, railway.json, vercel.json -->

# Production setup and recovery

Start here to rebuild production or recover a missed release. Keep each fact in its
own source:

- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) sets up a clean development computer.
- [Repo and service settings](repo-and-service-settings.md) records the intended
  dashboard settings in GitHub, Vercel, Railway, and Supabase.
- [What runs, when, and what it costs](jobs-and-scripts.md) owns every GitHub job,
  trigger, and cost.
- [Data ingestion onboarding](../product-onboarding/data-ingestion-onboarding.md)
  explains the data sources, queues, and production write guards.
- [`.env.example`](../../.env.example) owns the complete list of setting names and
  safe local defaults.

## Production map

| Part | Lives in | Public address | Normal release |
| --- | --- | --- | --- |
| Web app | Vercel project `alethical-web` | `https://www.alethical.com` | Vercel watches `main` |
| API | Railway service `alethical-api`, `production` environment | `https://api.alethical.com` through Cloudflare; Railway origin `https://alethical-api-production.up.railway.app` | Railway watches `main` |
| Database, sign-in, stored source files | Supabase project `naakzorbkqqgbsreulqi` | Supabase project URL | Settings and migrations, not a code release |
| Ingestion | GitHub's vote refresh plus commands run from a trusted computer | Writes to Supabase | Automatic vote refresh or deliberate production command |

## Rebuild order

1. Follow [`CONTRIBUTING.md`](../../CONTRIBUTING.md) from a clean clone and prove the
   local API and web app start.
2. Create or select the Supabase project. Copy its project URL, publishable key, and
   database connection details. Apply the sign-in settings in
   [Repo and service settings](repo-and-service-settings.md), then add the callback
   addresses below.
3. Connect Railway service `alethical-api` to `alethical-org/alethical`, branch
   `main`, and environment `production`. Keep `railway.json` as the build and release
   source. Add the Railway settings in the table below.
4. Put Cloudflare in front of the Railway origin as `api.alethical.com` by following
   [Putting a CDN in front of the API](api-cdn-setup.md).
5. Connect Vercel project `alethical-web` to the same repository and branch, from the
   repository root. Keep `vercel.json` as the build source. Add the Vercel settings
   in the table below.
6. Run the needed ingestion only after both services pass the checks below. Public
   Minnesota records need no key. Paid batch summaries and batch search indexing run
   only through the deliberate commands listed in
   [What runs, when, and what it costs](jobs-and-scripts.md).

## Settings and owners

Never put a secret in an `EXPO_PUBLIC_*` setting. Those values ship to every browser.

| Need | Setting names | Value comes from | Value lives in |
| --- | --- | --- | --- |
| Production database | `DATABASE_URL`, or `SUPABASE_PROJECT_URL` + `SUPABASE_DB_PASSWORD` | Supabase | Railway; a trusted computer's ignored `.env` for production ingestion |
| Sign-in checks | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Supabase API settings | Railway |
| Browser sign-in | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same publishable Supabase values | Vercel Production; Preview only when testing sign-in |
| Browser API | `EXPO_PUBLIC_API_URL=https://api.alethical.com` | This production map | Vercel Production and Preview; preview browser access is tracked in [#1413](https://github.com/alethical-org/alethical/issues/1413) |
| Allowed websites | `ALETHICAL_CORS_ORIGINS=https://www.alethical.com,http://localhost:8081,http://127.0.0.1:8081,http://localhost:19006,http://127.0.0.1:19006` | This production map | Railway |
| Internal operations routes | `INTERNAL_API_TOKEN` | A newly generated strong secret | Railway and the trusted caller |
| Live Ask and search | `OPENAI_API_KEY`; `ANTHROPIC_API_KEY` only when `OPENAI_RAG_CHAT_MODEL` selects Anthropic | OpenAI or Anthropic | Railway; a trusted computer's ignored `.env` for deliberate paid batch work |
| Email sign-in switch and wait | `EXPO_PUBLIC_EMAIL_PASSWORD_SIGN_IN_ENABLED`, `EXPO_PUBLIC_AUTH_RESEND_WAIT_SECONDS` | Supabase email setup and resend cooldown | Vercel |

GitHub's database-backed jobs use `SUPABASE_PROJECT_URL` and
`SUPABASE_DB_PASSWORD` as GitHub Actions secrets. The file-copy job also uses the
Supabase Storage and Cloudflare R2 names in [`.env.example`](../../.env.example).
The hand-run release jobs use the provider tokens listed in
[Repo and service settings](repo-and-service-settings.md). Optional email, traffic,
model, logging, and map settings stay in [`.env.example`](../../.env.example); add
only the features the environment serves.

## Backend on Railway

Use the repository `railway.json` config from the repo root. It configures a service named `alethical-api` using the RAILPACK builder. Railway runs Alembic before starting the new API, then checks `/readyz`; that endpoint returns success only when the database is reachable and is at the migration version the code expects. A failed migration or readiness check leaves the previous API serving.

`.railwayignore` excludes `apps/frontend`, `docs`, and other paths that are not part of
the backend build when the hand-run fallback uploads a release.

`OPENAI_API_KEY` powers live Ask question sorting and search embeddings. It also
writes answers unless `OPENAI_RAG_CHAT_MODEL` names an Anthropic model; that choice
also needs `ANTHROPIC_API_KEY`. These calls spend money for each reader question.
[What runs, when, and what it costs](jobs-and-scripts.md) separates those live
costs from scheduled jobs and batch work.

Contact email is optional and safely off without its live switch and Resend key.
[How Contact us works](../product-onboarding/contact-us-guide.md) owns its setting names,
delivery checks, limits, and privacy rules.

The build installs dependencies with:

```bash
uv sync --frozen
```

The service start command starts Uvicorn:

```bash
uv run uvicorn alethical.api.main:create_app --factory --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'
```

## Frontend on Vercel

Create the Vercel project from the repository root so the root `pnpm-lock.yaml` is available. The repo-root `vercel.json` configures:

- Ignored build command: stop documentation-only and backend-only builds; build
  when `api/`, `apps/frontend/`, the root package files, or `vercel.json` changes
- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm --dir apps/frontend run build`
- Output directory: `apps/frontend/dist`
- browser safety headers on every response: outside programs, frames, plug-ins,
  cameras, microphones, payment access, and unreviewed network connections are
  blocked; current-location access stays available for **Find My Legislator**

### Frontend browser boundaries

The `Content-Security-Policy` in `vercel.json` starts with everything blocked and
opens only the connections the shipped website uses:

- Alethical's own files and API at `api.alethical.com`
- Supabase sign-in at `naakzorbkqqgbsreulqi.supabase.co`
- Google Fonts styles and font files
- HTTPS images, which covers official legislator photos and OpenStreetMap tiles
- inline styles, because React Native Web creates them while rendering

Inline programs are not broadly allowed. The release-recovery program and the 2
email-link safety programs are allowed only by a fingerprint of their exact text.
Changing even 1 character changes that fingerprint. The focused frontend test reports
the new fingerprint, and the production build checks the program that actually ships:

```bash
pnpm --dir apps/frontend exec vitest run src/lib/__tests__/webSecurityHeaders.test.ts
pnpm --dir apps/frontend run build
```

Review the changed program before replacing its fingerprint in `vercel.json`. Never
add `unsafe-inline` or `unsafe-eval` to `script-src`; either would let an injected
program read the saved Supabase sign-in session and send it away.

The page function, missing-page responses, search tags, `robots.txt`, and sitemap are
owned by [How sharing works](../product-onboarding/sharing-guide.md) and
[What each page tells search engines and link previews](../architecture/page-metadata-for-search-and-sharing-decisions.md).

`EXPO_PUBLIC_AUTH_RESEND_WAIT_SECONDS` must equal Supabase Auth's real email resend cooldown.
It controls the visible wait after a confirmation or reset email. Read the project setting before
changing it; the number shown in a design file is not a product setting.

Keep `EXPO_PUBLIC_EMAIL_PASSWORD_SIGN_IN_ENABLED=false` in a new environment until Supabase custom
SMTP is connected to Resend and confirmation, resend, and reset emails have all arrived. Change it
to `true` only in the same release that passes those checks. Production passed them on 13 August
2026 and is `true`. Google remains available in either state.

Set `EXPO_PUBLIC_API_URL` for both Production and Preview. Without the Preview value, the server's
first-response text still works but the loaded preview app cannot read any record and replaces that
text with an error. The Supabase values are required in Production; add them to Preview only when a
preview needs sign-in or account testing.

After Vercel assigns the production domain, update Railway's `ALETHICAL_CORS_ORIGINS` with that exact Vercel origin and redeploy the backend.

### Frontend first-load recovery

The successful path stays direct: a public read makes 1 request with no retry delay, and
the release page does no recovery work unless its main program file fails to load.

- Public GET requests have a 5-second limit per attempt and get at most 2 attempts total.
  Only a network failure, timeout, or `5xx` server response gets the second attempt. A
  `4xx` response, including an honest missing record, is final and keeps its normal page
  behavior.
- Restoring a saved sign-in has a 5-second limit. The public home renders while that check
  runs, and every success, service error, rejected request, or timeout ends the loading
  state.
- An unexpected render failure anywhere below the app root shows a recovery page with a
  reload button.
- The static HTML listens only for a failed same-origin release program matching
  `/_expo/static/js/web/index-*.js`. It reloads at most once per browser session. If
  browser-session storage cannot prove that guard, it does not reload. Missing API
  records, other assets, cross-origin scripts, and ordinary program errors never trigger
  this rule.

The missing-program rule belongs in the static HTML because the app cannot recover from a
program that failed before the app started. It preserves the single-program release rule
from [#1110](https://github.com/alethical-org/alethical/issues/1110) and does not add route
program splitting or a service worker.

## Supabase sign-in callbacks

In **Supabase > Authentication > URL Configuration**, set **Site URL** to
`https://www.alethical.com`. Allow these callback addresses:

```text
https://www.alethical.com/**
http://localhost:8081/**
http://127.0.0.1:8081/**
http://localhost:19006/**
http://127.0.0.1:19006/**
alethical://auth/callback
```

Add a preview address only while testing sign-in on that preview. Do not allow every
Vercel preview by wildcard. [Repo and service settings](repo-and-service-settings.md)
owns the current provider, email, password, and confirmation settings.

## Release and recovery

- Normal release: merge to `main`. Vercel and Railway each release through their own
  Git connection. Railway runs database migrations before replacing the API.
- Missed Vercel release: use the Vercel deployment for the reviewed commit and promote
  or redeploy it to Production. If GitHub Actions is healthy, the hand-run
  `vercel-deploy.yml` job is the second path.
- Missed Railway release: in Railway, choose **Deploy Latest Commit** for service
  `alethical-api` in `production`. If GitHub Actions is healthy, the hand-run
  `railway-deploy.yml` job is the second path.
- Full-stack recovery: wait for `https://api.alethical.com/readyz` to answer
  `{"status":"ready"}` before releasing a web change that needs the new API.
- Never upload an arbitrary laptop folder. Every recovery path above selects code that
  is already on `main` and keeps the provider's release history readable.

## Final checks

```bash
curl -fsS https://api.alethical.com/readyz
curl -fsS -o /dev/null -w '%{http_code}\n' https://www.alethical.com/
```

Then open 1 bill page, sign in when sign-in changed, and run the narrow ingestion dry
run when ingestion changed. A `200` response proves the services answer; it does not
prove a changed user path works.

## Related releases

The web app is the shipped client. [iOS release](ios-release.md) owns simulator,
TestFlight, and future native iOS steps.
