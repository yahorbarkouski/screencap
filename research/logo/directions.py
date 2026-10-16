#!/usr/bin/env python3
"""Logo directions for Screencap, each as a layered Icon Composer file and a menu bar glyph.

    python3 research/logo/directions.py OUT_DIR            the twelve directions
    python3 research/logo/directions.py OUT_DIR --lens     the Lens variants
    python3 research/logo/directions.py Resources --ship   the shipped one, Strip, as Resources/AppIcon.icon
                                                           (--ship lens-t writes the runner-up, Lens T)

writes OUT_DIR/<name>/<name>.icon (icon.json plus SVG layers on the 1024 canvas that macOS masks to its rounded
square) and OUT_DIR/<name>/glyph.svg (a template image 22 pt tall, black on clear). research/logo/render.sh
compiles and renders them; research/logo/README.md has what each showed. Standard library only.
"""
import json
import math
import os
import sys

# Thread colours: the app's mark hues, lifted a step so they read as glass on ink.
VIOLET, INDIGO, TEAL, PINK, AMBER, SKY, ORANGE, GREEN = (
    "#8B5CF6", "#6366F1", "#14B8A6", "#EC4899", "#F59E0B", "#38BDF8", "#F97316", "#22C55E")
WHITE = "#FFFFFF"
INK = ("#262733", "#0B0B10")  # top and bottom of the background gradient


def rgb(hex_color, alpha=1.0):
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return f"srgb:{r:.5f},{g:.5f},{b:.5f},{alpha:.5f}"


# ---- SVG primitives --------------------------------------------------------------------------------------------

def svg(body, size=1024):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">\n'
            f'{body}\n</svg>\n')


def rrect_d(x, y, w, h, r):
    """Path data for a rectangle with corner radii r = radius or (top-left, top-right, bottom-right, bottom-left)."""
    tl, tr, br, bl = (r, r, r, r) if isinstance(r, (int, float)) else r
    return (f"M{x + tl:.2f},{y:.2f} H{x + w - tr:.2f} A{tr},{tr} 0 0 1 {x + w:.2f},{y + tr:.2f} "
            f"V{y + h - br:.2f} A{br},{br} 0 0 1 {x + w - br:.2f},{y + h:.2f} H{x + bl:.2f} "
            f"A{bl},{bl} 0 0 1 {x:.2f},{y + h - bl:.2f} V{y + tl:.2f} A{tl},{tl} 0 0 1 {x + tl:.2f},{y:.2f} Z")


def rrect(x, y, w, h, r, fill, opacity=1.0):
    op = f' fill-opacity="{opacity}"' if opacity < 1 else ""
    return f'<path d="{rrect_d(x, y, w, h, r)}" fill="{fill}"{op}/>'


def segments(x0, x1, y, h, parts, gap, inner, cut=None):
    """A capsule from x0 to x1 split into parts [(weight, colour)], with gap between parts and inner corner radius.
    cut = (cx, half_width) leaves a gap around x = cx (for a playhead). Returns (colour, path d) pairs."""
    total = sum(w for w, _ in parts)
    usable = (x1 - x0) - gap * (len(parts) - 1)
    out, x = [], x0
    for i, (w, colour) in enumerate(parts):
        width = usable * w / total
        a, b = x, x + width
        pieces = [(a, b)]
        if cut and a < cut[0] + cut[1] and b > cut[0] - cut[1]:
            pieces = [(a, cut[0] - cut[1]), (cut[0] + cut[1], b)]
        for pa, pb in pieces:
            if pb - pa < 1:
                continue
            left = h / 2 if abs(pa - x0) < 0.5 else inner
            right = h / 2 if abs(pb - x1) < 0.5 else inner
            out.append((colour, rrect_d(pa, y, pb - pa, h, (left, right, right, left))))
        x = b + gap
    return out


def paths(pairs, opacity=1.0):
    op = f' fill-opacity="{opacity}"' if opacity < 1 else ""
    return "\n".join(f'<path d="{d}" fill="{c}"{op}/>' for c, d in pairs)


def polyline_d(points):
    return "M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in points)


def stroke(points, colour, width, opacity=1.0):
    op = f' stroke-opacity="{opacity}"' if opacity < 1 else ""
    return (f'<path d="{polyline_d(points)}" fill="none" stroke="{colour}" stroke-width="{width}" '
            f'stroke-linecap="round" stroke-linejoin="round"{op}/>')


def split_by_length(points, parts, gap):
    """Splits a polyline into consecutive runs whose lengths follow the weights in parts, with gap between runs.
    Returns (colour, points) pairs."""
    cum = [0.0]
    for i in range(len(points) - 1):
        cum.append(cum[-1] + math.dist(points[i], points[i + 1]))

    def at(d):
        for i in range(len(points) - 1):
            if cum[i] <= d <= cum[i + 1]:
                t = (d - cum[i]) / ((cum[i + 1] - cum[i]) or 1)
                (ax, ay), (bx, by) = points[i], points[i + 1]
                return (ax + (bx - ax) * t, ay + (by - ay) * t)
        return points[-1]
    weights = sum(w for w, _ in parts)
    usable = cum[-1] - gap * (len(parts) - 1)
    runs, d = [], 0.0
    for w, colour in parts:
        a, b = d, d + usable * w / weights
        runs.append((colour, [at(a)] + [p for p, c in zip(points, cum) if a < c < b] + [at(b)]))
        d = b + gap
    return runs


