# Reader completion checks

Alethical's completion evidence includes what a reader can do on the deployed
website. A successful build or merge alone does not establish that result.
[Workflow rules](../../.claude/rules/workflow.md) own release verification;
[the browser testing skill](../../.claude/skills/browser-user-test/SKILL.md) owns
fresh-context user review. These deterministic checks supplement both.

## Automatic checks

[The reader-check runner](../../apps/frontend/scripts/reader-completion-checks.mjs)
runs these public actions in a fresh Chromium desktop browser:

1. Open `/` and read the served `alethical-release-commit` stamp
2. Click **Bills and votes** and reach `/bills`
3. Type **school**, submit the search, open a visible bill result, and click its
   **Bill overview** link to reach the official Revisor destination
4. Open `/legislators`, follow a visible profile, and reach its **Overview** tab
5. Open `/blog`, follow **All research reports**, and open a visible article
6. Open `/money`, follow **Legislators**, and open a **Campaign money** tab
7. Reject any attempted unexpected write, sign-in, private/paid answer request,
   private authentication field, or WebSocket connection

Counts, result order, a particular legislator, and a particular bill are not fixed
expectations. The search needs at least 1 actual result; an empty result is an
honest product state but does not prove this search-to-source action works.

On pull requests and merge-queue commits, the required frontend CI job builds the tested website
and serves it on loopback. Saved public API snapshots supply bill and legislator
reads. The Revisor destination is a labelled fixture response. All outside
requests are handled locally or blocked, so outside service outages cannot block
premerge checks. Missing unrelated eager fixture reads receive HTTP 503; they
are not invented records or evidence that campaign figures loaded.

On a main push, a manual main run, or an authorized reusable workflow call, the
runner targets only `https://www.alethical.com`. It waits up to 600 seconds for
the expected release. Exact stamps pass; a newer stamp passes only if local Git
can prove the expected commit is its ancestor. An older stamp passes as
`older-equivalent-website` only when Git proves it is an ancestor and the website
paths are unchanged. The path list is read from the intended commit’s
`vercel.json` and must use the supported `ignoreCommand`; missing history, an
unsupported command, a changed website, or a Git error cannot prove equivalence.
Unrelated or unknown stamps fail. Reusable callers supply `expected_commit`; the workflow
requires main and main ancestry before using it. Event-carried website addresses
are never accepted.

## Commands and evidence

The public read-only check can be run without a login or service credential:

```sh
node apps/frontend/scripts/reader-completion-checks.mjs \
  --checked-commit "$(git rev-parse HEAD)" \
  --expected-commit "$(git rev-parse HEAD)" \
  --allow-newer --allow-equivalent --release-wait-seconds 600 \
  --output reader-completion-results.json
```

For an exact release expectation, omit `--allow-newer` and `--allow-equivalent`.
Recovery checks after a fallback release use that exact expectation. A diagnostic run without
`--expected-commit` proves only the named public actions, not release identity.
Targets other than official production and bare HTTP loopback origins are refused.
Fixture mode refuses production.

The JSON result records the phase, tested and expected commit, served commit,
release relation, start/finish times, named checks and their durations, blocked
network-action counts, suppressed metric counts, scope, and overall result. The
workflow retains this artifact for 30 days even when a reader check fails. A
failed setup retains a pending report with no executed checks and must not count
as a passed reader check. Raw exceptions, page content, request bodies, headers,
console output, screenshots, videos, and traces are not collected. Query strings
and fragments never enter the evidence.

The runner exits with status 1 when a named check fails. It stops at that failure;
later actions are untested. A saved artifact is evidence, not permission to ignore
a failure. No required human approval is added, and the workflow does not use
paid AI or create a paid recurring agent run.

## Safety and scope

A fresh browser has no saved account, cookies, or personal storage. Service
workers are disabled. Routing suppresses Alethical, Vercel, and Cloudflare reader
metrics locally, rejects unexpected writes before delivery, refuses private and
paid paths, and refuses authentication fields using the existing
[safe callback helper](../../apps/frontend/scripts/safe-auth-callback-report.mjs).
External public reads use a bounded host list. Blocked external decorative reads
are counted separately; they do not establish an attempted write. A required
public action still fails if its blocked resource prevents the action.

The named campaign-money check proves navigation to the selected tab. It does not
prove campaign records, totals, source dates, or every data-loading state are
correct. The bill-source check proves that the click reaches a successful official
bill destination whose bill number, year, and session match the selected bill
and whose text contains that bill identifier; it does not audit every official
source or every statement Alethical prints.

These checks do not cover sign-in, email, subscribing, tracking, comments,
address entry, paid generated answers, phone interactions, every menu, visual
quality, full accessibility, or data calculations. Changes in those areas still
need their relevant checks and the independent reader review specified by
[the browser testing skill](../../.claude/skills/browser-user-test/SKILL.md).
The postrelease check exercises the actual hosted client and API; the fixture
check does not exercise production routing, server-rendered bootstrap data,
production configuration, or outside-service availability.

## Impact and prevention record

- Cause and evidence: code checks cannot establish that an actual reader action
  works or that the intended commit reached readers; the release stamp and named
  browser actions provide that separate evidence
- Affected uses: bill search and official sources, legislator profiles, editorial
  articles, campaign-money navigation, and release-recovery completion
- Approved differences: public deterministic checks run automatically; independent
  reader judgment and affected feature checks remain separate; required human
  reviews remain 0
- Shared correction: 1 guarded runner supplies the same named evidence to premerge,
  main-release, manual, and reusable recovery runs
- Prevention checks: target, commit, method, host, auth-field, metrics, and private
  path guards have focused tests; fixture builds cover actual client navigation
- Remaining uncertainty: the scoped checks cannot establish all product behavior;
  failed setup or an unexecuted later action supplies no completion evidence
- Owner and authorization: the releasing coding agent owns failures, fixes,
  independent review, live checks, and acceptance under the approved completion
  requirements
- Completion condition: relevant code checks, the named live actions for the
  intended release, and independent review pass before work is declared complete
