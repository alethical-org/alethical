# Candidate autofill and stable browser recovery

## Authorization and outcome

The combined build was approved on October 2, 2026, superseding
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
6. [x] Main repair independently reviewed, full upload checks passed, released in pull request 2474.
7. [x] Main repair live address/browser checks passed; physical-device limits recorded below.

Phone-sized Chromium/WebKit testing is not native keyboard autofill testing.
Actual iPhone/Android saved-address evidence remains pending from physical-device testing, while
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
- Frontend: 4,055 tests passed after the final browser-value preservation refinements.
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
  pass; initial program is 297,083 of 297,506 allowed compressed bytes locally.
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

- Final menu review found the candidate header wrapper below its sibling content,
  which intercepted pointer movement into Search and About menus. Raise that
  wrapper to the existing header layer; homepage and candidate-profile wrappers
  do not share the defect. Cover continuous pointer paths, full row hit areas,
  keyboard, touch, election selection and narrow-screen containment.
- Hosted brand checks now inspect the static HTML that owns the saved-site icon
  and manifest, matching the unchanged metadata moved out of the application code.
- Shared Search/About pointer-gap repair keeps the same visible 26px gap, but
  includes it in the open menu's pointer area. This removes the race against
  the close timer without extending that timer or moving the menu.

## Final live review follow-up

The main repair shipped in https://github.com/alethical-org/alethical/pull/2474.
Live candidate lookup returned the same 42 races for a public civic address with
no country, United States, U.S.A. with dash punctuation, and balanced parentheses.
The live legislator lookup also returned House and Senate matches with the country.
All 24 deployed recovery checks passed in Chromium and WebKit. Physical phone
keyboard autofill remains untested; phone-sized browsers are not that evidence.

Independent live review then reproduced an additional editing defect: after Change
address, typing the exact previous submitted address closed the form without a
submission or network lookup. A screen effect treated equality with old results as
a completed search. A failing regression test reproduced that same transition.
Close editing only when a new successful result arrives, including a deliberately
submitted cached result; retain drafts through failures, cancellation of older
requests and profile navigation. Shared-use inspection located this effect only in
candidate search; the homepage equality check runs inside explicit submission and
does not share this trigger. Unit and browser checks cover typing the previous query,
the absence of an unintended request, and explicit cached resubmission. The current
candidate lookup task owns the follow-up release; original preview 19047 stays in use.

The same review reproduced a second transition failure: clicking Search with an
inline phone suggestion visible blurred the field and moved the button 128px before
pointer release. The release landed on Election instead, requiring a second click.
Apply the existing suggestion-choice keep-focus behavior to this form's submit
button; preserve keyboard focus and visual layout. The browser regression failed
before repair and covers the first mouse click and emulated touch tap afterward.
Legislator web suggestions do not close on field blur, and the candidate homepage
has no inline suggestions, so those paths do not share this cause.

The follow-up passes 39 focused tests, type checking, release export and its size
limit. All 15 release-browser journeys pass in both Chromium and WebKit, and the
3 added edit/click/tap journeys pass in Firefox. Independent real-source review
at original preview 19047 passes mouse, emulated touch and Tab then Enter, plus
editing, failed updates with retained results, and retry. The final issue comment
records the follow-up deployment and live acceptance once complete.


## October 8 follow-ups in progress

The approved candidate submit label is **Find**, matching legislator
search, with faster suggestions on both surfaces. Implementation and live release
are authorized; actual phone acceptance follows release. The separate initial
account-restoration reset in issue 2529 remains owned here, with genuine account
changes retaining their immediate privacy reset.

- Parent owns button copy, suggestion latency diagnosis/integration and release.
- Read-only helpers trace suggestion latency and initial account restoration.
- Measure the service chain before changing the 180ms typing pause. Preserve
  official matching, units, privacy and latest-input-only results.
- Update both behavior guides and Design records with settled corrections.
- Run focused regressions, independent review, browser acceptance, current-head
  checks, release and live acceptance. Keep physical phone limits explicit.
- Model assessment: full scope includes service latency and privacy-sensitive
  account lifecycle. Recommend gpt-6-astra high for lead judgment; gpt-6.1-sol high
  for bounded read-only diagnosis. Current official model pages describe Astra
  for demanding reasoning/coding and Sol as the workhorse; no comparative task
  benchmark was run. High reasoning suits the unresolved shared-state questions;
  deeper settings have no identified additional benefit here.

### Follow-up scope and prevention

- Both field labels and their location-specific hints remain above the address box.
- Candidate introduction: “See who’s running where you live in Minnesota”.
- Legislator introduction: “See who represents you in the Minnesota House and Senate”,
  matching candidate introduction size, color and 14px heading gap across all 3 bands.
- Candidate source note: “Address lookup uses Minnesota’s Secretary of State and mapping services”.
  Its divider uses a fixed 144px top margin after the message region at 768px and above;
  phones retain 36px. The note does not move as typing suggestions change.
