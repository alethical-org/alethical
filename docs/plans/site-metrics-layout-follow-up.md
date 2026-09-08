# Site Metrics layout follow-up

Net: Destination rows share one spacing pattern; partial-range counts align with their labels and the other values.

## Release order

1. [Pull request 2078](https://github.com/alethical-org/alethical/pull/2078) is live: tablet speed text stays inside its card. Fresh production checks at 768 and 1100 pixels show the intended stacked and inline layouts.
2. Destination measurements include 768 and 1099 pixels. Shared label widths are 170 pixels on computer and 159 pixels on phone.
3. This separate change is [pull request 2094](https://github.com/alethical-org/alethical/pull/2094), on `codex/site-metrics-row-layout`. The remaining release steps are current-main checks, merge and a live browser check. Queue order is [recovery pull request 2034](https://github.com/alethical-org/alethical/pull/2034), [code-check pull request 2088](https://github.com/alethical-org/alethical/pull/2088), then this layout release.

This file records approved work and its acceptance checks. Destination implementation followed the completed tablet release.

## Fixed scope, approved 8 September 2026

- Only Where people go layout and its height relationship with What people do, inside How people use Alethical at `/site-metrics`.
- Preserve every word, value, state, range, row and row order. Preserve Activity range, other cards and every other section.
- Bills, Legislators and Money use the same nested-group treatment. Home, Read, Ask and Other remain individual rows.
- Computer rows use flex, centered alignment and a 12px horizontal gap. Labels have one fixed shared width, initially 160px at the existing 14.5px type, but measure the actual longest label before choosing it.
- Computer bars are flexible, 12px tall with 6px corners; track #e8ebe9, fill #149d5b. Percent column is 38px, right aligned, tabular numerals, 14px/700.
- Inside each nested set: 12px vertical gap. Between sets or standalone rows: 15px. No other vertical list spacing.
- Nested sets have 12px left padding plus a 2px #dfe5e1 left border. Individual rows have 14px left padding and no border. Every label starts at the same horizontal position.
- Phone uses an 11px between-set gap, 9px bars with 5px corners, and a 34px percent column.
- If the longest phone label would leave less than 80px for the bar, every row switches to a label line followed by a bar-and-percent line. Never switch only the long row.
- Side-by-side cards share their grid row height; whichever card is taller sets it. All content remains top-aligned with unused space below the final note. No distributed empty space, growing rows or stretched dividers.
- Below 768px cards stack and retain independent heights. Preserve the lower Explore/Readers pair, which already follows this rule.
- The expected extra bottom space in What people do is accepted, including about 165px with the figures seen by Eugene. Do not hard-code that height or the figures.

## Checks

- Measure every in-set and between-set gap: exactly 2 consistent values per screen size.
- All nested sets have the same border; standalone rows have none.
- Every label is a single line and begins at the same horizontal position. Bars share both horizontal edges.
- Include the entire current Money set and the existing whole-Money fallback without changing which rows appear.
- At side-by-side widths, both card top and bottom edges align. Change to a range with zero page views and prove the left card now holds the unused bottom space.
- Compare the right card row positions before and after the left card grows; its own spacing must not change.
- At phone widths, prove the 80px bar decision applies to all rows together.
- Temporarily add a long label in a controlled test and measure the resulting fit. If keeping arbitrary-length text on one line conflicts with available width, raise that conflict before inventing truncation or changing words.
- Exercise 390, 767, 768, 820, 1099, 1100 and 1440px, both ranges, zero, loading, unavailable and stale states.
- Run focused tests, all relevant browser checks, a fresh-context reading pass, current-head checks, merge and live checks. Block all test tracking and writes.

## Inspection checkpoint

- `TrafficScreen.tsx` gives Bill, Legislator and Money groups the same 12px gap and left border. Read, Ask and Other each occupy a standalone row.
- Existing activity grid already stretches paired cells. Prove top alignment before adding any height code; no unnecessary change to the lower pair.
- Destination label widths are 170px on computer and 159px on phone. The current longest label measures 169.796875px at 14.5px and 158.078125px at 13.5px in loaded Libre Franklin.
- Preserve the existing 10px phone horizontal gap. At 390px, the 308px card interior minus 14px inset, 159px label, 34px percentage and 20px combined gaps leaves an 81px bar. Smaller phones switch all rows together.
- At 768px, a 278px card interior minus 14px inset, 170px label, 38px percentage and 24px gaps leaves a 32px bar. The requested 80px minimum is phone-only; do not silently extend it to tablet.
- A practical longer test label, Committee money profiles, measures 167.453125px on phone. A remeasured 168px common width would leave a 72px bar at 390px and must trigger the phone fallback. Future label additions require remeasurement rather than arbitrary fixed-width overflow.
- No data contract, collector, source endpoint, exclusion setting or wording change is part of this follow-up.

## Action value alignment, approved 8 September 2026

- A partial-range action count shares the other values' right edge and is vertically centered with its own label.
- Partial range occupies its own right-aligned line below the label/value line, with space before the row divider.
- Preserve all values, words, coverage rules, type sizes and states. Apply the same layout to every action that carries this note.
- The shared label/value line is separate from the note, so the note's width and height cannot displace the count.
- Add browser checks for number right edges, label/value centers, note separation and neighboring dividers at phone, tablet and desktop widths.
- The release order above includes both the destination and action-value corrections.

## Validation checkpoint

- The original live Money count ended 54.47 pixels left of the neighboring count and its vertical center was 12 pixels above its label.
- The new number, label and Partial range note pass geometry checks at 390, 768 and 1440 pixels for both activity ranges.
- All 2,412 frontend checks and TypeScript passed. The normal release build passes its unchanged first-load limit.
- A test-only browser response substituted Committee money profiles and a remeasured 168-pixel shared phone width. At 390 pixels, all 17 rows stacked, the longer label fit and every bar stayed below its label. No source label or released value changed for this test.
- All 195 browser checks passed across Chromium, Firefox and WebKit (192 full-suite cases and 3 whole-Money fallback cases). New geometry checks load the published Google fonts in memory.
- Independent source review found no remaining defect. A fresh reader review passes at 375, 390, 768 and 1440 pixels with the production fonts. Count alignment, note placement, destination grouping, label fit and paired-card heights pass. The live release check remains.
