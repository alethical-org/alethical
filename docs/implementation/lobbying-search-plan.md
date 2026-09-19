# Lobbying search delivery plan

User authorization: the September 17, 2026 go approves the reviewed Alethical UX (14) build through the verified live release. Keep the dedicated directories and the broad money search. No production data replacement or paid run is part of this work.

## Sequence

1. Build submitted-query search on /money/lobbying, the reviewed responsive layouts, and exact reviewed copy. Verify requests, empty/error states, Clear, and newest-query behavior.
2. Add distinct registered spellings to principal list responses by official entity ID. Verify source isolation and deduplication with focused backend tests. This work runs alongside the frontend build in a separate helper, with separate files.
3. Integrate and test route round trips, browser history, links, mobile layout and keyboard access. Independently review the combined change and fix findings.
4. Update the lobbying guide and relevant snapshots. Run required checks, open the pull request, merge when green, wait for deployment, and exercise the live search.

## Fixed build decisions

- Search within lobbying, with 5 results per group and links to filtered full lists.
- Exact independent group counts including 0; failures carry no count. No count across groups.
- URL query represents the last submitted search. Invalid drafts keep the preceding results under their old query. Clear and new searches cannot be overwritten by older responses.
- Current registration spellings come only from the same official entity ID and held source pair.
- Phone cards stack; tablet and desktop retain their supplied layout. Counts and supporting explanations are at least 15 pixels.
- A short separate live announcement describes updates; links remain links inside list items.
- Use the reviewed copy corrections, the shared horizontal link arrow, and the existing shared header/footer.

## Progress

- [x] Review supplied design and resolve remaining choices.
- [x] Implement frontend and backend.
- [x] Complete focused tests and browser review.
- [x] Complete independent review.
- Required upload and release checks run against the final saved commit.
- Release evidence and completion are recorded in [issue 2237](https://github.com/alethical-org/alethical/issues/2237).

## Contribution trust delivery

Authorization: “build both here go” covers the lobbying and remaining money UX copy, source-date and notice changes through live release. It does not authorize historical data replacement, changing matching/calculation rules, or treating an unresolved record count as distinct donations.

- [x] Read the live wording and existing source safeguards; branch from current main.
- [x] Use shared count/matching/coverage wording across lobbying, search and payment records, including server-rendered previews and share descriptions.
- [x] Add the dated, source-specific Carlson count review only for the affected contribution copy; keep all-year findings distinct from selected-year results.
- [x] Preserve official totals, source dates, missing-versus-zero, and existing full-year checks; document accepted semantics.
- [x] Run local checks, browser review on desktop/tablet/phone, and independent review. Frontend: 3,475 tests; backend: 2,943 tests; TypeScript, required Python lint/types and documentation checks pass. Release checks remain below.
- Publication and live-check evidence are recorded in [pull request 2326](https://github.com/alethical-org/alethical/pull/2326).

Browser review also corrected the source filing-year label and scoped contribution thresholds away from spending-only name pages. The existing committee-payment loading flash is recorded under [issue 2024](https://github.com/alethical-org/alethical/issues/2024#issuecomment-5744253800), outside this wording build.
