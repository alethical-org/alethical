# Repo and service settings

This file is the source of truth for Alethical's GitHub, Vercel, Railway, and
Supabase settings outside the repository. The free read-only check in
`.github/workflows/hosted-service-settings.yml` reads these tables directly and
compares them with GitHub, Vercel, Railway, and Supabase wherever stable read access
exists. Secrets are named here, never their contents.

**Why it exists.** In July 2026, Dependabot alerts were found switched off for the
project's entire life. The first scan returned 70 open alerts
([#691](https://github.com/alethical-org/alethical/issues/691)). The same review found
`main` with no branch protection and secret scanning disabled. A stated intended value
makes later drift visible.

**How to read Automated check.** `Live` means the workflow reads the provider and
compares the value. `Live with NAME` means a missing narrow credential is reported as
unchecked, never matched. `Tracked file` means the value lives in the named repository
file. `Unchecked` names the exact missing safe access and its follow-up issue.

## GitHub repository

Set under **Settings** on `github.com/alethical-org/alethical`. Verified 2026-08-11.

| Setting | Intended | Why | Automated check |
| --- | --- | --- | --- |
| Visibility | **Public** | Everything committed is world-readable. | Live |
| Dependabot alerts | **On** | Off until July 2026, when 70 unseen alerts were found. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Dependabot malware alerts | **On** | Adds free warnings for dependencies known to contain malware. | Unchecked: GitHub has no official per-repository read field for this switch; [#1559](https://github.com/alethical-org/alethical/issues/1559) |
| Dependabot automatic security fixes | **On** | Grouping in `.github/dependabot.yml` keeps the updates reviewable. Nothing self-merges. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Private vulnerability reporting | **On** | Lets a visitor report a security flaw without publishing it. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Secret scanning | **On** | GitHub looks for leaked credentials in the full public history. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Secret scanning push protection | **On** | Blocks a found credential before it becomes public. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Free secret scan in `ci.yml` | **On** | TruffleHog remains the free fallback if GitHub's public-repository protection changes. | Tracked file: `.github/workflows/ci.yml` |
| Secret scanning validity checks | **Off** | GitHub accepted an enable request in July 2026 but kept this low-value switch disabled. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Allow squash merge | **On** | This is the repository's merge style. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Allow merge commits | **Off** | Keeps the history to the 1 approved merge style. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Allow rebase merge | **Off** | Keeps the history to the 1 approved merge style. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Automatically delete head branches | **On** | Removes merged branches from parallel work. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Branch protection on `main` | **On** | A direct push could otherwise release both services and run production migrations without checks. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Organization two-step login requirement | **Off** until 2 outside collaborators enroll | Turning it on now would remove `joelethical` and `Myahmyahmeow-cat`, who have not enabled it. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |

### Branch protection on `main`

Enabled 2026-07-28.

| Setting | Value | Why this value | Automated check |
| --- | --- | --- | --- |
| Require a pull request | **Yes** | Closes the direct-push release path. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Required approving reviews | `0` | Sessions can merge low-risk work under the repository release rules. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Required Code Owner review | **No** | Only 1 current owner has reviewed past work, so requiring this would stop releases. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Dismiss old approvals after a new push | **No** | A required current branch can change after review without causing a repeat-review loop. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Required status checks | `changes`, `backend`, `frontend` | The 3 jobs in `.github/workflows/ci.yml` cover code and documentation. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Strict (branch must be up to date) | **On** | Every merge is tested with current `main`. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Resolve review conversations | **On** | Open review findings must be answered before merge. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Enforce for admins | **On** | Owners cannot skip a failed check or the pull-request path. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Force pushes / branch deletion | **Blocked** | Prevents rewriting or deleting the protected branch. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| Merge queue | **On** (added 2026-08-17) | Stops the "green alone, red together" failure: 2 pull requests that each pass CI on their own can still break `main` once both land, because neither was tested against the other ([#990](https://github.com/alethical-org/alethical/issues/990)/[#1020](https://github.com/alethical-org/alethical/issues/1020), [#662](https://github.com/alethical-org/alethical/issues/662)/[#663](https://github.com/alethical-org/alethical/issues/663)). Squash merge, 1-5 pull requests merged per group, no batching wait, 60-minute check timeout. See `.claude/rules/workflow.md` rule 10. | Unchecked: this setting lives on the repository's rule set, which `scripts/check_hosted_service_settings.py` does not read yet (it reads the older branch-protection API only). |

The required `backend` and `frontend` jobs report `skipped` on unrelated changes, which
GitHub accepts as satisfied. Keep path filters inside jobs, not on the workflow trigger,
so all 3 required checks always report.

## GitHub Actions secrets

Set under **Settings, Secrets and variables, Actions**. The live check reads names only.

| Secret | Intended | Used by | For | Automated check |
| --- | --- | --- | --- | --- |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | Present | `mirror-raw-files.yml` | Writes the backup copy of source files. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `CLOUDFLARE_R2_BUCKET` | Present | `mirror-raw-files.yml` | Names the backup bucket. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `CLOUDFLARE_R2_ENDPOINT` | Present | `mirror-raw-files.yml` | Reaches the backup bucket. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | Present | `mirror-raw-files.yml` | Authenticates writes to the backup bucket. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `RAILWAY_TOKEN` | Present | `railway-deploy.yml`, `hosted-service-settings.yml` | Targets the production Railway project for manual releases and read-only checks. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `SUPABASE_OAUTH_CLIENT_ID` | Present | `hosted-service-settings.yml` | Names the Supabase OAuth app that can read sign-in settings only. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `SUPABASE_OAUTH_CLIENT_SECRET` | Present | `hosted-service-settings.yml` | Authenticates the narrow Supabase OAuth app when it refreshes access. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `SUPABASE_OAUTH_REFRESH_TOKEN` | Present | `hosted-service-settings.yml` | Starts the first read-only Supabase check; each later rotating token comes from the encrypted workflow artifact. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `SUPABASE_DB_PASSWORD` | Present | database maintenance workflows | Builds the production database address. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `SUPABASE_PROJECT_URL` | Present | database maintenance workflows | Targets the production Supabase project. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `SUPABASE_STORAGE_S3_ACCESS_KEY_ID` | Present | `mirror-raw-files.yml` | Reads the main source-file store. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `SUPABASE_STORAGE_S3_ENDPOINT` | Present | `mirror-raw-files.yml` | Reaches the main source-file store. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `SUPABASE_STORAGE_S3_REGION` | Present | `mirror-raw-files.yml` | Names the main source-file store region. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY` | Present | `mirror-raw-files.yml` | Authenticates reads from the main source-file store. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `VERCEL_ORG_ID` | Present | `vercel-deploy.yml`, `hosted-service-settings.yml` | Targets Alethical's Vercel account. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `VERCEL_PROJECT_ID` | Present | `vercel-deploy.yml`, `hosted-service-settings.yml` | Targets the production web project. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |
| `VERCEL_TOKEN` | Present | `vercel-deploy.yml`, `hosted-service-settings.yml` | Reads production web settings and supports manual releases. | Live with `REPO_SETTINGS_TOKEN`; [#1557](https://github.com/alethical-org/alethical/issues/1557) |

## Vercel project

Set under **Settings** for the `alethical-web` project. Verified 2026-08-15.

| Setting | Intended | Why | Automated check |
| --- | --- | --- | --- |
| Project | `alethical-web` | Prevents a valid credential from checking the wrong project. | Live |
| Root Directory | `.` | The build, server functions, and `vercel.json` start at the repository root. | Live |
| Git repository | `alethical-org/alethical`, production branch `main`, automatic releases **on** | Vercel's Git connection is the normal web release path. | Live |
| Ignored Build Step | The `ignoreCommand` in `vercel.json` | Documentation-only and backend-only changes stop before a paid build. | Tracked file: `vercel.json` |
| Deployment Protection | `all_except_custom_domains` | Preview addresses require Vercel login while custom production domains stay public. | Live |
| Protection Bypass for Automation | **On** | Signed-in checks can reach protected previews through `VERCEL_AUTOMATION_BYPASS_SECRET`. | Live |
| Production domain | `www.alethical.com` | Names the public web address. | Live |
| Apex redirect | `alethical.com` to `www.alethical.com`, HTTP `308` | Keeps 1 permanent public address. | Live |

### Vercel environment variables

The live check reads names and release targets only. It never asks Vercel for values.

| Setting | Intended | Why | Automated check |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | Preview, Production | Points each released web app at the production API. | Live |
| `EXPO_PUBLIC_AUTH_RESEND_WAIT_SECONDS` | Production | Matches Supabase's real email resend wait. | Live |
| `EXPO_PUBLIC_CHECKLY_STATUS_URL` | Production | Gives every reader the public Checkly availability detail page. | Live |
| `EXPO_PUBLIC_EMAIL_PASSWORD_SIGN_IN_ENABLED` | Production | Keeps the proven email and password option visible. | Live |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production | Lets the web app use the public Supabase client. | Live |
| `EXPO_PUBLIC_SUPABASE_URL` | Production | Points sign-in at the production Supabase project. | Live |
| `TRAFFIC_COUNTING_STARTED_AT` | Production | Anchors the public traffic total. | Live |
| `TRAFFIC_EXCLUDED_ACCOUNT_IDS` | Production | Stops signed-in page-view collection for the confirmed team accounts. | Live |
| `VERCEL_ANALYTICS_ACCESS_TOKEN` | Production | Reads the production traffic total. | Live |
| `VERCEL_ANALYTICS_PROJECT_ID` | Production | Targets the production traffic project. | Live |
| `VERCEL_ANALYTICS_TEAM_ID` | Production | Targets Alethical's Vercel account for traffic reads. | Live |
| `GOOGLE_SEARCH_CONSOLE_GCP_PROJECT_NUMBER` | Production | Names the Google Cloud project that exchanges Vercel's short-lived identity. | Live |
| `GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL` | Production | Names the read-only machine account for Google Search Console. | Live |
| `GOOGLE_SEARCH_CONSOLE_WORKLOAD_IDENTITY_POOL_ID` | Production | Names the Google identity pool that trusts Vercel Production. | Live |
| `GOOGLE_SEARCH_CONSOLE_WORKLOAD_IDENTITY_PROVIDER_ID` | Production | Names the Google identity provider for Vercel Production. | Live |
| `GOOGLE_SEARCH_CONSOLE_SITE_URL` | Production | Targets the whole `alethical.com` Search Console property. | Live |
| `BING_WEBMASTER_API_KEY` | Production | Reads Alethical's combined Bing discovery totals. | Live |
| `BING_WEBMASTER_SITE_URL` | Production | Targets Alethical's verified Bing site. | Live |
| `CHECKLY_API_KEY` | Production | Reads the 3 public availability checks. | Live |
| `CHECKLY_ACCOUNT_ID` | Production | Targets Alethical's Checkly account. | Live |
| `CHECKLY_WEB_CHECK_ID` | Production | Targets the main website availability check. | Live |
| `CHECKLY_TRAFFIC_CHECK_ID` | Production | Targets the public Site metrics page availability check. | Live |
| `CHECKLY_API_READY_CHECK_ID` | Production | Targets the data service and database readiness check. | Live |
| `CLOUDFLARE_ANALYTICS_API_TOKEN` | Production | Reads sitewide browser-speed totals. | Live |
| `CLOUDFLARE_ACCOUNT_ID` | Production | Targets Alethical's Cloudflare account. | Live |

Team exclusion is active for 3 of the 4 team accounts. Append the 4th stable Supabase
account identifier to `TRAFFIC_EXCLUDED_ACCOUNT_IDS` in Vercel and Railway after it is
confirmed. Both live routes report `teamExclusionConfigured: true` while the list is
nonempty; that answer does not mean all 4 accounts are present.

## Railway project

Set under **Settings** for the `alethical-api` service in production. Verified
2026-08-15.

| Setting | Intended | Why | Automated check |
| --- | --- | --- | --- |
| Project | `alethical` | Prevents a valid project token from checking a different Railway project. | Live |
| Environment | `production` | Prevents a valid project token from checking a preview environment. | Live |
| Service | `alethical-api` | Names the production API service. | Live |
| Production domain | `alethical-api-production.up.railway.app` | Names the direct production API address. | Live |
| Git repository | `alethical-org/alethical`, production branch `main`, automatic releases **on** | Railway's Git connection is the normal API release path. | Live |
| Wait for CI | **Off** | A GitHub runner outage must not stop Railway from applying a required database change. | Live |
| Configuration file | Root `railway.json` | Keeps Railway pointed at the reviewed build and release settings in this repository. | Live |
| Build command | The `buildCommand` in `railway.json` | Installs the exact saved package versions used to build the API. | Unchecked: needs typed effective-deployment fields in Railway's public API, readable with the existing `RAILWAY_TOKEN`; Railway's `Deployment.meta` is undocumented JSON and `ServiceInstance` returns dashboard values; [#1572](https://github.com/alethical-org/alethical/issues/1572) |
| Before-deploy command | The `preDeployCommand` in `railway.json` | Applies database changes before the new API starts. | Unchecked: needs typed effective-deployment fields in Railway's public API, readable with the existing `RAILWAY_TOKEN`; Railway's `Deployment.meta` is undocumented JSON and `ServiceInstance` returns dashboard values; [#1572](https://github.com/alethical-org/alethical/issues/1572) |
| Start command | The `startCommand` in `railway.json` | Starts the public API with the reviewed server settings. | Unchecked: needs typed effective-deployment fields in Railway's public API, readable with the existing `RAILWAY_TOKEN`; Railway's `Deployment.meta` is undocumented JSON and `ServiceInstance` returns dashboard values; [#1572](https://github.com/alethical-org/alethical/issues/1572) |
| Healthcheck path | The `healthcheckPath` in `railway.json` | Sends traffic only after the API can reach the database at the expected version. | Unchecked: needs typed effective-deployment fields in Railway's public API, readable with the existing `RAILWAY_TOKEN`; Railway's `Deployment.meta` is undocumented JSON and `ServiceInstance` returns dashboard values; [#1572](https://github.com/alethical-org/alethical/issues/1572) |
| Healthcheck timeout | The `healthcheckTimeout` in `railway.json` | Gives the API a limited time to become ready before a release fails. | Unchecked: needs typed effective-deployment fields in Railway's public API, readable with the existing `RAILWAY_TOKEN`; Railway's `Deployment.meta` is undocumented JSON and `ServiceInstance` returns dashboard values; [#1572](https://github.com/alethical-org/alethical/issues/1572) |
| Restart policy | The `restartPolicyType` and `restartPolicyMaxRetries` in `railway.json` | Restarts the API after a failure without hiding a service that keeps crashing. | Unchecked: needs typed effective-deployment fields in Railway's public API, readable with the existing `RAILWAY_TOKEN`; Railway's `Deployment.meta` is undocumented JSON and `ServiceInstance` returns dashboard values; [#1572](https://github.com/alethical-org/alethical/issues/1572) |

Railway's [config-as-code guide](https://docs.railway.com/config-as-code) says the
values in `railway.json` override the dashboard without changing what the dashboard
shows. Railway's public API and command-line tool return successful deployments with
`Deployment.meta`, but Railway defines that value only as undocumented JSON. The typed
`ServiceInstance` fields are the dashboard values, so treating either source as a stable
read of the final deployment settings would create a false alarm. The live check confirms
only the supported `railwayConfigFile` value until Railway adds typed fields for the final
deployment settings.

### Railway environment variables

The live check reads names only with Railway's `decryptVariables: false` option.

| Setting | Intended | Why | Automated check |
| --- | --- | --- | --- |
| `ALETHICAL_CONTACT_RATE_PER_MIN` | Present | Limits repeated Contact us requests. | Live |
| `ALETHICAL_CORS_ORIGINS` | Present | Limits which websites can call the API from a browser. | Live |
| `ALETHICAL_EMAIL_ENABLED` | Present | Turns production Contact us delivery on. | Live |
| `ALETHICAL_EMAIL_FROM` | Present | Sets the verified sender address. | Live |
| `ALETHICAL_EMAIL_TRANSPORT` | Present | Sends production mail through Resend. | Live |
| `DATABASE_URL` | Present | Connects the API to the production database. | Live |
| `INTERNAL_API_TOKEN` | Absent | No trusted job uses the internal routes; leaving the token unset makes every request fail closed. | Live |
| `OPENAI_API_KEY` | Present | Powers live question sorting, answers, and search embeddings. | Live |
| `PYTHON_VERSION` | Present | Pins the Python version Railway uses to build the API. | Live |
| `RESEND_API_KEY` | Present | Authenticates production Contact us email. | Live |
| `SENTRY_DSN` | Present | Sends deliberately limited server failures to Alethical's Sentry project. | Live |
| `SUPABASE_DB_PASSWORD` | Present | Lets production maintenance commands build a database connection without copying a full address. | Live |
| `SUPABASE_POOLER_HOST` | Present | Routes production maintenance commands through Supabase's reachable connection pool. | Live |
| `SUPABASE_PUBLISHABLE_KEY` | Present | Lets the API make public Supabase requests. | Live |
| `SUPABASE_PROJECT_REF` | Present | Names the Supabase database user for production maintenance commands. | Live |
| `SUPABASE_PROJECT_URL` | Present | Targets the production Supabase project for maintenance commands. | Live |
| `SUPABASE_URL` | Present | Points the API at the production Supabase project. | Live |
| `TRAFFIC_EXCLUDED_ACCOUNT_IDS` | Present | Discards confirmed team actions and removes confirmed team readers and watches from public totals. | Live |
| `UV_VERSION` | Present | Pins the package installer Railway uses to build the API. | Live |

Team exclusion is active for 3 of the 4 team accounts. Append the 4th stable Supabase
account identifier to `TRAFFIC_EXCLUDED_ACCOUNT_IDS` in Vercel and Railway after it is
confirmed. Both live routes report `teamExclusionConfigured: true` while the list is
nonempty; that answer does not mean all 4 accounts are present.

## Sentry project

Set under **Settings** in Sentry organization `Alethical`. Verified 2026-08-15.

| Setting | Intended | Why | Automated check |
| --- | --- | --- | --- |
| Account | Google sign-in with `alethicaldev@gmail.com` | Keeps Alethical's vendor access out of a maintainer's personal accounts. | Manual |
| Data location | United States | Matches Alethical's Minnesota service and Railway's US server. | Manual |
| Plan | Developer | Supplies the needed grouping, 30-day view, and email for $0. | Manual |
| Project | `alethical-api`, FastAPI | Keeps server failures separate and clearly named. | Manual |
| Products | Error monitoring on; logs, tracing, profiling, and metrics off | Sends only the deliberately captured failures. | Manual |
| Data scrubbing | Server-side scrubber and default scrubbers on | Adds a second barrier if a future caller sends a sensitive field. | Manual |
| IP address storage | Prevented | Stops Sentry from turning a server or reader network address into a stored location. | Manual |
| Source access | No connected repository; JavaScript source fetching and source-code context off | Prevents Sentry from copying source beyond the stack locations sent with an event. | Manual |
| Spike protection | On | Keeps one failure storm from consuming the free allowance. | Manual |
| New-issue alert | Email `alethicaldev@gmail.com` | Makes a grouped failure visible without someone checking a dashboard. | Verified by production event `ALETHICAL-API-1` on 2026-08-15 |

## Supabase sign-in

Set under **Authentication** in the Alethical Supabase project. Verified 2026-08-15.
The monthly check uses a Supabase OAuth grant limited to `auth:read`. It cannot change a
Supabase setting. No Supabase personal access token is stored. Supabase replaces the
refresh token after every use, so the workflow encrypts each replacement with the OAuth
client secret and keeps 2 ciphertext-only GitHub Actions artifacts for 90 days. Runs wait
for the prior run. Only artifacts made by this trusted workflow can be restored, and a
missing, expired, corrupt, or unsaved replacement fails the check.

| Setting | Intended | Why | Automated check |
| --- | --- | --- | --- |
| Site URL | `https://www.alethical.com` | Sends production sign-in links to the public site. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Additional redirect URLs | `https://www.alethical.com/**`, `http://localhost:8081/**`, `http://127.0.0.1:8081/**`, `http://localhost:19006/**`, `http://127.0.0.1:19006/**`, `alethical://auth/callback` | Allows the production site, local web work, and the future phone app to finish sign-in. Preview addresses are added one at a time only while testing. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Email provider | **On** | Supports the live email and password option. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Google provider | **On** | Keeps Google sign-in available. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Confirm email | **On** | A password account cannot claim an address before proving it. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Manual identity linking | **Off** | Matching confirmed emails use Supabase's automatic account match. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Minimum password length | `15` | Email and password sign-in has no required second factor. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Required character groups | **None** | Length is safer than predictable capital, digit, or symbol rules. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Prevent leaked passwords | **On** | Supabase checks known exposed passwords through Have I Been Pwned. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Secure password change | **Off** | The password form still has a dormant email-code step, so enabling this later cannot strand a reader on a separate screen. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Require current password | **Off** | The signed-in password form asks only for the new password. | Tracked file: `apps/frontend/src/components/auth/AccountControl.tsx` |
| CAPTCHA | **Off** | No human-check box ships. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Email confirmation template | Supabase `RedirectTo` followed by `TokenHash`; the app supplies Alethical `/confirm` with its private values after `#` | Email scanners cannot spend the 1-use token before the reader confirms. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Password reset template | Supabase `RedirectTo` followed by `TokenHash`; the app supplies Alethical `/reset` with its private values after `#` | Opening the email reaches a safe page before the 1-use token is spent. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Password-changed security email | **On** | A changed password sends a warning with a route to Forgot password. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Custom SMTP through Resend | **On** at `smtp.resend.com`, sender `ask@alethical.com` | Sends confirmation and reset messages from `ask@alethical.com`. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Authentication email limit | `30` emails per hour | Limits total confirmation and reset email volume. | Live with `SUPABASE_OAUTH_REFRESH_TOKEN` |
| Sign-up and sign-in limit | `30` requests per 5 minutes per internet address | Limits rapid password guesses from 1 address. | Unchecked: Supabase's read-only hosted API exposes the project-wide email-code limit, not this per-address limit; [Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits) |

Supabase stores passwords with salted bcrypt. The intended product explanation remains in
[`sign-in-guide.md`](../product-onboarding/sign-in-guide.md); it is not a second settings
list.

## Settings outside this check

Cloudflare's API routing and email records remain in
[`api-cdn-setup.md`](api-cdn-setup.md). They are outside pull request 703's GitHub,
Vercel, Railway, and Supabase scope.

## Keeping this current

Change the intended row in the same pull request as any hosted-setting change. The free
read-only workflow runs when this file, the checker, its workflow, `railway.json`, or
`vercel.json` changes. It also runs on the 1st day of each month as a backstop for
settings changed on a provider website. It uses GitHub's smallest free runner, makes no
paid API or AI call, and never writes a provider setting.

Proposed checker code runs without provider credentials. A separate trusted copy from
`main` receives the read credentials and parses only the proposed Markdown and JSON data
files. This prevents changed pull-request code from reading Vercel's release token or
Railway's project token.

Drift and unreadable required services fail the workflow. Known access gaps stay yellow
and are listed by name; they are never included in the matched total. The 2 open access
gaps are [#1557](https://github.com/alethical-org/alethical/issues/1557) and
[#1559](https://github.com/alethical-org/alethical/issues/1559).
