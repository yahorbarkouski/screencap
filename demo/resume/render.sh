#!/bin/bash
# Renders the README's Resume demo into docs/readme/resume.gif, from nothing but this folder and the app's source:
#
#   demo/resume/render.sh
#
# 1. The icons of the apps in the dock, read from the apps installed on this Mac (never committed: they are theirs).
# 2. Each thread's screen as it was left, which the palette previews.
# 3. The palette and the toasts, drawn by the app itself over a throwaway store of the made-up threads.
# 4. The whole demo, frame by frame, as lossless PNGs: a GIF made from a compressed video carries the video's noise
#    into every frame, which roughly doubles its size.
# 5. The GIF, at 15 frames a second and 900 pixels wide, about the width GitHub shows it at, with one palette for
#    the whole video, so small icons and the thread colours keep their hue, and no dithering: dithering changes
#    pixels that did not move, and every changed pixel is paid for again in each frame.
#
# Needs Node, ffmpeg and Xcode.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

cd "$here"
[ -d node_modules ] || npm ci --no-audit --no-fund
swift scripts/icons.swift > /dev/null
node scripts/stills.mjs

(cd "$root" && swift build -c release --product Screencap > /dev/null)
rm -rf public/generated/palette
"$root/.build/release/Screencap" resume-story --spec story.json --out public/generated/palette

rm -rf out/frames
npx remotion render src/index.ts Demo out/frames --sequence --image-format=png --log=error
ffmpeg -v error -y -framerate 30 -pattern_type glob -i 'out/frames/element-*.png' \
  -vf "fps=15,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  "$root/docs/readme/resume.gif"
echo "docs/readme/resume.gif: $(( $(stat -f %z "$root/docs/readme/resume.gif") / 1024 )) KB"
