#!/bin/bash
# Captures the public web pages the README's made-up day is built from (see `Screencap demo-store --pages`), with
# Chrome headless in a fresh profile: no logins, no cookies, nobody's data. Each page is saved at the size of the
# demo's browser window content; a page that keeps loading is given up after 45 s, and pages already saved are kept.
# WebGL runs in software (SwiftShader), since OpenStreetMap draws its map with it.
#
#   scripts/capture-pages.sh OUT_DIR
set -euo pipefail
OUT="${1:?usage: scripts/capture-pages.sh OUT_DIR}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT
mkdir -p "$OUT"
while IFS='|' read -r name url; do
  [ -z "$name" ] && continue
  [ -s "$OUT/$name.png" ] && continue
  timeout 45 "$CHROME" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars --lang=en-US --blink-settings=preferredColorScheme=1 \
    --window-size=1348,825 --user-data-dir="$PROFILE" --virtual-time-budget=9000 \
    --screenshot="$OUT/$name.png" "$url" >/dev/null 2>&1 || echo "failed: $name" >&2
  echo "$name"
done <<'PAGES'
hn-front|https://news.ycombinator.com/
hn-best|https://news.ycombinator.com/best
apple-swiftui|https://developer.apple.com/documentation/swiftui
apple-hig|https://developer.apple.com/design/human-interface-guidelines/
apple-xcode|https://developer.apple.com/xcode/
apple-list|https://developer.apple.com/documentation/swiftui/list
gh-collections|https://github.com/apple/swift-collections
rust-ownership|https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html
rust-borrowing|https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html
rust-slices|https://doc.rust-lang.org/book/ch04-03-slices.html
wiki-kyoto|https://en.wikipedia.org/wiki/Kyoto
wiki-fushimi|https://en.wikipedia.org/wiki/Fushimi_Inari-taisha
wiki-kinkakuji|https://en.wikipedia.org/wiki/Kinkaku-ji
osm-kyoto|https://www.openstreetmap.org/export/embed.html?bbox=135.755,34.985,135.795,35.010&layer=mapnik
nasa-iotd|https://www.nasa.gov/image-of-the-day/
nasa-webb|https://science.nasa.gov/mission/webb/
wiki-ramen|https://en.wikipedia.org/wiki/Ramen
wiki-okonomiyaki|https://en.wikipedia.org/wiki/Okonomiyaki
PAGES
