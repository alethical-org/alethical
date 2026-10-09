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

- Both field labels remain above the address box. The legislator hint stays above it; the
  candidate entry hint is the first grey line below the divider and still describes the box.
- Candidate introduction: “See who’s running where you live in Minnesota”.
- Legislator introduction: “See who represents you in the Minnesota House and Senate”,
  matching candidate introduction size, color and 14px heading gap across all 3 bands.
- Candidate source note: “Address lookup uses Minnesota’s Secretary of State and mapping services”.
  Its divider sits 56px below the message region at 768px and above, where an open
  suggestion list overlays both grey lines; phones retain 36px. The note does not move
  as typing suggestions change.
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

## October 9 suggestion matching follow-up

- Two causes hid valid choices: lone street names such as `Summit` were consumed
  as street types; Minnesota's `SAINT PAUL` address label did not match election
  records using `ST PAUL`. The second cause also affected confirmation after selection.
- Both finders now keep a lone street-name prefix. Candidate matching accepts
  leading `SAINT`, `ST` and `ST.` in postal cities while preserving all remaining
  words and exact house, street, direction, ZIP, unit and official range checks.
- A confirmed candidate choice passes through the same exact parser as typed input.
  Mixed Saint/ST source records for an otherwise identical address are rejected as
  an overlap before confirmation can choose either range, including equivalent
  street abbreviations and city spacing.
- Public-source reproduction: `1006 Summit Avenue, SAINT PAUL, MN 55105` had zero
  candidate matches, while the same address with `ST PAUL` had one. The Secretary of
  State street row prints `SUMMIT AVE ` and `ST PAUL`. Both forms now identify the
  same official range. No ballot write was needed to establish this.
- Focused checks: 212 address, candidate and range tests pass. Browser checks at
  390, 900 and 1280 pixels cover narrowing, paste, keyboard dismissal, clearing stale
  choices and reachable rows. Candidate click, Enter and touch each request exactly
  one lookup for the selected current address; final requests were intercepted to
  avoid writes. Live release acceptance remains pending.
- These matching corrections do not enable the separately held public-address
  index or change suggestion freshness, privacy, visual treatment or request timing.

## October 9 copied suggestions and current-record selection checks

Scope: the approved proposal to answer address suggestions from a shared public copy,
check a chosen address against current official records before districts, share
same-ZIP street-table downloads, and measure the reader-visible result. Delivery
through live release belongs to Codex task “Address suggestion speed CB” after its
independent acceptance; Claude Code session “Address suggestion speed CB build” is the
sole implementation writer. The copy stays off until hosting capacity is established.

Evidence and causes:

- Live suggestions wait about 0.47 seconds (median of 63 sampled prefixes, laptop
  server time) on Minnesota's address service at every typing pause.
- `MinnesotaAddressPointGeocoder._candidates` kept only the first point when rows
  printed the same address with different official points. With Census unavailable,
  the typed lookup could silently pick 1 of 2 points in different districts.
- `geocode_matches` ignored the exact answer's row-cap flag, so a cut-short answer
  could be read as 1 address.
- `CandidateLookupService.streets` fetched outside its cache lock, so simultaneous
  misses for 1 ZIP each downloaded the same public table.

Affected uses: `/find-my-legislator` entry and Change address; `/candidates` entry and
Change address; the typed-lookup fallback; candidate no-ZIP resolution, which shares
`geocode_matches`. Homepage forms render no suggestions and hand only typed text or a
device location to their finders, so they need no change.

Approved differences kept: candidate suggestions still need exactly 1 official election
street range before display, and a chosen candidate address is still revalidated
against the Secretary of State tables; the legislator finder keeps its map-based
coverage. No visitor query or ballot is cached on the server.

Correction:

- Rows printing the same address keep every point. A lookup continues only when the
  first point's House, Senate and congressional shapes cover them all; otherwise it
  returns `representative-lookup-ambiguous-location` (shown as **No match for that
  address**). A cut-short exact answer is asked again at 2,000 rows and fails as a
  source error if still cut short.
- Suggestions carry `requires_location_check` when they come from the copy or carry
  conflicting points. Choosing one sends `selected_address` with its point; the server
  re-reads current points, uses 1 current point even when it moved, picks the nearest
  of several that share districts, refuses points in different districts, and runs the
  typed lookup when the check cannot settle the point.
- The browser starts that request when the reader points at, presses or arrows to a
  marked row, for at most 2 rows per typed address, sharing it with the pick.
- The copy (`address_suggestion_index.py`) is off by default; when on, every process
  on a machine shares 1 folder, 1 lock holder builds, a validated build swaps in all at
  once, the previous copy stays on failure, refresh is every 12 hours with 24-hour
  expiry and a 1-hour retry, and anything unusable falls back to the live service.
