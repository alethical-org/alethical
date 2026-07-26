# Workflow-overhead audit — `~/.claude/CLAUDE.md` (machine-global) — 2026-07-26

**Net:** the personal instruction file that loads in *every* project turned out to be in good shape — 27 KB, comfortably under the size where Claude Code warns, and nearly every section can name a real incident it prevents. One section was duplicating a skill that already covers the same ground in more depth; that duplicate is gone. The big autonomy section overlaps Alethical's rules but is deliberately **kept**, because it's the only copy in projects that have no rules of their own.

Layer: **3 (machine-global)**, audited for the first time. Diff base: `2026-07-26-workflow-rules.md` (same day, layer 1).

**Run justified:** this file became the largest single always-loaded item once `workflow.md` dropped from 54,868 → 21,519 chars earlier today, and it became **version-controlled for the first time** (see the layer-3 note below), which is what made an apply-in-pass audit possible at all.

## Deltas since the layer-1 audit (same day)

| Gate | Then | Now | Why it moved |
|---|---|---|---|
| Largest always-loaded file | `workflow.md`, 54,868 chars ⚠ over ceiling | **`~/.claude/CLAUDE.md`, 29,797 chars** — under ceiling | workflow.md was restructured (#631); this file inherited the top slot without ever tripping the trigger |
| Layer-3 handling | "proposals only, never repo files — this repo is public" | **verdicts now applied in-pass** | The file moved into `~/Code/tool-settings`, a **private** repo (`euglopi/tool-settings`) that is *not* the public Alethical repo. Both reasons for proposal-only lapsed, so edits are now as reviewable and revertable as layer-1 edits. |

## Cost — step 2, characters not words

Word count would have said 4,780 and understated by ~13%; markdown markup is paid for in context but invisible to `wc -w`.

| Section | Chars | Est. tok | % of file | Verdict |
|---|---|---|---|---|
| Run every task on the cheapest total-cost path | **9,587** | 2,396 | **32.2%** | **Restructure — applied** |
| Decisions: act on your recommendation, report after | 7,302 | 1,825 | 24.5% | **Keep** |
| Know, don't infer — investigate first, name which session | 3,145 | 786 | 10.6% | Keep |
| Always pair a technical explanation with a "Net" | 2,675 | 668 | 9.0% | Keep |
| Coding-discipline rules | 2,242 | 560 | 7.5% | Keep |
| Take the lead on directing other sessions | 1,945 | 486 | 6.5% | Keep |
| Optimize for context, not the usage limit | 1,461 | 365 | 4.9% | Keep |
| Observation capture (lightweight task-observer) | 1,410 | 352 | 4.7% | Keep |
| **Total** | **29,797 → 27,364** | 7,449 → **6,841** | — | −608 est. tok/session |

**Ceiling:** 27,364 chars vs the ~40,000-char line — **under, before and after.** The automatic trim-or-restructure trigger never fired; every verdict here rests on evidence.

## The one restructure: model/effort routing → skill `model-effort`

The largest section (32.2%) was **duplicating an existing skill**. `~/.claude/skills/model-effort/SKILL.md` is 8,127 chars and covers the same ground in more depth — including a pricing ladder and Fable-tier guidance the global file never had. Each removed directive was verified present in the skill before deletion:

**Removed** (all confirmed in the skill): the bounds taxonomy (reasoning-bound / mechanical / mixed / I-O-bound / when multiple agents help) · the execution levers (delegate to cheaper-model subagents; main-loop tier can't switch mid-session; when to surface a whole-session `/model` switch) · "always name the concrete optimal setting, never *keep your defaults*".

**Kept resident, deliberately:** the objective and the cheapest-≠-smallest / total-cost-of-ownership framing — the judgment that must be present *before* any routing decision · **"never cheap out where the downside is irreversible"** — a prohibition, and prohibitions never move into a lazily-loaded file · **the entire cheaper-AND-faster-frontier gate and its EMERGENCY STOP**, verbatim in meaning: it is a hard reserved stop, and the skill does not carry it (0 hits for `EMERGENCY`).

## The one deliberate Keep worth defending: the autonomy section

At 7,302 chars / 24.5% it is the second-largest section and it *does* overlap Alethical's `workflow.md` rule 10 and the `when-to-act-without-approval` skill. It is nonetheless **Keep**, on three grounds:

1. **It is the only copy where it matters.** Alethical's rules load only in Alethical; `~/Code/CommercialDeals` has no `.claude/rules/` at all (verified). Trimming here silently weakens every non-Alethical project.
2. **The overlap is directives, not mechanics.** Rule 10's restructure worked because the *per-domain checklists* could move while the authority stayed. This section is authority end to end — there is no mechanics half to extract.
3. **Every paragraph names its incident.** Nine distinct directives, each with a dated origin. The audit skill lists *"trimming a gate that can name its incident"* as an anti-pattern, and the realistic prize was ~700 tokens against a real risk of behavioural drift in the rule governing every future session. Bad risk/reward.

What it *does* carry is 4 inline origin anecdotes (~900 chars) — the accretion signal. Flagged as a **watch item**, not trimmed: they are the "why" the keep-list protects.

## Verification

- **Loss check:** all 9 removed directives confirmed present in `model-effort` by literal string match before the cut.
- **Retention check:** all 6 must-stay strings confirmed still resident afterwards (objective · cheapest-≠-smallest · irreversibility prohibition · EMERGENCY STOP · What counts as LARGE · cost-alone-never-gates).
- **Stale-reference check:** fixed *"reasoning-bound → Opus/high **below**"*, which stopped pointing at anything once the taxonomy moved. Re-read the section for flow afterwards.
- **Committed and pushed** to `euglopi/tool-settings` (`3b78d2e`) per the standing instruction that edits to this file are committed the same turn.

## Headline

Unlike `workflow.md`, this file was **not** in trouble: under the ceiling, no gate dominating pathologically, no stale-lead contradiction, and a genuine reason for the duplication that remains. The single real finding is a **new class the audit had not looked for — a rule file duplicating a *skill* rather than another rule.** Sections 3–8 were checked against skills and rules and found unique; only the model/effort section had a fully-formed skill twin. That check is now part of the method (step 3).

The deeper lesson is about **layer 3 itself**: it had been proposal-only since the first audit, for two reasons — "one contributor's machine" and "this repo is public." Version-controlling the file in a private repo dissolved both, and layer-3 verdicts became applicable in-pass. **A scope restriction can expire because the world changed, not because the rule was wrong** — worth re-testing each audit rather than inheriting.

Next audit: watch items — (1) whether the model/effort section stays a pointer or re-accretes routing detail; (2) whether the autonomy section's anecdote count grows past 4; (3) whether any *other* section acquires a skill twin now that the check exists; (4) `MEMORY.md`, 19,048 chars and always loaded, never yet audited — it belongs to the memory system rather than the rules cascade, so decide first whether it is in this audit's scope at all.
