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

Two traits, not 2 mutually exclusive kinds. §2.6 is why that distinction matters.

- **Research.** We add up the campaign-finance records we hold and publish what we found, signed
  and dated, with the arithmetic reproducible by a reader from the linked records. Rule 13 is the
  exception that permits this and the only place in the product where it is permitted. Exactly 1
  exists and is live: *The Money Only Goes One Way*.
- **A guide.** One term explained in plain language. A guide concludes nothing, adds nothing up
  across members, and defines no classifications, so it sits under rules 1 to 12 like every other
  surface and needs no part of rule 13's exception. None are live; 1 is drafted and 12 are planned.
- **Both.** A piece may carry both traits. See §2.6, which is where the reader-facing label for
  that case is decided, and §2.7, which is why this is not hypothetical.

## 2. Settled decisions

Ratified by Eugene, 27 Aug 2026, except where a different date is given.

### 2.1 Addresses carry the trait, and the `/reading` page lists everything

| address | what it is |
| --- | --- |
| `/reading` | the `/reading` page: everything we publish, one combined listing |
| `/reading/research/<name>` | one piece carrying the research trait, including a piece that also teaches |
| `/reading/guides/<name>` | one piece carrying only the guide trait |
| `/reading/sets/<name>` | one set of pieces meant to be read together |

**A piece carrying both traits is addressed under `research`**, because rule 13 binds it in full and
the address then states which promises apply to the page. See §2.6.

**What flat lost on, twice.** A flat `/reading/<name>` was decided on 25 Aug 2026 and withdrawn on
26 Aug when both its grounds failed checking; the full record is
[`page-metadata-for-search-and-sharing-decisions.md`](page-metadata-for-search-and-sharing-decisions.md)
§20.6. It was proposed a second time on 27 Aug by the peer coding consultant, on the ground that a
piece carrying both traits should not have to pick a folder. That ground is answered rather than
denied: a both-traits piece is not ambiguous, because rule 13 governs it, so `research` in its path
is true. And the stability argument behind flat is answered by the same fact that killed flat the
first time: `vercel.json` keeps permanent forwards, so a piece that ever has to move survives the
move.

