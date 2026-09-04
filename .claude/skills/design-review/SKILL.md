---
name: design-review
description: >-
  Use when a draft (not-yet-final) Design mockup + bundle arrives and needs
  evaluating against Alethical's real data, backend capability, and UX before anyone
  builds it. Pressure-tests every element for buildability + honesty
  (grounded-answers), applies the design-audit accessibility/interaction rubric to
  everything a static design can reveal, and routes prioritized feedback to Design,
  the current coding agent, or Eugene. Pre-build. First in the
  design- skill set: design-review → design-intake → design-build → design-audit.
---

# Design review

## Purpose

A Design mockup is drawn without visibility into our database, backend, or roadmap — so it can confidently show elements we can't back, claims our data can't honor, or accessibility problems that are cheaper to fix now than after a build. This is the **shift-left gate**: surface every issue a still image + our data can prove *before* a line of code, and hand back exact change requests. It is the one design phase only the current coding agent can run, because it depends on the repo, the corpus, and the milestones.

This reviews the handoff and may correct mechanical bundle errors. It does **not** begin the
product build or send anything to Design. The maintainer relays any needed prompt and drives
the design iteration.

**Return to Design only when its judgment materially improves the build.** All 3 answers must
be yes: (1) an unresolved choice changes what a person sees, understands or does; (2) the
approved design, product rules, source facts, accessibility rules and shipped patterns do not
settle it; and (3) Design's visual workspace or design judgment is likely to improve the build.
At least 2 meaningfully different good answers must remain. A missing screen, state, phone view
or other large change does not qualify by itself. Everything with 1 checkable answer stays with
the current coding agent. Product, scope and policy choices stay with Eugene.

**The coding roles are relative.** The agent holding this review is the current coding agent.
Its peer coding consultant is the other platform: Codex consults Claude Code, and Claude Code
consults Codex. A peer consultation follows the `model-effort` triggers and supplies advice;
it does not transfer ownership or create a routine extra round.

**Reuse files already present in the Design conversation.** When the maintainer is
continuing the same Design conversation and Design already received the bundle,
screenshot, or other source file, the complete user-facing handoff instruction is
`Send Design (<exact Design tier>) prompt.` The prompt may name the exact existing filename
as context, but neither the prompt nor the recommendation may tell the maintainer to attach,
upload, or resend that file. Do not add `below`, restate that this is the same conversation,
or repeat that no upload or build should happen: placement and standing rules already make
those facts true. Instruct a new upload only when the maintainer says this is a new
conversation, Design reports that the earlier file is unavailable, or the file itself
changed. Mention only the exception that changes the maintainer's action.

## When to use

- A draft mockup / bundle / screenshots arrive for a page that isn't finalized yet.
- You're iterating with Design toward a final design and need grounded feedback.

Not for: a **finalized** design ready to build (→ `design-build`), proofing a build/bug request (→ `design-intake`), or auditing an already-built screen (→ `design-audit`).

## The three questions this pass answers

1. **Buildable** — does every element map to data we've ingested (and keep fresh) and a shipped or scoped capability?
2. **Honest** — does anything violate `.claude/rules/grounded-answers.md` (advertises what we can't answer, a claim copy can't back, records-vs-generated blur, non-URL-addressable link)?
3. **Better** — prioritized improvement recommendations (below), not just pass/fail.

## Procedure

**Resolving which bundle to review.** If the invocation names a bundle (a path or page name), use it. Otherwise — including a bare `/design-review` with no other arguments — default to the **most recently downloaded bundle in `~/Downloads`**, so the skill can be invoked with nothing else and still know what to review. Find the newest candidate with `ls -td ~/Downloads/*/ ~/Downloads/*.zip 2>/dev/null | head` (a Claude Design bundle is a folder — or a `.zip` of one — holding `README.md` + a `.dc.html` + `screenshots/`); unzip a `.zip` first. If the newest item isn't a design bundle, fall back to the newest one that is. Confirm in one line which bundle you picked and what page it's for, then frame it (step 0). This pass reads the bundle in place for feedback — it does not land it in-repo (that's `design-build`'s job once the design finalizes).

**Before reading any bundle, check whether its markup is real or bundled.** Claude Design ships 2 formats and they need opposite handling, so stripping `<script>` first — the normal way to read an HTML file — silently deletes the entire page in one of them:

```bash
python3 -c "import re,sys;s=open(sys.argv[1],encoding='utf-8').read();print('bundled' if sum(len(x) for x in re.findall(r'<script\\b.*?</script>',s,flags=re.S))/len(s) > 0.5 else 'plain HTML')" <file>
```

- **Review exports (`.dc.html`)** are plain HTML — a few percent script. Strip tags and read normally.
- **Build exports (`.html`)** are self-extracting bundles: measured 20 Aug 2026, **99.7% of the file sat inside one `<script>`**, with only 67 characters of real text outside it ("This page requires JavaScript to display"). The markup is a JavaScript string with every `/` written `\u002F` so `</div>` cannot close the script early — 401 of those against 3 literal `</div>`. Search the **raw source** after HTML-unescaping, or render it in a browser; never strip script tags.

