<!-- describes: apps/frontend/public/index.html, apps/frontend/App.tsx, apps/frontend/src/components/AppErrorBoundary.tsx, apps/frontend/src/data/api.ts, apps/frontend/src/hooks/useAppQueries.ts, apps/frontend/src/lib/authRestore.ts, apps/frontend/src/lib/publicRead.ts, apps/frontend/src/providers/AuthProvider.tsx, api/social-preview.ts, vercel.json -->

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
ALETHICAL_EMAIL_ENABLED=true
ALETHICAL_EMAIL_TRANSPORT=resend
ALETHICAL_EMAIL_FROM=Alethical <ask@alethical.com>
RESEND_API_KEY=re_...
ALETHICAL_CONTACT_RATE_PER_MIN=5
```

Contact us stays safely unavailable unless the live switch, `resend` transport, and
provider key are all present. Before enabling it, verify `alethical.com` in Resend and
add the SPF and DKIM records Resend supplies without removing the existing Google
Workspace records. Keep `ALETHICAL_EMAIL_ALLOWLIST` unset for public launch; setting it
restricts both `ask@alethical.com` and the writer's copy to named addresses.

On Resend's free plan, each accepted contact message checks the daily and monthly totals.
Alethical emails `ask@alethical.com` once at 80%, 90%, and 95% of either limit. The warning
points reset when usage resets and stop automatically after the plan is upgraded.

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
- crawler-only bill, legislator, and Ask preview-card rewrites to `api/social-preview.ts`
- the normal SPA rewrite to `index.html` for readers

The preview function reads only the public bill or legislator fields needed for the card
and returns its title, description, canonical URL, and branded 1200×630 image. Ask cards
use the public question plus fixed cited-answer copy and do not call a model. See
`docs/product-onboarding/sharing-guide.md` for the page and destination rules.

Required Vercel environment variables:

```bash
EXPO_PUBLIC_API_URL=https://alethical-api-production.up.railway.app
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

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

## Can an unconfirmed account sign in?

**Status: answered 6 August 2026. The guard is real insurance, not bypassable.** Email
sign-in *is* enabled, and confirmation *is* required, so an unproven address never arrives
looking proven. No action needed.

**And the answer did not need the dashboard.** Supabase publishes these settings on a
read-only endpoint, reachable with the publishable key that already ships in every
visitor's browser, so anyone can re-check it in one command with no login:

```bash
curl -s https://naakzorbkqqgbsreulqi.supabase.co/auth/v1/settings \
  -H "apikey: $(curl -s https://www.alethical.com/$(curl -s https://www.alethical.com/ \
  | grep -oE '_expo/static/js/web/index-[a-f0-9]+\.js' | head -1) \
  | grep -oE 'sb_publishable_[A-Za-z0-9_-]+' | head -1)"
```

Read on 6 August 2026:

| Field | Value | What it means |
|---|---|---|
| `external.email` | `true` | Email sign-in is on, so the unconfirmed path is reachable and the guard has something to do. |
| **`mailer_autoconfirm`** | **`false`** | **Confirmation is required.** Supabase does not stamp an address as confirmed on its own. |
| `external.google` | `true` | Google sign-in on, as expected. |
| `external.phone`, `phone_autoconfirm` | `false` | Phone sign-in is off, so the `phone_confirmed_at` leak [#1039](https://github.com/alethical-org/alethical/issues/1039) closed was not reachable in production. Closing it is still correct: the setting can be turned on later. |
| `external.anonymous_users` | `false` | No anonymous sign-in. |
| `disable_signup` | `false` | New sign-ups allowed. |

One honest limit on that reading: `mailer_autoconfirm: false` maps to "Confirm email is on"
by Supabase's naming, where `mailer_autoconfirm: true` is the auto-confirm-without-checking
mode. That mapping is read from the field name and the dashboard label, not proved by
signing up with an unconfirmed address, which would mean creating an account in production.
If anyone wants it proved rather than read, that is the test, and it needs a throwaway
address and Eugene's say-so.

The dashboard walkthrough below is kept as the way to *change* the setting, and as a
cross-check if the endpoint above ever disagrees with it.

**Why it was worth knowing.** The backend joins a new sign-in to an existing account when
the email addresses match, which is how one person with two sign-in methods keeps one
account. Since [#1039](https://github.com/alethical-org/alethical/issues/1039) that join
requires the sign-in service to have *confirmed* the address, so an unconfirmed one now
gets its own separate account instead. That guard is in place either way. This setting
only decided how often it has anything to do: if unconfirmed accounts cannot get in at
all, it never fires; if they can, it is the thing standing between a stranger and someone
else's tracked bills and typed questions.

**How to check it** (Supabase dashboard, project `naakzorbkqqgbsreulqi`):

1. Open [supabase.com/dashboard](https://supabase.com/dashboard) and pick the Alethical project.
2. In the left sidebar click **Authentication**.
3. Click **Sign In / Providers**.
4. Look at the **Email** provider. Note whether it is **enabled** at all — if it is off,
   nobody can create an email-and-password account and the question is moot.
5. If it is enabled, open it and note whether **Confirm email** is on or off.
6. Still under Authentication, open **Emails** (or **Email Templates**) and note whether
   anything there turns confirmation off.

**How to read what you find.** *Email provider off* means no unconfirmed account can
exist, so the guard is pure insurance. *Email provider on with "Confirm email" on* means
an unconfirmed sign-up is blocked at Supabase and never reaches us. *Email provider on
with "Confirm email" off* is the one that matters: Supabase marks every new sign-up
confirmed without checking, so an address nobody proved arrives looking proven, and the
guard cannot tell the difference. In that last case turn confirmation on.

## iOS Builds

> **Not shipped.** The web app is the client that ships today (see `docs/product-onboarding/product-scope.md` § Frontend Scope).
> This workflow covers the native iOS client ([#91](https://github.com/alethical-org/alethical/issues/91), not built yet) plus the simulator/TestFlight QA that works now.

The iOS workflow uses Expo EAS from `apps/frontend`. Local QA without an iPhone uses an iOS Simulator build; sharing with testers uses TestFlight after Apple Developer Program access is available.

See `docs/operations/ios-release.md` for the full simulator, TestFlight, and ad hoc distribution workflow.
