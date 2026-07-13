#!/usr/bin/env bash
# Leak-guard for this PUBLIC repo.
#
# Wired as a PreToolUse/Bash hook in .claude/settings.json, scoped to
# `git commit *` via the hook's `if` filter, so it runs only when a commit is
# about to happen. It blocks (exit 2) if any staged file matches a path that
# must never be published here:
#   - task-observer's per-session logs (skill-observations/, skill-updates/)
#   - a real .env secret file (.env, .env.local, ... but NOT .env.example)
#
# This is a backstop to .gitignore — it catches `git add -f` and gitignore
# gaps that would otherwise let a secret slip into a public commit.
set -uo pipefail

staged="$(git diff --cached --name-only 2>/dev/null || true)"
[ -z "$staged" ] && exit 0

hits="$(printf '%s\n' "$staged" \
  | grep -E '(^|/)(skill-observations|skill-updates)/|(^|/)\.env(\.[^/]+)?$' \
  | grep -vE '(^|/)\.env\.example$' || true)"

[ -z "$hits" ] && exit 0

{
  echo "COMMIT BLOCKED — files that must not be committed to this public repo are staged:"
  while IFS= read -r f; do [ -n "$f" ] && echo "  • $f"; done <<< "$hits"
  echo
  echo "Fix:  git restore --staged <file>   then commit again."
  echo "Guard: .claude/hooks/block-sensitive-commit.sh — edit the patterns there if this is a false positive."
} >&2
exit 2
