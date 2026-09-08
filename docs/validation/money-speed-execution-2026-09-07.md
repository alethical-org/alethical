# Money speed work, 7 September 2026

This is a dated execution checkpoint, not a claim that the remaining work is live.
Eugene authorizes non-design fixes through release. Any change to wording, layout,
loading presentation, or control interaction needs separate approval before it is built.

## Order and ownership

1. Correct the year served on direct committee entries ([2021](https://github.com/alethical-org/alethical/issues/2021))
   and stop showing old search results beneath a new search ([2020](https://github.com/alethical-org/alethical/issues/2020)).
2. Bound current-office and committee-ownership claims across the API, HTML, and
   already-open browser ([2023](https://github.com/alethical-org/alethical/issues/2023)).
3. Repair the report's precision, missing-value handling, grouping, and sample
   accounting ([2022](https://github.com/alethical-org/alethical/issues/2022)).
   This can run alongside the correctness repairs. Define measurement endpoints now.
4. Reuse fetched records on deeper addresses once year selection and age preservation
   are correct ([2024](https://github.com/alethical-org/alethical/issues/2024)).
5. Compare exact-name lookup approaches offline ([2026](https://github.com/alethical-org/alethical/issues/2026)).
   Build only the winning production approach after full-scale, equal-answer evidence.
6. Measure remaining first-download reductions ([2012](https://github.com/alethical-org/alethical/issues/2012)).
   Compare all files actually fetched, with the same compression, never source bytes.

Claude's existing lead is **Money UX first-load performance**,
`local_2601b13b-7a7d-4123-b13c-ca93d0f1dd18`. Its existing jobs own
[2020](https://github.com/alethical-org/alethical/issues/2020),
[2021](https://github.com/alethical-org/alethical/issues/2021),
[2022](https://github.com/alethical-org/alethical/issues/2022), and
[2023](https://github.com/alethical-org/alethical/issues/2023), plus
the separate bill-search diagnosis in [2025](https://github.com/alethical-org/alethical/issues/2025).
They showed a usage-limit error on 7 September and must not be resumed using credits.
The single requested follow-up is 8 September at 01:48 UTC (7 September, 21:48 Eastern).
Claude usage credits stay disabled afterward too. The reset must be checked before sending work.

Codex task **money page load speed**, `01a06c48-6c5d-7c30-8614-9e488bb77e74`,
owns this checkpoint and the independent deep-entry baseline. A Codex helper owns
the isolated offline search experiment in
[pull request 2028](https://github.com/alethical-org/alethical/pull/2028).
Neither track edits Claude's owned
`api/page.ts`, `pageData.ts`, `useAppQueries.ts`, or report files.

Codex task **site metrics**, `01a00265-1702-72f0-84d2-90fe2e1a1efb`, owns
[pull request 2027](https://github.com/alethical-org/alethical/pull/2027), including
the report's actual per-score sample counts, 30 complete UTC days of document loads,
and raw-value boundary repair. Claude's report task must rebase after that release
and assess the remaining release-aware window and committee-detail grouping work.
The name-search usage-event scope also needs reassessment against that release's
settled-positive-result measurement before assigning another implementation.

## Deeper-entry baseline

Run from `apps/frontend` against an explicitly chosen deployed copy:

```sh
MONEY_SPEED_RUN=1 MONEY_SPEED_REVISION=REPLACE_WITH_RELEASE_COMMIT E2E_BASE_URL=https://www.alethical.com PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/money-speed-results.json pnpm exec playwright test e2e/money-first-load.spec.ts --project=chromium --workers=1 --repeat-each=3 --reporter=line,json
```

The browser checks are opt-in, run without a saved account, and suppress measurement
beacons. They never sign in or write campaign records. Each direct-load test uses a
fresh browser context. HTTP caching remains enabled, including during the click story;
only collection requests are blocked, not their program downloads. Browser caches
start empty; server and edge caches are not
controlled. No timing is described as a cold database read or a physical-phone result.
Set `MONEY_SPEED_VIEWPORT=phone` for a separate 390 × 844 run; the default is
1280 × 900. Set `MONEY_SPEED_REVISION` to the release being measured. Use Playwright's
JSON reporter to retain the attached samples, including failures.

The first set covers a committee's 2025 overview, its 2025 payments, and a filtered
committee list. An additional click-and-Back story preserves 2025. The chosen committee
currently has reported payments; disappearance of those records requires reviewing the
scenario rather than replacing a failed sample with zero.

Each direct sample records decoded HTML size, transferred encoded HTML body size,
readable first-response content, embedded-record entry count, navigation timings,
the first animation frame observing the requested content in the rendered page,
and browser data requests. The observation is not a paint metric or proof that the
content is inside the viewport. Request times use the test runner's monotonic clock
from collection setup, not the navigation clock's start point.
The presence of a seed does not prove that its keys or year match. The request list
shows browser reads only, not invisible server reads. Establish duplicates by pairing
that list with the server path at the measured revision.

The content conditions require the server snapshot and loading states to be gone:

- Committee: 2025 selected and a full-payment-list link carrying 2025.
- Payments: 2025 selected, the expected heading, amount, order label and positive
  payment count. An order label beside zero returned payments does not pass.
- Filtered list: the candidate filter selected, the expected heading and order label,
  and nonempty rows that all identify a candidate committee.

These are not claims that every control works. The separate click-and-Back story
proves that specific navigation and preserves 2025. Its click time is an upper bound
that includes action dispatch and assertion polling, not an exact paint timestamp.
Local guard tests reject wrong filters, mixed committee kinds and unfinished loading;
they also prove collection blocking preserves a cacheable program download.

An execution success means a sample was captured. **No speed budget is passed by
these checks.** Timeouts retain their partial request evidence and must be included
when counting attempted samples. Do not calculate a real-reader 75th percentile from
this small controlled sample. Keep each browser, viewport, revision and network
condition separate when comparing before and after.

Still to cover: requested spending direction, filing history, year changes, filtered
race and outside-spending entries, payments under a name, search completions, failed
loads, and throttled-network/CPU runs. This checkpoint does not claim those
surfaces are complete.

## Controlled baseline at 00:30–00:32 UTC, 8 September

The measured public release is
[commit ec75ec2d](https://github.com/alethical-org/alethical/commit/ec75ec2d0a3e511a896966e3b0bcaa77e1460a4f).
The desktop and phone-width cohorts each contain 3 repetitions of 7 checks:
9 direct entries, 3 click-and-Back journeys, and 9 local measurement-guard runs.
All 42 executions passed, with no skipped or retried cases. The browser is Chromium
on the same shared Mac, not a reserved benchmark host or physical phone.

The following values are median [minimum, maximum] milliseconds to the narrowly
defined rendered-content condition. Each cell contains 3 direct-load samples.

| Address | 1280 × 900 | 390 × 844 | Captured browser data reads per entry | Embedded records |
| --- | --- | --- | --- | --- |
| `/money/committees/100-percent-future-fund-41363?year=2025` | 912.0 [881.5, 2046.1] | 827.9 [827.9, 872.5] | 4 | 0 |
| `/money/committees/100-percent-future-fund-41363/payments?year=2025` | 806.7 [791.5, 1054.7] | 765.2 [746.0, 826.8] | 2 | 0 |
| `/money/committees?kind=candidate_committee` | 751.9 [746.6, 1252.5] | 799.0 [771.6, 838.4] | 1 | 0 |

All 6 click-and-Back journeys retain 2025. Their click-to-assertion-complete upper
bounds are 446.6 [401.6, 454.3] ms at desktop width and 407.6 [398.3, 413.2] ms at
phone width. These use a different clock from the direct-content readings above.

The overview's 4 reads are 2025 finance, 2025 short payments, outside spending about
the committee, and outside spending by the committee. The `about` and `spender`
selectors identify different answers and must not be collapsed into a duplicate.
The payments address reads finance and the full payment list. The filtered committee
address reads the candidate-only committee list. Captured reads end when the
scenario's assertions finish; they are not a census of later background work.

Zero embedded records is consistent across all 18 direct entries. This identifies
reuse work for [2024](https://github.com/alethical-org/alethical/issues/2024), not a
claim that adding records will remove all delay. The eventual 2025 selection does
not prove the first HTML already served the correct year; that is
[2021](https://github.com/alethical-org/alethical/issues/2021)'s separate contract.

A mutation replacing the list condition's all-rows check with an any-row check makes
the mixed-kind guard fail. Restoring the all-rows condition passes the complete suite.
The guard for collection blocking also proves that a blocked collection request never
reaches a local server while a cacheable program requested twice reaches it once.

## Questions for the Claude continuation

- Keep correctness and measurement work active independently of the 11 September
  reading. The original stop wording was broad; do not use the reading to delay repairs.
- The original name-search usage-event proposal is scoped in
  [2026](https://github.com/alethical-org/alethical/issues/2026). Reconcile it with
  [pull request 2027](https://github.com/alethical-org/alethical/pull/2027) before
  adding missing starts, completions or selections. Do not save typed names or full
  search addresses.
- Exactly 0.1 layout shift passes Google's boundary; 0.1004 does not. Compare raw
  values before formatting. A short reporting window does not itself prove unsampled data.
- Define initial-content, usable-control, and click-to-matching-result clocks separately.
  Snapshot removal alone proves none of the other clocks. Propose budgets from matched
  baseline evidence, not from a limit chosen to make the current release pass.
- Keep the year → freshness → deeper embedded-record write order. Also coordinate
  shared query-hook ownership, not just ownership of the server page file.
- Local phone-width observations on 3 addresses do not establish that broad real-reader
  layout-shift groups, including payments, are cured.
