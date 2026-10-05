#!/bin/sh
# Keep the launchd /bin/sh entrypoint and environment overrides stable.
# Private local snapshots exclude ignored files, including .env.
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$SCRIPT_DIR/worktree_backup.py"
