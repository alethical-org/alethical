# Bill Text tab spec

<!-- describes: apps/frontend/src/lib/billText.ts, apps/frontend/src/components/billDetail/FullTextTab.tsx, apps/frontend/src/components/billDetail/SectionIndexRail.tsx -->

Status: shipped, [#740](https://github.com/alethical-org/alethical/pull/740) (`5379a88`). Covers the **Bill Text
tab** of Bill Detail on web (`/bills/:billId?tab=text`) and the `sec-fulltext` block of the mobile
single-scroll page — one component, `FullTextTab.tsx`, serves both. Companion to
`docs/mockups/bill-detail-mobile/NEXT-bill-detail-spec.md` (the rest of Bill Detail). Durable
citation/neutrality invariants live in `.claude/rules/grounded-answers.md`.

## Goal

Make a 20-section amending bill readable and navigable. Before #740 the tab printed the
Legislature's own edit markers as prose ("coverage for on-site medical clinics; deleted text
begin or deleted text end"), folded each section's heading into its number badge, and gave a
21-section bill no navigation at all.

## What the data gives us, and what it doesn't

Everything on this tab is derived from what `/bills/{id}/versions/{code}/text?format=structured`
already returns per section: `section_id`, `heading`, `article_heading`, `text`. **No part of this
spec needs a data change or a re-ingest.** Measured over 80 production bills / 1,881 sections:

| what we need | where it actually lives | how often |
| --- | --- | --- |
| section number | `heading` ("Sec. 3.") | ~always |
| section caption, form A | fused into `heading` ("Sec. 3. APPROPRIATION EXTENSIONS.") | 15% of sections |
| section caption, form B | loose in `text`, as a bare paragraph | 67% of sections |
| no caption at all | — | 18% of sections |
| subdivision number ("Subd. 2.") | **destroyed at ingest** — [#741](https://github.com/alethical-org/alethical/issues/741) | n/a |
| added-text markers | **destroyed at ingest** — [#741](https://github.com/alethical-org/alethical/issues/741) | n/a |

Form B exists because the Revisor publishes the caption as a sibling `<h3 class="headnote">`, and
ingestion's heading-strip regex only covers `h1`/`h2`. The caption survives; its subdivision number
does not. So the caption is currently **inferred** from the flattened text (`isSubheading`), and
that inference is a stopgap that #741 replaces with real structure.

## Change markers render as formatting, never as words

The Revisor wraps a changed run in screen-reader-only spans; ingestion flattens the HTML, so the
marker words land in the stored text as prose.

- `deleted text begin … deleted text end` → strike-through, `#6f756f`.
- `new text begin … new text end` → underline (offset 3px), weight 600, `#11150f`.
- A malformed pair — an unclosed begin, a stray end — has its words **stripped silently**. It must
  never leak the words, and must never strike the rest of the section either.
- Each changed run also carries an accessibility label ("removed from current law: …"), because
  strike-through and underline convey the change by presentation alone.
- **A stray space before punctuation is closed up.** Stripping the Revisor's tags leaves a space
  wherever one stood between a word and its punctuation, so 560 of 1,881 sampled sections rendered
  "duties ." or "firefighters ; emergency". The cleaner handles the case inside one run and the case
  that straddles two (a plain run ending in a space, then a struck full stop). Spaces and tabs only,
  never a line break, so a paragraph that legitimately opens on punctuation is untouched. This is
  presentation only — proven over 1,881 sections to change no word, the same latitude
  `.claude/rules/grounded-answers.md` rule 9 gives the summary cleaners. The durable fix is at
  ingestion ([#741](https://github.com/alethical-org/alethical/issues/741)); this stays as a guard.

**The legend is gated on what the bill actually contains.** It names only the treatments present in
that bill's text: both, removals only, additions only, or nothing at all. This is
`.claude/rules/grounded-answers.md` rule 6 applied to a legend — while #741 stands, no bill carries
an addition, so the legend must not promise an underline no reader will ever see.

## One title per section

Top to bottom inside a section card:

1. **Article eyebrow**, when the bill has articles (mono, muted).
2. **Badge row** — the number badge holds `SEC. 3` and nothing else. Beside it, a `CITED IN SUMMARY`
   badge when the Summary tab quotes this section (purple `#f0ebfc` / `#d8c9f7` / `#5b30d6`, mono
   11px, forced onto one line).
3. **Provenance** — "Minnesota Statutes 2024, section 62A.011 … is amended to read:" at body size,
   regular weight, `#6f756f`. This names which existing law the section rewrites. **It is not the
   title.** Styled as a heading it competes with the caption below it and the card reads as having
   two titles.
4. **Title** — the Legislature's caption, 19px / 700 / `#11150f`.
5. **Body** — subdivision headnotes as 15px/700 lead-in lines; numbered clauses hanging (46px /
   -18px on web, 26px / -14px on mobile, where the web step would eat a sixth of the reading width);
   roman sub-clauses one level deeper, since `(a)` → `(1)` → `(i)` nests.

Rules for a caption used as a heading:

- **Drop one trailing period.** "Health plan." reads as a fragment; "Health plan" reads as a title.
  An initialism keeps its period ("42 U.S.C.").
- **Never re-case.** Capitals stay exactly as the source wrote them, because re-casing mangles the
  acronyms these captions carry (DNR, CHAMPUS) and an exceptions list would need per-bill upkeep.
- **A struck caption is not promoted to a title.** If the caption carries a change marker it stays in
  the body, where its strike-through renders. Shown as a heading, law being deleted would read as
  current law.
- **A real section header is never absorbed into a body.** Anything matching `Sec. N.` is excluded
  from the sub-heading treatment.

## Section index

A sticky right-hand rail, 244px wide, 56px gap, shown on desktop for **any bill with 2 or more
sections**.

- Two sections is the threshold, not five, because the rail is also what holds the reading column in
  one horizontal position from bill to bill. With the rail conditional on length, moving between a
  long and a short bill slid the text sideways.
- **Only a genuinely one-section bill centres its column instead**, where there is nothing to
  navigate and no other layout for it to sit out of step with.
- Rows are grouped by article, because section numbers restart inside each article — an omnibus bill
  otherwise shows several rows numbered 1.
- Rows hang off a 1px rule; the section in view carries a 2px `#11150f` left border and a bold label.
  Which section is "in view" comes from an IntersectionObserver discounting the sticky tab bar.

**A row is never blank, and never a truncated statute sentence.** In order:

1. the caption, if there is one;
2. otherwise the opening citation, condensed — `§ 115A.554`, `§ 609.52, subd. 3a`,
   `Laws 2023, ch. 71, art. 1, § 10, subd. 9`, `Rules 7000.0100`;
3. otherwise nothing, and the number stands alone (2.7% of sections).

**The subdivision belongs in the condensed form.** A bill amending subdivisions 9 and 10 of one
statute is two sections whose only difference is that number; without it they render as two
identical rows, which is the failure the fallback exists to prevent.

A genuine caption longer than the row does clip at two lines. 37 of 1,881 sections carry one (e.g.
"CITY OF COLUMBIA HEIGHTS; ALATUS TAX INCREMENT FINANCING DISTRICT; FIVE-YEAR RULE EXTENSION; …").
Shortening those would mean re-authoring the Legislature's words, so they clip; their opening words
still tell neighbouring rows apart.

## Jumping to a section

Every section is URL-addressable (`?tab=text#ft-<sectionId>`), per
`.claude/rules/grounded-answers.md` rule 5. Two entry points: an index row, and a citation card on
the Summary tab. Arriving from a citation rings the card
(`0 0 0 3px rgba(91,48,214,0.16)`) plus a purple tint, for 2.5s.

Four details, each of which was a real bug:

- **Scroll instantly, not smoothly.** A smooth scroll started in the same beat as a re-render gets
  dropped or interrupted part-way and stops short — by different amounts from different starting
  positions.
- **Use `scrollIntoView`, not a computed `window.scrollTo`.** This page scrolls an **inner
  container**, not the document, so scrolling the window moves nothing at all. `scrollIntoView` finds
  the real scroll parent.
- **Let `scroll-margin-top` set the offset** (90px). One value then serves our jumps and a
  browser-native fragment jump alike.
- **Re-assert the position once, ~250ms later**, correcting any layout shift the first jump raced.

**Read the URL fragment on the first render, not inside the effect that acts on it.** When the bill
text is already cached, that effect runs before the router has applied the fragment, finds no hash,
and — having no reason to run again — gives up for good. The symptom is subtle: the page still
scrolls, because the browser handles the fragment itself, so only the highlight goes missing.

## The reading measure

The text column caps at 880px. Uncapped it ran ~190 characters a line on a wide window, roughly
twice a comfortable measure.

## Verification, and the gap in it

`apps/frontend` has **no test runner**, so none of the above is protected by a test —
tracked in [#751](https://github.com/alethical-org/alethical/issues/751). Until it is, changes to
`billText.ts` should be verified by replaying production data through the transpiled module:

```bash
pnpm exec tsc apps/frontend/src/lib/billText.ts --outDir /tmp/bt \
  --module commonjs --target es2020 --skipLibCheck --esModuleInterop
```

then, over every section of a decent sample of bills, assert the five properties #740 established:

1. no marker word reaches any rendered string;
2. no index row is blank where a caption or citation exists;
3. no caption used as a heading keeps a trailing period;
4. no two index rows within one article group read identically;
5. no index row is a truncated statute sentence.

#740 ran this over 80 bills / 1,881 sections. Layout and jump behaviour need a browser: the index
threshold at 1/2/3/21 sections, and the jump landing at 90px from several starting scroll positions
and from both entry points.

## Out of scope for this tab

- Recovering subdivision numbers or added-text markers — [#741](https://github.com/alethical-org/alethical/issues/741),
  ingestion.
- Rendering appropriation tables as tables — [#752](https://github.com/alethical-org/alethical/issues/752).
  Ingestion flattens them to one paragraph per cell, so a budget section currently reads as a column
  of stray numbers (43 of 1,064 multi-paragraph sections sampled).
