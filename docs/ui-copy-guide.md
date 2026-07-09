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
> 2. **"plain English" is on the kill list**, but the decided hero subhead
>    (`docs/grounded-ask-spec.md` §1, Goal) ships "Plain English, every answer linked to its source."
>    Killing the phrase is a real copy change to already-decided text — a founder call, not an
>    automatic swap.
> 3. **"Sovereignty restoration engine, not a civic info tool"** is a larger positioning than the
>    deliberately modest v1 (`docs/v1-scope.md`, Product Definition: "not trying to be a full
>    political accountability platform yet… a reliable legislative data and analysis product").
>    Voice can lead the product, but capability copy still tracks v1.
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
| plain English | clear terms / no jargon |
| translate / translation | make accessible / uncover |
| dashboard | command center |
| Learn More | See What They Voted |
| Get Started | See What They Voted / Start Knowing |
| Sign Up *(marketing CTA)* | Start Knowing |
| Take Back Your Vote | **hold — don't use** |

## CTA hierarchy
| Surface | Primary | Secondary |
|---|---|---|
| Homepage hero | See What They Voted | — |
| App store | Start Knowing | — |
| Social / paid | Start Knowing | — |
| Signed-out nav | See What They Voted | Start Knowing |
| Signed-in UI | action-specific | — |

## Exception: sign-in buttons
Functional auth controls (**Sign In / Log In**) keep plain functional labels. The sovereignty/promise rewrite does **not** apply to authentication buttons — only to marketing and acquisition CTAs.

## Signed-in state
"This is yours. This transparency serves you." Use *command center*, possessive agency framing (Your representatives, Your district, Your vote record). Data feels like access granted, not info retrieved.

## Test for any copy
Does this deliver a sovereignty recognition moment, or is it just a label? If just a label, rewrite.

**Never say:** plain English · translate · dashboard · Sign Up (as marketing CTA).
