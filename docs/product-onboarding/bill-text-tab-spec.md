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

## What the data gives us

Everything on this tab comes from `/bills/{id}/versions/{code}/text?format=structured`, which
returns per section: `section_id`, `heading`, `article_heading`, `text`, and — since
[#741](https://github.com/alethical-org/alethical/issues/741) — `body_blocks`.

**`body_blocks` is the structure, and it is what the tab reads.** Ingestion used to store a
section's body as one flat string, which destroyed three things the Revisor publishes: the
subdivision numbers ("Subd. 2."), the marks saying which words the bill *adds*, and the row/column
shape of appropriation tables. It now stores the body a second way as well — an ordered list of
blocks that keeps all three:

```json
[{"kind": "heading", "number": "Subd. 3.", "text": "Health plan."},
 {"kind": "para",    "text": "…deleted text begin . deleted text end new text begin ; or new text end"},
 {"kind": "table",   "rows": [[{"text": "General Fund"}, {"text": "$", "align": "center"}, …]]}]
```

The flat `text` is **unchanged and still served**, because two paid caches hash it (every section's
search embedding and every bill's AI summary), so the added-text marks could only reach the page
through a new field. It is also the fallback: `body_blocks` is null on any section not yet re-read
from the Revisor, and there the caption can still only be guessed at.

| what we need | with blocks | without blocks (fallback) |
| --- | --- | --- |
| section number | `heading` ("Sec. 3.") | same |
| section caption, form A | fused into `heading` ("Sec. 3. APPROPRIATION EXTENSIONS.") — 15% of sections | same |
| section caption, form B | a `heading` block, read | **inferred** from a bare paragraph (`isSubheading`) — 67% of sections |
| subdivision number ("Subd. 2.") | the heading block's `number` — 59% of sections now show it | destroyed |
| added-text markers | kept in the block text | destroyed |
| appropriation table shape | `table` block rows and cells | destroyed |

Form B exists because the Revisor publishes the caption as a sibling `<h3 class="headnote">`, and
the flattening's heading-strip regex only covers `h1`/`h2`: the caption survived as an unlabelled
paragraph while its number was thrown away. Reading the blocks replaces that guess with the
Legislature's own words, so 2,801 of 4,767 sampled section titles now read "Subd. 3. Health plan"
the way the Legislature writes them, where before no subdivision number existed anywhere in the
corpus.

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
  - **A full stop followed by a digit is a decimal point and is never closed up.** Statutes write
    bare decimals — "is counted as .55 pupil unit", "$ .0025 per gallon" — and the unguarded rule
    rendered "counted as.55 pupil unit" on 2 sampled education-funding bills. Do not extend the
    guard to also require a letter or digit *before* the gap: statutes end clauses on a closing
    bracket constantly ("paragraph (a) ."), and that stricter rule left the space in 195 sampled
    sections. The regex uses a capture group rather than a lookbehind, which Hermes (the engine the
    native builds run on) does not reliably support.

**The legend is gated on what the bill actually contains.** It names only the treatments present in
that bill's sections: both, removals only, additions only, or nothing at all. This is
`.claude/rules/grounded-answers.md` rule 6 applied to a legend. The gate is load-bearing in both
directions: a section read from `body_blocks` can carry additions (2,342 of 4,767 sampled sections
show both treatments, 2,072 additions only), while a section still on the flat text can only ever
carry removals, so the same bill page must not promise an underline that half its sections cannot
show. Feed the gate the same strings the section will render — `blockTexts(body_blocks)` where blocks
exist, the flat text where they don't.

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

A caption promoted to the title now carries the subdivision number the Legislature published, so a
card reads "Subd. 3. Health plan" rather than a bare "Health plan" whose number existed nowhere. The
promotion rules themselves are unchanged — only the first block is promoted, only when the stored
heading gave no title, only when it is unchanged text — so a card that was already right stays right.

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

## Appropriation tables render as tables

A budget section is real `<table>` markup in the source, and flattening it put each cell on its own
line — a dollar sign, then its amount, then a second amount with nothing saying which year either
belonged to ([#752](https://github.com/alethical-org/alethical/issues/752)). Ingestion captures the
rows (`body_blocks`), and the tab lays them out. Five rules, each from something measured in the
Revisor's own markup:

- **A lone `$` is joined to the figure beside it.** It sits in a 3.8%-wide spacer column of its own,
  so "$" and "739,634,000" are two genuine cells; 542 of them across the sampled corpus. Joined with
  no space between: a space between two change-marked runs is a plain run of its own and survives into
  "$ 739,634,000".
- **Spacer columns are dropped**, so figures line up down a column, which is the whole reason to lay
  this out as a table. Column spans need no arithmetic once empty cells are gone — a caption row comes
  back as one cell and a figure row as label + figures.
- **The fiscal years sit above the figures they head, and are never invented.** They are published in
  the appropriation article's **first** section ("The figures '2026' and '2027' used in this
  article…"), while the figures are in the sections after it, so `FullTextTab` collects them per
  article and passes them in. A table is labelled only when it has exactly one year per figure column;
  a mismatch shows no header rather than putting a year over a figure that is not from that year.
- **Adjacent tables of the same shape are joined.** Each budget line is published as its own one-row
  table, so a subdivision's figures arrive as a run of tables that are one table to a reader — 493
  source tables become 419 blocks. Left apart, the year header repeated above every single line. Only
  while nothing comes between them, so a subdivision heading or a sentence of prose still starts a new
  group, which is what the Legislature's own grouping means.
- **A year row stays a row when there are no figures for it to head.** In the article's opening
  section the years *are* the content; lifting them into a header there would leave a header with
  nothing under it and take the years off the page.

**Anything that is not really a table falls back to paragraphs** — one column, or nothing left once
the spacers are gone (4 of 497 sampled tables). Its words still show.

On a narrow screen the row **stacks**: the label on its own line, then one line per figure carrying
its own year ("2026 $739,634,000"). Three columns of statute prose and money do not fit on a phone,
and pairing each figure with its year means nothing depends on remembering column order.

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

## Verification

The five properties #740 established are now automated tests, so a change that breaks one fails CI:

1. no marker word reaches any rendered string;
2. no index row is blank where a caption or citation exists;
3. no caption used as a heading keeps a trailing period, and none is re-cased;
4. no two index rows within one article group read identically;
5. no index row is a truncated statute sentence.

Each is a separately named test in `apps/frontend/src/lib/__tests__/billText.test.ts`, run against
49 real sections from 7 real bills in `__tests__/fixtures/bill-text-sections.json` (what each
fixture is there to catch, and how to add to it, is in that directory's `README.md`). The runner is
Vitest; `just test-frontend` runs it, and CI's `frontend` job runs it on every PR that touches
frontend paths ([#751](https://github.com/alethical-org/alethical/issues/751)). The same file also
pins the bugs found since: the bare-decimal spacing regression (#756), the punctuation-after-a-
bracket rule the stricter guard broke (#755), the two sections that differed only by subdivision,
the struck caption that must not become a title, and a ban on regex lookbehind, which Hermes does
not reliably support.

**The structured path has its own file, `__tests__/billTextBlocks.test.ts`**, over
`fixtures/bill-text-body-blocks.json` — 5 real sections carrying the `body_blocks` the API returns.
It re-checks properties 1, 2 and 3 on that path, adds property 6 below, and pins the three gains:
the subdivision number reaches the page (and provably could not before), an added run renders as
added rather than as plain law, and no captured table cell is dropped.

### The corpus replay, which the tests do not replace

Committed fixtures cannot prove a change is safe across the *whole* corpus, and they cannot run
against live data. For a corpus-wide change to `billText.ts`, still replay production sections
through the transpiled module:

```bash
pnpm exec tsc apps/frontend/src/lib/billText.ts --outDir /tmp/bt \
  --module commonjs --target es2020 --skipLibCheck --esModuleInterop
```

Fetch sections read-only from `https://api.alethical.com`: `GET /api/v1/bills/<id>/versions`, take
the entry whose `is_current` is true (the version code is **not** literally `"current"` for most
bills), then `GET /api/v1/bills/<id>/versions/<code>/text`. Pace requests ~0.7s apart with a
`User-Agent` header. Assert the same five properties, and diff every rendered string before and
after the change rather than only counting failures — the doubled-space defect closed in #751
showed up in 22 of 2,897 sections and in no property assertion.

#740 ran this over 80 bills / 1,881 sections; #751 over 47 bills / 2,897 sections.

**#741 ran it over 4,767 sections from 72 bills (including the 12 with the most sections in the
corpus), on both paths — the flat text and the captured blocks — and added a sixth property: the
structured body renders every character the flat body renders, so reading blocks can never drop
wording from the page.** Compare characters with whitespace stripped, not words: keeping the marker
words splits tokens the flat text had glued together ("(4)," becomes "(4)" then ","), which a
word-by-word check reports as a difference when it is not a loss. Two traps there, each of which
produced a false failure:

- **Group index rows by article before checking for duplicates.** Section numbers restart inside each
  article, so an omnibus bill legitimately has a "Sec. 3" per article.
- **A handful of bills repeat one section id on their page** (6 of the 12 largest do, all on
  `laws.0.1.0`). The database's unique `(version, section_id)` constraint keeps only the last, so the
  product never renders the others — mirror that in the replay or it reports duplicates the tab
  cannot show. That data loss is itself a bug, tracked separately in
  [#763](https://github.com/alethical-org/alethical/issues/763).

Layout and jump behaviour still need a browser: the index threshold at 1/2/3/21 sections, and the
jump landing at 90px from several starting scroll positions and from both entry points.

## Out of scope for this tab

- **A screen reader hears an appropriation table as a plain grid of text**, row by row, because
  RN-Web has no table role to give it. The header row is read before the rows, and the narrow-screen
  form pairs each figure with its year in the visible text, so the information is reachable — but it
  is not announced as a table with column headers. Improving that means real table semantics on web,
  which is its own piece of work.
- **Recovering sections a bill's page loses entirely** — [#763](https://github.com/alethical-org/alethical/issues/763).
  Where a page repeats one section id, only the last of them is stored, so 6 of the 12 largest bills
  are missing sections. This tab renders what the corpus has; the gap is at ingest.
