#!/usr/bin/env python3 -I
"""Lines the logger's input and focus timeline up with Screencap's real captures, measures what the current capture
scheme misses, simulates other trigger policies on the same timeline and prices each one.

    python3 -I analyze.py --timeline timeline.jsonl --salt salt.txt --store store-copy.sqlite --out results.json

The store must be a copy (sqlite3 "VACUUM INTO"), never the live file. Output holds counts, durations and app
categories only: titles and URLs stay hashed, and capture rows are hashed with the logger's salt before comparing.
"""

import argparse
import bisect
import hashlib
import json
import math
import re
import sqlite3
import statistics
from collections import Counter, defaultdict

import numpy as np

CHROMIUM = {
    "com.google.Chrome", "com.google.Chrome.canary", "com.brave.Browser", "com.microsoft.edgemac",
    "company.thebrowser.Browser", "company.thebrowser.dia", "com.vivaldi.Vivaldi", "com.operasoftware.Opera",
}
BROWSERS = CHROMIUM | {"com.apple.Safari", "com.apple.SafariTechnologyPreview"}
CATEGORIES = {
    "browser": BROWSERS,
    "AI assistant": {"com.anthropic.claudefordesktop", "com.openai.codex", "com.openai.chat"},
    "code and terminal": {
        "com.apple.Terminal", "com.googlecode.iterm2", "dev.warp.Warp-Stable", "com.mitchellh.ghostty",
        "com.microsoft.VSCode", "com.todesktop.230313mzl4w4u92", "com.apple.dt.Xcode", "dev.zed.Zed",
    },
    "chat and mail": {
        "com.tinyspeck.slackmacgap", "ru.keepcoder.Telegram", "net.whatsapp.WhatsApp", "com.hnc.Discord",
        "com.superhuman.electron", "com.apple.mail", "com.apple.MobileSMS",
    },
    "notes and docs": {"notion.id", "com.pdfeditor.pdfeditormac", "com.apple.Notes", "com.apple.Preview"},
    "media": {"com.spotify.client", "com.apple.Music"},
}
IDLE_AFTER = 300  # CaptureGate.idleAfter

# Money from the app's decision log over the logger's window (current pipeline, with the join question); CPU from
# the measured hour of the final build in IMPLEMENTATION.md (18:17-19:17, headless: 93 captures, 91 kept, 90 OCR'd,
# app 0.29% and OCR helper 0.72% of a core); per-step costs from plan/03-capture.md and research/platform.md.
COST = {
    "boundary_usd": 0.0000547,          # mean boundary question in the window, two 1024 px screenshots
    "activity_usd": 0.0004105,          # caption, thread, card, category, provisional and join calls per activity
    "activities_per_hour": 14.7,        # activities the app closed per active hour in the window
    "ocr_s_per_frame": 0.72 / 100 * 3600 / 90,  # OCR helper CPU per OCR'd frame, helper starts included
    "ocr_launch_s": 0.0,                # included in ocr_s_per_frame; the helper stays warm between frames
    "helper_idle_exit_s": 180,
    "app_cpu_pct": 0.29,                # app in the measured hour: 93 captures, 91 kept, about 91 questions
    "jpeg_s": 0.0235,                   # model JPEG from the HEIC frame, cached, built once per anchor
    "capture_s": 0.0005 + 0.007,        # SCK captureImage: app CPU plus replayd CPU, per capture
    "keep_s": 0.0088 + 0.002,           # HEIC encode plus thumbnail and insert, per kept frame
    "frame_kb": 134,                    # HEIC q0.6 at 1x, per kept frame
    "r2_usd_per_gb_month": 0.015,
    "budget_pct": 1.0,
    "hours_per_day": 8,
    "days_per_month": 26,
}


def category(bundle):
    for name, ids in CATEGORIES.items():
        if bundle in ids:
            return name
    if bundle.startswith("com.apple."):
        return "system"
    return "other"


def salted(salt, text):
    if not text:
        return ""
    return hashlib.sha256((salt + text).encode()).digest()[:8].hex()


def stable_title(title):
    return re.sub(r"^\(\d+\)\s*", "", title) if title else title


class Timeline:
    """Per-second input counts and the focus-state sequence, indexed from second T0."""

    def __init__(self, path, until=None):
        ticks, self.focus, self.marks = [], [], []
        for line in open(path):
            o = json.loads(line)
            if until is not None and o["t"] > until:
                break
            ev = o.get("ev")
            if ev is None:
                ticks.append(o)
            elif ev == "focus":
                self.focus.append(o)
            elif ev not in ("start", "end", "activate"):
                self.marks.append((o["t"], ev))
        self.t0 = math.floor(ticks[0]["t"]) - 1
        self.n = int(math.ceil(ticks[-1]["t"] - self.t0)) + 1
        n = self.n
        self.present = np.zeros(n, bool)
        self.idle = np.full(n, 1e9)
        self.secure = np.zeros(n, bool)
        for name in ("k", "c", "s", "m", "d", "ax", "mod"):
            setattr(self, name, np.zeros(n, int))
        for o in ticks:
            i = int(round(o["t"] - self.t0)) - 1
            if not 0 <= i < n:
                continue
            self.present[i] = True
            self.idle[i] = o["idle"]
            self.secure[i] = o.get("secure", False)
            for name in ("k", "c", "s", "m", "d", "ax", "mod"):
                getattr(self, name)[i] = max(0, o.get(name, 0))
        self.locked = np.zeros(n, bool)
        down = {"locked": "unlocked", "screensSleep": "screensWake", "sleep": "wake", "sessionResign": "sessionActive"}
        for start_kind, end_kind in down.items():
            begin = None
            for t, kind in self.marks:
                if kind == start_kind and begin is None:
                    begin = t
                elif kind == end_kind and begin is not None:
                    self.locked[self.index(begin):self.index(t) + 1] = True
                    begin = None
            if begin is not None:
                self.locked[self.index(begin):] = True
        self.active = self.present & (self.idle < IDLE_AFTER) & ~self.locked & ~self.secure
        self.wakes = [t for t, kind in self.marks if kind in ("unlocked", "screensWake", "wake", "sessionActive")]
        self.end = self.t0 + n
        self.views = self.view_states()

    def index(self, t):
        return min(self.n - 1, max(0, int(t - self.t0)))

    def is_active(self, t):
        return bool(self.active[self.index(t)])

    def active_seconds(self, a, b):
        i, j = self.index(a), self.index(b)
        return int(self.active[i:j].sum()) if j > i else 0

    def view_states(self, transient=1.0):
        """(start, end, view) with view = (app, stable title hash, host hash, path hash), the app's context key.
        A state shorter than `transient` (an activation read before the new window's title arrived, a title flicker)
        is folded into the one that follows it."""
        raw = []
        prev = None
        for o in self.focus:
            app, th, hh, ph = o["app"], o["th"], o["hh"], o["ph"]
            # A loading page has no URL yet; ContextMonitor treats it as the same site.
            if app in BROWSERS and not hh and prev and prev[0] == app:
                hh, ph = prev[2], prev[3]
            view = (app, th, hh, ph)
            raw.append((o["t"], view))
            prev = view
        states = []
        carried = None  # start of transients folded into the next state
        for k, (t, view) in enumerate(raw):
            end = raw[k + 1][0] if k + 1 < len(raw) else self.end
            if end - t < transient and k + 1 < len(raw):
                carried = t if carried is None else carried
                continue
            start = carried if carried is not None else t
            carried = None
            if states and states[-1][2] == view:
                continue
            states.append([start, None, view])
        for k in range(len(states)):
            states[k][1] = states[k + 1][0] if k + 1 < len(states) else self.end
        return [tuple(s) for s in states]

    def level_states(self, level):
        """Merge view states into coarser levels: app, place (app + site, the switch-capture key), page, view."""
        def key(view):
            app, th, hh, ph = view
            if level == "app":
                return (app,)
            if level == "place":
                return (app, hh)
            if level == "page":
                return (app, hh, ph) if app in BROWSERS else (app, th)
            return view
        out = []
        for start, end, view in self.views:
            k = key(view)
            if out and out[-1][2] == k:
                out[-1][1] = end
            else:
                out.append([start, end, k, view[0]])
        return [tuple(s) for s in out]

    def view_at(self, t):
        starts = [s[0] for s in self.views]
        k = bisect.bisect_right(starts, t) - 1
        return self.views[k][2] if k >= 0 else None


