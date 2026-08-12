# --- Concurrent-session isolation ------------------------------------------
# This repo runs many Claude sessions at once against the same checkout. Work in
# your OWN worktree off origin/main instead of the shared checkout, so a branch
# switch or destructive clean in one session can't wipe another's uncommitted
# work. See .claude/rules/workflow.md rule 10 (concurrent-session isolation).

# Snapshot every worktree's uncommitted work right now, so it does not exist in only
# one place. Safe to run any time: it stages into a temporary index, so no worktree's
# own staged/unstaged state is touched. See the script header for how to recover one.
back-up-wip:
  sh scripts/back-up-uncommitted-worktree-work.sh
  @git for-each-ref --format='  %(refname:short)  %(committerdate:relative)' refs/wip-backup || true

# Run that snapshot automatically every 5 minutes (macOS only, costs nothing per run).
# The worktree lock and Cursor's command rules both turned out to be approval prompts
# rather than hard denials, so bounded loss is the realistic protection, not prevention.
# Undo with: just stop-wip-backup
install-wip-backup:
  #!/bin/sh
  set -e
  plist="$HOME/Library/LaunchAgents/com.alethical.wip-backup.plist"
  repo="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$plist" <<PLIST
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
    <key>Label</key><string>com.alethical.wip-backup</string>
    <key>ProgramArguments</key>
    <array><string>/bin/sh</string><string>$repo/scripts/back-up-uncommitted-worktree-work.sh</string></array>
    <key>EnvironmentVariables</key><dict><key>ALETHICAL_REPO</key><string>$repo</string></dict>
    <key>StartInterval</key><integer>300</integer>
    <key>RunAtLoad</key><true/>
    <key>StandardErrorPath</key><string>$HOME/Library/Logs/alethical-wip-backup.log</string>
  </dict></plist>
  PLIST
  launchctl bootout "gui/$(id -u)/com.alethical.wip-backup" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "✅ Snapshotting uncommitted work every 5 minutes. Errors go to ~/Library/Logs/alethical-wip-backup.log"

stop-wip-backup:
  -launchctl bootout "gui/$(id -u)/com.alethical.wip-backup"
  -rm -f "$HOME/Library/LaunchAgents/com.alethical.wip-backup.plist"
  @echo "🛑 Automatic snapshots stopped. Existing refs/wip-backup/* snapshots are untouched."

# Point git at this repo's tracked hooks. Run once per clone, before anything else.
# Until you run it, a new worktree is NOT auto-locked and `git worktree remove
# --force` can delete another session's uncommitted work. `core.hooksPath` is local
# config, so it cannot travel with a clone; this recipe is the one documented way in.
install-hooks:
  # Absolute, pointing at the MAIN checkout's .githooks, on purpose. A relative
  # `core.hooksPath` resolves per worktree, so a worktree that checks out a branch
  # predating .githooks would silently get no hook. Absolute means every worktree
  # uses the same hook whatever branch it has out. core.hooksPath is local config
  # and never committed, so a machine-specific path here costs nothing.
  git config core.hooksPath "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.githooks"
  @echo "✅ Hooks active from $(git config --get core.hooksPath). New worktrees now auto-lock."

# Create an isolated worktree off origin/main, fully set up to build & verify.
# Usage: just worktree my-branch   ->   ../alethical-wt-my-branch (its own deps).
worktree branch:
  git fetch origin main
  git worktree add -b {{branch}} ../alethical-wt-{{branch}} origin/main
  # Lock it. `git worktree remove --force` deletes a worktree AND its uncommitted
  # work in one command; a lock makes that refuse and print this reason instead.
  # `just worktree-rm` unlocks first, so the intended cleanup path still works.
  # Tolerant of failure on purpose: with hooks installed, .githooks/post-checkout
  # has already locked it, and a second lock is an error. Kept as a belt so a clone
  # that never ran `just install-hooks` still gets locked worktrees from this recipe.
  -git worktree lock ../alethical-wt-{{branch}} --reason "live session; if this is stale: just worktree-rm {{branch}}"
  main_root="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"; [ -f "$main_root/.env" ] && ln -sf "$main_root/.env" ../alethical-wt-{{branch}}/.env || true
  cd ../alethical-wt-{{branch}} && pnpm install --frozen-lockfile
  @echo "✅ Worktree ready: ../alethical-wt-{{branch}} (branch {{branch}}). cd there to build, commit, and push."

# Remove a worktree created by `just worktree` (run after its PR is merged).
# Usage: just worktree-rm my-branch
worktree-rm branch:
  -git worktree unlock ../alethical-wt-{{branch}}
  git worktree remove ../alethical-wt-{{branch}}
  -git branch -D {{branch}}
  @echo "🧹 Removed worktree ../alethical-wt-{{branch}}."

