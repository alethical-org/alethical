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

Implementation and independent payment-file publication shipped in
[pull request 2511](https://github.com/alethical-org/alethical/pull/2511).
Website page clearing shipped in
[pull request 2716](https://github.com/alethical-org/alethical/pull/2716).
Activation and per-family automatic-run acceptance completed October 25.
Follow-up remains in Codex chat `01a1731c-352c-7213-8435-65f7a90017a4`, working folder
`/Users/eug/.codex/worktrees/bb22/Alethical`, branch
`codex/finish-record-refresh-activation`. The earlier implementation folders remain
retained. [Coverage and recovery](../operations/public-record-refresh-status.md)
owns the live settings, source holds and completed-run evidence.

## Source cadence, lanes and clearing

Each job gets 1 bounded turn per dispatch; lanes keep collectors of the same source
from overlapping, priority favors new records and lateness grows without a cap, so
old reconciliation still gets its turn. A turn that exits 75 stays due at once; a
turn refused by a busy lease exits 76 and never advances its success date.

| Family | Job | Every | What a turn does |
| --- | --- | --- | --- |
| campaign | `campaign-discovery` | 15 minutes | Reads the 6 official register and report lists; queues collection on a change |
| campaign | `campaign-money` | 1 day, or sooner on a change or a Board catch-up | Collects and publishes totals and the 3 payment files without long checks |
| campaign | `campaign-completion` | 1 hour | Finds filed reports newer than the published totals and filings hidden by a confirmed account's reviewed years; asks the Board about up to 25 lagging filers, members first; asks for totals when the Board is ahead (see [Filed reports stay owed until pages catch up](#filed-reports-stay-owed-until-pages-catch-up)) |
| campaign | `campaign-rechecks` | 5 minutes, only while a checkable file or money page clearing is owed | Finishes at most 10 owed committee-year checks within 120 seconds and 10 requests; a held file waiting for a complete source read owes no turn |
| campaign | `filing-dates-recent` | 1 hour | Dates up to 25 current and prior-year reports in 120 seconds, saving its position |
| campaign | `filing-dates` | 1 day | The same bounded turns across 2022 onward; restarts for a newly published register |
| campaign | `refunds`, `donor-proof-preparation` | 30 days, 1 day | Recheck refund bytes; prepare donor evidence privately for review |
| notices | `notices` | 15 minutes in July, August, October and November, else 1 hour | Collects newly posted notices |
| notices | `notice-amendments`, `statement-amendments` | 7 days | Reread retained notices and statement catalogues for corrections; statement PDFs the Board does not hold mark the turn for review and are asked for again |
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

## Filed reports stay owed until pages catch up

A new report on the Minnesota Campaign Finance Board's lists is not finished when its
list change is handled. The Board updates a filer's summary figures days after the
report appears, and a valid copy of the older figures used to consume the change.
`campaign-completion` (`alethical/pipeline/campaign_money_completion.py`) recomputes
what is owed from the published data every hour, so no run can mark it done:

- **Behind**: a regular report in the live snapshot ends later than the period its
  filer-year's stored summary covers. A report's period ends on the earlier of its
  cut-off and filed dates, because a termination report is listed with December 31.
- **Board ahead**: up to 20 sitting legislators' committees and 5 others are asked
  for their summary each turn, least recently asked first, through the shared request
  budget. When the Board covers a later period than ours, `totals_catch_up` is saved
  in `cf_refresh_state` and `campaign-money` is requested, at most once every 6 hours.
  The totals planner treats the record as a reason to fetch totals and removes it
  only after a successful totals run that started after it was seen.
- **Hidden by reviewed years**: a confirmed legislative account has a filing in a
  year outside the years recorded at review, so the profile leaves it out. The check
  never widens a reviewed range; it reports the case for a person.

The turn exits 2 (review) when filings are hidden or the Board has been ahead for over
14 hours, and 1 when every Board request failed. Its finding is shown on the grouped
health issue.

**Failures carry their reasons and reach the owner.** The shared runner gives each
collector its own stage-record file (`collection_run_summary.py`), keeps a failed
collection's stage names, check names, committee numbers and years as its finding,
and appends the records to the workflow's artifact. Free-text details are never
kept, because the finding is shown on a public issue. The health reporter prints
those facts and mentions the maintainer in a comment when a job or reason is new;
the same reason repeating stays quiet. Editing an issue body notifies nobody, so the
mention is what reaches a person. The old per-workflow failure review
(`.github/workflows/collection-failure-review.yml`) still covers hand runs of the
retired campaign and notice workflows only.

**Declined parts of the October 27, 2026 completion proposal**, with the condition
that would reopen each:

| Proposed | Why not now | Reopen when |
| --- | --- | --- |
| A sitewide ledger of owed work for every source version | The demonstrated misses were in campaign money; other families already keep saved progress, failed-record queues and clearing obligations. A second scheduler-like store would duplicate them | A family shows an owed change consumed without reaching its page |
| Publishing verified parts of a held payment file | Needs proofs of complete partitions, per-part dates and exact restoration; the whole-file hold is the safe default | The 2017 general-spending loss stays unexplained past the next filing deadline |
| Reading report PDFs to replace lagging Board summaries | A new PDF is evidence, not permission to replace summary totals; no reader is proven for that field | A pinned reader is proven on report totals against the Board's own summaries |
| An event-triggered paid repair agent | Needs spending approval and an execution route; the existing paid review in the failure workflow is also off | Spending is approved with per-case and monthly limits |
| A continuously running collection worker | No measured queue or setup delay yet shows the hourly and 60-second wakes miss a target | Measured delay from Board catch-up to page exceeds the 6-hour spacing |
| Shorter totals publication locks | The 11-minute totals transaction delayed another collector; no reader-facing blockage was shown | A publication lock delays a reader-facing update |

## Build acceptance criteria

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
7. Preserve the combined-check and release evidence on
   [pull request 2511](https://github.com/alethical-org/alethical/pull/2511), and
   retain the working folders for follow-up. The activation owner above retains
   the final live acceptance record.

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

## Implementation evidence

[Pull request 2511](https://github.com/alethical-org/alethical/pull/2511) completed
the source and independent-payment integration. Production runs schema
`0074_source_refresh`, after migrations `0072` and `0073`. The merged release and
follow-up pull requests retain their current-head checks and independent reviews;
[coverage and recovery](../operations/public-record-refresh-status.md#current-state)
records the deployed source outcomes.

Source-only October 24 measurements distinguish the full inventory from dated-action
discovery and actual bill rereads; [bill refresh cadence](../architecture/bill-refresh-cadence-decisions.md#fast-dated-action-discovery)
owns the parameters, counts, timing, phase choice and coverage limits. Those source
measurements did not write records, embed text or change production settings.

## Source coverage checklist

A checked item has completed a named verification turn in production on current
code. Bill discovery completed on October 25 in
[run 40195099730](https://github.com/alethical-org/alethical/actions/runs/40195099730)
with the existing changed-text search approval enabled. A quiet discovery turn does
not prove a full inventory or a changed-text embedding occurred.

- [x] Bill recent-action discovery: both chamber date lists and a saved successful
  check in run 40195099730
- [ ] Full bill inventory and changed-text search publication in the automatic cycle;
  recent-action discovery alone does not establish either result
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
- [x] Activation settings, automatic checks for all 6 families, clearing recovery,
  affected docs and live read paths; historical catch-up remains separate

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

## Earlier implementation checkpoints

These checkpoints describe work before the merged release and October 25 activation
above; their pending states are historical.

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

The implementation used Claude Opus 5.5 at high effort with independent review.
The October 25 activation continuation keeps configuration and final acceptance in
its owning Codex chat, with a separate read-only reviewer. API dispatch, source
collection and publication remain separate permissions and completion facts.
