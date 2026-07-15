> **Status — stored Jul 9, 2026. Proposed voice/tone guide, not yet reconciled with shipped copy.**
> This is the acquisition/product voice direction. It governs *how* copy sounds; it does **not**
> override *what* copy may claim. Where this guide and the grounded-answer invariants
> (`.claude/rules/grounded-answers.md`) conflict, the invariants win — a copy line must be true
> before it can be on-voice.
>
> **Unreconciled conflicts to resolve before applying broadly:**
> 1. **"See What They Voted" as the primary hero / signed-out nav CTA** collides with v1 scope.
>    Per-legislator, vote-by-vote answers are **v1-deflected** (`docs/grounded-ask-spec.md` §4.5,
>    Vote deflection) and member-level roll-call rendering is **v1.1** ([#83](https://github.com/alethical-org/alethical/issues/83)).
>    What v1 actually ships is tallies + official-record links on a bill's Votes tab. A dominant
>    "See What They Voted" CTA promises a per-legislator voting-record experience the v1 product
>    does not deliver — grounded-answers rules 2 (never advertise what you can't answer) and 6
>    (copy claims match shipped capability). Usable only where it resolves to the Votes tab.
> 2. **"Sovereignty restoration engine, not a civic info tool"** is a larger positioning than the
>    deliberately modest v1 (`docs/v1-scope.md`, Product Definition: "not trying to be a full
>    political accountability platform yet… a reliable legislative data and analysis product").
>    Voice can lead the product, but capability copy still tracks v1.
>
> **Resolved:** "plain English" / "plain language" is **accepted** (Jul 9, 2026) — it matches the
> decided hero subhead (`docs/grounded-ask-spec.md` §1, Goal) and is no longer a kill-list entry.
> The **"Grounded Ask"** (feature / badge) / **"Ask"** (action verb, rendered **"✦ Ask"** in nav)
> naming — and the kill of **"Ask AI"** — is **accepted** (Jul 12, 2026), ratified by the v2 home
> design (Search → Bills "Grounded Ask" badge) and Eugene's decision. Reverses the interim "Ask AI"
> wording in the earlier O10 record (`docs/mvp-redesign-plan.md`, now corrected).
>
> Terminology invariants that also bind this guide: author / co-author, never sponsor / co-sponsor,
> in user-facing copy (`.claude/rules/grounded-answers.md` rule 3); "issue," not "topic," as the
> layperson entry word.

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

## Exception: sign-in buttons
Functional auth controls (**Sign In / Log In**) keep plain functional labels. The sovereignty/promise rewrite does **not** apply to authentication buttons — only to marketing and acquisition CTAs.

## Signed-in state
"This is yours. This transparency serves you." Use *command center*, possessive agency framing (Your representatives, Your district, Your vote record). Data feels like access granted, not info retrieved.

## Test for any copy
Does this deliver a sovereignty recognition moment, or is it just a label? If just a label, rewrite.

**Never say:** translate · dashboard · Sign Up (as marketing CTA) · Ask AI (use Grounded Ask / Ask).

## Punctuation & typography
Use typographer's punctuation in all user-facing copy. It is the quality-publishing default, and for a truth-and-records product the polish quietly reinforces credibility (ratified 2026-07-13).
- **Apostrophes — curly `’` (U+2019), never the straight typewriter `'`.** e.g. don’t, they’ve, Minnesota’s.
- **Quotation marks — curly `“ ”` (U+201C / U+201D), never straight `"`.** Applies to quoted bill/statute language, pull-quotes, etc.
- **Ellipsis — the single glyph `…` (U+2026), never three periods `...`** — for genuine omission inside a quotation and for loading/progress states ("Loading…"). **Do *not* trail input-field placeholders with `…`** — a placeholder states its prompt plainly (e.g. "Ask about bills or legislators by issue or name"). This deliberately overrides the generic "placeholders end with …" web guideline.
- **Dashes — em dash `—` for a break in thought**, matching existing copy's spacing.

Displayed strings only. **Code — identifiers, comments, JSON keys, test fixtures — keeps straight ASCII punctuation.** This is `docs/design-principles.md` §2 (typography) at the character level; the `design-audit` review checks it on shipped screens.
