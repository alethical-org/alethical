# Reader completion checks

<!-- describes: apps/frontend/scripts/reader-completion-*.mjs, apps/frontend/scripts/reader-official-bill.mjs, apps/frontend/scripts/reader-release-relation.mjs, apps/frontend/scripts/serve-reader-check-build.mjs, .github/workflows/reader-completion-checks.yml, .github/workflows/ci.yml, .github/actions/prepare-browser-install/action.yml -->

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
7. In fixture mode, choose 2025 and read the matched committee’s contributions,
   expenditures, coverage dates, source link and payment-copy date; switch to 2024
   for separate synthetic missing-total and filed-zero committees, then return to
   2025 and require its own records again
8. Reject any attempted unexpected write, sign-in, private/paid answer request,
   private authentication field, or WebSocket connection

Live counts, result order, a particular legislator, and a particular bill are not
fixed expectations. The search needs at least 1 actual result; an empty result is an
honest product state but does not prove this search-to-source action works.

On pull requests and merge-queue commits, the required frontend CI job builds the tested website
and serves it on loopback. Saved public API snapshots supply bill and legislator
reads, including Jim Abeler’s profile and his retained 2025 committee figures.
The Revisor destination is a labelled fixture response. All outside
requests are handled locally or blocked, so outside service outages cannot block
premerge checks. Missing unrelated eager fixture reads receive HTTP 503; they
are not invented records or evidence that campaign figures loaded. The 3 named
money fixture checks now require the rendered figures themselves.

### Campaign-money fixture evidence

The retained [Jim Abeler profile](../../apps/frontend/scripts/fixtures/reader-legislator-jim-abeler.json)
was copied on 7 October 2026 from the public profile API, with
`include=current_service,committees,stats,service_history,campaign_committees`.
Its confirmed registration `17868` matches the existing
[2025 committee snapshot](../../apps/frontend/src/components/campaignMoney/__tests__/fixtures/committee-donation-cards-17868-2025.json)
and [2025 payment snapshot](../../apps/frontend/src/lib/__tests__/fixtures/campaign-money-17868-2025.json).
The fixture envelope keeps the payment snapshot’s release and copy date. No
report-copy date is established by these snapshots, so the check requires the
honest “report totals were copied separately” fallback. This assembled test
response is not a new production snapshot or evidence of today’s figures.

The 2025 checks expect $97,703 in total contributions, $67,100 in itemized
contributions and $33,006 in official expenditures, each inside that committee’s
own Money in or Money out block. Displayed amounts omit cents as the product
requires; retained source amounts keep cents. The source link must identify
candidate committee `17868` and year `2025`. Coverage must be Jan 1 through
Dec 31, 2025; the payment-copy date remains Sep 1, 2026.

The 2024 response is explicitly synthetic, not a claim about Jim Abeler or actual
registrations `99998` and `99999`. Its visible committee names start with
“Synthetic”. One committee has $123 in itemized contributions and $456 in listed
payments but no official totals. Its missing-spending sentence must show no dollar
amount. The other has explicit official $0 totals and the explanation that these
are filed zeros. Each assertion is scoped to the relevant committee and money
block; figures in a neighboring card cannot satisfy it. Returning to 2025 must
remove the synthetic cards and restore the matching amount, year, dates and link.

Only 2024 and 2025 campaign responses are supplied. Other years, unretained
payment directions and unrelated history/outside-spending reads remain HTTP 503.
These checks do not claim that those sections loaded. Source links are inspected
for their exact destination; the money fixtures never fabricate a successful
response from the Campaign Finance Board.

The required browser check also runs 3 deliberate failures: a missing money
response, a wrong official contribution amount, and a missing spending total
changed to zero. Each must fail the corresponding named money check after tab
navigation succeeds. A crash, earlier navigation failure or unexpected blocked
write cannot count as a successful negative demonstration.

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

## Browser installation limits

The required frontend checks, live reader checks and
[website release recovery](website-release-recovery.md) share
[browser installation preparation](../../.github/actions/prepare-browser-install/action.yml).
These 3 workflows use GitHub's Linux X64 runners. The preparation rejects other
runner types, which need their own supported settings before adoption.

