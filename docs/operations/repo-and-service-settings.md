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

| Setting                             | Intended           | Why                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility                          | **Public**         | Everything committed is world-readable. Vet screenshots and fixtures before committing.                                                                                                                                                                                                                                                                                                                                |
| Dependabot alerts                   | **On**             | Off for the project's whole life until July 2026; 70 alerts had accumulated unseen.                                                                                                                                                                                                                                                                                                                                    |
| Dependabot automatic security fixes | **On**             | Off Jul 28 2026 after it opened nine unreviewed PRs in four minutes, one a major `starlette` bump under the API. Back on the same day once its prerequisite was met: the `applies-to: security-updates` groups now in `.github/dependabot.yml` make a batch arrive as one reviewable PR per ecosystem, and the 70-alert backlog it fired into is cleared. Nothing self-merges — CI must pass and a human still merges. |
| Secret scanning                     | **On**             | Free on public repos. A leaked key in history would otherwise go unnoticed. First scan found nothing.                                                                                                                                                                                                                                                                                                                  |
| Secret scanning push protection     | **On**             | Blocks a secret at push time, rather than reporting it after it is already public.                                                                                                                                                                                                                                                                                                                                     |
| Secret scanning validity checks     | Off                | Attempted 2026-07-28; the API accepted the request but the value stayed `disabled`. Unresolved, low value: it only checks whether a found secret is still live.                                                                                                                                                                                                                                                        |
| Allow squash merge                  | **On**             | The only merge style this project uses.                                                                                                                                                                                                                                                                                                                                                                                |
| Allow merge commits                 | **Off**            | Every convention we have says squash; the setting used to permit the other two anyway.                                                                                                                                                                                                                                                                                                                                 |
| Allow rebase merge                  | **Off**            | Same.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Automatically delete head branches  | **On**             | Keeps merged branches from accumulating across parallel sessions.                                                                                                                                                                                                                                                                                                                                                      |
| Branch protection on `main`         | **On** — see below | A direct push would otherwise deploy the API, deploy the web app, and run production migrations with no checks run.                                                                                                                                                                                                                                                                                                    |

### Branch protection on `main`

Enabled 2026-07-28. Every value is deliberate, and three of them are load-bearing in
ways that are easy to undo by accident:

| Setting                            | Value                                              | Why this value                                                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Require a pull request             | yes                                                | Closes the direct-push path described above.                                                                                                                                                                                |
| Required approving reviews         | **0**                                              | Load-bearing. Sessions merge their own low-risk PRs under the standing autonomy grant in `.claude/rules/workflow.md` rule 10. Requiring even one approval would block every one of them, since there is no second reviewer. |
| Required status checks             | `changes`, `doc-references`, `backend`, `frontend` | The four internal jobs from `ci.yml`.                                                                                                                                                                                       |
| Strict (branch must be up to date) | **off**                                            | Load-bearing. On, every PR would need a rebase onto the newest `main` before merging, which with many concurrent sessions means constant rebase churn.                                                                      |
| Enforce for admins                 | **off**                                            | Leaves an emergency path and avoids locking the owner out of the repo.                                                                                                                                                      |
| Force pushes / branch deletion     | blocked                                            |                                                                                                                                                                                                                             |

**Why required checks don't deadlock docs-only PRs.** `ci.yml`'s `backend` and
`frontend` jobs are path-filtered and correctly report `skipped` on unrelated changes.
GitHub counts a required check as satisfied on `successful`, `skipped`, **or**
`neutral`, so a skip passes. This works only because `ci.yml` has **no
workflow-level `paths:` filter** — it runs on every PR and filters per job, so every
check always reports. If a future change adds a `paths:` filter to the `on:` block,
the workflow would stop running entirely on unrelated PRs, the required checks would
never report, and every such PR would block forever. Filter by job, never by
workflow, for anything listed as a required check above.

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

**This file is checked, not trusted.** `scripts/check_repo_settings.py` reads the
intended value out of the tables above and compares each one against the live API.
`.github/workflows/repo-settings-drift.yml` runs it on **every pull request**, on
every push to `main`, and monthly as a backstop.

So the tables are the source of truth in a literal sense: change a setting without
changing its row and the next PR goes red, naming the setting, what the doc claims,
and what the live value actually is. Run it yourself any time:

```bash
GH_TOKEN=$(gh auth token) python3 scripts/check_repo_settings.py
```

**Why every PR and not just monthly.** A monthly-only check leaves up to a month of
silent drift, and it prompts the wrong person — whoever happens to open the repo
weeks later, rather than the session that made the change while the reason is still
in their head. Running on every PR means a setting change and its row land together.
The monthly run only exists to catch a setting changed straight in the GitHub UI,
where there is no PR to check.

**It is deliberately not a required status check.** Drift is caused by whoever
changed a setting; blocking an unrelated PR would punish the wrong session. It goes
red visibly instead.

**Unverified is not the same as passing.** The default token GitHub Actions provides
has no administration scope, so the security rows and branch protection come back as
`UNVERIFIED` and are reported and counted, never quietly treated as fine. Adding a
`REPO_SETTINGS_TOKEN` secret — a fine-grained personal access token with
`administration:read` on this repo — makes those rows checkable too. Everything else
is checked either way.

Two habits still matter, because no script covers them:

- **Add a row when you add a setting.** The check can only compare what is written
  down; a setting with no row is invisible to it.
- **When a Dependabot bump PR arrives** (monthly, grouped), you are already in the
  right context — read this table then. `CONTRIBUTING.md` § "Keeping the workflow
  actions current" says the same from the other direction.
