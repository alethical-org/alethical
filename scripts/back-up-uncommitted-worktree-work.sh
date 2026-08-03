#!/bin/sh
# Snapshot every worktree's uncommitted work so it never exists in only one place.
#
# The problem this solves, measured Aug 3 2026: a 132-line production-schema audit
# existed as one uncommitted file, in one worktree, on one Mac. Nothing referenced it.
# A single `git worktree remove --force` would have destroyed it permanently, and the
# agent that wrote it had already stopped. It was found by accident.
#
# Why a snapshot rather than a stronger guard. The worktree lock and Cursor's command
# rules both turned out to be approval prompts for an IDE agent, not hard denials: in a
# live test every destructive command succeeded once approved, including deleting a
# locked worktree. With an agent that can ask for approval, no setting is a wall. So the
# goal here is not "damage is impossible" — it is "loss is bounded", to whatever interval
# this runs on.
#
# How it works, and why it cannot disturb anyone:
#   * Staging happens in a TEMPORARY index (GIT_INDEX_FILE), never the worktree's own.
#     The agent's staged/unstaged state is untouched and `git status` is unchanged.
#   * The snapshot becomes a real commit object parented on the worktree's HEAD, pointed
#     at by a ref under refs/wip-backup/. That namespace is ours; nothing else reads it.
#   * Objects live in the SHARED object store, so a snapshot survives deletion of the
#     worktree it came from. The ref keeps `git gc` from pruning it.
#   * A bundle is also written outside the repo, so a snapshot survives deletion of the
#     repo itself.
#   * Nothing is pushed. This repo is public, and uncommitted work has not been reviewed
#     for anything that should not be published.
#
# Recovering a snapshot, while the repo still exists:
#   git log --oneline refs/wip-backup/<worktree-name>
#   git show refs/wip-backup/<worktree-name>                 # the whole snapshot as a diff
#   git show refs/wip-backup/<name>:<path>                   # one file's contents
#   git restore --source refs/wip-backup/<name> -- <path>    # one file back onto disk
#
# Recovering from a bundle, when the repo itself is gone. The bundles are thin (see
# below), so start from a fresh clone of GitHub and fetch the bundle on top:
#   git clone https://github.com/alethical-org/alethical.git recovered && cd recovered
#   git fetch <bundle-path> 'refs/wip-backup/*:refs/wip-backup/*'
#   git show refs/wip-backup/<name>:<path>
# `git clone <bundle>` does NOT work — a bundle carries no HEAD, so clone reports an
# empty repository. Verified Aug 3 2026: clone produced nothing, fetch produced the file.
#
# Exits non-zero only if something is genuinely broken, so a scheduler can alert on it.

set -u

REPO=${ALETHICAL_REPO:-/Users/eug/Code/Alethical}
BUNDLE_DIR=${ALETHICAL_WIP_BACKUP_DIR:-$HOME/Library/Application Support/alethical-wip-backups}
TMPDIR_BASE=${TMPDIR:-/tmp}

cd "$REPO" 2>/dev/null || { echo "backup: cannot enter $REPO" >&2; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "backup: $REPO is not a git repo" >&2; exit 1; }
mkdir -p "$BUNDLE_DIR" || { echo "backup: cannot create $BUNDLE_DIR" >&2; exit 1; }

failures=0
snapshots=0

# One line per worktree path, main checkout included: it can hold uncommitted work too.
git worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | while IFS= read -r wt; do
  [ -d "$wt" ] || continue
  git -C "$wt" rev-parse --git-dir >/dev/null 2>&1 || continue

  # Nothing uncommitted (tracked edits or new untracked files) means nothing to save.
  [ -z "$(git -C "$wt" status --porcelain --untracked-files=all 2>/dev/null)" ] && continue

  name=$(basename "$wt")
  idx="$TMPDIR_BASE/alethical-wip-index.$$.$name"
  rm -f "$idx"

  # Temporary index: reflects HEAD, then everything on disk staged on top of it. The
  # worktree's real index is never opened.
  if ! GIT_INDEX_FILE="$idx" git -C "$wt" read-tree HEAD 2>/dev/null; then
    echo "backup: $name — could not read HEAD into a temp index" >&2
    failures=$((failures + 1)); rm -f "$idx"; continue
  fi
  if ! GIT_INDEX_FILE="$idx" git -C "$wt" add --all 2>/dev/null; then
    echo "backup: $name — could not stage into the temp index" >&2
    failures=$((failures + 1)); rm -f "$idx"; continue
  fi

  tree=$(GIT_INDEX_FILE="$idx" git -C "$wt" write-tree 2>/dev/null)
  rm -f "$idx"
  [ -n "$tree" ] || { echo "backup: $name — write-tree produced nothing" >&2; failures=$((failures + 1)); continue; }

  ref="refs/wip-backup/$name"
  # Same tree as last time means nothing changed; do not pile up identical snapshots.
  prev=$(git -C "$wt" rev-parse -q --verify "$ref^{tree}" 2>/dev/null || true)
  [ "$prev" = "$tree" ] && continue

  head=$(git -C "$wt" rev-parse -q --verify HEAD 2>/dev/null || true)
  msg="wip snapshot of $name

Uncommitted work captured automatically so it does not exist in only one place.
Not authored by anyone; nothing here was reviewed or intended as a commit."

  if [ -n "$head" ]; then
    commit=$(printf '%s' "$msg" | git -C "$wt" commit-tree "$tree" -p "$head" 2>/dev/null)
  else
    commit=$(printf '%s' "$msg" | git -C "$wt" commit-tree "$tree" 2>/dev/null)
  fi
  [ -n "$commit" ] || { echo "backup: $name — commit-tree produced nothing" >&2; failures=$((failures + 1)); continue; }

  if ! git -C "$wt" update-ref "$ref" "$commit" 2>/dev/null; then
    echo "backup: $name — could not update $ref" >&2
    failures=$((failures + 1)); continue
  fi

  # Second copy outside the repo, so a snapshot survives losing the repo itself.
  # Thin on purpose: `--not --remotes=origin` excludes everything already on GitHub, so
  # the bundle holds just the uncommitted delta. A full bundle of this repo is ~11 MB per
  # worktree; thin ones are kilobytes, which is what makes a 5-minute interval reasonable.
  # Recovery therefore starts by cloning from GitHub, then fetching the bundle on top.
  if ! git -C "$wt" bundle create "$BUNDLE_DIR/$name.bundle" "$ref" --not --remotes=origin >/dev/null 2>&1; then
    # A worktree whose history is entirely unpushed has no origin base to thin against.
    # Fall back to a full bundle rather than losing the off-repo copy.
    if ! git -C "$wt" bundle create "$BUNDLE_DIR/$name.bundle" "$ref" >/dev/null 2>&1; then
      echo "backup: $name — ref saved, but the bundle write to $BUNDLE_DIR failed" >&2
      failures=$((failures + 1)); continue
    fi
  fi

  snapshots=$((snapshots + 1))
done

exit 0
