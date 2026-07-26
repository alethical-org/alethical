---
name: workflow-overhead-audit
description: Use to re-check whether every gate in the Claude working pipeline still earns its cost — hooks, skills, rules, conventions, CI — when asked to "audit workflow overhead", "check process friction", "are all these checks still worth it", after adding a new gate, or on a periodic (monthly-to-quarterly) backstop. Maps the pipeline for a task type (default: design handoff → live site), costs each gate, scores it against evidence of what it actually caught, and outputs keep/trim/merge/restructure/drop verdicts diffed against the previous audit's table.
---

# Workflow-overhead audit

## Purpose

Process only accumulates. Every hook, rule, and skill was added for a reason, but reasons expire — branches merge, incidents stop recurring, tools change. This audit is the scheduled subtraction pass: evidence decides which gates are safety rails and which have become ritual. (The first audit, 2026-07-13, found a build skill still pointing at a foundation branch that had merged and been deleted, and a double-gated task start.)

## Scope — three layers, audited separately

1. **Repo-tracked:** everything `git ls-files .claude` returns (hooks, rules, skills, settings.json), CONTRIBUTING.md conventions, and the `.github/workflows/` CI gates.
2. **Repo-local (untracked, this machine):** `.claude/settings.local.json` — SessionStart hooks, permission grants.
3. **Machine-global:** `~/.claude/CLAUDE.md` mandates, `~/.claude/skills/`, and installed plugins with their session-start injections.

Verdicts for layers 1–2 are applied in the same pass (`.claude/rules/workflow.md` rule 10 — safe, reversible, not app code).

**Layer 3 is proposal-only *unless the file is version-controlled somewhere private* — re-test this each audit rather than inheriting it.** The original restriction had two reasons: the content describes one contributor's machine, and this repo is public. Both lapsed on 2026-07-26 when `~/.claude/CLAUDE.md` became a symlink into `~/Code/tool-settings`, a **private** repo (`euglopi/tool-settings`) that is not this one — so its edits are as reviewable and revertable as any layer-1 edit, and layer-3 verdicts on it are now **applied in-pass and pushed** (Eugene's standing instruction: commit and push that file the same turn; the Edit tool refuses to write through the symlink, so target the real path). For a layer-3 file that is still unversioned, the old rule stands: exact copy-paste proposals in the session summary, never repo files. A scope restriction can expire because the world changed, not because the rule was wrong.

## Method

1. **Inventory** every gate that fires on the chosen task type, in firing order — session start (hooks, injected context), intake, build, verification, PR, CI, deploy.
2. **Cost** each gate in three currencies, worst first:
   - **User round-trips** — a question that blocks work costs minutes to hours; weigh these heaviest.
   - **Context tokens** — `wc -c` every body loaded per session (skills, rules, plugin catalogs) and estimate tokens as chars ÷ 4; per-session fixed loads dominate because they recur on every session. Measure **characters, not words**: markdown markup (`**bold**`, backticks) is paid for in context but invisible to `wc -w`, so word counts understate rule files by ~35%. **Hard ceiling:** a single always-loaded memory file over **~40,000 chars** trips Claude Code's own oversized-file warning (`getMaxMemoryCharacterCount` — max of 40k and 5% of the context window), and is an automatic trim-or-restructure trigger regardless of how its individual gates score. Report each audited file against that line, before and after.
   - **Wall-clock** — hook timeouts are caps, not typicals; estimate the typical.
