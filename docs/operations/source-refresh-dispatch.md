# Independent public-record wakeups

The API can wake due public-record jobs without downloading or parsing records
itself. `alethical/api/services/source_refresh_dispatch.py` reads the saved source
deadlines and dispatches `source-record-refresh.yml` on `main`, with a single
code-owned `job` input. GitHub's scheduled run remains a backup. This removes the
dependency on GitHub's cron starting on time, but does not promise an immediate
GitHub runner or make a queued run count as a completed collection.

The existing API calls `dispatch_due` outside its event loop about once per
minute. Each call attempts at most 3 dispatches. Requests time out after 10
seconds. Separate `dispatch:<job>` rows hold a 5-minute claim and a 30-minute
cooldown after acceptance. Failed requests retry after 5 minutes. A worker crash
can leave an ambiguous dispatch, so collection leases must also reject overlap.
An active source or shared collection lane is not dispatched again. A completed
collector turn acknowledges its dispatch: when it is due again, its next bounded
turn can start on the next wake without the queued-request cooldown. An accepted
request with no collector completion keeps the full cooldown.

Dispatch rows retain only outcome, times and the optional GitHub run ID. They
never advance source-copy dates, successful collection dates or publication.
Credentials, HTTP response bodies and exception messages are not retained.

## Dedicated GitHub App

Use a private organization-owned GitHub App, installed on only
`alethical-org/alethical` (repository ID `1188303032`). Proposed registration:

| Field | Value |
| --- | --- |
| Name | Alethical Record Refresh |
| Homepage | https://github.com/alethical-org/alethical |
| Description | Wake due public-record collection jobs on Alethical's main branch |
| Webhooks | Inactive |
| User authorization, device flow, callback and setup addresses | Off or empty |
| Repository permissions | Actions: read and write; required Metadata: read |
| Organization and account permissions | None |
| Events | None |
| Installation availability | Only on this account |
| Selected repository | alethical |

GitHub's Actions permission covers repository workflow management, not only 1
workflow. The dispatcher itself fixes the workflow and branch. The App cannot
write repository content or read repository secret values. Do not substitute a
personal token, a third-party App token, or the account's broad CLI credential.

The App private key signs a short-lived JWT. Each sweep requests an installation
token further restricted to the exact repository ID and Actions write, and
rejects unexpected returned permissions. No user access token is needed.
GitHub documents the [registration fields](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app),
[installation token scope](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app),
and [workflow dispatch permission](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

## Runtime configuration

Store the private key in the existing Railway service's secret configuration,
without printing it, placing it in source control or handing it through chat.
Keep any temporary local key readable only by its owner, then remove that local
copy after safe delivery. Set:

- `ALETHICAL_SOURCE_REFRESH_FAMILIES` (JSON list matching the repository variable below)
- `ALETHICAL_SOURCE_REFRESH_DISPATCH_ENABLED=true`
- `ALETHICAL_SOURCE_REFRESH_APP_ID`
- `ALETHICAL_SOURCE_REFRESH_INSTALLATION_ID`
- `ALETHICAL_SOURCE_REFRESH_PRIVATE_KEY` (actual multiline PEM)

The switch is off when absent. A true switch with missing credentials is an
operational failure, not a working scheduler. Activation follows creation of the
fixed workflow, deployment of the scheduler tables and successful narrow access
read-back. The existing source privacy, review and publication guards
remain in effect.

## Staged family activation

The repository variable `SOURCE_REFRESH_FAMILIES` and the API secret
`ALETHICAL_SOURCE_REFRESH_FAMILIES` hold the same JSON list. Supported names are
`campaign`, `notices`, `legislative`, `lobbying`, `supporting` and `fcc`. Both default
to `[]`. A disabled family is reported as disabled, not overdue or completed.
The legacy campaign-money, notice, vote and FCC schedules remain until their
matching family is enabled. The source worker and old FCC workflow use the same
Actions queue, and the adapter invokes the existing collector, not a second one.

The release owner completes this sequence for each family:

1. Deploy the schema and code with family lists empty; preserve the legacy clocks.
2. Verify the exact worker tools and private settings. FCC requires Supabase/R2,
   poppler and tesseract. Bill work requires the existing embedding path's spending
   authorization and `SOURCE_REFRESH_BILL_EMBEDDINGS_APPROVED=true`; the presence
   of a key alone never enables a paid call. Summaries and mail stay off.
3. Run a named bounded verification turn through the manual workflow with its
   `verify` input true. This bypasses timing and the family switch, never a lease. Record its
   actual claim, finish and scope; a workflow receipt is not source completion.
4. Set the repository family list, which switches the matching legacy scheduled
   job off and the shared hourly clock on. Set the same API family list and enable
   the restricted App clock. A lost API wake still has the hourly backup.
5. Observe an automatic claim and finish, the exact source/publication generation,
   clearing and public read-back. Measure observation, queue, copy, validation,
   publication and public-read delays separately. Keep unknown publication times
   unknown and hold incomplete families out of any completion claim.

Rollback removes the family from the API list, then the repository list. Existing
legacy clocks resume without changing records. Preserve unfinished source signals,
leases, exact-input check progress and previous good releases. Other families keep
running. No migration, credential, switch or source job is activated by these docs.

## Checks

Focused tests cover fixed target and token scope, simultaneous claims, accepted
cooldowns across process restarts, failed and interrupted dispatch recovery,
stale completion rejection, active collection lanes, disabled defaults, no broad
token fallback and no false source-success dates. No live workflow is dispatched
by these tests.
