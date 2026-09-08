#!/usr/bin/env bash
#
# Decide whether Vercel needs to build this commit. Exit 0 skips the build, and
# any other exit code builds. That is Vercel's convention for an Ignored Build
# Step and this repository's own records confirm it: every docs-only commit on
# `main` carries the Vercel status "Canceled by Ignored Build Step".
#
# WHY THIS EXISTS. The 1-line command it replaces asked whether the NEWEST COMMIT
# ALONE touched the website:
#
#     git diff --quiet HEAD^ HEAD -- api apps/frontend ...
#
# A build carries every commit since the last release, and GitHub's merge queue
# can advance `main` by several commits in a single push. Vercel builds the push's
# head only, so whenever that head happens to touch none of these paths, every
# earlier commit in the same push goes unbuilt however much website code it
# changed.
#
# THE TRIGGER IS "THE HEAD TOUCHED NO WATCHED PATH", NOT ANYTHING ABOUT NOTES, and
# it was measured twice on 8 Sep 2026 with different kinds of head:
#
#   - `c8ad2698`, notes only, landed in the same push as `04005cfd`, a change to
#     `api/page.ts` and `apps/frontend`. Readers kept the old page for 14 minutes
#     ([issue 2075](https://github.com/alethical-org/alethical/issues/2075)).
#   - `505b9909`, scripts, tests and documents, landed 20 seconds behind
#     `0511f54f`, whose fix stops a legislator profile naming a seat its member has
#     left. That is a wrong claim about a named person, and it sat unpublished for
#     about 21 minutes until an unrelated merge behind it built.
#
# HOW LONG IT LASTS IS SET BY HOW BUSY THE DAY IS, NOT BY THE FAULT. Both cases
# above ended by luck, when a later commit touching a watched path pulled the
# earlier change out with it. On a busy afternoon that is minutes. Across the 399
# commits on `main` since 14 Aug 2026 this happened 5 separate times, and the
# longest ran about 14 hours, 18 Aug 14:03 to 19 Aug 04:17, with the whole first
# `/money` release sitting unbuilt inside it. So the 14 and 21 minutes above are
# what a busy day costs, and they are not the size of the fault.
#
# WHAT IT ASKS INSTEAD. Has anything touched the website since the last commit
# that actually released. `VERCEL_GIT_PREVIOUS_SHA` is Vercel's own name for that
# commit: "The git SHA of the last successful deployment for the project and
# branch", build-time only, and "only exposed when an Ignored Build Step is
# provided" (Vercel's system environment variables reference, read 8 Sep 2026).
#
# THE RULE WHEN IT CANNOT TELL: BUILD. An empty variable, a renamed variable, a
# first deployment, or a clone too shallow to hold that commit all end in a build.
# Skipping in any of those cases would turn a 14-minute delay into a permanent
# one, and an unnecessary build costs build minutes while a missed release costs
# readers the truth.
#
# The paths come from `vercel.json` after `--`, so they are stated once and both
# this and `scripts/check_production_release_reached_readers.py` read the same
# list. Neither can drift from the other.
set -uo pipefail

paths=()
after_separator=0
for argument in "$@"; do
  if [ "$argument" = "--" ]; then
    after_separator=1
    continue
  fi
  if [ "$after_separator" = 1 ]; then paths+=("$argument"); fi
done

if [ "${#paths[@]}" -eq 0 ]; then
  echo "Building: no paths were given after \`--\`, so this cannot tell what a release needs."
  exit 1
fi

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$base" ]; then
  echo "Building: VERCEL_GIT_PREVIOUS_SHA is empty, so nothing here can prove a build is unnecessary."
  exit 1
fi

held() { git cat-file -e "${base}^{commit}" 2>/dev/null; }

if ! held; then git fetch --no-tags --quiet --depth=250 origin "$base" 2>/dev/null || true; fi
if ! held; then git fetch --no-tags --quiet --unshallow 2>/dev/null || true; fi
if ! held; then
  echo "Building: this build's clone does not hold ${base}, and a comparison that cannot be made must never skip a release."
  exit 1
fi

if git diff --quiet "$base" HEAD -- "${paths[@]}"; then
  echo "Skipping: nothing under ${paths[*]} changed between ${base}, the last release, and this commit."
  exit 0
fi

echo "Building: something under ${paths[*]} changed between ${base}, the last release, and this commit."
exit 1
