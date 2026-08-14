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

- **Arrival-neutral, not softened:** "If a confirmation email arrives, open the newest one." — never "we've sent one" or "one is on the way". The trigger case was measured, not hypothetical: the sign-in service reports success without sending anything when a confirmed address asks for another confirmation email.
- The rule covers claims about **server state** too: a failure screen may not say "your account has not changed" when a lost reply can leave a changed account behind it, and no reset screen says other devices are "already signed out" when their access passes can outlive the change.
- Silence is permitted; a dead end is not. Declining to say what happened never excuses leaving nothing to press.

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
- **Apostrophes — curly `’` (U+2019), never the straight typewriter `'`.** e.g. don’t, they’ve, Minnesota’s.
- **Quotation marks — curly `“ ”` (U+201C / U+201D), never straight `"`.** Applies to quoted bill/statute language, pull-quotes, etc.
- **Ellipsis — the single glyph `…` (U+2026), never three periods `...`** — for genuine omission inside a quotation and for loading/progress states ("Loading…"). **Do *not* trail input-field placeholders with `…`** — a placeholder states its prompt plainly (e.g. "Ask about bills or legislators by issue or name"). This deliberately overrides the generic "placeholders end with …" web guideline.
- **Dashes — em dash `—` for a break in thought**, matching existing copy's spacing.

Displayed strings only. **Code — identifiers, comments, JSON keys, test fixtures — keeps straight ASCII punctuation.** This is `docs/design/design-principles.md` §2 (typography) at the character level; the `design-audit` review checks it on shipped screens.
