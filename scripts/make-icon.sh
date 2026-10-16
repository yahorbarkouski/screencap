#!/bin/bash
# Regenerates what is drawn from the app icon's source, Resources/AppIcon.icon (Icon Composer's layered format: SVG
# layers and icon.json; open it in Icon Composer to change it): docs/readme/logo.png, the icon as macOS 26 draws it in
# its default appearance, for the README's header. The bundle compiles the same source on every build
# (scripts/build-app.sh), and the menu bar glyph is code (Sources/Screencap/UI/MenuBarGlyph.swift).
# research/logo/ has how the icon was chosen and renders it in every appearance and size.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A throwaway bundle around the compiled icon, under a fresh name so IconServices never serves a cached one.
APP="$WORK/Icon-$(date +%s).app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
xcrun actool "$PWD/Resources/AppIcon.icon" --compile "$APP/Contents/Resources" --app-icon AppIcon \
  --enable-on-demand-resources NO --development-region en --target-device mac --platform macosx \
  --minimum-deployment-target 26.0 --output-partial-info-plist "$WORK/partial.plist" >/dev/null
[ -f "$APP/Contents/Resources/Assets.car" ] || { echo "actool made no Assets.car from Resources/AppIcon.icon" >&2; exit 1; }
printf '#!/bin/sh\n' > "$APP/Contents/MacOS/Icon"
chmod +x "$APP/Contents/MacOS/Icon"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.screencaping.icon-render.$(date +%s)</string>
  <key>CFBundleExecutable</key><string>Icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIconName</key><string>AppIcon</string>
</dict></plist>
PLIST

clang -fobjc-arc -framework AppKit scripts/icon-render.m -o "$WORK/icon-render"
"$WORK/icon-render" "$APP" "$WORK/icon" 512 0 0 >/dev/null
cp "$WORK/icon-a0-v0-512.png" docs/readme/logo.png
echo "docs/readme/logo.png"
