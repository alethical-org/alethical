# Finance search and record clarity

Approved scope: Lobbying design, Finance identifier wording and shared search and
list defaults across Finance, including implementation and verification. The
current chat owns delivery; work stays in its retained checkout.
Delivery and acceptance are tracked in [issue 2911](https://github.com/alethical-org/alethical/issues/2911).

## Required behavior

- Broad directory search includes every browsing category in Lobbying, Campaign
  money and Media buys. Results identify their kind. Explicit filters and searches
  within a record retain their scope. Names alone never establish identity.
- Each result group keeps its own count, sort, filters, response status and paging.
  Empty, failed, loading and retained results remain distinct. Useful results survive
  an independent group failure. No cross-group money or file-count sums.
- Search uses the shared live-search implementation already shipped in PR 2909.
  Clearing restores browsing choices; query, filters, pages and return links agree.
- Pagination directly follows full tables/lists. General explanations follow in
  About these records, then routine Sources and updates. Necessary qualifications
  and record evidence stay beside the records they qualify.
- Empty results omit empty tables and useless sorting/paging. Recovery filters stay.
  Short copy retains scope on phones and standalone items. Definitions add meaning
  without repeating their headings.
- Directory membership does not prove current representation. Missing report,
  missing amount and conflicting reports are different states; none becomes zero.
- Identifier labels and visibility follow the [Finance app guide](../product-onboarding/finance-app-guide.md).
  Technical keys and source quotations are preserved.

## Delivery dependencies and ownership

1. Codex coordinates the existing Claude Design conversation in the Alethical B2B
   project. Design updates existing files, owning rules and build notes. Codex
   reviews rendered changes before implementing dependent layouts.
2. Identifier helper owns only the approved identifier wording outside Lobbying,
   CampaignMoney and MediaBuys and its focused assertions. Parent integrates it.
3. Backend helper owns the report-exists/missing-amount distinction and regression
   test. No production data changes.
4. Parent owns combined search, scoped copy/layout changes, requirements, browser
   checks, integration, independent review, PR, release and live acceptance.

## Acceptance

- From every browsing category, a query can find a name in another category.
- Full-list expansion, paging and return restore each group's scope. Media buys
  keeps each group's source version through its existing versioned API; Campaign
  money and Lobbying retain their existing current-release API behavior.
- Explicit party, registration, station, year, category and type filters retain
  their intended scope. Empty-state recovery stays available.
- Failed groups never claim zero. Kept results retain the query/year they answer.
- Present report with no numeric amount says Amount not given; absent report says
  No spending report available with the selected year still visible in context.
- Names, IDs, units and meaningful qualifiers remain readable across responsive
  bands, keyboard focus, touch, open menus and enlarged text.
- No mocked data, review controls, invented relationships or illustrative counts ship.
- Current-head checks, independent review and actual live browser verification pass.

## Current state

Design's initial update and subsequent Opus 5.5 High reviews are complete. The
current Lobbying, Campaign Money, Media Buys, identifier pages, shared rules and
build notes were inspected. Final corrections remove an unsupported generic
payment card, accurately describe the 500-result cap and correct an illustrative
principal evidence locator. No illustrative data ships.

Real-data browser review covers all three directories at 1280, 900 and 390 pixels,
query updates, cross-category results, empty groups, full lists and pagination.
Lobbying detail return restores search; Media agency detail return restores page 2
and its source version. Clear search restores the prior browsing category and
focuses the field. Lobbying's phone menu opens above results and closes with Escape.
Registration numbers and state entity IDs were inspected on Lobbyist and Principal
paths. Identifier states requiring unavailable real confirmations remain covered
by focused tests, not claimed as rendered. Actual touch-device and diagonal pointer
movement checks remain unperformed; narrow layouts were exercised with pointer and
keyboard. Failure and stale-source states are covered by regression tests.

The build reuses live search shipped in PR 2909. Local checks and independent code
review are complete. Release checks and live acceptance remain open in
[PR 2912](https://github.com/alethical-org/alethical/pull/2912).

## Review findings and prevention

- Root cause: each broad field inherited a browsing category. The three directory
  pages now make independent reads across categories, preserving each API's matching
  and explicit filters. Tests start from every category and fail one group alone.
- Lobbying's API uses `not_reported` for a successful empty list. Real-contract
  fixtures now cover that state, both-empty results and unavailable reads separately.
- Source identifiers were inconsistently named; one principal suggestion displayed
  a registration number while linking by entity ID. Labels now follow the actual
  value and locator type. Lobbyist evidence uses its registration number; principal
  expenditure evidence uses its source-file row locator.
- A present spending report with a blank amount was classified as absent. Report
  existence now uses the held-row count; blank, zero, absent and duplicate reports
  remain separate. Backend regression failed before the correction and passes after.
- Independent review found stale counts after 404, missing retained-query labels,
  and lost focus on same-page result transitions. Focus and failure regressions
  cover the corrected behavior; real browser checks also exercise expansion and clear.
- Media source versions now survive detail return and reload in scoped URL values,
  without account data. A changed source restarts only its affected group on retry.
  Tests cover remount, stale pages and failed source options with a selected station.
- Scope differences are intentional: Campaign money and Lobbying keep existing
  current-release endpoints; record-local searches, explicit All-recipient filters,
  and Money connections mode tabs are not widened. No new matching or identity rule.
- Final local Finance suite passed 925 tests in 51 files; 30 focused backend
  tests passed. Production build, built-link checks and return-link guard passed.
  The design lint finding for Inter is the approved Finance typeface exception.
  Independent review accepted the corrected Media version and stale-count paths.
  Current-head CI and production acceptance remain pending.


## ID visibility follow-up

The Finance app guide owns the rule: identity review and Alethical IDs stay in the
background; importer entry positions also stay out of source details. Public profiles,
source facts and official IDs remain. No backend records or access rules change.

The retained identity page was reachable by direct URL despite absent navigation.
App registration and the enabled-route list must both exclude it. Evidence panels
must omit importer positions while preserving official lobbyist/filer registration
locators. Regression checks cover direct arrival without identity reads, payment
source facts/links and confirmation quotes with retained official registrations.

Design update: Opus 5.5 Medium, bounded edits to existing drawings and rules. Build
recommendation: GPT-6.1 Sol Medium. Medium fits the settled removal and source-field
classification; higher effort has no identified unresolved design decision to settle.
Independent review checks missed uses and preservation of source evidence. Delivery
remains in PR 2913 until current-head checks, Design review and live verification pass.
