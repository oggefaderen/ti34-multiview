#!/bin/sh
# Regenerate assets/AppIcon.icns from tools/icon.html.
#
# The icon is drawn as a web page so it stays in step with the faceplate
# palette (same teal body, same LCD green) and can be edited without a
# graphics program. Rendering needs Google Chrome; the generated .icns is
# committed, so building the app does NOT require this script.
set -eu

cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "error: Google Chrome not found; the committed assets/AppIcon.icns is still usable." >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SET="$WORK/AppIcon.iconset"
mkdir -p "$SET"

"$CHROME" --headless --disable-gpu --screenshot="$WORK/1024.png" \
  --window-size=1024,1024 --default-background-color=00000000 \
  --hide-scrollbars --virtual-time-budget=2000 \
  "file://$PWD/tools/icon.html" >/dev/null 2>&1

# Apple's required set: each nominal size plus its @2x retina variant.
for spec in "16 16x16" "32 16x16@2x" "32 32x32" "64 32x32@2x" \
            "128 128x128" "256 128x128@2x" "256 256x256" "512 256x256@2x" \
            "512 512x512" "1024 512x512@2x"; do
  px=${spec%% *}; name=${spec#* }
  cp "$WORK/1024.png" "$SET/icon_$name.png"
  sips -Z "$px" "$SET/icon_$name.png" >/dev/null
done

iconutil -c icns "$SET" -o assets/AppIcon.icns
echo "wrote assets/AppIcon.icns"
