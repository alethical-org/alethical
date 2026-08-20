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

**Resolving which bundle to review.** If the invocation names a bundle (a path or page name), use it. Otherwise — including a bare `/design-review` with no other arguments — default to the **most recently downloaded bundle in `~/Downloads`**, so the skill can be invoked with nothing else and still know what to review. Find the newest candidate with `ls -td ~/Downloads/*/ ~/Downloads/*.zip 2>/dev/null | head` (a Claude Design bundle is a folder — or a `.zip` of one — holding `README.md` + a `.dc.html` + `screenshots/`); unzip a `.zip` first. If the newest item isn't a design bundle, fall back to the newest one that is. Confirm in one line which bundle you picked and what page it's for, then frame it (step 0). This pass reads the bundle in place for feedback — it does not land it in-repo (that's `design-build`'s job once the design finalizes).

**0. Frame it.** Identify the page, the preview-band state(s) shown (reference frames only by Claude Design's own band labels — never invented names, per the `claude-design-prompt-rules` memory), its place in the IA and `docs/product-onboarding/mvp-redesign-plan.md`, and pull the governing spec (`docs/product-onboarding/product-scope.md`, `docs/product-onboarding/grounded-ask-spec.md`, the relevant issues/milestone). State in one line what this screen is and is for.

**1. Ground every element.** Walk *each discrete element* — every field, chip, badge, count, filter, card, CTA, empty state, suggested question — and tag it:
- ✅ **backed today** (cite the source: bill field, API, spec §, issue)
- 🟡 **scoped but not built** (name the interim behavior the plan specifies)
- 🔴 **can't honor** (no data / no capability / out of scope)
- ⚠️ **grounded-answers violation** (cite the rule)

   Then check the **wording** of the states a mockup usually leaves as lorem or omits entirely — empty states, error messages, loading and refusal text. Grounding says whether an element *can* exist; this asks whether its copy says something a real person would understand, in this product's vocabulary (`copy-uses-issue-not-topic`: "issue", not "topic"; author/co-author per `.claude/rules/grounded-answers.md` rule 3). A screen whose happy path is perfect and whose empty state reads "No results" is not finished.

Verify data claims against what's **ingested and fresh**, not what's theoretically possible. No verdict from memory — check the field/API/issue.

**But score an under-construction surface against the FINISHED roadmap, not today's build (Eugene, 20 Aug 2026).** When the screen carries its own under-construction notice — the money section's is the standing case — "it does not work yet" is not a finding, because the notice already tells the reader that. The test becomes: **once every roadmap item ships, can this claim be built from what the source actually publishes?** Only what fails *that* survives as 🔴. A claim whose data is simply not loaded yet is 🟡 with the roadmap item named.

Applied to the 20 Aug 2026 homepage review, this dissolved 3 of 6 findings, 2 of them called blockers: lobbying copy (Minnesota publishes the registrations; it is a named roadmap item), a search button (search is that section's own plan), and an under-construction caveat. What survived was the one claim no finished roadmap can deliver — payments tied to the filing they came from, which the published rows carry no key for.

**And ask whether a missing state needs a FRAME or only a SENTENCE (Eugene, 20 Aug 2026).** Before requesting a new frame, split the state: does it differ *visually*, or only in *wording*? A singular/plural form, a shortened clause when a value is absent, an error message — those are copy, and the ask is the sentence, not a drawing. Sample data in a mock is never the thing to fix: "14 tracked bills" is a placeholder, and asking Design to redraw it with 1 wastes a round while leaving the actual gap, the singular wording, unwritten.

**2. Apply the `design-audit` rubric statically.** Run the accessibility + interaction rubric (the `design-audit` skill's pinned Web Interface Guidelines + WCAG snapshot) against everything a static design reveals — see the split below. Flag what the still image can prove; note the few checks that must wait for the live build so they carry into `design-build`'s verify step.

**3. Improvement pass — prioritized.** In this order (data/capability is our moat, so it leads):
1. **Grounding & trust signals** — does the design *reinforce* the cite-everything / neutrality value prop?
2. **Data/capability leverage** — not just "can we back it?" but "are we *underusing* data we already hold?" Constraints **and** untapped opportunities.
3. **UX delight & clarity** — friction, hierarchy, micro-interactions, moments that make it feel good.
4. **Accessibility** — everything statically checkable (step 2).
5. **Consistency** — with the design system (`theme/tokens.ts`, `primitives.tsx`) and already-shipped screens.
6. **Anything else** — conversion to the intended action, plain-language copy ("issue" not "topic"), etc.

Each recommendation gets a plain-language **Net** (per `eugene-workflow-preferences`: lead with what you'd *see on screen*, no unglossed jargon).

**Every observation ships in the deliverable, weighted — never withheld as an aside (Eugene, 18 Aug 2026).** A review's output is not only rule breaches: taste-level UX and copy improvements (a label whose voice drifted from a renamed sibling, a placeholder using our vocabulary instead of the reader's) go into the same relayed feedback, tagged by weight — *must fix* (breaks a rule or the data) versus *recommended polish* (better, Design may push back). The failure this prevents: a real improvement spotted during review, then parked in an "also found" note that never reaches Design (origin: the round-2 campaign-money review left the "vendor"-to-"payee" voice fix out of the relayed fix block after the lane it echoed had been renamed).

**4. Produce two outputs.**
- **A Claude Design prompt** — obeying the `claude-design-prompt-rules` memory: no feasibility questions back to Design (feasibility is our call), no approval-dependent blocks, no export requests, no roadmap relabeling, no mock-realism policing; frames referenced by preview-band label; capabilities stated as settled facts. Must-fix items stated as settled changes; recommended-polish items included beneath them, labeled as recommendations.

  **A truth finding is a settled change; a visual one is a constraint plus its price (memory rules 8–10).** Say what the code makes true and what each option costs — including when lifting the constraint is cheap, because a cheap limit reported as a bare fact reads as a wall. Then let Design choose. Where lifting it is worth what it costs and the change is one I agree with, lift it myself rather than routing it back. And a handoff marked *settled* is Design's status, not a finding I inherit: re-judge anything that touches what a reader is told.
- **A decision list** — the scope/product calls that need a human owner (build the missing capability vs. cut the element vs. ship interim), each with a recommendation, effort, and Net.

**5. Interview on genuine gaps only** — batched, ≤4, each with a recommended default (`design-intake` style). Only for gaps the repo/spec didn't answer.

**6. Route the outcome.** Settled design decisions → `docs/product-onboarding/mvp-redesign-plan.md`. Capability/data gaps that need work → a GitHub issue filed at discovery (`.claude/rules/workflow.md` rule 4). Once the design finalizes, the build runs through `design-intake` → `design-build`.

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

`.claude/rules/grounded-answers.md` (the invariants step 1 enforces) · `docs/product-onboarding/mvp-redesign-plan.md` (decisions land here) · `docs/product-onboarding/grounded-ask-spec.md` · `docs/product-onboarding/product-scope.md` · `docs/design/ui-copy-guide.md` · the `claude-design-prompt-rules` and `eugene-workflow-preferences` memories · sibling skills `design-intake`, `design-build`, `design-audit`.
