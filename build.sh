#!/usr/bin/env bash
# Builds dist/TI-34 MultiView.app from mac/main.swift + src/{ui,engine}.
#
# Requires only the Xcode Command Line Tools (`xcode-select --install`) —
# there is no Xcode on this machine, so this script uses `swiftc` directly
# rather than `xcodebuild`/`xcrun xcodebuild`, which need a full Xcode
# install and are not available here.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

APP_NAME="TI-34 MultiView"
BUNDLE_ID="dev.oggefaderen.ti34multiview"
VERSION="0.1.0"
MIN_MACOS="11.0"

SRC_UI="$ROOT/src/ui"
SRC_ENGINE="$ROOT/src/engine"
DIST="$ROOT/dist"
APP="$DIST/$APP_NAME.app"
CONTENTS="$APP/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

if [ ! -f "$SRC_UI/index.html" ]; then
    echo "error: $SRC_UI/index.html not found." >&2
    echo "  There is nothing to bundle yet — build.sh packages src/ui and src/engine" >&2
    echo "  as-is, and the UI (src/ui/index.html) hasn't been written." >&2
    echo "  Re-run this script once it exists." >&2
    exit 1
fi

echo "==> Cleaning previous build"
rm -rf "$APP"
mkdir -p "$MACOS_DIR" "$RESOURCES"

echo "==> Compiling mac/main.swift"
SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"
HOST_ARCH="$(uname -m)"

build_slice() {
    local arch="$1" out="$2"
    swiftc -O \
        -target "${arch}-apple-macosx${MIN_MACOS}" \
        -sdk "$SDK_PATH" \
        "$ROOT/mac/main.swift" \
        -o "$out"
}

TMP_BIN_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_BIN_DIR"' EXIT

# Plain swiftc + lipo can produce a universal binary without Xcode, so that's
# the default; if cross-compiling either slice ever fails on some future
# toolchain, fall back to a single host-arch build rather than hard-failing.
if build_slice arm64 "$TMP_BIN_DIR/main-arm64" 2>"$TMP_BIN_DIR/arm64.log" \
    && build_slice x86_64 "$TMP_BIN_DIR/main-x86_64" 2>"$TMP_BIN_DIR/x86_64.log"; then
    lipo -create -output "$MACOS_DIR/$APP_NAME" "$TMP_BIN_DIR/main-arm64" "$TMP_BIN_DIR/main-x86_64"
    echo "    universal binary (arm64 + x86_64)"
else
    echo "    universal cross-compile failed; building for host arch ($HOST_ARCH) only:" >&2
    cat "$TMP_BIN_DIR/arm64.log" "$TMP_BIN_DIR/x86_64.log" >&2 || true
    build_slice "$HOST_ARCH" "$MACOS_DIR/$APP_NAME"
fi
chmod +x "$MACOS_DIR/$APP_NAME"

echo "==> Writing Info.plist"
cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>$APP_NAME</string>
    <key>CFBundleIdentifier</key>
    <string>$BUNDLE_ID</string>
    <key>CFBundleName</key>
    <string>$APP_NAME</string>
    <key>CFBundleDisplayName</key>
    <string>$APP_NAME</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleShortVersionString</key>
    <string>$VERSION</string>
    <key>CFBundleVersion</key>
    <string>$VERSION</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>$MIN_MACOS</string>
    <key>NSHumanReadableCopyright</key>
    <string>MIT licence. Not affiliated with or endorsed by Texas Instruments.</string>
</dict>
</plist>
PLIST

echo "==> Copying the app icon"
if [ -f assets/AppIcon.icns ]; then
  cp assets/AppIcon.icns "$RESOURCES/AppIcon.icns"
else
  # Not fatal: the app runs fine with the generic icon. Regenerate with
  # tools/make-icon.sh (needs Google Chrome).
  echo "    note: assets/AppIcon.icns missing — using the default icon."
fi

echo "==> Copying src/ui and src/engine into Resources"
mkdir -p "$RESOURCES/src/ui" "$RESOURCES/src/engine"
cp -R "$SRC_UI/." "$RESOURCES/src/ui/"
cp -R "$SRC_ENGINE/." "$RESOURCES/src/engine/"

echo "==> Ad-hoc code signing"
# Best-effort, deliberately not fatal.
#
# codesign refuses to sign a bundle carrying extended attributes ("resource
# fork, Finder information, or similar detritus not allowed"). `xattr -cr`
# clears the ordinary ones, but on macOS 15+ the system stamps
# com.apple.provenance on files created by some sandboxed processes and that
# one cannot be removed — so in those environments this step can never
# succeed, no matter how the bundle is assembled.
#
# That is survivable: swiftc already ad-hoc signs the executable at link
# time, which is what macOS actually requires to run a local arm64 binary.
# The app launches and works without a bundle-level signature. So warn and
# carry on rather than failing a build that produced a working app.
xattr -cr "$APP" 2>/dev/null || true
if codesign --force -s - "$APP" 2>/dev/null; then
  echo "    signed"
else
  echo "    note: bundle signing skipped (extended attributes present)."
  echo "    The executable is linker-signed and the app runs normally."
fi

echo ""
echo "Built: $APP"
echo "Run with:"
echo "  open \"$APP\""
