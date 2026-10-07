# Automatic public-record updates

## Authorization and completion

Eugene requested a comprehensive assessment of routine state-record collection,
then on 7 October 2026 said: “build everything and report if we should keep
improving anything further”. The outcome is scheduled, checked updates reaching
readers, with retained good records after incomplete downloads and recoverable
unfinished downstream work. A merged importer alone does not finish this task.

Existing holds remain: no recurring AI summaries or real notification sends;
no 2015–2021 campaign-total expansion; reviewed identity matches, scanned-document
readings and donor-proof publication remain reviewed. Changed bill text retains
the approved atomic search-embedding update from
[issue 1323](https://github.com/alethical-org/alethical/issues/1323).
New statute and hearing products are outside this build.

## Work and ownership

| Order | Work | Owner | Completion proof |
| --- | --- | --- | --- |
| Parallel | Campaign download, reconciliation, lease and amendment fixes | money_refresh_build | Focused tests, current-source diagnosis and committed changes |
| Parallel | Bill fingerprint refresh, source request limits, roster and vote safety | legislative_refresh_build | Complete/incomplete source tests, bounded refresh commands and migration round trip |
| Parallel | Election, map, ZIP and cited-source release checks | supporting_refresh_build | Official-source checks, retained approved data and focused tests |
| Parallel | Durable due-work runner, lobbying refresh and pending downstream work | parent ingestion* | Concurrent claim, restart, timeout, failure and retry tests |
| After branches | Integration and independent review | parent plus fresh reviewer | Every affected source accounted for; tests against combined code |
| After review | Release and safe initial collection | parent ingestion* | Current-head checks, merged release, deployed version and source-specific read-back |
| After release | Further-improvement report and cleanup | parent ingestion* | Actual remaining gates and recovery locations |

Parent owns shared scheduler, database models for scheduling, workflow wiring,
central operations inventory and this plan. Legislative worker owns migration
0067_source_request_limits; scheduler migration follows as 0068.

## Source coverage checklist

- [ ] Bills: reviewed sitting intervals, new-session catch-up, source fingerprint
  first, bounded shared request rate, official discovery coverage, atomic search
- [ ] Votes: newly available rolls and bounded corrections, unmatched-source evidence
- [ ] Roster: full coverage before departures; contacts, photos, service and committees
- [ ] Lobbying: daily paired source copy, privacy, retained releases, saved-page clearing
- [ ] Campaign money: daily payments, changed lists and weekly supported totals,
  historical rechecks, exact per-stage publication evidence and reviewed recovery
- [ ] Filed dates, refunds, notices and statement amendments: source-specific checks
- [ ] Donor proofs: exact-generation preparation and review queue, never autoapprove
- [ ] Candidates: public source-contract and election-change checks without retaining
  visitor addresses; no invented address-free feed or automatic identity matching
- [ ] Maps and ZIP: official release detection and reviewed replacement
- [ ] Cited article sources: retries, repeated-unavailable evidence, no silent rewrite
- [ ] Calendar rollovers: discover changes and hold unknown mappings for review
- [ ] Health: completed source coverage, overdue work, separate checked/copy dates
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
  Previous rows and archives have a guarded rollback proof. Payments wait for totals
  acceptance and rollback readiness. No payment exception is authorized.
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

## Model selection

The lead owns cross-source accuracy, crash recovery, release safety and credential
scope. The recommended lead pair is gpt-6-astra/high; gpt-6.1-sol/high is suitable
for bounded collector implementation with focused tests and independent integration
review. This is a task judgment from the host's supported models and current model
selection guidance, not a measured speed or quality comparison. API dispatch,
source collection and publication remain separate permissions and completion facts.
