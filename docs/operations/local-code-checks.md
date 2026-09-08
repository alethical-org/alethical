# Local code checks

<!-- describes: .githooks/**, .github/check-paths.json, .github/workflows/ci.yml, .github/workflows/pr-description.yml, .vscode/**, justfile, lint-staged.config.mjs, scripts/local_checks.py, scripts/install_git_hooks.py, scripts/format_frontend.mjs, scripts/check_pr_descriptions.py, scripts/check_doc_sync.py, scripts/tests/test_local_checks.py, scripts/tests/test_staged_checks.py, scripts/tests/test_pr_description_checks.py -->

Alethical uses the same local checks in Cursor, Codex, Claude Code, and a terminal.
Git runs the helpers when saving a commit or uploading commits, regardless of which
editor starts the command. Repository settings choose the formatting, not a person's
Cursor defaults. GitHub still decides whether a change may merge.

## Setup and activation

Run `just setup` in each worktree from a branch that contains these helpers. It
installs the exact saved Python and frontend dependencies, then installs 3 Git hooks:

| When | Helper | Result |
| --- | --- | --- |
| A worktree is created | `post-checkout` | Keeps the existing protection that locks the new worktree against accidental removal |
| A commit is saved | `pre-commit` | Checks and formats supported files selected for that commit |
| Commits are uploaded | `pre-push` | Tests each distinct upload commit in an isolated temporary worktree |

[`scripts/install_git_hooks.py`](../../scripts/install_git_hooks.py) copies all 3
helpers into a versioned folder inside Git's shared storage. It changes
the current worktree's `core.hooksPath` only after the complete copy is ready.
Previous versions remain available for recovery and commands already running. Custom hooks stop installation
until their owner arranges a migration; installation never silently replaces them.
GitHub skips local hook installation and uses its own checks.

The full check profile is scoped to the worktree running setup, using Git's
`extensions.worktreeConfig` and `git config --worktree`. Existing worktrees keep
their own settings, branches, and unfinished edits. A fresh clone also receives a
shared lock-only profile so new worktrees retain the accidental-removal protection.
Existing shared hooks are preserved. Unsupported custom layouts stop installation.

Git copies per-worktree settings when creating a new worktree from an activated
one, so that new worktree inherits the full check profile. Install its dependencies
before committing. Creating a worktree from an unactivated parent keeps that
parent's existing shared protection. Existing sibling worktrees are not changed.

The root package's `prepare` command activates the current worktree's checks after
a normal `pnpm install --frozen-lockfile`; `just setup` also calls the installer
explicitly. GitHub and isolated upload tests set `CI` and skip installation.
Fetching code alone does not activate an older worktree. Its owner adopts the
checks by updating its branch and installing the saved dependencies. An activated
worktree switched to a branch missing the helper cannot commit or push until that
branch is updated. The common lock still protects other worktrees meanwhile.

[`CONTRIBUTING.md`](../../CONTRIBUTING.md#first-time-setup) owns prerequisites and
starting local Postgres. Keep Postgres running on port 54329 before uploading server
changes. The push check does not start Docker itself.

## Formatting the selected files

The files selected for the next commit are Git's staged files. The commit hook and
`just format-staged` use the same saved selection. Python files under `alethical/`
and `scripts/` receive Ruff's code check and formatting at version `0.15.0`.
Supported frontend files receive the exact Prettier version in
[`apps/frontend/package.json`](../../apps/frontend/package.json), currently `3.9.6`.
The helper explicitly supplies the frontend settings and ignore list.

[`lint-staged.config.mjs`](../../lint-staged.config.mjs) chooses these file groups.
The selected-file helper temporarily hides unfinished edits, formats the selected
content, puts the formatted result into the commit, and restores unfinished edits.
This includes a file where only some edits were selected. Backup and rollback remain
enabled. A failure stops the commit; it does not silently include the unfinished
work. Merge conflicts and unfinished changes to formatting settings stop the run
until resolved. Missing or mismatched dependencies also stop it.

Use `git diff --cached` to review what the next commit includes and `git diff` to
review what remains unfinished. Resolve a reported restoration conflict before
retrying. Do not discard another task's changes to make a formatting check pass.

[`scripts/format_frontend.mjs`](../../scripts/format_frontend.mjs) also serves
`just format`, `just lint`, and GitHub. `just format` intentionally covers whole
code areas; `just lint` checks formatting without changing files. A large formatting
diff is a reason to examine the version, settings, and edits, not automatic permission
to accept unrelated changes.

Cursor and VS Code read the shared
[editor settings](../../.vscode/settings.json) and
[extension recommendations](../../.vscode/extensions.json). Saving a file uses the
project formatter and settings when those extensions and dependencies are installed.
The Git hooks remain the common check for Codex, Claude Code, and other editors.

## Testing the exact upload

[`scripts/local_checks.py`](../../scripts/local_checks.py) reads the commit IDs Git
intends to upload, rather than assuming the open folder contains that code. For each
distinct commit, it compares against the remote's existing commit. A new branch uses
its common starting point with `origin/main`, or the whole saved tree if that point
is unavailable. A missing existing remote commit stops the upload and asks for a
fetch. Deleted remote branches upload no code and need no suite.

The changed paths select suites through
[`.github/check-paths.json`](../../.github/check-paths.json), also used by GitHub.
An affected area runs its entire suite, not just tests near changed files. Shared
check machinery selects both areas. Files outside both groups select neither.

| Affected area | Checks before upload |
| --- | --- |
| Frontend app | Saved dependencies, package and build-tool compatibility, selected-file helper fixtures, frontend formatting, TypeScript, and the full `just test-frontend` suite |
| Python server | Saved and declared dependencies, local-check helper fixtures, Ruff code and formatting checks, ty, and the full `uv run --frozen pytest` suite |

When both areas change, they run together. The helper waits for both to finish
before removing its temporary worktree, including when a check fails. A failure
stops the upload. Running time varies with dependency setup, the suites, and the
computer; the check promises complete affected coverage, not a fixed duration.

The temporary worktree contains the exact saved upload commit. It does not borrow
unfinished files, the developer's `.env`, or inherited service credentials. An empty
local `.env` prevents parent-folder settings from leaking in. The supplied database
address is fixed to local Postgres on port 54329, and the normal worktree-specific
database setup keeps that test data separate. Logs stay in the temporary worktree.
The helper removes only the temporary worktree it created.

Local checks can be bypassed or absent in a fresh clone. GitHub's required checks
remain the final gate, including checks absent locally such as the production web
build. Local tests do not prove browser behavior or replace a real user-flow check.

## GitHub description-check activation

Phase 1 adds an independent `description-checks` result through
[`.github/workflows/pr-description.yml`](../../.github/workflows/pr-description.yml).
It runs on pull request opens, code updates, reopens, ready-for-review events,
description edits, and merge-queue checks. Editing prose does not launch the frontend
or backend jobs and cannot replace a failed code result with a skipped or passing one.

The check reads the latest description and code IDs from GitHub. It requires a
visible, nonempty `Docs check:` explanation when changed code matches a document's
declaration. Hidden comments and fenced examples do not count. Both the base and
proposed declarations count, including renamed paths. A removed declaration cannot
silently remove its own review requirement.

For a merge queue, the check finds the queued change and every earlier change in
that combined group, then validates their latest descriptions and code IDs. It
reads those identities again before passing. Missing queue data, too many entries
for the bounded lookup, changed identities, or an API failure stop the check.

The workflow uses a read-only GitHub token and no repository secrets. It runs as
`pull_request`, not the privileged `pull_request_target` event. This allows the
helper to run in its introducing change before it exists on the base branch, without
giving the proposed code write access. It never posts replacement code-check results.

Phase 1 retains the original description step in the required `changes` job in
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). That original step
reads the event's stored description. Therefore a corrected explanation can pass
`description-checks` while the older `changes` result still fails. Rerunning the
old event does not refresh its saved description. This temporary overlap preserves
the existing merge protection while the new workflow receives live proof.

Phase 2 is planned, not activated by merging the workflow file. After a real pull
request and nonempty merge-group run prove the new check, the release owner adds
`description-checks` from GitHub Actions to the required checks on `main`, retaining
`changes`, `backend`, `frontend`, and every other protection. A separate change then
removes only the old description step and aligns the settings and workflow guides.
Rollback restores the old step before removing the new required check.

[Keeping docs current decisions](keeping-docs-current-decisions.md) owns the
description-check design. [Repo and service settings](repo-and-service-settings.md)
owns the intended hosted settings; neither a local hook installation nor this
checklist changes GitHub's live settings.

## Implementation and verification checklist

This checklist distinguishes code present in this change from release and activation
proof. The release owner updates unchecked items with outcomes before closing the work.

- [x] Shared setup, versioned hook installer, selected-file formatter, and exact-upload
  test helper are present with focused fixtures.
- [x] The independent description workflow and fresh-description fixtures are present;
  the original required description step remains.
- [x] Focused checks cover 12 upload-selection cases, 19 description cases, and
  19 real Git/formatter/installer cases. Python formatting and lint pass.
- [x] A draft description edit fails for a missing explanation and passes after
  restoring it, without another code upload or another CI run:
  [missing explanation](https://github.com/alethical-org/alethical/actions/runs/34241482500),
  [restored explanation](https://github.com/alethical-org/alethical/actions/runs/34241556141),
  [unchanged code-check run](https://github.com/alethical-org/alethical/actions/runs/34241355367).
- [ ] Complete full affected local suites and current-head GitHub checks after the
  resource hold clears, then merge phase 1.
- [ ] Prove fresh descriptions and code IDs in a nonempty merge-group run, including
  access with the workflow's read-only token.
- [ ] Activate this task's worktree with `just setup` and exercise an actual commit
  and upload safely. Other active owners adopt the checks through their normal
  dependency installation without changing their in-progress branches on our behalf.
- [ ] Add the proven `description-checks` context to required GitHub checks while
  retaining all existing protection.
- [ ] Merge phase 2 removing only the old description step and update
  [`CONTRIBUTING.md`](../../CONTRIBUTING.md),
  [Repo and service settings](repo-and-service-settings.md), and
  [workflow rules](../../.claude/rules/workflow.md) to describe the active state.
