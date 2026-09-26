# Alethical UI Copy Guide: Sovereignty Restoration

**Positioning:** A sovereignty restoration engine, not a civic info tool. The product delivers the moment a citizen recognizes the government was always theirs to read.

**Core hero line:** "We hold these truths to be self-evident. Alethical makes them accessible."
**Anchor:** TRUTH, UNCONCEALED.

## Word swaps
| Kill | Suggested examples |
|---|---|
| translate / translation | make accessible / uncover |
| dashboard | command center |
| Learn More | See What They Voted |
| Get Started | See What They Voted / Start Knowing |
| Sign Up *(marketing CTA)* | Start Knowing |
| Ask AI | Grounded Ask *(feature name)* / Ask *(action verb)* |
| Take Back Your Vote | **hold — don't use** |

## CTA hierarchy
**"Acquisition CTA"** = a call-to-action whose job is **user acquisition** — turning a first-time visitor into a signed-up, active user. These are the surfaces in the table below (homepage hero, app store, social / paid, signed-out nav). They are distinct from **functional controls** (auth buttons — see the Exception below — and in-product action buttons) and from **signed-in, action-specific CTAs**, which keep plain functional labels. Only acquisition CTAs get the sovereignty/promise rewrite.

| Surface | Primary | Secondary |
|---|---|---|
| Homepage hero | See What They Voted | — |
| App store | Start Knowing | — |
| Social / paid | Start Knowing | — |
| Signed-out nav | See What They Voted | Start Knowing |
| Signed-in UI | action-specific | — |

## Feature naming: the AI answer feature
One name, everywhere. **"Grounded Ask"** is the *feature name* (the Search-menu badge, About/docs); **"Ask"** is the *action verb* (the hero submit button and contextual question actions). **Never "Ask AI"** — it reads generic/hype and undercuts the grounded, cite-or-refuse differentiator that is the whole point. The global menu is Ask-free on every page; the ✦ sparkle may still carry the AI affordance inside an Ask surface.

**One scoped exception (Eugene, 2026-08-04):** the nav's greyed **"ON THE ROADMAP"** group carries an inert **"Ask AI"** pill for the not-yet-built free-form (open-ended) ask capability. This exception is deliberate and narrow — it applies *only* to that non-committal roadmap chip, which makes no live capability claim. The ban above still governs all shipped/live copy: nothing users can actually *use* is ever labeled "Ask AI." Item `search-ask-ai` in `apps/frontend/src/navigation/ia.ts`.

## Exception: sign-in buttons
Functional auth controls (**Sign In / Log In**) keep plain functional labels. The sovereignty/promise rewrite does **not** apply to authentication buttons — only to marketing and acquisition CTAs.

## Signed-in state
"This is yours. This transparency serves you." Use *command center*, possessive agency framing (Your representatives, Your district, Your vote record). Data feels like access granted, not info retrieved.