# Pinned to the same ruff CI runs (.github/workflows/ci.yml). Unpinned, `uvx`
# resolves the newest release: today that is ruff 0.16, which reports 778 findings
# on a tree CI calls clean, and `just format` would have rewritten 611 of them into
# a diff no reviewer asked for. CI is the arbiter, so local must ask the same tool.
format:
  uvx ruff@0.15.0 check --fix alethical scripts
  uvx ruff@0.15.0 format alethical scripts
  pnpm --dir apps/frontend exec prettier --write .

lint:
  uvx ruff@0.15.0 check alethical scripts
  uvx ty check alethical/db
  pnpm install --frozen-lockfile
  pnpm --dir apps/frontend exec tsc --noEmit

test-frontend:
  pnpm --dir apps/frontend run test

migrate:
  docker compose up -d db
  uv run python -m alembic -c alembic.ini upgrade head

up:
  docker compose up

down:
  docker compose down

pipeline-install target:
  uv run python -m alethical.pipeline.oban --target {{target}} install

pipeline target *ARGS:
  uv run python -m alethical.pipeline.oban --target {{target}} enqueue pipeline-run {{ARGS}}

# Refresh the precomputed /policy-areas issue-chip counts (#501). Zero-cost --
# derived from ai_enrichment.content_json already in the DB (no API calls). Runs
# automatically at the end of `ai_enrichment apply`; re-run on demand with this.
# Pass target=production (or set ALETHICAL_DATABASE_TARGET) to run against prod;
# add --session SLUG to refresh a single session.
refresh-policy-area-counts target="local" *ARGS:
  uv run python -m alethical.pipeline.policy_area_counts --target {{target}} {{ARGS}}

pipeline-work target:
  uv run python -m alethical.pipeline.oban --target {{target}} drain source_sync
  uv run python -m alethical.pipeline.oban --target {{target}} drain bill_sync --concurrency 8
  uv run python -m alethical.pipeline.oban --target {{target}} drain committee_sync
  uv run python -m alethical.pipeline.oban --target {{target}} drain vote_sync
  uv run python -m alethical.pipeline.oban --target {{target}} drain ai_batch

# Load Minnesota's 3 campaign-finance downloads as one dated set that replaces the
# previous one (#1328). Dry-run by default: it fetches, checks and reports without
# writing to the database or the file store, and needs no credentials.
# A real run needs the 4 SUPABASE_STORAGE_S3_* values from .env, because the exact
# downloaded bytes are kept -- the Board publishes no archive, so a file we do not
# keep cannot be fetched again.
#   just load-campaign-finance                       # dry run against local
#   just load-campaign-finance local false           # publish locally
#   just load-campaign-finance production false      # publish to production
# A first import has nothing to compare against, so it quarantines by design. Read
# the printed measurements, then publish it by naming its 3 hashes:
#   uv run python scripts/load_campaign_finance.py --target local --publish-hashes A B C
load-campaign-finance target="local" dry="true":
  uv run python scripts/load_campaign_finance.py --target {{target}} {{ if dry == "true" { "--dry-run" } else { "" } }}

# Copy every stored source file to Cloudflare R2, and prove the copy arrived (#1402).
# The daily job .github/workflows/mirror-raw-files.yml already does this; run it by
# hand to check the second copy now or after a failed run. It only ever adds, and a
# second run copies nothing. Needs the 4 SUPABASE_STORAGE_S3_* and 4 CLOUDFLARE_R2_*
# values from .env.
#   just mirror-raw-files                            # dry run against production
#   just mirror-raw-files production false           # copy for real
mirror-raw-files target="production" dry="true":
  ALETHICAL_DATABASE_TARGET={{target}} PYTHONPATH=. uv run python scripts/mirror_raw_files.py --target {{target}} {{ if dry == "true" { "--dry-run" } else { "" } }}

# Reconcile current legislator membership against the official roster PDF.
# Dry-run by default (no writes); pass apply=true to deactivate departed members.
# Set ALETHICAL_DATABASE_TARGET=production to run against prod.
reconcile-roster apply="false":
  uv run python scripts/load_minnesota_data.py --reconcile-only {{ if apply == "true" { "" } else { "--dry-run" } }}

# One-time backfill: merge each bill-author placeholder row into its roster row
# and repoint sponsorships (#302). Dry-run by default; pass apply=true to write.
# Set ALETHICAL_DATABASE_TARGET=production to run against prod.
merge-duplicate-legislators apply="false":
  uv run python scripts/load_minnesota_data.py --merge-duplicate-legislators {{ if apply == "true" { "" } else { "--dry-run" } }}