def load_captures(store, salt, t0, t1):
    db = sqlite3.connect(store)
    rows = db.execute(
        "select at, trigger, duplicateOf is not null, bundleID, windowTitle, urlHost, urlPath from capture "
        "where isFocusedDisplay = 1 and at >= ? and at <= ? order by at", (t0, t1)).fetchall()
    captures = []
    for at, trigger, dup, bundle, title, host, path in rows:
        view = (bundle or "", salted(salt, stable_title(title)), salted(salt, host), salted(salt, path))
        captures.append({"at": at, "trigger": trigger, "dup": bool(dup), "view": view})
    markers = db.execute("select at, kind from marker where at >= ? and at <= ? order by at", (t0, t1)).fetchall()
    return captures, markers


# ---------------------------------------------------------------- moments the screen likely changed


def runs(values, gap):
    """Maximal runs of seconds with values > 0, joining runs separated by fewer than `gap` empty seconds.
    Returns (first index, last index, total)."""
    out = []
    nz = np.flatnonzero(values > 0)
    for i in nz:
        if out and i - out[-1][1] <= gap:
            out[-1][1] = i
            out[-1][2] += int(values[i])
        else:
            out.append([int(i), int(i), int(values[i])])
    return [tuple(r) for r in out]


def moments(tl):
    """The screen states a person likely looked at, from input alone."""
    t0 = tl.t0
    view_starts = np.array([s[0] for s in tl.views])
    changes_input = (tl.k > 0) | (tl.c > 0) | (tl.s > 0)

    def next_change(i_from, t_from):
        """Time of the next key, click, scroll or view change after second index i_from."""
        later = np.flatnonzero(changes_input[i_from:])
        t_input = t0 + i_from + later[0] if len(later) else tl.end
        k = bisect.bisect_right(view_starts, t_from)
        t_view = view_starts[k] if k < len(view_starts) else tl.end
        return min(t_input, t_view)

    out = {"typing": [], "click": [], "scroll": []}
    for a, b, keys in runs(tl.k, 2):
        end = t0 + b + 1
        k = bisect.bisect_right(view_starts, end - 1)
        view_end = view_starts[k] if k < len(view_starts) else tl.end
        out["typing"].append({"start": t0 + a, "end": end, "keys": keys, "view_end": view_end,
                              "active": tl.is_active(end - 1)})
    for i in np.flatnonzero(tl.c > 0):
        t = t0 + i + 1
        settle = next_change(i + 1, t) - t
        out["click"].append({"t": t, "settle": settle, "active": tl.is_active(t - 1)})
    for a, b, events in runs(tl.s, 1):
        t = t0 + b + 1
        pause = next_change(b + 1, t) - t
        out["scroll"].append({"start": t0 + a, "t": t, "events": events, "pause": pause, "active": tl.is_active(t - 1)})
    # Screen epochs: intervals between consecutive likely changes of what is on screen.
    points = set(float(s[0]) for s in tl.views)
    points |= {float(m["t"]) for m in out["click"]}
    points |= {float(m["t"]) for m in out["scroll"]}
    points |= {float(m["end"]) for m in out["typing"] if m["keys"] >= 2}
    points = sorted(p for p in points if tl.t0 <= p < tl.end)
    epochs = []
    for p, q in zip(points, points[1:] + [tl.end]):
        epochs.append({"start": p, "end": q, "dur": q - p, "active": tl.active_seconds(p, q) >= 0.8 * (q - p)})
    out["epochs"] = epochs
    return out


# ---------------------------------------------------------------- capture policies


class Policy:
    """A capture schedule. Every policy keeps the idle, lock and secure-input gate and dedupe of the app.

    timer: ("fixed", period, skip) is the app's repeating timer whose tick is skipped within `skip` s of a capture;
           ("gap", seconds) captures whenever this long has passed since the last capture;
           ("adaptive", busy, calm, window) uses `busy` s while keys, clicks or scrolls happened in the last `window` s.
    switch: (level, settle, spacing) is the app's switch capture: a change of `level` schedules a capture at
            max(change + settle, last capture + spacing); a newer change replaces it.
    events: triggers from input, each ("typing", min_keys, pause), ("click", settle), ("scroll", min_events, quiet)
            or ("view", hold).
    spacing: least seconds between an event capture and the capture before it; a trigger inside it waits.
    bucket: (capacity, per_minute) token bucket over event captures.
    anchors: which triggers would get a boundary question if event frames were evidence only.
    """

    def __init__(self, name, timer, switch=None, events=(), spacing=10, bucket=None, note="", served_check=False):
        self.name, self.timer, self.switch, self.events = name, timer, switch, list(events)
        self.spacing, self.bucket, self.note = spacing, bucket, note
        self.served_check = served_check


