# Bounded website release recovery

<!-- describes: scripts/website_release_recovery.py, .github/workflows/website-release-recovery.yml -->

Net: Try 1 repair for a proven missed website release. Preserve working production
until the replacement is built. Stop when evidence is missing or a release is held.

[Deployment](deployment.md#release-and-recovery) owns the normal Vercel Git release
and the missed/failed release watches. [Reader completion checks](reader-completion-checks.md)
owns public browser evidence. [Job outcomes](agent-job-outcomes.md) owns private
job measures. GitHub's existing required `frontend` check includes the built
public reader paths; required human approvals remain `0`.

## Scope

The workflow starts when **Production release missing** finishes with failure on
trusted `main`, or by hand on `main`. A hand-run defaults to a dry run.
It never reads code or artifacts from the triggering run. It checks out current
trusted `main` and rejects pull-request, fork, stale, incomplete and unrelated
triggers before any recovery action.

The normal Git-connected release remains primary. The ignored-build prevention
compares the last successful release, while the missing-release watch catches
changes that still do not ship. This fallback repairs that remaining failure;
it does not edit code or attempt to diagnose arbitrary production errors.

No production data changes, API recovery, collection replacement, account action,
email, model call or new paid recurring work belongs to this routine. Browser
checks use public reading paths with metrics suppressed. Existing GitHub and
Vercel build/hosting usage applies, as recorded in [jobs and scripts](jobs-and-scripts.md).

## Guards and the attempt limit

Before an attempt, the routine requires:

- The checked commit is still current `main`.
- The website carries a known older commit from the same history, with actual
  website changes waiting beyond the existing watch's grace period.
- Current-main CI finished successfully, with the saved `changes`, `backend` and
  `frontend` jobs satisfied. Merge protection still owns premerge explanation and
  review-conversation checks.
- Vercel's production deployment history is readable and has no active build.
  Unknown states, missing pagination and an incomplete bounded history stop it.
- No pending promotion or rollback is changing the production domains.
- Automatic production domain assignment is explicitly enabled. Disabled or
  unknown assignment preserves a deliberate rollback or promotion hold.
- No waiting commit already has a ready production deployment. That state needs
  diagnosis of a possible rollback or held promotion, rather than another build.
- Vercel identifies the current production deployment so it can be retained for
  recovery if the replacement proves bad.

The routine creates a GitHub deployment record in `website-release-recovery`
before building. The record carries the commit and previous deployment ID.
Every later attempt for that commit stops, including reruns after a crash. Do not
delete this record to retry. An operator must diagnose any remaining incident;
the routine cannot lift its own limit. An unsuccessful attempt leaves the existing
release issue open. Successful recovery closes it on the next missed-release watch.

## Build, promote and prove

Vercel builds with production settings and without assigning the public domain
(`vercel deploy --prod --skip-domain`). The previous website keeps serving.
The routine saves safe phase evidence before outside changes and stores the
previous deployment ID in GitHub's durable attempt record too.

After the build, the routine repeats the missing-release and test checks, then
checks provider activity, rollback/promotion state, the current production ID and
current `main` immediately before promotion. It stops if readers caught up, a
newer release appeared, another operation started or `main` advanced.

GitHub and Vercel do not share 1 atomic lock. An independent Git release or manual
operation can start after the final read. The shared GitHub workflow slot serializes
this fallback with the hand-run Vercel fallback, and repeated provider/main checks
reduce that remaining race; they cannot prove it impossible. Recovery does not
cancel another release or automatically roll back a newer deployment.

Promotion is followed by the [reader completion checks](reader-completion-checks.md),
including an exact live commit stamp. A successful build or promotion alone does
not count as recovered. A timeout during promotion means the provider's result
may be unknown; inspect the saved phase and live website before further action.

GitHub retains `website-recovery.json` and `reader-completion.json` for 30 days.
The evidence contains safe commit IDs, phase, attempt ID and deployment IDs or
addresses. It contains no credentials, callback values, raw commands or private
browser captures. If a runner is forcibly stopped before artifact upload, the
durable GitHub deployment payload still holds the previous deployment ID.

## Read-only use

```bash
python scripts/website_release_recovery.py --report /tmp/website-recovery.json
```

The default mode reads the live stamp and current-main test evidence. It does not
reserve an attempt, build, promote or change production. An eligible dry run is
not a claim that all provider guards passed; those guards run before execution.
Execution belongs to the trusted GitHub workflow, which supplies existing saved
credentials only to the recovery step. The pinned Vercel command is installed
before that step, with package install hooks disabled, and then called directly.
Package installation receives none of the production deployment credentials.

## Acceptance and prevention

Focused tests replay untrusted/stale triggers, unknown stamps, unmet grace,
unfinished tests, duplicate attempts, rollback holds, pending domain changes,
unknown provider state, late main/production changes, build/promotion failures
and browser failure. The complete successful replay reserves 1 attempt, stages
1 build, promotes 1 release and requires exact-commit reader evidence. Failed
paths never start another attempt or perform an automatic rollback.

The release routine is tested without deliberately breaking production. Real
missing releases still depend on Vercel access and valid provider evidence; an
unexplained provider answer stops rather than broadening permissions.

Primary service behavior: [Vercel staged deployment](https://vercel.com/docs/cli/deploy#skip-domain),
[promotion](https://vercel.com/docs/cli/promote),
[rollback holds](https://vercel.com/docs/instant-rollback), and
[project state](https://vercel.com/docs/rest-api/projects/find-a-project-by-id-or-name).
