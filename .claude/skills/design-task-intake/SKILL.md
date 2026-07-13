---
name: design-task-intake
description: Use at the very START of any Alethical frontend/design task — a build/change from a mockup OR a bug report ("the hover doesn't work", "the card looks off") — before building or debugging, especially when the prompt is terse. Proofs the prompt for missing high-value context and needed assets: self-answers what the repo already reveals, then asks the user only the genuine gaps (batched, with defaults), and skips itself when the prompt is already complete. Hands off to implementing-design-handoffs (builds) or systematic-debugging (bugs).
---

# Design-task intake

## Purpose

A terse design prompt ("the dropdown hover doesn't work") is usually *answerable* but not *complete* — the missing pieces surface mid-task and cost time. This runs a ~60-second completeness check first: resolve what the repo already tells you, surface the few genuine gaps, confirm which assets (if any) are actually needed — so the build/fix is fast and right the first time.

## The gate — don't add friction to a good prompt

Interview **only** for gaps that change *what you do* or *how fast*. If you can already state the **scope**, the **expected vs. actual** (bug) or the **target state + acceptance** (change), and you know **where the spec/assets are**, skip the questions, restate the task in one line, and proceed. Interrogating for things the repo answers — or for low-stakes details — is the anti-goal. Most prompts pass the gate; the interview is the exception, not the toll booth.

One gate, once: for design tasks this skill **is** the intake/brainstorming step — don't stack a generic start-of-task gate (e.g. `superpowers:brainstorming`) on top of it. Run this, then hand off.

## 1. Self-answer from the repo first (never ask what you can check)

- Is the page's design bundle already in `docs/mockups/<page>/`? It usually is — you rarely need assets re-handed.
- Is this a **regression**? `git log` / blame the component or area; a recent change often *is* the cause.
- Which screen / route / component owns it? (`navigation/ia.ts`, `navigation/webRoutes.ts`, the screen file, `theme/primitives.tsx`.)
- What's the current behavior? Run it (`just up`) or read the code. For a bug, a repro beats a mockup.

## 2. Classify, then check the right list for *genuine* gaps

**Bug ("X doesn't work"):**
- Scope: which surfaces, and desktop / mobile-web / both?
- **Does the sibling interaction also fail?** Hover *and* click/focus both dead on an element that clearly renders ⇒ pointer interception / stacking, not styling. Single most useful tell (it's what the nav-dropdown bug, #171, turned out to be).
- Expected vs. actual, and a repro path (which URL / state).
- Environment: localhost, Vercel preview, or prod — and is it new or a regression (since when)?

**Build / change (from a mockup):**
- Which **state(s)** change — and is the spec/screenshot for *that state* available? Ask for the specific state, not the whole bundle.
- Copy / naming / grounded-answers invariants touched? (`docs/ui-copy-guide.md`, `.claude/rules/grounded-answers.md`.)
- Any data/backend dependency, and the interim behavior if it isn't built yet?
- Acceptance criteria (what "done" looks like) and any held/deferred items.

## 3. Ask only the gaps — batched, with defaults

Put the genuine unknowns to the user in one `AskUserQuestion` call (≤ 4 questions, each with a recommended default so it's one click). Never ask what step 1 already answered. If nothing material is missing, say "prompt is complete — proceeding" and move on.

## 4. Restate, then hand off

State the sharpened task in one line — scope · deliverable · acceptance · assets needed (usually none; they're in-repo) — then continue with `implementing-design-handoffs` (build/change) or `superpowers:systematic-debugging` (bug).

## Anti-patterns

Interrogating for repo-discoverable facts · asking low-value questions · gating an already-complete prompt behind an interview · requesting the whole design bundle when one state's screenshot/spec section suffices · skipping straight to code on a genuinely ambiguous prompt.

## References

`.claude/skills/implementing-design-handoffs/SKILL.md` (the build workflow this feeds) · `.claude/rules/coding-discipline.md` rule 1 (surface real ambiguity; don't gate routine work) · `docs/mvp-redesign-plan.md`. Origin: retro on the nav-dropdown hover fix ([#171](https://github.com/alethical-org/alethical/pull/171)).
