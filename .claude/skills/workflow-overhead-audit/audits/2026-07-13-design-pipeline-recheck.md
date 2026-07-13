# Workflow-overhead audit — design pipeline — 2026-07-13 (re-check)

Task type: **design handoff / design instructions → live site** (same as baseline).
Second audit of the day, run on demand. Justified by fresh gate-layer evidence
since the baseline (all merged after [#190](https://github.com/alethical-org/alethical/pull/190)):
`workflow.md` rule 10 was expanded five times today, `linked-intent-dev` was
disabled, and the first accessibility fix shipped under rule 10's new lane. This
is a diff against `2026-07-13-design-pipeline.md`, not a fresh inventory —
unchanged gates are summarized, not re-litigated.

## Deltas since baseline

| # | Gate | Baseline verdict | Now | Why it moved |
|---|---|---|---|---|
| 6 | `.claude/rules/workflow.md` rule 10 | Keep (as part of the 10-rule file, "~1.2k words") | **Trim — consolidate rule 10** | The file is now **1941 words**; rule 10 alone is **807** (42% of the file, 3.8× the next rule at 224). It grew via #186→#188→#191→#192→#195 — each clause traces to a real incident, but the *cumulative* form now repeats one directive ("do + squash-merge safe front-end work, don't propose") four times and carries inline changelog provenance ("added 2026-07-13…", "after PRs #185–#188") that belongs in git history. Injected every session, so the redundancy is paid every session. |
| — | `linked-intent-dev` plugin (claimed every code change) | Flagged as pipeline overhead in observation-log #2 | **Dropped — resolved** | Now `false` in `settings.local.json` `enabledPlugins`. One fewer gate on every code change; no incident from its absence → no re-add signal. |
| 5/6 | Rule 10 front-end carve-out (a11y lane) | N/A at baseline | **Keep — now load-bearing** | #193/#194 was the first a11y fix shipped under the lane; it worked. (#194 was briefly left open, which prompted rule 10's fourth paragraph — see the trim below.) |

## Unchanged since baseline (still Keep, evidence intact)

SessionStart roadmap-snapshot + stale-copy hooks · leak-guard commit hook
(exempt safety rail) · `design-task-intake` (still the single task-start gate) ·
`implementing-design-handoffs` · `coding-discipline.md` · `grounded-answers.md`
(exempt) · CONTRIBUTING.md conventions · CI prettier/lint/build + auto-deploy
(exempt). Baseline was this morning, so none has had time to go "silent" — the
next audit is the first that can test the silence signal.

## The one verdict change: trim rule 10

Rule 10's *directives* are all evidence-backed and stay. What's redundant is the
*form*: paragraph 4 restates paragraph 2's "a11y fixes are in the lane," the
"Eugene has reaffirmed…" passage restates paragraph 1's core, and dated
PR-provenance is carried inline. A meaning-preserving consolidation — fold
paragraph 4's one unique atom ("file the issue at discovery") into the a11y
clause, compress the reaffirmation to the stale-copy warning that is the *actual*
recurring failure mode, and strip the changelog parentheticals — takes rule 10
from ~807 to ~450 words with no behavioral directive lost.

**Not applied in this pass — proposed.** Per rule 10's own verifiability clause,
a change whose correctness can't be cheaply verified is propose-first. A semantic
rewrite of the rule that governs autonomy (hand-tuned five times today, flagged
in memory as high-cost-if-subtly-wrong) is exactly that: a `git revert` undoes
it, but silent meaning-drift in a behavioral rule wouldn't *trigger* a revert.
So the rewrite goes to the session summary for an explicit yes; only this record
is applied now.

## Headline

The repo layer is still lean — nothing dropped for lack of evidence, one gate
(`linked-intent-dev`) shed by the user, one gate (rule 10) flagged to **trim for
bloat, not for lack of value**. The lesson is the anti-pattern the skill names:
a single rule absorbing five same-day additions is how per-session token load
creeps — every clause justified, the sum overweight.

Next audit: diff against this table. Watch items — whether rule 10 gets
consolidated (or grows further), and whether any Keep gate reaches a full
quarter without catching anything now that real session history can accrue.
