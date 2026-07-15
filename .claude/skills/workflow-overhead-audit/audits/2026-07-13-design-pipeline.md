# Workflow-overhead audit — design pipeline — 2026-07-13 (baseline)

> _Skill renames since this audit (2026-07-15): `design-task-intake` → `design-intake`, `implementing-design-handoffs` → `design-build`, `web-design-guidelines` → `design-audit`; new sibling `design-review`. Old names below are historical._

Task type: **design handoff / design instructions → live site.** First audit; no
previous table to diff. Repo-tracked and repo-local layers only — the
machine-global layer (personal `~/.claude` config and plugins) was audited in the
same session and reported in chat, per the skill's public-repo rule.

Context for the verdicts: throughput on design PRs is already minutes-scale
(e.g. [#171, nav dropdown hover fix](https://github.com/alethical-org/alethical/pull/171)
created→merged in 5 minutes; [#180, hero ask field](https://github.com/alethical-org/alethical/pull/180)
in 13), so the repo layer's gates were judged on token weight, round-trips, and
factual freshness rather than PR latency.

## Decision table

| # | Gate | Cost (typical) | Evidence of value | Verdict |
|---|---|---|---|---|
| 1 | SessionStart roadmap-snapshot hook (`settings.local.json`, 20s cap) | ~2–5s at session start; no round-trip | Stale scope/timing claims caused real errors (origin of workflow rule 5); snapshot grounds scope claims every session | **Keep** |
| 2 | SessionStart stale-copy-sweep hook (30s cap) | ~1–3s | Loose file copies drifting from branches caused rework (origin of workflow rule 3) | **Keep** — nit: it repeats hook 1's `git fetch` (~1–2s); not worth churn |
| 3 | Leak-guard commit hook (`block-sensitive-commit.sh`) | <1s per commit | Public repo; blocks `.env` and observation-log commits that `.gitignore` gaps or `git add -f` would let through | **Keep — exempt safety rail** |
| 4 | `design-task-intake` skill (~700 words; at most one batched question round-trip) | Round-trip is the costliest currency, but the skill self-skips complete prompts | Born from the [#171](https://github.com/alethical-org/alethical/pull/171) retro, where missing context cost real debugging time | **Keep + trim applied:** now declared the *single* task-start gate for design tasks — generic gates (superpowers:brainstorming) no longer stack on top |
| 5 | `implementing-design-handoffs` skill (~1.3k words) | Token load once per design session | Every section traces to a named incident: #171 (stacking/overlay, ref-based verification), the Prettier saga ([#181](https://github.com/alethical-org/alethical/pull/181)/[#182](https://github.com/alethical-org/alethical/pull/182)), forgotten routing, naming invariants | **Keep + fix applied:** step 2 still pointed at `redesign/design-system`, which merged in [#67](https://github.com/alethical-org/alethical/pull/67) and was deleted — a stale instruction that sent fresh sessions hunting for a nonexistent branch |
| 6 | `.claude/rules/workflow.md` (10 rules, ~1.2k words injected per session) | Rules 1 and 6 add per-PR work (a `gh pr list` scan; a stale-reference grep) | Rule 1: the #121/#122 double-merge; rule 6: silent screenshot/doc drift; rule 10 *reduces* latency (autonomy for safe work) | **Keep** |
| 7 | `.claude/rules/coding-discipline.md` (~400 words) | Negligible | Cheap guidance; no gating steps | **Keep** |
| 8 | `.claude/rules/grounded-answers.md` (~500 words) | Negligible | Product invariants for every answer-adjacent surface | **Keep — exempt safety rail** |
| 9 | CONTRIBUTING.md conventions (branch/PR/issue hygiene) | Human-facing; not auto-injected | [#182](https://github.com/alethical-org/alethical/pull/182) fixed its own stale Prettier claim — conventions here are actively maintained and cheap | **Keep** |
| 10 | CI: repo-wide `prettier --check`, lint, build; auto-deploys on `main` | Minutes per PR, parallel to other work | [#141](https://github.com/alethical-org/alethical/pull/141)/[#181](https://github.com/alethical-org/alethical/pull/181) caught genuine non-conformance; deploys make PR discipline load-bearing | **Keep — exempt safety rail** |

## Applied this audit

1. Fixed the stale foundation-branch instruction in `implementing-design-handoffs`
   (step 2 + mistakes table) and the matching line in
   `docs/mockups/home-signed-out-v2/README.md`'s repo-context note.
2. Resolved the start-of-task double-gate: `design-task-intake` is now declared
   the one intake/brainstorm gate for design tasks.
3. Created this skill and baseline record.

## Headline

The repo layer is lean and evidence-backed — no gate was dropped. The dominant
overhead in the design pipeline is the machine-global layer (fixed per-session
context loads and plugin catalogs), which is outside this file by design; its
verdicts went to the session summary as copy-paste proposals.

Next audit: diff against this table. Watch items — whether the intake skill's
question round-trips stay rare, and whether any gate here goes another quarter
without catching anything.