3. **Score value on evidence only.** A gate earns its keep by pointing at something: a named incident it prevented or caught (PR, issue, observation-log entry) or a correctness guarantee it enforces. Ask "what did this catch in the last ~20 sessions?" — silence is a trim signal. Also verify each gate's *facts* are still true (branch names, paths, tool claims): a stale instruction is a negative-value gate — it actively costs time. **And check every always-loaded section for a *skill* twin, not just a rule twin** — an invocable skill covering the same ground makes the resident copy pure duplication, and it is the easiest overlap to miss because you are comparing a rule file against a different *kind* of artifact. Grep the skill directories (`~/.claude/skills`, `.claude/skills`, installed plugins) for the section's distinctive phrases; where a skill covers it in equal or greater depth, the resident text becomes a one-line pointer. (2026-07-26: 32% of `~/.claude/CLAUDE.md` was restating `~/.claude/skills/model-effort/SKILL.md`, which carried the same taxonomy plus a pricing ladder the rule file lacked.) Verify each removed directive by literal string match in the skill **before** cutting it, and keep any prohibition resident regardless. Also flag **disproportion and churn** as consolidation signals: from the step-2 character counts, note any single gate that dominates its host file, and check its recent edit count (`git log --oneline --since=… -- <file>`). A gate rewritten 3+ times in a short window, or one ballooned relative to its siblings, is usually accreting special cases a single principle would cover — a trim/merge/restructure candidate (rule 10 reached 42% of `workflow.md` across ~5 edits before #198 consolidated it to the "blast radius + reversibility + verifiability" principle — then regrew to 67%, which is why step 4 prefers restructure on a repeat offender).
4. **Verdict** per gate: **keep / trim** (shorten, make conditional) **/ merge / restructure** (move it, see below) **/ drop**.

   **Reach for restructure, not trim, when a gate has already been trimmed and grew back.** Compression fails when every new directive still has nowhere else to land, so the bloat returns: rule 10 was consolidated to 718 words on 2026-07-13 and measured **4,969 words — 67% of `workflow.md`, 9.3× the next-largest rule — thirteen days later**, a 6.9× regrowth across ~6 merged PRs. Re-trimming buys weeks. Restructuring changes *where* content lives: keep the **principle plus any prohibitions** resident in the rule, and move the **clause stack, elaborations, and worked examples** into a lazily-loaded skill (`.claude/skills/<name>/SKILL.md`), where only the one-line description stays in context — the pattern applied to `workflow.md` rules 4 and 12 (→ `file-github-issue`, `resume-research-workflow`). Ask of every clause: does this belong in an always-loaded rule (universal *and* safety-critical), a task-scoped skill, or a memory? A rule that keeps growing is usually the only place its authors had to put things — fix that, or the growth recurs.

   **Exempt from trimming and restructuring:** safety rails — the leak-guard commit hook, `.claude/rules/grounded-answers.md` invariants, CI correctness and format checks, plus two rails that live *inside* otherwise-auditable files: `workflow.md` rule 10's **hard line** (never fire an unverified irreversible real-world change) and rule 4's **never restructure the project's board fields/options** prohibition. Never move a prohibition into a lazily-loaded file, where it might not be loaded when it matters. The target is redundant process, never protection.
5. **Record** the repo-layer table in `audits/YYYY-MM-DD-<task-type>.md` beside this skill. Diff against the most recent previous record and lead with deltas: gates added since, kept gates still silent, dropped gates whose absence caused an incident (a re-add signal).
6. **Apply** layer-1/2 verdicts in the same pass (one PR) — including meaning-preserving rewrites of a rule or skill file. Don't propose them for approval: the audit record's before/after diff is the verification and `git revert` undoes it cleanly, so `workflow.md` rule 10's "can't cheaply verify → propose-first" bar does not gate audit edits. Only the exempt safety rails (step 4) stay off-limits. Ship layer-3 verdicts as copy-paste edits in the summary.

   **When the audited gate is `workflow.md` rule 10, it is also this skill's own apply-mandate** — rewriting the clause that authorizes the rewrite is allowed, but weakening it by accident is the failure to avoid. Preserve in meaning: the audit-verdict apply grant, the low-risk-PR merge default, the additive/reversible/verified-migration auto-merge carve-out, and the paid-run authorization (which `~/.claude/CLAUDE.md`'s cheaper-and-faster-frontier rule cross-references by name). After any rule-10 edit, re-read those four and confirm each still says what it said.

## Cadence

Two triggers, not a fixed clock. **Event:** after adding or materially changing a gate, or whenever process friction annoys. **Periodic backstop:** monthly while the process layer is churning fast (as in mid-2026), dropping back to quarterly once it settles. Never run it blind — an audit without fresh evidence (new gates, new incidents) just restates the last table, so **any scheduled runner must self-skip when no gate has changed since the most recent `audits/` record** (compare `git log` on the gate files and merged PRs touching `.claude/`, `.github/workflows/`, and `CONTRIBUTING.md` against that record's date; run only if something moved).

## Anti-patterns

Trimming a gate that can name its incident · micro-optimizing seconds of wall-clock while ignoring per-session token loads and user round-trips · verdicts from vibes ("feels heavy") instead of evidence · treating a timeout cap as the cost (a 30s cap ≠ 30s spent) · letting this skill itself bloat — it stays under a page.

## References

`.claude/rules/workflow.md` rule 10 (safe/reversible autonomy — the apply mandate) · `audits/` (previous decision tables, the diff base) · the task-observer observation log (evidence source; local and gitignored, never committed).
