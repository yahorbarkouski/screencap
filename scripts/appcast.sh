#!/bin/bash
# Writes the appcast Sparkle reads for one release: the update zip's versions, download address, size and EdDSA
# signature, the release notes, and an EdDSA signature over the whole feed, which the app requires.
#
#   scripts/appcast.sh ZIP URL OUT [NOTES.html]
#
# URL is where the zip downloads from. Every GitHub release carries its own appcast.xml, and the app reads the one at
# releases/latest/download/appcast.xml, so only the latest published release reaches anyone and a draft reaches nobody.
# The private key comes from SPARKLE_ED_PRIVATE_KEY (as in CI) or SCREENCAP_ED_KEY_FILE, else from the maintainer's
# Keychain, where `generate_keys --account screencap` keeps it (see RELEASING.md).
set -euo pipefail
ZIP="${1:?usage: scripts/appcast.sh ZIP URL OUT [NOTES.html]}"
URL="${2:?usage: scripts/appcast.sh ZIP URL OUT [NOTES.html]}"
OUT="${3:?usage: scripts/appcast.sh ZIP URL OUT [NOTES.html]}"
NOTES="${4:-}"
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

# Sparkle's tools come with the package, at the version the app links.
swift package --scratch-path .build/app resolve >/dev/null
SIGN=.build/app/artifacts/sparkle/Sparkle/bin/sign_update
sign() {
  if [ -n "${SPARKLE_ED_PRIVATE_KEY:-}" ]; then
    printf '%s' "$SPARKLE_ED_PRIVATE_KEY" | "$SIGN" --ed-key-file - "$@"
  elif [ -n "${SCREENCAP_ED_KEY_FILE:-}" ]; then
    "$SIGN" --ed-key-file "$SCREENCAP_ED_KEY_FILE" "$@"
  else
    "$SIGN" --account screencap "$@"
  fi
}

INFO="$(mktemp)"
trap 'rm -f "$INFO"' EXIT
unzip -p "$ZIP" Screencap.app/Contents/Info.plist > "$INFO"
field() { plutil -extract "$1" raw -o - "$INFO"; }
SHORT="$(field CFBundleShortVersionString)"
BUILD="$(field CFBundleVersion)"
MINIMUM="$(field LSMinimumSystemVersion)"
ENCLOSURE="$(sign "$ZIP")"
case "$ENCLOSURE" in
  sparkle:edSignature=*length=*) ;;
  *) echo "sign_update gave no signature: $ENCLOSURE" >&2; exit 1 ;;
esac

DESCRIPTION=""
if [ -n "$NOTES" ]; then
  # CDATA ends at the first "]]>", so any in the notes is split across two sections.
  DESCRIPTION="      <description><![CDATA[$(sed 's/]]>/]]]]><![CDATA[>/g' "$NOTES")]]></description>"
fi

cat > "$OUT" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Screencap</title>
    <item>
      <title>Screencap $SHORT</title>
      <pubDate>$(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')</pubDate>
      <sparkle:version>$BUILD</sparkle:version>
      <sparkle:shortVersionString>$SHORT</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>$MINIMUM</sparkle:minimumSystemVersion>
      <sparkle:fullReleaseNotesLink>https://github.com/yahorbarkouski/screencap/releases</sparkle:fullReleaseNotesLink>
$DESCRIPTION
      <enclosure url="$URL" type="application/octet-stream" $ENCLOSURE/>
    </item>
  </channel>
</rss>
XML
sign --disable-signing-warning "$OUT" >/dev/null
echo "appcast for $SHORT ($BUILD): $OUT"
