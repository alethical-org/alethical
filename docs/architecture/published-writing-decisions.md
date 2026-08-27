# Published writing — decisions

**Net:** Alethical publishes its own writing about the records it holds, and the decisions
governing that surface had been accumulating in GitHub issue comments, which
[`.claude/rules/workflow.md`](../../.claude/rules/workflow.md) rule 4 names as the wrong home for a
decision. This file is that home. It records what is settled, what is open, and what each
alternative lost on, so a build session reads decisions rather than a conversation.

This file declares no code, deliberately. It is a decisions record; the behaviour of what is built is
described in
[`docs/product-onboarding/campaign-money-section-guide.md`](../product-onboarding/campaign-money-section-guide.md),
which declares those files already. Declaring them twice would double the doc-sync burden on
every PR that touches them for no gain.

The product invariant that governs what a piece may **say** is
[`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md) rule 13. Nothing in
this file loosens it. Sequencing and open tasks live on
[issue 1752](https://github.com/alethical-org/alethical/issues/1752).

## 1. What we publish

Two traits, not 2 mutually exclusive kinds. §2.7 is why that distinction matters.

- **Research.** We add up the campaign-finance records we hold and publish what we found, signed
  and dated, with the arithmetic reproducible by a reader from the linked records. Rule 13 is the
  exception that permits this and the only place in the product where it is permitted. Exactly 1
  exists and is live: *The Money Only Goes One Way*.
- **A guide.** One term explained in plain language. A guide concludes nothing, adds nothing up
  across members, and defines no classifications, so it sits under rules 1 to 12 like every other
  surface and needs no part of rule 13's exception. Two exist and are live, both posted 27 Aug
  2026 and both in the set "How the Money Works": *Who has to report their money*, at
  `/read/guides/who-has-to-report-their-money`, and *What the records name, and what they leave
  out*, at `/read/guides/what-the-records-name`. A third, *Why 2 official numbers can both be
  right*, is written and settled at
  [`docs/reader-guides/why-2-official-numbers-can-both-be-right.md`](../reader-guides/why-2-official-numbers-can-both-be-right.md),
  a fourth, *Money spent without a campaign's say*, at
  [`docs/reader-guides/money-spent-without-a-campaigns-say.md`](../reader-guides/money-spent-without-a-campaigns-say.md),
  and a fifth, *Why nobody can follow a dollar*, at
  [`docs/reader-guides/why-nobody-can-follow-a-dollar.md`](../reader-guides/why-nobody-can-follow-a-dollar.md).
  None of the 3 has a page yet, so none is posted and no reader can reach any of them. That
  completes the 5 pieces [issue 1752](https://github.com/alethical-org/alethical/issues/1752)
  fixed for the set "How the Money Works", and closes what
  [issue 1771](https://github.com/alethical-org/alethical/issues/1771) raised: the set no longer
  has unwritten pieces waiting on an owner. Seven more guides are planned across other subjects,
  none of them started.
- **Both.** A piece may carry both traits. See §2.7, which is where the reader-facing label for
  that case is decided, and §2.8, which is why this is not hypothetical.

## 2. Settled decisions

Ratified by Eugene, 27 Aug 2026, except where a different date is given.

### 2.1 Addresses carry the trait, and the `/read` page lists everything

| address | what it is |
| --- | --- |
| `/read` | the `/read` page: everything we publish, one combined listing |
| `/read/research/<name>` | one piece carrying the research trait, including a piece that also teaches |
| `/read/guides/<name>` | one piece carrying only the guide trait |
| `/read/sets/<name>` | one set of pieces meant to be read together |

**A piece carrying both traits is addressed under `research`**, because rule 13 binds it in full and
the address then states which promises apply to the page. See §2.7.

**What flat lost on, twice.** A flat address with no folder word — `/read/<name>` in today's
terms, written `/reports/<name>` at the time — was decided on 25 Aug 2026 and withdrawn on
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
box does not. §2.10 narrows what "outside a set box" means, because a heading can supply the word
instead.

### 2.3 A set names only its published pieces, never its unwritten ones

Ratified by Eugene 27 Aug 2026. A set box on the `/read` page lists the pieces that are
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

**A set's own page follows the same rule.** `/read/sets/<name>` lists its published pieces and
no others.

### 2.4 A set with no published pieces hides its box and keeps its page

On the `/read` page, a set whose pieces are all unpublished shows no box. Its own
`/read/sets/<name>` page stays reachable and stays served.

**What the drawn alternative lost on.** The design drew the empty box visible. A box with no rows
tells a reader nothing and reads as broken. Keeping the page reachable is what
[`page-metadata-for-search-and-sharing-decisions.md`](page-metadata-for-search-and-sharing-decisions.md)
§20.5 rule 1 requires of every piece anyway: reachable by an ordinary link, permanently, not only
while recent.

**This state is close to hypothetical.** Rule 13's publishing order puts a piece on the site the
day it posts and settles every disagreement by correcting its text, never by pulling it, so a set
only empties if we deliberately unpublish its last piece. Rule 13 does not say a piece can never be
withdrawn; it gives no procedure for doing so, which is why this is rare rather than impossible.

### 2.5 A set box shows from the first published piece, and starting one commits us to the next

Ratified by Eugene 27 Aug 2026, rejecting a design recommendation with a reason that changes what
the box means.

**The rule.** A set holding 1 published piece shows its box, drawn exactly as a box holding many:
the summary, the meta line, the rule above the rows, the fold control, and 1 row. Nothing is
stripped at 1 piece.

**Why, and this is the part that matters.** Starting a box is a statement that more is coming
shortly. So the box is not a container asserting pieces a reader cannot see; it is a declaration of
intent, and we only open one when that intent is real. Read this beside §2.3: the box never *names*
an unwritten piece, so nothing is promised that a reader could try to open. What its existence says
is that the set is live and growing.

**The consequence to apply before any set ships with 1 piece.** Under this rule the box is
conditional on the next piece actually being close. Deciding it is an editorial call about the
writing schedule, not a design question.

**Spent for "How the Money Works", 27 Aug 2026.** That set had 1 published piece and
[issue 1771](https://github.com/alethical-org/alethical/issues/1771) recorded that pieces 2 onward
had no owner and no dates, so its box was correct to build and not yet correct to show. Piece 2
posted the same day, so the set has 2 published pieces and its box now shows with 2 rows. The
1-piece state is still the ratified design and is still what a new set opens with; it is simply
not the state this set is in.

**What the design recommended instead, and why it lost.** Design drew the 1-piece box as asked,
then argued against it: at 1 piece the meta line restates the single row, the row's own reading time
appears twice, the dividing rule is a table header over a one-row table, and the fold control offers
to collapse a single line. It proposed a box from 2 pieces, a plain card carrying the set's name at
1, and nothing at 0. Every one of those observations about repeated furniture is accurate. It lost
because it reads the box as a container, and Eugene's ruling makes it a signal: the repetition is
the cost of saying "this is a set and it is growing" from the first piece, and the alternative
spends a visual transition at the second piece to save it.

**What it costs.** A reader meeting a 1-row box sees 4 pieces of furniture that carry no
information beyond the row itself. The box is also a promise about our writing schedule that no
individual title backs, so a set left at 1 piece for months makes the signal false without any
sentence being wrong.

### 2.6 A person authors every term link; software only proposes candidates

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

### 2.7 The words are **Research** and **Guide**, for readers and in the code both

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

### 2.8 The both-traits case is real, and was measured before it was designed for

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

**That one is now written, classified guide only, and its outline claim turned out to be false as
worded.** It became the independent-spending half of *Money spent without a campaign's say*
([`docs/reader-guides/money-spent-without-a-campaigns-say.md`](../reader-guides/money-spent-without-a-campaigns-say.md)).
Measured on the Board's own "Itemized independent expenditures of over $200 - All" download,
counted as served on 27 Aug 2026: **31,718 of the 41,130 rows are marked For and 9,412 are marked
Against**, so by payment count 77% support rather than attack. By dollars the outline is right,
$96,547,924.18 of $178,579,449.67 sitting on rows marked Against, 54.1%. The 2 answers point
opposite ways, and the outline named neither measure.

**So the classification splits along the same line.** A **count of rows in a published download**
is a fact about the download, names nobody and sums no member's money, which is the ground §2.6's
sibling pieces already ship on: *What the records name, and what they leave out* prints 583,152 and
337,888 as a guide. A **sum of dollars across every spender and every affected committee in the
file** is rule 13's first special permission. The guide therefore prints the row counts, prints no
dollar total, and tells the reader in its own words that a count of payments is not a count of
money and that the amounts are in the same file. The dollar split is available to a signed research
piece and belongs to nothing else.

So the both-traits case is present in our own plan today. That is the whole reason §2.7 needed a
label rule for it and §2.1 needed an address rule for it.

### 2.9 The order the rename runs in

**Ran 27 Aug 2026.** The reader-facing words, the internal names, the addresses and the permanent
forwards all shipped in one pull request; the 4 fields in §4 did not, and stay on
[issue 1752](https://github.com/alethical-org/alethical/issues/1752).

1. Let the 2 in-flight branches on the report page and the `/read` page's predecessor land on
   `main`.
2. Pause new edits to those 2 files for the length of the rename.
3. One owner performs the rename from the combined `main`, in one pass.
4. Move the live address once, with every permanent forward in the same release, direct and with no
   intermediate hop:
   `/reports/the-money-only-goes-one-way` to `/reading/research/the-money-only-goes-one-way`.

**It moved a second time the same day**, to `/read/research/the-money-only-goes-one-way`, when §2.13
settled the bar's word. The 2 moves make 3 generations of address, and the rule the sequence exists
to protect is what stops that compounding: every retired address forwards to its FINAL destination in
1 hop, never through the address in between. `vercel.json` carries 7 permanent forwards to prove it.

Sequence recommended by the peer coding consultant on 27 Aug 2026 and adopted. Its purpose is
[`.claude/rules/workflow.md`](../../.claude/rules/workflow.md)'s prohibition on landing work under
another session's feet, not tidiness.

### 2.10 A card carries its kind word only where no heading supplies one

Ratified by Eugene 27 Aug 2026, narrowing §2.2's wording at Design's own request rather than
letting Design apply the narrowing quietly.

**The rule.** A card carries its kind word where nothing above it already says the kind. Under a
`GUIDES` or `RESEARCH` heading on the `/read` page, the heading is the source and the card
inherits, so the card prints no word. A card prints the word on the home page, in a search result,
and in a related-piece list, where no heading supplies it.

**Why the earlier wording needed narrowing.** §2.2 said a card outside a set box carries the word,
without qualification. Applied literally on the `/read` page that prints "Guide" under a heading
already reading `GUIDES`, twice in one glance. Design spotted this while drawing the page and asked
to have the narrowing ratified rather than absorb it silently, which is the right instinct: the
looser sentence was already written down and would have been followed by the next person.

**What it costs.** The word a reader sees now depends on context rather than on the piece, so a
card component needs to know whether a heading sits above it. That is a small amount of wiring and
1 more state to get wrong.

### 2.11 The `/read` page groups by our 2 kinds for now, and the objection is recorded

Ratified by Eugene 27 Aug 2026. `GUIDES` and `RESEARCH` stay as the page's headings, and
**`RESEARCH` sits above `GUIDES`**.

**The order is Eugene's, against the design.** Every drawing in the accepted handoff puts `GUIDES`
first; he overruled it and named it the only change from that handoff. Research is what Alethical
publishes in its own name and the reason the section exists, so it leads. A guide teaches a term a
research piece raised, which makes it the support rather than the headline. Treat any drawing showing
`GUIDES` first as superseded on this one point and nothing else.

**Design's objection, which stands and is not dismissed.** Grouping the page by our own genre is the
opposite of the reason both kinds share one page: a reader arrives with a subject in mind, not a
genre. Design raised it, declined to restructure the page on its own authority because that is a
decision rather than a refinement, and asked for a ruling.

**Why it is not acted on yet.** Two reasons, neither of them disagreement. At 2 published pieces
there is nothing for a subject grouping to group. And a subject grouping needs a subject on every
piece, which is a field no piece carries and nobody has designed; it would join the 4 unbuilt fields
in §4 rather than replacing any of them.

**When to revisit.** At 4 sets or a dozen research pieces, which is the state Design's own full
drawing shows. That is the point where a reader scanning for a subject has to read past most of the
page to find it.

**What it costs to wait.** If the answer turns out to be subject grouping, the page is restructured
after readers have learned the current shape, and any inbound link to a heading anchor breaks.

### 2.12 A piece's number in its set never reaches a reader

Ratified by Eugene 27 Aug 2026. No reader-facing surface prints a piece's position in its set. Not
"piece 1", not "piece 1 of 5", not "1st", and not a numbered row inside a set box. The set's name
alone is what a reader is told.

**Why.** A number is how we talk about the work internally, in this file and on
[issue 1752](https://github.com/alethical-org/alethical/issues/1752). To a reader it answers a
question nobody asked and raises one we do not want to answer: if this is piece 1, how many are
there, and where are the rest. §2.3 already forbids naming an unwritten piece; a number implies the
whole run of them without naming any.

**Where it applies.** Every surface, not a list: a piece's own page, its masthead, a card on the
`/read` page, a row inside a set box, a share preview, a search result.

**This is the second narrowing of the same line in one day.** The guide's position line began as
"How the Money Works, piece 1 of 5", lost "of 5" under §2.3 on the ground that the set's size was a
promise, then lost "piece 1" under this ruling on the ground that any number is internal. Both
narrowings point the same way and the second supersedes the first, so the reader-facing form is the
set's name and nothing else.

**What it costs.** A reader arriving at the middle of a set cannot tell where they are in the
reading order from the piece itself. The order lives on the set's own page, where the pieces are
listed in it.

### 2.13 The bar says **Read**, one item with no dropdown, and the addresses match it

Ratified by Eugene 27 Aug 2026, after §2.1's addresses had already shipped once at `/reading`.

**The rule.** The top bar's second item is the single word **Read**. It is a destination, not a
dropdown: one bar item on a computer with no panel behind it, and one row in the phone drawer with no
heading over it. Every address takes the same word — `/read`, `/read/research/<name>`,
`/read/guides/<name>`, `/read/sets/<name>` — and so does every internal name: the screen is
`ReadScreen.tsx`, the route is `Read`, and the registry item's id is `read`. One vocabulary for
readers and code both, per §2.7.

**Why the group went.** It held exactly 1 child, labelled "Campaign money". So the bar drew a
dropdown containing a single item and the phone drawer drew a heading over a single row, which is
furniture with nothing to disclose. Everything we publish sits on the one `/read` page, and a new set
adds a box to that page rather than a row to the bar, so the group had no growth path either. The
20 Aug 2026 reasoning that kept it — the child named a subject the header did not — is superseded:
the header is now the reader-facing word, and the child is gone.

**What the reader gains, and it is the point.** One tap instead of two on a phone, and the bar's
second item now names a destination rather than a container. A reader looking for our writing reads
one word and arrives.

**What it costs, stated plainly.** A third generation of address, so every link anyone has shared
since 20 Aug 2026 now relies on a permanent forward. Two of those addresses were public: the
research piece at `/reading/research/the-money-only-goes-one-way` from the morning of 27 Aug 2026
and the guide at `/reading/guides/who-has-to-report-their-money` from that evening. Both keep
working indefinitely, and §2.9 records the rule that keeps the chain from compounding.

**The bar's own item is not marked by chrome, it is marked by ARIA.** The nav had no
`aria-current="page"` anywhere, while 4 other surfaces in the app mark their current thing. The row
whose link is the page being viewed now carries it, at both bands. A dropdown trigger never does: a
trigger opens a panel and is not a page, so on `/money` the Money in politics row inside Search is
marked and the Search trigger is not.

**In the phone drawer the Read row is drawn at top level, not as another group row.** Ruled by
Eugene 27 Aug 2026, correcting a first build that drew it plain. The row is 60px tall with a 1px
rule above and below (`alpha.ink10`), its label at 25px in the same weight as a group's rows, its
NEW chip beside the label, and a drawn right arrow at the far end in the muted ink. The whole band
between the 2 rules is the tap target.

**Why the plain row lost.** The nav's job is to show the shape of the site. A row identical to
Search's 4 children tells a phone reader that Read is one of them, when it is 1 of the 3 things this
site does; the rules and the extra height are what say it sits at the top level. Design drew it this
way and argued for it; the first build drew it plain because the brief it was given put drawer
geometry out of scope, and the brief was what was wrong.

**Still no heading over it.** A `READ` eyebrow would repeat its own child 14px below it, which is
the stutter that collapsing the group removed. The arrow is what explains the missing heading:
nothing else in the drawer has one, and a destination has no children to label.

**The arrow is a drawn path and is hidden from a screen reader.** Drawn, because Libre Franklin
carries no right-arrow glyph and a typed arrow renders as a missing character — the same reason
every other arrow on the site is drawn (`ArrowRight` in
`apps/frontend/src/components/icons.tsx`). Hidden, because the row's own words already say where it
goes and `aria-current` already says whether you are there.

## 3. Open decisions

None. §2.3, §2.5, §2.7, §2.10, §2.11, §2.12 and §2.13 all closed on 27 Aug 2026.

## 4. The 4 fields the design reads off a piece

**All 4 shipped 27 Aug 2026**, in the change that built the guide page at
`/read/guides/who-has-to-report-their-money` and the 2 groups on the `/read` page. They live on
`ResearchPiece` in `apps/frontend/src/lib/research.ts`.

1. **Two trait flags on a piece** (`traits: { research, guide }`), not 1 kind. A single-value `kind`
   field would make the both-traits case in §2.8 impossible to express. The label a reader sees is
   derived, never stored, per §2.7: `pieceKindLabel` returns Research when the research trait is
   present and Guide otherwise, and `pieceAddressFolder` is the single place that turns the same
   flags into the piece's folder, so a piece has exactly 1 address and the router rejects the other
   one.
2. **Set membership and position** (`set: { name, position }`), optional per §2.2. The position
   orders a set and is printed nowhere a reader can see, per §2.12; the set's name is all a reader is
   told, and it is not a link while `/read/sets/<name>` does not exist.
3. **Reading time**, computed by `pieceReadingMinutes` from the piece's own stored words at 200 words
   a minute, rounded to whole minutes and never below 1. Never typed. It appears on a guide's
   masthead and on a guide's card; a research piece's masthead stays at its 2 dates and nothing else,
   which rule 13's publishing order point 8 requires.
4. **A "checked" date** (`checkedOn`), distinct from the publication date. Settled 26 Aug 2026: a
   piece reads "Written August 2026" until someone re-checks it and "Checked March 2027" from then
   on, same slot, one word swapped.

   **The last clause of that settlement, that a listing row carries no date either way, was
   superseded on 27 Aug 2026 by Design's `/read` handoff, which Eugene sent to be built.** A card
   now carries its reading time and then its date, on both kinds: `7 MIN · PUBLISHED AUG 20, 2026`
   for a research piece and `5 MIN · WRITTEN AUGUST 2026` for a guide. The reason the 26 Aug
   settlement gave for dropping the date was staleness reading worst on a listing row, and the
   one-word swap it introduced in the same breath is the answer to it: re-checking a guide moves its
   card's date forward, so staying accurate makes a piece read as current rather than old. The
   handoff's own reason is different and also holds: every card in a column has to be one shape,
   because a column that changes shape per kind reads as 2 columns.

   **A row inside a set box still carries no date**, and no kind word and no number either. That is
   where "no date on a listing row" now lives, and it is not a compromise: the set box says the kind
   once for the whole set on its meta line, and a date on a row would be the third repeated thing in
   a list whose job is to be scanned.

**The set box and its fold control shipped 27 Aug 2026**, in the change that posted the set's
second guide. The box is `apps/frontend/src/components/read/SetBox.tsx`; the count and the total
minutes are computed from its published rows by `setMetaLine` and `setReadingMinutes`, so neither
can drift from the list underneath them, and a set's slug is computed from its name by the same rule
a section heading uses rather than stored as a fourth field.

The fold control is hand-built, and deliberately so: React Native's web renderer makes its own
elements, and the app has no disclosure or accordion component, so there is no browser default to
inherit. The 3 halves that are invisible when dropped are pinned by
`apps/frontend/src/components/read/__tests__/SetBox.test.ts`: the button sits inside its `h3`
rather than the other way round, `aria-controls` points at a list element that stays in the document
while the box is shut, and the chevron is hidden from assistive technology.

**What is still unbuilt:** a set's own page at `/read/sets/<name>`, and the "All of <set name>"
link Design gives a box at 6 published pieces. Tracked on
[issue 1752](https://github.com/alethical-org/alethical/issues/1752).

**One naming debt this change created and deliberately did not clear.** The container concept is a
**piece**, and the code still says `research` for it: the type is `ResearchPiece`, the registry is
`PUBLISHED_RESEARCH`, the file is `lib/research.ts` and the screen is `ResearchScreen.tsx`, all of
which now hold and draw a guide as well. Every symbol added by this change says `piece` instead. The
rename touches 66 references across 13 files and was left out so the change that adds guides stays
reviewable; it is recorded on
[issue 1752](https://github.com/alethical-org/alethical/issues/1752).

## 5. Naming debt to clear with the rename

Two items, both rode with §2.8's rename so the files were swept once. **Both are cleared, 27 Aug
2026**; what each one was, and where it went, is below.

- **"Shelf"** for the `/read` page broke
  [`.claude/rules/workflow.md`](../../.claude/rules/workflow.md) rule 7, which requires literal
  names a newcomer can guess and bans metaphors. It arrived in a design bundle and had spread into
  `MoneyReportsShelfScreen.tsx`, its exported screen and route, 4 code comments, the navigation
  note at `apps/frontend/src/navigation/ia.ts`, and rule 13's own text. Replacement, now shipped:
  **the `/read` page**, named by its address, which is Eugene's standing rule for naming any
  page. The screen is `ReadScreen.tsx`, its route is `Read`, and the word "shelf" appears
  nowhere in the frontend or the API. (The screen and route were `ReadingScreen.tsx` and `Reading`
  for the few hours between that rename and §2.13.)
- **`explainer`** as the internal word for the guide trait, in this repo's issues, design notes and
  any code that reaches for it. Replacement: `guide`, per §2.7. Nothing is built for that trait, so
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
- Whether any published piece ever needs its address moved because its traits changed. §2.8 makes
  the both-traits case detectable at authoring time, so a move after publication is the signal
  that §2.1 chose wrong.
