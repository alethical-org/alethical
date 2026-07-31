# Deployment

Alethical deploys as two services:

- Frontend: Expo web static export on Vercel.
- Backend: FastAPI web service on Railway.

## Workflows at a glance

Six GitHub Actions workflows in `.github/workflows/`. Which ones a PR can prove
matters: four of them never run on a PR, so a change to them is only verified
after merge.

| Workflow                | Runs when                                                                  | Does                                                                                   | Provable on a PR?                |
| ----------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------- |
| `ci.yml`                | every PR, and pushes to `main`                                             | Backend and frontend checks, plus doc references                                       | Yes                              |
| `migrate.yml`           | push to `main` touching migrations, models, `alembic.ini`, deps, or itself | Applies Alembic migrations to the production database; opens an alert issue on failure | No                               |
| `railway-deploy.yml`    | push to `main` touching backend paths or itself                            | Deploys the API to Railway production                                                  | No                               |
| `vercel-deploy.yml`     | push to `main` touching frontend paths or itself                           | Deploys the web frontend to Vercel production                                          | No                               |
| `vote-backfill.yml`     | daily at 09:00 UTC, or by hand                                             | Pulls newly recorded roll-call votes into production                                   | No — dispatch it by hand to test |
| `bill-section-gaps.yml` | daily at 11:00 UTC, or by hand                                             | Read-only check that no bill is missing sections its page published; opens an alert issue | No — dispatch it by hand to test |

`bill-section-gaps.yml` is a schedule rather than a PR check for a structural
reason: the damage it looks for is created by an **ingest**, and ingests are
triggered by hand from a laptop, so no PR can be running when one happens. A bill
ingested by a run that started before a pipeline fix merged banks the old bug
silently — which is what happened to the 2025 special session on Jul 30 2026,
ingested hours before [#763](https://github.com/alethical-org/alethical/issues/763)'s
fix landed. It costs one query, and it files an issue only when a gap exists,
commenting on the open one rather than filing a second.

Each of the three deploy/migrate workflows lists its own file in its `push`
paths, so changing one of them triggers it on merge. That is the intended
post-merge verification. For why the borrowed steps inside them need periodic
bumping, see [`CONTRIBUTING.md`](../../CONTRIBUTING.md) § "Keeping the workflow
actions current".

## Backend on Railway

Use the repository `railway.json` config from the repo root. It configures a service named `alethical-api` using the RAILPACK builder, with a healthcheck against `/healthz` and an automatic restart policy.

Deploys run automatically via the `.github/workflows/railway-deploy.yml` GitHub Actions workflow, which uses the `@railway/cli` to deploy to the `production` environment on every push to `main` that touches `railway.json`, `alethical/**`, or related paths. `.railwayignore` excludes `apps/frontend`, `docs`, and other paths that aren't part of the backend build.

Required Railway environment variables:

```bash
DATABASE_URL=postgresql://...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
ALETHICAL_CORS_ORIGINS=https://your-vercel-domain.vercel.app,http://localhost:8081,http://127.0.0.1:8081,http://localhost:19006,http://127.0.0.1:19006
```

The build installs dependencies with:

```bash
uv sync --frozen
```

The start command applies Alembic migrations and then starts Uvicorn:

```bash
uv run python -m alembic -c alembic.ini upgrade head && uv run uvicorn alethical.api.main:create_app --factory --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'
```

After deployment, verify:

```bash
curl https://alethical-api-production.up.railway.app/healthz
```

## Frontend on Vercel

Create the Vercel project from the repository root so the root `pnpm-lock.yaml` is available. The repo-root `vercel.json` configures:

- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm --dir apps/frontend run build`
- Output directory: `apps/frontend/dist`
- SPA rewrites to `index.html`

Required Vercel environment variables:

```bash
EXPO_PUBLIC_API_URL=https://alethical-api-production.up.railway.app
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

After Vercel assigns the production domain, update Railway's `ALETHICAL_CORS_ORIGINS` with that exact Vercel origin and redeploy the backend.

## Supabase Auth URLs

In Supabase Authentication > URL Configuration, set the production site URL to the Vercel URL and include these redirect URLs:

```text
https://your-vercel-domain.vercel.app/**
http://localhost:8081/**
http://127.0.0.1:8081/**
http://localhost:19006/**
http://127.0.0.1:19006/**
alethical://auth/callback
```

## iOS Builds

> **Not shipped.** The web app is the client that ships today (see `docs/product-onboarding/product-scope.md` § Frontend Scope).
> This workflow covers the native iOS client ([#91](https://github.com/alethical-org/alethical/issues/91), not built yet) plus the simulator/TestFlight QA that works now.

The iOS workflow uses Expo EAS from `apps/frontend`. Local QA without an iPhone uses an iOS Simulator build; sharing with testers uses TestFlight after Apple Developer Program access is available.

See `docs/operations/ios-release.md` for the full simulator, TestFlight, and ad hoc distribution workflow.