def arc_points(cx, cy, r, a0, a1, n=96):
    """Points on a circle from angle a0 to a1 in degrees, clockwise from 12 o'clock."""
    return [(cx + r * math.sin(math.radians(a0 + (a1 - a0) * i / n)),
             cy - r * math.cos(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def rounded_spiral(cx, cy, first, pitch, turns, radius, step=6):
    """A square spiral from the centre outwards with rounded corners, as a dense polyline."""
    corners = [(cx, cy)]
    x, y = cx, cy
    dirs = [(1, 0), (0, 1), (-1, 0), (0, -1)]
    for i in range(int(turns * 4)):
        dx, dy = dirs[i % 4]
        length = first + pitch * (i // 2)
        x, y = x + dx * length, y + dy * length
        corners.append((x, y))
    pts = [corners[0]]
    for i in range(1, len(corners) - 1):
        p0, p1, p2 = corners[i - 1], corners[i], corners[i + 1]
        r = min(radius, math.dist(p0, p1) / 2, math.dist(p1, p2) / 2)
        a = (p1[0] + (p0[0] - p1[0]) * r / math.dist(p0, p1), p1[1] + (p0[1] - p1[1]) * r / math.dist(p0, p1))
        c = (p1[0] + (p2[0] - p1[0]) * r / math.dist(p1, p2), p1[1] + (p2[1] - p1[1]) * r / math.dist(p1, p2))
        k = max(1, int(math.dist(pts[-1], a) / step))
        pts += [(pts[-1][0] + (a[0] - pts[-1][0]) * j / k, pts[-1][1] + (a[1] - pts[-1][1]) * j / k) for j in range(1, k + 1)]
        for j in range(1, 13):
            t = j / 12
            pts.append(((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * p1[0] + t * t * c[0],
                        (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * p1[1] + t * t * c[1]))
    end = corners[-1]
    k = max(1, int(math.dist(pts[-1], end) / step))
    pts += [(pts[-1][0] + (end[0] - pts[-1][0]) * j / k, pts[-1][1] + (end[1] - pts[-1][1]) * j / k) for j in range(1, k + 1)]
    return pts


# ---- Icon Composer document ------------------------------------------------------------------------------------

def group(layers, *, translucency=0.0, shadow=0.5, specular=True, kind="neutral", blur=None):
    g = {"layers": [{"image-name": f"{name}.svg", "name": name, "glass": glass,
                     **({"opacity": opacity} if opacity < 1 else {})}
                    for name, _, glass, opacity in layers],
         "shadow": {"kind": kind, "opacity": shadow},
         "translucency": {"enabled": translucency > 0, "value": translucency},
         "specular": specular}
    if blur is not None:
        g["blur-material"] = blur
    return g


def write_icon(folder, name, groups, fill, dark_fill=None):
    """groups: list (back to front) of (group options, [(layer name, svg, glass, opacity)])."""
    icon = os.path.join(folder, f"{name}.icon")
    os.makedirs(os.path.join(icon, "Assets"), exist_ok=True)
    doc_groups = []
    for options, layers in reversed(groups):  # icon.json lists the front group first
        for layer_name, body, _, _ in layers:
            with open(os.path.join(icon, "Assets", f"{layer_name}.svg"), "w") as f:
                f.write(svg(body))
        doc_groups.append(group(layers, **options))
    doc = {"fill": fill, "groups": doc_groups, "supported-platforms": {"squares": ["macOS"]}}
    if dark_fill:
        doc["fill-specializations"] = [{"value": fill}, {"appearance": "dark", "value": dark_fill}]
        del doc["fill"]
    with open(os.path.join(icon, "icon.json"), "w") as f:
        json.dump(doc, f, indent=2)


def ink(top=INK[0], bottom=INK[1]):
    return {"linear-gradient": [rgb(top), rgb(bottom)]}


def glyph(folder, body):
    with open(os.path.join(folder, "glyph.svg"), "w") as f:
        f.write(svg(body, 22))


def gpath(d, opacity=1.0):
    op = f' fill-opacity="{opacity}"' if opacity < 1 else ""
    return f'<path d="{d}" fill="#000"{op}/>'


def gstroke(points, width=2.0, opacity=1.0):
    return stroke(points, "#000", width, opacity)


# ---- The directions ----------------------------------------------------------------------------------------------

DAY = [(3, VIOLET), (1.6, ORANGE), (2.6, TEAL), (1.2, PINK), (2.2, INDIGO)]


def strip(folder, name="Strip"):
    """The day strip, the app's signature: a capsule of thread colours with a playhead on the moment you look at."""
    playhead_x = 600
    segs = segments(150, 874, 437, 150, DAY, 18, 26, cut=(playhead_x, 40))
    write_icon(folder, name, [
        ({"translucency": 0.0, "shadow": 0.45}, [("1-strip", paths(segs), True, 1.0)]),
        ({"shadow": 0.6}, [("2-playhead", rrect(playhead_x - 22, 318, 44, 388, 22, WHITE), True, 1.0)]),
    ], ink())
    g = segments(2, 20, 8, 6, [(1, "#000"), (1.2, "#000"), (1, "#000")], 1, 1, cut=(13.5, 2))
    glyph(folder, paths(g) + rrect(12.5, 3.5, 2, 15, 1, "#000"))


def moment(folder):
    """The popup in one picture: the day strip with the playhead on a moment, and that moment held below it."""
    playhead_x = 586
    segs = segments(166, 858, 236, 96, DAY, 16, 18, cut=(playhead_x, 30))
    write_icon(folder, "Moment", [
        ({"shadow": 0.4}, [("1-strip", paths(segs), True, 1.0)]),
        ({"translucency": 0.3, "shadow": 0.6}, [("2-card", rrect(212, 414, 600, 400, 66, WHITE), True, 1.0)]),
        ({"shadow": 0.6}, [("3-playhead", rrect(playhead_x - 18, 196, 36, 176, 18, WHITE), True, 1.0)]),
    ], ink())
    g = segments(2, 20, 3, 4, [(1, "#000"), (1, "#000"), (1, "#000")], 1, 1, cut=(13, 1.5))
    glyph(folder, paths(g) + rrect(12, 1, 2, 8, 1, "#000") + gpath(rrect_d(3, 10, 16, 10.5, 2.5)))


def lens(folder):
    """A pane of glass held still over the day strip: the moment in focus, the rest of the day running past."""
    segs = segments(112, 912, 448, 128, DAY, 14, 20)
    write_icon(folder, "Lens", [
        ({"shadow": 0.4}, [("1-strip", paths(segs), True, 1.0)]),
        ({"translucency": 0.7, "shadow": 0.7, "blur": 0.6}, [("2-pane", rrect(322, 302, 380, 420, 92, WHITE), True, 0.3)]),
    ], ink())
    left = segments(1, 5.5, 9, 4, [(1, "#000")], 1, 1)
    right = segments(16.5, 21, 9, 4, [(1, "#000")], 1, 1)
    frame = gpath(rrect_d(6.5, 3, 9, 16, 3) + " " + rrect_d(8.25, 4.75, 5.5, 12.5, 1.5)).replace("/>", ' fill-rule="evenodd"/>')
    glyph(folder, paths(left + right) + frame + gpath(rrect_d(8.25, 9, 5.5, 4, 0), 0.45))


def lens_variant(folder, title, note, pane, strip_h=128, parts=None, fill=None, frost=0.3, glyph_kind="track",
                 span=(112, 912), flat=False, dark_fill=None, strip_y=512, pane_y=512, spans=None):
    """Draws a Lens variant: pane = (centre x, width, height, radius); span = the strip's ends (past the canvas
    to run off the edges); flat = no specular highlight on the strip, so the pane is the only glass."""
    cx, pw, ph, pr = pane
    segs = segments(span[0], span[1], strip_y - strip_h / 2, strip_h, parts or DAY, 14, strip_h * 0.16)
    if spans:  # explicit (x0, x1, colour) pieces instead of weights
        segs = [(c, rrect_d(x0, strip_y - strip_h / 2, x1 - x0, strip_h, strip_h * 0.16)) for x0, x1, c in spans]
    strip_group = {"shadow": 0.2, "specular": False} if flat else {"shadow": 0.4}
    write_icon(folder, title.replace(" ", ""), [
        (strip_group, [("1-strip", paths(segs), True, 1.0)]),
        ({"translucency": 0.7, "shadow": 0.7, "blur": 0.6},
         [("2-pane", rrect(cx - pw / 2, pane_y - ph / 2, pw, ph, pr, WHITE), True, frost)]),
    ], fill or ink(), dark_fill)
    lens_glyph(folder, glyph_kind)
    with open(os.path.join(folder, "meta.json"), "w") as f:
        json.dump({"name": title, "note": note}, f)


def lens_glyph(folder, kind):
    evenodd = lambda d: gpath(d).replace("/>", ' fill-rule="evenodd"/>')
    if kind == "track":  # pane outline on a two-piece track, the strip faint inside the pane
        body = (paths(segments(1, 5.5, 9, 4, [(1, "#000")], 1, 1) + segments(16.5, 21, 9, 4, [(1, "#000")], 1, 1)) +
                evenodd(rrect_d(6.5, 3, 9, 16, 3) + " " + rrect_d(8.25, 4.75, 5.5, 12.5, 1.5)) +
                gpath(rrect_d(8.25, 9, 5.5, 4, 0), 0.45))
    elif kind == "wide":  # a landscape pane over a segmented track
        body = (paths(segments(0.5, 4.5, 9, 4, [(1, "#000")], 1, 1) + segments(17.5, 21.5, 9, 4, [(1, "#000")], 1, 1)) +
                evenodd(rrect_d(5.5, 4, 11, 14, 3.2) + " " + rrect_d(7.25, 5.75, 7.5, 10.5, 1.6)) +
                gpath(rrect_d(7.25, 9, 7.5, 4, 0), 0.45))
    elif kind == "solid":  # a filled pane, the strip continuing through it as a cut
        body = (paths(segments(1, 5, 9, 4, [(1, "#000")], 1, 1) + segments(17, 21, 9, 4, [(1, "#000")], 1, 1)) +
                evenodd(rrect_d(6, 3.5, 10, 15, 3) + " " + rrect_d(6, 9, 10, 4, 0)) )
    elif kind == "segments":  # pane outline on a three-segment track (the strip's thread colours as separate pieces)
        body = (paths(segments(0.5, 21.5, 9, 4, [(1.4, "#000"), (1, "#000"), (1, "#000"), (1.4, "#000")], 1, 1,
                               cut=(11, 5.5))) +
                evenodd(rrect_d(6.5, 3, 9, 16, 3) + " " + rrect_d(8.25, 4.75, 5.5, 12.5, 1.5)) +
                gpath(rrect_d(8.25, 9, 5.5, 4, 0), 0.45))
    elif kind == "frost":  # the pane frosted (a light fill), the strip seen through it, on a two-piece track
        body = (paths(segments(1, 6, 9, 4, [(1, "#000")], 1, 1) + segments(16, 21, 9, 4, [(1, "#000")], 1, 1)) +
                evenodd(rrect_d(7, 3, 8, 16, 3) + " " + rrect_d(8.5, 4.5, 5, 13, 1.6)) +
                gpath(rrect_d(8.5, 4.5, 5, 13, 1.6), 0.22) + gpath(rrect_d(8.5, 9, 5, 4, 0), 0.5))
    elif kind == "now":  # the strip from the left into a pane outline, nothing after it
        body = (paths(segments(0.5, 10, 9, 4, [(1.2, "#000"), (1, "#000")], 1, 1)) +
                evenodd(rrect_d(9, 3, 10.5, 16, 3.2) + " " + rrect_d(10.75, 4.75, 7, 12.5, 1.7)) +
                gpath(rrect_d(10.75, 9, 3.5, 4, (0, 1.2, 1.2, 0)), 0.5))
    elif kind == "dashes":  # a landscape pane, two pieces of the strip on each side
        body = (paths(segments(0, 6, 9, 4, [(1, "#000"), (1, "#000")], 1.2, 0.8) +
                      segments(16, 22, 9, 4, [(1, "#000"), (1, "#000")], 1.2, 0.8)) +
                evenodd(rrect_d(6.5, 4, 9, 14, 3) + " " + rrect_d(8.25, 5.75, 5.5, 10.5, 1.5)) +
                gpath(rrect_d(8.25, 9, 5.5, 4, 0), 0.5))
    elif kind == "pane":  # a landscape pane outline on one piece of strip each side, the strip faint inside
        body = (paths([("#000", rrect_d(1, 9, 4, 4, (1.6, 1, 1, 1.6))), ("#000", rrect_d(17, 9, 4, 4, (1, 1.6, 1.6, 1)))]) +
                evenodd(rrect_d(6, 5, 10, 12, 3) + " " + rrect_d(7.5, 6.5, 7, 9, 1.6)) +
                gpath(rrect_d(7.5, 9, 7, 4, 0), 0.5))
    elif kind == "panefrost":  # the same pane frosted: a light fill, the strip a little stronger through it
        body = (paths([("#000", rrect_d(1, 9, 4, 4, (1.6, 1, 1, 1.6))), ("#000", rrect_d(17, 9, 4, 4, (1, 1.6, 1.6, 1)))]) +
                evenodd(rrect_d(6, 5, 10, 12, 3) + " " + rrect_d(7.5, 6.5, 7, 9, 1.6)) +
                gpath(rrect_d(7.5, 6.5, 7, 9, 1.6), 0.25) + gpath(rrect_d(7.5, 9, 7, 4, 0), 0.45))
    elif kind == "panesolid":  # a solid pane with the strip running through it as a cut
        body = (paths([("#000", rrect_d(1, 9, 4, 4, (1.6, 1, 1, 1.6))), ("#000", rrect_d(17, 9, 4, 4, (1, 1.6, 1.6, 1)))]) +
                evenodd(rrect_d(6, 5, 10, 12, 3) + " " + rrect_d(6, 9.5, 10, 3, 0)) + gpath(rrect_d(6, 9.5, 10, 3, 0), 0.4))
    glyph(folder, body)


def lanes_variant(folder, title, note, pane, lanes, lane_h, fill=None, frost=0.42, glyph_body=""):
    """Thread lanes (one colour per thread, segments where it was active) behind a frosted pane:
    lanes = [(y centre, [(x0, x1), ...], colour)]."""
    cx, cy, pw, ph, pr = pane
    body = "\n".join(rrect(x0, y - lane_h / 2, x1 - x0, lane_h, lane_h / 2, c) for y, spans, c in lanes for x0, x1 in spans)
    write_icon(folder, title.replace(" ", ""), [
        ({"shadow": 0.2, "specular": False}, [("1-threads", body, True, 1.0)]),
        ({"translucency": 0.7, "shadow": 0.7, "blur": 0.6},
         [("2-pane", rrect(cx - pw / 2, cy - ph / 2, pw, ph, pr, WHITE), True, frost)]),
    ], fill or ink())
    glyph(folder, glyph_body)
    with open(os.path.join(folder, "meta.json"), "w") as f:
        json.dump({"name": title, "note": note}, f)


FINAL_DAY = [(2.6, VIOLET), (1.2, ORANGE), (1.6, TEAL), (0.9, SKY), (1.0, PINK), (2.2, INDIGO)]

LENS_VARIANTS = [
    ("lens-a", "Lens A", "Portrait pane, as first drawn.", dict(pane=(512, 380, 420, 92))),
    ("lens-b", "Lens B", "A landscape pane, a screen's proportions.", dict(pane=(512, 470, 340, 84), glyph_kind="wide")),
    ("lens-c", "Lens C", "A square pane over a thicker strip.", dict(pane=(512, 400, 400, 100), strip_h=156)),
    ("lens-d", "Lens D", "The pane later in the day, off centre.", dict(pane=(598, 360, 420, 90), glyph_kind="segments")),
    ("lens-e", "Lens E", "Indigo night behind it, the README's aurora hue.",
     dict(pane=(512, 380, 420, 92), fill={"linear-gradient": [rgb("#2B2F6B"), rgb("#0C0D22")]}, glyph_kind="solid")),
    ("lens-f", "Lens F", "More frost, and a day of seven threads.",
     dict(pane=(512, 380, 420, 92), frost=0.45,
          parts=[(1.6, VIOLET), (1, SKY), (1.4, ORANGE), (2, TEAL), (0.8, AMBER), (1.2, PINK), (1.6, INDIGO)])),
    ("lens-g", "Lens G", "Finalist on ink: a lighter frost, six threads, the frosted glyph.",
     dict(pane=(512, 392, 432, 96), strip_h=132, frost=0.42, parts=FINAL_DAY, glyph_kind="frost")),
    ("lens-h", "Lens H", "Finalist on indigo night.",
     dict(pane=(512, 392, 432, 96), strip_h=132, frost=0.42, parts=FINAL_DAY, glyph_kind="track",
          fill={"linear-gradient": [rgb("#2B2F6B"), rgb("#0C0D22")]})),
    ("lens-i", "Lens I", "Bigger: the strip runs off both edges, the pane is the only glass.",
     dict(pane=(512, 470, 560, 118), strip_h=196, frost=0.42, parts=FINAL_DAY, span=(-60, 1084), flat=True,
          glyph_kind="frost")),
    ("lens-j", "Lens J", "The same on white, with ink for the dark appearance.",
     dict(pane=(512, 470, 560, 118), strip_h=196, frost=0.42, parts=FINAL_DAY, span=(-60, 1084), flat=True,
          glyph_kind="frost", fill={"linear-gradient": [rgb("#FFFFFF"), rgb("#E9E9EF")]}, dark_fill=ink())),
    ("lens-k", "Lens K", "Bigger, the strip's ends inside the square, every piece glass.",
     dict(pane=(512, 440, 520, 112), strip_h=180, frost=0.42, parts=FINAL_DAY, span=(84, 940), glyph_kind="frost")),
    ("lens-l", "Lens L", "The pane takes the square; the day shows at its sides and through it.",
     dict(pane=(512, 620, 520, 128), strip_h=220, frost=0.42, parts=FINAL_DAY, span=(-60, 1084), flat=True,
          glyph_kind="wide")),
    ("lens-o", "Lens O", "A frosted screen resting on the day strip.",
     dict(pane=(512, 600, 420, 104), strip_h=150, frost=0.42, parts=FINAL_DAY, span=(-60, 1084), flat=True,
          glyph_kind="wide", strip_y=660, pane_y=470)),
    ("lens-r", "Lens R", "Lens L with the day's pieces showing at both sides, so the strip reads as the day, not a band.",
     dict(pane=(512, 560, 500, 124), strip_h=180, frost=0.42, flat=True, glyph_kind="dashes",
          spans=[(-60, 96, VIOLET), (114, 300, ORANGE), (318, 520, TEAL), (538, 640, SKY), (658, 860, PINK),
                 (878, 1084, INDIGO)])),
    ("lens-s", "Lens S", "Lens R with every piece of the strip in glass.",
     dict(pane=(512, 560, 500, 124), strip_h=180, frost=0.42, flat=False, glyph_kind="wide",
          spans=[(-60, 96, VIOLET), (114, 300, ORANGE), (318, 520, TEAL), (538, 640, SKY), (658, 860, PINK),
                 (878, 1084, INDIGO)])),
    ("lens-r1", "Lens R1", "Lens R with the pane glyph.",
     dict(pane=(512, 560, 500, 124), strip_h=180, frost=0.42, flat=True, glyph_kind="pane", spans=[(-60, 96, VIOLET), (114, 300, ORANGE), (318, 520, TEAL), (538, 640, SKY), (658, 860, PINK),
                 (878, 1084, INDIGO)])),
    ("lens-r2", "Lens R2", "Lens R with the frosted pane glyph.",
     dict(pane=(512, 560, 500, 124), strip_h=180, frost=0.42, flat=True, glyph_kind="panefrost", spans=[(-60, 96, VIOLET), (114, 300, ORANGE), (318, 520, TEAL), (538, 640, SKY), (658, 860, PINK),
                 (878, 1084, INDIGO)])),
    ("lens-r3", "Lens R3", "Lens R with the solid pane glyph.",
     dict(pane=(512, 560, 500, 124), strip_h=180, frost=0.42, flat=True, glyph_kind="panesolid", spans=[(-60, 96, VIOLET), (114, 300, ORANGE), (318, 520, TEAL), (538, 640, SKY), (658, 860, PINK),
                 (878, 1084, INDIGO)])),
    ("lens-t", "Lens T", "Lens R with a wider, lower pane, a screen's proportions.",
     dict(pane=(512, 600, 440, 112), strip_h=184, frost=0.42, flat=True, glyph_kind="pane",
          spans=[(-60, 76, VIOLET), (94, 280, ORANGE), (298, 500, TEAL), (518, 620, SKY), (638, 880, PINK),
                 (898, 1084, INDIGO)])),
    ("lens-p", "Lens P", "The day so far: the strip comes in from the left and ends under the pane, at now.",
     dict(pane=(604, 452, 500, 116), strip_h=196, frost=0.42, parts=[(2.4, VIOLET), (1.1, ORANGE), (1.6, TEAL), (1.1, PINK)],
          span=(-60, 690), flat=True, glyph_kind="now")),
    ("lens-q", "Lens Q", "The day so far, the pane centred.",
     dict(pane=(512, 470, 520, 120), strip_h=196, frost=0.42, parts=[(2.0, VIOLET), (1.0, ORANGE), (1.4, TEAL), (1.0, PINK)],
          span=(-60, 600), flat=True, glyph_kind="now")),
]

LANES = [
    ("lanes-m", "Lanes M", "Three threads running in parallel through the day, seen through a frosted pane.",
     dict(pane=(512, 512, 520, 560, 120), lane_h=104,
          lanes=[(352, [(-60, 220), (300, 610), (700, 1084)], VIOLET),
                 (512, [(-60, 120), (190, 520), (580, 1084)], TEAL),
                 (672, [(-60, 330), (420, 760), (840, 1084)], PINK)])),
]


def lift(folder):
    """One moment lifted out of the day: the strip keeps its place, and the piece you came back for rises from it."""
    parts = [(2.6, VIOLET), (1.6, ORANGE), (2.2, None), (1.3, PINK), (2.2, INDIGO)]
    segs = segments(140, 884, 548, 132, [(w, c or "#000") for w, c in parts], 18, 24)
    slot = None
    kept = []
    for c, d in segs:
        if c == "#000":
            slot = d
        else:
            kept.append((c, d))
    # The lifted piece: the slot's shape, raised and a little larger.
    total = sum(w for w, _ in parts)
    usable = (884 - 140) - 18 * 4
    x = 140 + usable * (2.6 + 1.6) / total + 36
    w = usable * 2.2 / total
    write_icon(folder, "Lift", [
        ({"shadow": 0.3}, [("1-slot", f'<path d="{slot}" fill="{WHITE}" fill-opacity="0.12"/>', True, 1.0)]),
        ({"shadow": 0.45}, [("2-strip", paths(kept), True, 1.0)]),
        ({"shadow": 0.7}, [("3-moment", rrect(x - 22, 330, w + 44, 156, 30, TEAL), True, 1.0)]),
    ], ink())
    gs = segments(1.5, 20.5, 13, 5, [(1, "#000"), (1, None), (1, "#000")], 1.5, 1.2)
    out = [gpath(d) if c else gpath(d, 0.3) for c, d in gs]
    glyph(folder, "\n".join(out) + gpath(rrect_d(7.4, 5, 7.2, 5.5, 1.6)))


def week(folder):
    """The week stacked a day per row, the same hours lined up, so the threads you keep coming back to stand out."""
    rows = [
        [(2, VIOLET), (1, None), (2.4, TEAL), (1.2, AMBER), (1.4, None), (1, PINK)],
        [(1.2, None), (2.6, VIOLET), (1.2, PINK), (2.2, TEAL), (1.6, INDIGO)],
        [(2.2, VIOLET), (2.4, TEAL), (0.8, None), (1.4, PINK), (1.8, AMBER)],
        [(1.6, INDIGO), (2.6, VIOLET), (1.8, TEAL), (1.2, PINK), (0.8, None)],
    ]
    layers = []
    for i, row in enumerate(rows):
        y = 262 + i * 136
        segs = segments(152, 872, y, 92, [(w, c or "#000") for w, c in row], 14, 18)
        body = "\n".join(f'<path d="{d}" fill="{c if c != "#000" else WHITE}" fill-opacity="{1 if c != "#000" else 0.1}"/>'
                         for c, d in segs)
        layers.append((f"{i + 1}-day", body, True, [0.45, 0.6, 0.8, 1.0][i]))
    write_icon(folder, "Week", [({"shadow": 0.45}, layers)], ink())
    out = []
    for i, row in enumerate(rows[:3]):
        segs = segments(2, 20, 4.5 + i * 5, 3, [(w, c or "#000") for w, c in row], 1, 1)
        out += [gpath(d, [0.45, 0.7, 1][i] if c != "#000" else 0.15) for c, d in segs]
    glyph(folder, "\n".join(out))


def ring(folder):
    """The day as a dial: twenty-four hours round with noon at the top, the waking hours in thread colours, a bead
    where you are now."""
    cx = cy = 512
    r, width = 290, 112
    day = [(2.4, VIOLET), (1.2, ORANGE), (2.2, TEAL), (1.0, PINK), (1.8, INDIGO)]
    pts = arc_points(cx, cy, r, 210, 510, 300)  # 07:00 to 21:00 with noon at the top
    runs = split_by_length(pts, day, 42)
    body = "\n".join(stroke(run, c, width) for c, run in runs)
    now = arc_points(cx, cy, r, 420, 420, 1)[0]  # 16:00
    write_icon(folder, "Ring", [
        ({"shadow": 0.45}, [("1-day", body, True, 1.0)]),
        ({"shadow": 0.6}, [("2-now", f'<circle cx="{now[0]:.1f}" cy="{now[1]:.1f}" r="86" fill="{WHITE}"/>', True, 1.0)]),
    ], ink())
    gr = split_by_length(arc_points(11, 11, 7.5, 210, 510, 120), [(1, ""), (1, ""), (1, "")], 2.6)
    gn = arc_points(11, 11, 7.5, 420, 420, 1)[0]
    glyph(folder, "\n".join(gstroke(run, 3) for _, run in gr) +
          f'<circle cx="{gn[0]:.2f}" cy="{gn[1]:.2f}" r="3.6" fill="#000"/>')


def columns(folder):
    """The parallel timeline: threads as columns, side by side through the day, with the line of now across."""
    w, xs = 132, (232, 446, 660)
    blocks = [(xs[0], 208, 232, VIOLET), (xs[0], 492, 120, VIOLET), (xs[0], 694, 122, VIOLET),
              (xs[1], 288, 448, TEAL),
              (xs[2], 208, 112, PINK), (xs[2], 380, 172, PINK), (xs[2], 632, 184, PINK)]
    body = "\n".join(rrect(x, y, w, h, 44, c) for x, y, h, c in blocks)
    write_icon(folder, "Columns", [
        ({"shadow": 0.45}, [("1-blocks", body, True, 1.0)]),
    ], ink())
    gb = [(2, 3, 7), (2, 12, 3.5), (2, 17.5, 2.5), (9, 5, 13.5), (16, 3, 3), (16, 8, 5), (16, 15, 4)]
    glyph(folder, "\n".join(gpath(rrect_d(x, y, 4, h, 1.6)) for x, y, h in gb))


def braid(folder):
    """Three threads plaited into one day: what you did in parallel, kept together."""
    cy, amp, lam, width = 512, 150, 600, 104
    xs = [148 + i * 2 for i in range(365)]
    phases = [0, 2 * math.pi / 3, 4 * math.pi / 3]
    colours = [VIOLET, TEAL, PINK]
    curves = [[(x, cy + amp * math.sin(2 * math.pi * (x - 148) / lam + p)) for x in xs] for p in phases]
    # Find crossings and decide who passes over: the thread heading down goes over.
    under = [set() for _ in curves]
    for a in range(3):
        for b in range(a + 1, 3):
            for i in range(len(xs) - 1):
                da = curves[a][i][1] - curves[b][i][1]
                db = curves[a][i + 1][1] - curves[b][i + 1][1]
                if da * db <= 0:
                    slope_a = curves[a][i + 1][1] - curves[a][i][1]
                    lower = b if slope_a > 0 else a
                    for j in range(len(xs)):
                        if abs(xs[j] - xs[i]) < width * 0.95:
                            under[lower].add(j)
    layers = []
    for k, (curve, colour) in enumerate(zip(curves, colours)):
        runs, run = [], []
        for j, p in enumerate(curve):
            if j in under[k]:
                if run:
                    runs.append(run)
                run = []
            else:
                run.append(p)
        if run:
            runs.append(run)
        layers.append((f"{k + 1}-thread", "\n".join(stroke(r, colour, width) for r in runs if len(r) > 1), True, 1.0))
    write_icon(folder, "Braid", [({"shadow": 0.5}, layers)], ink())
    gx = [2 + i * 0.25 for i in range(73)]
    gl = []
    for p in phases:
        curve = [(x, 11 + 4.5 * math.sin(2 * math.pi * (x - 2) / 12 + p)) for x in gx]
        gl.append(curve)
    gu = [set() for _ in gl]
    for a in range(3):
        for b in range(a + 1, 3):
            for i in range(len(gx) - 1):
                if (gl[a][i][1] - gl[b][i][1]) * (gl[a][i + 1][1] - gl[b][i + 1][1]) <= 0:
                    lower = b if gl[a][i + 1][1] > gl[a][i][1] else a
                    for j in range(len(gx)):
                        if abs(gx[j] - gx[i]) < 2.6:
                            gu[lower].add(j)
    out = []
    for k, curve in enumerate(gl):
        run = []
        for j, p in enumerate(curve):
            if j in gu[k]:
                if len(run) > 1:
                    out.append(gstroke(run, 2))
                run = []
            else:
                run.append(p)
        if len(run) > 1:
            out.append(gstroke(run, 2))
    glyph(folder, "\n".join(out))


def knot(folder):
    """A thread with one loop in it, the string tied round a finger: the oldest way to remember something."""
    d = ("M150,676 C300,676 420,668 512,592 C604,516 660,420 612,336 C572,268 470,262 428,330 "
         "C384,402 420,520 520,604 C600,670 720,676 874,676")
    body = (f'<defs><linearGradient id="t" x1="150" y1="0" x2="874" y2="0" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{INDIGO}"/><stop offset="0.5" stop-color="{VIOLET}"/>'
            f'<stop offset="1" stop-color="{PINK}"/></linearGradient></defs>'
            f'<path d="{d}" fill="none" stroke="url(#t)" stroke-width="96" stroke-linecap="round"/>')
    write_icon(folder, "Knot", [({"shadow": 0.5}, [("1-thread", body, True, 1.0)])], ink())
    gd = "M2,15.5 C6,15.5 9,15 11,13 C13.2,10.8 14.2,8 12.8,6 C11.6,4.4 9.2,4.6 8.6,6.6 C8,8.8 9.4,11.4 11.6,13.2 C13.6,14.9 16.5,15.5 20,15.5"
    glyph(folder, f'<path d="{gd}" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"/>')


def coil(folder):
    """The day strip wound into a coil: hours stacked round each other, each stretch in its thread's colour."""
    pts = rounded_spiral(512, 512, 92, 128, 2.75, 60)
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    dx, dy = 512 - (min(xs) + max(xs)) / 2, 512 - (min(ys) + max(ys)) / 2
    pts = [(x + dx, y + dy) for x, y in pts]
    runs = split_by_length(pts, [(1.2, PINK), (2.2, TEAL), (1.6, ORANGE), (3.0, VIOLET), (2.4, INDIGO)], 40)
    body = "\n".join(stroke(run, c, 84) for c, run in runs)
    write_icon(folder, "Coil", [({"shadow": 0.45}, [("1-coil", body, True, 1.0)])], ink())
    gp = rounded_spiral(11, 11, 3, 4, 2.75, 1.6, 0.5)
    gxs, gys = [p[0] for p in gp], [p[1] for p in gp]
    gdx, gdy = 11 - (min(gxs) + max(gxs)) / 2, 11 - (min(gys) + max(gys)) / 2
    glyph(folder, gstroke([(x + gdx, y + gdy) for x, y in gp], 2))


def tiles(folder):
    """The day as a mosaic, a tile per stretch of time, coloured by thread, with one lit tile for now."""
    size, gap, x0 = 132, 34, 512 - (4 * 132 + 3 * 34) / 2
    pattern = [[VIOLET, VIOLET, None, TEAL], [TEAL, TEAL, PINK, PINK], [None, AMBER, AMBER, VIOLET],
               [VIOLET, WHITE, None, None]]
    colour_tiles, empty, now = [], [], ""
    for r, row in enumerate(pattern):
        for c, colour in enumerate(row):
            x, y = x0 + c * (size + gap), x0 + r * (size + gap)
            if colour is None:
                empty.append(rrect(x, y, size, size, 38, WHITE, 0.12))
            elif colour == WHITE:
                now = rrect(x, y, size, size, 38, WHITE)
            else:
                colour_tiles.append(rrect(x, y, size, size, 38, colour))
    write_icon(folder, "Tiles", [
        ({"shadow": 0.3}, [("1-empty", "\n".join(empty), True, 1.0)]),
        ({"shadow": 0.45}, [("2-tiles", "\n".join(colour_tiles), True, 1.0)]),
        ({"shadow": 0.6}, [("3-now", now, True, 1.0)]),
    ], ink())
    alpha = [[1, 1, .25, .6], [.6, .6, 1, 1], [.25, .6, .6, 1], [1, 1, .25, .25]]
    s, g0 = 4, 2.0
    out = [gpath(rrect_d(g0 + c * 4.67, g0 + r * 4.67, s, s, 1.2), alpha[r][c]) for r in range(4) for c in range(4)]
    glyph(folder, "\n".join(out))


def aurora(folder):
    """The README's aurora behind a frosted pane: a quiet screen with the day running along its foot."""
    blobs = [(260, 230, 520, INDIGO, 0.95), (820, 300, 480, VIOLET, 0.9), (720, 860, 540, TEAL, 0.85),
             (180, 820, 460, "#DB2777", 0.8)]
    defs = "".join(
        f'<radialGradient id="b{i}" cx="{x}" cy="{y}" r="{r}" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{c}" stop-opacity="{a}"/><stop offset="1" stop-color="{c}" stop-opacity="0"/>'
        f'</radialGradient>' for i, (x, y, r, c, a) in enumerate(blobs))
    background = (f'<defs>{defs}</defs><rect width="1024" height="1024" fill="#08090E"/>' +
                  "".join(f'<rect width="1024" height="1024" fill="url(#b{i})"/>' for i in range(len(blobs))))
    segs = segments(272, 752, 620, 40, DAY, 10, 8)
    write_icon(folder, "Aurora", [
        ({"shadow": 0.0, "specular": False}, [("1-aurora", background, False, 1.0)]),
        ({"shadow": 0.5, "translucency": 0.6, "blur": 0.5}, [("2-pane", rrect(212, 262, 600, 452, 72, WHITE), True, 0.35)]),
        ({"shadow": 0.3}, [("3-strip", paths(segs), True, 1.0)]),
    ], {"solid": rgb("#08090E")})
    g = segments(5, 17, 14, 2, [(1, "#000"), (1, "#000"), (1, "#000")], 1, 0.6)
    glyph(folder, gpath(rrect_d(2, 4, 18, 14, 3.5) + " " + rrect_d(3.5, 5.5, 15, 11, 2)
                        ).replace("/>", ' fill-rule="evenodd"/>') + paths(g))


# ---- Round two: familiar objects, gradient fields, the object filling the square ---------------------------------

def gradient(id_, stops, x1, y1, x2, y2):
    s = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return (f'<linearGradient id="{id_}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" gradientUnits="userSpaceOnUse">'
            f'{s}</linearGradient>')


def field(top, bottom):
    return {"linear-gradient": [rgb(top), rgb(bottom)]}


def keep(folder, name="Keep"):
    """A screen you keep: a window holding the day's colours, with a bookmark ribbon over its top edge."""
    screen = rrect(176, 262, 672, 500, 76, WHITE)
    content = (f'<defs>{gradient("c", [(0, "#A78BFA"), (0.45, "#60A5FA"), (1, "#2DD4BF")], 220, 300, 800, 720)}</defs>'
               + rrect(212, 298, 600, 428, 46, "url(#c)"))
    ribbon = ('<path d="M626,214 H738 V452 L682,410 L626,452 Z" fill="#FF3B6B" stroke="#FF3B6B" '
              'stroke-width="18" stroke-linejoin="round"/>')
    write_icon(folder, name, [
        ({"shadow": 0.5}, [("1-screen", screen, True, 1.0)]),
        ({"shadow": 0.2, "specular": False}, [("2-content", content, True, 1.0)]),
        ({"shadow": 0.6}, [("3-ribbon", ribbon, True, 1.0)]),
    ], field("#7B7EF7", "#3F2FB8"))
    evenodd = lambda d: gpath(d).replace("/>", ' fill-rule="evenodd"/>')
    glyph(folder, evenodd(rrect_d(1.5, 4.5, 19, 14, 3) + " " + rrect_d(3, 6, 16, 11, 1.75)) +
          gpath("M12.5,2.5 H17.5 V11 L15,9.2 L12.5,11 Z"))


def stack(folder, name="Stack"):
    """Moments collected: the day's screens stacked, the newest on top with the day strip along its foot."""
    back = f'<g transform="rotate(-9 512 470)">{rrect(222, 260, 580, 410, 64, VIOLET)}</g>'
    mid = f'<g transform="rotate(5 512 500)">{rrect(222, 290, 580, 410, 64, TEAL)}</g>'
    front = rrect(196, 352, 632, 444, 68, WHITE)
    strip_ = paths(segments(256, 768, 700, 46, DAY, 10, 8))
    write_icon(folder, name, [
        ({"shadow": 0.4, "translucency": 0.2}, [("1-back", back, True, 1.0)]),
        ({"shadow": 0.5, "translucency": 0.2}, [("2-middle", mid, True, 1.0)]),
        ({"shadow": 0.6}, [("3-front", front, True, 1.0)]),
        ({"shadow": 0.2, "specular": False}, [("4-strip", strip_, True, 1.0)]),
    ], field("#3B3A8C", "#121230"))
    evenodd = lambda d: gpath(d).replace("/>", ' fill-rule="evenodd"/>')
    glyph(folder, evenodd(rrect_d(2, 8, 18, 12, 3) + " " + rrect_d(3.5, 9.5, 15, 9, 1.75)) +
          gpath(rrect_d(4, 4.75, 14, 1.75, 0.875)) + gpath(rrect_d(6.5, 1.75, 9, 1.75, 0.875)) +
          gpath(rrect_d(5.5, 15.5, 11, 1.5, 0.75)))


def threads(folder, name="Threads"):
    """The day's threads running side by side, each in its colour, the way the timeline lays them out."""
    def wave(cy, phase, amp=62):
        return [(x, cy + amp * math.sin(2 * math.pi * (x - 150) / 724 + phase)) for x in range(150, 875, 6)]
    specs = [(372, 0.0, ("#A78BFA", "#6366F1")), (512, 0.9, ("#2DD4BF", "#38BDF8")), (652, 1.8, ("#F472B6", "#FB923C"))]
    layers = []
    for i, (cy, ph, (a, b)) in enumerate(specs):
        body = (f'<defs>{gradient("g", [(0, a), (1, b)], 150, 0, 874, 0)}</defs>'
                f'<path d="{polyline_d(wave(cy, ph))}" fill="none" stroke="url(#g)" stroke-width="104" '
                f'stroke-linecap="round" stroke-linejoin="round"/>')
        layers.append((f"{i + 1}-thread", body, True, 1.0))
    write_icon(folder, name, [({"shadow": 0.5}, layers)], field("#20254F", "#0A0B1C"))
    out = []
    for cy, ph in [(5.5, 0.0), (11, 0.9), (16.5, 1.8)]:
        out.append(gstroke([(x / 4, cy + 1.6 * math.sin(2 * math.pi * (x / 4 - 3) / 16 + ph)) for x in range(12, 77)], 2))
    glyph(folder, "\n".join(out))


def orb(folder, name="Orb"):
    """A memory held in glass: the day's colours swirling inside a marble."""
    blobs = [(400, 380, 330, "#A78BFA"), (650, 430, 300, "#F472B6"), (430, 690, 320, "#2DD4BF"),
             (690, 700, 220, "#FBBF24")]
    defs = '<clipPath id="o"><circle cx="512" cy="512" r="344"/></clipPath>' + "".join(
        f'<radialGradient id="b{i}" cx="{x}" cy="{y}" r="{r}" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{c}"/><stop offset="1" stop-color="{c}" stop-opacity="0"/></radialGradient>'
        for i, (x, y, r, c) in enumerate(blobs))
    body = (f'<defs>{defs}</defs><g clip-path="url(#o)"><rect width="1024" height="1024" fill="#4F46E5"/>' +
            "".join(f'<rect width="1024" height="1024" fill="url(#b{i})"/>' for i in range(len(blobs))) + "</g>")
    shine = '<ellipse cx="420" cy="330" rx="150" ry="86" transform="rotate(-28 420 330)" fill="#FFFFFF" fill-opacity="0.55"/>'
    write_icon(folder, name, [
        ({"shadow": 0.6}, [("1-orb", body, True, 1.0)]),
        ({"shadow": 0.0, "specular": False}, [("2-shine", shine, False, 1.0)]),
    ], field("#26244A", "#0B0A18"))
    evenodd = lambda d: gpath(d).replace("/>", ' fill-rule="evenodd"/>')
    ring = "M11,2.5 A8.5,8.5 0 1 1 10.99,2.5 Z M11,4 A7,7 0 1 0 11.01,4 Z"
    glyph(folder, evenodd(ring) + '<path d="M6.5,12.5 C7.5,9 11,7.2 14.5,8.2" fill="none" stroke="#000" '
          'stroke-width="1.6" stroke-linecap="round"/>' + '<circle cx="13.2" cy="13.6" r="1.6" fill="#000"/>')


def journal(folder, name="Journal"):
    """The day's journal: a notebook with a coloured tab for each thread you followed."""
    tabs = "\n".join(rrect(680, y, 128, 96, 26, c) for y, c in
                     [(246, VIOLET), (372, "#FBBF24"), (498, PINK), (624, "#38BDF8")])
    book = rrect(232, 168, 520, 688, 64, WHITE)
    spine = rrect(232, 168, 92, 688, (64, 0, 0, 64), "#E4E4EE")
    write_icon(folder, name, [
        ({"shadow": 0.4}, [("1-tabs", tabs, True, 1.0)]),
        ({"shadow": 0.6}, [("2-book", book, True, 1.0), ("3-spine", spine, False, 1.0)]),
    ], field("#2DD4BF", "#0E7490"))
    evenodd = lambda d: gpath(d).replace("/>", ' fill-rule="evenodd"/>')
    glyph(folder, evenodd(rrect_d(3.5, 2, 12, 18, 2.5) + " " + rrect_d(5, 3.5, 9, 15, 1.25)) +
          gpath(rrect_d(6.75, 3.5, 1.5, 15, 0)) +
          "".join(gpath(rrect_d(16.25, y, 3, 3.25, 1)) for y in (4, 9.25, 14.5)))


def dial(folder, name="Dial"):
    """The day on a dial: twenty-four hours round with noon at the top, the waking hours in thread colours."""
    face = f'<circle cx="512" cy="512" r="372" fill="{WHITE}"/>'
    pts = arc_points(512, 512, 290, -75, 150, 240)  # 07:00 to 22:00, noon at the top
    arcs = "\n".join(stroke(run, c, 58) for c, run in
                     split_by_length(pts, [(2.4, VIOLET), (1.2, ORANGE), (2.0, TEAL), (1.0, PINK), (1.8, INDIGO)], 30))
    night = stroke(arc_points(512, 512, 290, 165, 270, 80), "#D9D9E3", 58)
    tip = arc_points(512, 512, 196, 60, 60, 1)[0]  # 16:00
    hand = (f'<path d="M512,512 L{tip[0]:.1f},{tip[1]:.1f}" stroke="#1C1C28" stroke-width="30" stroke-linecap="round"/>'
            f'<circle cx="512" cy="512" r="38" fill="#1C1C28"/>')
    write_icon(folder, name, [
        ({"shadow": 0.6}, [("1-face", face, True, 1.0)]),
        ({"shadow": 0.15, "specular": False}, [("2-night", night, True, 1.0), ("3-day", arcs, True, 1.0)]),
        ({"shadow": 0.4}, [("4-hand", hand, True, 1.0)]),
    ], field("#8B7CF6", "#4C2FB5"))
    day = split_by_length(arc_points(11, 11, 8, -75, 150, 90), [(1, ""), (1, ""), (1, "")], 1.6)
    t = arc_points(11, 11, 4.6, 60, 60, 1)[0]
    glyph(folder, "\n".join(gstroke(r, 2.4) for _, r in day) + gstroke(arc_points(11, 11, 8, 160, 275, 40), 1.2, 0.5) +
          gstroke([(11, 11), t], 1.8) + '<circle cx="11" cy="11" r="1.6" fill="#000"/>')


def strip2(folder, name="Strip2"):
    """Strip, made calmer: one solid bar of the day's colours on an indigo field, a white knob on the moment."""
    segs = segments(120, 904, 444, 136, DAY, 12, 10, cut=(612, 40))
    knob = (f'<rect x="586" y="330" width="52" height="364" rx="26" fill="{WHITE}"/>')
    write_icon(folder, name, [
        ({"shadow": 0.35, "specular": False}, [("1-strip", paths(segs), True, 1.0)]),
        ({"shadow": 0.6}, [("2-knob", knob, True, 1.0)]),
    ], field("#4F4BD8", "#1C1A5E"))
    g = segments(1, 21, 8.5, 5, [(1, "#000"), (1, "#000"), (1, "#000"), (1, "#000")], 1, 0.6, cut=(13.5, 2.25))
    glyph(folder, paths(g) + gpath(rrect_d(12.5, 3.5, 2, 15, 1)))


def keep_variant(folder, name, fill, ribbon="#FF3B6B", content=("#A78BFA", "#60A5FA", "#2DD4BF")):
    screen = rrect(160, 262, 704, 516, 80, WHITE)
    content_ = (f'<defs>{gradient("c", [(0, content[0]), (0.5, content[1]), (1, content[2])], 200, 300, 820, 740)}</defs>'
                + rrect(198, 300, 628, 440, 48, "url(#c)"))
    rib = (f'<path d="M618,196 H746 V478 L682,428 L618,478 Z" fill="{ribbon}" stroke="{ribbon}" '
           'stroke-width="20" stroke-linejoin="round"/>')
    write_icon(folder, name, [
        ({"shadow": 0.5}, [("1-screen", screen, True, 1.0)]),
        ({"shadow": 0.2, "specular": False}, [("2-content", content_, True, 1.0)]),
        ({"shadow": 0.6}, [("3-ribbon", rib, True, 1.0)]),
    ], fill)
    evenodd = lambda d: gpath(d).replace("/>", ' fill-rule="evenodd"/>')
    glyph(folder, evenodd(rrect_d(1.5, 4.5, 19, 14, 3) + " " + rrect_d(3, 6, 16, 11, 1.75)) +
          gpath("M12,2 H17.5 V12 L14.75,10 L12,12 Z"))


def keep_b(folder):
    """Keep, bolder: a bigger window and ribbon on the indigo field."""
    keep_variant(folder, "KeepB", field("#7B7EF7", "#3F2FB8"))


def keep_ink(folder):
    """Keep on the app's own ink, with a coral ribbon."""
    keep_variant(folder, "KeepInk", ink(), ribbon="#FF5A5F")


def threads_cross(folder, name="ThreadsCross"):
    """Threads that cross: three ribbons weaving through one another, as threads do over a day."""
    def wave(cy, phase, amp):
        return [(x, cy + amp * math.sin(2 * math.pi * (x - 170) / 684 + phase)) for x in range(170, 855, 6)]
    specs = [(512, 0.0, ("#A78BFA", "#6366F1")), (512, 2.1, ("#2DD4BF", "#38BDF8")), (512, 4.2, ("#F472B6", "#FB923C"))]
    layers = []
    for i, (cy, ph, (a, b)) in enumerate(specs):
        body = (f'<defs>{gradient("g", [(0, a), (1, b)], 170, 0, 854, 0)}</defs>'
                f'<path d="{polyline_d(wave(cy, ph, 170))}" fill="none" stroke="url(#g)" stroke-width="96" '
                f'stroke-linecap="round" stroke-linejoin="round"/>')
        layers.append((f"{i + 1}-thread", body, True, 1.0))
    write_icon(folder, name, [({"shadow": 0.5, "translucency": 0.35}, layers)], field("#20254F", "#0A0B1C"))
    out = []
    for ph in (0.0, 2.1, 4.2):
        out.append(gstroke([(x / 4, 11 + 6 * math.sin(2 * math.pi * (x / 4 - 3) / 16 + ph)) for x in range(12, 77)], 1.75))
    glyph(folder, "\n".join(out))


def window(folder, name="Window"):
    """The popup as an object: a white window holding the day strip, the playhead on a moment."""
    screen = rrect(150, 282, 724, 460, 84, WHITE)
    segs = segments(222, 802, 466, 92, DAY, 12, 12, cut=(590, 30))
    head = rrect(570, 398, 40, 228, 20, "#1C1C28")
    write_icon(folder, name, [
        ({"shadow": 0.55}, [("1-window", screen, True, 1.0)]),
        ({"shadow": 0.15, "specular": False}, [("2-strip", paths(segs), True, 1.0)]),
        ({"shadow": 0.3}, [("3-playhead", head, True, 1.0)]),
    ], field("#7B7EF7", "#3F2FB8"))
    evenodd = lambda d: gpath(d).replace("/>", ' fill-rule="evenodd"/>')
    g = segments(4.5, 17.5, 9.5, 3, [(1, "#000"), (1, "#000"), (1, "#000")], 0.8, 0.5, cut=(12.5, 1.5))
    glyph(folder, evenodd(rrect_d(1.5, 4.5, 19, 13, 3) + " " + rrect_d(3, 6, 16, 10, 1.75)) + paths(g) +
          gpath(rrect_d(11.75, 7.5, 1.5, 7, 0.75)))


ROUND_TWO = [keep, stack, threads, orb, journal, dial, strip2, keep_b, keep_ink, threads_cross, window]


# ---- Strip variants: the day strip ten ways, all on the original ink field ---------------------------------------

STRIP_DAY = [(3, VIOLET), (1.6, ORANGE), (2.6, TEAL), (1.2, PINK), (2.2, INDIGO)]


def white_bar(x, y0, y1, w=40):
    return rrect(x - w / 2, y0, w, y1 - y0, w / 2, WHITE)


def g_strip(y=8, h=6, gap=1, inner=1, cut=None, x0=2, x1=20, parts=3):
    return paths(segments(x0, x1, y, h, [(1, "#000")] * parts, gap, inner, cut=cut))


def sv_bar(folder):
    """One continuous bar: the pieces butt together with hairline seams, and a rounded white playhead."""
    segs = segments(120, 904, 432, 160, STRIP_DAY, 8, 0, cut=(612, 34))
    write_icon(folder, "Bar", [({"shadow": 0.4}, [("1-strip", paths(segs), True, 1.0)]),
                               ({"shadow": 0.6}, [("2-playhead", white_bar(612, 330, 694, 44), True, 1.0)])], ink())
    glyph(folder, g_strip(gap=0.75, inner=0, cut=(13.5, 1.75)) + gpath(rrect_d(12.5, 4, 2, 14, 1)))


def sv_gradient(folder):
    """The day as one smooth band of colour, the moment a white bead on it."""
    body = (f'<defs>{gradient("g", [(0, VIOLET), (0.3, PINK), (0.55, ORANGE), (0.8, TEAL), (1, SKY)], 120, 0, 904, 0)}</defs>'
            + rrect(120, 437, 784, 150, 75, "url(#g)"))
    bead = f'<circle cx="618" cy="512" r="112" fill="{WHITE}"/>'
    write_icon(folder, "Gradient", [({"shadow": 0.4}, [("1-strip", body, True, 1.0)]),
                                    ({"shadow": 0.7}, [("2-bead", bead, True, 1.0)])], ink())
    glyph(folder, gpath(rrect_d(1.5, 9, 19, 4, 2), 0.6) + '<circle cx="13.5" cy="11" r="4.25" fill="#000"/>')


def sv_tall(folder):
    """A tall strip, the playhead a white slot cut through its full height."""
    segs = segments(120, 904, 382, 260, STRIP_DAY, 16, 26, cut=(612, 40))
    write_icon(folder, "Tall", [({"shadow": 0.4}, [("1-strip", paths(segs), True, 1.0)]),
                                ({"shadow": 0.5}, [("2-playhead", white_bar(612, 382, 642, 40), True, 1.0)])], ink())
    glyph(folder, g_strip(y=6, h=10, gap=1.2, inner=1.4, cut=(13.5, 2)) + gpath(rrect_d(12.75, 6, 1.5, 10, 0.75)))


def sv_lanes(folder):
    """Strips in parallel: a lane per thread, each where it was active, and the playhead across them all."""
    lanes = [(352, [(120, 330), (380, 560), (700, 904)], VIOLET), (512, [(200, 470), (520, 760)], TEAL),
             (672, [(120, 250), (300, 520), (640, 840)], PINK)]
    body = "\n".join(rrect(a, y - 52, b - a, 104, 52, c) for y, spans, c in lanes for a, b in spans)
    write_icon(folder, "Lanes", [({"shadow": 0.4}, [("1-lanes", body, True, 1.0)]),
                                 ({"shadow": 0.6}, [("2-playhead", white_bar(612, 250, 774, 40), True, 1.0)])], ink())
    lane_g = [(5.5, [(2, 7), (8.5, 11)]), (11, [(4, 11)]), (16.5, [(2, 5), (6.5, 11)])]
    right = [(5.5, [(15, 20)]), (11, [(15, 18)]), (16.5, [(15, 19)])]
    out = [gpath(rrect_d(a, y - 1.25, b - a, 2.5, 1.25)) for y, s in lane_g + right for a, b in s]
    glyph(folder, "".join(out) + gpath(rrect_d(12.5, 2.5, 1.5, 17, 0.75)))


def sv_barcode(folder):
    """The strip as the app draws it: many thin stretches of thread colour, the day's rhythm at a glance."""
    import random
    rnd = random.Random(7)
    cols = [VIOLET, VIOLET, ORANGE, TEAL, TEAL, PINK, INDIGO]
    x, bars, colour = 120, [], VIOLET
    while x < 904:
        if rnd.random() < 0.35:
            colour = rnd.choice(cols)
        w = rnd.choice([14, 22, 30, 44])
        bars.append(f'<rect x="{x}" y="412" width="{min(w, 904 - x)}" height="200" fill="{colour}"/>')
        x += w + 7
    body = (f'<defs><clipPath id="k"><path d="{rrect_d(120, 412, 784, 200, 40)}"/></clipPath></defs>'
            f'<g clip-path="url(#k)">{"".join(bars)}</g>')
    write_icon(folder, "Barcode", [({"shadow": 0.4, "specular": False}, [("1-strip", body, True, 1.0)]),
                                   ({"shadow": 0.6}, [("2-playhead", white_bar(612, 316, 708, 36), True, 1.0)])], ink())
    gx, out, rg = 2.0, [], random.Random(3)
    while gx < 20:
        w = rg.choice([1, 1, 2])
        if not (11.25 < gx + w and gx < 15.25):
            out.append(gpath(rrect_d(gx, 8, min(w, 20 - gx), 6, 0.3), rg.choice([1, 1, 0.55])))
        gx += w + 0.8
    glyph(folder, "".join(out) + gpath(rrect_d(12.5, 4, 2, 14, 1)))


def sv_track(folder):
    """The strip set in a dark glass track, the way the popup frames it."""
    track = rrect(96, 404, 832, 216, 108, "#3A3B4C")
    segs = segments(140, 884, 446, 132, STRIP_DAY, 10, 14, cut=(612, 30))
    write_icon(folder, "Track", [({"shadow": 0.5, "translucency": 0.3}, [("1-track", track, True, 1.0)]),
                                 ({"shadow": 0.2, "specular": False}, [("2-strip", paths(segs), True, 1.0)]),
                                 ({"shadow": 0.5}, [("3-playhead", white_bar(612, 404, 620, 30), True, 1.0)])], ink())
    evenodd = lambda d: gpath(d).replace("/>", ' fill-rule="evenodd"/>')
    glyph(folder, evenodd(rrect_d(1, 6, 20, 10, 5) + " " + rrect_d(2.5, 7.5, 17, 7, 3.5)) +
          g_strip(x0=4, x1=18, y=9.25, h=3.5, gap=0.8, inner=0.6, cut=(13, 1.5)) + gpath(rrect_d(12.25, 6, 1.5, 10, 0.75)))


def sv_bead(folder):
    """The strip with a white bead resting on the moment."""
    segs = segments(120, 904, 432, 160, STRIP_DAY, 16, 24)
    bead = f'<circle cx="612" cy="512" r="120" fill="{WHITE}"/>'
    write_icon(folder, "Bead", [({"shadow": 0.4}, [("1-strip", paths(segs), True, 1.0)]),
                                ({"shadow": 0.7}, [("2-bead", bead, True, 1.0)])], ink())
    glyph(folder, g_strip(cut=(13.5, 5.25)) + '<circle cx="13.5" cy="11" r="4.25" fill="#000"/>')


def sv_rise(folder):
    """The strip rising: the same day set on a diagonal, so the icon moves."""
    segs = segments(110, 914, 437, 150, STRIP_DAY, 18, 26, cut=(612, 40))
    rot = lambda b: f'<g transform="rotate(-24 512 512)">{b}</g>'
    write_icon(folder, "Rise", [({"shadow": 0.45}, [("1-strip", rot(paths(segs)), True, 1.0)]),
                                ({"shadow": 0.6}, [("2-playhead", rot(white_bar(612, 318, 706, 44)), True, 1.0)])], ink())
    glyph(folder, f'<g transform="rotate(-24 11 11)">{g_strip(cut=(13.5, 2))}{gpath(rrect_d(12.5, 3.5, 2, 15, 1))}</g>')


def sv_tiles(folder):
    """The strip as a row of tiles, a stretch each, with the moment you look at lit white."""
    cols = [VIOLET, ORANGE, TEAL, WHITE, PINK, INDIGO]
    size, gap = 124, 18
    x0 = 512 - (6 * size + 5 * gap) / 2
    tiles = [rrect(x0 + i * (size + gap), 450, size, size, 34, c) for i, c in enumerate(cols) if c != WHITE]
    lit = rrect(x0 + 3 * (size + gap) - 10, 400, size + 20, size + 20, 38, WHITE)
    write_icon(folder, "Tiles", [({"shadow": 0.4}, [("1-tiles", "\n".join(tiles), True, 1.0)]),
                                 ({"shadow": 0.7}, [("2-lit", lit, True, 1.0)])], ink())
    out = [gpath(rrect_d(1.5 + i * 3.25, 9.5, 2.75, 3, 0.8), 1 if i == 3 else 0.55) for i in range(6)]
    glyph(folder, "".join(out))


def sv_caret(folder):
    """The strip with a marker over the moment, the way a timeline marks where you are."""
    segs = segments(120, 904, 470, 150, STRIP_DAY, 16, 24)
    caret = (f'<path d="M552,330 H672 L612,420 Z" fill="{WHITE}" stroke="{WHITE}" stroke-width="28" '
             'stroke-linejoin="round"/>')
    write_icon(folder, "Caret", [({"shadow": 0.4}, [("1-strip", paths(segs), True, 1.0)]),
                                 ({"shadow": 0.6}, [("2-caret", caret, True, 1.0)])], ink())
    glyph(folder, g_strip(y=11, h=6, gap=1) + '<path d="M10.5,4.5 H16.5 L13.5,9 Z" fill="#000" stroke="#000" '
          'stroke-width="1" stroke-linejoin="round"/>')


def sv_now(folder):
    """The Strip that ships now, for comparison."""
    strip(folder, "Now")


STRIP_VARIANTS = [sv_now, sv_bar, sv_gradient, sv_tall, sv_lanes, sv_barcode, sv_track, sv_bead, sv_rise, sv_tiles,
                  sv_caret]


DIRECTIONS = [strip, moment, lens, lift, week, columns, ring, coil, braid, tiles, knot, aurora]

if __name__ == "__main__":
    out = sys.argv[1]
    only = set(sys.argv[2:])
    if "--ship" in only:  # the shipped icon, Strip (or lens-t, the runner-up): directions.py Resources --ship [lens-t]
        if "lens-t" in only:
            key, title, note, options = next(v for v in LENS_VARIANTS if v[0] == "lens-t")
            lens_variant(out, "AppIcon", note, **options)
            os.remove(os.path.join(out, "meta.json"))
        else:
            strip(out, "AppIcon")
        os.remove(os.path.join(out, "glyph.svg"))  # the menu bar glyph ships as code: MenuBarGlyph.swift
        print(os.path.join(out, "AppIcon.icon"))
        sys.exit(0)
    if "--strips" in only:
        for make in STRIP_VARIANTS:
            folder = os.path.join(out, make.__name__[3:])
            os.makedirs(folder, exist_ok=True)
            make(folder)
            with open(os.path.join(folder, "meta.json"), "w") as f:
                json.dump({"name": make.__name__[3:].capitalize(), "note": " ".join(make.__doc__.split())}, f)
        sys.exit(0)
    if "--round2" in only:
        for make in ROUND_TWO:
            folder = os.path.join(out, make.__name__)
            os.makedirs(folder, exist_ok=True)
            make(folder)
            with open(os.path.join(folder, "meta.json"), "w") as f:
                json.dump({"name": {"strip2": "Strip II", "keep_b": "Keep B", "keep_ink": "Keep Ink", "threads_cross": "Threads Cross"}.get(make.__name__, make.__name__.capitalize()), "note": " ".join(make.__doc__.split())}, f)
        sys.exit(0)
    if "--lens" in only:
        for key, title, note, options in LENS_VARIANTS:
            folder = os.path.join(out, key)
            os.makedirs(folder, exist_ok=True)
            lens_variant(folder, title, note, **options)
            print(folder)
        for key, title, note, options in LANES:
            folder = os.path.join(out, key)
            os.makedirs(folder, exist_ok=True)
            lanes_variant(folder, title, note, **options)
            print(folder)
        sys.exit(0)
    for make in DIRECTIONS:
        if only and make.__name__ not in only:
            continue
        folder = os.path.join(out, make.__name__)
        os.makedirs(folder, exist_ok=True)
        make(folder)
        with open(os.path.join(folder, "meta.json"), "w") as f:
            json.dump({"name": make.__name__.capitalize(), "note": " ".join(make.__doc__.split())}, f)
        print(folder)
