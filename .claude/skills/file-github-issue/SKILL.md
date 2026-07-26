---
name: file-github-issue
description: Use when creating, categorizing, re-scoping, or sweeping GitHub issues on Alethical's Roadmap board (org `alethical-org` Project #1) — the full 8-axis scheme (Type, Milestone, Epic, Platform Track, Priority, LOE, topic labels, Status), the two-step create-then-set-board-fields gotcha, the uncategorized-item sweep command, and the keep-the-board-current lifecycle rules. Invoke before `gh issue create`, when moving an issue's Status, or when starting a session and sweeping the board.
---

# Filing and categorizing a GitHub issue on the Roadmap board

The Roadmap board (org `alethical-org` Project #1 "Alethical Roadmap") is the source of truth for issue categorization. `.claude/rules/workflow.md` rule 4 (Route knowledge at birth) owns the *policy*; this skill holds the mechanics.

**Before you touch the board, re-read `.claude/rules/workflow.md` rule 4's resident prohibition:** only ever set item field *values* and board membership — never create, rename, reorder, or delete fields or single-select options. That rule stays always-loaded for a reason; nothing here overrides it.

## The 8 axes — each question has exactly one home

The July 2026 consolidation retired the old `v0`/`post-v0` scope labels, the `bug`/`enhancement`/`documentation`/`question` kind-labels, the `data`/`ops`/`chat` topic-labels, and the `effort:` labels.

- **Type** (native Issue Type: `Bug` / `Feature` / `Task`) — *what kind of work.* A docs task = `Task` + `documentation` label, not a separate type. Org-level, single-select, does not apply to PRs.
- **Milestone** — *which release/phase.* `v0 hardening` → `v1` → `v2` → `v8 elections` → `v9 tbd` (the numeric `v#` prefix forces the list order; defer work by **moving an issue to a higher-numbered bucket**, never by renaming a milestone). Single source of truth for phase — no fractional milestones. Note rule 13: milestone is irrelevant to *staffing* — a later bucket is never a reason to leave goal-supporting work unowned.
- **Epic** (project single-select) — *which product area.* Grounded Ask & AI · Bills · Legislators · Votes & roll-calls · Candidates & Elections · Data & Ingestion · Platform & Ops · Tracking & Notifications · Home & Navigation · Notes & Pending (last = parked zero-risk items). Platform items also take a **Platform Track** (CI & Testing / Backend architecture / Deploy & Ops / Security & auth).
- **Priority** (project single-select: Urgent / High / Medium / Low) — *how important*, **decoupled from milestone** (a High item sitting in v2 = a pull-forward candidate; a Low item in v0 hardening = must-do-soon but unimportant).
- **LOE** (project **number** field) — *how big*, in points (small ≈ 1, medium ≈ 3, large ≈ 8) so views can **sum** it per epic/milestone. Parent epics carry **no** LOE (children only), so roll-ups don't double-count.
- **Topic label** — *which stack layer.* `frontend` / `backend` / `documentation` / `auth` (cross-cutting facets; product areas are Epics now). Applies to PRs too.
- **`research` label** — *work-character marker* (additive, not a stack layer): apply when the issue's main job is investigation — a spike, an eval, empirical tuning, or resolving an unknown to pick an approach before building (incl. agent-persona research). It keeps its Type and Epic; the label just flags the character so research/spike work is filterable.
- **Status** (project Kanban) — *where it is in flight.* Backlog → Ready → In progress → In review → Done.

Labels go in the `gh issue create` / `gh pr create` `--label` call; Type, Epic, Priority, LOE, and Status are native/project fields set via the Projects GraphQL API (`updateProjectV2ItemFieldValue`, `addProjectV2ItemById`, `addSubIssue`) — query the project's field/option IDs with `gh api graphql` (needs the `project` token scope). An uncategorized issue is the exception to fix, never the norm.

## Categorizing is two steps — and any session sweeps for ones that missed step two

`gh issue create` sets only *repo* fields (`--label`, `--milestone`); the **board fields (Epic, Priority, LOE, Status) and the native Type are NOT set by it** and need a follow-up (Projects GraphQL or the board UI). An issue that lands in **"No Epic"** or with a blank Priority/LOE/Type is the tell that step two was skipped — this is how #416 slipped in (created with just a `backend` label). So **(a)** categorize fully at creation, and **(b)** as a self-healing backstop — don't trust that the creating session did it — whenever you start a session or touch the board, run the sweep and fix whatever it lists:

```
gh project item-list 1 --owner alethical-org --format json --limit 200 \
  | jq -r '.items[] | select(.content.type=="Issue")
      | select(.epic==null or .status==null
               or (.priority==null and .epic!="Notes & Pending")
               or (.milestone==null and .epic!="Notes & Pending")
               or (.lOE==null and (.content.title|startswith("Epic:")|not)))
      | "#\(.content.number) \(.content.title)"'
```

The exclusions are by design: Notes & Pending items are priority/milestone-less, and `Epic:` parent issues carry no LOE (so roll-ups don't double-count). Type isn't in the project item-list, so also spot-check it (`gh issue list --json number,issueType`). Enable the project's **Auto-add** and **"Item added → Status: Backlog"** workflows so new issues at least reach the board in Backlog automatically; the judgment fields (Epic/Priority/LOE/Milestone/Type) still require a session to set.

## Keep the board current through the work lifecycle — every session, not just at creation

The board is only useful if it reflects reality, so whenever a session **starts, changes, finishes, or discovers** work, update the item the same session:

- Move **Status** — work started → In progress; PR open → In review; merged → Done.
- **Close the issue** when its work ships (`Closes #n` in the PR, or manually — closed issues auto-archive off the board).
- **Add new issues to the board** fully categorized and **nested under their parent epic** when part of one (enable the project's *Auto-add* workflow so new issues land in Backlog automatically; until then, add them by hand).
- **Re-set Milestone / Epic / Priority / LOE / Type / labels** whenever the work changes the answer.
- On any scope change, search for and fix the stale issues and descriptions it affects (`.claude/rules/workflow.md` rule 6, After a scope change) — including the **milestone and epic descriptions themselves**, which encode the phase/boundary rules (e.g. what belongs in each epic), so keep them current as scope evolves.

Leaving the board trailing reality is the exception to fix, never the norm.

## Issue and PR body format

Every issue, PR body, and substantive comment leads with a plain-language **Net:** line, and every acceptance-criteria item carries its own inline `— Net:` gloss (`.claude/rules/workflow.md` rule 11, Lead with a plain-language "Net:" line).
