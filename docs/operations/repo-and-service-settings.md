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

Set under **Settings** on `github.com/alethical-org/alethical`. Verified 2026-08-11.

| Setting                             | Intended           | Why                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility                          | **Public**         | Everything committed is world-readable. Vet screenshots and fixtures before committing.                                                                                                                                                                                                                                                                                                                                |
| Dependabot alerts                   | **On**             | Off for the project's whole life until July 2026; 70 alerts had accumulated unseen.                                                                                                                                                                                                                                                                                                                                    |
| Dependabot malware alerts           | **On**             | Adds free warnings when a dependency is known to contain malware.                                                                                                                                                                                                                                                                                                                                                       |
| Dependabot automatic security fixes | **On**             | Off Jul 28 2026 after it opened nine unreviewed PRs in four minutes, one a major `starlette` bump under the API. Back on the same day once its prerequisite was met: the `applies-to: security-updates` groups now in `.github/dependabot.yml` make a batch arrive as one reviewable PR per ecosystem, and the 70-alert backlog it fired into is cleared. Nothing self-merges — CI must pass and a human still merges. |
| Private vulnerability reporting     | **On**             | Lets a visitor report a security flaw privately instead of publishing the details in an issue.                                                                                                                                                                                                                                                                                                                          |
| Secret scanning                     | **On**             | Free on public repos. A leaked key in history would otherwise go unnoticed. A full-history scan on 2026-08-11 checked 1,298 revisions and about 74 MB, found 0 verified secrets, and found only package-download hashes in `uv.lock`.                                                                                                                                                                                       |
| Secret scanning push protection     | **On**             | Blocks a secret at push time, rather than reporting it after it is already public.                                                                                                                                                                                                                                                                                                                                     |
| Free secret scan in `ci.yml`         | **On**             | TruffleHog checks each PR and `main` push for confirmed live credentials and candidates it could not verify. This remains available if the repo becomes private without paid GitHub Secret Protection, but it catches a leak after the push rather than blocking the push itself.                                                                                                                                          |
| Secret scanning validity checks     | Off                | Attempted 2026-07-28; the API accepted the request but the value stayed `disabled`. Unresolved, low value: it only checks whether a found secret is still live.                                                                                                                                                                                                                                                        |
| Allow squash merge                  | **On**             | The only merge style this project uses.                                                                                                                                                                                                                                                                                                                                                                                |
| Allow merge commits                 | **Off**            | Every convention we have says squash; the setting used to permit the other two anyway.                                                                                                                                                                                                                                                                                                                                 |
| Allow rebase merge                  | **Off**            | Same.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Automatically delete head branches  | **On**             | Keeps merged branches from accumulating across parallel sessions.                                                                                                                                                                                                                                                                                                                                                      |
| Branch protection on `main`         | **On** — see below | A direct push would otherwise deploy the API, deploy the web app, and run production migrations with no checks run.                                                                                                                                                                                                                                                                                                    |
| Organization two-step login requirement | **Off until 2 collaborators enroll** | Turning it on now would immediately remove `joelethical` and `Myahmyahmeow-cat`, the 2 outside collaborators who have not enabled it. All 3 organization members and outside collaborator `TheRoyalTnetennba` have enabled it. |

### Branch protection on `main`

Enabled 2026-07-28. Every value is deliberate, and three of them are load-bearing in
ways that are easy to undo by accident:

| Setting | Value | Why this value |
| --- | --- | --- |
| Require a pull request | yes | Closes the direct-push path described above. |
| Required approving reviews | **0** | Sessions can merge their own low-risk PRs under the standing autonomy grant in `.claude/rules/workflow.md` rule 10. |
| Required Code Owner review | **no** | `.github/CODEOWNERS` still asks both owners to review sensitive files. Making that review mandatory today would leave `jfleish` as the only possible approver, and that account has reviewed 0 past PRs. Turn this on only after a second owner commits to reviewing releases. |
| Dismiss old approvals after a new push | **no** | A required current branch can change after review. Erasing the approval each time would create a repeat-review loop. |
| Required status checks | `changes`, `backend`, `frontend` | The 3 internal jobs from `ci.yml`. `changes` also runs the documentation checks. |
| Strict (branch must be up to date) | **on** | Every merge is tested with the current `main`, closing the stale-green gap that caused the production break recorded in `.claude/rules/workflow.md` rule 10. |
| Resolve review conversations | **on** | A change cannot merge while an open review finding remains unanswered. |
| Enforce for admins | **on** | Owners cannot skip a failed check or the pull-request path. |
| Force pushes / branch deletion | blocked | |

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

