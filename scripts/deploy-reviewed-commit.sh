#!/usr/bin/env bash
# Deploy one reviewed commit to production without GitHub Actions.
#
# This exists because every normal deploy path runs on Actions, and Actions has
# had 13 incidents between Jun 8 and Aug 6 2026 (docs/operations/deployment.md
# § "Deploying when GitHub Actions is down"). It is the break-glass path, not the
# normal one.
#
# Every guard here replaces a specific way the loose commands this file replaced
# could publish the wrong thing:
#
#   fresh temp directory     a fixed path can already hold someone else's work
#   full 40-char commit      a branch name deploys whatever moved there since
#   ancestor-of-main check   a commit can exist and still never have been reviewed
#   clean-tree check         an edit made inside the clone would ship unreviewed
#   explicit provider target the CLI otherwise deploys wherever it was last linked
#   queued-run check         an older Actions run can recover later and overwrite
#   source path as argument  the CLI otherwise deploys the current directory
#
# Usage:
#   scripts/deploy-reviewed-commit.sh frontend <40-char-commit-sha>
#   scripts/deploy-reviewed-commit.sh backend  <40-char-commit-sha>
#
# Backend also needs the migration applied first when the commit carries one.
# See the deployment doc; this script deliberately does not run migrations, so
# that step stays a deliberate decision rather than a side effect.

set -euo pipefail

REPO_URL="https://github.com/alethical-org/alethical.git"
VERCEL_CLI="vercel@56.3.2"
RAILWAY_CLI="@railway/cli@4.5.3"
VERCEL_SCOPE="alethical"
VERCEL_PROJECT="alethical-web"
RAILWAY_SERVICE="alethical-api"
RAILWAY_ENVIRONMENT="production"

die() {
  echo "error: $*" >&2
  exit 1
}

SERVICE="${1:-}"
COMMIT="${2:-}"

case "$SERVICE" in
frontend | backend) ;;
*) die "usage: $0 <frontend|backend> <40-char-commit-sha>" ;;
esac

# A branch name or short SHA is refused on purpose: `main` deploys whatever has
# moved there since you last looked, which is the whole failure this avoids.
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "commit must be a full 40-character SHA, got: '${COMMIT}'"

if [ "$SERVICE" = "frontend" ]; then
  WORKFLOW="vercel-deploy.yml"
else
  WORKFLOW="railway-deploy.yml"
fi

# An Actions deploy run that is still queued can start later, finish after this
# one, and put the older commit back into production. Cancel those first.
echo "==> checking for queued Actions deploys of $WORKFLOW"
QUEUED="$(gh run list --workflow "$WORKFLOW" --limit 20 \
  --json databaseId,status,headSha \
  --jq '[.[] | select(.status=="queued" or .status=="in_progress" or .status=="waiting")] | .[] | "\(.databaseId) \(.status) \(.headSha[0:8])"' 2>/dev/null || true)"
if [ -n "$QUEUED" ]; then
  echo "$QUEUED" >&2
  echo >&2
  die "cancel the runs above first (gh run cancel <id>), or they may overwrite this deploy with older code"
fi

SRC="$(mktemp -d "${TMPDIR:-/tmp}/alethical-deploy-XXXXXXXX")"
trap 'rm -rf "$SRC"' EXIT
echo "==> fetching $COMMIT into $SRC"

git clone --quiet --single-branch --branch main "$REPO_URL" "$SRC"
git -C "$SRC" fetch --quiet origin "$COMMIT"

# The commit must be reachable from origin/main. A commit that exists in the
# repository is not the same as a commit that was reviewed and merged.
git -C "$SRC" merge-base --is-ancestor "$COMMIT" origin/main ||
  die "$COMMIT is not an ancestor of origin/main, so it was never merged"

git -C "$SRC" -c advice.detachedHead=false checkout --quiet "$COMMIT"
[ "$(git -C "$SRC" rev-parse HEAD)" = "$COMMIT" ] || die "checkout did not land on $COMMIT"
[ -z "$(git -C "$SRC" status --porcelain)" ] || die "working tree is not clean, refusing to deploy"

echo "==> deploying $SERVICE at $COMMIT"
echo "    $(git -C "$SRC" log -1 --format='%s')"

if [ "$SERVICE" = "frontend" ]; then
  # Confirm the pinned CLI still understands the targeting flags. Without both,
  # it silently deploys to whichever project the machine was last linked to.
  HELP="$(npx --yes "$VERCEL_CLI" deploy --help 2>&1)"
  grep -q -- "--project" <<<"$HELP" || die "$VERCEL_CLI has no --project flag; do not deploy blind"
  grep -q -- "--scope" <<<"$HELP" || die "$VERCEL_CLI has no --scope flag; do not deploy blind"

  npx --yes "$VERCEL_CLI" deploy "$SRC" \
    --prod \
    --yes \
    --archive=tgz \
    --scope "$VERCEL_SCOPE" \
    --project "$VERCEL_PROJECT" \
    --meta githubCommitSha="$COMMIT" \
    --meta deployedBy=deploy-reviewed-commit.sh
else
  # RAILWAY_TOKEN must be a project token scoped to this project and to the
  # production environment. `railway up` has no --project flag (checked on
  # 4.5.3), so the token is what pins the project; --service and --environment
  # pin the rest. A browser login is not a durable fallback: it lives on one
  # laptop and expires.
  [ -n "${RAILWAY_TOKEN:-}" ] || die "set RAILWAY_TOKEN to a project token scoped to $RAILWAY_SERVICE / $RAILWAY_ENVIRONMENT"

  npx --yes "$RAILWAY_CLI" up "$SRC" \
    --ci \
    --service "$RAILWAY_SERVICE" \
    --environment "$RAILWAY_ENVIRONMENT"
fi

cat <<EOF

==> deployed. Now verify with the live service, not with this script's exit code.

  frontend:  curl -s https://alethical.com/ -o /dev/null -w '%{http_code}\\n'
  backend:   curl -s https://alethical-api-production.up.railway.app/healthz

A command that exits 0 means the provider accepted the upload. It does not mean
the right code is serving real users. Read the live commit back and exercise one
real page and one real API request (#1122 makes that readable without signing in).
EOF
