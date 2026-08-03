# AGENTS.md

Orientation for any coding agent working in this repository (Codex CLI, Cursor, and
anything else that reads `AGENTS.md`). Claude Code reads `.claude/rules/` directly and
does not need this file; it is here so every other agent starts from the same place
instead of guessing.

This file is a **map, not a copy**. Everything below points at the document that owns
the subject, so there is nothing here to keep in sync.

## What this is

Alethical makes Minnesota legislative records understandable: bills, votes, and
legislators, in plain language, with every claim traceable to an official source.
Read [`docs/philosophy.md`](docs/philosophy.md) first — it explains why most of the
rules below exist.

## Read before you change anything

- [`.claude/rules/coding-discipline.md`](.claude/rules/coding-discipline.md) — how to
  approach a change: think first, ship the minimum, keep the diff surgical, define a
  verifiable goal.
- [`.claude/rules/grounded-answers.md`](.claude/rules/grounded-answers.md) — the
  product invariants for anything that generates, displays, or advertises an answer.
  **Cite or refuse** is the one that governs everything else.
- [`.claude/rules/workflow.md`](.claude/rules/workflow.md) — branch and PR conventions,
  where decisions get recorded, and the checks a change has to clear.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, the commands, and the human-facing
  version of the same conventions.
- [`docs/README.md`](docs/README.md) — index of every spec. Specs describe intent;
  **GitHub issues and the Roadmap board carry sequencing**, so never read a milestone
  in prose as a reason work is off-limits.

## Layout

- `alethical/` — Python backend: API, database models, migrations, ingestion, tests.
- `apps/frontend/` — Expo React Native app. The shipped target is **web**.
- `scripts/` — repo-level Python utilities.
- `docs/` — product, design, architecture, and validation notes.

## Commands

Setup and the full command list live in [`CONTRIBUTING.md`](CONTRIBUTING.md). The four
you will reach for:

```bash
just up        # Postgres + backend (:8000) + web frontend (:19006)
just format
just lint
just migrate
```

Frontend tests are Vitest, run from `apps/frontend`. Backend tests are pytest and need
the local Postgres that `just up` starts.

## Hard lines

- **Never invent a fact about a bill, vote, or legislator.** If it is not in the
  database or an official source, the honest answer is that we do not have it. See
  [`.claude/rules/grounded-answers.md`](.claude/rules/grounded-answers.md) rule 1.
- **Never fire an irreversible action to prove a change works** — a real send to real
  users, a paid run, or a destructive production data or schema change. Keep the live
  trigger behind config and verify with a dry run.
- **Never run destructive git in a shared checkout** (`git reset --hard`,
  `git clean -fd`, `git checkout .`, switching branches). Several agents work in this
  repo at once, in separate worktrees, and these commands silently destroy work that
  is not yours. Scan open PRs and issues before starting so you do not duplicate work
  already in flight.
- **Four more git commands destroy other agents' work without looking destructive**,
  so a rule that says "no destructive git" does not cover them, and neither does a
  reviewer or classifier scanning for dangerous-looking commands. The first and last
  caused real incidents here; the middle two were found by testing what a shared
  checkout actually permits:
  - `git stash` — scoops up every other agent's in-flight edits, and popping it moves
    merged code backwards.
  - `git update-ref` pointed at someone else's branch. `git update-ref refs/heads/<b>
    <commit>` moves a branch another worktree has checked out, silently, with no output
    at all; `git update-ref -d refs/heads/<b>` deletes one, where `git branch -D`
    refuses. No git version guards this — plumbing carries no safety checks — so this
    one is a rule, not a mechanism. `git checkout -B <branch>` used to do the same, and
    git 2.44.0 closed it; this Mac runs 2.55.0, where `checkout`, `switch`, `rebase`,
    `branch -f` and `branch -D` all refuse a branch another worktree holds. Treat a
    refusal as git telling you the branch is someone else's, not as an obstacle to
    route around.
  - `git worktree remove --force <path>` — deletes a worktree *and* its uncommitted
    work. No git version guards this either. `just worktree` locks what it creates, so
    the command refuses and prints the lock reason; `just worktree-rm` unlocks first, so
    the intended cleanup path still works. A second `--force` overrides the lock, which
    is the deliberate escalation, not the accident.
  - Creating a branch in the shared checkout at all — it yanks the checkout off `main`
    while others are using it.

  To compare against another revision, read it out of git's object store —
  `git show origin/main:<path>` — and never touch the working tree. To write, make your
  own worktree: `just worktree <branch>`.
- **`.claude/worktrees/` holds other agents' live branches, and it is gitignored** —
  so it is invisible to `git status` and to any check that only looks at tracked files.
  It is inside this folder, but it is not scratch space and it is not yours: treat every
  path under it as another agent's working tree. Do not edit, delete, reformat, or run a
  project-wide replace across it, and exclude it from any sweep of ignored or
  "temporary" files. `.cursorignore` fences this path off for Cursor specifically, since
  a prose rule is not a mechanism; if your tool has an equivalent, use it too.
