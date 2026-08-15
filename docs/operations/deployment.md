<!-- describes: apps/frontend/public/index.html, apps/frontend/App.tsx, apps/frontend/src/components/AppErrorBoundary.tsx, apps/frontend/src/data/api.ts, apps/frontend/src/hooks/useAppQueries.ts, apps/frontend/src/lib/authRestore.ts, apps/frontend/src/lib/publicRead.ts, apps/frontend/src/providers/AuthProvider.tsx, api/page.ts, alethical/api/routers/me.py, alethical/api/services/ask_router.py, alethical/pipeline/rag_ingest.py, alethical/logging.py, alethical/monitoring.py, railway.json, vercel.json -->

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
- [`.env.example`](../../.env.example) lists settings the code supports and their
  safe local defaults. [Repo and service settings](repo-and-service-settings.md)
  alone owns the intended live names and targets.

## Production map

| Part                                   | Lives in                                                        | Public address                                                                                                   | Normal release                                          |
| -------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Web app                                | Vercel project `alethical-web`                                  | `https://www.alethical.com`                                                                                      | Vercel watches `main`                                   |
| API                                    | Railway service `alethical-api`, `production` environment       | `https://api.alethical.com` through Cloudflare; Railway origin `https://alethical-api-production.up.railway.app` | Railway watches `main`                                  |
| Database, sign-in, stored source files | Supabase project `naakzorbkqqgbsreulqi`                         | Supabase project URL                                                                                             | Settings and migrations, not a code release             |
| Ingestion                              | GitHub's vote refresh plus commands run from a trusted computer | Writes to Supabase                                                                                               | Automatic vote refresh or deliberate production command |

## Rebuild order

1. Follow [`CONTRIBUTING.md`](../../CONTRIBUTING.md) from a clean clone and prove the
   local API and web app start.
2. Create or select the Supabase project. Copy its project URL, publishable key, and
   database connection details. Apply the sign-in settings in
   [Repo and service settings](repo-and-service-settings.md), then add the callback
   addresses below.
3. Connect Railway service `alethical-api` to `alethical-org/alethical`, branch
   `main`, and environment `production`. Keep `railway.json` as the build and release
   source. Add the intended live settings from
   [Repo and service settings](repo-and-service-settings.md#railway-project).
4. Put Cloudflare in front of the Railway origin as `api.alethical.com` by following
   [Putting a CDN in front of the API](api-cdn-setup.md).
5. Connect Vercel project `alethical-web` to the same repository and branch, from the
   repository root. Keep `vercel.json` as the build source. Add the intended live
   settings from [Repo and service settings](repo-and-service-settings.md#vercel-project).
6. Run the needed ingestion only after both services pass the checks below. Public
   Minnesota records need no key. Paid batch summaries and batch search indexing run
   only through the deliberate commands listed in
   [What runs, when, and what it costs](jobs-and-scripts.md).

## Settings and owners

[Repo and service settings](repo-and-service-settings.md) owns every intended live
GitHub secret name, Vercel name and target, Railway name, and Supabase sign-in value.
Supabase supplies database and sign-in values. OpenAI, Anthropic, and Resend supply their
own keys. A trusted computer keeps deliberate production-work values in an ignored
`.env` file. Never put a secret in an `EXPO_PUBLIC_*` setting because those values ship
to every browser.

[`.env.example`](../../.env.example) lists optional settings the code understands.
Adding an optional setting to production also requires adding its intended live row to
[Repo and service settings](repo-and-service-settings.md) in the same change.

## Backend on Railway

Use the repository `railway.json` config from the repo root. It configures a service named `alethical-api` using the RAILPACK builder. Railway runs Alembic before starting the new API, then checks `/readyz`; that endpoint returns success only when the database is reachable and is at the migration version the code expects. A failed migration or readiness check leaves the previous API serving.

`.railwayignore` excludes `apps/frontend`, `docs`, and other paths that are not part of
the backend build when the hand-run fallback uploads a release.

The complete intended Railway variable-name list lives in
[`repo-and-service-settings.md` § Railway environment variables](repo-and-service-settings.md#railway-environment-variables).
Keep values only in Railway, never in this repository.

`OPENAI_API_KEY` powers live Ask question sorting and search embeddings. It also
writes answers unless `OPENAI_RAG_CHAT_MODEL` names an Anthropic model; that choice
also needs `ANTHROPIC_API_KEY`. These calls spend money for each reader question.
[What runs, when, and what it costs](jobs-and-scripts.md) separates those live
costs from scheduled jobs and batch work.

To enable error alerts, add:

```bash
SENTRY_DSN=https://public-key@o0.ingest.sentry.io/project-id
```

`SENTRY_DSN` is the private Railway setting that turns error alerts on. It is safe to
omit locally. The value identifies the Sentry project but does not grant access to read
its events. Sentry receives only deliberately sent failures; request bodies, reader
questions and messages, account details, log lines, performance traces, and local
variables stay off. The complete setup, one-event proof, incident steps, and shutoff are
in [`docs/operations/error-monitoring.md`](error-monitoring.md).

Contact email is optional and safely off without its live switch and Resend key.
[How Contact us works](../product-onboarding/contact-us-guide.md) explains the
supported email settings, delivery checks, limits, and privacy rules. The intended
production name list stays in
[`repo-and-service-settings.md` § Railway environment variables](repo-and-service-settings.md#railway-environment-variables).

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

Google Search Console uses Vercel's team OIDC issuer. Google Cloud trusts only
`owner:<Vercel team>:project:alethical-web:environment:production`. The dedicated service
account has no Google Cloud project role. It has only Workload Identity User for that exact
Vercel identity and Restricted access to the `sc-domain:alethical.com` Search Console
property. Do not create a JSON key or enable Google Workspace domain-wide delegation.

### Frontend browser boundaries

The `Content-Security-Policy` in `vercel.json` starts with everything blocked and
opens only the connections the shipped website uses:

- Alethical's own files and API at `api.alethical.com`
- Supabase sign-in at `naakzorbkqqgbsreulqi.supabase.co`
- Cloudflare's page-speed program at `static.cloudflareinsights.com` and its measurement
  receiver at `cloudflareinsights.com`
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

The complete intended Vercel variable-name and release-target list lives in
[`repo-and-service-settings.md` § Vercel environment variables](repo-and-service-settings.md#vercel-environment-variables).
Keep values only in Vercel, never in this repository.

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

The complete intended site and redirect address list lives in
[`repo-and-service-settings.md` § Supabase sign-in](repo-and-service-settings.md#supabase-sign-in).

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
