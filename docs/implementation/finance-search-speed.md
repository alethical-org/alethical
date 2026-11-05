# Faster Finance Home suggestions

## Goal and boundaries

Make Finance Home suggestions arrive sooner while preserving source spelling,
record identities, destinations and access. The user authorized building through live
verification on 5 November 2026. This task owns suggestions and cancellation in the shared
browser read queue; full directories and public search retain their contracts.

## Cause and evidence

Chrome's request for `danch` waited 2.75 seconds for the server; downloading the answer
cost 0.80 milliseconds. The request included about 66 milliseconds of browser scheduling.
These timings exclude the application's 140-millisecond typing pause.
A separate read-only trace against production records ran 32 application SQL statements.
It found donation calculations, directory-wide counts and bill-card metadata that the
suggestions view discards. Name matching on the existing per-file name summaries also
cost time. The trace is a diagnostic measurement, not a browser speed claim.

The browser did not cancel superseded requests, and invalidated an older reply only when
the next typing timer fired. A reply could therefore arrive during that timer and display
for the wrong input. Every pending query also hid the previous suggestions.

## Implementation and checks

- Server helper: a small suggestions reader, sharing matching and source checks; remove
  work whose result the dropdown never displays. Preserve one repeatable-read transaction.
- Browser helper: immediate request invalidation and cancellation, canceled-queue handling,
  same-account result retention, bounded recent-query reuse, and focused race tests.
- Parent: verify both changes against real records, profile the remaining cost, review
  tests and rendered behavior, integrate, release and measure live.

Full-source completeness guards remain. Missing source sets stay unavailable, never empty.
No browser storage or shared HTTP cache holds private results. Account change, sign-out
and access denial clear prior suggestions. Name matches keep existing eligibility and direct-first order. The user also approved
literal bill suggestions: `danc` matches “dance”, `danch` does not. Bill numbers remain
exact; the full results page retains its broader matching. This removes unrelated typo
bill suggestions without weakening name spelling discovery.

Acceptance covers identical displayed names, source kinds and destinations, missing and
partial sources, rapid typing, slow/out-of-order replies, failures, cancellation, account
changes, keyboard use and the real dropdown on desktop and narrow screens. Result-equivalence and unused-calculation checks prevent reintroducing full directory work.

Task: [Make Finance Home search suggestions arrive faster](https://github.com/alethical-org/alethical/issues/2899).

## Measured reader work

A read-only comparison on 5 November 2026 ran both readers against the same production
sources, restoring the original name candidate predicate for the old reader. Displayed
money names, IDs, roles and ordering agreed for all 5 queries across 2 rounds. The second
round ran the new reader first to avoid always giving it the warmed database.

| Query | Old reader | New reader | Application SQL statements, old → new |
| --- | ---: | ---: | ---: |
| danch | 3,307 ms | 1,858 ms | 32 → 15 |
| danc | 1,972 ms | 928 ms | 32 → 16 |
| smith | 3,013 ms | 1,011 ms | 31 → 15 |
| arthur | 3,026 ms | 851 ms | 30 → 15 |
| health | 3,359 ms | 1,055 ms | 33 → 16 |

These are local-to-production database measurements, not deployed browser timings or a
latency guarantee. Each new read still checks complete sources. Direct names fill each
payment-name group first; spelling work runs only for remaining places. Both branches
retain shared eligibility. Five- and six-character spelling candidates use all possible
single edits before the unchanged final spelling test, including non-alphanumeric word
boundaries. Longer words retain the broader candidate filter.

A second read-only experiment compared direct payment names first with the complete
suggestions read. In a warmed pass, `danch` took 906 ms for direct names and 1,798 ms
for all names; `danc` and `smith` gained little or nothing. Issuing both reads in sequence
would delay the completed `danch` answer to about 2,704 ms and repeat the source checks.
The dropdown therefore keeps 1 response per uncached query. Splitting it requires a
separate decision about optional spelling expansion or a streaming read that preserves
one consistent source view; it is not an unconditional second request.

## Verification status

113 focused backend tests and 836 Finance browser-logic tests pass. TypeScript, Finance
build, built links and page-return guards pass. Independent review's underscore,
abbreviation and token-refresh findings have regressions and fixes. Local Chrome checks
covered desktop and 390-pixel layout, loading with retained rows, completed replacement,
failure/recovery, keyboard selection and the printed-name destination with return context.

Release identity, live measurements and final acceptance are recorded in the linked task.
The parent chat, 01a1adf6-895d-7060-b1cd-ff51d9c39484, owns delivery. Working folder retained
for follow-up.