- Both suggestion routes use the same Minnesota address service. The service omits
  the remote status filter but still filters ACTIVE locally, preserving state, house,
  direction and unit checks. A source transfer-limit flag retries the original query
  so inactive rows cannot crowd out valid choices. No shared address cache is added.
- Six counterbalanced public-source pairs returned identical suggestions with median
  time 1.113s before and 0.907s after, about 18% faster. Government response timing varies;
  an earlier sequential sample was slower. This is not an instant-result guarantee.
- Initial saved-account restoration establishes identity without clearing fresh candidate
  input, pending lookup or results. Once identity is known, actual account transitions
  still clear and cancel private search state, including transitions while loading.
- Prevention tests cover initial restoration, anonymous baseline, rejected restoration,
  established-account rejection and switches, active filtering, incomplete-source fallback,
  fallback failure and unchanged address identity. Browser acceptance covers 3 layout bands,
  short suggestions, Find submission and the two introductions. Physical phone autofill
  remains a user acceptance check after release.

### Follow-up acceptance before release

- Full checks passed: 4,606 backend tests and 4,236 frontend tests before the final
  shared-field correction; 45 focused address tests and TypeScript pass afterward.
- Independent browser acceptance covers 3 layout bands, fixed source-note position,
  both introductions and public-source suggestions/results. The user-reported country-
  suffixed address also returned candidate results without an automatic reset.
- Browser review found external Find could reopen suggestions after loading ended.
  React Native Web consumes the click before the outside-click listener; imperative
  dismissal now disables automatic suggestions until deliberate editing or refocus.
  This shared correction covers candidate entry/Change address and legislator
  Find/location/map requests. Escape then Arrow Down remains available.
- Both new regression cases failed before the correction and pass afterward, for
  unchanged and canonicalized addresses. Independent browser review confirmed stable
  settled results, deliberate reopening, Escape/Arrow Down and narrow candidate use.
- Design updated the existing candidate and legislator drawings and address build
  notes. Candidate drawing shows exact new copy and 144/144/36px source margins.
  Its extra download and prompt card are not dependencies of this running build.

## October 8 second suggestion-speed pass

Authorized outcome: make address suggestions on both finders faster through live
release, preserving source accuracy, privacy, keyboard/touch behavior and current
input ownership. Proposed profile-introduction copy is discussion only, not approved
for this build.

- Baseline: six live curl POST requests took 0.775–1.216 seconds, before the
  shared field's additional 180ms typing pause. No suggestion-response reuse exists.
- Shared callers: candidate entry, candidate Change address and the legislator
  finder. Homepage forms hand addresses onward and do not render this shared field. Full candidate addresses still use official street records;
  partial candidate and legislator suggestions share Minnesota address points.
- Investigate source query time separately from input scheduling. Parent owns
  frontend scheduling, bounded field-local reuse and integration; backend helper
  owns read-only source measurements before a scoped implementation assignment.
- Prevention checks: first eligible input, fast typing, out-of-order responses,
  dismissal/submit, expiry, clearing/account transitions, source transfer limits,
  units and matched-address correctness. Full search validation remains mandatory.
- Model assessment: gpt-6.1-sol high suits the bounded measurable performance path
  with existing matching and interaction contracts. GPT-6 Astra high is the strongest
  alternative if diagnosis exposes unresolved cross-account semantics or new data
  architecture; neither is currently required by the measured work. Official
  OpenAI GPT-6.1 Sol model guidance read October8 describes complex coding support;
  this is a task judgment, not a measured model comparison.
- Completion: independent review, relevant suites, desktop/tablet/phone-width browser
  checks, current-head release checks and live measurements. Real phone keyboard
  testing remains a separate maintainer acceptance check after release.

- Source-query evidence: 7 paired queries for 3 civic prefixes returned identical
  records, with median 0.743s before and 0.624s after moving the state filter local.
  Source truncation still retries both original state and active-status filters.
- Stateless pooled source connections: warm median 0.617s versus 0.469s in a small
  paired sample. Fresh connections do not gain the warm benefit. Pooling is per
  server thread, rejects cookies including redirects and strips credentials; it
  stores no address/query results and leaves Census unchanged. Full-address candidate
  suggestions using existing SOS ZIP tables do not use this path.
- Frontend keeps the 180ms trailing pause during continuing typing but sends the
  first eligible input and edits after idle immediately. A proposed 100ms throttle
  was rejected in review: normal 140ms typing could consume the 60/minute allowance.
  Actual-input tests now produce at most 4 requests across 2 uninterrupted address
  bursts, rather than 83 under the rejected proposal.
- Exact positive results reuse at most 8 entries for 60 seconds in the mounted
  field only. Empty field, search start, suggestion-source replacement and unmount
  erase reuse; failures and empty matches are not cached. No shared location cache.
- Independent review passed 126 focused checks across field behavior, supporting
  privacy/form flows and backend matching/transport. Parent browser checks passed
  both routes at 1280, 900 and 390px with delayed local fixtures; exact-input reuse
  took 9–25ms in Chromium. This measures local display, not a new upstream lookup.


## Address suggestions above Election (8 October 2026)