- 1 street-table download per ZIP is shared by simultaneous requests.

Prevention checks: `test_address_selection_check.py` (duplicate points, capped answers,
every selection outcome), `test_address_suggestion_index.py` (off switch, validation,
expiry, refresh schedule, shared-folder builder, damaged copies, untrusted state file,
copy-to-live fallback, candidate eligibility), API contract tests for the new request
and marks, street-table sharing tests, and frontend tests for the request body, the
marked-choice pick and the bounded early check. Removing the district-consistency
check, the row-cap retry, the current-point pick, copy expiry, street-table sharing or
the marked-choice request each made its tests fail.

Measurements on 9 October 2026, from the saved official file (no new download):

- Build: 2,220,021 rows, 288,256,000-byte copy, about 1.36 GB peak folder space,
  about 48 MB peak memory, 11.6 seconds including a local file copy.
- 63 seeded prefixes (7 civic, 24 general, 16 township, 16 apartment buildings): 62
  answered from the copy at 1.9 ms median (8.2 ms maximum) server time; 1 had no match
  anywhere and used the live service. All 63 returned the same labels, order and points
  (8 decimal places) as live. This is a sample, not general parity.
- Pick check for 34 chosen copy suggestions: all found, 0.78 seconds median (1.19
  maximum) server time, no point moved and no district changed.
- Browser, Chromium at 1280 px against local servers: suggestions appeared about
  0.18 seconds after the last key with the copy on (the existing 180 ms typing pause)
  versus about 0.79 seconds with it off. A legislator pick took 0.86–1.31 seconds
  (median of 5) when clicked at once with the copy on, 0.32–0.33 seconds after a
  0.6-second glance at the row, and about 0.12 seconds with it off. Candidate picks
  were unchanged. Under 4× CPU slowdown with a 300 ms, 1.6 Mbps phone network, the
  suggestion appeared after 0.78 seconds and the pick finished in 0.9 seconds.
- Browser behavior passed in Chromium at 1280, 900 and 390 px and WebKit at 1280 px on
  both finders, entry and Change address: every bottom row receives the pointer, touch
  and keyboard selection work, Escape and outside clicks close the list while keeping
  the text, a late older reply does not replace newer suggestions, a failed suggestion
  request stays quiet while Find still works, and earlier legislator results stay
  visible while a replacement loads.

Uncertainty: Railway's free disk, memory headroom, process count and any charges are
not established; this machine has no Railway access. Native phone keyboards remain
untested. Laptop timings are not the production wait.

Holds: the copy stays off; no new paid service or recurring agent; no Design send;
Codex acceptance before merge or release; retain this folder and branch after delivery.

Acceptance corrections (independent review, 9 October 2026):

- A group of points now agrees only when every point has the same single House,
  Senate and congressional answer. The old check only asked whether the first point's
  shapes contained the rest, so a point on the House 59B/43B border in Minneapolis
  (45.006042, -93.31852) passed beside a 59B point. An unreadable district map is now
  a retryable source failure instead of a refused address.
- A candidate suggestion carrying the reader's apartment or ZIP+4 relabelled the
  official choice but kept its fingerprint, so the server refused it while the same
  typed text succeeded. That fuller text now takes the normal address check.
- A marked legislator pick and its early check send the exact shown text, apartment
  and ZIP+4 included, so the pick reuses the early request. The early check is skipped
  when the browser asks to save data or reports a slow connection.
- The candidate **Find** button showed the purple keyboard ring after a mouse, pen or
  touch search, because focus moved from the text box and inherited its ring. A pointer
  press now marks that move and hides the ring; keyboard searches and later keyboard
  visits keep it. Chromium and WebKit checks cover pointer, touch, Enter, arrow plus
  Enter, and a Tab back.
