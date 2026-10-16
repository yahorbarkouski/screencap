#!/bin/bash
# Builds Screencap.app into build/ and signs it with the Developer ID identity, so Screen Recording and
# Accessibility grants survive rebuilds (they are tied to the code signature). SCREENCAP_SIGNING_IDENTITY=- signs
# ad hoc, for CI machines that hold no certificate.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
IDENTITY="${SCREENCAP_SIGNING_IDENTITY:-Developer ID Application: Yahor Barkouski (ZY8VMC3J6G)}"
VERSION="${SCREENCAP_VERSION:-0.1.0}"
# The build number updaters compare: the commit count, which only grows.
BUILD="${SCREENCAP_BUILD:-$(git rev-list --count HEAD 2>/dev/null || echo 1)}"
# A release needs Apple's secure timestamp, which notarization checks; local builds skip the round trip.
TIMESTAMP="--timestamp=none"
if [ "${SCREENCAP_TIMESTAMP:-0}" = 1 ]; then TIMESTAMP="--timestamp"; fi

swift build -c release --scratch-path .build/app --product Screencap
swift build -c release --scratch-path .build/app --product screencap-ocr
BIN="$(swift build -c release --scratch-path .build/app --show-bin-path)"

APP=build/Screencap.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Helpers" "$APP/Contents/Resources"
cp "$BIN/Screencap" "$APP/Contents/MacOS/Screencap"
cp "$BIN/screencap-ocr" "$APP/Contents/Helpers/screencap-ocr"
# The icon is Icon Composer's layered format. actool compiles it into Assets.car, which macOS 26 draws in Liquid Glass
# with its dark, clear and tinted looks, and into AppIcon.icns for whatever still reads the flat file.
# actool hands the work to a long-lived helper that resolves relative paths against its own working directory,
# which can be another checkout, so every path it gets is absolute.
xcrun actool "$PWD/Resources/AppIcon.icon" --compile "$PWD/$APP/Contents/Resources" --app-icon AppIcon \
  --enable-on-demand-resources NO --development-region en --target-device mac --platform macosx \
  --minimum-deployment-target 26.0 --output-partial-info-plist "$PWD/build/icon-partial.plist" >/dev/null
rm "$PWD/build/icon-partial.plist"
# actool exits 0 even when it compiled nothing.
[ -f "$APP/Contents/Resources/Assets.car" ] || { echo "actool made no Assets.car from Resources/AppIcon.icon" >&2; exit 1; }

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.screencaping.app</string>
  <key>CFBundleName</key><string>Screencap</string>
  <key>CFBundleDisplayName</key><string>Screencap</string>
  <key>CFBundleExecutable</key><string>Screencap</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIconName</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${BUILD}</string>
  <key>LSMinimumSystemVersion</key><string>26.0</string>
  <key>LSUIElement</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSScreenCaptureUsageDescription</key><string>Screencap captures your screen to build your private activity timeline.</string>
  <key>NSHumanReadableCopyright</key><string>© 2026 Yahor Barkouski</string>
</dict>
</plist>
PLIST

codesign --force --options runtime "$TIMESTAMP" --identifier com.screencaping.app.ocr --sign "$IDENTITY" "$APP/Contents/Helpers/screencap-ocr"
codesign --force --options runtime "$TIMESTAMP" --sign "$IDENTITY" "$APP"
codesign --verify --strict "$APP"
echo "built $APP ($(du -sh "$APP" | cut -f1))"