| Secret | Used by | For |
| --- | --- | --- |
| `SUPABASE_PROJECT_URL`                              | `migrate.yml`, `vote-backfill.yml`, `bill-section-gaps.yml` | Builds the production database URL, so no separate copy of the password exists to rotate out of date. |
| `SUPABASE_DB_PASSWORD`                              | `migrate.yml`, `vote-backfill.yml`, `bill-section-gaps.yml` | Same pair.                                                                                            |
| `RAILWAY_TOKEN`                                     | `railway-deploy.yml`               | Deploys the API.                                                                                      |
| `VERCEL_TOKEN`                                      | `vercel-deploy.yml`                | Runs the manual frontend-release fallback.                                                            |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`                | `vercel-deploy.yml`                | Targets the right Vercel project during that fallback.                                                |

Removed 2026-08-11: unused `DATABASE_URL` and `RAILWAY_API_TOKEN` copies, plus
the 2 fake-author values after the manual Vercel fallback was proven live.

## Vercel project

Set under **Settings** for the `alethical-web` project. Verified 2026-08-11.

<!-- prettier-ignore -->
| Setting | Intended | Why |
| --- | --- | --- |
| Root Directory | `.` | The build, both server functions, and the live `vercel.json` start at the repository root. |
| Git repository | `alethical-org/alethical`, production branch `main`, automatic releases **on** | Vercel's Git connection is the single normal frontend release path. The GitHub workflow is a manual fallback only. |
| Ignored Build Step | The `ignoreCommand` in `vercel.json` | Documentation-only and backend-only changes stop before the paid build. Frontend, web-function, package, lock-file, and Vercel-setting changes still build. |
| Deployment Protection | Vercel Authentication on every deployment except custom production domains (`all_except_custom_domains`) | Preview addresses stay private while `www.alethical.com` stays public. |
| Protection Bypass for Automation | **On**, exposed to deployments as `VERCEL_AUTOMATION_BYPASS_SECRET` | Signed-in automated checks can reach protected previews. The site does not use this secret to serve pages: `api/page.ts` reads its bundled `index.html`, so a missing bypass cannot turn every preview page into an outage response. |

Verified 2026-08-11 on merge
[`abba347`](https://github.com/alethical-org/alethical/commit/abba3473bb551d439b0f83895437516f91332e19):
Vercel made exactly 1 automatic production release through its Git connection,
with Eugene's real verified author, and GitHub started 0 automatic Vercel jobs.
Hand-run fallback
[#473](https://github.com/alethical-org/alethical/actions/runs/31540230081)
then released the same commit successfully without the old fake author. The 2
`VERCEL_GIT_AUTHOR_*` secrets were deleted after that proof.

## Supabase sign-in

Set under **Authentication** in the Alethical Supabase project. Verified 2026-08-13.

| Setting | Intended | Why |
| --- | --- | --- |
| Email provider | On | Supports the live email and password option. |
| Google provider | On | Keeps the existing Google sign-in. |
| Confirm email | On | A password account cannot claim an address before proving it. |
| Manual identity linking | Off | Matching confirmed emails use Supabase's automatic account match; no second linking flow ships. |
| Minimum password length | 15 | Matches Alethical's passphrase wording and browser check. |
| Required character groups | None | A long passphrase works without forced capitals, digits, or symbols. |
| Prevent leaked passwords | On | Rejects passwords known to have been stolen elsewhere. |
| Secure password change | Off | No fresh-proof email-code field ships. |
| Require current password | Off | The signed-in password form asks only for the new password. |
| CAPTCHA | Off | No human-check box ships. |
| Email confirmation template | Alethical `/confirm` link using Supabase `TokenHash`, with all private values after `#` | Email scanners cannot spend the 1-use token before the reader presses Confirm email, and the private values do not reach Vercel request logs. |
| Password reset template | Alethical `/reset` link using Supabase `TokenHash`, with all private values after `#` | Opening the email reaches a safe gate before the 1-use token is spent, and the private values do not reach Vercel request logs. |
| Password-changed security email | On | Adding or changing a password sends a warning with a direct route to Forgot password. The app does not claim delivery on its success screen. |
| Custom SMTP through Resend | On | Alethical sends confirmation and reset messages from `ask@alethical.com`. |
| Authentication email limit | 30 emails per hour | Supabase limits total confirmation and reset email volume. |
| Sign-up and sign-in limit | 30 requests per 5 minutes per IP address | One internet address cannot make unlimited attempts. |

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
