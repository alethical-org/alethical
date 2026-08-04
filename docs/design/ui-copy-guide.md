# Alethical UI Copy Guide: Sovereignty Restoration

**Positioning:** A sovereignty restoration engine, not a civic info tool. The product delivers the moment a citizen recognizes the government was always theirs to read. *The awakening is the product.*

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
One name, everywhere. **"Grounded Ask"** is the *feature name* (the Search-menu badge, About/docs); **"Ask"** is the *action verb* (the hero submit button, the global nav Ask CTA — e.g. `✦ Ask`). **Never "Ask AI"** — it reads generic/hype and undercuts the grounded, cite-or-refuse differentiator that is the whole point. The ✦ sparkle carries the AI affordance; the words carry the promise.

**One scoped exception (Eugene, 2026-08-04):** the nav's greyed **"ON THE ROADMAP"** group carries an inert **"Ask AI"** pill for the not-yet-built free-form (open-ended) ask capability. This exception is deliberate and narrow — it applies *only* to that non-committal roadmap chip, which makes no live capability claim. The ban above still governs all shipped/live copy: nothing users can actually *use* is ever labeled "Ask AI." Item `search-ask-ai` in `apps/frontend/src/navigation/ia.ts`.

## Exception: sign-in buttons
Functional auth controls (**Sign In / Log In**) keep plain functional labels. The sovereignty/promise rewrite does **not** apply to authentication buttons — only to marketing and acquisition CTAs.

## Signed-in state
"This is yours. This transparency serves you." Use *command center*, possessive agency framing (Your representatives, Your district, Your vote record). Data feels like access granted, not info retrieved.

## Test for any copy
Does this deliver a sovereignty recognition moment, or is it just a label? If just a label, rewrite.

**Never say:** translate · dashboard · Sign Up (as marketing CTA) · Ask AI (use Grounded Ask / Ask — except the one scoped roadmap-chip exception noted under Feature naming).

## Dates on a page
**One date per page, and it lives in the source line** (ratified 2026-07-31). Every screen that shows how current its records are shows it exactly once, at the foot, in the standard line — `Source: Minnesota Legislature · revisor.mn.gov · Updated {date}` — built by the shared `billSourceText` (`apps/frontend/src/components/billDetail/SourceLine.tsx`). **No page-specific exception.**

- **Never date the page's own output.** On a generated-answer page the date belongs to the *record the answer came from*, never to the moment the answer was written: an answer can never be fresher than the bill it was generated from, so an "as of" stamp later than the record's own date is a false claim of currency (`.claude/rules/grounded-answers.md` rule 7).
- **Never print the same date twice.** A header "AS OF {date}" above a footer "Updated {date}" is the pattern this rule exists to stop — it reads as two different facts and is one.
- **Take the value from the record, not from the ingestion run.** The corpus-wide "last successful ingestion" timestamp (the API's `data_as_of`) covers the whole corpus, so stamping one bill's page with it can post-date that bill's own record. Measured Jul 31 2026: it would have claimed Jul 30 for 10,414 bills last pulled Jul 14 or 15.
- **On a bill page the value is `last_pulled_at`** — when we last pulled that bill from the Legislature — served per bill and turned into the label by the one shared helper `pulledLabel` (`apps/frontend/src/lib/billDetail.ts`). Do **not** build it from `bill.updatedAt`: that is the Legislature's last action on the bill, a real fact the meta rows already state as "Latest action", and labelling it "Updated" claimed something about our copy that it never measured (fixed in [#861](https://github.com/alethical-org/alethical/issues/861)). The honest reading of the served value is "when we last processed this bill" — ingestion skips bills it has already seen unless told otherwise, so a bill nobody re-pulled keeps an older date.
- **No date at all beats a wrong one.** When a bill carries no pull date, `pulledLabel` returns empty and `billSourceText` drops the segment rather than substituting a date that means something else.
- Still open: Search Bills and Search Legislators carry their single date in the results header rather than a source line, and it is the corpus-wide value. Tracked on [#861](https://github.com/alethical-org/alethical/issues/861); an inconsistency to fix, not an allowed exception.

## Punctuation & typography
Use typographer's punctuation in all user-facing copy. It is the quality-publishing default, and for a truth-and-records product the polish quietly reinforces credibility (ratified 2026-07-13).
- **Apostrophes — curly `’` (U+2019), never the straight typewriter `'`.** e.g. don’t, they’ve, Minnesota’s.
- **Quotation marks — curly `“ ”` (U+201C / U+201D), never straight `"`.** Applies to quoted bill/statute language, pull-quotes, etc.
- **Ellipsis — the single glyph `…` (U+2026), never three periods `...`** — for genuine omission inside a quotation and for loading/progress states ("Loading…"). **Do *not* trail input-field placeholders with `…`** — a placeholder states its prompt plainly (e.g. "Ask about bills or legislators by issue or name"). This deliberately overrides the generic "placeholders end with …" web guideline.
- **Dashes — em dash `—` for a break in thought**, matching existing copy's spacing.

Displayed strings only. **Code — identifiers, comments, JSON keys, test fixtures — keeps straight ASCII punctuation.** This is `docs/design/design-principles.md` §2 (typography) at the character level; the `design-audit` review checks it on shipped screens.