**The failure mode is what makes this worth a step of its own: it fails silently, and it fails toward a false blocker.** Every copy check returns "not found", which reads as "Design did not make the change" rather than "the reader is broken" — on the 20 Aug 2026 homepage build bundle that nearly shipped "the new sentence is missing from all 4 files" as a finding when all 4 carried it. Any string check that comes back empty across *every* file is the tell: verify the reader before writing the finding.

**Tier the review, then STOP and wait for the go.** When the review request arrives as a
pasted prompt, the first reply's `Tier:` line names only the model and the tool's exact effort
label. If a mechanism choice is required, name it in `Rec:`. Do nothing else: no reading the
bundle, repo checks, findings, plan or code. A review is judgment-bound end to end, so the
default is deep or deepest useful reasoning in 1 pass with nothing worth handing to a helper.
Then wait for Eugene's go (`'`) and start from step 0. Reading the bundle at the wrong tier is
the exact spend the wait exists to prevent, and a tier named alongside the findings is a
receipt, not a recommendation.

**0. Frame it.** Identify the page, the preview-band state(s) shown (reference frames only by
Design's own band labels, never invented names), its place in the IA and
`docs/product-onboarding/site-navigation-guide.md`, and pull the governing spec
(`docs/product-onboarding/product-scope.md`, `docs/product-onboarding/grounded-ask-spec.md`,
the relevant issues/milestone). State in one line what this screen is and is for.

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

**4. Route every finding into exactly 1 output.**
- **A Design prompt, only when needed** — include only findings that pass all 3 return-to-Design checks. Obey the active Design provider's prompt rules; for Claude Design, use the `claude-design-prompt-rules` memory. Ask no feasibility questions back to Design (feasibility is our call), add no approval-dependent blocks, request no exports, do no roadmap relabeling, and do no mock-realism policing. Reference frames by preview-band label and state capabilities as settled facts. State must-fix items as settled changes and label recommended polish.

  Put the complete copy-and-send prompt under a literal `## Prompt` heading inside 1
  fenced `text` code block. No part of the prompt may sit outside that code block, and
  the code block contains only what the maintainer should paste. Keep the handoff action
  `Send Design (<exact Design tier>) prompt.` outside the code block.

  **A truth finding is a settled change; a visual one is a constraint plus its price (memory rules 8–10).** Say what the code makes true and what each option costs — including when lifting the constraint is cheap, because a cheap limit reported as a bare fact reads as a wall. Then let Design choose. Where lifting it is worth what it costs and the change is one I agree with, lift it myself rather than routing it back. And a handoff marked *settled* is Design's status, not a finding I inherit: re-judge anything that touches what a reader is told.
- **A current-coding-agent fix list** — include every finding with 1 checkable answer: factual and source corrections, technical feasibility, settled copy, existing patterns, known accessibility fixes, browser behaviour, acceptance checks, tests, bundle consistency and implementation. Fix local bundle errors during the review where the shared rules authorize it; otherwise carry the exact correction into the build. Consult the peer coding consultant only when the `model-effort` triggers apply, and keep ownership here.
- **An Eugene decision list, only when needed** — include genuine product, scope or policy calls (build the missing capability vs. cut the element vs. ship interim), each with a recommendation, effort and Net.

If no finding passes the Design test, produce no Design prompt. Say the handoff is build-ready after the current-coding-agent fixes, then wait for Eugene's explicit build go.

**5. Interview on genuine gaps only** — batched, ≤4, each with a recommended default (`design-intake` style). Only for gaps the repo/spec didn't answer.

**6. Route the outcome.** Settled design decisions → the page's guide under `docs/product-onboarding/`, or `docs/design/design-principles.md` for a shared visual rule. Capability/data gaps that need work → a GitHub issue filed at discovery (`.claude/rules/workflow.md` rule 4). Once the design finalizes, the build runs through `design-intake` → `design-build`.

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

Starting the product build during review · sending a 1-answer correction to Design ·
offering a build while unresolved Design work remains · presenting “revise or build” as a user choice ·
asking the maintainer to resend a file already present in the Design conversation ·
sending anything to Design directly · asking Design to assess feasibility · a
verdict from memory instead of checking the field/API/issue · deferring to the build
something a still image could have caught · policing mock content realism (real vs.
fictional names — withdrawn, per `claude-design-prompt-rules`).

## References

`.claude/rules/grounded-answers.md` (the invariants step 1 enforces) · `docs/design/design-principles.md` (shared visual rules land here) · `docs/product-onboarding/grounded-ask-spec.md` · `docs/product-onboarding/product-scope.md` · `docs/design/ui-copy-guide.md` · the `claude-design-prompt-rules` and `eugene-workflow-preferences` memories · sibling skills `design-intake`, `design-build`, `design-audit`.