- Disagreeing districts no longer reuse **No match for that address**.
- Every API start prints 1 `ADDRESS_COPY_CAPACITY` line of host facts, copy on or off,
  for the capacity check in [issue 2585](https://github.com/alethical-org/alethical/issues/2585).

Design record: no visual change. Settled wording and behavior for Design's build notes:

- Legislator finder, when current official points for 1 address disagree about
  districts: field message **We couldn’t safely identify your districts from this
  address** and answer line **Check your full street address, or choose where you
  live on the map**, each 1 sentence with no ending period, in the existing
  address-error position. Source failures keep **Lookup unavailable right now**.
- A legislator suggestion that needs the current-records check can take up to about 1
  second after a pick; a glance at the row first usually hides most of it.
- Candidate **Find** button: no purple focus ring after a mouse, pen or touch search;
  the ring shows after a keyboard search and on later keyboard visits.

Product corrections passed independent code and browser acceptance. Codex owns the
remaining release, capacity and charges check, activation and fresh-context live
review. Claude's product-writing lane is complete and its preview remains available.
The working folder and branch stay retained for follow-up.

Release preparation (9 October 2026):

- Added manual-only capacity reads and a bounded on/off control using the existing
  Railway project token. Activation requires exactly 1 measured production instance,
  fresh capacity and memory facts, no competing deployment and the reviewed live
  commit. Unknown facts refuse activation. Failed on attempts restore off where
  ownership remains clear; outputs expose only allowlisted host facts and fixed
  statuses. Before redeploying off, a failed activation with a known owned ID
  must end or reach success; only its own queued/building deployment may be
  cancelled, and a cancellation reply alone is insufficient. Unknown or lost
  identity remains unconfirmed. Neither workflow creates resources or runs on a schedule.
- The control's 62 focused tests cover privacy, stale and unknown facts, another
  operator's deployment, uncertain flag writes, rollback and a delayed first build.
  Production activation time remains unmeasured until the actual operation.
- Docker Hub refused the backend check twice before tests could start. GitHub's
  fresh runner now pulls directly from Google's public cache before starting the same
  disposable PostgreSQL image. Matching public image manifests establish unchanged
  database contents. Cache misses still use Docker Hub; final-head CI must exercise
  the runner setup. Local and shared development databases remain untouched.
- The scripts and manual workflow inventory now includes both new operations.
  Full local product suites passed before these release-only changes; inventory
  failures caused by the new files are corrected. Current-head checks remain the
  merge condition.
- The hosted website preview exceeded its first-download budget by 173 bytes.
  Contact links in the shared API pulled in the whole address-finder helper module.
  Moving those 2 contact helpers to their own small module preserves public imports
  and keeps address-entry and district-error code with finder screens. A local
  settings-less export passes at 296,154 bytes against the unchanged 297,506 limit;
  hosted preview and production must pass their own measurements. Contact and
  address-lookup tests pass; live contact links remain part of final acceptance.

The reviewed default-off release is live from
[pull request 2586](https://github.com/alethical-org/alethical/pull/2586).
The first manual capacity read stopped before identity facts: Railway returned
HTTP 403 to Python's default client. Holding the endpoint and request constant,
a named client reached GraphQL. The shared reader now supplies
`alethical-address-copy-capacity/1`; a regression fails without that header and
63 capacity/control tests pass with it. Both operations use this reader, so the
single correction covers reads and control calls. Authentication, privacy and
activation gates are unchanged. Independent code acceptance passed; the actual
authenticated workflow must still establish identity and capacity.

The [authenticated branch read](https://github.com/alethical-org/alethical/actions/runs/37999460117)
then succeeded: Pro plan,
1 active deployment and running instance, 1 API-program process, matching start
command, about 0.52 GB observed memory use and a 24 GB limit. The legacy dashboard
replica field was null and instance-grouped disk usage was unavailable. The
filesystem reported about 2.4 TB free; Railway limits a paid deployment to 100 GB,
so that reading alone cannot prove quota headroom. The reader now privately reads
the active deployment's explicit placement and saved environment configuration,
and separately requests service-level disk usage. Activation requires explicit
matching single-replica settings and fresh quota usage; missing facts still refuse.
69 focused tests cover these fields, privacy and refusal when large filesystem
free space accompanies missing or full quota usage. Actual extended-report proof
and activation remain pending.

Fresh-context live review passed normal legislator searches, pointer and keyboard
selection, apartment/ZIP+4 submission, candidate selection and typed searches,
changing addresses, retained old results and 375 px layouts. Candidate refusal for
350 South 5th Street matches Minnesota's official 55415 election street table:
no range covers house number 350; its 5TH ST S row covers only even number 600
([official 55415 table](https://myballotmn.sos.mn.gov/api/Streets/GetStreets?ZipCode=55415)).
1006 Summit Avenue matches the official 55105 range 1006–1220 and succeeds
([official 55105 table](https://myballotmn.sos.mn.gov/api/Streets/GetStreets?ZipCode=55105)).
Candidate results print the source's 5-digit ZIP, while cleanup/submission retains
ZIP+4; this existing difference does not demonstrate a regression. Post-activation
timings and live review remain pending.

Next step: establish Railway capacity and charges before setting
`ALETHICAL_ADDRESS_SUGGESTION_INDEX_ENABLED`, tracked in
[issue 2585](https://github.com/alethical-org/alethical/issues/2585).
