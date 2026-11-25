#!/bin/bash
# Renders the README's Canvas demo into docs/readme/canvas.webp, and a larger video of it into out/canvas.mp4, from
# nothing but this folder and the app's source:
#
#   demo/canvas/render.sh
#
# 1. The made-up sites' icons, and every screen of the made-up days.
# 2. The film of the app's window, drawn by the app itself over a throwaway store of those days.
# 3. The whole demo, frame by frame, as lossless PNGs.
# 4. The video, at 60 frames a second, and the README's picture: an animated WebP, at 20 frames a second and 1000 pixels
#    wide. The canvas moves as a whole, so nearly every pixel of a frame is new, which a GIF pays for in full.
#
# It shares demo/resume's engine (the captions, the type, the backdrop) and its packages. Needs Node, ffmpeg and Xcode.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

[ -d "$here/../resume/node_modules" ] || (cd "$here/../resume" && npm ci --no-audit --no-fund)
cd "$here"
[ -e node_modules ] || ln -s ../resume/node_modules node_modules
node scripts/stills.mjs

(cd "$root" && swift build -c release --product Screencap > /dev/null)
"$root/.build/release/Screencap" canvas-story --spec day.json --screens public/generated/screens --icons public/generated/icons \
  --out public/generated/app --fps 60

rm -rf out/frames
npx remotion render src/index.ts Demo out/frames --sequence --image-format=png --scale=1.5 --log=error
ffmpeg -v error -y -framerate 60 -pattern_type glob -i 'out/frames/element-*.png' \
  -vf "crop=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart out/canvas.mp4
ffmpeg -v error -y -framerate 60 -pattern_type glob -i 'out/frames/element-*.png' \
  -vf "fps=20,scale=1000:-2:flags=lanczos" -c:v libwebp_anim -quality 72 -compression_level 6 -loop 0 "$root/docs/readme/canvas.webp"
echo "docs/readme/canvas.webp: $(( $(stat -f %z "$root/docs/readme/canvas.webp") / 1024 )) KB, out/canvas.mp4: $(( $(stat -f %z out/canvas.mp4) / 1024 )) KB"
