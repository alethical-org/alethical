<!-- describes: apps/frontend/public/index.html, apps/frontend/App.tsx, apps/frontend/src/components/AppErrorBoundary.tsx, apps/frontend/src/data/api.ts, apps/frontend/src/hooks/useAppQueries.ts, apps/frontend/src/lib/authRestore.ts, apps/frontend/src/lib/publicRead.ts, apps/frontend/src/providers/AuthProvider.tsx, api/social-preview.ts, vercel.json -->

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
cannot ship. On Aug 6 2026 the push-triggered frontend deploy for
[#1116](https://github.com/alethical-org/alethical/pull/1116) was never created at
all, the one for [#1112](https://github.com/alethical-org/alethical/pull/1112)
queued 46 minutes and was killed before running a step, and alethical.com quietly
served a six-hour-old build until someone re-dispatched the workflow by hand.

### How often, and for how long

GitHub's status feed lists **13 incidents whose affected-components list includes
Actions, between Jun 8 and Aug 6 2026** — Jun 8, Jun 25, Jul 7, 9, 13, 19, 22, 23,
24, 25 (twice), 29, and Aug 6. That is the whole rule: any incident GitHub tagged
as affecting Actions, regardless of what its title says. Five were rated `critical`.

**"13 incidents affected Actions" is not "13 times we could not ship."** Several
only slowed a fraction of jobs, and one is titled for signed-out Pull Requests.
Overstating this is as unhelpful as calling it rare, because it invites someone to
check the feed once and discount the whole argument.

Duration is the part that decides how to react. Of the 12 resolved incidents:

| | |
| --- | --- |
| Median | 1h21m |
| Ended within 2h03m | 10 of 12 |
| The 2 long ones | 5h09m (Jul 19) and 9h17m (Jul 9) |
| Aug 6 | 6h55m at GitHub's last update, second-longest in the sample |

So the common case resolves inside about 2 hours, and the tail is real.

### Which means: wait, unless it is urgent

- **Routine changes: wait.** Wait for GitHub to mark the incident resolved, then
  confirm with one test release before merging a queue of work. Manual releases
  during an outage cost more in care than the wait costs in delay.
- **An urgent production fix: do not wait.** Use the fallback below immediately.
  Estimating an outage's remaining length off a sample of 12 is not a basis for
  making a broken production wait.

### What to hold, and what not to replay

**Hold merges whose services have no proven path to production.** A finished change
should sit in its pull request, with its owning task open and reporting "ready, not
live", rather than merging into a `main` that cannot reach production. That is a
narrower rule than "stop merging": a docs-only change is unaffected.

**If work already merged, publish only the newest reviewed commit, never replay the
missed ones.** Each release supersedes the last, so replaying is pure risk. Order,
when more than one service is involved: database update, then API, then frontend
last if it needs the new API.

**Before any manual or provider release, cancel that service's older queued Actions
runs.** A queued run can start hours later, finish after yours, and put the older
commit back into production. `scripts/deploy-reviewed-commit.sh` refuses to run
while any exist rather than trusting you to remember. After GitHub recovers, run
one release for the newest commit, not one per missed commit.

### The fallback

**Nothing about the deploys requires Actions.** Both workflows just run the
provider's own CLI, so the same deploy runs from a laptop. Use the script, not
loose commands:

```bash
scripts/deploy-reviewed-commit.sh frontend <40-char-commit-sha>
scripts/deploy-reviewed-commit.sh backend  <40-char-commit-sha>
```

It fetches that exact commit into a fresh temporary directory, **refuses any commit
that is not an ancestor of `origin/main`**, refuses a dirty tree, names the provider
account, project, service and environment explicitly, pins both CLI versions, and
passes the source directory to the CLI as an argument. Every one of those replaces a
way the loose commands could publish something unreviewed: the earlier version of
this section told you to clone into a fixed path and then ran `vercel deploy` with
no `cd`, which deploys whatever directory you happened to be standing in.

Its guards are tested: a branch name, a short SHA, and a real-but-unmerged commit
are each refused, and a merged commit passes. The queued-run refusal is the one
branch not exercised against a live queued run.

State of each half as of Aug 6 2026:

- **Frontend (Vercel): works.** The laptop is signed in as `alethical-dev` on the
  `alethical` scope, project `alethical-web`.
- **Backend (Railway): does not.** `railway whoami` returns `Unauthorized`, so the
  backend has no path to production except Actions. Restore it with a **project
  token scoped to this project and the `production` environment**, exported as
  `RAILWAY_TOKEN`. Not a browser login (`railway login`) — that lives on one laptop
  and expires, so it is not a fallback anyone else can use. `railway up` has no
  `--project` flag (checked on CLI 4.5.3), which is the other reason the token has
  to carry the project.

**Prefer Vercel's dashboard rebuild of an exact commit over the script** when
GitHub's Git hosting is up: it builds from the repository rather than from files on
a laptop. Keep the script for a wider outage where Vercel cannot reach GitHub either.

**A laptop upload may not carry the provider's Git metadata**, so the deployed build
can end up not knowing which commit it is. Pass the reviewed commit into the build
yourself and have both services report it
([#1122](https://github.com/alethical-org/alethical/issues/1122)). Removing the
Vercel author rewrite helps but does not solve this on its own.

**After any manual release, read the live commit back and exercise one real page and
one real API request.** A command that exits 0 means the provider accepted an
upload, not that the right code reached users.

### Migrations: order matters and nothing enforces it

Apply the migration first, or the API looks for a column that is not there.

```bash
ALETHICAL_DATABASE_TARGET=production uv run alembic upgrade head
```

`migrate.yml` and `railway-deploy.yml` are separate workflows both triggered by the
same push, with no `needs:` between them (separate workflows cannot depend on each
other), so they start in parallel. The migration usually wins because Alembic takes
seconds and a Railway build takes minutes, but that is a timing accident.

**Additive-only migrations do not make this safe, and reading them as a safety net
is the trap.** Additive-only (`.claude/rules/workflow.md` rule 10) means *old* code
survives a *newer* database, because an unused extra column harms nothing. It says
nothing about the direction that actually happens here: *new* code against an
*older* database, which errors. And the exposure is not brief. Aug 6 2026 is the
proof: a Railway deploy can succeed while the migration workflow is never created at
all, in which case the new code queries a missing column until somebody notices.
Tracked in [#1124](https://github.com/alethical-org/alethical/issues/1124), with the
fix being Railway's own `preDeployCommand` so a failed migration keeps the old API
serving.

### Why we route through Actions anyway

So nobody removes it as redundant: it scopes each deploy by path so a docs-only
commit does not rebuild the site, and it keeps every production credential in one
place instead of two provider dashboards.

It also rewrites the deployed commit's author (`VERCEL_GIT_AUTHOR_NAME`), and that
step is **probably obsolete**. Both the workflow and the settings doc described it
as a Hobby-plan requirement; **we are on Vercel Pro**, where the restriction it
worked around does not apply. Worth removing rather than leaving alone, because the
rewrite means the deployed source's commit hash is not the hash on `main`, which
quietly breaks any "which commit is live?" check. Do not delete it untested — verify
with one deploy of the already-live commit first.

### The provider integrations, and what is already connected

**Vercel is already linked to GitHub.** It built 6 preview deployments during this
outage, including one for [#1123](https://github.com/alethical-org/alethical/pull/1123),
and posts a check on every pull request. So the work is to enable and test
**production** releases from `main`, not to connect Vercel from scratch.

**Do not claim provider releases "would have kept working" on Aug 6.** GitHub
reported delayed outgoing messages during this incident, and a provider's Git
integration depends on GitHub delivering the commit notice. The accurate claim: they
would likely have avoided the broken job runner, while still depending on GitHub for
the notice. Three of the 13 incidents degraded **Webhooks** directly.

This route is only open to us because we pay: Vercel's own limits page states a
**Hobby** team cannot connect a project to a repository owned by a Git organization,
and `alethical-org` is exactly that. We are on **Pro**. Tracked as
[#1125](https://github.com/alethical-org/alethical/issues/1125).

The cost is smaller than it first looks, because most of what would appear to move
into a dashboard can stay in the repo: `vercel.json` takes the skip rule
(`ignoreCommand`) and `railway.json` takes the watched paths (`watchPatterns`) and
the before-deploy migration (`preDeployCommand`). What genuinely cannot move is the
linked repository, the production branch, the automatic-deploy switch, the domains,
and the credentials — and note that
[#703](https://github.com/alethical-org/alethical/pull/703)'s drift check reads
**GitHub settings only** (`api.github.com`), so covering those five needs it
extended or a second check written. Ordering is not a cost of switching, because we
do not have it either way.

### The gap none of this closes

A deploy that fails, is cancelled, or is never created still tells nobody. That is
[#1122](https://github.com/alethical-org/alethical/issues/1122), and it is the
highest-value item here because every other protection on this page depends on
somebody noticing. Two things it has to get right, both learned the hard way on
Aug 6: the alert cannot be a GitHub issue alone, because an issue wakes nobody; and
it must compare each service against the newest `main` commit touching **that
service's** paths, not against `main`'s tip, or a docs-only merge makes the web app
look stale and the alarm gets muted.

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
