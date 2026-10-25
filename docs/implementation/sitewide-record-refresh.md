# Automatic public-record updates

## Authorization and completion

Approved scope is routine collection of all existing public records, with prompt
updates after official publication. Completion means scheduled, checked updates
reaching readers, retained good records after incomplete downloads and recoverable
unfinished downstream work. A merged importer alone does not finish this task.

Existing holds remain: no recurring AI summaries or real notification sends;
no 2015–2021 campaign-total expansion; reviewed identity matches, scanned-document
readings and donor-proof publication remain reviewed. Changed bill text retains
the approved atomic search-embedding update from
[issue 1323](https://github.com/alethical-org/alethical/issues/1323).
New statute and hearing products are outside this build.

## Current continuation and ownership

The October 24, 2026 authorization covers full implementation and proactive
updates to existing records, including separate checked payment files. Federal
expansion remains deferred. Existing paid-summary, user-send and evidence-review
boundaries remain in force.

Claude Code owns the remaining implementation, integration, release, activation
and live acceptance in the managed folder
`/Users/eug/.codex/worktrees/source-refresh-continuation/Alethical`, local branch
`codex/source-refresh-continuation`, pushed to the existing draft branch of
[pull request 2511](https://github.com/alethical-org/alethical/pull/2511) without
rewriting its history. The independent payment-file work (`b7fc79b1`, `2b3895ec`,
`154b3149`, `eeaa2071` from `codex/independent-payment-files`) ships inside that
pull request rather than as a second one, so the same commits never merge twice.
Website page clearing shipped separately in
[pull request 2716](https://github.com/alethical-org/alethical/pull/2716).
The Codex parent chat keeps status and final read-only acceptance.

## Source cadence, lanes and clearing

Each job gets 1 bounded turn per dispatch; lanes keep collectors of the same source
from overlapping, priority favors new records and lateness grows without a cap, so
old reconciliation still gets its turn. A turn that exits 75 stays due at once; a
turn refused by a busy lease exits 76 and never advances its success date.

| Family | Job | Every | What a turn does |
| --- | --- | --- | --- |
| campaign | `campaign-discovery` | 15 minutes | Reads the 6 official register and report lists; queues collection on a change |
| campaign | `campaign-money` | 1 day, or sooner on a change | Collects and publishes totals and the 3 payment files without long checks |
| campaign | `campaign-rechecks` | 5 minutes, only while a checkable file or money page clearing is owed | Finishes at most 10 owed committee-year checks within 120 seconds and 10 requests; a held file waiting for a complete source read owes no turn |
| campaign | `filing-dates-recent` | 1 hour | Dates up to 25 current and prior-year reports in 120 seconds, saving its position |
| campaign | `filing-dates` | 1 day | The same bounded turns across 2022 onward; restarts for a newly published register |
| campaign | `refunds`, `donor-proof-preparation` | 30 days, 1 day | Recheck refund bytes; prepare donor evidence privately for review |
| notices | `notices` | 15 minutes in July, August, October and November, else 1 hour | Collects newly posted notices |
| notices | `notice-amendments`, `statement-amendments` | 7 days | Reread retained notices and statement catalogues for corrections |
| legislative | `bills-discovery-<session>` | 5 minutes while the session's bill interval is 4 hours or less, else 15 minutes | Rereads up to 25 bills with dated actions from both chambers |
| legislative | `bills-backdated-discovery-<session>` | 1 day | Rereads a 14-day dated-action window for delayed publication |
| legislative | `bills-<session>` | The approved phase interval | Full official inventory reconciliation, 100 bills per chunk |
| legislative | `votes` | 1 hour or the session interval if shorter | Collects missing rolls and rotates through saved rolls for corrections |
| legislative | `roster-discovery`, `roster` | 15 minutes, 4 hours | Roster PDF validators and hash; full member, contact and committee refresh |
| lobbying | `lobbying-discovery`, `lobbying` | 15 minutes, 1 hour | Download links from the landing page; full paired file publication |
| supporting | `maps-discovery`, `maps`, `zip`, `candidates`, `sessions` | 1 hour to 1 day | Detect official changes and queue review; never replace approved data |
| fcc | `fcc` | 1 hour | Existing 3-station collector with its original download, mirror and reading limits; files the FCC lists but does not serve mark the turn for review and stay in the gap report |
| any active | `source-clearing` | 5 minutes, only while owed | Retries owed saved-page clearing without collecting |

Every family's downloads share 1 per-host request budget in `source_request_limits`,
including FCC listings, redirects and files; a 429 or 503 reply pauses that host for
its stated `Retry-After`. Bill, vote and roster writes and newly stored filing dates
owe saved-page clearing in the same transaction as the records; the route is in
[api-cdn-setup.md, clearing a saved copy](../operations/api-cdn-setup.md#clearing-a-saved-copy).

## Current completion checks

1. Preserve the current address-index lifecycle, both email lifecycles, retained
   source dates, FCC scope and the current reader dependencies when integrating main.
2. Chain request-limit migration0073 after payment migration0072 and refresh
   migration0074 after0073; complete local upgrade/downgrade/upgrade checks after
   the final payment schema arrives. Keep `pypdf[fonts]>=6.21.1`, resolved6.21.2,
   with fonttools4.66.1 and Pillow13. Reader claims need document regressions.
3. Verify the cheap 6-list campaign discovery, bounded dated-action discovery,
   late-change signals, fair turns, independent urgent notices and bounded money
   checks. A partial turn never advances full source coverage.
4. Verify the shared short notice/statement mutation lock, distinct collector
   owners, stale-owner refusal, complete materialized register and pointer checks.
   Scoped or incomplete statement scans never advance the full-copy marker.
5. Reuse the existing 3-station FCC collector with its private storage, local
   reading tools, bounded backlog and continuing issue. Preserve its Actions queue.
6. Prove disabled-family defaults and legacy schedule continuity; complete setup,
   automatic collection and measured public read-back with the release owner.
7. Run combined checks on current main, advance existing draftPR2511 normally and
   retain this folder for follow-up. Production setup, release and activation stay
   with the parent chat.

## Shared impact and prevention

New notice and statement collection share notice-amendment rows. Separate collector
owners prevent duplicate full scans; a short common lock serializes each shared
mutation. Every write fences its owner under a database row lock, including after
an expiry or competing replacement. Money collection uses a different lock. A
repeatable-read reference materializes the complete register and payment subtypes;
completion locks and verifies current pointers before replacing exclusions or
recording complete coverage. Retained records survive partial sources.

Urgent discovery has independent lanes, while bill actions and votes retain a
shared lane. Each selected job gets one bounded turn. Priority favors new records;
durable first-due times and increasing lateness give old reconciliation a turn.
A source change observed during collection has a separate durable signal, so a
late completion cannot erase it. A completed turn acknowledges its dispatch and
can continue immediately; an ambiguous queued request retains duplicate protection.

FCC delegates to the existing collector and fixed station scope. Numeric sanitized
reports distinguish backlog, source gaps and processing failures. A late Actions
report cannot replace a newer run's FCC issue counts or close its unfinished-work
report. Fast-source retries and busy deferrals never exceed their own cadence;
HTTP busy replies still enforce the shared source cooldown. Default-off
families retain old clocks until staged activation. Parent acceptance covers current
schema integration, spending intent, actual settings and measurable public results;
local tests alone cannot prove those live facts.

## Local continuation evidence

The current-main integration preserves merge `29dbb061` and main `4c99ecf9` through
merge `75296eb6`. The source implementation checkpoint is `f25a0587`. Normal
commit hooks passed. The combined source, notice, legislative, supporting, lobbying
and Minnesota-ingestion selection passed 277 tests; the existing FCC report passed
8 Node tests. The current additive source schema round-trip passed with RLS on its
3 operational tables. The final payment migration revision and combined money
integration still require their own current-head checks.

Source-only October 24 measurements distinguish the full inventory from dated-action
discovery and actual bill rereads; [bill refresh cadence](../architecture/bill-refresh-cadence-decisions.md#fast-dated-action-discovery)
owns the parameters, counts, timing, phase choice and coverage limits. None of those
measurements wrote records, embedded text, sent mail or changed production settings.
The release owner still owns activation, public read-back and final acceptance.

## Source coverage checklist

A checked item has completed a named verification turn in production on current
code. Bills stay unchecked until the approved changed-text search update is switched
on, because bill turns refuse to run without it.

- [ ] Bills: reviewed sitting intervals, new-session catch-up, source fingerprint
  first, bounded shared request rate, official discovery coverage, atomic search
- [x] Votes: newly available rolls and bounded corrections, unmatched-source evidence
- [x] Roster: full coverage before departures; contacts, photos, service and committees
- [x] Lobbying: daily paired source copy, privacy, retained releases, saved-page clearing
- [x] Campaign money: daily payments, changed lists and weekly supported totals,
  historical rechecks, exact per-stage publication evidence and reviewed recovery
- [ ] Filed dates, refunds, notices and statement amendments: source-specific checks
- [x] Donor proofs: exact-generation preparation and review queue, never autoapprove
- [x] Candidates: public source-contract and election-change checks without retaining
  visitor addresses; no invented address-free feed or automatic identity matching
- [x] Maps and ZIP: official release detection and reviewed replacement
- [ ] Cited article sources: retries, repeated-unavailable evidence, no silent rewrite
- [x] Calendar rollovers: discover changes and hold unknown mappings for review
- [x] Health: completed source coverage, overdue work, separate checked/copy dates
- [ ] All affected documentation, tests and live read paths

## Impact and prevention record

The October 6 baseline is main 6b930071; implementation starts from 5729ab64.
Campaign refresh failed 12 times through October 6, with previous good totals and
payments retained. Header-only campaign downloads can falsely contradict every
confirmed identity. Historical money checks use fewer years than publication.
Roster/committee parsers can mistake partial successful HTTP replies for complete
records. Most reference sources lack scheduled discovery. GitHub scheduled jobs
have started hours late, so merely adding timers does not prove a freshness bound.

Prevention: validate complete source contracts before replacement, preserve accepted
data, persist due work and outcomes, bound retries and overlap, separately observe
missed deadlines, and exercise failures and restart recovery. Keep distinct source
dates and proof requirements. A monitor reports a missed update; only a working
collector repairs it.

No new paid recurring service is authorized by this plan. Hosting the durable
runner requires an observed existing capacity or an explicit cost decision.
Scheduled GitHub jobs use the existing public repository's free standard runners.
The final report must distinguish installed code, active schedules, successful
collections and changes awaiting source access or human review.

## Progress

- 7 October: fresh isolated parent branch and 3 independent build branches started.
- 7 October: confirmed October 6 campaign refresh still fails the same source guards;
  source recovery began later in this build as recorded below.

- Integrated campaign, legislative and supporting branches. Parent scheduler persists
  due times, chunk progress and source findings; source lanes prevent overlapping
  collectors, and shutdown stops the owned child process group.
- New hourly GitHub workflow checks due jobs; an optional bounded API dispatcher
  uses a dedicated repository-scoped GitHub App. GitHub's human identity check is
  pending in Chrome. The dispatcher is not active. Public runners do the collection;
  the existing Railway API only queues work. No new paid service was created.
- New shared runner tests: overlap, stale-owner finish, shared-source lanes, review
  versus failure, interrupted chunks, deadline budgets and process shutdown.
- Independent review found profile and filing-date false-success paths and partial
  source deletion risks; workers are correcting those before release.
- Campaign recovery has begun from the retained October 6 candidate under the exact
  3-pair decision on [issue 2394](https://github.com/alethical-org/alethical/issues/2394#issuecomment-6041765554).
  Previous rows and archives have a guarded rollback proof. Payment publication followed totals
  acceptance and rollback readiness. No new payment exception was used.
- Build tracking: [issue 2504](https://github.com/alethical-org/alethical/issues/2504).
- Totals recovery published `131cb870-5a5a-4278-88fe-2f39b65604cc`.
  The 3 retained filer-years preserve their September 24 source dates; 41280/2025
  now carries the official amended $3,414.16 total. Guarded rollback readiness
  passed before the subsequent payments load. Payments published
  `0a9c063d-3167-4ff2-9324-8fa1c7a8e671` and its report-document rechecks are running.
  The local Cloudflare credential cannot clear saved answers (401); the existing
  GitHub collection credential will be tested in the deployed workflow.
- Full backend run: 4,358 passed, 13 failed. All 13 failures were corrected:
  the missing source-limiter model, 2 outdated fake constructors covering 4 tests,
  and the maintained job inventory. Focused repair checks passed; final combined
  checks and release remain pending.
- Existing Railway production `alethical-api` is the only service. Its summary
  switch and 4 spending settings are unset. Its existing embedding credential is
  now available to the GitHub bill-refresh job; no new key or paid request was made.
- Added pypdf's `fonts` extra after real Board PDFs reported a missing CFF font
  decoder. The held 41280/2025 amended PDF still extracts $3,414.16 with the decoder.

- Final combined local upload checks passed 4,388 backend tests. Later independent
  review fixed atomic publication follow-up markers, full-year recheck obligations,
  incomplete-roster freshness and ongoing bill discovery despite retained failures.
  Those fixes passed focused tests and await the final combined upload checks.
- [Pull request 2511](https://github.com/alethical-org/alethical/pull/2511) is the
  draft release. A test-only database password triggered GitHub's secret scanner;
  the fixture now assembles its deliberately fake value at runtime, and the branch
  history scan reports 0 findings. No real credential was present.
- The existing hosted-settings check encountered a provider renewal HTTP 404, then
  passed once rerun through its existing serialized workflow: all 18 Supabase
  settings matched and both encrypted state copies were saved. Evidence is on
  [issue 2495](https://github.com/alethical-org/alethical/issues/2495#issuecomment-6042502909).
- The campaign rollback proof is retained in owner-only local storage under
  `~/.local/state/alethical-record-refresh/2026-10-07/`. It describes the pre-payment
  baseline and correctly refuses restoration after a different payment release.

## Model selection

Claude Opus 5.5 at high effort owns the remaining integration and release, with
independent fresh-context review for production, security and schema work. This is
a task judgment from current model guidance, not a measured comparison. API
dispatch, source collection and publication remain separate permissions and
completion facts.
