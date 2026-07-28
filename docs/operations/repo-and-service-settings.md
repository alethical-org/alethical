# Repo and service settings

Every setting that controls this project but does not live in the repo. Nothing here
can be caught by `grep`, a test, or CI, so this file is the only record of what the
value is _supposed_ to be.

**Why it exists.** In July 2026, Dependabot alerts were found switched off for the
project's entire life. Nothing had ever scanned our dependencies, and the first scan
returned 70 open alerts ([#691](https://github.com/alethical-org/alethical/issues/691)).
The switch being off was not the whole bug — the bug was that **there was no way to
tell "off" from "deliberately off,"** because no artifact stated the intent. The same
check turned up `main` with no branch protection and secret scanning disabled on a
public repo. A stated intended value is what makes the next drift visible.

**Scope.** Values and intent only. Secrets are named here, never their contents.
Settings already documented elsewhere are linked, not copied, so there is one truth
per setting.

## GitHub repository

Set under **Settings** on `github.com/alethical-org/alethical`. Verified 2026-07-28.

| Setting                             | Intended             | Why                                                                                                                                                                                                                                                   |
| ----------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility                          | **Public**           | Everything committed is world-readable. Vet screenshots and fixtures before committing.                                                                                                                                                               |
| Dependabot alerts                   | **On**               | Off for the project's whole life until July 2026; 70 alerts had accumulated unseen.                                                                                                                                                                   |
| Dependabot automatic security fixes | **Off**              | Left on, it opened nine unreviewed PRs in four minutes, one a major `starlette` bump under the API. Prerequisite for turning it back on: an `applies-to: security-updates` group in `.github/dependabot.yml` so a batch arrives as one reviewable PR. |
| Secret scanning                     | **On**               | Free on public repos. A leaked key in history would otherwise go unnoticed. First scan found nothing.                                                                                                                                                 |
| Secret scanning push protection     | **On**               | Blocks a secret at push time, rather than reporting it after it is already public.                                                                                                                                                                    |
| Secret scanning validity checks     | Off                  | Attempted 2026-07-28; the API accepted the request but the value stayed `disabled`. Unresolved, low value: it only checks whether a found secret is still live.                                                                                       |
| Allow squash merge                  | **On**               | The only merge style this project uses.                                                                                                                                                                                                               |
| Allow merge commits                 | **Off**              | Every convention we have says squash; the setting used to permit the other two anyway.                                                                                                                                                                |
| Allow rebase merge                  | **Off**              | Same.                                                                                                                                                                                                                                                 |
| Automatically delete head branches  | **On**               | Keeps merged branches from accumulating across parallel sessions.                                                                                                                                                                                     |
| Branch protection on `main`         | **None** — see below | Not yet decided.                                                                                                                                                                                                                                      |

### Branch protection is deliberately still open

`main` has no protection rule. `CONTRIBUTING.md` § "Deployment — why PRs matter" says
to treat `main` as production and land everything through reviewed PRs, but nothing
enforces it: a direct push deploys the API, deploys the web app, and runs migrations
against the production database with no checks run.

This is recorded rather than fixed because the obvious fix has an untested
interaction. `ci.yml` uses a path filter, so the `backend` and `frontend` jobs
legitimately report `skipping` on PRs that do not touch their paths. Whether GitHub
treats a skipped required check as satisfied or as never-reported decides whether
required checks work here or deadlock every docs-only PR. Test that before enabling.

## GitHub Actions secrets

Set under **Settings → Secrets and variables → Actions**. Names and purposes only.
A missing one surfaces as a failed deploy with no obvious cause.

| Secret                                              | Used by                            | For                                                                                                   |
| --------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `SUPABASE_PROJECT_URL`                              | `migrate.yml`, `vote-backfill.yml` | Builds the production database URL, so no separate copy of the password exists to rotate out of date. |
| `SUPABASE_DB_PASSWORD`                              | `migrate.yml`, `vote-backfill.yml` | Same pair.                                                                                            |
| `RAILWAY_TOKEN`                                     | `railway-deploy.yml`               | Deploys the API.                                                                                      |
| `VERCEL_TOKEN`                                      | `vercel-deploy.yml`                | Deploys the web frontend.                                                                             |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`                | `vercel-deploy.yml`                | Targets the right Vercel project.                                                                     |
| `VERCEL_GIT_AUTHOR_NAME`, `VERCEL_GIT_AUTHOR_EMAIL` | `vercel-deploy.yml`                | Rewrites the commit author so Hobby-plan deploys are attributed correctly.                            |

## Settings documented elsewhere

Linked rather than duplicated:

- **Railway** environment variables (backend) and **Vercel** environment variables
  (frontend), plus **Supabase** auth redirect URLs — [`deployment.md`](deployment.md).
- **Cloudflare** zone configuration in front of the API, and the email
  authentication records — [`api-cdn-setup.md`](api-cdn-setup.md).

## Keeping this current

There is no timer on this, by design. Two triggers instead:

- **When you change one of these settings**, change the row in the same session. A
  row that disagrees with reality is worse than no row, because it reads as verified.
- **When a Dependabot bump PR arrives** (monthly, grouped), you are already in the
  right context — glance over this table then. That is the only recurring prompt this
  file gets, and `CONTRIBUTING.md` § "Keeping the workflow actions current" says so
  from the other direction.

The better version of this file is a script that reads the live settings and fails CI
on drift, which would make it self-enforcing rather than self-reported. The blocker is
token scope: the endpoints that matter most, including branch protection and the
Dependabot toggles, need admin rights that CI's default token does not have.
