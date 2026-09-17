# Outside-spending browsing build

User authorization, 17 Sep 2026: “Minor pagination design correction in this version. Build it based on your rec.” This authorizes the approved version 13 design and prior review corrections through tests, browser review, pull request, merge, deployment, and live checks. No renewed approval is needed between these steps. Design taste remains with the supplied drawing.

## Scope

Keep `/money/outside-spending`, replace its directory shortcuts with real year-scoped, name-only browsing of outside-spending groups and committees. Keep `/money/search` elsewhere. Preserve subject payment views except obsolete navigation, return behavior, and selected historical year visibility. Use the revised centered Previous / page count / Next pagination and existing shared page furniture.

Approved copy: add “These figures cover the whole period, whatever name you search for”; move the campaign-committee definition beneath the Committees heading; retain “We cannot open a separate spending record for this name”; apply established punctuation; retain the reviewed bottom explanations and official download link with the actual source-copy date.

## Sequence and ownership

1. Backend helper `outside_names_api`: full-source participant names, years, literal search, stable identity/order, 12 names/page, same-snapshot guard, database tests. No per-name amounts.
2. Current task: frontend browsing, real addresses, pagination, responsive layout, subject return and scroll restoration, focused tests.
3. Documentation helper `outside_browse_docs`: current user guide and system-design descriptions. Runs alongside 1 and 2 without editing code.
4. Current task: integrate and inspect desktop/tablet/phone in the browser. Independent reviewer checks behavior and correctness. Fix findings and run required checks.
5. Current task: commit, push, pull request, current-head/merge checks, deploy and exercise the live route. Record final evidence here.

## Progress

- Version 13 differs from version 12 only in pagination presentation and disabled end controls.
- Own branch `codex/outside-spending-browse` starts from current `origin/main` in the existing isolated task worktree.
- Backend name browsing and frontend integration complete. Database/API coverage: 42 tests passing. Frontend focus checks include name browsing, seeded reads, served HTML, and return history.
- Independent review fixes: preserve the actual held year when refresh fails; show retry if the source copy changes; show failed-refresh feedback for cached empty results; keep the original browsing entry through subject filter changes and reload; clear merged year/page parameters explicitly.
- Desktop, tablet, and phone browser checks use an isolated disposable test database with 26 illustrative groups and committees. Confirmed full-source search, both modes, year totals, page 3 missing-ID and absent-register names, real subject links, All years clearing, and return after reload. Phone pagination uses version 13 spacing; no design change requested.
- Remaining: exact-commit local release checks, PR/merge queue, deployment and live browser checks. Test server handles: frontend local port18743, backend18744, task-owned disposable database; stop after verification.
- Review addendum: `/Users/eug/Downloads/outside-spending-build-review-2026-09-17.md`; temporary design reference: `/tmp/alethical-outside-spending-build-13/exports/design_review_outside_spending/`.

## Required evidence

Search beyond the first results page; both browsing modes; all years and a historical year; page reset/clamp; missing IDs remain visible; missing amounts/failures never become zero; shared URLs; real subject links; browser Back and in-page return preserve filters and position; correct fonts and responsive order; general money search remains reachable. The release is finished only after live evidence.
