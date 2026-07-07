# Session workflow rules

Machine-facing counterparts of the human conventions in `CONTRIBUTING.md`. Follow both; when they seem to conflict, CONTRIBUTING.md wins.

1. **Target branch first.** Establish at the start which branch or PR the work belongs to; switch the worktree there and edit in place. Don't build on a session branch and port the files later.

2. **Commit and push at milestones, not at session end.** Uncommitted work is invisible — not in the PR, not reviewable, not recoverable by anyone outside the conversation. When a coherent chunk lands, commit it.

3. **Share branches, not file copies.** If the user hands you a loose copy of a repo file (Downloads, attachment), diff it against the branches before building on it — it may duplicate or trail a branch. Land durable content on a branch promptly, and point people at branches/PRs rather than exporting files.

4. **Route knowledge at birth.** Decisions → the relevant spec in `docs/`. Tasks and deferred work → GitHub issues, filed at the moment of discovery with: what it is · what exists today · why deferred · what unblocks it (then cross-link the issue number back into the doc that spawned it). Product invariants → `.claude/rules/`. Team workflow norms → `CONTRIBUTING.md`. Chat is a scratchpad, never a system of record.

5. **Verify cheap repo facts before deciding on them.** If a claim is one `diff`, `git log`, or `grep` away from certain (which version is newer, does the model have that field, is the file gitignored), check it before building work or advice on top of it.