def event_triggers(tl, spec, mom):
    t0 = tl.t0
    kind = spec[0]
    out = []
    if kind == "settle":
        # The screen changed (view change, click, scroll end, typing end) and then stayed put for `dwell` s.
        _, dwell = spec
        for e in mom["epochs"]:
            if e["dur"] >= dwell:
                out.append(e["start"] + dwell)
    elif kind == "settle_any":
        # As `DwellScheduler` builds it: any key press, click, scroll or view change restarts the quiet clock.
        _, dwell = spec
        active = sorted(set((t0 + np.flatnonzero((tl.k > 0) | (tl.c > 0) | (tl.s > 0)) + 1).tolist())
                        | {float(v[0]) for v in tl.views})
        for a, b in zip(active, active[1:] + [tl.end]):
            if b - a >= dwell:
                out.append((a + dwell, a))
        return out
    elif kind == "typing":
        _, min_keys, pause = spec
        for a, b, keys in runs(tl.k, pause - 1):
            if keys >= min_keys:
                out.append(t0 + b + 1 + pause - 1)
    elif kind == "click":
        _, settle = spec
        quiet = (tl.k > 0) | (tl.c > 0) | (tl.s > 0)
        for i in np.flatnonzero(tl.c > 0):
            window = quiet[i + 1:i + 1 + int(settle)]
            if not window.any():
                out.append(t0 + i + 1 + settle)
    elif kind == "scroll":
        _, min_events, quiet = spec
        for a, b, events in runs(tl.s, quiet - 1):
            if events >= min_events:
                out.append(t0 + b + 1 + quiet - 1)
    elif kind == "view":
        _, hold = spec
        for start, end, _view in tl.views:
            if end - start >= hold:
                out.append(start + hold)
    elif kind == "place":
        # A new app or site that has held `hold` s, whatever its pages did meanwhile.
        _, hold = spec
        for start, end, _key, _app in tl.level_states("place")[1:]:
            if end - start >= hold:
                out.append(start + hold)
    return [(t, t - change_lag(spec)) for t in out]


def change_lag(spec):
    """Seconds from the change a trigger answers to the trigger itself."""
    kind = spec[0]
    if kind in ("settle", "view", "place"):
        return spec[1]
    if kind == "typing":
        return spec[2]
    if kind == "click":
        return spec[1]
    if kind == "scroll":
        return spec[2]
    return 0


def simulate(tl, policy, mom, timer_phase=0.0, step=0.25, launches=()):
    """Runs the policy over the timeline and returns captures as (time, trigger). `launches` replays app restarts
    for the fixed timer: each restarts the timer and captures at once, as CaptureEngine.start does."""
    t0, end = tl.t0, tl.end
    triggers = []
    if policy.switch:
        level, settle, sw_spacing = policy.switch
        states = tl.level_states(level)
        for start, _end, _key, _app in states[1:]:
            triggers.append((start, "switch"))
    for t in tl.wakes:
        triggers.append((t, "wake"))
    changes = {}
    for spec in policy.events:
        kind = "settle" if spec[0] == "settle_any" else spec[0]
        for t, change in event_triggers(tl, spec, mom):
            triggers.append((t, kind))
            changes[(t, kind)] = change
    if policy.timer[0] == "fixed":
        _, period, _skip = policy.timer
        starts = [t0 + timer_phase] + [t for t in launches if t0 < t < end]
        for a, b in zip(starts, starts[1:] + [end]):
            if a in launches:
                triggers.append((a, "launch"))
            t = a + (period if a in launches else 0)
            while t < b:
                triggers.append((t, "timer"))
                t += period
    triggers.sort()
    caps = []
    last = -1e18
    pending_switch = None
    pending_event = None  # (fire time, trigger kind, trigger time)
    tokens = policy.bucket[0] if policy.bucket else None
    k = 0
    t = t0
    recent_input = (tl.k > 0) | (tl.c > 0) | (tl.s > 0)

    def fire(now, kind):
        nonlocal last, tokens, pending_event
        if not tl.is_active(now):
            return False
        caps.append((now, kind))
        last = now
        if tokens is not None and kind not in ("timer", "switch", "wake"):
            tokens -= 1
        if pending_event and pending_event[2] <= now:
            pending_event = None
        return True

    while t < end:
        if tokens is not None:
            tokens = min(policy.bucket[0], tokens + policy.bucket[1] / 60 * step)
        while k < len(triggers) and triggers[k][0] <= t:
            when, kind = triggers[k]
            k += 1
            if kind == "timer":
                if when - last >= policy.timer[2]:
                    fire(when, "timer")
            elif kind in ("wake", "launch"):
                fire(when, "timer" if kind == "launch" else "wake")
            elif kind == "switch":
                pending_switch = max(when + policy.switch[1], last + policy.switch[2])
            else:
                # As built, a trigger answers a change; a capture taken since that change already shows it.
                if policy.served_check and last >= changes.get((when, kind), when):
                    continue
                # One capture serves every trigger that arrives while it waits, and it shows the latest of them.
                earliest = max(when, last + policy.spacing)
                pending_event = (max(earliest, pending_event[0]) if pending_event else earliest, kind, when)
        if pending_switch is not None and t >= pending_switch:
            fire(t, "switch")
            pending_switch = None
        if pending_event is not None and t >= pending_event[0]:
            if t - last < policy.spacing:
                pending_event = (last + policy.spacing, pending_event[1], pending_event[2])
            elif tokens is not None and tokens < 1:
                pending_event = (t + (1 - tokens) * 60 / policy.bucket[1], pending_event[1], pending_event[2])
            else:
                kind = pending_event[1]
                pending_event = None
                fire(t, kind)
        if policy.timer[0] == "gap" and t - last >= policy.timer[1]:
            fire(t, "timer")
        elif policy.timer[0] == "adaptive":
            _, busy, calm, window = policy.timer
            i = tl.index(t)
            interval = busy if recent_input[max(0, i - window):i + 1].any() else calm
            if t - last >= interval:
                fire(t, "adaptive")
        t += step
    return caps


# ---------------------------------------------------------------- dedupe and coverage


def input_between(tl, a, b):
    i, j = tl.index(a), tl.index(b)
    if j <= i:
        return False
    return bool(((tl.k[i:j] > 0) | (tl.c[i:j] > 0) | (tl.s[i:j] > 0) | (tl.d[i:j] > 0)).any())