Ubuntu package downloads use 1 retry and 15-second HTTP/HTTPS connection and idle
waits, matching the [official x64 runner settings](https://github.com/actions/runner-images/blob/c03600ca998467081ccec9bb9dbf5de6b68e862a/images/ubuntu/scripts/build/configure-apt.sh).
The preparation prints and checks the effective settings, so an override cannot
silently restore longer waits. Existing download mirrors and package signature
checks stay intact. The 15-second limit applies to each stalled connection or
idle transfer, not to the whole installation.

Each workflow still installs Chromium and its system dependencies with
`playwright install --with-deps chromium`. That step has a 10-minute total limit;
an installation failure or timeout fails the browser check. The full required
browser tests remain enabled. Changes to the shared preparation select frontend
checks through [check-paths.json](../../.github/check-paths.json).

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
Fixture mode refuses production. The negative demonstrations also require fixture
mode, accept only fixed failure names, and retain the same network guards:

```sh
node apps/frontend/scripts/reader-completion-checks.mjs \
  --base-url http://127.0.0.1:4173 --fixtures \
  --fixture-money-failure wrong-amount --output reader-money-wrong-amount.json
```

This command must exit with status 1. `unavailable` and `wrong-amount` must fail
`money-fixture-official-amounts-period-and-source`; `missing-as-zero` must fail
`money-fixture-separate-committees-missing-versus-zero`. Each saved result must
also contain a passed `money-lane-opens-legislator-money-tab`, exactly 1 failed
check and 0 blocked network actions. Ordinary positive runs omit
`--fixture-money-failure`. Run the focused tests with:

```sh
node --test apps/frontend/scripts/test-reader-completion-policy.mjs \
  apps/frontend/scripts/test-reader-completion-money.mjs
```

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

The live campaign-money check proves navigation to the selected tab. The extra
fixture checks prove that the tested client displays specified committee records,
amounts, periods and source destinations, and keeps missing totals distinct from
filed zeros. They do not audit production totals, verify live Board availability,
or cover every loading and error state. The bill-source check proves that the click reaches a successful official
bill destination whose bill number, year, and session match the selected bill
and whose text contains that bill identifier; it does not audit every official
source or every statement Alethical prints.

These checks do not cover sign-in, email, subscribing, tracking, comments,
address entry, paid generated answers, phone interactions, every menu, visual
quality, full accessibility, or the underlying financial calculations. Changes in those areas still
need their relevant checks and the independent reader review specified by
[the browser testing skill](../../.claude/skills/browser-user-test/SKILL.md).
The postrelease check exercises the actual hosted client and API; the fixture
check does not exercise production routing, server-rendered bootstrap data,
production configuration, or outside-service availability.

## Impact and prevention record

- Cause and evidence: code checks cannot establish that an actual reader action
  works or that the intended commit reached readers; a selected campaign-money
  tab alone also passed when every money request returned HTTP 503. The release
  stamp and named browser actions provide separate completion evidence
- Affected uses: bill search and official sources, legislator profiles, editorial
  articles, campaign-money navigation and scoped figure display, and
  release-recovery completion
- Approved differences: public deterministic checks run automatically; independent
  reader judgment and affected feature checks remain separate; required human
  reviews remain 0
- Shared correction: 1 guarded runner supplies the same named evidence to premerge,
  main-release, manual, and reusable recovery runs
- Prevention checks: target, commit, method, host, auth-field, metrics, and private
  path guards have focused tests; fixture builds cover actual client navigation
  and committee-scoped figures; deliberately unavailable, wrong-amount and
  missing-as-zero responses must fail after successful tab navigation
- Remaining uncertainty: the scoped checks cannot establish all product behavior;
  failed setup or an unexecuted later action supplies no completion evidence
- Owner and authorization: the releasing coding agent owns failures, fixes,
  independent review, live checks, and acceptance under the approved completion
  requirements
- Completion condition: relevant code checks, the named live actions for the
  intended release, and independent review pass before work is declared complete

Docs check: Money fixture checks now cover committee-scoped amounts, years, sources,
coverage and copy dates, separate committees, and missing totals versus filed zeros.
Live navigation, unrelated unavailable fixture sections and financial-calculation
limits remain explicit. Address-entry checks remain outside this required gate.
