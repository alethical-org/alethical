# Deployment

Alethical deploys as two services:

- Frontend: Expo web static export on Vercel.
- Backend: FastAPI web service on Railway.

## Workflows at a glance

Seven GitHub Actions workflows in `.github/workflows/`. Which ones a PR can prove
matters: five of them never run on a PR, so a change to them is only verified
after merge.

| Workflow                 | Runs when                                                                  | Does                                                                                   | Provable on a PR?                |
| ------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------- |
| `ci.yml`                 | every PR, and pushes to `main`                                             | Backend and frontend checks, plus doc references                                       | Yes                              |
| `migrate.yml`            | push to `main` touching migrations, models, `alembic.ini`, deps, or itself | Applies Alembic migrations to the production database; opens an alert issue on failure | No                               |
| `railway-deploy.yml`     | push to `main` touching backend paths or itself                            | Deploys the API to Railway production                                                  | No                               |
| `vercel-deploy.yml`      | push to `main` touching frontend paths or itself                           | Deploys the web frontend to Vercel production                                          | No                               |
| `vote-backfill.yml`      | daily at 09:00 UTC, or by hand                                             | Pulls newly recorded roll-call votes into production                                   | No — dispatch it by hand to test |
| `bill-section-gaps.yml`  | daily at 11:00 UTC, or by hand                                             | Read-only check that no bill is missing sections its page published; opens an alert issue | No — dispatch it by hand to test |
| `rag-coverage-gaps.yml`  | daily at 12:00 UTC, or by hand                                             | Read-only check that no stored bill is missing its search embeddings; opens an alert issue | No — dispatch it by hand to test |

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

## Deploying when GitHub Actions is down

Every production path above runs on GitHub Actions, so when Actions stops, we
cannot ship. This is not hypothetical: on Aug 6 2026 GitHub ran a `major_outage`
on Actions for hours, the push-triggered frontend deploy for
[#1116](https://github.com/alethical-org/alethical/pull/1116) was never created at
all, the one for [#1112](https://github.com/alethical-org/alethical/pull/1112)
queued 46 minutes and was killed before running a step, and alethical.com quietly
served a six-hour-old build until someone re-dispatched the workflow by hand.

**Nor is it rare, which is the part worth writing down.** GitHub's own status feed
lists **12 Actions-affecting incidents between Jun 6 and Aug 6 2026**, 9 of them in
July: Jul 7, 9, 13, 19, 22, 23, 24, 25 (twice) and 29, then Aug 6. Four were rated
`critical`. Anyone reasoning from a single outage will call this a rare event and
under-invest; the feed says it is closer to weekly. Three of the 12 also degraded
**Webhooks**, which matters because a provider's own Git integration depends on
GitHub's push notice — so moving off Actions shrinks this exposure without removing
it.

**Nothing about the deploys requires Actions.** Both workflows just run the
provider's own CLI, so the same deploy runs from a laptop. Deploy from a clean
checkout of `origin/main`, never from a worktree with local edits, or you publish
unreviewed code:

```bash
git -C /tmp clone --depth 1 https://github.com/alethical-org/alethical.git alethical-deploy
```

Frontend (Vercel), verified working Aug 6 2026 — the laptop login is
`alethical-dev` on the `alethical` scope, project `alethical-web`:

```bash
vercel deploy --prod --yes --archive=tgz --scope alethical
```

Backend (Railway) — **this fallback does not work today.** `railway whoami`
returns `Unauthorized`, so the backend has no path to production except Actions.
Restoring it needs a browser sign-in only Eugene can complete (`railway login`),
after which:

```bash
railway up --ci --service alethical-api --environment production
```

Order matters when a migration is involved: apply it first, or the API looks for a
column that is not there.

```bash
ALETHICAL_DATABASE_TARGET=production uv run alembic upgrade head
```

**Nothing enforces that order automatically, including today.** `migrate.yml` and
`railway-deploy.yml` are separate workflows both triggered by the same push, with
no `needs:` between them (separate workflows cannot depend on each other), so they
start in parallel. The migration usually wins because Alembic takes seconds and a
Railway build takes minutes, but that is a timing accident, not a guarantee.

**Additive-only migrations do not make this safe, and reading them as a safety net
is the trap.** Additive-only (`.claude/rules/workflow.md` rule 10) means *old* code
survives a *newer* database, because an unused extra column harms nothing. It says
nothing about the direction that actually happens here: *new* code against an
*older* database, which errors on a column that is not there. And the exposure is
not brief. Aug 6 2026 is the proof — a Railway deploy can succeed while the
migration workflow is never created at all, in which case the new code queries a
missing column until somebody notices and applies the migration by hand. Tracked in
[#1124](https://github.com/alethical-org/alethical/issues/1124), with the fix being
Railway's own `preDeployCommand` so a failed migration keeps the old API serving.

**Why we route through Actions anyway**, so nobody removes it as redundant: it
scopes each deploy by path so a docs-only commit does not rebuild the site, and it
keeps every production credential in one place instead of two provider dashboards.

It also rewrites the deployed commit's author (`VERCEL_GIT_AUTHOR_NAME`), and that
step is **probably obsolete**. Both the workflow and the settings doc described it
as a Hobby-plan requirement; **we are on Vercel Pro**, where the restriction it
worked around does not apply. Worth removing rather than leaving alone, because the
rewrite means the deployed source's commit hash is not the hash that is on `main`,
which quietly breaks any "which commit is live?" check
([#1122](https://github.com/alethical-org/alethical/issues/1122)). Do not delete it
untested — verify with one laptop deploy of the already-live commit first.

**The provider integrations are the real alternative, and they are only available
to us because we pay for both services.** Vercel and Railway can each watch the
repository and deploy on push with no Actions involved, and on Aug 6 that would
have kept working: GitHub's code hosting, webhooks and API all stayed `operational`
and only Actions and Pages broke. On Vercel's **Hobby** plan this route does not
exist at all — its own limits page states a Hobby team cannot connect a project to
a repository owned by a Git organization, and `alethical-org` is exactly that. We
are on **Pro**, so it is open to us. Tracked as
[#1125](https://github.com/alethical-org/alethical/issues/1125).

The cost is smaller than it first looks, because most of what would appear to move
into a dashboard can stay in the repo: `vercel.json` takes the skip rule
(`ignoreCommand`) and `railway.json` takes the watched paths (`watchPatterns`) and
the before-deploy migration (`preDeployCommand`). What genuinely cannot move is the
linked repository, the production branch, the automatic-deploy switch, the domains,
and the credentials. Ordering is not a cost of switching, because we do not have it
either way.

A failed or cancelled deploy still tells nobody — that gap is
[#1122](https://github.com/alethical-org/alethical/issues/1122).

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
