---
name: design-review
description: Use when a draft (not-yet-final) Claude Design mockup + bundle arrives and needs evaluating against Alethical's real data, backend capability, and UX before anyone builds it. Pressure-tests every element for buildability + honesty (grounded-answers), applies the design-audit accessibility/interaction rubric to everything a static design can reveal, and returns prioritized improvement feedback — output as a definitive Claude-Design prompt plus a decision list. Pre-build. First in the design- skill set: design-review → design-intake → design-build → design-audit.
---

# Design review

## Purpose

A Claude Design mockup is drawn without visibility into our database, backend, or roadmap — so it can confidently show elements we can't back, claims our data can't honor, or accessibility problems that are cheaper to fix now than after a build. This is the **shift-left gate**: surface every issue a still image + our data can prove *before* a line of code, and hand back exact change requests. It is the one design phase only Claude Code can run, because it depends on the repo, the corpus, and the milestones.

This produces **feedback**, not code. It does **not** implement, edit the mockup, or send anything to Claude Design — the maintainer relays the prompt and drives the design iteration.

## When to use

- A draft mockup / bundle / screenshots arrive for a page that isn't finalized yet.
- You're iterating with Claude Design toward a final design and need grounded feedback.

Not for: a **finalized** design ready to build (→ `design-build`), proofing a build/bug request (→ `design-intake`), or auditing an already-built screen (→ `design-audit`).

## The three questions this pass answers

1. **Buildable** — does every element map to data we've ingested (and keep fresh) and a shipped or scoped capability?
2. **Honest** — does anything violate `.claude/rules/grounded-answers.md` (advertises what we can't answer, a claim copy can't back, records-vs-generated blur, non-URL-addressable link)?
3. **Better** — prioritized improvement recommendations (below), not just pass/fail.

## Procedure

**0. Frame it.** Identify the page, the preview-band state(s) shown (reference frames only by Claude Design's own band labels — never invented names, per the `claude-design-prompt-rules` memory), its place in the IA and `docs/mvp-redesign-plan.md`, and pull the governing spec (`docs/v1-scope.md`, `docs/grounded-ask-spec.md`, the relevant issues/milestone). State in one line what this screen is and is for.

**1. Ground every element.** Walk *each discrete element* — every field, chip, badge, count, filter, card, CTA, empty state, suggested question — and tag it:
- ✅ **backed today** (cite the source: bill field, API, spec §, issue)
- 🟡 **scoped but not built** (name the interim behavior the plan specifies)
- 🔴 **can't honor** (no data / no capability / out of scope)
- ⚠️ **grounded-answers violation** (cite the rule)

Verify data claims against what's **ingested and fresh**, not what's theoretically possible. No verdict from memory — check the field/API/issue.

**2. Apply the `design-audit` rubric statically.** Run the accessibility + interaction rubric (the `design-audit` skill's pinned Web Interface Guidelines + WCAG snapshot) against everything a static design reveals — see the split below. Flag what the still image can prove; note the few checks that must wait for the live build so they carry into `design-build`'s verify step.

**3. Improvement pass — prioritized.** In this order (data/capability is our moat, so it leads):
1. **Grounding & trust signals** — does the design *reinforce* the cite-everything / neutrality value prop?
2. **Data/capability leverage** — not just "can we back it?" but "are we *underusing* data we already hold?" Constraints **and** untapped opportunities.
3. **UX delight & clarity** — friction, hierarchy, micro-interactions, moments that make it feel good.
4. **Accessibility** — everything statically checkable (step 2).
5. **Consistency** — with the design system (`theme/tokens.ts`, `primitives.tsx`) and already-shipped screens.
6. **Anything else** — conversion to the intended action, plain-language copy ("issue" not "topic"), etc.

Each recommendation gets a plain-language **Net** (per `eugene-workflow-preferences`: lead with what you'd *see on screen*, no unglossed jargon).

**4. Produce two outputs.**
- **A Claude Design prompt** — definitive changes only, obeying the `claude-design-prompt-rules` memory: no feasibility questions back to Design (feasibility is our call), no approval-dependent blocks, no export requests, no roadmap relabeling, no mock-realism policing; frames referenced by preview-band label; capabilities stated as settled facts.
- **A decision list** — the scope/product calls that need a human owner (build the missing capability vs. cut the element vs. ship interim), each with a recommendation, effort, and Net.

**5. Interview on genuine gaps only** — batched, ≤4, each with a recommended default (`design-intake` style). Only for gaps the repo/spec didn't answer.

**6. Route the outcome.** Settled design decisions → `docs/mvp-redesign-plan.md`. Capability/data gaps that need work → a GitHub issue filed at discovery (`.claude/rules/workflow.md` rule 4). Once the design finalizes, the build runs through `design-intake` → `design-build`.

## What's assessable up front vs. only on the live build

The point of this gate is to pull everything forward that *can* come forward. `design-audit` at the end verifies only what genuinely needs a running build.

| Concern | ✅ Up front (mockup + bundle + spec) | 🔎 Only live (`design-audit`) |
|---|---|---|
| Data/capability grounding | All of it | — |
| Grounded-answers & copy invariants | All of it | — |
| Color contrast | Measured from the mock's hex values | Re-measured in the implemented tokens |
| Touch-target / text size | Measured from the mock's px | Confirm after responsive reflow |
| Heading/landmark hierarchy, label intent | From the design's structure | Verify as coded (real semantics, SR names) |
| Hover-dependence | Flag affordances that die on touch | Confirm resting/`:active` states fire |
| Mobile-web reflow | Assess the *plan* (mock is desktop-only ~1600px) | Verify actual reflow at breakpoints |
| Keyboard operability, focus order/visibility | Note intent | Must verify live |
| Motion / `prefers-reduced-motion` | Flag motion-heavy patterns | Verify the toggle as coded |
| RN-Web stacking / z-index | — | Only surfaces live (the #171 class) |
| Real-data edge cases (empty, overflow, long strings) | Flag the states to design for | Verify with real DB rows |

## Anti-patterns

Implementing or editing the mockup (this pass only produces feedback) · sending anything to Claude Design directly · asking Design to assess feasibility · a verdict from memory instead of checking the field/API/issue · deferring to the build something a still image could have caught · policing mock content realism (real vs. fictional names — withdrawn, per `claude-design-prompt-rules`).

## References

`.claude/rules/grounded-answers.md` (the invariants step 1 enforces) · `docs/mvp-redesign-plan.md` (decisions land here) · `docs/grounded-ask-spec.md` · `docs/v1-scope.md` · `docs/ui-copy-guide.md` · the `claude-design-prompt-rules` and `eugene-workflow-preferences` memories · sibling skills `design-intake`, `design-build`, `design-audit`.
