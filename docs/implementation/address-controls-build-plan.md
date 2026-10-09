# Address controls delivery

<!-- describes: apps/frontend/scripts/check-address-recovery.mjs, .github/workflows/ci.yml -->

## Authorized outcome and input

Implement the reviewed address controls on `/candidates`, `/find-my-legislator`,
and the signed-out candidate and signed-in legislator finders on `/`. Deliver
through browser acceptance, tests, pull request, deployment and live acceptance.
Design receives a copyable record-update prompt; sending that prompt is not part
of this task. Candidate profile changes belong to separate work.

Accepted input: `Alethical UX (70).zip`, downloaded 9 October 2026.
SHA-256: `646c469946bcdd7b62ed63e37a2f3a8c33624bf36cc16caedcb79c7c597d7e67`.
Temporary extracted reference: `/tmp/alethical-address-latest-review/exports/design_review_address_clear`.
Drawings: `Address controls.dc.html`, `Candidates search.dc.html`,
`LIVE Find My Legislator.dc.html`, `LIVE Home signed out.dc.html`,
`LIVE Home signed in.dc.html`; behavior: `build-facts-address-clear.md`.
Supported layout bands: below 768, 768–1099, and 1100 or wider.

## Design comparison and settled corrections

Scope includes the complete address forms and their surrounding existing results,
menus, notices, source/date labels and homepage content. Preserve their wording,
sources, dates, colors, type, order and results except the controls described here.
The source guides own the unchanged surrounding behavior:
[candidate lookup](../product-onboarding/find-my-candidates-guide.md),
[legislator lookup](../product-onboarding/find-my-legislator-guide.md),
[homepage](../product-onboarding/home-screen-guide.md).

| Requirement | Reference and starting state | Expected user outcome | Acceptance |
| --- | --- | --- | --- |
| Clear button | Address controls: empty, filled, hovered, pressed, keyboard focus, busy and error | Accessible name Clear address; 44px circle, 16px glyph, stroke 2.2, color #4f5651; transparent idle, #f1f1f4 hover, #e6e8e7 press, 2px #7c5cff keyboard outline offset 2px; no click-only outline | Passed: focused tests and rendered acceptance |
| Stable slot | Every address field, all bands | Text reserves button space even when empty or busy; no shift on appearance | Passed: focused tests and rendered acceptance |
| Actual visible value | Typed, pasted, carried or silently browser-filled address | Clear appears whenever the actual field holds text; fill survives unrelated renders; growing field displays entire value and placeholder | Passed: focused tests and rendered acceptance |
| Clear action | Filled field, suggestions and field error | Empties without submit, keeps typing focus, dismisses suggestions and choices, removes input-bound error, retains service error and successful results | Passed: focused tests and rendered acceptance |
| Stale work | Clear or Cancel while optional suggestions or lookup pending | Old work cannot restore text, suggestions, error or results | Passed: focused tests and rendered acceptance |
| Candidate entry | Candidates search entry states | Existing Full street address, helper, Find/Finding candidates…, privacy and errors remain; no added selection or Cancel | Passed: focused tests and rendered acceptance |
| Candidate editor open | Candidates search results, Change address | Select whole address once; no suggestions until edit; later click/tap places cursor | Passed: focused tests and rendered acceptance |
| Candidate editor actions | Results editing, busy and failed states | Find and outlined Cancel in one row; 52px minimum height, reserved room for wrapped/enlarged waiting text; Find flexes; Cancel remains available while search waits | Passed: focused tests and rendered acceptance |
| Candidate Cancel and Escape | Editing after change/clear, pending and failed searches | Restore successful address and election, invalidate old requests, close editor and return focus to Change address; Escape dismisses open suggestions first | Passed: focused tests and rendered acceptance |
| Results coherence | Editor idle, loading, error and successful replacement | Previous address, election, counts, dates and source links stay with previous data until success replaces them together; failed draft remains editable | Passed: focused tests and rendered acceptance |
| Suggestions | Candidate entry/editor and legislator lookup, each placement and band | Overlay normal content >=768, push down below768; last row clickable without activating covered controls; keyboard, outside dismissal and scrolling remain usable | Passed: focused tests and rendered acceptance |
| Legislator lookup | Entry and prior answer, every band | Clear without automatic select-all or Cancel; keep previous answer; current errors/location action preserved | Passed: focused tests and rendered acceptance |
| Signed-out homepage | Empty, filled, cleared, busy, retry and input/service error, every band | Growing field; existing Find my candidates, Finding candidates… and Try again behavior; no suggestions or editor mode | Passed: focused tests and rendered acceptance |
| Signed-in homepage | Empty, filled, cleared, location wait, every band | Find navigates to lookup; Find on desktop, Find my legislator on tablet/phone; Use my location becomes Finding your location… during location wait; no invented homepage lookup error or Finding… state | Passed: focused tests and rendered acceptance |
| Wrapping alignment | Growing field and neighboring buttons | Action buttons vertically centered beside growing fields per saved design principles; clear remains aligned to first text line | Passed: focused tests and rendered acceptance |
| Signed-in available width | Desktop form near1100 split | Reserve56px for clear in addition to previous360px minimum, bounded by container width; preserve existing wrap so Use my location can move below rather than squeezing text | Passed: focused tests and rendered acceptance |
| Narrow actions | Signed-in tablet and phone | Keep existing actions below field: side by side tablet, full-width stacked phone; no shortened labels | Passed: focused tests and rendered acceptance |