def view_changed_between(tl, a, b):
    starts = [s[0] for s in tl.views]
    return bisect.bisect_right(starts, b) - bisect.bisect_right(starts, a) > 0


def dedupe_buckets(tl, times):
    """For each capture after the first: 'view' when the view changed since the previous capture, 'input' when
    only keys, clicks, scrolls or drags happened, 'still' when nothing did."""
    out = []
    for prev, cur in zip(times, times[1:]):
        if cur - prev > IDLE_AFTER or view_changed_between(tl, prev, cur):
            out.append("view")
        elif input_between(tl, prev, cur):
            out.append("input")
        else:
            out.append("still")
    return ["view"] + out


def calibrate(tl, real):
    times = [c["at"] for c in real]
    buckets = dedupe_buckets(tl, times)
    table = defaultdict(lambda: [0, 0])
    for c, b in zip(real, buckets):
        table[b][0] += 1
        table[b][1] += c["dup"]
    rate = {b: (table[b][1] + 0.5) / (table[b][0] + 1) for b in ("view", "input", "still")}
    rate["view"] = table["view"][1] / table["view"][0] if table["view"][0] else 0.0
    return {b: {"captures": table[b][0], "duplicates": table[b][1], "rate": round(rate[b], 3)} for b in rate}


def expected_kept(tl, times, calibration):
    buckets = dedupe_buckets(tl, times)
    return [1 - calibration[b]["rate"] for b in buckets]


def coverage(tl, times, mom, kept=None):
    """How much of what happened on screen the captures saw."""
    times = sorted(times)

    def any_in(a, b):
        k = bisect.bisect_left(times, a)
        return k < len(times) and times[k] < b

    def first_in(a, b):
        k = bisect.bisect_left(times, a)
        return times[k] - a if k < len(times) and times[k] < b else None

    res = {}
    active_h = tl.active.sum() / 3600
    for level in ("place", "view"):
        for dwell in (5, 10, 30):
            states = [s for s in tl.level_states(level) if tl.active_seconds(s[0], s[1]) >= dwell]
            seen = [any_in(s[0], s[1]) for s in states]
            missed = [s for s, ok in zip(states, seen) if not ok]
            res[level if dwell == 5 else f"{level}{dwell}"] = {
                "states": len(states),
                "captured_pct": 100 * sum(seen) / max(1, len(states)),
                "missed": len(missed),
                "missed_min_per_hour": sum(tl.active_seconds(s[0], s[1]) for s in missed) / 60 / active_h,
            }
    # Typing whose result stays on screen: bursts followed by at least 3 s in the same view (typing then Enter
    # usually loads a new page at once, and the view trigger covers that page).
    bursts = [m for m in mom["typing"] if m["keys"] >= 8 and m["active"] and m["view_end"] - m["end"] >= 3]
    res["typing"] = {
        "bursts": len(bursts),
        "captured_pct": 100 * sum(any_in(m["end"], m["view_end"]) for m in bursts) / max(1, len(bursts)),
    }
    lags = [first_in(m["end"], m["view_end"]) for m in bursts]
    lags = [x for x in lags if x is not None]
    res["typing"]["median_lag"] = statistics.median(lags) if lags else None
    clicks = [m for m in mom["click"] if m["settle"] >= 3 and m["active"]]
    res["click"] = {"moments": len(clicks),
                    "captured_pct": 100 * sum(any_in(m["t"], m["t"] + m["settle"]) for m in clicks) / max(1, len(clicks))}
    scrolls = [m for m in mom["scroll"] if m["pause"] >= 3 and m["events"] >= 10 and m["active"]]
    res["scroll"] = {"moments": len(scrolls),
                     "captured_pct": 100 * sum(any_in(m["t"], m["t"] + m["pause"]) for m in scrolls) / max(1, len(scrolls))}
    for dwell in (5, 10):
        epochs = [e for e in mom["epochs"] if e["dur"] >= dwell and e["active"]]
        res["epochs" if dwell == 5 else f"epochs{dwell}"] = {
            "epochs": len(epochs),
            "captured_pct": 100 * sum(any_in(e["start"] + 0.5, e["end"]) for e in epochs) / max(1, len(epochs))}
    return res


def per_question_s():
    """App CPU per boundary question beyond its model JPEG, from the measured hour: 0.29% of a core less the idle
    shell (0.09%, plan/03-capture.md), capture and encode work from the platform benchmarks, and one JPEG per kept
    frame, spread over its 91 questions. It carries the activities' calls too, so it is an upper bound for work that
    grows with questions."""
    c = COST
    rest = c["app_cpu_pct"] / 100 * 3600 - 0.0009 * 3600 - 93 * 0.0005 - 91 * c["keep_s"] - 91 * c["jpeg_s"]
    return rest / 91


def app_cpu_s(captures_h, kept_h, questions_h):
    """Menu-bar process CPU seconds per hour in the current build (model JPEG cached)."""
    c = COST
    return 0.0009 * 3600 + captures_h * 0.0005 + kept_h * c["keep_s"] + questions_h * (c["jpeg_s"] + per_question_s())


def helper_launches(times):
    """OCR helper launches for frames OCR'd at these times: one whenever the helper had been idle 3 minutes."""
    launches, last = 0, -1e18
    for t in sorted(times):
        launches += t - last >= COST["helper_idle_exit_s"]
        last = t
    return launches


def price(captures_h, kept_h, questions_h, ocr_frames_h, launches_h):
    """ocr_frames_h is full-frame OCR equivalents per hour (a cropped frame counts as its measured CPU fraction)."""
    c = COST
    model_h = questions_h * c["boundary_usd"] + c["activities_per_hour"] * c["activity_usd"]
    ocr_s = ocr_frames_h * c["ocr_s_per_frame"] + launches_h * c["ocr_launch_s"]
    app_s = app_cpu_s(captures_h, kept_h, questions_h)
    gb_h = kept_h * c["frame_kb"] / 1e6
    day, month = c["hours_per_day"], c["hours_per_day"] * c["days_per_month"]
    return {
        "questions_h": questions_h,
        "model_usd_h": model_h, "model_usd_day": model_h * day, "model_usd_month": model_h * month,
        "cpu_pct": 100 * (ocr_s + app_s) / 3600, "ocr_pct": 100 * ocr_s / 3600, "app_pct": 100 * app_s / 3600,
        # OCR CPU per full frame at which this design would meet the 1% budget.
        "ocr_s_per_frame_to_fit": (c["budget_pct"] / 100 * 3600 - app_s - launches_h * c["ocr_launch_s"])
        / max(1e-9, ocr_frames_h),
        "replayd_pct": 100 * captures_h * 0.007 / 3600,
        "gb_day": gb_h * day, "gb_month": gb_h * month,
        "local_gb_90_days": gb_h * day * 90 * c["days_per_month"] / 30,
        "r2_usd_month_per_month_kept": gb_h * month * c["r2_usd_per_gb_month"],
        # The first 10 GB stored are free on R2 (plan/04-storage-backup.md).
        "r2_usd_month_after_year": max(0.0, gb_h * month * 12 - 10) * c["r2_usd_per_gb_month"],
    }


