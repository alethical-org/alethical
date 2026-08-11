# How often to re-fetch bills, and why

**Net:** Bills should be re-fetched every 4 hours while the Legislature is sitting, every 2 hours
during a special session, every 4 hours for the 14 days after a session ends, and weekly through
the interim. That is not one cadence keyed to a clock, it is a cadence keyed to the legislative
calendar, because the measured activity data shows 102 active days in an 18-month span and 7
consecutive months with none. **None of it can be switched on yet:** the thin-response guard
shipped in [#1319](https://github.com/alethical-org/alethical/issues/1319), but three safety fixes
still come first
([#1320](https://github.com/alethical-org/alethical/issues/1320),
[#1321](https://github.com/alethical-org/alethical/issues/1321),
[#1322](https://github.com/alethical-org/alethical/issues/1322)), then the schedule
([#1323](https://github.com/alethical-org/alethical/issues/1323)).

This is a decision record, not a description of shipped behaviour. What ships today is documented
in [`backend-stack.md`](backend-stack.md) §5: nothing re-fetches bills on a schedule, and a
refresh is started by hand.

Reached Aug 10 2026, from measured production data plus an independent review by OpenAI's
`gpt-5.6-sol` at maximum reasoning effort, which read the ingest code and found the four safety
bugs above.

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

**The corpus is currently in sync with the source.** The newest action we hold is 2026-05-17,
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

**3. Whether a pass is safe to run unattended.** Ranked this high because it currently
dominates: the answer is no, so the correct cadence today is zero. See §4.

**4. What a pass costs the sources we depend on.** A full refresh makes about 3 requests per
bill, so roughly 31,000 requests against revisor.mn.gov, house.mn.gov and senate.mn, with 8
workers running concurrently and no shared rate limit. These are free public services we do not
pay for and cannot afford to be blocked by. Their acceptable request rate is not documented, so
this is a constraint we respect by design rather than measure.

**5. What the paid work costs.** Money follows text changes, not polling. Embeddings are about
$0.001 per bill; a full corpus re-summarisation is $200-265
([`ai-models-and-billing.md`](../product-onboarding/ai-models-and-billing.md)). Those are two
different orders of magnitude and must not be treated as one "expensive tier": rebuild
embeddings immediately on a text change, and batch summaries daily onto the half-price queue.

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
text changes, and summary rewrites collect into one daily batch.

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

## 4. Why none of it can be scheduled yet

A refresh still cannot run unattended. The first of 4 verified defects is fixed; the other 3
remain:

- **Fixed: 1 thin response no longer deletes good facts.** A lower action, author, version or
  section count triggers a second full fetch before any bill fact changes. Two differing thin
  responses reject only that bill and ask the future scheduled pass to open an issue; a blank
  description keeps the stored value. ([#1319](https://github.com/alethical-org/alethical/issues/1319))
- **Search text is indexed before the bill text is saved.** The chunks are built and committed on
  a separate connection, so they describe the previous text.
  ([#1320](https://github.com/alethical-org/alethical/issues/1320))
- **A changed bill keeps its old summary.** Nothing ties a summary to the text version it was
  written from. ([#1321](https://github.com/alethical-org/alethical/issues/1321))
- **Status is chosen by comparing action numbers across chambers**, which each restart at 1.
  ([#1322](https://github.com/alethical-org/alethical/issues/1322))

The precedent is [#285](https://github.com/alethical-org/alethical/issues/285): a canonical
refresh created 6,926 duplicate current-version rows. Supervision is what has held this line so
far, and a schedule removes the supervisor.

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
2 hours; run the pass if the phase's interval has elapsed; fall back to the weekly baseline
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
