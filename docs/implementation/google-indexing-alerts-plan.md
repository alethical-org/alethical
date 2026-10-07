# Google indexing alerts, 7 October 2026

Tracking: [issue 2516](https://github.com/alethical-org/alethical/issues/2516).

## Authorized outcome

Eugene asked the Codex chat (seo, 01a117ab-5b6b-7b01-8a5d-f46e3a3c01b5)
to recap previous search work, investigate the new Google alerts, repair demonstrated
problems, prevent recurrence and arrange routine review without forwarded screenshots.
He requested Claude consultation on important decisions and implementation through
completion. Keep publication, privacy, source accuracy and spending boundaries intact.

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
  timeout/cache/retry behavior unchanged until the evidence can distinguish causes.

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
- Explicit approval for a weekly token-consuming report review was requested while
  free build work continued. The request states allowance use and unknown per-run
  cost. No recurring AI task has been armed while that answer is pending.

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
failure-minute sample. Leave handover, timeout and retry behavior unchanged until
actual failure labels support a correction.

Server-error revalidation waits for a demonstrated repair that is live, or 7
consecutive complete, unsaturated daily sets with zero reader-page 503s. This is
a conservative operating threshold, not Google's published rule or a guarantee
that failures cannot recur. Missing or unclassified evidence cannot prove stability.
Reader pages exclude administration and private account routes; their failures
remain counted separately and cannot establish a public indexing defect.
The first classified failures remain the immediate diagnosis priority.

The local collector read for 18:00–19:00 UTC succeeded with 2 committee 503s,
matching the original private source records and retaining no raw text. All 75
combined offline checks pass, including hostile data, auth boundaries, truncated
messages, time windows, failed startup, missing coverage and artifact limits.
The hourly collector shipped in [pull request 2519](https://github.com/alethical-org/alethical/pull/2519).
Its first [hosted run](https://github.com/alethical-org/alethical/actions/runs/37681983059)
collected 19:00–20:00 UTC with zero failures and no saturation. The coverage client's
real authenticated artifact read succeeded, followed the signed download without
forwarding credentials, and validated the report. Natural classified-failure
acceptance remains pending because that hour contains no failures.

The first release is live at `b984d2163395631afce0c7dd3c80351aef76eef3`
([pull request 2517](https://github.com/alethical-org/alethical/pull/2517)).
It adds bounded variant checks and fixed failure labels, without changing timeouts,
cache policy or retry behavior. The released daily public check passed. An
independent browser review passed the committee year, bill text tab, guide article
navigation and candidate form's empty-input recovery; the parent also opened the
live bill text. No phone layout or real address lookup was exercised in this
non-visual release. No runtime failures appeared in the bounded 19:25–19:46 UTC
read, so a natural labelled failure remains pending. Google started duplicate-address validation on
7 October after its live bill test returned the intended canonical address.

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
Keep the Sentry groups open until that live acceptance; keep the Google server-error
investigation open independently. The current chat owns both follow-ups.

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
