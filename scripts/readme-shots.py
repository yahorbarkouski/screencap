"""Frames the README's screenshots: rounded window corners and a soft shadow on a dark aurora backdrop. Also lays the
frames of the main window and of the menu-bar panel on the backdrop and makes each a looping GIF with ffmpeg.

  python3 scripts/readme-shots.py RAW_DIR docs/readme

RAW_DIR holds the renders of `SCREENCAP_README=1 Screencap --store <demo> --view-only --snapshot RAW_DIR`, taken on
the made-up day of `Screencap demo-store`, so no screenshot shows anyone's real screen.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

WIDTH = 1600  # of the framed image, in pixels
GIFS = {
    "window": dict(width=1200, radius=44, margin=150),
    "popup": dict(width=600),
}


def backdrop(width, height):
    """A near-black canvas lit from its edges by soft glows of indigo, violet and teal, with a fine grain."""
    base = Image.new("RGB", (width, height), (8, 9, 14))
    glow = Image.new("RGB", (width, height), (0, 0, 0))
    draw = ImageDraw.Draw(glow)
    for (cx, cy, rx, ry, color) in [
        (0.10, -0.05, 0.42, 0.30, (99, 102, 241)),
        (0.95, 0.10, 0.30, 0.26, (139, 92, 246)),
        (0.75, 1.05, 0.48, 0.28, (20, 184, 166)),
        (-0.05, 0.95, 0.26, 0.22, (219, 39, 119)),
    ]:
        x, y, w, h = cx * width, cy * height, rx * width, ry * height
        draw.ellipse([x - w, y - h, x + w, y + h], fill=color)
    glow = glow.filter(ImageFilter.GaussianBlur(min(width, height) * 0.16))
    canvas = ImageChops.add(base, glow.point(lambda v: int(v * 0.62)))
    grain = Image.effect_noise((width, height), 22).convert("RGB")
    return Image.blend(canvas, grain, 0.03)


def stage(size, radius, margin):
    """The backdrop `margin` pixels larger than a window of `size` all round, with the window's soft shadow on it, and
    the mask that rounds the window's corners."""
    width, height = size
    canvas = backdrop(width + 2 * margin, height + 2 * margin)
    shadow = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(shadow).rounded_rectangle(
        [margin, margin + radius // 2, margin + width, margin + height + radius // 2], radius, fill=150)
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius * 1.4))
    canvas.paste(Image.new("RGB", canvas.size, (0, 0, 0)), (0, 0), shadow)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, width - 1, height - 1], radius, fill=255)
    return canvas, mask


def frame(image, radius, margin):
    canvas, mask = stage(image.size, radius, margin)
    canvas.paste(image.convert("RGB"), (margin, margin), mask)
    return canvas


def gif(frames, target, width, radius=None, margin=0):
    """Lays each frame of `frames` (PNGs from `ReadmeFrames`) on the backdrop, a window's frames framed as the
    screenshots are when `radius` is given, and encodes a looping GIF `width` pixels wide from one palette for all
    frames, so the still parts stay the same from frame to frame and compress away."""
    info = json.loads((frames / "info.json").read_text())
    paths = sorted(frames.glob("[0-9]*.png"))
    first = Image.open(paths[0])
    ground, mask = stage(first.size, radius, margin) if radius else (backdrop(*first.size), None)
    height = round(ground.height * width / ground.width)
    with tempfile.TemporaryDirectory() as work:
        for index, path in enumerate(paths):
            image = Image.open(path).convert("RGBA")
            framed = ground.copy()
            framed.paste(image, (margin, margin), mask if mask else image)
            framed.resize((width, height), Image.LANCZOS).save(Path(work) / f"{index:04d}.png")
        subprocess.run([
            "ffmpeg", "-loglevel", "error", "-y", "-framerate", str(info["fps"]), "-i", str(Path(work) / "%04d.png"),
            "-vf", "split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
            "-loop", "0", str(target),
        ], check=True)
    print(f"{target}: {width}x{height}, {len(paths)} frames at {info['fps']:g} fps, {target.stat().st_size // 1024} KB")


def main(raw, out):
    out.mkdir(parents=True, exist_ok=True)
    shots = {
        "timeline": dict(radius=44, margin=150),
        "threads": dict(radius=44, margin=150),
        "inspector": dict(radius=44, margin=150),
        "thread": dict(radius=44, margin=150),
        "onboarding": dict(radius=36, margin=110),
    }
    for name, style in shots.items():
        source = raw / f"{name}.png"
        if not source.exists():
            continue
        image = Image.open(source).convert("RGB")
        framed = frame(image, style["radius"], style["margin"])
        scale = min(1, WIDTH / framed.width)
        framed = framed.resize((round(framed.width * scale), round(framed.height * scale)), Image.LANCZOS)
        target = out / f"{name}.png"
        framed.save(target, optimize=True)
        print(f"{target}: {framed.width}x{framed.height}, {target.stat().st_size // 1024} KB")
    for name, style in GIFS.items():
        if (raw / f"{name}-frames" / "info.json").exists():
            gif(raw / f"{name}-frames", out / f"{name}.gif", **style)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
