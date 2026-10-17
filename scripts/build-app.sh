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
# Sparkle reads updates from the appcast attached to the latest published GitHub release, and installs only what is
# signed with the private half of this key (the maintainer's Keychain and the SPARKLE_ED_PRIVATE_KEY secret; see
# RELEASING.md). The update test builds under its own identifier, feed and key: scripts/update-test.sh.
BUNDLE_ID="${SCREENCAP_BUNDLE_ID:-com.screencaping.app}"
FEED_URL="${SCREENCAP_FEED_URL:-https://github.com/yahorbarkouski/screencap/releases/latest/download/appcast.xml}"
ED_PUBLIC_KEY="${SCREENCAP_ED_PUBLIC_KEY:-x5rTm9SbjOVsZ5fLTKAdYnCXTtVYshoxsqqPZCiCVc0=}"
# A release needs Apple's secure timestamp, which notarization checks; local builds skip the round trip.
TIMESTAMP="--timestamp=none"
if [ "${SCREENCAP_TIMESTAMP:-0}" = 1 ]; then TIMESTAMP="--timestamp"; fi

swift build -c release --scratch-path .build/app --product Screencap
swift build -c release --scratch-path .build/app --product screencap-ocr
BIN="$(swift build -c release --scratch-path .build/app --show-bin-path)"

APP=build/Screencap.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Helpers" "$APP/Contents/Resources" "$APP/Contents/Frameworks"
cp "$BIN/Screencap" "$APP/Contents/MacOS/Screencap"
cp "$BIN/screencap-ocr" "$APP/Contents/Helpers/screencap-ocr"
# Sparkle, without what only building against it or a sandboxed app needs: its XPC services launch the installer
# from inside a sandbox, and Screencap is not sandboxed.
SPARKLE="$APP/Contents/Frameworks/Sparkle.framework"
ditto "$BIN/Sparkle.framework" "$SPARKLE"
rm -rf "$SPARKLE"/{XPCServices,Headers,PrivateHeaders,Modules} "$SPARKLE"/Versions/B/{XPCServices,Headers,PrivateHeaders,Modules}
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
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
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
  <key>NSAppleEventsUsageDescription</key><string>Screencap selects the page a thread was on when you jump back into it.</string>
  <key>NSHumanReadableCopyright</key><string>© 2026 Yahor Barkouski</string>
  <key>SUFeedURL</key><string>${FEED_URL}</string>
  <key>SUPublicEDKey</key><string>${ED_PUBLIC_KEY}</string>
  <key>SUEnableAutomaticChecks</key><true/>
  <key>SUAutomaticallyUpdate</key><true/>
  <key>SURequireSignedFeed</key><true/>
  <key>SUVerifyUpdateBeforeExtraction</key><true/>
</dict>
</plist>
PLIST

codesign --force --options runtime "$TIMESTAMP" --identifier com.screencaping.app.ocr --sign "$IDENTITY" "$APP/Contents/Helpers/screencap-ocr"
# Inside out, as Sparkle's documentation orders it: its installer tool, its progress app, then the framework.
codesign --force --options runtime "$TIMESTAMP" --sign "$IDENTITY" "$SPARKLE/Versions/B/Autoupdate"
codesign --force --options runtime "$TIMESTAMP" --sign "$IDENTITY" "$SPARKLE/Versions/B/Updater.app"
codesign --force --options runtime "$TIMESTAMP" --sign "$IDENTITY" "$SPARKLE"
# The hardened runtime blocks Apple events to other apps unless the app says it sends them, and blocks them
# silently: the send fails with -1743 and macOS shows no consent dialog at all. Resume asks a browser which tabs
# are open, so it needs this.
cat > build/Screencap.entitlements <<'ENTITLEMENTS'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.automation.apple-events</key><true/>
</dict>
</plist>
ENTITLEMENTS
codesign --force --options runtime "$TIMESTAMP" --entitlements build/Screencap.entitlements --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict "$APP"
echo "built $APP ($(du -sh "$APP" | cut -f1))"