# ---------------------------------------------------------------- report


def pct(values, q):
    if not values:
        return None
    return float(np.percentile(values, q))


def describe(tl, real, markers):
    active_h = tl.active.sum() / 3600
    out = {"window_hours": tl.n / 3600, "active_hours": active_h,
           "active_seconds_with": {}, "per_active_hour": {}}
    a = tl.active
    for name, arr in (("keys", tl.k), ("clicks", tl.c), ("scroll", tl.s), ("moves", tl.m), ("drags", tl.d),
                      ("ax_title_events", tl.ax)):
        out["per_active_hour"][name] = int(arr[a].sum() / active_h)
        out["active_seconds_with"][name] = round(100 * (arr[a] > 0).mean(), 1)
    any_input = ((tl.k > 0) | (tl.c > 0) | (tl.s > 0) | (tl.m > 0) | (tl.d > 0))[a]
    out["active_seconds_with"]["no_input"] = round(100 * (~any_input).mean(), 1)
    typing = [r for r in runs(tl.k, 2) if tl.active[r[1]]]
    out["typing_bursts"] = {
        "per_active_hour": len([r for r in typing if r[2] >= 8]) / active_h,
        "keys_median": pct([r[2] for r in typing if r[2] >= 8], 50),
        "keys_p90": pct([r[2] for r in typing if r[2] >= 8], 90),
        "seconds_median": pct([r[1] - r[0] + 1 for r in typing if r[2] >= 8], 50),
        "seconds_p90": pct([r[1] - r[0] + 1 for r in typing if r[2] >= 8], 90),
        "short_per_active_hour": len([r for r in typing if r[2] < 8]) / active_h,
    }
    for level in ("app", "place", "page", "view"):
        states = tl.level_states(level)
        durs = [tl.active_seconds(s[0], s[1]) for s in states]
        durs = [d for d in durs if d > 0]
        out.setdefault("states", {})[level] = {
            "per_active_hour": len(durs) / active_h,
            "median_s": pct(durs, 50), "p90_s": pct(durs, 90),
            "under_5s_pct": 100 * sum(d < 5 for d in durs) / max(1, len(durs)),
            "under_60s_pct": 100 * sum(d < 60 for d in durs) / max(1, len(durs)),
        }
    time_by_cat = Counter()
    for s in tl.level_states("app"):
        time_by_cat[category(s[3])] += tl.active_seconds(s[0], s[1])
    # Which view changes follow the person's own input: no key, click or scroll in the 3 s before means the page or
    # app changed by itself (a notification, a page updating its title).
    inp = (tl.k > 0) | (tl.c > 0) | (tl.s > 0)
    sources = {"app": [0, 0], "site": [0, 0], "path": [0, 0], "title": [0, 0]}
    for (_, _, prev), (start, _, view) in zip(tl.views, tl.views[1:]):
        i = tl.index(start)
        if not tl.active[i]:
            continue
        kind = ("app" if view[0] != prev[0] else "site" if view[2] != prev[2]
                else "path" if view[3] != prev[3] else "title")
        sources[kind][0] += 1
        sources[kind][1] += not inp[max(0, i - 3):i + 1].any()
    out["view_changes"] = {k: {"changes": v[0], "without_input_3s": v[1]} for k, v in sources.items()}
    total = sum(time_by_cat.values()) or 1
    out["time_by_category_pct"] = {k: round(100 * v / total, 1) for k, v in time_by_cat.most_common()}
    return out


def validate(tl, real):
    agree_place = agree_view = 0
    for c in real:
        v = tl.view_at(c["at"])
        if v is None:
            continue
        agree_place += v[0] == c["view"][0] and v[2] == c["view"][2]
        agree_view += v == c["view"]
    return {"captures": len(real), "place_agree_pct": 100 * agree_place / max(1, len(real)),
            "view_agree_pct": 100 * agree_view / max(1, len(real))}


def gaps(tl, real):
    """Active stretches with no real capture for over 90 s: the app was down or blocked (secure input, exclusion)."""
    times = [c["at"] for c in real]
    out = []
    edges = [tl.t0] + times + [tl.end]
    for a, b in zip(edges, edges[1:]):
        if b - a > 90 and tl.active_seconds(a + 66, b) > 30:
            out.append((a, b))
    return out


def missed_states(tl, times, down, level, min_s=5):
    """States of `level` lasting at least `min_s` active seconds with no capture, outside app-down stretches."""
    times = sorted(times)
    out = []
    for start, end, key, app in tl.level_states(level):
        if any(a <= start and end <= b for a, b in down):
            continue
        dur = tl.active_seconds(start, end)
        if dur < min_s:
            continue
        k = bisect.bisect_left(times, start)
        if k < len(times) and times[k] < end:
            continue
        out.append({"start": start, "dur": dur, "category": category(app)})
    return out


def evidence_reads(tl, caps, kept, is_anchor, per_hour=12.0, burst=2.0):
    """Evidence frames the recorder would read (`EvidenceReading`): another view than the last frame read, within
    the hourly allowance. The rule's other half, a quarter of the screen changed, needs pixels; this counts without it,
    so it is a lower bound on reads."""
    reads, last_view, allowance, allowance_at = 0, None, burst, None
    for (t, _kind), k, anchor in zip(caps, kept, is_anchor):
        if k < 0.5:
            continue
        view = tl.view_at(t)
        if anchor:
            last_view = view
            continue
        if view == last_view:
            continue
        if allowance_at is not None:
            allowance = min(burst, allowance + (t - allowance_at) * per_hour / 3600)
        allowance_at = t
        if allowance >= 1:
            allowance -= 1
            reads += 1
            last_view = view
    return reads


def anchors_of(tl, caps):
    out, last_anchor, last_place = [], -1e18, None
    for t, kind in caps:
        view = tl.view_at(t)
        place = (view[0], view[2]) if view else None
        if kind in ("timer", "switch", "wake") or place != last_place or t - last_anchor >= 55:
            out.append(t)
            last_anchor, last_place = t, place
    return out


