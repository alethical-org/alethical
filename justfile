# --- Concurrent-session isolation ------------------------------------------
# This repo runs many Claude sessions at once against the same checkout. Work in
# your OWN worktree off origin/main instead of the shared checkout, so a branch
# switch or destructive clean in one session can't wipe another's uncommitted
# work. See .claude/rules/workflow.md rule 10 (concurrent-session isolation).

# Create an isolated worktree off origin/main, fully set up to build & verify.
# Usage: just worktree my-branch   ->   ../alethical-wt-my-branch (its own deps).
worktree branch:
  git fetch origin main
  git worktree add -b {{branch}} ../alethical-wt-{{branch}} origin/main
  main_root="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"; [ -f "$main_root/.env" ] && ln -sf "$main_root/.env" ../alethical-wt-{{branch}}/.env || true
  cd ../alethical-wt-{{branch}} && pnpm install --frozen-lockfile
  @echo "✅ Worktree ready: ../alethical-wt-{{branch}} (branch {{branch}}). cd there to build, commit, and push."

# Remove a worktree created by `just worktree` (run after its PR is merged).
# Usage: just worktree-rm my-branch
worktree-rm branch:
  git worktree remove ../alethical-wt-{{branch}}
  -git branch -D {{branch}}
  @echo "🧹 Removed worktree ../alethical-wt-{{branch}}."

format:
  uvx ruff check --fix alethical scripts
  uvx ruff format alethical scripts
  pnpm --dir apps/frontend exec prettier --write .

lint:
  uvx ruff check alethical scripts
  uvx ty check alethical/db
  pnpm install --frozen-lockfile
  pnpm --dir apps/frontend exec tsc --noEmit

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
