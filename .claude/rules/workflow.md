# Session workflow rules

This is the always-available working map. The full rules, exceptions, checks and
supporting evidence live in [development-workflow.md](../../docs/operations/development-workflow.md).
The rule numbers below keep existing references usable. Read the linked rule when
its trigger applies, before the dependent action; read only the relevant sections.
If a required source is unavailable, hold that action and continue independent work.
These instructions do not widen the user's scope, spending approval or explicit holds.

## How we work — the shape

- Work in your own worktree from current `origin/main`; check open PRs, issues and
  recent changes before writing. Keep the folder and branch for follow-up.
- Carry authorized work through tests, independent acceptance, a PR, current-head
  checks, merge, deployment and live verification. A draft or green old head is not done.
- Act, then report on safe, reversible, verifiable work. Never fire an unverified
  irreversible external effect or treat a missing guide as permission.
- Keep facts grounded, decisions in their owning docs and tasks in categorized issues.
  Preserve uncertainty; a verified example does not establish a population claim.
- Scope edits to the request. Use existing solutions and meaningful tests; update
  every affected guide and stale claim in the same delivery.

## Shared files and irreversible effects

Check your working directory before **any write**, not just a Git command. The shared
checkout `/Users/eug/Code/Alethical`, its refs and `.claude/worktrees/` are other tasks'
live state. The latter is ignored by Git and is never scratch space: exclude it from
file sweeps, replacements and formatting. Read other revisions with
`git show origin/main:<path>`; write only in your own worktree.

Never run `git reset --hard`, `git clean -fd`, `git checkout .`, branch switching or
branch creation in the shared checkout; never `git stash`, `git update-ref` on a
branch you do not own, `git checkout --ignore-other-worktrees -B <branch>`, or
`git worktree remove --force <path>`. `/usr/bin/git` is Apple's older Git without
the newer branch guard. Install the 3 hooks with `just install-hooks` **before any
`git worktree add`**. Read [rule 10](../../docs/operations/development-workflow.md#rule-10)
for verification, recovery, lock limits and the required supported cleanup route.
No permission prompt or lock proves loss is prevented.

Unapproved sends to real users, unverified spending and destructive production
data/schema/access changes remain barred. Engineer a safe dry run, rollback and
scoped read-back before a live effect. Controlled email tests are limited to the
verified authorized maintainer/test mailbox and requested acceptance check, through
the real flow with rate and access limits intact; no tokens in committed evidence.
Before these actions, read [rule 10](../../docs/operations/development-workflow.md#rule-10)
and [when-to-act-without-approval](../skills/when-to-act-without-approval/SKILL.md).
Paid runs use the guide's sufficient-free-path, verified-budget and comparative-gap
conditions; standing autonomy does not erase spending limits or host-required approval.

Only set project-board **item values and membership**. Never create, rename, reorder
or delete fields/options/views without explicit in-session approval. Read
[rule 4](../../docs/operations/development-workflow.md#rule-4) and
[file-github-issue](../skills/file-github-issue/SKILL.md) before board work.

## Page-return handoffs and acceptance

Every Design review, build brief and changed page follows
[contextual page-return links](../../docs/design/design-principles.md#contextual-page-return-links)
and the [page-return acceptance procedure](../../docs/operations/development-workflow.md#page-return-handoffs-and-acceptance).
A contrary handoff cannot waive the rule. Settled corrections go in authorized builds;
open visual/product choices retain their existing approval boundary.

## The rules

Each numbered link is the full owning rule, not optional background.

1. **Starting or resuming changes:** [Target branch first](../../docs/operations/development-workflow.md#rule-1).
   Inspect ownership and recent work; no cleanup without an explicit request and every
   owner's release. Age, silence, a merge or a clean folder never authorizes removal.
2. **Starting, resuming and finishing a job:** [Milestones and job evidence](../../docs/operations/development-workflow.md#rule-2).
   Register before substantive work; bind helpers, keep honest help/retry notes, commit
   milestones and use the source-reading completion check. Never manufacture trial jobs.
3. **Receiving or handing off a file copy:** [Share branches](../../docs/operations/development-workflow.md#rule-3).
4. **Discovering a fact, decision, task or changed issue:** [Route knowledge](../../docs/operations/development-workflow.md#rule-4).
   A settled conversation decision still needs its owning doc updated in the same session.
5. **Making a repo, scope, population or consequence claim:** [Verify it](../../docs/operations/development-workflow.md#rule-5).
6. **Changing behavior, scope or a described image:** [Update every affected claim](../../docs/operations/development-workflow.md#rule-6).
   Read whole affected guides; keep the PR's `Docs check:` and stale-reference record.
7. **Naming an artifact:** [Use literal newcomer language](../../docs/operations/development-workflow.md#rule-7).
8. **Citing a spec, issue or PR:** [Name and link the exact source](../../docs/operations/development-workflow.md#rule-8).
9. **Putting a factual claim into product content:** [Read the primary source](../../docs/operations/development-workflow.md#rule-9).
10. **Choosing an action, touching shared state, accessing or setting up accounts, testing live,
    spending, migrating or releasing:** [Autonomy, boundaries and verification](../../docs/operations/development-workflow.md#rule-10).
    Before merging, include current main and verify required checks on the reviewed head,
    with independent requirement coverage and resolved substantive review findings. No bypass.
11. **Writing an issue, PR or substantive comment:** [Plain-language Net and recovery](../../docs/operations/development-workflow.md#rule-11).
12. **Starting expensive background research:** [Checkpoint and resume](../../docs/operations/development-workflow.md#rule-12).
    No overage or promised threshold stop without an armed mechanism.
13. **A goal spans issues or needs another session:** [Active owners and report-back](../../docs/operations/development-workflow.md#rule-13).
14. **Implementing or reviewing a change:** [Scope, reuse, tests and complete design acceptance](../../docs/operations/development-workflow.md#rule-14).
15. **Combining independent reviews:** [Union before arbitration](../../docs/operations/development-workflow.md#rule-15).
16. **Writing or moving a rule, doc or durable decision:** [One current owner](../../docs/operations/development-workflow.md#rule-16).
    Keep requirements and useful evidence; cut diary and internal attribution. Update
    affected callers and enforcing checks together; never turn a proposal into approval.