**One measured fact strengthens nested and was cited for flat.** Google stopped showing the folder
path in mobile search results entirely, in every language and region, in January 2025, and still
shows one on desktop where a page's own breadcrumb markup determines what it says
([Simplifying the visible URL element on mobile search results](https://developers.google.com/search/blog/2025/01/simplifying-breadcrumbs),
read 27 Aug 2026: "we're rolling out a change to no longer show breadcrumbs on mobile search results
in all languages and regions where Google Search is available (they continue to appear on desktop
search results)" and "we continue to support breadcrumb markup for use in desktop search results").
Flat's original ground was that a folder word becomes reader-visible text we cannot edit. That
ground is dead twice over.

### 2.2 A guide may exist outside every set

A set is a group of pieces written to be read together. A piece does not need one.

**Why.** Sets have no model in the code at all, so allowing this costs nothing today, and
forbidding it forces a fake set the first time a single standalone piece is worth writing. The
design already handles both cases: a card outside a set box carries its label, a row inside a set
box does not.

### 2.3 A set names only its published pieces, never its unwritten ones

Ratified by Eugene 27 Aug 2026. A set box on the `/reading` page lists the pieces that are
published and nothing else. It never lists a title a reader cannot open, and it carries no count
of how many pieces the set is eventually meant to hold.

**What the alternative was.** "How the Money Works" is planned as 5 pieces in a fixed reading
order, and 1 is written ([issue 1771](https://github.com/alethical-org/alethical/issues/1771)).
The box could have named all 5, with 4 unopenable.

**Why it lost.** [`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md)
rule 2 forbids naming an intent we cannot deliver, and it exists to stop us advertising an unbuilt
feature. A table of contents with 4 gaps is that same promise made about our writing schedule
instead. Naming all 5 would only be honest if each unwritten piece had a person and a date, which
is a commitment rather than a design choice, and none exists.

**What it costs, stated plainly.** A reader cannot discover that the set is meant to grow, so
nobody looks forward to piece 3. Reversible the moment owners and dates exist, by adding the
titles back.

**A set's own page follows the same rule.** `/reading/sets/<name>` lists its published pieces and
no others.

### 2.4 A set with no published pieces hides its box and keeps its page

On the `/reading` page, a set whose pieces are all unpublished shows no box. Its own
`/reading/sets/<name>` page stays reachable and stays served.

**What the drawn alternative lost on.** The design drew the empty box visible. A box with no rows
tells a reader nothing and reads as broken. Keeping the page reachable is what
[`page-metadata-for-search-and-sharing-decisions.md`](page-metadata-for-search-and-sharing-decisions.md)
§20.5 rule 1 requires of every piece anyway: reachable by an ordinary link, permanently, not only
while recent.

**This state is close to hypothetical.** Rule 13's publishing order puts a piece on the site the
day it posts and settles every disagreement by correcting its text, never by pulling it, so a set
only empties if we deliberately unpublish its last piece. Rule 13 does not say a piece can never be
withdrawn; it gives no procedure for doing so, which is why this is rare rather than impossible.

### 2.5 A person authors every term link; software only proposes candidates

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

### 2.6 The words are **Research** and **Guide**, for readers and in the code both

One vocabulary, no mapping layer: a reader sees "Research" or "Guide", and the code says `research`
and `guide`.

**Why not "report" for our own digging.** Minnesota's Campaign Finance Board calls a campaign's
filed disclosure document a report, and **21 distinct reader-facing strings** in
`apps/frontend/src/lib/committeeMoney.ts` alone use the word for that document, including a counter
rendering "16 reports filed" and an ordering line reading "by the period each report covers".
Counted 27 Aug 2026; every one of the 21 is about filing to the Board. Renaming a public record to
free the word is not available, so our own writing is the half that moves.

**Why "Guide" rather than "Explainer".** "Explainer" names a publishing format; "Guide" states the
help on offer. Both are honest, and the reader-facing test is which one a person clicks when
looking for help, not which is more precise.

**Why this session's objection to "Guide" was withdrawn.** It argued that 13 internal engineering
documents named `*-guide.md` under `docs/product-onboarding/` give the word a second meaning.
[`.claude/rules/workflow.md`](../../.claude/rules/workflow.md) rule 7 requires names a newcomer can
guess and bans metaphors; it nowhere requires one globally unique meaning per word. Those 13 files
are correctly named in their own setting and no reader ever sees them. Objection dropped.

**Why one vocabulary rather than reader-facing labels over different internal names.** The peer
coding consultant recommended the split, citing rule 3 of
[`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md), which requires
"author" in user-facing copy while the data model keeps `SponsorshipRole.sponsor`
(`alethical/db/models.py:100`). Eugene's ruling: one vocabulary, because the split's cost is a
mapping every future reader of the code has to hold in their head, and here the internal word can
simply be the reader's word. Rule 3's precedent stands where it is: `sponsor` is a genuinely
distinct filing role, not a translation of "author".

**A piece carrying both traits shows one label: Research.** Rule 13 makes research the stricter
class, and a piece that adds figures up across members must obey rule 13 in full whatever else it
does. Two labels would tell a reader that 2 sets of promises apply when only the stricter one
governs. Internally it carries both traits, so it can be found as either.

### 2.7 The both-traits case is real, and was measured before it was designed for

The peer coding consultant proposed classifying every planned piece with 2 questions: does it draw
conclusions, and does it teach 1 concept. Run against the 13 pieces in
[issue 1752](https://github.com/alethical-org/alethical/issues/1752) on 27 Aug 2026:

- The 1 live piece, *The Money Only Goes One Way*, is research only.
- 11 of the 12 planned guides are guides only.
- **Planned guide 2, "The money with no donor named", carries both.** Its outline states the
  unnamed money "was 36.5% of the money in 2024 and 41.3% in 2025 across sitting legislators'
  accounts". Adding a figure up across members is rule 13's first special permission, so this
  piece needs rule 13 and every condition attached to it.
- **Planned guide 9, "Independent spending", is arguable.** Its outline states "more than half of
  it attacks rather than supports", which is a share across the whole independent-spending dataset
  rather than across members. Classified when it is written, not now.

So the both-traits case is present in our own plan today. That is the whole reason §2.6 needed a
label rule for it and §2.1 needed an address rule for it.

### 2.8 The order the rename runs in

**Ran 27 Aug 2026.** The reader-facing words, the internal names, the addresses and the permanent
forwards all shipped in one pull request; the 4 fields in §4 did not, and stay on
[issue 1752](https://github.com/alethical-org/alethical/issues/1752).

1. Let the 2 in-flight branches on the report page and the `/reading` page's predecessor land on
   `main`.
2. Pause new edits to those 2 files for the length of the rename.
3. One owner performs the rename from the combined `main`, in one pass.
4. Move the live address once, with every permanent forward in the same release, direct and with no
   intermediate hop:
   `/reports/the-money-only-goes-one-way` to `/reading/research/the-money-only-goes-one-way`.

Sequence recommended by the peer coding consultant on 27 Aug 2026 and adopted. Its purpose is
[`.claude/rules/workflow.md`](../../.claude/rules/workflow.md)'s prohibition on landing work under
another session's feet, not tidiness.

## 3. Open decisions

None. §2.3 and §2.6 closed the last 2 on 27 Aug 2026.

## 4. What the design assumes and the code does not provide

Four fields, none of which exists. Every one is read by the drawings for the `/reading` page, so
none of that page can be built until they do.

1. **Two trait flags on a piece**, not 1 kind: does it carry the research trait, does it carry the
   guide trait. `ResearchPiece` (`apps/frontend/src/lib/research.ts`) has neither, and §2.8's rename
   deliberately added neither: a single-value `kind` field would make the both-traits case in §2.7
   impossible to express, and the 2 flags belong with the other 3 fields on
   [issue 1752](https://github.com/alethical-org/alethical/issues/1752) rather than half-built ahead
   of them. The label a
   reader sees is derived, per §2.6: research trait present means the label reads Research.
2. **Set membership, and a piece's position within its set.** The set concept has no model at all.
3. **Reading time, computed from a piece's own words.** The page prints no minutes today.
4. **A "checked" date**, distinct from the publication date. Settled 26 Aug 2026: a piece reads
   "Written August 2026" until someone re-checks it and "Checked March 2027" from then on, same
   slot, one word swapped, and a listing row carries no date either way.

## 5. Naming debt to clear with the rename

Two items, both rode with §2.8's rename so the files were swept once. **Both are cleared, 27 Aug
2026**; what each one was, and where it went, is below.

- **"Shelf"** for the `/reading` page broke
  [`.claude/rules/workflow.md`](../../.claude/rules/workflow.md) rule 7, which requires literal
  names a newcomer can guess and bans metaphors. It arrived in a design bundle and had spread into
  `MoneyReportsShelfScreen.tsx`, its exported screen and route, 4 code comments, the navigation
  note at `apps/frontend/src/navigation/ia.ts`, and rule 13's own text. Replacement, now shipped:
  **the `/reading` page**, named by its address, which is Eugene's standing rule for naming any
  page. The screen is `ReadingScreen.tsx`, its route is `Reading`, and the word "shelf" appears
  nowhere in the frontend or the API.
- **`explainer`** as the internal word for the guide trait, in this repo's issues, design notes and
  any code that reaches for it. Replacement: `guide`, per §2.6. Nothing is built for that trait, so
  this cost nothing beyond prose, and the prose is done: the folder-word table in
  [`page-metadata-for-search-and-sharing-decisions.md`](page-metadata-for-search-and-sharing-decisions.md)
  §20.6 and its §21 both say `guide` now. Two `explainer` uses are deliberately left: the mentions in
  this section, which are the record of what was renamed, and `styles.explainer` in 2 screens, which
  names a block of explanatory copy and has nothing to do with the guide trait.

## 6. How we would learn the label choice was wrong

The peer coding consultant proposed 5 falsification tests, every one requiring 20 to 30 first-time
readers. **Alethical has no reader-testing setup and no approved budget for one**, so those tests
are not a plan we can run and are not adopted as one. What we can measure without one:

- Which section a person lands on from a search engine, per address folder, which §2.1's nested
  scheme makes readable directly.
- Whether any published piece ever needs its address moved because its traits changed. §2.6 makes
  the both-traits case detectable at authoring time, so a move after publication is the signal
  that §2.1 chose wrong.
