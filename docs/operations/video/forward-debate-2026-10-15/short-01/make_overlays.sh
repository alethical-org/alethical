#!/bin/zsh
# Rebuild overlays/*.png from overlays/*.html with headless Google Chrome (1080x1920; transparent except end_text).
# The committed PNGs are the reference used for the tested rebuild; regenerate only if a template changes.
set -e; cd "$(dirname "$0")/overlays"
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; P=$(mktemp -d)
for h in *.html; do bg="--default-background-color=00000000"; [ "$h" = "end_text.html" ] && bg=""
  "$CH" --headless=new --disable-gpu --user-data-dir="$P" --hide-scrollbars $bg --window-size=1080,1920 --screenshot="${h%.html}.png" "file://$PWD/$h" 2>/dev/null; done
rm -rf "$P"; ls *.png