## A screen claims only what it directly knows
Ratified with the rev 17 sign-in redesign ([#1533](https://github.com/alethical-org/alethical/issues/1533)). A screen may state what it did itself; anything **another system** does — email delivery above all — uses conditional or arrival-neutral wording, because the screen cannot see it happen.

- **No delivery claim:** an accepted request opens **Enter your code** and says **Enter the newest code**. Never say **sent**, **delivered**, **on the way**, **check your email**, or **if an email arrives**. The screen cannot see the inbox.
- The rule covers claims about **server state** too: a failure screen may not say "your account has not changed" when a lost reply can leave a changed account behind it, and no reset screen says other devices are "already signed out" when their access passes can outlive the change.
- Silence is permitted; a dead end is not. Declining to say what happened never excuses leaving nothing to press.

## Labels, sentences and source links on a records card
Ratified 11 Sep 2026 from the 6 changes to the campaign-money card (labels, the removed "Payments we can list" figure, the removed Miscellaneous row, and the source link). Each is a standing rule, not a money-page rule.

- **Use the source's term consistently, then explain it in plain words.** Use the same source term whenever naming the same reported quantity or category, including in supporting copy. A reader who opens the state's own site should find the same term. Explain an unfamiliar term rather than switching its name: contributions are donations, and receipts can also include loans and other money that is not a contribution. The limit is meaning: the source's term wins only where it means to a reader what it means to the source. "Miscellaneous" fails that test and is not printed; "Contribution" on the money-out file means a transfer, so that row stays "Given to other campaigns".
- **Campaign money uses “itemized contributions” and “non-itemized contributions” everywhere.** These are the category names in headings, labels, supporting copy and text read aloud by screen readers. Do not rename them “named donations” or “unnamed donations”. Explain what each means in plain words while keeping its source name. When no official contribution total is available, the donor heading is **Who gave (itemized contributions only)**. Receipts can include money that is not a contribution, so keep “receipts” where the records include those other types.
- **A label never encodes a rule.** "Individual donors over $200" carried 3 facts in 4 words and got all 3 wrong (donors are not only individuals, the threshold is a yearly total not a gift size, and it is a floor not a bar). Anything with an "if", a threshold or a condition goes in a sentence; the label names only the thing.
- **A rule is printed once on a card, under the figure it explains.** The donor-naming rule sits under Itemized contributions; the Non-itemized line beneath says only what it is. Two figures on one card never each carry the same rule.
- **A summary card shows figures a reader can check against the source in 1 step.** A figure of our own that needs a paragraph to be read safely belongs on the page that lists its rows, not on the card. The card prints what the source states.
- **A source link's label describes what opens, and the destination is clicked in a real browser before it ships.** "Minnesota's list of named donations" opened a 9 MB statewide file with no page behind it. A link to a bulk file points at the page that file lives on and says so; a page address is derived from the served download address, never pasted, so a changed file id cannot break it.
- **A copy change made without a design round still updates Design's copy record the same day.** Otherwise the next drawing prints the old words and the review loop reopens. The mechanism is a note to Design listing every old → new string, sent with the change.

## Context labels below a back link

The green all-caps label below a back link gives context the title and nearby
words do not already give. It may identify the larger section, the kind of record
or the coverage of a list. Omit it when it only repeats the page title, the back
link or a complete title that already names both sides of a relationship.

## Avoid redundant nearby text

State a fact once within a connected group when the reader can still understand it
without repetition. Chart labels, values and a shared period line should not be
transcribed again in a paragraph immediately below the chart. Supporting text should
add meaning or necessary context, not restate the display. Keep repetition only when
removing it would lose meaning, a necessary qualification or access to the information.

For example, the comparison chart labels “Sum of 2 matching download entries” and
“Amount of the matching entry in each filing” already identify their values. Do not
repeat both labels, values and the shared filing period underneath. Keep evidence,
limits and any useful explanation that the chart itself does not convey. Keep chart
information available as text to readers, search engines and screen readers without
requiring a second visible transcript or duplicate spoken values.

### Remove implied information from text and visuals

Simplify text and visuals together. Remove a label, number, line or explanation
when nearby words, values or the visual structure already make its meaning clear
and removing it loses no needed information. Do not keep a mark merely because
charts conventionally include it.

Check the entire connected group before adding shared context. Units, currencies,
periods, scope and labels belong where they make the values unambiguous, not in
both a shared heading and every value. When every displayed amount includes its
currency, omit that currency from the chart's heading. When a table column heading
supplies the unit, do not repeat it above the table. Retain shared units where
individual values otherwise lack them, and retain each distinct unit in a mixed-unit
comparison. This applies to visual and screen-reader text: remove the redundant
copy, not the reader's ability to identify what each number measures.

Review each heading, legend, value label and caption together: what information
does this element add that its neighbors do not already supply? Keep repetition
only when separation or ambiguity makes it necessary. For example, a comparison
showing “1,000 USD” and “500 USD” has a period line reading “Cited filings
(2023-01-01 through 2023-12-20)”, without a second “USD”.

For directly labelled comparison bars with a shared starting point, omit the
isolated “0” and its horizontal axis line. The bars must still use the same scale
and start mathematically at zero; removing the decoration must never truncate or
change their lengths. Keep both amounts and their labels visible and accessible.
This does not remove a zero that is a measured value, a needed scale label on a
more complex chart, a meaningful boundary or a necessary qualification.

Approved by Eugene on 26 September 2026 and applied to the private first-post
comparison chart. Review all post drafts for implied text and visual clutter;
this rule does not authorize unrelated redesigns.

### Draft every post for meaning, without repeated explanations

Apply this when drafting or revising every type of website post, including Short
posts, Research, Guides and blog articles. Each sentence should add a fact, useful
explanation, necessary qualification or a clear next action.

- Remove subtitles that only rephrase the title, and introductory sentences that
  merely announce the evidence or explanation that follows. A subtitle is optional.
- Keep names and the finding in the opening. Put registration numbers, query filters,
  matching columns and other reproduction details in the method, unless readers
  need them to distinguish the people or records being discussed.
- State the conclusion and each scope limit once in the relevant connected group.
  Do not repeat them across the chart caption, the following paragraph, the method
  and the sources. Keep a qualification beside any claim that would mislead without it.
- Name dates by what they mean: receipt date, reporting period, filing receipt date
  or download date. Group source dates where useful; do not repeat the complete set
  throughout the article. A standalone chart still needs its own clear scope.
- Prefer precise positive wording, such as naming the dated source copy, over an
  extra sentence ruling out every other source version. Do not turn that into a
  broader claim or erase real uncertainty.
- Preserve citations, reproducible methods, required disclosures and distinctions
  between reported records and independently established events. Put detailed
  reproduction steps behind Full method when the essential explanation is enough.
- In a short article with one clearly named source list, keep the source links
  together there instead of repeating them in the paragraphs and in a chart link
  that only jumps to that same list. Keep source scope and necessary qualifications
  beside the figures. Retain direct chart citations when needed to identify a
  different source or when the chart is presented on its own.
- Review title, subtitle, body, charts, methods, sources and disclosures together.
  Do not add duplicate visible or spoken text for SEO or accessibility. Preserve
  unique information and accessible chart labels when cutting a transcript.

Approved by Eugene on 26 September 2026, including implementation in the private
“2 records do not always mean 2 donations” draft. Publication awaits his final review.

### Make the answer easy to find

For a post that answers a question or establishes a finding, make the supported
answer easy to spot. Do not bury it in small source text or a block of caveats.
Use **Conclusion:** followed by the answer in bold when that identifies the answer
more clearly. Do not force a conclusion onto a guide that only explains steps, or
present an unresolved claim as settled to fill the slot.

Keep a short qualification in regular text directly after the bold answer in the
same paragraph when it qualifies that answer. Avoid a new paragraph and extra gap
for a sentence that naturally continues the thought. Keep sentence punctuation
throughout this combined paragraph; changing from bold to regular text does not
start a separate punctuation unit. For example:

**Conclusion: The filings support 1 reported $500 contribution appearing in repeated
records.** The 2 download entries do not establish 2 separate donations.

State the answer once. Improve its placement and emphasis instead of adding a
second summary to make readers notice it. Keep its evidence and limits reachable.

### Keep meaningful uncertainty, remove obvious caveats

Explain a limitation when omitting it could change the reader's understanding of
the finding: incomplete coverage, unresolved duplicates, uncertain identity,
different reporting periods or an unsupported total. Put it beside the affected
claim. Do not append a generic disclaimer merely because the subject is money or
politics, or list every inference the records cannot establish.

Precise wording can carry the boundary itself. “The filings support” and “reported”
already say the finding concerns public records. When that is clear, omit a second
sentence saying the comparison does not independently confirm money changing hands.
Likewise, do not routinely tell readers that a contribution alone establishes no
motive, influence or wrongdoing. Describe the supported records without directing
the reader's personal conclusions. If the article's own wording implies a claim
the evidence cannot support, correct that wording rather than adding boilerplate.

This does not remove the approved AI-use disclosure, specific material gaps,
required legal notices or source citations. It does not permit unsupported claims
of motive, causation or wrongdoing. A generic caveat cannot make a false claim safe.
This replaces the automatic generic contribution-note requirement for new drafts;
it does not request edits to already published articles.

### Standard closing note for every post type

Use 1 closing note after sources in new or revised Short posts, Research, Guides
and blog articles. Replace older AI boilerplate rather than stacking disclosures.
When AI helped prepare the article, use this approved wording:

> AI helped prepare this article and can make mistakes. We report what the cited
> public sources support and identify known gaps and uncertainty. [Contact us](/about/contact)
> to report a possible error so we can review it and make corrections.

Omit the first sentence when AI did not help prepare the article. Establish that
from the article's preparation record, not its format or author name. Keep the
remaining source-and-correction wording and the working `/about/contact` link.
Use normal paragraph punctuation. Keep specific gaps beside the affected claims.
The note does not certify a completed review or promise that the records are
complete. It can be shown in a private draft; publication still needs the usual
source checks, human review and explicit instruction. Do not send a contact message
as a test. This approval does not request a bulk edit of previously published posts.

Approved by Eugene on 26 September 2026, replacing the older closing-note wording.

### Keep private-review status separate from article copy

In a private article preview, the yellow top banner says **PRIVATE DRAFT**, once.
Do not repeat draft, preview, unpublished or review-pending explanations in the
title, date row, chart, footer or disabled Share label. Keep normal control labels
and enforce the actual private state separately. Minimal wording does not enable
sharing, public navigation, indexing or publication. Do not display a completed
review claim while that review is still pending.

### Review the whole draft before presenting it

Read the title, opening, chart, conclusion, method, sources and disclosures as one
article. Can a newcomer find the answer, tell what each number measures and reach
its evidence? Remove repeated or implied copy, retain any limit that changes the
meaning, and check punctuation after joining or separating text. Inspect real
wrapping and chart-label space on narrow and wide screens using
[design-principles.md](design-principles.md#post-chart-readability-and-conclusions).
Do this before Eugene's review, not one correction at a time afterward.

These additions capture Eugene's first-post corrections on 26 September 2026 for
future drafts of every post type. They do not authorize publication or a redesign
of unrelated surfaces.

## Test for any copy
Does this deliver a sovereignty recognition moment, or is it just a label? If just a label, rewrite.

**Never say:** translate · dashboard · Sign Up (as marketing CTA) · Ask AI (use Grounded Ask / Ask — except the one scoped roadmap-chip exception noted under Feature naming).

## Dates on a page
**One date per page** (ratified 2026-07-31). A record-detail or one-bill answer page shows it once at the foot, in the standard line — `Source: Minnesota Legislature · revisor.mn.gov · Updated {date}` — built by the shared `billSourceText` (`apps/frontend/src/components/billDetail/SourceLine.tsx`). Search result pages and the issue-scope answer put their corpus date in the results header instead; their source line, when present, names the sources without repeating the date.

- **Never date generated prose as though it were fresh.** A one-bill answer uses that bill's own pull date, never the moment the answer was written. The issue-scope answer is a matched-record list rather than generated prose, so its Search-style count uses the served corpus date (`data_as_of`).
- **Never print the same date twice.** A header "as of {date}" above a footer "Updated {date}" is the pattern this rule exists to stop — it reads as two different facts and is one.
- **Take the value from the record, not from the ingestion run.** The corpus-wide "last successful ingestion" timestamp (the API's `data_as_of`) covers the whole corpus, so stamping one bill's page with it can post-date that bill's own record. Measured Jul 31 2026: it would have claimed Jul 30 for 10,414 bills last pulled Jul 14 or 15.
- **On a bill page the value is `last_pulled_at`** — when we last pulled that bill from the Legislature — served per bill and turned into the label by the one shared helper `pulledLabel` (`apps/frontend/src/lib/billDetail.ts`). Do **not** build it from `bill.updatedAt`: that is the Legislature's last action on the bill, a real fact the meta rows already state as "Latest action", and labelling it "Updated" claimed something about our copy that it never measured (fixed in [#861](https://github.com/alethical-org/alethical/issues/861)). The honest reading of the served value is "when we last processed this bill" — ingestion skips bills it has already seen unless told otherwise, so a bill nobody re-pulled keeps an older date.
- **No date at all beats a wrong one.** When a bill carries no pull date, `pulledLabel` returns empty and `billSourceText` drops the segment rather than substituting a date that means something else.
- Search Bills, Search Legislators and the issue-scope answer carry their single corpus-wide date in the results header. A one-bill page still uses that bill's own pull date in its source line.

## Punctuation & typography
Use typographer's punctuation in all user-facing copy. It is the quality-publishing default, and for a truth-and-records product the polish quietly reinforces credibility (ratified 2026-07-13).
- **Standalone interface units omit the final period.** A caption, helper, source line, status, success message, field error, list item or 1-step instruction containing 1 sentence ends after its last word. It is still 1 unit when it wraps onto several screen lines. Separate units do not become a paragraph merely because they share a card or container. A link and the sentence tail beside it form 1 unit. Keep full punctuation in paragraphs containing 2 or more sentences, legal text and serious warnings.
- **Article prose and supporting information have different punctuation.** Keep
  normal punctuation in editorial article paragraphs, including a 1-sentence
  paragraph. Outside that prose, a standalone 1-sentence information line,
  explanation, method summary, source-scope limit or informational disclosure has
  no final period. Count sentences, not the number of screen lines: wrapping does
  not change the rule. Keep punctuation in supporting text with 2 or more
  sentences and within quoted source text. Author the intended wording directly;
  do not blindly strip punctuation from arbitrary content at display time.
  Approved by Eugene on 26 September 2026. For example:
  “This example does not establish corrected totals for Carlson or all lobbyists”
  ends without a period. This applies to drafting every post type.
- **Apostrophes — curly `’` (U+2019), never the straight typewriter `'`.** e.g. don’t, they’ve, Minnesota’s.
- **Quotation marks — curly `“ ”` (U+201C / U+201D), never straight `"`.** Applies to quoted bill/statute language, pull-quotes, etc.
- **Ellipsis — the single glyph `…` (U+2026), never three periods `...`** — for genuine omission inside a quotation and for loading/progress states ("Loading…"). **Do *not* trail input-field placeholders with `…`** — a placeholder states its prompt plainly (e.g. "Ask about bills or legislators by issue or name"). This deliberately overrides the generic "placeholders end with …" web guideline.
- **Dashes — em dash `—` for a break in thought**, matching existing copy's spacing.

Displayed strings only. **Code — identifiers, comments, JSON keys, test fixtures — keeps straight ASCII punctuation.** This is `docs/design/design-principles.md` §2 (typography) at the character level; the `design-audit` review checks it on shipped screens.
