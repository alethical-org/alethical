# Published writing — decisions

**Net:** Alethical publishes its own writing about the records it holds, and the decisions
governing that surface had been accumulating in GitHub issue comments, which
[`.claude/rules/workflow.md`](../../.claude/rules/workflow.md) rule 4 names as the wrong home for a
decision. This file is that home. It records what is settled, what is open, and what each
alternative lost on, so a build session reads decisions rather than a conversation.

This file declares no code, deliberately. It is a decisions record for a surface that is mostly
unbuilt; the behaviour of what *is* built is described in
[`docs/product-onboarding/campaign-money-section-guide.md`](../product-onboarding/campaign-money-section-guide.md),
which declares those files already. Declaring them twice would double the doc-sync burden on
every PR that touches them for no gain.

The product invariant that governs what a piece may **say** is
[`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md) rule 13. Nothing in
this file loosens it. Sequencing and open tasks live on
[issue 1752](https://github.com/alethical-org/alethical/issues/1752).

## 1. What we publish

Two kinds, and the difference is what they are allowed to do.

- **Our own digging.** We add up the campaign-finance records we hold and publish what we found,
  signed and dated, with the arithmetic reproducible by a reader from the linked records. Rule 13
  is the exception that permits this and the only place in the product where it is permitted.
  Exactly 1 exists and is live: *The Money Only Goes One Way*.
- **Short teaching pieces.** One term each, in plain language. These conclude nothing, add nothing
  up across members, and define no classifications, so they sit under rules 1 to 12 like every
  other surface and need no part of rule 13's exception. None are live; 1 is drafted and 12 are
  planned.

## 2. Settled decisions

Ratified by Eugene, 27 Aug 2026, except where a different date is given.

### 2.1 Addresses carry the kind

A piece lives at a nested address, with one combined listing above them:

| address | what it is |
| --- | --- |
| `/reading` | everything, one combined listing |
| `/reading/<kind>/<name>` | one piece |
| `/reading/sets/<name>` | one set of pieces meant to be read together |

**What flat lost on.** A flat `/reading/<name>` was decided on 25 Aug and withdrawn on 26 Aug when
both its grounds failed checking. Ground 1 was that a folder word becomes reader-visible text we
cannot edit; Google does derive a breadcrumb from address words, and its own breadcrumb
documentation also says a page's structured markup determines the breadcrumb a result shows, so
the word is controllable rather than permanent. Ground 2 was that we do not maintain forwards;
`vercel.json` already keeps permanent forwards for this same section of the site. The full record,
including what survives from the flat reasoning, is
[`docs/architecture/page-metadata-for-search-and-sharing-decisions.md`](page-metadata-for-search-and-sharing-decisions.md)
§20.6.

**What nested buys.** A listing address and the pieces beneath it agree by construction, and no
word has to be permanently reserved as a name a piece may never take.

**The `<kind>` folder word is not settled** — see §3.1. Nothing may hard-code it yet.

### 2.2 A teaching piece may exist outside every set

A set is a group of pieces written to be read together. A piece does not need one.

**Why.** Sets have no model in the code at all, so allowing this costs nothing today, and
forbidding it forces a fake set the first time a single standalone piece is worth writing. The
design already handles both cases: a card outside a set box carries its kind word, a row inside a
set box does not.

### 2.3 A set with no published pieces hides its box and keeps its page

On `/reading`, a set whose pieces are all unpublished shows no box. Its own page at
`/reading/sets/<name>` stays reachable and stays served.

**What the drawn alternative lost on.** The design drew the empty box visible. A box with no rows
tells a reader nothing and reads as broken. Keeping the page reachable is what
[`page-metadata-for-search-and-sharing-decisions.md`](page-metadata-for-search-and-sharing-decisions.md)
§20.5 rule 1 requires of every piece anyway: reachable by an ordinary link, permanently, not only
while recent.

**This state is close to hypothetical.** Rule 13's publishing order puts a piece on the site the
day it posts and settles every disagreement by correcting its text, never by pulling it, so a set
only empties if we deliberately unpublish its last piece. Rule 13 does not say a piece can never be
withdrawn; it gives no procedure for doing so, which is why this is rare rather than impossible.

### 2.4 A person authors every term link; software only proposes candidates

Each jargon term is defined in exactly 1 piece. Where that term appears in another piece, the
appearance may link to the piece that owns it. **A person decides each link.** Software's only role
is producing a list of candidate appearances for that person to accept or reject.

**Why automatic matching loses.** The linking rules already settled on
[issue 1752](https://github.com/alethical-org/alethical/issues/1752) require judgements a matcher
cannot make:

- Link on **first use only**, once per paragraph.
- **Never link a phrase whose wording is unsettled**, such as a figure queued for a correction.
- **Only link to what exists** — a forward link goes in when its destination posts, not before.

And a matcher would link terms inside quotations from Minnesota statutes, which puts our own
explanation inside the state's words.

## 3. Open decisions

### 3.1 The 2 kind words

What a reader sees above a title, and what the code calls each kind.

Eugene's constraint, 27 Aug 2026: **the reader-facing word and the code's own name are the same
vocabulary**, rather than a reader-facing label sitting over a different internal name.

Out with the peer coding consultant as of 27 Aug 2026. The candidates and what each turns on:

- **"Report"** for our own digging collides with the source's vocabulary. Minnesota's Campaign
  Finance Board calls a campaign's filed disclosure document a report, and **21 distinct
  reader-facing strings** in `apps/frontend/src/lib/committeeMoney.ts` alone use the word for that
  document, including a counter rendering "16 reports filed" and an ordering line reading "by the
  period each report covers". Counted 27 Aug 2026; every one of the 21 is about filing to the
  Board. Our own writing is the half that can move, because renaming a public record to free the
  word is not available.
- **"Guide"** for the teaching pieces collides inside our own repo: 13 internal engineering
  documents under `docs/product-onboarding/` are named `*-guide.md`.
- **"Explainer"** collides with nothing and is already the internal word, so adopting it renames
  nothing. Its risk is being industry vocabulary rather than the word an ordinary person uses.
- **A display-only split** is not ruled out by argument here, and our own rules bless one
  elsewhere: `.claude/rules/grounded-answers.md` rule 3 requires "author" in user-facing copy while
  the data model keeps `SponsorshipRole.sponsor` (`alethical/db/models.py:100`).

Until this settles, `<kind>` in §2.1's address table stays unresolved and the hardcoded `REPORT`
at `apps/frontend/src/screens/redesign/MoneyReportScreen.tsx:434` stays as it is.

## 4. What the design assumes and the code does not provide

Four fields, none of which exists. Every one is read by the drawings for `/reading`, so none of
that page can be built until they do.

1. **A kind on a piece.** `MoneyReport` (`apps/frontend/src/lib/moneyReports.ts`) has no such field.
2. **Set membership, and a piece's position within its set.** The set concept has no model at all.
3. **Reading time, computed from a piece's own words.** The page prints no minutes today.
4. **A "checked" date**, distinct from the publication date. Settled 26 Aug 2026: a piece reads
   "Written August 2026" until someone re-checks it and "Checked March 2027" from then on, same
   slot, one word swapped, and a listing row carries no date either way.

## 5. Naming debt to clear with the rename

The word **"shelf"** for the page listing our writing breaks
[`.claude/rules/workflow.md`](../../.claude/rules/workflow.md) rule 7, which requires literal names
a newcomer can guess and bans metaphors. It arrived in a design bundle and has spread into
`MoneyReportsShelfScreen.tsx`, its exported screen and route, 4 code comments, the navigation note
at `apps/frontend/src/navigation/ia.ts:236`, and rule 13's own text. Replacement: **the reading
page**, which is literal and holds under §2.1.

Not a separate change. It rides with whatever rename §3.1 produces, so the files are swept once.
