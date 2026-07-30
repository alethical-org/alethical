# Test fixtures

## `bill-text-sections.json`

49 real bill sections from 7 real Minnesota bills, pulled from the production
API in July 2026. They exist so the Bill Text parsing rules
(`src/lib/billText.ts`) are checked against text the Legislature actually
publishes, not against text invented to make the parser look good.

Each entry is `{ billId, sectionId, heading, articleHeading, text, truncated }`.
`truncated: true` means a long body was cut at a paragraph boundary to keep the
file readable; the opening of the section, which is what every label and heading
is derived from, is always intact. No entry was edited otherwise.

What the selection deliberately includes:

- **The whole `APPROPRIATION MODIFICATIONS` article of HF 2484** (25 sections).
  A complete article group is the only way to check that no two index rows
  within one group read alike. It also carries the real pair that used to
  produce two identical rows — sections 2 and 3 differ only by
  `subdivision 9` versus `subdivision 10` of the same session law.
- **Sections with a bare decimal** (`.0466`, `.75 percent`). Gluing the number
  onto the word before it was live on production education funding bills.
- **Sections with punctuation after a closing bracket** (`paragraph (c) ,`).
  The stricter guard tried once left 195 sampled sections untidied.
- **Sections whose caption carries a change marker**, where the Legislature is
  deleting a word from the caption itself. A struck caption must keep rendering
  struck rather than being promoted to a title, where it would read as current
  law.
- **Each citation form a section can open with**: a Minnesota Statutes section,
  a Minnesota Rules part, a session law, and a new statute stating its own
  number in brackets.

### Refreshing it

The fixture is a snapshot, not a live feed, and it does not need routine
updating — it is pinned so a parser change is measured against a constant. Add
to it when a new failure mode turns up, by appending the real section that
showed it.

The production API is read-only over GET and rate-limited. Fetch a bill's
current version with `GET /api/v1/bills/<id>/versions` and use the entry whose
`is_current` is true (the version code is **not** literally `"current"` for most
bills), then `GET /api/v1/bills/<id>/versions/<code>/text`. Pace requests about
0.7 seconds apart and send a `User-Agent` header.

## `bill-text-body-blocks.json`

5 real sections from 3 real Minnesota bills, each carrying the `bodyBlocks` the
API now returns beside the flat text (`#741`). They back
`../billTextBlocks.test.ts`, which checks the structured reading path — the one
that renders for any section re-read from the Revisor.

Each entry is `{ billId, sectionId, heading, articleHeading, text, bodyBlocks }`.
The `text` and `bodyBlocks` of one entry are two renderings of the _same_ section,
produced by the same parse, which is what lets the tests assert that the
structured path never drops wording the flat path shows.

What the selection deliberately includes:

- **A whole subdivision the bill is adding** (HF 1157 § 1), where the subdivision
  number, its title and its entire body are all new text. Nothing here may render
  as current law.
- **A removal and an addition in the same clause** (HF 1157 § 2), the pair that
  proves both treatments render and that the legend may name both.
- **A section with several subdivisions** (HF 3534 § 2), so only the first is
  promoted to the card title and the rest stay in the body with their numbers.
- **Two appropriation sections** (HF 4902, article 8 §§ 1–2): the one holding the
  year header row (`2026`, `2027`) and the one holding the figures those years
  head. They are separate sections in the source, which is the constraint any
  table layout work has to deal with ([#752](https://github.com/alethical-org/alethical/issues/752)).
  They also carry the spacer cell that puts a lone `$` in its own column.

### Refreshing it

Same rule as above: it is pinned, so add to it when a new failure mode turns up.
These blocks come from the Revisor's own pages
(`https://www.revisor.mn.gov/bills/<biennium>/<year>/0/<HF|SF>/<number>/versions/<n>/`)
parsed with the production parser (`parse_bill_text_html` in
`alethical/pipeline/minnesota.py`), which is exactly what fills the column. Be
sparing with those fetches and pause between them.

### This is not the corpus replay

These fixtures are the automated check that runs in CI. The corpus-wide replay —
every production section through the parser — is a separate manual check for
corpus-wide changes, because it needs live production data. Its recipe is in
`docs/product-onboarding/bill-text-tab-spec.md`, section "Verification" →
"The corpus replay, which the tests do not replace".
