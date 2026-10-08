# Google indexing alerts, 7 October 2026

Tracking: [issue 2516](https://github.com/alethical-org/alethical/issues/2516).

## Authorized outcome

Approved scope: recap previous search work, investigate the new Google alerts,
repair demonstrated problems, prevent recurrence and arrange routine review without
forwarded screenshots. The Codex task (seo, 01a117ab-5b6b-7b01-8a5d-f46e3a3c01b5)
owns implementation through completion, with Claude consultation on important
decisions. Keep publication, privacy, source accuracy and spending boundaries intact.

## Impact and prevention

- The existing free daily/release search check covers sitemap addresses but excludes
  record query variants. Google's all-known-pages report includes those variants.
  The submitted-pages filter hid the reported server errors from the earlier review.
- Add separately validated public variants, preserving the strict discovery rules.
  Cover committees, payments, legislators, races and bill text tabs. Check preferred
  addresses and exact year-bearing data. Missing optional data is reported as unproved,
  never counted as successful proof of the requested year.
- Preserve deliberate exclusions, genuine missing pages and the 5-minute money-page
  cache windows. Do not hide outages with invented figures or stale identity claims.
- Daily HTTP checks cannot observe Google's complete saved report. The routine review
  route remains under assessment; no public endpoint exposing private Google reports
  or consuming an unbounded inspection quota is approved by this investigation.
- Historical cause remains unknown. Current successful reads cannot prove an old
  outage is repaired. Recent hosting logs show 2 committee-page 503 responses on
  7 October at 18:12 and 18:17 UTC, both cache misses. Diagnose before revalidation.
- Deployment comparison: the serving website was created at 17:23:02 UTC.
  Railway's 18:16:56–18:19:50 release overlaps the later failure, but not the earlier
  one. Its previous release succeeded at 17:53:43. Association does not prove cause.
  Add fixed, private-text-free failure classification at both 503 exits and keep
  cache behavior unchanged. The labelled 20:41 failure now supports the bounded read recovery described below.

## Evidence and current state

Google Search Console, domain property `alethical.com`, all known pages, report
updated 3 October 2026: 37 server errors, 5,441 intentional-or-unreviewed exclusions,
5,219 canonical alternatives, 54 redirects, 18 duplicates without selected canonical,
5 missing pages, 9,090 discovered but not indexed, 516 crawled but not indexed,
1 different Google canonical and 87 soft 404s. These categories are not all defects.
Rounded headline counts are 11.3K indexed and 20.5K not indexed.

- All 37 server examples return 200 now. The failed validation contains 35 committee
  examples last crawled 28–29 September and 2 pending September examples. Never retain
  the prefilled Ask question in public evidence.
- All 18 missing-canonical examples now resolve appropriately: 2 bill text variants
  name their base record; 16 old legislator IDs permanently redirect to named records.
  Every redirect target returns 200. Google's 7 October live test of SF123's text
  view succeeds and its rendered HTML names the base bill address. The saved error
  was crawled on 6 August. Google accepted validation for this category on 7 October.
- The 2 reported committee payment pages return 200. `/Home` is genuinely absent,
  with 404/noindex; the bare hostname forwards to the same canonical-host address.
  The API root is not a public reader destination and currently returns 403.
- `/blog/guides` names itself. `/read/guides` permanently redirects there (308).
  Google last crawled the former on 30 September and still selected the old address.
  Google's live test on 7 October succeeded; a single indexing request was accepted.
- The expanded broader live check passes all 96 checks. All 42 offline checker tests
  pass. Separate output flags distinguish payload year proof from omitted optional data.
  Race variants use the sitemap's current year; variant-selection failure does not
  skip missing/private checks. Special-session bill IDs are supported within the
  actual bounded ID shape. All 87 soft-404 examples currently pass;
  they are 66 base bill pages, 16 bill directory pages and 5 bill tab variants.
  Their Google validation began 6 October and remains running.
- All 54 redirect examples reach a 200 response on the canonical website.
  Redirects are expected exclusions, not pages to force into the index.
- Google's 3 October **All submitted pages** view has 82 soft 404s, 9,090
  discovered-not-indexed, 97 crawled-not-indexed and 0 server errors. It reports
  no noindex or canonical-alternative exclusions for its submitted population.
  This differs from all known addresses and is not a current inventory audit.
- The 1,000 exported noindex examples and 1,000 canonical alternatives have no
  exact overlap with the 18,599 sitemap addresses. This is a sample, not proof that
  every exclusion is correct. Preserve search/private/payment filter exclusions.
- A bounded 24-hour Vercel read returned 15 serverless 503 responses in 51.85 seconds.
  A longer 3-day read timed out; hourly bounded collection will retain aggregates.
  No saved error includes a cause, so the new classification is still needed.
- Failure classification has 20 new focused tests; all 187 page-endpoint tests pass.
  Exact committee/year validation refuses malformed or mismatched source payloads.
- A weekly token-consuming report review requires separate approval. It would use
  the account allowance; its per-run cost is unknown. Free build work continues,
  and no recurring AI task has been armed.

Raw exports and response evidence stay private outside this checkout in the task's
visualization folder, under `seo-alerts/`. Provider decisions may lag a successful
response; no result here guarantees indexing or ranking.

## Retaining future failure evidence

The free hourly collector queries a fixed completed UTC hour and retains only
strictly allowlisted aggregate counts and minute-level times for 35 days. Treat
all GitHub artifacts as public. Never save raw messages, identifiers, paths, query
values, source bodies or credentials. A truncated sample and a failed collection
remain explicit. A daily coverage check catches repeated gaps without an
hourly failure-email storm. Existing Vercel access is scoped to the collector step;
trusted main only, no pull-request code or new access grant.
Any saturated hour fails daily coverage, even during startup. After the fixed
24-hour startup window, 3 missing or failed hours fail coverage; 1 or 2 remain
explicit but do not fail it. Delayed GitHub schedules can leave missed hours.
Public page routes use server functions, so collection keeps the serverless
source filter. Static asset failures are excluded. Provider failures before a
function runs may leave no runtime record; bounded public checks remain separate.

The existing project token allows read-only Railway API access when the client sends
a User-Agent header. The dashboard has `/healthz`; both historical deployment
records and the resolved file use `/readyz`, a 300-second startup check and 1 replica.
File settings take precedence. Overlap/drain values are null, which does not establish
the platform's effective defaults. The candidate process starts at 18:19:37 UTC,
becomes ready at 18:19:39 and the prior process stops at 18:19:52. Both reader failures
precede that switch. Bounded prior-process logs contain nearby finance 200 replies,
but no shared request IDs, query values, durations or body evidence connect them
to the failing website reads. No recognized timeout or shutdown appears in either
failure-minute sample. Leave handover and the 5-second read limit unchanged; the
20:41 labelled failure supports committee-only read recovery.

Server-error revalidation waits for a demonstrated repair that is live, or 7
consecutive complete, unsaturated daily sets with zero reader-page 503s. This is
a conservative operating threshold, not Google's published rule or a guarantee
that failures cannot recur. Missing or unclassified evidence cannot prove stability.
Reader pages exclude administration and private account routes; their failures
remain counted separately and cannot establish a public indexing defect.
A natural classified failure now establishes the stalled committee-response class;
the pre-label fast failures and the lobbyists-list event remain unexplained.

The local collector read for 18:00–19:00 UTC succeeded with 2 committee 503s,
matching the original private source records and retaining no raw text. All 75
combined offline checks pass, including hostile data, auth boundaries, truncated
messages, time windows, failed startup, missing coverage and artifact limits.
The hourly collector shipped in [pull request 2519](https://github.com/alethical-org/alethical/pull/2519).
Its first [hosted run](https://github.com/alethical-org/alethical/actions/runs/37681983059)
collected 19:00–20:00 UTC with zero failures and no saturation. The coverage client's
real authenticated artifact read succeeded, followed the signed download without
forwarding credentials, and validated the report. A later
[hosted run](https://github.com/alethical-org/alethical/actions/runs/37686646637)
collected 20:00–21:00 UTC: 3 failures, including the labelled 20:41 committee timeout
after upstream status 200, with no saturation. The other 2 failures came from the
private traffic-admin endpoint. This completes natural failure-record acceptance.

The first release is live at [commit b984d216](https://github.com/alethical-org/alethical/commit/b984d2163395631afce0c7dd3c80351aef76eef3)
([pull request 2517](https://github.com/alethical-org/alethical/pull/2517)).
It adds bounded variant checks and fixed failure labels, without changing timeouts,
cache policy or retry behavior. The released daily public check passed. An
independent browser review passed the committee year, bill text tab, guide article
navigation and candidate form's empty-input recovery; the parent also opened the
live bill text. No phone layout or real address lookup was exercised in this
non-visual release. No runtime failures appeared in the bounded 19:25–19:46 UTC
read; the later 20:41 response supplies the first natural label. Google started duplicate-address validation on
7 October after its live bill test returned the intended canonical address.

## Bounded recovery for a stalled committee response

At 20:41 UTC the website recorded `committee-finance`, `timeout`, upstream 200,
and 1 attempt after 5 seconds. The data response had started but its body had not
finished. A bounded 24-hour provider read ending 20:48 UTC contains 7 committee
503s: 4 near 5 seconds and 3 fast responses (16, 98 and 242 milliseconds). These
are request counts, not distinct pages or an error rate. The same window contains
9 private traffic-admin failures and 1 5-second failure at `/money/lobbying/lobbyists`.
That last response predates labels; its exact failing phase and cause remain unknown.
Do not infer a body stall from duration alone or extend recovery to a slow list query.

Only the required committee finance read may start a second identical GET. It
starts at 2.5 seconds while the original remains alive, or immediately after a
network failure or HTTP 502/503/504. Both share the original 5-second deadline.
A complete answer must match the requested committee and year before it can win.
A terminal first response before a second starts retains its existing outcome.
When both are already running, a failed backup cannot defeat a valid original
answer. With no valid answer, the original request determines the error. Pending
original reads time out as 503; genuine original 404s remain 404. The loser and
both timers are cancelled. Optional reads and cache policy remain unchanged.

This preserves legitimate slower replies: a fresh uncached live committee page
loaded in 1.572 seconds before the change. A separate 13-response timing sample
included a 1.878-second response; that sample is not a full distribution or an SLO.
Tests reproduce stalled 200 bodies, both attempts stalling, transient statuses,
wrong identities and years, malformed data, contradictory backup errors, delayed
original success, deadline races, cancellation, privacy and unchanged optional reads.

A successful read that started 2 attempts emits fixed fields only. Counts distinguish
whether the original or backup won; an original winner does not prove the backup
helped. The hourly recorder searches the recovery marker at the provider, restricted
to successful page responses, with its own 100-row cap, 4 MiB output cap and at most
2 bounded 75-second commands. It never enumerates all successful page requests.
A recovered read followed by a later page failure is outside that success count.
Schema 2 retains separate failure and recovery collection status. Historical schema
1 reports remain accepted as failure-only coverage. Missing, malformed or capped
recovery evidence cannot be reported as complete. Only fixed aggregate labels enter
the 35-day public artifacts.

The recovery and notice-button release is live at
[commit 1ab1be2e](https://github.com/alethical-org/alethical/commit/1ab1be2e8c9006e820ad936f3ca1545c99afe94f)
([pull request 2521](https://github.com/alethical-org/alethical/pull/2521)). All 37
Google server-error examples return 200, retain their preferred address and contain
a title; all 67 daily public checks pass. A new uncached committee-year read returned
200 in 0.81 seconds. This single measurement does not establish a speed improvement.
All 4,478 backend and 4,143 frontend tests passed, including 39 read-recovery cases;
the exact merge commit passed the required queue checks.

Independent live browser acceptance passed Enter and Space on matched notices for
both individual and organization payments, including 390px phone layouts. The correct
payment receives focus, the selected year remains 2026, official PDFs match the
notice, action text and arrows are neutral, and destination links remain green.
The parent repeated the individual Enter and organization Space paths and inspected
the phone layout. Physical touch, actual screen-reader speech and other browser
engines remain untested. The
[hosted schema-2 run](https://github.com/alethical-org/alethical/actions/runs/37693797758)
retained complete, unsaturated failure and recovery channels for 21:00–22:00 UTC.
Its 2 failures were both the private `/api/traffic` endpoint; no recovery marker
occurred. Natural recovery counts remain a follow-up, never a reason to induce a
live outage. Google accepted a new server-error validation on 7 October; its status
is Started, not Passed. Do not restart it while it runs.

## Real scheduled-run acceptance and remaining coverage follow-up

The first automatic
[daily search run](https://github.com/alethical-org/alethical/actions/runs/37693392723)
passed public checks but failed its coverage reader. GitHub returned workflow creation
as `2026-10-07T16:24:18.000-04:00`; the reader incorrectly applied its public artifact's
whole-second UTC format to provider metadata. A separate bounded provider-date parser
accepts explicit offsets and fractional seconds and normalizes to UTC. Public saved
reports retain their strict format. Invalid provider dates produce the fixed
`github-timestamp-invalid` error. Unfinished queued or in-progress runs missing a
start or update date cannot supply coverage and do not hide older completed evidence.
All 5 exact traffic-admin routes (`/api/traffic`, `/api/traffic-performance`,
`/api/traffic-uptime`, `/api/traffic-google` and `/api/traffic-bing`) use the existing
private-admin category; each handler requires the admin guard and failure counts
remain retained. Tests cover actual provider
dates, UTC date/hour rollover, malformed and missing values, original artifact
strictness, unfinished runs, reversed run times and exact private-route matching.
Independent review identified a second reproducible coverage defect: when setup
crossed an hour boundary, predicting the saved hour from the run start could skip
a valid report. Both a first-eligible-hour case and an already-counted predicted-hour
case counted 23 of 24 existing reports before repair. Selection now considers all
eligible hours whose end can fall in the trusted run; the validated report chooses
the actual hour. Both cases count all 24 afterward. Download limits and artifact attribution/time checks stay unchanged. A full-day
transport regression uses 24 scheduled runs, 3 duplicate manual runs and 4 runs
without saved reports; all 24 hours need 78 requests, including real redirects.
The former 76-request cap had no headroom after just 2 report-less runs. A bounded
100-request cap allows extra listings while preserving 24 downloads, 180 seconds
and fixed byte limits. The exhausted-budget test still fails closed.
All 96 combined offline checks pass.
The same coverage tests, read and retained output now run on manual dispatch as well
as the daily schedule. Existing trusted-main and read-only token restrictions remain;
release-triggered checks are unchanged. This provides a real hosted acceptance path
without a fake activation date or a new timer.

An explicitly date-filtered GitHub query found 162 scheduled runs since 23 September,
including 12 on 7 October. The daily search run arrived 4 hours 44 minutes after its
configured time; other scheduled work arrived 6–7 hours late. This supports delayed
provider clocks, not a global timer outage. No account or workflow reactivation is
justified. GitHub documents that scheduled events can be delayed or dropped.
Manual runs prove the hourly collector works, but its first actual scheduled run
has not yet been observed. Do not describe a configured hourly cadence as observed
continuous coverage.

The monitoring repair shipped in
[pull request 2522](https://github.com/alethical-org/alethical/pull/2522), at
[commit 13223d55](https://github.com/alethical-org/alethical/commit/13223d55377ab1e9460512d1f78f448befdb8e8e).
All 4,478 backend tests, current-head checks and exact merge-queue checks passed.
The [hosted coverage run](https://github.com/alethical-org/alethical/actions/runs/37699803305)
uses the genuine 7 October 20:24:18 UTC activation and counts 1 of 1 eligible hours,
including both evidence channels, with zero gaps or saturation. It correctly reports
startup rather than a full day of healthy evidence. The
[hosted collector](https://github.com/alethical-org/alethical/actions/runs/37699565390)
retains the 2 private-admin failures separately and records zero natural recoveries.
All 67 hosted public checks pass. Current website inputs match the served reader
release, so no new website build is needed for the monitoring-only repair.

The current chat (seo, 01a117ab-5b6b-7b01-8a5d-f46e3a3c01b5) owns the remaining
Google and coverage follow-up. Inspect the next 2 daily coverage
reports after the 24-hour startup period. If either has at least 3 missing hours,
review and build bounded catch-up collection; measure eligible-hour coverage rather
than the number of timer executions. A 3-hour catch-up query is a candidate, not a
settled implementation. Keep all request, privacy, saturation and evidence bounds.
Weekly AI review still waits for the separate recurring-usage approval.

## Work sequence

### Separate committee-notice failure

Sentry groups ALETHICAL-API-E and ALETHICAL-API-F contain 19 historical failures
at the notice sort, from 25 September through 5 October. A read-only production
query identifies 2 committee/year groups with the same contribution date and mixed
known/missing Board received dates: registrations 19304 and 41348, both 2026.
Both public notice requests returned 500 on 7 October. These requests may add
events beyond the original 19. Missing Board dates are valid source data.

The shared notice sorter compared a date with `None`. Preserve the contribution-date
ordering, sort missing received dates last within that date, retain null in the
response and add a stable ID tie-breaker. All 41 notice tests pass, including 8 new
cases covering mixed and missing dates, equal facts, amount/date priorities, source
links and exact payment matching. No data replacement or invented date is needed.

This repairs absent notice cards, not the unexplained whole-page 503 responses:
the page function catches optional notice request failures. That catch also exists
in the 25 September version. Release acceptance requires both affected requests to
return 200 with missing dates preserved, and a working committee notice card.
The API release is live at [commit 9344208f](https://github.com/alethical-org/alethical/commit/9344208fbbb40f3b2447c1c741df39acd34703cb)
([pull request 2520](https://github.com/alethical-org/alethical/pull/2520)). Both
affected requests return 200 with 3 notices and 1 missing received date each.
The 18336 control returns 200 with all 10 missing received dates preserved.
Independent browser acceptance shows the notices and official PDF links on both
2026 committee pages. Sentry groups
[ALETHICAL-API-E](https://alethical.sentry.io/issues/7754990405/) and
[ALETHICAL-API-F](https://alethical.sentry.io/issues/7757007174/) are resolved after
live acceptance; the release selector did not yet contain the repair, so resolution
was not incorrectly attributed to its older listed release. Google server-error
follow-up remains separate.
The same acceptance exposed a separate existing keyboard defect: the matched-payment
jump was a focusable link without an address, and Enter did nothing. Both parent and
independent browser checks reproduce it on the Kosiak notice for registration 41348.
The action changes controls and focuses a payment within the same screen. Use the
existing payment-control button semantics while preserving its visible text and arrow;
PDF links remain links. Component tests cover native button semantics, keyboard focusability, pointer
activation and exact targets for Individuals and Other kinds. Browser Enter/Space
activation remains a release check; the unit-test browser does not synthesize native
button key activation. Repeat the reader path after release. This correction applies to every matched notice
through the shared notice-row component, not unrelated navigation.
The full frontend suite exposed the existing destination-arrow guard: on-screen
buttons cannot use the green destination-link helper. The approved action rule in
[design-principles.md](../design/design-principles.md) settles the correction:
preserve the arrow drawing, 6px gap and final-word wrapping, but use near-black
for the action label and arrow. A neutral wrapper shares the existing arrow layout;
destination links keep their green treatment. The spoken name starts with the exact
visible label and retains the existing date/contributor instruction, with consistent
sentence endings. This follows WCAG 2.5.3 without changing visible copy or needing
another visual direction. Tests cover neutral/green layout equivalence and names
with and without a known payment-tab label.


1. Complete category sampling and current outage diagnosis; retain dated evidence.
2. Finish independent Claude review of the checker and routine monitoring choice.
3. Repair demonstrated causes, update owning requirements and upkeep instructions.
4. Run focused tests and relevant live/browser checks; publish through a reviewed PR.
5. Verify the released daily check, request justified provider rechecks once, and
   finish owner/job records. Keep Google follow-up explicitly owned until resolved.

## Model selection

Lead and bounded checker work use the current Codex task. Claude consultation uses
`claude-opus-5-5` at `high`, selected for the cross-source diagnosis, privacy boundaries
and release decisions. Official model, comparison and effort guidance was read for
the selection. A longer-running Fable review was considered but the review is bounded;
no comparative speed or quality benchmark is claimed. Consultation is read-only.
Material peer claims are checked against code, current provider responses and official
Google documentation before adoption. Agreement is not evidence.
