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

### This is not the corpus replay

These fixtures are the automated check that runs in CI. The corpus-wide replay —
every production section through the parser — is a separate manual check for
corpus-wide changes, because it needs live production data. Its recipe is in
`docs/product-onboarding/bill-text-tab-spec.md`, section "Verification, and the
gap in it".
