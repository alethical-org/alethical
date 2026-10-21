#!/bin/zsh
# Regenerate full-edition card images into a NEW output directory for review.
set -eu
if [ "$#" -ne 1 ]; then print -u2 'Usage: make_cards.sh NEW_OUTPUT_DIRECTORY'; exit 2; fi
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$1"
if [ -e "$OUT" ]; then print -u2 'Output already exists; choose a new directory'; exit 2; fi
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
CH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT
for NAME in title end labels-z115; do
  EXTRA=()
  [ "$NAME" = 'labels-z115' ] && EXTRA=(--default-background-color=00000000)
  "$CH" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$PROFILE" \
    --window-size=2652,1492 "${EXTRA[@]}" --screenshot="$OUT/$NAME.png" \
    "file://$HERE/cards/$NAME.html"
done
