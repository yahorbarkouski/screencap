"""Boundary question wording on two invented sessions (synthetic, authored; not real user data).
A: one call per gap with local context (3 previous captures + next).  B: one call per session, one noul per gap over the whole window."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from probe_lib import openrouter
S1 = [
 "14:00 Code editor | weather-widget — src/forecast/merge.ts | OCR: export function mergeForecasts(a, b) ...",
 "14:02 Terminal | npm test -- merge | OCR: 1 failed: handles DST shift",
 "14:04 Chrome | developer.mozilla.org | Intl.DateTimeFormat timeZone option — MDN",
 "14:06 Code editor | weather-widget — src/forecast/merge.ts | OCR: const offset = tzOffset(city, f.hour)",
 "14:08 1Password | GitHub personal access token | OCR: Copy password",
 "14:10 Terminal | git push origin fix/dst | OCR: remote: Create a pull request for 'fix/dst'",
 "14:12 Messages | Chat with Mom | OCR: yes I'll call you on Sunday, love you",
 "14:14 Messages | Chat with Mom | OCR: did you get the photos from the trip?",
 "14:16 Chrome | github.com | Fix DST shift in mergeForecasts · Pull Request #42 · weather-widget",
 "14:18 Chrome | github.com | Review comments on PR #42: 'please add a test for the fall-back hour'",
 "14:20 Chrome | youtube.com | Top 10 chess blunders of 2026 — YouTube",
 "14:22 Chrome | youtube.com | Top 10 chess blunders of 2026 — YouTube (12:40 / 18:02)",
 "14:24 Chrome | twitch.tv | GM speed chess live — Twitch",
 "14:26 Chrome | bank.example.com | Pay electricity bill — Online Banking",
 "14:28 Mail | Receipt: electricity payment confirmed | OCR: Amount 64.20 EUR",
]
B1 = [6, 8, 10, 13]  # index i means boundary between capture i and i+1 (0-based gap index)
S2 = [
 "19:00 Chrome | doc.rust-lang.org | The Rust Programming Language — Chapter 10: Generic Types",
 "19:02 Chrome | doc.rust-lang.org | Chapter 10.2: Traits: Defining Shared Behavior",
 "19:04 Chrome | play.rust-lang.org | Rust Playground | OCR: impl Summary for Tweet { fn summarize(&self) ...",
 "19:06 Chrome | youtube.com | Rust traits explained in 12 minutes — YouTube",
 "19:08 Chrome | youtube.com | Funniest cat compilation 2026 — YouTube",
 "19:10 Chrome | youtube.com | Cats vs cucumbers part 3 — YouTube",
 "19:12 Chrome | recipes.example.org | Sourdough starter: a feeding schedule that works",
 "19:14 Chrome | shop.example.com | Rye flour 1kg — Add to cart",
 "19:16 Google Docs | Q4 roadmap draft | OCR: Goals: ship offline mode, reduce churn",
 "19:18 Google Docs | Q4 roadmap draft | OCR: Milestones: Oct beta, Nov GA",
 "19:20 Zoom | Weekly product sync | OCR: 6 participants, Recording",
 "19:22 Zoom | Weekly product sync | OCR: screen share: Q4 roadmap draft",
]
B2 = [3, 5, 7, 9]
RULE = ("An activity is one concrete intent or outcome the person would want as one timeline row. Short instrumental detours that serve the "
        "current task (looking up docs, copying a password, running tests) stay in the same activity. Switching to an unrelated purpose starts a new "
        "activity, and returning to an earlier task after an unrelated interruption also starts a new activity.")
MODELS = ["typesafe/jev-1.13", "perplexity/pplx-decider-v1.1-27b", "openai/gpt-6-luna-decisions", "inception/mercury-decide", "cloudflare/clef-flash"]
out = []
for m in MODELS:
    for sid, S, B in (("S1", S1, B1), ("S2", S2, B2)):
        # A: local context
        for g in range(len(S) - 1):
            prev = S[max(0, g - 2): g + 1]
            state = {"rule": RULE, "previous_captures": prev, "next_capture": S[g + 1]}
            q = {"same": {"type": "noul", "instructions": "The next capture continues the same activity as the most recent previous capture."}}
            r = openrouter(m, state, q, f"bnd-A-{sid}")
            p = r["answers"]["same"]["noul"] if r["status"] == 200 else None
            out.append({"model": m, "form": "A", "session": sid, "gap": g, "truth_boundary": g in B, "p_boundary": None if p is None else round(1 - p, 4), "ms": r["ms"], "tokens": r["usage"].get("input_tokens"), "err": r["error"]})
        # B: whole window, one noul per gap
        state = {"rule": RULE, "captures": {f"c{i+1}": s for i, s in enumerate(S)}}
        q = {f"g{g}": {"type": "noul", "instructions": f"Capture c{g+2} starts a new activity (it does not continue the activity of capture c{g+1})."} for g in range(len(S) - 1)}
        r = openrouter(m, state, q, f"bnd-B-{sid}")
        for g in range(len(S) - 1):
            p = r["answers"][f"g{g}"]["noul"] if r["status"] == 200 else None
            out.append({"model": m, "form": "B", "session": sid, "gap": g, "truth_boundary": g in B, "p_boundary": p, "ms": r["ms"], "tokens": r["usage"].get("input_tokens"), "err": r["error"]})
json.dump(out, open(os.path.join(os.path.dirname(__file__), "p3_boundary_results.json"), "w"), indent=0)
# summary
import statistics
for m in MODELS:
    for form in ("A", "B"):
        rows = [o for o in out if o["model"] == m and o["form"] == form and o["p_boundary"] is not None]
        if not rows: print(m, form, "no results"); continue
        tp = sum(o["truth_boundary"] and o["p_boundary"] >= 0.5 for o in rows); fp = sum((not o["truth_boundary"]) and o["p_boundary"] >= 0.5 for o in rows)
        fn = sum(o["truth_boundary"] and o["p_boundary"] < 0.5 for o in rows)
        f1 = 2 * tp / (2 * tp + fp + fn) if tp else 0.0
        brier = statistics.mean((o["p_boundary"] - (1.0 if o["truth_boundary"] else 0.0)) ** 2 for o in rows)
        errs = [o for o in rows if (o["p_boundary"] >= 0.5) != o["truth_boundary"]]
        calls = len({(o["session"], o["gap"]) for o in rows}) if form == "A" else 2
        ms = statistics.median(o["ms"] for o in rows)
        print(f"{m:36s} {form} n={len(rows)} TP={tp} FP={fp} FN={fn} F1={f1:.2f} Brier={brier:.3f} median_ms={ms:.0f} errors={[(o['session'], o['gap'], round(o['p_boundary'], 2)) for o in errs]}")
