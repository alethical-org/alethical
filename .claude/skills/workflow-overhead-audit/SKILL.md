---
name: workflow-overhead-audit
description: Use to re-check whether every gate in the Claude working pipeline still earns its cost — hooks, skills, rules, conventions, CI — when asked to "audit workflow overhead", "check process friction", "are all these checks still worth it", after adding a new gate, or roughly quarterly. Maps the pipeline for a task type (default: design handoff → live site), costs each gate, scores it against evidence of what it actually caught, and outputs keep/trim/merge/drop verdicts diffed against the previous audit's table.
---

# Workflow-overhead audit

## Purpose

Process only accumulates. Every hook, rule, and skill was added for a reason, but reasons expire — branches merge, incidents stop recurring, tools change. This audit is the scheduled subtraction pass: evidence decides which gates are safety rails and which have become ritual. (The first audit, 2026-07-13, found a build skill still pointing at a foundation branch that had merged and been deleted, and a double-gated task start.)

## Scope — three layers, audited separately

1. **Repo-tracked:** everything `git ls-files .claude` returns (hooks, rules, skills, settings.json), CONTRIBUTING.md conventions, and the `.github/workflows/` CI gates.
2. **Repo-local (untracked, this machine):** `.claude/settings.local.json` — SessionStart hooks, permission grants.
3. **Machine-global:** `~/.claude/CLAUDE.md` mandates, `~/.claude/skills/`, and installed plugins with their session-start injections.

Verdicts for layers 1–2 are applied in the same pass (`.claude/rules/workflow.md` rule 10 — safe, reversible, not app code). Layer-3 verdicts become exact copy-paste proposals in the session summary, never repo files: they describe one contributor's machine, and this repo is public.

## Method

1. **Inventory** every gate that fires on the chosen task type, in firing order — session start (hooks, injected context), intake, build, verification, PR, CI, deploy.
2. **Cost** each gate in three currencies, worst first:
   - **User round-trips** — a question that blocks work costs minutes to hours; weigh these heaviest.
   - **Context tokens** — `wc -w` every body loaded per session (skills, rules, plugin catalogs); per-session fixed loads dominate because they recur on every session.
   - **Wall-clock** — hook timeouts are caps, not typicals; estimate the typical.
3. **Score value on evidence only.** A gate earns its keep by pointing at something: a named incident it prevented or caught (PR, issue, observation-log entry) or a correctness guarantee it enforces. Ask "what did this catch in the last ~20 sessions?" — silence is a trim signal. Also verify each gate's *facts* are still true (branch names, paths, tool claims): a stale instruction is a negative-value gate — it actively costs time.
4. **Verdict** per gate: **keep / trim** (shorten, make conditional) **/ merge / drop**. Exempt from trimming: safety rails — the leak-guard commit hook, `.claude/rules/grounded-answers.md` invariants, CI correctness and format checks. The target is redundant process, never protection.
5. **Record** the repo-layer table in `audits/YYYY-MM-DD-<task-type>.md` beside this skill. Diff against the most recent previous record and lead with deltas: gates added since, kept gates still silent, dropped gates whose absence caused an incident (a re-add signal).
6. **Apply** layer-1/2 verdicts in the same pass (one PR); ship layer-3 verdicts as copy-paste edits in the summary.

## Cadence

On demand: quarterly, after adding any new gate, or whenever process friction annoys. Don't schedule it blind — an audit without fresh evidence (new sessions, new incidents) just restates the last table.

## Anti-patterns

Trimming a gate that can name its incident · micro-optimizing seconds of wall-clock while ignoring per-session token loads and user round-trips · verdicts from vibes ("feels heavy") instead of evidence · treating a timeout cap as the cost (a 30s cap ≠ 30s spent) · letting this skill itself bloat — it stays under a page.

## References

`.claude/rules/workflow.md` rule 10 (safe/reversible autonomy — the apply mandate) · `audits/` (previous decision tables, the diff base) · the task-observer observation log (evidence source; local and gitignored, never committed).
