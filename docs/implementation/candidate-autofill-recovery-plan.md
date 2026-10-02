# Candidate autofill and stable browser recovery

## Authorization and outcome

Eugene authorized the combined build on October 2, 2026 with “build”, superseding
the earlier research-only hold. Carry the address fix, shared recovery repair,
related-use checks and prevention rules through review and live release. Preserve
candidate temporary-memory privacy, legislator-specific matching and URL behavior,
and existing Design direction. New visual choices still require Design review.

## Impact and prevention

- Proven cause: terminal country text bypasses the candidate ZIP parser and the
  shared Minnesota address parser rejects it; suggestions can still return a match.
- Proven cause: a rejected on-demand download requests a whole-page reload even
  after its component is removed. The HTML script error listener and optional
  campaign-money preloader can independently request the same reload.
- User report: mobile results appeared then returned to an empty candidate form.
  The particular triggering event has not been captured. Do not equate the proven
  reload defect with a proven diagnosis of that historical event.
- Affected uses: candidate homepage and /candidates, legislator homepage and
  /find-my-legislator, route downloads, optional campaign-money details, other
  working forms/results exposed to whole-page recovery.
- Deliberate differences: candidates keep address only in memory and require
  confirmation for ambiguity; legislator search has its own safe-match policy and
  puts the matched address in its link. Account changes still clear private memory.
- Correction: narrowly normalize complete addresses with recognized US suffixes;
  submit the visible field value; confine automatic recovery to startup and keep
  optional/abandoned download failures from discarding unrelated working content.
- Prevention: regression tests for browser fill before change events, formatting,
  stale suggestion choices, late download failures and startup recovery; shared
  impact review requirements in existing owner rules.
- Owner: current task candidate lookup; address backend/frontend helpers supply
  separate changes, current agent reviews, integrates and releases.

## Sequence and acceptance

1. [x] Refresh scope/intent and inspect current main, open work and shared consumers.
2. [x] Implement/test common address formatting and current-visible-value submits.
3. [x] Reproduce recovery defects with failing tests; implement bounded recovery.
4. [x] Update approved behavior records and shared prevention instructions.
5. [x] Exercise browser flows, keyboard/button/choice submission, stale responses,
   delayed failures after success, back/profile/election paths, contact draft and
   money detail preservation, startup failures and account privacy resets.
6. [ ] Independent review accepted; full upload checks passed; pull request and release remain.
7. [ ] Live address/browser checks; record physical-device coverage honestly.

Phone-sized Chromium/WebKit testing is not native keyboard autofill testing.
Actual iPhone/Android saved-address evidence is requested from Eugene, while
independent work continues. Never store private addresses or auth callback data
in tests, logs, artifacts or issues. Use public civic addresses for reproduction.

## Concurrent work

The task Locate candidate notice data owns candidate coverage placement and empty
race wording in another checkout. Do not duplicate it; integrate its landed change.
The existing preview at port 19047 stays the current task's target.

## Verification checkpoint

- Backend: 512 focused tests pass, including common US country spellings, comma,
  period, semicolon, colon, dash and balanced-parenthesis boundaries. Foreign
  countries, incomplete ZIP+4 and unknown trailing words are preserved for rejection.
- Frontend: 4,046 tests passed after the final browser-value preservation refinements.
  All 36 release browser checks passed (12 each Chromium, WebKit and Firefox).
- Additional proven browser cause: an unrelated React render can overwrite a saved
  address before the browser reports an input event. WebKit traced the value present
  at blur and erased before pointerdown. Preserve the browser-owned value across
  unrelated renders, while applying deliberate selections and resets explicitly.
- Independent browser review: candidate correction, delayed failures, Back from a
  failed profile download, unsent Contact text and sign-in failure recovery passed.
  HTML-dialog keyboard entry, Escape/Close, focus return and hover passed in Chromium
  and WebKit; add 6px scroll padding to preserve the focus outline at 320×300.
- Shared personal prevention requirements shipped in tool-settings pull request 48;
  this branch carries the Alethical-specific requirements and behavior records.

- Official-source smoke check: the public civic address 12805 St Croix Trl S,
  Hastings, MN 55033 resolves identically with no country, “United States”,
  “U.S.A.”, balanced parentheses and an em-dash separator. No source records changed.
- Release issue: https://github.com/alethical-org/alethical/issues/2473
- Integrated notice placement/wording from https://github.com/alethical-org/alethical/pull/2472
  into the original preview at port 19047.

- Final production-style export: release assets, CSP, icon and first-load budget
  pass; initial program is 297,074 of 297,506 allowed compressed bytes locally.
  Hosted production must pass its own measurement. Fixed metadata/focus/autofill
  styles moved unchanged from runtime injectors to HTML to offset recovery cost.
- The original preview's earlier read proxy allowed only election-list requests.
  Expanded its local-only allowlist to the read-only candidate lookup/suggestion
  endpoints, retaining no logging/no-store and denying all other paths.

- Full committed-code upload checks: 4,071 backend tests passed in 320 seconds,
  alongside frontend type/format/unit and build-tool security checks.
- Final short-screen recovery acceptance: 320×300 Close button bottom at 294px,
  leaving its focus outline visible; Chromium and WebKit passed all dialog checks.
- The notice task accepted its merged changes at original preview 19047, using
  live public-address results at 390/900/1280 widths.
