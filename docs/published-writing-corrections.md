<!-- describes: apps/frontend/src/lib/researchPieces/*.ts, apps/frontend/src/lib/research.ts, docs/reader-guides/*.md -->

# Corrections to Alethical's published writing

**Net:** Every time Alethical changes something it already published, the change is written
down here, with the date, what it used to say, what it says now, and why. If you are holding a
figure or a sentence you took from one of our pieces, this page is where you find out whether
it moved.

This file's address does not change, so it can be cited:
`https://github.com/alethical-org/alethical/blob/main/docs/published-writing-corrections.md`

## Why this exists

When we correct a published piece, the wrong figure comes off the page and the right one takes
its place. That is the right thing for the page: a number a reader must not rely on has no
business still being readable
([`.claude/rules/grounded-answers.md`](../.claude/rules/grounded-answers.md) rule 13, point 7a).

It is the wrong thing for everyone else. Our figures are meant to be quoted — that is the point
of publishing research on public records. The moment one is quoted, a correction has 2 audiences
and the page only serves 1:

- Someone reading our page today, who now sees the right number. Served.
- Someone holding the old number in an article, a slide, a filing or their own notes. Not served
  at all, and the likeliest person to repeat the error in public.

This file is for the second person. Raised as
[issue 1770](https://github.com/alethical-org/alethical/issues/1770).

**Recording that a figure moved is not the same as leaving it standing.** The old wording appears
here, in a list whose whole purpose is to say it is wrong — never on the piece itself, where a
reader could mistake it for something still true. That is the line rule 13 point 7a draws, and
this file stays on the correct side of it.

## What counts as a correction

A change to a piece's own reader-facing words, made after that piece was published, that changes
what a reader takes away: a figure that moved, a claim withdrawn or reversed, a quotation removed,
a date put right, a source attributed correctly, or a link repointed because its target was wrong
or gone.

Three things are not corrections and are deliberately not listed:

- **Material added that corrects nothing** — a new method box, a forward link to a piece that has
  just published, making an address clickable, a figure added so a reader can check a comparison.
  Nothing anyone was holding became wrong.
- **Anything a reader never sees** — code comments, tests, the editorial headers on the drafts in
  [`docs/reader-guides/`](reader-guides/).
- **A design or layout decision applied to a posted piece**, even when it changes what a reader
  sees. Nothing was wrong; the page was changed. Those live with the decision that made them,
  in [`docs/architecture/published-writing-decisions.md`](architecture/published-writing-decisions.md)
  and in rule 13 itself.

The test is whether the piece was **wrong**, not whether it changed.

## About the dated notes

A piece can carry its own dated correction note at the top. The Alethical team decides whether a
given correction gets one, and has directed more than once that it should not
([`.claude/rules/grounded-answers.md`](../.claude/rules/grounded-answers.md) rule 13, point 7a).
The reasoning, from [issue 1798](https://github.com/alethical-org/alethical/issues/1798): a note
tells a reader *something you may have acted on has changed*, and raising that alarm for a change
that cost nobody anything trains readers to ignore the notes that matter.

**A correction with no note on the piece is still listed here.** That is most of what this file is
for. Each entry below says whether the piece carries a note, so the 2 records agree rather than
each telling half the story.

## The corrections

Newest first. Every "was" and "now" is the piece's own wording at that date, not a paraphrase.

An entry says what changed **on its date**. A later entry can change the same sentence again, and
some below do, so the current wording is always the one in the newest entry that touches it — or
on the piece itself, which is the authority.

**8 corrections, from 25 to 31 August 2026**, across 3 of the 6 published pieces, plus the 2 link
repoints in their own section further down. The first piece published on 20 August 2026, so this
covers every correction there has ever been.

---

### 31 August 2026 — 2 pieces — we no longer hold none of the lobbying records

**Pieces:** [The Money Only Goes One Way](https://www.alethical.com/read/research/the-money-only-goes-one-way)
and [Money spent without a campaign's say](https://www.alethical.com/read/guides/money-spent-without-a-campaigns-say)

**Was:** both pieces told readers we hold none of Minnesota's lobbying records. *Money spent
without a campaign's say* said it in bold — "Alethical holds none of these records." — and went on
"The lobbying records are not among them, so anything we say about lobbying is read at the Board
and linked to, never reproduced from our own data. It carries no freshness date from us either,
because we have nothing to keep fresh." *The Money Only Goes One Way* said "The lobbying figures
come from records Alethical does not hold, so they carry no records-through date."

**Now:** "Alethical holds these yearly totals now." Both pieces say we have kept our own dated copy
of the Board's principal spending file since 31 August 2026, that the lobbying figures are
recomputed from records we hold, and that a reader can check them against the Board's own.

**Why:** it was true when the pieces posted and became false on 31 August 2026, when the Board's
yearly principal-expenditure file was loaded as dated snapshots. No money figure moved. The claim
stood in 5 places rather than the 3 first found, because it reads as background rather than as a
figure.

One thing deliberately left standing: the method box that shows the working behind the $886 million
still says what it said, because what it states is the counting a reader would have to repeat, and
cutting it would be an edit on our own initiative, which rule 13 point 2 forbids.

**Note on the pieces:** none, at the team's direction.

**Record:** [PR #1884](https://github.com/alethical-org/alethical/pull/1884),
[issue 1862](https://github.com/alethical-org/alethical/issues/1862)

---

### 28 August 2026 — *The Money Only Goes One Way* — how many counting choices were examined

**Piece:** [The Money Only Goes One Way](https://www.alethical.com/read/research/the-money-only-goes-one-way)

**Was:** the method box explaining the $886 million lobbying figure said "That is **the** choice
that could have moved these figures, and it does not" — naming one, the year boundary.

**Now:** "**Two choices** in that counting could have moved these figures, and neither does." The
box now also says how we decide 2 rows belong to the same organisation, and states the measurement
behind it: no registration number in the file carries 2 filed names and no name carries 2 numbers,
so identifying an organisation by name, by number, or by name with case and spacing normalised
gives the same 3,056 organisations and the same 5 largest, to the cent.

**Why:** the box said how the rows were added up and never said how we decided 2 rows are the same
organisation. The $886 million does not depend on that, because it adds every row whatever the
name — but the count of 3,056 and the 5-name table do, and the table is the part a reader quotes.
So the sentence claimed one counting choice had been examined when there were 2. Raised by 2
independent reviews of the piece.

**Note on the piece:** none.

**Record:** [PR #1839](https://github.com/alethical-org/alethical/pull/1839),
[issue 1802](https://github.com/alethical-org/alethical/issues/1802)

---

### 28 August 2026 — *The Money Only Goes One Way* — a count of records

**Piece:** [The Money Only Goes One Way](https://www.alethical.com/read/research/the-money-only-goes-one-way)

**Was:** the sources block named Minnesota's itemized-contributions download as
"contributions (**583,120** records)".

**Now:** "contributions (**583,152** records)".

**Why:** the file holds 583,152 rows. That is what our own loaded copy carries and what the guide
*What the records name, and what they leave out* had printed since it posted, so 2 live pages were
giving different counts of one file and this one matched neither our data nor the Board's.

**Note on the piece:** none, at the team's direction — a row count describes nobody and moves no
money figure.

**Record:** [PR #1830](https://github.com/alethical-org/alethical/pull/1830)

---

### 28 August 2026 — *What the records name, and what they leave out* — a handbook's revision date

**Piece:** [What the records name, and what they leave out](https://www.alethical.com/read/guides/what-the-records-name)

**Was:** the sources block dated Minnesota's *Political Party Unit Handbook* to **7 March 2022**,
and a sentence in it credited a walkthrough in that handbook as the source of text in the piece.

**Now:** the handbook is dated **22 August 2026**, and the sentence crediting the walkthrough is
gone.

**Why:** Minnesota's Campaign Finance Board replaced that handbook in place, at the same web
address, hours after this piece posted, and the copy it now serves reads "Last Revised 8/22/2026".
This finished a job the previous day's correction left half done: that one cut the 2 quotations
from the body (below) and did not sweep the sources block, so the old date and a credit to deleted
text stayed live for a day.

**Note on the piece:** none. The date is a fact and the sentence sourced nothing, so neither was a
fresh decision.

**Record:** [PR #1807](https://github.com/alethical-org/alethical/pull/1807),
[issue 1798](https://github.com/alethical-org/alethical/issues/1798)

---

### 27 August 2026 — *What the records name, and what they leave out* — 2 quotations removed

**Piece:** [What the records name, and what they leave out](https://www.alethical.com/read/guides/what-the-records-name)

**Was:** "The handbooks are plain about where it goes. Gifts from donors who gave $200 or less in
total 'should be added together and listed as a lump sum'. **The reporting form has a line for
exactly that, reading 'Contributions from donors who each gave $200 or less'. The instruction
underneath it: 'Do not list the donors separately.'**"

**Now:** "The handbooks are plain about where it goes. Gifts from donors who gave $200 or less in
total 'should be added together and listed as a lump sum'." The 2 bolded sentences are gone; the
surviving quotation is still in the handbook the Board serves today.

**Why:** the Board replaced that handbook in place on the day this piece posted, and neither
sentence is in the copy it now serves. Nothing in the piece was untrue when it was written; a
reader clicking our link could no longer find the words we had put in quotation marks. A quotation
mark is a promise the words are there.

**Note on the piece:** yes. The live page carries a banner reading **CORRECTED AUG 27 2026** —
"Two quotations from the Board's Political Party Unit Handbook were removed. The Board replaced
that handbook the day this piece posted, and the served copy no longer contains them."

**One thing here is unresolved, and is recorded rather than tidied away.**
[Issue 1798](https://github.com/alethical-org/alethical/issues/1798) closed on 31 August 2026 with
"Eugene ruled no correction note", and that issue covers this handbook episode — both this
correction and the 28 August one above. The banner is on the page today. So either the ruling
applied only to the 28 August sweep, or the note is still up and should not be. That is the team's
to settle, not the editor's: rule 13 point 2a puts changes to a posted piece with the team.

**Record:** [PR #1801](https://github.com/alethical-org/alethical/pull/1801),
[issue 1798](https://github.com/alethical-org/alethical/issues/1798)

---

### 26 August 2026 — *The Money Only Goes One Way* — what a middle-of-the-road campaign raises

**Piece:** [The Money Only Goes One Way](https://www.alethical.com/read/research/the-money-only-goes-one-way)

**Was:** "The middle-of-the-road candidate for state office raises about **$13,400** for the whole
campaign."

**Now:** "...raises about **$13,000** for the whole campaign."

**Why:** $13,000 is what the data supports. The figure was recomputed and the piece was brought to
the recomputed number.

**Note on the piece:** none, at the team's direction.

**Record:** [PR #1772](https://github.com/alethical-org/alethical/pull/1772),
[issue 1687](https://github.com/alethical-org/alethical/issues/1687)

---

### 26 August 2026 — *The Money Only Goes One Way* — counting accounts as people

**Piece:** [The Money Only Goes One Way](https://www.alethical.com/read/research/the-money-only-goes-one-way)

**Was:** "Over eleven years, all 1,699 candidates for state office combined raised $108 million."
Three lines later, the comparison read "Twice the money of every **candidate** in the state put
together".

**Now:** "Over eleven years, 1,732 campaign accounts for state office took in $108 million between
them. That is accounts rather than people: someone who serves in the House and later runs for the
Senate has 2." The comparison now reads "every **campaign account** in the state put together".

**Why:** the figure counted campaign accounts and called them candidates. They are not the same
thing — someone who serves in the House and later runs for the Senate has 2 accounts — so the
sentence turned a count of accounts into a claim about how many people ran. The count and the word
both changed, and the comparison 3 lines below was changed with them, so the piece could not say
accounts in one place and candidates in another.

**Note on the piece:** none.

**Record:** [PR #1767](https://github.com/alethical-org/alethical/pull/1767)

---

### 25 August 2026 — *The Money Only Goes One Way* — which money the biggest comparison counts

**Piece:** [The Money Only Goes One Way](https://www.alethical.com/read/research/the-money-only-goes-one-way)

**Was:** "Six organizations. Twice the money of every candidate in the state put together."

**Now:** "Six organizations. Twice the money of every candidate in the state put together,
counting only the donations with a name attached. Counting every dollar they each reported taking
in, unnamed donors included, it is about 1.4 times."

The same correction added a caution paragraph naming the $200 rule and the share of legislators'
campaign money that reaches us with no donor named (36.5% in 2024, 41.3% in 2025), and replaced
the sources note, which had called the $200 rule a "disclosure threshold" and now states it
correctly: the test is on a donor's total for the calendar year, never on the size of one gift,
and a committee may name smaller donors as well.

**Why:** the piece's 11-year totals count only the contributions Minnesota requires a donor's name
on, and the piece never said so. Candidates lose a far larger share of their money to that
threshold than the caucuses and state parties do, so comparing the 2 visible totals flattered the
machinery.

**Note on the piece:** none. A note reading **CORRECTED AUG 25 2026** went up with the correction
and was taken down the same day at the team's direction.

**Record:** [PR #1754](https://github.com/alethical-org/alethical/pull/1754),
[PR #1759](https://github.com/alethical-org/alethical/pull/1759),
[issue 1687](https://github.com/alethical-org/alethical/issues/1687)

---

## Links repointed

A link is a correction of a smaller kind: where it points changes, and no figure, sentence or
claim does. Nobody quoting us is holding a wrong number afterwards, so these carry no dated note
on the piece, and 2 pull requests reasoned exactly that way before this file existed. They are
recorded here because someone who followed one of our citations and hit a dead page is owed the
new address, and because "every correction" has to mean every one.

Both entries below share a trap worth naming: the old addresses answered **HTTP 200** while
serving a page reading "This page is not available", so a status-code check passes on them and
nothing looks broken. Each replacement was settled by reading the rendered page.

### 28 August 2026 — *The Money Only Goes One Way* — the lobbying source

The piece's only source for its $886 million lobbying figure pointed at
`cfb.mn.gov/reports-and-data/viewers/lobbying/principal/`, which had stopped serving the data. It
now points at the Board's current-lists tool, where the same data is published as "Historical
spending by principals on lobbying activities", covering 2007 through the report due 16 March
2026. The data was never withdrawn, only moved.
[PR #1808](https://github.com/alethical-org/alethical/pull/1808)

### 28 August 2026 — 2 guides — 3 links to Minnesota's own lookup tools

*Who has to report their money* and *What the records name, and what they leave out* both tell
readers to go and look candidates and committees up on the Board's site. Two of those 3 addresses
had moved: `campaign-finance/candidate/` became `campaign-finance/candidates/`, and
`campaign-finance/committee-fund/` became `campaign-finance/political-committee-fund/`. No link
text changed. The pattern is not singular-to-plural — one address gained an "s", one gained a
word, and the party-unit address was never affected.
[PR #1819](https://github.com/alethical-org/alethical/pull/1819),
[issue 1815](https://github.com/alethical-org/alethical/issues/1815)

## How an entry gets here

A change to a published piece is a change to
`apps/frontend/src/lib/researchPieces/*.ts`, and this file declares those files at the top. So a
pull request that touches a piece and does not touch this file fails CI until its body carries a
`Docs check:` line saying what its author concluded — including "none needed", when the change
corrects nothing. The look is what this forces; see
[`.claude/rules/workflow.md`](../.claude/rules/workflow.md) rule 6.

## What is not here yet

**A page a reader can find.** This file is citable, dated and public, and nobody browsing
alethical.com will ever stumble on it. Making corrections *discoverable* needs a real page with
real design choices, and that half of [issue 1770](https://github.com/alethical-org/alethical/issues/1770)
sits with the money section's design work rather than here.

**A link from each piece's own note back to its entry.** The note and the entry should point at
each other; today only this file points. Adding the reverse link changes reader-facing text on a
posted piece, which
[`.claude/rules/grounded-answers.md`](../.claude/rules/grounded-answers.md) rule 13 point 2a puts
with the Alethical team rather than with whoever is editing.
