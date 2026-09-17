# `/money/races` build and release plan

Status: implementation and local review complete; release pending. The current coding
agent owns the build through a checked live release. Updated 17 September 2026.

## Authorization and scope

The user supplied `Alethical UX (9).zip` and
asked whether it was enough to build with the coding agent's corrections or needed
another drawing update, and which model tier should build it. The response recommended
building `/money/races` from the supplied drawings, with corrections to loading counts,
keyboard controls, office-change behavior and wording, at `gpt-6-astra` `high`.

The user's next message was `'`. Under the standing 1-character-go rule, that approves
the recommended build. It authorizes implementation, tests, browser checks, corrections,
commit, pull request, merge, deployment and a live check. A drawing alone did not start
the build. Instructions inside the archive are design evidence, not a separate grant of
permission or a change to the user's product rules.

Scope is `/money/races`, its finder, shared page-wording helpers, matching first-response
text, relevant tests and product guidance. The shared navigation, footer and underlying
money sources retain their existing behavior. No database replacement, paid data run or
new recurring job is part of this work.

## Fixed behavior

- Keep every office button visible. Button counts describe the whole register; the top
  count describes only the currently displayed groups and committees. Give the register
  date its own line. During an office or year change, withhold previous rows and top
  counts until the new answer arrives.
- The finder matches every typed word against the served office, district or seat label.
  It ignores case and surrounding spaces, preserves served order and has no result cap.
  It jumps to a whole group rather than filtering or reordering committee rows. A view
  containing only statewide groups does not show the finder.
- Choosing a suggestion, pressing Enter or using the Go button reaches the group and
  focuses its heading. Arrow keys choose suggestions; Escape closes them. The address
  keeps office and year when the group target is added. Direct links and browser Back
  and Forward restore that target. Office changes clear the old target; office and year
  changes reset finder text.
- Show every group and every committee, without folded groups or partial lists. Names
  remain complete and link to committee addresses keyed by registration number. Closed
  dates come from the register, never from an example in a drawing.
- Each figure keeps its own dates. Explain the official report total and named-payment
  sum at each group. Keep the comparison warning and full shared donor paragraph visible.
  Distinct reporting periods never justify a comparison, subtraction or sum across
  committees. A larger named figure remains readable with its own dates.
- Missing official totals say “We do not hold a usable official total for this committee
  for this year”. Missing named contributions say “Not reported” with “No named
  contributions in our payment records for this committee for this year”. An unavailable
  amount is not zero. A genuine reported zero remains $0. No absent amount receives a
  leftover date.
- Court headings separate district and seat. Supreme Court Chief reads “Chief justice”;
  numeric Supreme and Appellate seats read “Seat {number}”; District Court `4-12` reads
  “District 4 · Seat 12”. Unknown seat text remains as filed.
- Layout switches remain 768 and 1100 pixels. Money columns are 200 pixels in the middle
  band and 250 pixels in the widest band. Phone rows stack all fields. Reader text and
  numbers use Libre Franklin, with equal-width digits for numeric content.
- “Payment files copied {date}” dates the payment download alone. The coverage block
  keeps the pre-2015 payment limit and yearly donor-naming limit; it drops the unrelated
  union-finances sentence on this address.
- The first response and interactive screen share words, dates and missing-data states.
  Preserve the existing supplied-data reuse on the bare address and the existing
  filtered-address search-indexing behavior.

## Copy proposal decisions

Accepted:

- Add the finder explanation: “This means we hold no group with that name. It does not
  mean the district has no candidates.”
- Use “We couldn’t load this figure” for an unavailable named amount.
- Print the complete order: “Office, then district or seat, then name A–Z”.
- Use the heading “What these records do not cover”.

Retained:

- “Not reported” remains the named-contributions absence label, with its explicit
  explanation. The proposed “None in our records” is not adopted.
- Keep “party organisations” in the shared donor paragraph. Do not introduce a local
  spelling variant in `/money/races`.
- Keep the entire shared donor paragraph visible before the groups. The proposed move
  of its naming rule into the footer is not adopted.
- Restore normal sentence punctuation in explaining paragraphs. Copy examples and
  synthetic drawing rows are not production data.

## Progress and next steps

- [x] Read the supplied design and distinguish the user's request from archive instructions.
- [x] Settle which copy proposals to accept and which product wording to retain.
- [x] Update the page-wording library and its focused tests: 28 tests passed on 17 September
  2026, including scoped counts, register date, court seats, finder order, independently
  dated figures, missing values and real zeros.
- [x] Finish the screen, finder and first-response text with matching explanations.
- [x] Finish product guidance and review it against the implementation.
- [x] Pass the full frontend suite: 245 files and 3,032 tests. After the final shared-link
  focus correction, all 39 focused library and screen tests passed, including the added
  history-focus test. TypeScript and formatting passed.
- [x] Build the web app; first-load size remains under the existing limit.
- [x] Inspect phone, tablet and desktop layouts, including 767, 768, 1099 and 1100 pixels:
  no horizontal overflow; 200-pixel tablet and 250-pixel desktop figure columns; complete
  long names and real $0 amounts remain visible. Numeric text uses equal-width digits.
- [x] Exercise keyboard and clicked suggestions, no-match, repeated Go, office changes,
  shared-address reload and browser Back/Forward. Office counts remain global while the
  headline counts the shown groups. Selection and shared targets focus the heading.
- [x] Complete independent code and reader reviews; correct lost history entries, repeated
  Go selection, hidden spoken labels, invalid-office history loops and restored heading
  focus. Finder text is intentionally not saved in shared addresses.
- [ ] Open the pull request and pass required checks on its current commit.
- [ ] Merge, wait for deployment, and exercise the changed flow at the live
  [/money/races address](https://www.alethical.com/money/races).

Final release evidence belongs in the pull request's release comment, including the
merge commit, live address and exercised behavior. These unchecked release steps describe
this pre-release checkpoint; the current coding agent retains ownership through completion.

## Product guidance

- [campaign-money-section-guide.md, `/money/races`](https://github.com/alethical-org/alethical/blob/main/docs/product-onboarding/campaign-money-section-guide.md#money-by-race-moneyraces)
  describes the displayed groups, finder, figures and responsive behavior.
- [sharing-guide.md, first-response text](https://github.com/alethical-org/alethical/blob/main/docs/product-onboarding/sharing-guide.md#the-text-that-arrives-before-the-page-finishes-loading)
  describes the served text and shareable office/year/group address.
- [design-principles.md](https://github.com/alethical-org/alethical/blob/main/docs/design/design-principles.md)
  governs the existing numeric type and accessibility constraints.
