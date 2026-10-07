# How often to re-fetch bills, and why

**Net:** Bills should be re-fetched every 4 hours while the Legislature is sitting, every 2 hours
during a special session, every 4 hours for the 14 days after a session ends, and weekly through
the interim. That is not one cadence keyed to a clock, it is a cadence keyed to the legislative
calendar, because the measured activity data shows 102 active days in an 18-month span and 7
consecutive months with none. The 5 known safety defects are fixed: a thin response cannot erase
good facts ([#1319](https://github.com/alethical-org/alethical/issues/1319)), current text reaches
search atomically ([#1320](https://github.com/alethical-org/alethical/issues/1320)), a changed bill
stops showing a summary of its earlier text
([#1321](https://github.com/alethical-org/alethical/issues/1321)), and action numbers from separate
chambers are no longer compared as one sequence
([#1322](https://github.com/alethical-org/alethical/issues/1322)). Two matching official responses
can also remove a missing current-version section and its search rows without touching history
([#1423](https://github.com/alethical-org/alethical/issues/1423)).
[#1323](https://github.com/alethical-org/alethical/issues/1323) now owns the schedule, source
limits, and reporting.

This record preserves the August 10 measurements and reasoning in sections 1–6.
Those sections describe the pre-scheduler system, not its current implementation.
The October implementation uses an hourly saved-deadline runner, shared source
request limits and atomic changed-text search updates. Automatic paid summaries
remain off; the August daily-summary proposal below was not activated.
[`backend-stack.md §5, background jobs`](backend-stack.md#5-background-jobs) and
[What runs, when, and what it costs](../operations/jobs-and-scripts.md) own current
operation. The October section below records its implementation and review limits.

Reached Aug 10 2026, from measured production data plus an independent review by OpenAI's
`gpt-5.6-sol` at maximum reasoning effort, which read the ingest code and found the first four
safety bugs above. The fifth was proven while closing those bugs.

## 1. What actually changes, and how often

Measured from production on Aug 10 2026 across all 10,517 bills that carry an action, grouped by
the month of each bill's most recent action:

| Period | Bills whose latest action falls there |
| --- | --- |
| 2025-01 | 610 |
| 2025-02 | 1,994 |
| 2025-03 | 2,383 |
| 2025-04 | 1,101 |
| 2025-05 | 255 |
| 2025-06 (1st special session, Jun 9-10) | 47 |
| 2025-07 through 2026-01 | **0** |
| 2026-02 | 640 |
| 2026-03 | 1,956 |
| 2026-04 | 1,171 |
| 2026-05 | 360 |
| 2026-06 onward | **0** |

Four facts fall out of this, and they decide everything below.

**Activity is concentrated into about 100 days out of 550.** Only 102 distinct days in the
18-month span carry any bill activity. The busiest single day is 2025-02-13, when 448 bills
last moved.

**These counts are a floor, not a ceiling.** A bill that moved in February and again in March
is counted only in March, so real daily volume is higher than the table shows. The order of
magnitude is what matters: hundreds of bills per sitting day.

**The seven-month gap is a real property of the source, not of our looking.** The corpus was
fully re-fetched in July 2026 ([#155](https://github.com/alethical-org/alethical/issues/155)),
after the 2025 interim had passed. The refresh saw nothing in those months because the source
published nothing.

**The corpus was in sync with the examined source on August 10.** The newest action we hold is 2026-05-17,
the day before the 2026 session adjourned sine die on May 18. Two bills sit at "passed both
chambers" (SF 1943 and SF 2373); checking the Revisor's own record for both on Aug 10 2026
shows their action history also stops on May 16-17, with no gubernatorial action and no chapter
number. So we mirror the source faithfully today, and the cadence question is about the next
session rather than an active defect.

## 2. The factors that decide the cadence, ranked

**1. The freshness promise.** How long may pass between the state publishing a change and
Alethical showing it. This is a product choice, not a measurement, and it is the number
everything else is derived from. `.claude/rules/grounded-answers.md` rule 7 says staleness is a
bug but names no interval. **Decision: 6 hours during a session, 7 days during the interim.**

**2. How many bills change per day in the current phase.** Measured above. This is what turns
the promise into an interval: at 300 changed bills a day, a 24-hour pass leaves an average of
150 bill-days of wrongness per day; a 4-hour pass leaves about 25.

**3. Whether a pass is safe to run unattended.** At the August review this
dominated: the answer was no, so scheduled collection waited for the defects in §4.

**4. What a pass costs the sources we depend on.** A full refresh makes about 3 requests per
bill, so roughly 31,000 requests against revisor.mn.gov, house.mn.gov and senate.mn, with 8
workers and no shared rate limit in the August implementation. These are free public services we do not
pay for and cannot afford to be blocked by. Their acceptable request rate is not documented, so
this is a constraint we respect by design rather than measure.

**5. What the paid work costs.** Money follows text changes, not polling. Embeddings are about
$0.001 per bill; a full corpus re-summarisation is $200-265
([`ai-models-and-billing.md`](../product-onboarding/ai-models-and-billing.md)). Those are two
different orders of magnitude and must not be treated as one "expensive tier": rebuild
embeddings immediately on a text change. Daily summary batching was proposed here,
but remains separately gated off in the October implementation.

**6. How much reader attention a stale bill gets.** Would let us refresh popular bills more
often. Not measurable: no page-view measurement is installed. Tracked-bill counts are a partial
signal, but every public bill still needs a floor.

**7. The legislative calendar.** Deliberately last. It is the *trigger* for changing phase, not
the reason a phase has the cadence it has. Ranking it first is the mistake this document exists
to avoid, because a calendar tells you when the Legislature may sit, not what it published.

## 3. The recommended cadence

| Phase | Cheap pass | Reasoning |
| --- | --- | --- |
| Regular session | Every 4 hours | Hundreds of bills move per sitting day. 4 hours plus a sub-1-hour run keeps the worst case inside the 6-hour promise. |
| Special session | Every 2 hours | The 2025 special session lasted 2 days and moved 47 bills. A nightly pass would have covered one of its two days. |
| 14 days after any adjournment | Every 4 hours | This is when a passed bill becomes law, and when a stale status does the most damage: it misframes enacted law as a pending proposal. |
| Interim | Weekly | Seven consecutive months of zero change. A daily pass would spend ~31,000 requests a day to learn nothing. |
| A newly recognised session | One immediate catch-up, then the phase cadence | The catch-up is an event, not a replacement for the baseline. |

The expensive work is event-driven, never scheduled: search text rebuilds as soon as a bill's
text changes. Daily summary rewriting remains a proposal, not an enabled job.

### Where this differs from the independent review

The review recommended a **daily** interim pass rather than weekly, reasoning that weekly permits
168 hours of staleness for only a sevenfold reduction in requests. **Weekly is chosen anyway**,
on the strength of the measured data the review did not have: the interim months contain zero
changes, so the daily pass buys 6 additional days of freshness on a quantity that is empirically
zero, and pays about 217,000 source requests a week for it. Revisit if a single interim change is
ever observed.

The review also recommended a **daily pass year-round** as the simple design that gets most of the
value. That is a fair reading and it is the fallback if the phase logic proves fiddly. The reason
it is not the recommendation: a daily pass is simultaneously too slow for a sitting day and far
too fast for July.

## 4. Safety defects the schedule had to wait for

All 5 verified defects are fixed. The schedule and its operating safeguards can now ship in
[#1323](https://github.com/alethical-org/alethical/issues/1323):

- **Fixed: 1 thin response no longer deletes good facts.** A lower action, author, version or
  section count triggers a second full fetch before any bill fact changes. Two differing thin
  responses reject only that bill and ask the future scheduled pass to open an issue; a blank
  description keeps the stored value. ([#1319](https://github.com/alethical-org/alethical/issues/1319))
- **Fixed: saved search text now describes the accepted bill text.** An accepted refresh records
  whether the current version or its ordered section text changed. Only those bill keys are
  rebuilt, after the canonical rows are flushed, on the same database connection and in the same
  transaction. A failed rebuild rolls back both writes instead of publishing half a refresh.
  ([#1320](https://github.com/alethical-org/alethical/issues/1320))
- **Fixed: a changed bill no longer shows its old summary.** The accepted text-change signal marks
  the displayed summary non-current in the same transaction. A completed summary job also checks
  the current version and official section text before it can display its output, so a job started
  before a later refresh cannot restore stale words. Metadata-only and rejected refreshes leave a
  matching summary alone. ([#1321](https://github.com/alethical-org/alethical/issues/1321))
- **Fixed: separate chambers no longer compete by action number.** Each chamber's action number
  orders only that chamber. The chamber tails are compared by their latest known dates, an undated
  tail carries its chamber's preceding real date for ordering only, and an enactment or veto cannot
  be replaced by a later routine label. Equal-date fallbacks follow the official XML chamber-block
  order. The stored action date remains empty when the source supplied none. A production dry run
  identified 163 stored status labels for the bounded correction in the release.
  ([#1322](https://github.com/alethical-org/alethical/issues/1322))
- **Fixed: a confirmed removed section leaves neither canonical nor search residue.** Two matching
  lower section lists may remove only positions absent from the accepted current version. The same
  transaction deletes their embeddings, chunks, search documents, then canonical section rows;
  historical versions remain untouched, and a rejected or uncertain contraction changes nothing.
  ([#1423](https://github.com/alethical-org/alethical/issues/1423))

The precedent is [#285](https://github.com/alethical-org/alethical/issues/285): a canonical
refresh created 6,926 duplicate current-version rows. These 5 fixes remove the known data-loss and
staleness paths. The schedule with source limits and visible failure reporting comes next.

## 5. Calendar in code, or calendar in the timer?

**Neither on its own.** A cron expression carrying legislative dates duplicates a fact that lives
in the data and still misses a special session announced next week.

The session dates already in the code cannot carry this either: `CURRENT_SESSION_START_DATE` and
`CURRENT_SESSION_END_DATE` in `alethical/pipeline/sessions.py` span the whole biennium, January
2025 to May 2026, including the seven months when nobody was sitting. They describe the outer
boundary, not the sitting periods.
[#997](https://github.com/alethical-org/alethical/issues/997) is open on those dates separately.

Recent change volume cannot carry it either, because zero recent changes is ambiguous between
"nothing changed" and "we did not look".

**So: a timer that wakes often and a decision step that chooses whether work is due.** Wake every
hour under the October implementation; run the pass if the phase's interval has elapsed; fall back to the weekly baseline
regardless of phase, so a phase-detection bug degrades to slow rather than to silent. Sitting
intervals are stored data a person reviews, not something inferred.

## 6. What to measure before committing

The cadence numbers above are derived from the activity table in §1, which is the best data
available without running a refresh. Two inputs would sharpen them, and both require the safe
pass from [#1323](https://github.com/alethical-org/alethical/issues/1323) to exist first:

- **New source fingerprints per 1,000 bills polled, per day.** This says what a pass actually
  found, rather than what the state's action dates imply. Source copies are stored deduplicated by
  content fingerprint, so a new row means the source genuinely changed. The measurement is a lower
  bound: a source that changes and then reverts may not create a new row.
- **The 95th-percentile time to refresh one bill.** The 4-hour session interval assumes a full
  pass finishes well inside an hour. If it does not, the interval has to grow or the pass has to
  narrow to bills with recent activity.

## Callable refresh operations (October 2026)

`alethical/pipeline/legislative_refresh.py` supplies bounded bill refreshes, missing and corrected vote collection, and complete roster refreshes to the sitewide scheduler. `scripts/refresh_legislative_records.py` exposes the same operations with an explicit database target and reviewed session code. Bill chunks default to 100 records, return a continuation key, and report whether the inventory pass is complete. A continuation is not a completed freshness check. Rejected or failed bills retain their last accepted values and prevent the runner from reporting a successful chunk.

Requests reserve a shared per-host slot in `source_request_limits` before accessing the source. The database transaction ends before waiting or downloading. HTTP 429 and 503 responses extend the shared cooldown. Discovery carries the official bill URLs into each chunk, avoiding a duplicate search request per bill. Official HTTP validators allow an unchanged bill body to return 304 and reuse its matching saved copy. Sources without validators still receive a full body request; an unchanged XML fingerprint alone does not establish that same-version HTML is unchanged.

Accepted bill text and its search rows commit together. Changed-text embeddings remain event-triggered and use the approved ingestion budget; these operations never start paid summary generation. The cadence helper takes reviewed sitting intervals, not biennium boundaries, and falls back to weekly when those intervals are unavailable. Unknown session codes require mapping review before import.

The scheduler wrapper (`scripts/run_scheduled_bill_refresh.py`) pins the official inventory and its fingerprint for each pass. It saves its cursor, failed bill keys and pending vote checks under the job's unexpired lease token. Vote checks are queued before bill writes, so a stopped process cannot commit an action change and lose its follow-up check. Successful chunks return exit 75 for immediate continuation; the pass reports success only after every pinned bill and pending vote check finishes. Failed bills retry individually rather than restarting the accepted inventory. A later official inventory omitting previously listed bills is held for review.

`scripts/check_legislative_sessions.py` checks the official session selector for new current or future codes and returns exit 2 for mapping review. It never creates a session definition. Scheduled roster imports also compare the PDF's printed biennium with the reviewed current session before updating any member.

### Reviewed sitting calendar and next-session review

`alethical/pipeline/legislative_calendar.py` exports `session_refresh_interval(session_code, date)` for the shared runner. The [Legislative Reference Library session history](https://www.lrl.mn.gov/history/sessions), read October 7, 2026, records these calendar dates:

| Discovery code | Sitting | Convened | Adjourned |
| --- | --- | --- | --- |
| 0942025 | 2025 regular | January 14, 2025 | May 19, 2025 |
| 1942025 | 2025 first special | June 9, 2025 | June 10, 2025 |
| 0942026 | 2026 continuing regular | February 17, 2026 | May 18, 2026 |

The 2025 and 2026 regular discovery lists share the same sitting clock because bills introduced in 2025 can change in the 2026 sitting. Each reviewed sitting gets its approved interval and 14-day follow-up, then weekly checks. Unknown codes still fail before ingestion.

On October 7, 2026, the [Revisor session selector](https://www.revisor.mn.gov/bills/status_search.php) already lists `0952027`. The [House session information](https://www.house.mn.gov/hinfo/news.asp) states that the 95th Legislature convenes January 12, 2027, and the 2027 sitting must conclude by May 17, 2027. That deadline is not an observed adjournment and is not the end of the 2027–2028 biennium. The reviewed mapping is `0952027` to regular-session slug `95-2027-regular`, Legislature 95, years 2027–2028, and start January 12, 2027. Its final end date remains unknown (`None`), supported by the existing nullable database field. It remains noncurrent, and the runner must wait until January 12, 2027 before initial collection. The reviewed scheduled start enters the sitting clock with no invented adjournment. Do not switch the current roster until its official PDF and reviewed mapping describe the same biennium.

Pending vote failures are retained separately from bill-source failures so 1 unavailable roll call cannot stop collection of the remaining bills. A pass reports success only after both queues clear. After a complete inventory pass, unresolved records keep their retry queues, but the next reviewed interval starts another complete discovery pass. This lets newly filed bills and corrections to healthy bills continue while a rejected record awaits repair. An in-flight pass stays pinned; a rejected replacement inventory preserves its previous inventory and failure evidence.

Scheduled discovery no longer assumes bills end at number 6000. The official XML API returns at most 500 results per range (observed October 7, 2026); capped ranges are divided until every response falls below that cap. Every response must have the official search envelope and valid, unique in-range bill identities. This finds sparse high-number bills too. Discovery is bounded to 1–99,999 and fails if the ceiling itself is reached. A malformed response is never accepted as an empty range. Both regular discovery codes return the full biennium, so the scheduler runs 1 job per distinct session slug using the latest mapped discovery code.

October 7, 2026 read-only source comparison through the adaptive parser returned identical complete inventories for `0942025` and `0942026`: 10,472 bills each (5,162 House, 5,310 Senate), using 70 paced requests per discovery code. Both sorted-key JSON inventories had SHA-256 `370be138d60eac37988b172c55ce7232ce78fd9bf6c4e1388195cc754d4b4f74`. This supports collecting 1 regular-session inventory rather than repeating the same biennium under both aliases.
