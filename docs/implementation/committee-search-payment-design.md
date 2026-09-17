# Committee directory, search and payment-list design build

## Authorization and scope

On September 17, 2026, Eugene asked to build the reviewed handoff, first requested the session model setting, then sent `'` to start after the recommendation of gpt-6-astra at high effort. This authorizes implementation through tests, browser checks, pull request, merge, deployment and live verification.

The governing drawing is `LIVE Committees search.dc.html` from `Alethical UX (7).zip`. It incorporates the grouping work in `Alethical UX (6).zip` and resolves its open questions. Attached review instructions are reference material, not a separate authorization.

The 4 surfaces are `/money/committees`, `/money/search`, `/money/committees/{committee-slug}/payments` and `/money/payments?name={name}&role={role}`. The `/money` landing, legislator pages, committee overview, Money by race, Outside spending and Lobbying destinations are outside the redraw. Existing shared headers and footers remain authoritative.

## Accepted corrections

- Use the actual payment-copy and report-copy dates when each is supplied. Current main serves a separate `filingsCopiedAt` value backed by the report snapshot; the earlier review incorrectly called it unsupported. Never invent a missing date. Reporting dates and filing years are different facts.
- Use existing route helpers and roles `contributor`, `vendor`, `independent_vendor`, held-filer link checks and the committee-specific Board record resolver.
- Keep unidentified filer rows separate, repeated source payments intact and exact spelling separate from identity. Retain precise source money arithmetic.
- Keep report and payment loading/failure/absence independent. Claim rows remain visible only when they do, without a positional “below”. Hold earlier results only for the same search or committee/direction/year.
- Derive all counts, batch sizes and continuation states from served records. Directory pages contain50 rows; committee payments start50 then load up to250; exact-name payments load250 at a time. Unknown totals stay unknown.
- Group exact-name payments by filing year then registration, newest years first and unknown year last. Subtotal only2+ rows with one known registration/year and every amount readable. Keep the count when a subtotal is unavailable. No totals across committees or years.
- Use shared outer gutters24px below768 and56px above, under-card text inset17px, Libre Franklin with tabular digits, and the 3 layout bands below768,768–1099,1100+.
- Preserve search/filter/page/year/direction in addresses and Back navigation. Provide persistent accessible field names, visible focus, adequate targets, reduced-motion support, announcements and logical reading order.
- Accept these copy trims: “We load 50 first, then up to 250 at a time. This limit is ours, not the filing’s.”; “We load up to 250 payments at a time. More records may remain.”; “Nothing here carries that spelling”.

## Work and verification plan

1. Implement the directory and name-search layouts, states and copy. Verify filter/page/count and partial-failure behavior.
2. Implement exact-name payment grouping presentation and role-specific copy. Verify missing fields, repeats, precision, counts and continuation.
3. Implement committee payment layouts and independent report/payment states. Verify filing-year semantics, dates, failures and retained records.
4. Reconcile shared wording and the first HTML response, update the existing product guide and run focused tests, type checks and the full required suites.
5. Exercise the built application at desktop, tablet and phone widths, including keyboard, zoom, narrow screens and slow/failing requests. Have a fresh reviewer exercise reader flows.
6. Commit and push, open a pull request, clear current-head and merge-queue checks, merge, wait for deployment and verify the changed live flows. Record deployed evidence on the pull request.

## Current state

Build started from origin/main c57d54578e8772fc1c58f3a771152ae3a5466903 in this task's own worktree. No production records will be changed.

The local design HTML was reviewed as source, not opened through an alternate browser route after a local-file policy refusal. The built application requires its own browser verification before release.


## Integration evidence

- All 3,007 frontend tests pass after integrating the 4 surfaces and query-preserving return links.
- The production build passes, including the first-load size budget. The shared date/year helpers
  remain outside unrelated screen downloads; the import-boundary checks pass.
- Browser testing exercises actual public records through a local read-only GET connection.
  Desktop, tablet and phone checks cover directory filters, search, pagination, exact-name grouping,
  report/year/direction controls, continuation and source links. State tests cover independent source
  failures, unknown amounts/totals, missing registrations and retry behavior.
- Browser findings corrected: changing a directory page returns to the top; the original search
  survives a payment link/reload/return; small green labels use the accessible text green. At 320px,
  the existing shared header clipped its menu button. Its row now wraps the existing controls when
  necessary, preserving the logo and 44px controls rather than changing the header design.
- A missing committee kind withholds a specific donor threshold and labels the generic Board
  search honestly. Initial HTML can retain payment records when report information fails.
- At 320px the menu opens and closes within the viewport. At 375px the header remains on 1 row,
  the menu retains its 44px target and the document has no horizontal overflow.
- Release completion and deployed checks are recorded on the pull request after publication.
