---
name: worktree-triage
description: Use when taking stock of git worktrees and branches across parallel Claude sessions and deciding what to merge, land, realign, or delete — triggered by "which worktrees are behind main", "what's safe to clean up", "is any work at risk", worktree sprawl after multi-session work, or a periodic multi-session hygiene sweep.
---

# Worktree triage

## Core insight

Parallel Claude sessions leave a trail of worktrees and branches. The instinct is to sort them by how far **behind** `origin/main` they are — but behind-count is the wrong signal and will mislead you:

- **`ahead` (unique commits), not `behind`, decides whether there is anything to merge.** A branch 75 commits behind with `ahead=0` contains *nothing* that isn't already in main — there is nothing to merge and nothing to "realign." A branch 0 behind can still be hiding the most important thing on this list.
- **The highest-value catch is local-only: uncommitted edits and unpushed branches.** These never reach `origin`, so they are invisible to any PR, any teammate, and any cloud/remote agent. Lose the machine or `git worktree remove` the wrong dir and the work is gone. This is why the sweep **must run locally**, in a session that can see the worktrees on disk.
- **"Looks ahead" can still be stale.** A branch whose commits already landed in main by another path shows `ahead>0` but is cherry-equivalent — effectively dead weight.

## When to use

- On demand — the worktree list feels crowded, or before a cleanup pass.
- Before starting new work — dovetails with `.claude/rules/workflow.md` rule 1 (scan open PRs on your target files first); this sweep surfaces exactly that.
- Weekly backstop (**recommended over a daily routine**) — a self-skipping *local* reminder. Not a daily cloud routine, for two reasons: (1) the highest-value signals (uncommitted / unpushed work) exist only on the local machine, so a cloud agent sees only `origin` and misses what matters most; (2) worktrees don't churn daily, so a daily report becomes noise you learn to ignore — the failure mode `workflow-overhead-audit` exists to prevent.

## Procedure

**1. Fetch first — always.** Behind/ahead counts go stale the moment another session merges (origin advances mid-session).

```bash
git fetch origin main --quiet
```

**2. Sweep every worktree** for ahead / behind / dirty state in one pass:

```bash
git worktree list --porcelain | awk '
  /^worktree /{wt=$2}
  /^HEAD /{head=$2}
  /^branch /{br=$2}
  /^detached/{br="(detached)"}
  /^$/{if(wt!=""){print wt"\t"head"\t"br; wt="";br="(detached)"}}
' | while IFS=$'\t' read -r wt head br; do
  ab=$(git rev-list --left-right --count origin/main...$head 2>/dev/null)
  behind=$(echo "$ab" | cut -f1); ahead=$(echo "$ab" | cut -f2)
  dirty=$(git -C "$wt" status --porcelain 2>/dev/null | grep -v -E 'node_modules|/dist/|\.log$' | wc -l | tr -d ' ')
  printf "behind=%-4s ahead=%-4s dirty=%-3s %s [%s]\n" "$behind" "$ahead" "$dirty" "$(basename "$wt")" "$br"
done
```

**3. Inspect anything flagged dirty.** Run `git -C <worktree> status --short` on each; treat modifications to tracked *source* files as at-risk work. Disregard `node_modules` and generated output.

**4. Map branches to open PRs:**

```bash
gh pr list --state open --limit 50 --json number,headRefName,title \
  --template '{{range .}}#{{.number}}  {{.headRefName}}  —  {{.title}}{{"\n"}}{{end}}'
```

**5. For any branch that looks `ahead` but has no PR, confirm it's genuinely unmerged:**

```bash
git cherry -v origin/main <branch>   # + = NOT in main (real work);  - = already in main (stale despite looking ahead)
```

## Buckets and what each means

- 🔴 **Active / at-risk** — has uncommitted source edits OR an open PR. **Never suggest deleting these.** Surface invisible uncommitted work **first and loudest** — it's the whole reason the sweep runs locally.
- 🟡 **Orphaned unmerged work** — genuine unique commits (`git cherry` shows `+`), no PR. For each: say what it is, how far it's drifted, and give a land-or-drop recommendation. Drifted doc-only commits are cheap to land or drop *now*; left alone they become the stale shadow `workflow.md` rule 3 warns about.
- 🟢 **Stale, nothing to preserve** — `ahead=0` (or cherry-equivalent) and clean. Safe to `git worktree remove` / delete the branch. Flag any named after a task that might just be **parked**, not abandoned.

## Output contract

Produce a **recommendation, not just a table**: what to merge and when, what to land or drop, what to delete. Apply the core insight — never recommend "realigning" a stale checkout that has no unique work; for fresh work you branch from `origin/main` anyway.

## Guardrails

- Read-only by default. Advise and offer; wait for an explicit go before any `git worktree remove`, branch deletion, or merge.
- **Never touch a worktree owned by another session** — even a clean, `ahead=0` one may be parked, not dead.
- The **one** autonomous action: flag at-risk uncommitted work loudly. Never *resolve* it — don't commit or stash another session's edits.

## Improve this skill as it's used

This procedure is only as good as the signals it checks, and new failure modes will appear (a signal the sweep never looks at, a bucket label that misled). Keep it honest — the review is part of the skill, not optional:

- **Before running (cheap insurance):** grep `skill-observations/log.md` for OPEN observations tagged `worktree-triage` and apply them this run (per `~/.claude/CLAUDE.md`).
- **After running (primary — this is when you have evidence):** ask *did the triage match reality?* Two gap signals:
  - It called a worktree 🟢 safe, but it actually held work that mattered → the sweep is **missing a signal**.
  - Something important surfaced that no step asked for (e.g. a branch behind-only but with an open PR carrying merge conflicts) → the procedure has a **blind spot**.
  If either happened, log it (`### Observation N`, `Skill: worktree-triage`) **and**, when it's a real procedural gap, fix the step in the same session — editing this skill is safe and reversible (`workflow.md` rule 10), so don't ask, just do it and note it.
- **During:** only if something genuinely surprising surfaces mid-sweep; otherwise defer to the after-check.

Recommended cadence for the review: **after every run** is primary (evidence in hand), **before** is the cheap pre-flight. Don't force a "during" review.