def stretch_visits(tl, mom, real_times, phase, calibration, start, end):
    """App and site visits inside a stretch, by length: how many got a real capture, and how many would get a frame
    and an anchor (a boundary question) under P0 and P13."""
    S = ("place", 5, 30)
    p0 = simulate(tl, Policy("P0", ("fixed", 60, 30), S), mom, timer_phase=phase)
    p13 = simulate(tl, Policy("P13", ("gap", 60), None, [("view", 10), ("settle", 10), ("typing", 8, 3)], 10,
                              bucket=(4, 3)), mom, timer_phase=phase)
    series = {"real": sorted(real_times), "P0": sorted(t for t, _ in p0), "P13": sorted(t for t, _ in p13),
              "P13 anchors": sorted(anchors_of(tl, p13))}
    buckets = (("under 5 s", 0, 5), ("5-10 s", 5, 10), ("10-30 s", 10, 30), ("30 s+", 30, 1e9))
    out = {}
    for label, lo, hi in buckets:
        visits = [v for v in tl.level_states("place")[1:] if start <= v[0] < end
                  and lo <= tl.active_seconds(v[0], v[1]) < hi]
        row = {"visits": len(visits)}
        for name, times in series.items():
            row[name] = sum(1 for v in visits
                            if bisect.bisect_left(times, v[0]) < len(times) and times[bisect.bisect_left(times, v[0])] < v[1])
        out[label] = row
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeline", required=True)
    ap.add_argument("--salt", required=True)
    ap.add_argument("--store", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--until", type=float, help="end of the window, epoch seconds (default: newest capture)")
    ap.add_argument("--stretch", type=float, nargs=2, metavar=("START", "END"),
                    help="a labelled stretch, epoch seconds, to count which visits get a frame and a question")
    ap.add_argument("--crop-fraction", type=float, default=0.67,
                    help="CPU of changed-region OCR relative to full OCR within one view, from crop_ocr_bench")
    ap.add_argument("--crop-fraction-view", type=float, default=0.97,
                    help="the same after the view changed (new title or page), from crop_ocr_bench")
    args = ap.parse_args()
    salt = open(args.salt).read().strip()
    # The store copy ends where it was taken; cut the timeline at its newest capture so both cover one window.
    newest = sqlite3.connect(args.store).execute("select max(at) from capture").fetchone()[0]
    tl = Timeline(args.timeline, until=args.until or newest)
    real, markers = load_captures(args.store, salt, tl.t0, tl.end)
    active_h = tl.active.sum() / 3600
    mom = moments(tl)
    result = {"describe": describe(tl, real, markers), "validate": validate(tl, real)}
    down = gaps(tl, real)
    result["app_gaps"] = [{"start": a, "seconds": b - a} for a, b in down]
    in_down = lambda t: any(a < t < b for a, b in down)
    real_up = [c for c in real if not in_down(c["at"])]
    result["real"] = {
        "captures_per_active_hour": len(real) / active_h,
        "by_trigger": dict(Counter(c["trigger"] for c in real)),
        "duplicates": sum(c["dup"] for c in real),
    }
    pairs = [(b["at"] - a["at"], a["trigger"], b["trigger"]) for a, b in zip(real, real[1:])
             if b["at"] - a["at"] < IDLE_AFTER]
    result["real_gaps"] = {
        "median_s": pct([g for g, _, _ in pairs], 50), "p90_s": pct([g for g, _, _ in pairs], 90),
        "max_s": max([g for g, _, _ in pairs], default=None),
        "over_75s": sum(1 for g, _, _ in pairs if g > 75), "intervals": len(pairs),
        "over_75s_switch_then_timer": sum(1 for g, x, y in pairs if g > 75 and x == "switch" and y == "timer"),
    }
    calibration = calibrate(tl, real)
    result["dedupe_calibration"] = calibration

    # What the real schedule missed.
    real_times = [c["at"] for c in real]
    misses = {}
    for level in ("place", "page", "view"):
        for min_s in (5, 10, 30):
            m = missed_states(tl, real_times, down, level, min_s)
            states = [s for s in tl.level_states(level) if tl.active_seconds(s[0], s[1]) >= min_s
                      and not any(a <= s[0] and s[1] <= b for a, b in down)]
            misses[f"{level}>={min_s}s"] = {
                "states": len(states), "missed": len(m),
                "missed_pct": 100 * len(m) / max(1, len(states)),
                "missed_active_min_per_hour": sum(x["dur"] for x in m) / 60 / active_h,
                "missed_median_s": pct([x["dur"] for x in m], 50),
                "missed_p90_s": pct([x["dur"] for x in m], 90),
                "missed_max_s": max([x["dur"] for x in m], default=None),
                "missed_by_category": dict(Counter(x["category"] for x in m)),
            }
    result["real_misses"] = misses
    # Missed views of 30 s or more, and whether each lies inside a gap of over 75 s between real captures.
    long_missed = missed_states(tl, real_times, down, "view", 30)
    in_hole = 0
    for m in long_missed:
        k = bisect.bisect_left(real_times, m["start"])
        before = real_times[k - 1] if k > 0 else None
        after = real_times[k] if k < len(real_times) else None
        in_hole += before is not None and after is not None and after - before > 75
    result["long_missed_views_in_holes"] = {"missed": len(long_missed), "inside_gap_over_75s": in_hole}
    result["real_coverage"] = coverage(tl, real_times, mom)

    def next_capture_delays(points):
        out = []
        for t, horizon in points:
            k = bisect.bisect_left(real_times, t)
            out.append(real_times[k] - t if k < len(real_times) and real_times[k] < horizon else None)
        return out

    bursts = [m for m in mom["typing"] if m["keys"] >= 8 and m["active"] and not in_down(m["end"])]
    delays = next_capture_delays([(m["end"], tl.end) for m in bursts])
    result["typing_vs_real"] = {
        "bursts": len(bursts),
        "view_changed_within_1_5s": sum(1 for m in bursts if m["view_end"] - m["end"] < 1.5),
        "stayed_3s": sum(1 for m in bursts if m["view_end"] - m["end"] >= 3),
        "stayed_3s_captured": sum(1 for m in bursts if m["view_end"] - m["end"] >= 3
                                  and any(m["end"] <= t < m["view_end"] for t in real_times)),
        "captured_before_view_change_pct": 100 * sum(
            1 for m in bursts if any(m["end"] <= t < m["view_end"] for t in real_times)) / max(1, len(bursts)),
        "next_capture_within": {f"{n}s": 100 * sum(1 for d in delays if d is not None and d <= n) / max(1, len(delays))
                                for n in (5, 15, 30, 60)},
        "median_next_capture_s": pct([d for d in delays if d is not None], 50),
    }
    clicks = [m for m in mom["click"] if m["active"] and not in_down(m["t"])]
    for settle in (3, 5, 10):
        sel = [m for m in clicks if m["settle"] >= settle]
        seen = sum(1 for m in sel if any(m["t"] <= t < m["t"] + m["settle"] for t in real_times))
        result.setdefault("clicks_vs_real", {})[f"settle>={settle}s"] = {
            "moments_per_active_hour": len(sel) / active_h, "captured_pct": 100 * seen / max(1, len(sel))}
    scrolls = [m for m in mom["scroll"] if m["active"] and m["events"] >= 10 and not in_down(m["t"])]
    for pause in (3, 5, 10):
        sel = [m for m in scrolls if m["pause"] >= pause]
        seen = sum(1 for m in sel if any(m["t"] <= t < m["t"] + m["pause"] for t in real_times))
        result.setdefault("scrolls_vs_real", {})[f"pause>={pause}s"] = {
            "moments_per_active_hour": len(sel) / active_h, "captured_pct": 100 * seen / max(1, len(sel))}
    epochs = [e for e in mom["epochs"] if e["active"] and not in_down(e["start"])]
    for d in (3, 5, 10, 30):
        sel = [e for e in epochs if e["dur"] >= d]
        seen = sum(1 for e in sel if any(e["start"] + 0.5 <= t < e["end"] for t in real_times))
        result.setdefault("epochs_vs_real", {})[f">={d}s"] = {
            "per_active_hour": len(sel) / active_h, "captured_pct": 100 * seen / max(1, len(sel)),
            "uncaptured_per_active_hour": (len(sel) - seen) / active_h}
    # Between two consecutive captures, the views and input epochs that began and ended unseen.
    gaps_between, unseen_views, unseen_epochs = [], [], []
    view_states = tl.level_states("view")
    for a, b in zip(real_times, real_times[1:]):
        if b - a >= IDLE_AFTER or in_down((a + b) / 2):
            continue
        gaps_between.append(b - a)
        unseen_views.append(sum(1 for s in view_states if a < s[0] and s[1] <= b and tl.active_seconds(s[0], s[1]) >= 5))
        unseen_epochs.append(sum(1 for e in epochs if a < e["start"] and e["end"] <= b and e["dur"] >= 5))
    result["between_real_captures"] = {
        "intervals": len(gaps_between),
        "median_gap_s": pct(gaps_between, 50),
        "with_unseen_view_pct": 100 * sum(1 for x in unseen_views if x) / max(1, len(unseen_views)),
        "unseen_views_per_active_hour": sum(unseen_views) / active_h,
        "with_unseen_epoch_pct": 100 * sum(1 for x in unseen_epochs if x) / max(1, len(unseen_epochs)),
        "unseen_epochs_per_active_hour": sum(unseen_epochs) / active_h,
        "unseen_epochs_p90": pct(unseen_epochs, 90),
    }

    # Simulations.
    first_timer = next((c["at"] for c in real if c["trigger"] == "timer"), tl.t0)
    phase = (first_timer - tl.t0) % 60
    S = ("place", 5, 30)
    policies = [
        Policy("P0 current", ("fixed", 60, 30), S, note="60 s timer, switch on app or site held 5 s, 30 s spacing"),
        Policy("P0b timer after last capture", ("gap", 60), S,
               note="P0, with the timer counting 60 s from the last capture of any kind"),
        Policy("P1 typing pause", ("fixed", 60, 30), S, [("typing", 8, 3)], 10,
               note="+ capture 3 s after a burst of 8 or more keys"),
        Policy("P2 click settle", ("fixed", 60, 30), S, [("click", 2)], 10,
               note="+ capture when 2 s pass after a click with no key, click or scroll"),
        Policy("P3 scroll stop", ("fixed", 60, 30), S, [("scroll", 10, 2)], 10,
               note="+ capture 2 s after a scroll run of 10 or more events"),
        Policy("P4 every view change", ("fixed", 60, 30), S, [("view", 3)], 10,
               note="+ capture when any title or URL change holds 3 s"),
        Policy("P5 adaptive interval", ("adaptive", 20, 60, 20), S,
               note="20 s interval while keys, clicks or scrolls in the last 20 s, else 60 s"),
        Policy("P6 all triggers", ("gap", 60), S, [("typing", 8, 3), ("click", 2), ("scroll", 10, 2), ("view", 3)], 10,
               note="P1 to P4 together, 10 s spacing, no cap"),
        Policy("P7 all triggers, capped", ("gap", 60), S, [("typing", 8, 3), ("click", 2), ("scroll", 10, 2), ("view", 3)], 15,
               bucket=(3, 2), note="P6 with 15 s spacing and at most 2 event captures a minute (burst 3)"),
        Policy("P8 settled changes", ("gap", 60), S, [("typing", 8, 3), ("view", 5), ("click", 3)], 20,
               bucket=(2, 1.5), note="typing pause 3 s, view held 5 s, click settle 3 s; 20 s spacing; 1.5 a minute"),
        Policy("P9 settle 5 s", ("gap", 60), S, [("settle", 5)], 10,
               note="capture once the screen has stayed put 5 s after a view change, click, scroll or typing burst"),
        Policy("P10 settle 10 s", ("gap", 60), S, [("settle", 10)], 10,
               note="the same with a 10 s dwell"),
        Policy("P11 view + settle, with switch", ("gap", 60), S, [("view", 10), ("settle", 10)], 10,
               note="today's switch capture, plus a title or URL held 10 s, plus the screen still 10 s after a change"),
        Policy("P12 view + settle", ("gap", 60), None, [("view", 10), ("settle", 10)], 10,
               note="P11 without the 5 s switch capture: a new app or site is captured once it has held 10 s"),
        Policy("P13 dwell capture", ("gap", 60), None, [("view", 10), ("settle", 10), ("typing", 8, 3)], 10,
               bucket=(4, 3), note="P12, plus a capture 3 s after a burst of 8 or more keys; at most 3 event captures "
                                   "a minute, 4 in a row"),
        Policy("P13 as built", ("gap", 60), None, [("view", 10), ("settle_any", 10), ("typing", 8, 3)], 10,
               bucket=(4, 3), served_check=True,
               note="P13 as DwellScheduler implements it: any key, click, scroll or view change restarts the "
                    "settle clock, and a trigger is dropped when a capture came after its change"),
        Policy("P14 dwell capture + place", ("gap", 60), None,
               [("place", 10), ("view", 10), ("settle", 10), ("typing", 8, 3)], 10, bucket=(4, 3),
               note="P13, plus a capture once a new app or site has held 10 s"),
    ]
    for dwell in (3, 5, 8, 10, 15):
        for spacing in (10, 20):
            policies.append(Policy(f"sweep settle {dwell} s, spacing {spacing} s", ("gap", 60), S,
                                   [("settle", dwell)], spacing, note="sweep"))
    for hold in (5, 10, 15):
        for dwell in (8, 10):
            policies.append(Policy(f"sweep view {hold} s + settle {dwell} s", ("gap", 60), S,
                                   [("view", hold), ("settle", dwell)], 10, note="sweep"))
            policies.append(Policy(f"sweep no switch, view {hold} s + settle {dwell} s", ("gap", 60), None,
                                   [("view", hold), ("settle", dwell)], 10, note="sweep"))
    for settle in (10, 20):
        policies.append(Policy(f"sweep switch {settle} s + settle 10 s", ("gap", 60), ("place", settle, 30),
                               [("settle", 10)], 10, note="sweep"))
    sims = {}
    crop_fraction = args.crop_fraction
    for p in policies:
        caps = simulate(tl, p, mom, timer_phase=phase)
        times = [t for t, _ in caps]
        kept = expected_kept(tl, times, calibration)
        buckets = dedupe_buckets(tl, times)
        # Anchors keep today's question rate: every timer, switch or wake frame, the first event frame at a new app
        # or site (it stands in for the switch capture), and otherwise an event frame only when no anchor came for
        # 55 s (it stands in for a timer tick).
        is_anchor, last_anchor, last_place = [], -1e18, None
        for t, kind in caps:
            view = tl.view_at(t)
            place = (view[0], view[2]) if view else None
            anchor = kind in ("timer", "switch", "wake") or place != last_place or t - last_anchor >= 55
            is_anchor.append(anchor)
            if anchor:
                last_anchor, last_place = t, place
        anchor_kept_h = sum(k for k, a in zip(kept, is_anchor) if a) / active_h
        kept_times = [t for (t, _), k in zip(caps, kept) if k > 0.5]
        anchor_times = [t for (t, _), k, a in zip(caps, kept, is_anchor) if k > 0.5 and a]
        launches_all_h = helper_launches(kept_times) / active_h
        launches_anchor_h = helper_launches(anchor_times) / active_h
        cov = coverage(tl, times, mom)
        captures_h = len(caps) / active_h
        kept_h = sum(kept) / active_h
        # Changed-region OCR on evidence frames, at the CPU fraction measured for a frame of the same view or of a
        # new view (crop_ocr_bench).
        evidence_ocr_h = sum(k * (args.crop_fraction_view if b == "view" else crop_fraction)
                             for k, b, a in zip(kept, buckets, is_anchor) if not a) / active_h
        per_minute = Counter(int((t - tl.t0) // 60) for t in times)
        sims[p.name] = {
            "note": p.note,
            "per_minute_max": max(per_minute.values(), default=0),
            "per_minute_p99": pct(list(per_minute.values()), 99),
            "captures_per_active_hour": captures_h,
            "kept_per_active_hour": kept_h,
            "by_trigger_per_hour": {k: v / active_h for k, v in Counter(kind for _, kind in caps).items()},
            "anchor_kept_per_hour": anchor_kept_h,
            "evidence_kept_by_trigger_per_hour": {
                kind: sum(k for (t, kd), k, a in zip(caps, kept, is_anchor) if kd == kind and not a) / active_h
                for kind in sorted({kd for _, kd in caps})},
            "anchors_by_trigger_per_hour": {
                kind: sum(k for (t, kd), k, a in zip(caps, kept, is_anchor) if kd == kind and a) / active_h
                for kind in sorted({kd for _, kd in caps})},
            "coverage": cov,
            # A: every kept frame gets a boundary question and full OCR (today's pipeline).
            "price_A_all_questions": price(captures_h, kept_h, kept_h, kept_h, launches_all_h),
            # B: event frames are evidence only (OCR, search, timeline); questions stay on timer and switch frames.
            "price_B_evidence": price(captures_h, kept_h, anchor_kept_h, kept_h, launches_all_h),
            # C: as B, and evidence frames OCR only the tiles that changed since the previous frame.
            "price_C_evidence_crop": price(captures_h, kept_h, anchor_kept_h, anchor_kept_h + evidence_ocr_h,
                                           launches_all_h),
            # D: as B, and evidence frames are stored without OCR (timeline and review only; search misses them).
            "price_D_evidence_no_ocr": price(captures_h, kept_h, anchor_kept_h, anchor_kept_h, launches_anchor_h),
            # E: as built: evidence frames are read when they show another view than the last frame read, at most
            # 12 an hour.
            "price_E_built": price(captures_h, kept_h, anchor_kept_h,
                                   anchor_kept_h + evidence_reads(tl, caps, kept, is_anchor) / active_h, launches_all_h),
            "evidence_reads_per_hour": evidence_reads(tl, caps, kept, is_anchor) / active_h,
        }
        if p.name.startswith("P0"):
            # Replay the app's restarts in this window to check the simulator against the real captures.
            launches = [at for at, kind in markers if kind == "launch"]
            replay = simulate(tl, p, mom, timer_phase=phase, launches=launches)
            replay_times = [t for t, _ in replay]
            check = {}
            for trigger in ("timer", "switch"):
                sel = [c for c in real_up if c["trigger"] == trigger]
                for window in (2, 5):
                    hit = 0
                    for c in sel:
                        k = bisect.bisect_left(replay_times, c["at"] - window)
                        hit += k < len(replay_times) and replay_times[k] <= c["at"] + window
                    check[f"{trigger}_within_{window}s_pct"] = 100 * hit / max(1, len(sel))
            check["replay_captures"] = len(replay)
            check["real_captures"] = len(real_up)
            check["replay_by_trigger"] = dict(Counter(kind for _, kind in replay))
            sims[p.name]["replay_check"] = check
    result["simulations"] = sims
    if args.stretch:
        result["stretch_visits"] = stretch_visits(tl, mom, real_times, phase, calibration, *args.stretch)
    json.dump(result, open(args.out, "w"), indent=1, default=float)
    print(json.dumps({"active_hours": active_h, "real": result["real"], "validate": result["validate"],
                      "gaps": len(down)}, default=float))


if __name__ == "__main__":
    main()