- Report and scope: [issue 2555](https://github.com/alethical-org/alethical/issues/2555). In the candidate results Change address form, Election covered and intercepted suggestion rows.
- Cause: the editor’s React Native Web wrapper created a default layer below its sibling Election wrapper (3). Raising the suggestion panel itself could not escape that containing layer. The editor now uses layer 4 inside the existing sidebar; navigation and dialogs retain their higher priority.
- Affected uses: candidate Change address on desktop and tablet. Candidate entry and Find my legislators share AddressSuggestionField but already pass the same rendered row hit checks; the latter explicitly raises its address area above results and its map. Phone lists remain in page flow and push subsequent controls down. No universal portal, new layer scale or unrelated control restyle is introduced.
- Prevention: `apps/frontend/scripts/check-address-suggestion-layering.mjs` opens 5 wrapped rows in both finders and Change address at 1280, 900 and 390 pixels, checks 9 points per row, selects a formerly covered lower row, checks arrow/Escape behavior and Election after dismissal, and requires phone rows to end above Election. The required frontend release check runs this script against the built website. Chromium and WebKit pass after the fix; the unmodified editor failed on rows 2 and 3.
- Accepted target: preserve current widths, 8px suggestion gap, styling, navigation/dialog order, old results during editing, and existing source/privacy behavior. No select-all or introductory wording change. Design consultation and final release evidence are recorded on the linked issue.
- Design accepted the containing-editor correction and updated its layer requirements, drawings and build notes. The drawing already showed an unobstructed list; the implementation introduced the lower parent layer and the handoff did not name Election explicitly.
- Candidate no-match wording now reads “We couldn’t match that address to election records” in entry, retained-results editing and the homepage handoff. A mapped address can lack an official election street-range match, so this state must not imply that the reader mistyped it. Legislator and incomplete-input messages are unchanged.
- Independent code and browser review accepted the containing-layer fix; parent acceptance covered the final candidate-only copy and required browser check. Remaining checks: final release and live browser acceptance, recorded on the linked issue. Native phone keyboards require physical phone testing; viewport and WebKit checks do not establish that.


## Shared suggestion request timing

Scope: improve `/candidates` entry and Change address and `/find-my-legislator`
suggestions through live release. Preserve the approved visual treatment, separate
matching services, privacy limits, 180ms grouping of continuous typing and full
validation on submission. Homepage forms do not render suggestions.

Cause and correction: a paste or browser replacement inside a typing burst waited
180ms even though the replacement was complete. An outer-space edit aborted and
repeated the same trimmed server query. The shared field starts explicit paste,
drop and browser replacement events immediately; a matching in-flight promise
survives outer-space edits, and positive field-local reuse keys trim outer spaces.
Ordinary typing remains grouped, and addresses differing inside the text stay
distinct. New input, disabled suggestions, search start, source changes, blur and
unmount retain cancellation or newest-generation rejection as appropriate.

Impact and prevention: both dedicated finders share the correction. Existing
60-second/8-entry reuse, clear/search/source/unmount erasure, unit checks, quiet
optional failures, keyboard selection and first-tap selection remain required.
Focused fake-clock tests cover immediate replacements, pending reuse, 140ms typing,
late responses and privacy boundaries. Rendered browser checks cover both routes
at desktop, tablet and phone widths, with delayed local replies and real space-key
input. Native phone keyboard autofill remains untested.

Source measurements use public civic prefixes `350 South 5` and `15 West Kellogg`.
On 9 October 2026, 3 live legislator calls took 1.003–1.374 seconds and 3 candidate
calls took 0.852–1.419 seconds. Direct Minnesota requests took about 1.06–1.20
seconds warm. Removing the numeric-prefix uppercase expression did not materially
reduce the wait; house-number-only queries exceeded the 200-row response limit.
No backend matching change is supported by those samples. These observations do
not promise a fixed response time or identical suggestion sets: candidate results
still require the separate official election-address check.

Owner: Codex task “Speed up address suggestions”. The lead retains frontend
implementation, integration and release; the backend helper completed bounded
source measurements without edits. The independent reviewer checks pending request
ownership and missed shared uses. Completion requires focused tests, type checks,
rendered browser checks, current-head release checks and live acceptance.

Model assessment: `gpt-6.1-sol` with `high` reasoning fits the bounded request
lifecycle diagnosis and existing correctness tests. The strongest alternative is
`gpt-6-astra` with `high`; current evidence exposes no new data architecture or
unsettled privacy policy requiring it. Official OpenAI model guidance was read on
9 October 2026. This is a task judgment, not a measured model comparison.

Acceptance: 140 focused checks and type checking pass after integrating the merged
address clearing/cancellation work. Chromium and WebKit pass both dedicated
finders at 1280, 900 and 390 pixels with delayed fixture replies and real space-key
edits. Completed-reply reuse renders in 7–29ms in these samples; this is local
redisplay, not a fresh government-source lookup. Chromium layering and selection
checks pass all 6 placements. The independent integrated-code review accepts the
scoped outcome and prevention checks with no remaining material findings.
