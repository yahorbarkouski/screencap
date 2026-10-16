#!/bin/bash
# Renders logo candidates the way macOS 26 draws them, offscreen, and lays out the contact sheets in research/logo/.
#
#   research/logo/render.sh WORK_DIR             the twelve directions: overview.jpg and one sheet each
#   research/logo/render.sh WORK_DIR --lens      the Lens variants: lens/variants.jpg and the steps that decided it
#   research/logo/render.sh WORK_DIR --chosen    what ships (Resources/AppIcon.icon and MenuBarGlyph.swift): chosen.jpg,
#                                                and, after the two runs above, dock.jpg and glyphs.jpg
#
# Each .icon is compiled by actool into Assets.car, wrapped in a throwaway bundle and drawn by IconServices in the
# default, dark, clear and tinted appearances (scripts/icon-render.m reaches the appearance through IconServices'
# private image descriptor; a tool only, the app never uses it). The directions' glyphs are SVG, rasterised with
# rsvg-convert; the chosen glyph is the app's own drawing code.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../.."
WORK="${1:?usage: research/logo/render.sh WORK_DIR [--lens|--chosen]}"
# actool hands its work to a long-lived helper that resolves relative paths against its own working directory, so every
# path it gets is absolute.
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
MODE="${2:-}"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
TOOLS="$WORK/tools"
mkdir -p "$TOOLS"
clang -fobjc-arc -framework AppKit "$ROOT/scripts/icon-render.m" -o "$TOOLS/isrender"
swiftc -O "$HERE/tools/contact.swift" -o "$TOOLS/contact"

case "$MODE" in
  --lens) DIRS="$WORK/lens"; SHEETS="$HERE/lens"; OVERVIEW=variants.jpg; python3 -I "$HERE/directions.py" "$DIRS" --lens >/dev/null ;;
  --strips) DIRS="$WORK/strips"; SHEETS="$HERE/strips"; OVERVIEW=overview.jpg; python3 -I "$HERE/directions.py" "$DIRS" --strips >/dev/null ;;
  --round2) DIRS="$WORK/round2"; SHEETS="$HERE/round2"; OVERVIEW=overview.jpg; python3 -I "$HERE/directions.py" "$DIRS" --round2 >/dev/null ;;
  --chosen)
    DIRS="$WORK/chosen"; SHEETS="$HERE"; OVERVIEW=-
    rm -rf "$DIRS/chosen" && mkdir -p "$DIRS/chosen"
    cp -R "$ROOT/Resources/AppIcon.icon" "$DIRS/chosen/"
    printf '{"name": "Chosen", "note": "Strip, as shipped: the day strip with a playhead on a moment (Resources/AppIcon.icon, MenuBarGlyph.swift)."}' > "$DIRS/chosen/meta.json"
    swiftc -O -parse-as-library "$HERE/tools/glyph.swift" "$ROOT/Sources/Screencap/UI/MenuBarGlyph.swift" -o "$TOOLS/glyph" ;;
  *) DIRS="$WORK/dirs"; SHEETS="$HERE"; OVERVIEW=overview.jpg; python3 -I "$HERE/directions.py" "$DIRS" >/dev/null ;;
esac
mkdir -p "$SHEETS"

STAMP="$(date +%s)"
for dir in "$DIRS"/*/; do
  name="$(basename "$dir")"
  icon="$(ls -d "$dir"*.icon)"
  base="$(basename "$icon" .icon)"
  out="$dir/compiled"
  rm -rf "$out" "$dir"/*.app "$dir/r"
  mkdir -p "$out" "$dir/r"
  xcrun actool "$icon" --compile "$out" --app-icon "$base" --enable-on-demand-resources NO --development-region en \
    --target-device mac --platform macosx --minimum-deployment-target 26.0 \
    --output-partial-info-plist "$out/partial.plist" >/dev/null
  # A fresh bundle path and identifier each run, so IconServices never serves a cached icon.
  app="$dir/$base-$STAMP.app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  cp "$out/Assets.car" "$out/$base.icns" "$app/Contents/Resources/"
  printf '#!/bin/sh\n' > "$app/Contents/MacOS/$base"
  chmod +x "$app/Contents/MacOS/$base"
  cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>logo.preview.$name.$STAMP</string>
<key>CFBundleExecutable</key><string>$base</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>$base</string>
<key>CFBundleIconName</key><string>$base</string>
</dict></plist>
PLIST
  r="$dir/r/icon"
  "$TOOLS/isrender" "$app" "$r" 1024 0 0 >/dev/null
  "$TOOLS/isrender" "$app" "$r" 512 0 0 1 0 0 2 1 2 0 2 '#2563EB' 1 2 '#2563EB' >/dev/null
  for px in 256 128 64 32 16; do "$TOOLS/isrender" "$app" "$r" $px 0 0 1 0 >/dev/null; done
  if [ -f "$dir/glyph.svg" ]; then
    rsvg-convert -z 1 "$dir/glyph.svg" -o "$dir/r/glyph-1x.png"
    rsvg-convert -z 2 "$dir/glyph.svg" -o "$dir/r/glyph-2x.png"
  else
    "$TOOLS/glyph" "$dir/r"
  fi
  echo "$name"
done
"$TOOLS/contact" "$DIRS" "$SHEETS" "$OVERVIEW"

case "$MODE" in
  --lens)  # Keep the sheets of the steps that decided it; every variant is on variants.jpg.
    for sheet in "$SHEETS"/*.jpg; do
      case "$(basename "$sheet" .jpg)" in variants | lens-a | lens-i | lens-l | lanes-m | lens-p | lens-r | lens-t) ;; *) rm "$sheet" ;; esac
    done ;;
  --chosen)  # The shipped icon in the Dock beside the runners-up, and the menu bar glyph drawings that were weighed.
    swiftc -O "$HERE/tools/context.swift" -o "$TOOLS/context"
    "$TOOLS/context" "$HERE/dock.jpg" "$DIRS/chosen/r/icon-a0-v0-256.png" "$WORK/lens/lens-t/r/icon-a0-v0-256.png" \
      "$WORK/lens/lens-a/r/icon-a0-v0-256.png"
    swiftc -O -parse-as-library "$HERE/tools/glyphs.swift" "$ROOT/Sources/Screencap/UI/MenuBarGlyph.swift" -o "$TOOLS/glyphs"
    "$TOOLS/glyphs" "$HERE/glyphs.jpg" ;;
esac
