#!/bin/bash
# Builds two versions of Screencap that update one to the other through Sparkle, from a feed on this Mac, to check
# updates end to end before a release. They use their own identifier, com.screencaping.app.updatetest, so they keep
# their own store, settings, Keychain items and privacy grants, and never touch the installed app.
#
#   scripts/update-test.sh KEY_DIR [PORT]
#
# KEY_DIR holds a throwaway key pair, made once:
#   openssl genpkey -algorithm ed25519 -out KEY_DIR/key.pem
#   openssl pkey -in KEY_DIR/key.pem -outform DER | tail -c 32 | base64 > KEY_DIR/private.txt
#   openssl pkey -in KEY_DIR/key.pem -pubout -outform DER | tail -c 32 | base64 > KEY_DIR/public.txt
#
# Writes build/update-test/ with old/Screencap.app (build 1000, 0.0.1), the update zip (build 1001, 0.0.2) and its
# appcast; serve that folder (python3 -m http.server PORT --bind 127.0.0.1 --directory build/update-test), then open
# old/Screencap.app. SCREENCAP_SKIP_SIGNED_BUILDS=1 reuses the two builds and rewrites only the feed.
set -euo pipefail
KEYS="${1:?usage: scripts/update-test.sh KEY_DIR [PORT]}"
PORT="${2:-8471}"
KEYS="$(cd "$KEYS" && pwd)"
cd "$(dirname "$0")/.."
OUT=build/update-test
export SCREENCAP_BUNDLE_ID=com.screencaping.app.updatetest
export SCREENCAP_FEED_URL="http://127.0.0.1:$PORT/appcast.xml"
SCREENCAP_ED_PUBLIC_KEY="$(cat "$KEYS/public.txt")"
export SCREENCAP_ED_PUBLIC_KEY

if [ "${SCREENCAP_SKIP_SIGNED_BUILDS:-0}" != 1 ]; then
  rm -rf "$OUT"
  mkdir -p "$OUT/old"
  SCREENCAP_VERSION=0.0.2 SCREENCAP_BUILD=1001 scripts/build-app.sh
  ditto -c -k --keepParent build/Screencap.app "$OUT/Screencap-0.0.2.zip"
  SCREENCAP_VERSION=0.0.1 SCREENCAP_BUILD=1000 scripts/build-app.sh
  ditto build/Screencap.app "$OUT/old/Screencap.app"
fi

NOTES="$(mktemp)"
trap 'rm -f "$NOTES"' EXIT
echo "<h2>Update test</h2><p>Build 1001 replaces build 1000.</p>" > "$NOTES"
SCREENCAP_ED_KEY_FILE="$KEYS/private.txt" scripts/appcast.sh "$OUT/Screencap-0.0.2.zip" \
  "http://127.0.0.1:$PORT/Screencap-0.0.2.zip" "$OUT/appcast.xml" "$NOTES"
echo "serve with: python3 -m http.server $PORT --bind 127.0.0.1 --directory $OUT"
