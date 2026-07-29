# Search Bills v2 — build notes (where the live build now differs)

Companion to `README.md` (the v2 design spec) and `search-bills-v2.dc.html` (the
literal-values reference — NOT markup to port; RN can't render HTML/CSS). Same role as
`../search-bills/BUILD-NOTES.md`.

Both files in this folder are a **dated snapshot of what design handed over** and are kept
as-is. Where the shipped screen has since moved on, the delta is recorded here, and the
living description of the screen is
`docs/product-onboarding/bill-search-screen-spec.md` ("Page anatomy", "Copy punctuation on
this screen", "Menus must open in front of the results").

## Superseded by a later design-delta pass (2026-07-29)

- **Helper line under the search field.** The bundle reads "Results update as you type.
  Bills match **every** word — try a keyword or a bill number." It now reads, on one line
  with no terminal period, "Results update as you type — bills match **every** word". The
  dropped tail duplicated the field's own placeholder ("Search by keyword or bill number")
  sitting directly above it.
- **Prose facet description under the count is gone.** The bundle carries a sentence like
  `Matching "broadband", tagged Health, in the House, in the 2025–2026 Legislative Session.`
  The removable chip row above already names every active facet, and the closing session
  clause duplicated the session dropdown that is always visible in the filter controls.
- **The "AS OF …" stamp is gone.** The provenance date is ordinary prose trailing the unit
  noun on the count line — "10,000 bills as of Mar 21, 2026" — nested inside the unit-noun
  span one word space apart, with no middot or other separator glyph.
- **Unit noun is singular at one result** — "1 bill", not "1 bills".
- **Sort control placement is deliberately per-surface.** Web keeps it on the right of the
  header strip. Mobile gives it its own left-aligned row 18px below the count line, where a
  right-hung control read as scattered in a narrow column. These are not meant to match.
- **"Clear all" is a filled black pill** (`#11150f`), not the borderless text button the
  bundle draws. It terminates the filter-chip row, and black is this product's
  active/affirmative control fill. Never green, never grey, never borderless.
- **The mono "FILTERS" label is gone** from the chip row. The chips self-label ("Issue:
  Health", "Chamber: House") and it consumed ~90px of the first row, wrapping chips earlier.
  It is replaced semantically, not just deleted: the row carries `role="group"` +
  `aria-label="Active filters"` so screen readers still announce the group.
- **The "ISSUES" label sits above the pills**, on its own line, not as an inline gutter
  label beside the first pill row. Inline it indented row 1 only, leaving a ragged left edge
  and fitting one fewer pill on that row. It is kept, not removed: it separates the issue
  taxonomy from the chamber / status / session / omnibus controls above, and it is now the
  only mono label on the screen.

## Accessibility deviation from the bundle's tokens (kept deliberately)

The helper line's specified colour is `#6f756f`. On white that is 4.7:1 (AA), but the hero
sits on a faintly tinted gradient whose darkest stop (`#f4f5f7`) drops it to 4.3:1 — below
AA. The build uses `#686e68`, which clears AA on that stop (4.8:1) and reads identically.
Accessibility wins over the literal token (`docs/design/design-principles.md`).

## Illustrative-only values

Every sample bill title, summary, count and date in the bundle is placeholder. Results
render from the live API; those values are never reconciled or reproduced.
