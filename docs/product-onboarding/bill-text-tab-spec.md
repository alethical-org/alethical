# Bill Text tab spec

<!-- describes: apps/frontend/src/lib/billText.ts, apps/frontend/src/components/billDetail/FullTextTab.tsx, apps/frontend/src/components/billDetail/SectionIndexRail.tsx, apps/frontend/src/hooks/useResponsive.ts -->

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

## The intro says "the complete text", and that is a checkable claim

The word "complete" is a promise about the data, not a flourish, so it is tied to a command rather
than to anyone's judgement. **It belongs in the sentence exactly when this prints OK:**

```bash
ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run python scripts/check_bill_section_gaps.py
```

The check compares every current version's stored section count against the number of sections its
page published, and exits non-zero on any gap. It runs daily at 11:00 UTC
(`.github/workflows/bill-section-gaps.yml`) and files an issue when it fails, so nobody has to
remember to ask.

### How the word came out and went back in

[#776](https://github.com/alethical-org/alethical/pull/776) removed it on Jul 30 2026, correctly:
ingestion dropped a section whenever a bill's page gave two sections the same id
([#763](https://github.com/alethical-org/alethical/issues/763)), so HF 4057's page carried 240
section blocks and we served 238. `.claude/rules/grounded-answers.md` rule 6 requires trimming a
claim in the same release the capability slips.

[#763](https://github.com/alethical-org/alethical/issues/763) then fixed the cause — rows are keyed
on the section's position, so no ingest loses a repeated id again — and repaired the damage in two
passes: 57 sections across 24 current versions on Jul 30, then 7 more across 3 bills on Jul 31, the
2025 special session having been ingested hours before the fix merged. **64 sections restored in
total.** The check printed OK on Jul 31 2026, and the word went back in that same release.

### If the check goes red again

Take the word out in the same release, and put it back when the check is clean — rule 6 cuts both
ways, and the sentence is not a matter of taste in either direction. The repair is
`scripts/repair_missing_bill_sections.py` (dry run first; it only ever inserts). If it reports a bill
as needing a re-ingest instead, that bill's page has changed since ingest, which is an
ingestion-freshness gap (rule 7) rather than something to force.

## What the data gives us

Everything on this tab comes from `/bills/{id}/versions/{code}/text?format=structured`, which
returns per section: `section_id`, `source_order`, `heading`, `article_heading`, `text`, and — since
[#741](https://github.com/alethical-org/alethical/issues/741) — `body_blocks`.

**`section_id` does not identify a section; `source_order` does.** `laws.0.1.0` is the id the Revisor
hands every section sitting outside an article, so a bill with several of those repeats it — 66
current versions do, 30 sections deep on `94-2025-SF3492` and `94-2025-HF3284`. `source_order` is the
section's 1-based position, and it is the row's uniqueness constraint in the database
(`UNIQUE (bill_version_id, source_order)`, from
[#763](https://github.com/alethical-org/alethical/issues/763)). Anything that has to name one
section — an HTML id, a share link, a citation's target — is keyed on the pair, never on the id
alone ([#854](https://github.com/alethical-org/alethical/issues/854); see § "Jumping to a section").

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

**The legend's sample words carry the marks they explain, in a card of their own.** It shipped as one
flat grey sentence — "Struck text is removed from current law · underlined text is added" — in which
nothing was struck and nothing was underlined, so it was a key that never showed the thing it was a
key for, sitting in the page as ordinary body copy. It is now an inset panel under the intro
paragraph holding one item per treatment: the words "Struck text" struck through and "Underlined
text" underlined, each styled by the very `styles.removed` / `styles.added` the section text uses, so
the key cannot drift from the marks below it, followed by its plain gloss. The items are laid out with
flex and a 20px gap rather than a middot, so each one starts on its own and dropping either leaves no
orphaned separator.

**The legend is gated on what the bill actually contains.** It names only the treatments present in
that bill's sections: both, removals only, additions only, or nothing at all — with neither present
there is nothing to key, and the card does not render. This is
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
   11px, forced onto one line). **The badge is keyed on the section's anchor, not its id**, so it
   marks the one section a citation was grounded against. Keyed on the id it lit every section
   sharing that id: on `94-2025-SF3492`, all 31 sections carried it while only 5 are cited, which
   told the reader a key point came from a section it did not
   ([#854](https://github.com/alethical-org/alethical/issues/854)). A citation the API cannot place
   on one section badges nothing at all — a badge is a claim about provenance, and there is nothing
   to ground it in (`.claude/rules/grounded-answers.md` rule 1, the same refusal
   [#853](https://github.com/alethical-org/alethical/pull/853) made for the chip's caption).
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
- **A row is keyed and matched on the section's anchor, not its id.** On a bill that repeats an id,
  keying on the id gave several rows the same React key and lit whichever came first rather than the
  one being read ([#854](https://github.com/alethical-org/alethical/issues/854)).

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

Every section is URL-addressable (`?tab=text#ft-<sectionId>-<sourceOrder>`), per
`.claude/rules/grounded-answers.md` rule 5. Two entry points: an index row, and a citation card on
the Summary tab. Arriving from a citation rings the card
(`0 0 0 3px rgba(91,48,214,0.16)`) plus a purple tint, for 2.5s.

### The anchor carries the position as well as the id

`ft-laws.0.1.0-4`. The scheme lives in `lib/billText.ts` — `sectionAnchorId` builds it,
`parseSectionAnchor` splits it, `resolveSectionAnchor` matches it against the sections on the page.

**The position is there because the id is not unique** (§ "What the data gives us"). Keyed on the id
alone, `94-2025-SF3492` emitted `ft-laws.0.1.0` thirty times, `getElementById` answered every one of
them with the first, and three things broke at once: a chip labelled "Sec. 21" scrolled to Sec. 1, a
shared link could not say which of the 30 it meant, and every section sharing the id was badged as
cited. Duplicate ids are also invalid HTML and ambiguous to assistive technology.

**The id is there because the position alone would fail silently.** Because the anchor holds both
halves, `resolveSectionAnchor` can require them to agree, and fall back to the first section carrying
that id when they don't. A `ft-4` scheme has nothing to check: a link made before a re-read of the
bill moved the section would land on an unrelated section without anything looking wrong, which is
the same class of failure as the bug being fixed.

**Old `#ft-<sectionId>` links keep resolving**, to the first section carrying that id. That is not a
new behaviour — it is exactly where such a link already landed — so nothing already shared breaks.
Splitting the two halves back apart is unambiguous: all 71,150 section ids in production match
`laws.<n>.<n>.<n>`, so an id never contains a hyphen, and the rule is "a plain number after the last
hyphen".

**A citation chip carries the same anchor value.** The stored citation records only the section id, so
the API resolves the position at request time and serves it as `section_order`
(`_citation_section_orders` in `alethical/api/routers/public.py`, `resolve_cited_section` in
`alethical/pipeline/ai_enrichment.py`) — recovered from the citation's own verbatim quote, with its
label breaking a tie when a bill repeats one sentence section for section. Of the 95 affected
citations in production it places 94; the one it cannot place keeps the chip jumping to the first
section carrying the id and claims no badge.

Four more details, each of which was a real bug:

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

**The anchor scheme has its own file, `__tests__/sectionAnchors.test.ts`**, over the first five
sections of `94-2025-SF3492`, where all but one share an id. It pins both halves of the contract that
pull against each other: an exact positional anchor reaches that exact section, and an old id-only
anchor — or a positional one whose position no longer matches — falls back to the first section
carrying the id. Removing either half fails it.

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
- **Bills repeat a section id on their page, and 64 current versions do.** Both the page and the
  corpus now carry every one of them, so a replay must expect the repeat rather than de-duplicate it.
  Until [#763](https://github.com/alethical-org/alethical/issues/763) landed, the corpus kept only the
  last of each repeated id and the tab never rendered the others; rows are keyed on the section's
  position now, so all of them are stored and rendered.

  **Do not assume the repeated id is always `laws.0.1.0`.** That was true of every case found in the
  2025 and 2026 regular sessions — it is the id the Revisor hands a section sitting outside any
  article, so a bill with several of those repeats it, up to 10 times on `94-2026-HF4441` and
  `94-2026-SF4184` (whose 10 sections all share it). But `94-2025s1-SF9` repeats **`laws.0.6.0`**,
  found Jul 31 2026 while repairing the 2025 special session. So a replay must look for *any*
  duplicate id, not grep for that one string.

Layout and jump behaviour still need a browser: the index threshold at 1/2/3/21 sections, and the
jump landing at 90px from several starting scroll positions and from both entry points.

## Out of scope for this tab

- **A screen reader hears an appropriation table as a plain grid of text**, row by row, because
  RN-Web has no table role to give it. The header row is read before the rows, and the narrow-screen
  form pairs each figure with its year in the visible text, so the information is reachable — but it
  is not announced as a table with column headers. Improving that means real table semantics on web,
  which is its own piece of work.
- **Storing the cited section's position at enrichment time.** The API recovers it per request from
  the citation's quote and label (§ "Jumping to a section"), which works on every already-enriched
  bill and costs one extra query on the 66 versions that repeat an id. Writing the position into
  `key_point_citations` would make the recovery unnecessary, and would place the one citation the
  recovery cannot — but it only takes effect on bills a future re-enrichment happens to touch, and a
  corpus-wide re-enrichment is a paid run. Worth folding into the next one rather than doing for its
  own sake.