Settled corrections have one checkable answer: retain existing homepage routing,
labels and tablet action layout; follow saved growing-field alignment; add only
the clear slot to the existing usable desktop field width. They do not require
another drawing. Update Design's drawings and build notes through the supplied
record-update prompt. The interactive legislator reference is a state specimen;
its initial read-only value is not a product requirement.

## Shared impact and prevention

The suggestion field is reused by candidate and legislator lookup; homepage fields
use different request paths. Browser-fill can bypass React state, so visibility
and sizing read actual field values without starting queries. A shared clear
button and value observer prevent divergent treatment. Candidate Cancel must
invalidate the shared private flow while retaining its displayed snapshot;
legislator clearing must detach old lookup/location work. No browser storage or
address URLs are added. Signed-in homepage navigation and signed-out homepage
lookup remain deliberately different. Regression checks cover late responses,
one-time selection, silent fill, retained results and focus, plus real rendered
panels overlapping nearby controls. Native phone keyboard behavior remains
unproven without a physical-device check; desktop browser emulation is not that
evidence. Scope owner is the current task, search change address.

## Sequence and progress

1. Pin input and record requirements; independent coverage review: accepted.
2. Shared suggestion field and legislator lookup; homepage forms run separately
   from candidate editor and flow. Integration: complete.
3. Focused tests, full frontend checks, rendered browser acceptance and independent
   reader review: final reader review pending.
4. Commit, upload, current-head checks, merge, deployment and live comparison: pending.
5. Supply Design record-update prompt and complete working-folder lifecycle: pending.

Independent review must inspect missed uses and missing prevention, as well as
the edited code. Acceptance evidence and exceptions are appended here before
delivery; a passing static drawing is not runtime evidence.

## Acceptance progress

- 343 frontend suites / 4,381 tests passed before the rendered narrow-button correction.
- Full type checking passed.
- Independent code review found and resolved invalid field styling after a service
  failure, stale location callbacks after map search, and Escape/arrow-key regressions.
- Chromium and WebKit each pass 12 address-control journeys plus 2 existing
  open-suggestion pointer/touch journeys. The 320px enlarged-text failure is fixed:
  the action row grows from a 52px minimum, reserves waiting-label height before
  submission and keeps Find/Cancel dimensions steady. Cancel uses its approved
  #eceeed pressed background. CI runs the focused rendered address-control checks.
- Manual Chrome acceptance covers candidate search, selected-once editor opening,
  clear focus, wrapped placeholder, busy Cancel restoration/focus, and tablet
  legislator field wrapping. The location action was corrected to remain centered
  beside the growing legislator field rather than overriding the row alignment.
- The private production build passes the existing first-load budget at 297,159
  compressed bytes of 297,506. An earlier export reused a missing-configuration
  transform; a fresh cache corrected that preview-only setup failure.
- Preexisting exception outside this change: the optional suggestion unit parser
  reads “United” as “Unit ED”, suppressing suggestions for a country suffix. Typed
  searches remain usable; this build does not change address matching.
- Homepage rendered acceptance passes at 1920, 1280, 1100, 900 and 390px using
  the real signed-in component and a private navigation harness; signed-out manual
  acceptance covers wrapping, clear and retained typing focus. Final frontend
  checks pass: 343 suites / 4,381 tests, type checking and formatting. Current-head
  release checks and live acceptance remain pending. Real phone keyboard behavior
  remains untested.
