#!/bin/bash
# Builds a release of Screencap: signed with Apple's secure timestamp, notarized and stapled, as a disk image for
# people to download and a zip for updates, with their SHA-256 sums. Output goes to build/release/.
#
#   scripts/release.sh 2.0.0
#
# Notarization authenticates, in this order, with an Apple ID and app-specific password (SCREENCAP_NOTARY_APPLE_ID,
# SCREENCAP_NOTARY_PASSWORD, SCREENCAP_NOTARY_TEAM_ID, as in CI), with an App Store Connect API key
# (SCREENCAP_NOTARY_KEY, the .p8 file, SCREENCAP_NOTARY_KEY_ID, SCREENCAP_NOTARY_ISSUER), or with a keychain profile
# made once on this Mac (see RELEASING.md):
#   xcrun notarytool store-credentials screencap-notary --apple-id <apple id> --team-id ZY8VMC3J6G
# SCREENCAP_SKIP_NOTARIZE=1 builds and packages without notarizing, to check everything else.
set -euo pipefail
VERSION="${1:?usage: scripts/release.sh VERSION}"
IDENTITY="${SCREENCAP_SIGNING_IDENTITY:-Developer ID Application: Yahor Barkouski (ZY8VMC3J6G)}"
NOTARIZE=1
if [ "${SCREENCAP_SKIP_NOTARIZE:-0}" = 1 ]; then NOTARIZE=0; fi
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "The version must look like 2.0.0 or 2.0.0-rc1, not \"$VERSION\"." >&2
  exit 1
fi
if [ -n "${SCREENCAP_NOTARY_APPLE_ID:-}" ]; then
  NOTARY=(--apple-id "$SCREENCAP_NOTARY_APPLE_ID" --password "${SCREENCAP_NOTARY_PASSWORD:?}" --team-id "${SCREENCAP_NOTARY_TEAM_ID:?}")
elif [ -n "${SCREENCAP_NOTARY_KEY:-}" ]; then
  NOTARY=(--key "$SCREENCAP_NOTARY_KEY" --key-id "${SCREENCAP_NOTARY_KEY_ID:?}" --issuer "${SCREENCAP_NOTARY_ISSUER:?}")
else
  NOTARY=(--keychain-profile "${SCREENCAP_NOTARY_PROFILE:-screencap-notary}")
fi
if [ "$NOTARIZE" = 1 ] && ! xcrun notarytool history "${NOTARY[@]}" >/dev/null 2>&1; then
  echo "notarytool cannot sign in with the credentials given (see the top of this script), or there are none. To make" >&2
  echo "the keychain profile once:" >&2
  echo "  xcrun notarytool store-credentials screencap-notary --apple-id <apple id> --team-id ZY8VMC3J6G" >&2
  exit 1
fi
if [ -n "$(git status --porcelain -- Sources Package.swift Package.resolved Resources scripts)" ]; then
  echo "Uncommitted changes under Sources, Resources or scripts; a release is built from committed code only." >&2
  exit 1
fi

# Submits a file and waits; anything but Accepted prints Apple's log and stops the release.
notarize() {
  local result id status
  result="$(xcrun notarytool submit "$1" "${NOTARY[@]}" --wait --output-format json)"
  id="$(printf '%s' "$result" | plutil -extract id raw -o - -)"
  status="$(printf '%s' "$result" | plutil -extract status raw -o - -)"
  echo "notarization of $(basename "$1"): $status ($id)"
  if [ "$status" != Accepted ]; then
    xcrun notarytool log "$id" "${NOTARY[@]}" >&2 || true
    exit 1
  fi
}

SCREENCAP_VERSION="$VERSION" SCREENCAP_TIMESTAMP=1 SCREENCAP_SIGNING_IDENTITY="$IDENTITY" scripts/build-app.sh

OUT=build/release
mkdir -p "$OUT"
DMG="$OUT/Screencap-$VERSION.dmg"
ZIP="$OUT/Screencap-$VERSION.zip"
WORK="$(mktemp -d)"
STAGE="$WORK/stage"
MOUNT="$WORK/mount"
trap 'hdiutil detach -quiet "$MOUNT" 2>/dev/null || true; rm -rf "$WORK"' EXIT
mkdir -p "$STAGE" "$MOUNT"

# The app is notarized and stapled first, so the copy inside the disk image carries its own ticket and opens offline.
if [ "$NOTARIZE" = 1 ]; then
  ditto -c -k --keepParent build/Screencap.app "$WORK/app.zip"
  notarize "$WORK/app.zip"
  xcrun stapler staple build/Screencap.app
fi

cp -R build/Screencap.app "$STAGE/"
ln -s /Applications "$STAGE/Applications"
# The mounted disk wears the app's icon: .VolumeIcon.icns at its root and the root's custom-icon flag, which only a
# writable image can take, so the image is made writable, flagged while attached out of Finder's sight, then compressed.
cp build/Screencap.app/Contents/Resources/AppIcon.icns "$STAGE/.VolumeIcon.icns"
hdiutil create -quiet -volname "Screencap" -srcfolder "$STAGE" -format UDRW "$WORK/rw.dmg"
hdiutil attach -quiet -nobrowse -noautoopen -mountpoint "$MOUNT" "$WORK/rw.dmg"
xcrun SetFile -a C "$MOUNT"
hdiutil detach -quiet "$MOUNT"
rm -f "$DMG"
hdiutil convert -quiet "$WORK/rw.dmg" -format UDZO -o "$DMG"
codesign --force --timestamp --sign "$IDENTITY" "$DMG"

if [ "$NOTARIZE" = 1 ]; then
  notarize "$DMG"
  xcrun stapler staple "$DMG"
  spctl --assess --type execute -v build/Screencap.app
  spctl --assess --type open --context context:primary-signature -v "$DMG"
fi
rm -f "$ZIP"
ditto -c -k --keepParent build/Screencap.app "$ZIP"
(cd "$OUT" && shasum -a 256 "Screencap-$VERSION.dmg" "Screencap-$VERSION.zip" > "Screencap-$VERSION.sha256")
echo "release $VERSION: $DMG, $ZIP"
cat "$OUT/Screencap-$VERSION.sha256"
