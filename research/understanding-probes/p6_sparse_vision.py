"""Sparse metadata: does an image (or OCR text) let decision models link a capture to the right thread? Synthetic images only."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from probe_lib import openrouter, img_part
IMG = os.path.join(os.path.dirname(__file__), "img")
H = {
 "H01": "Acme budget-tracker: monthly charts feature (MonthlyChart.tsx, reports API)",
 "H02": "Acme budget-tracker: auth migration to OAuth (login flow, tokens, session middleware)",
 "H04": "weather-widget side project: DST bug in forecast merging",
 "H05": "weather-widget side project: redesign of the forecast card UI",
 "H06": "Watching chess content (YouTube videos, Twitch streams)",
 "H08": "Lisbon trip planning (November, with partner)",
 "H10": "Learning Rust for fun (the Rust Book, exercises)",
 "H13": "Baking sourdough at home (starter, recipes, buying flour)",
 "H14": "Grocery shopping lists and online grocery orders",
}
crit = dict(H); crit["NEW"] = "None of the listed threads; this starts a new thread"
q = {"thread": {"type": "choice", "instructions": "Which existing thread does this capture belong to? Pick NEW if none matches or the evidence is insufficient.", "criteria": crit}}
OCR = {"ide": "weather-widget — src/forecast/merge.ts; export function mergeForecasts(a: Forecast[], b: Forecast[]); // TODO: handle timezone offsets from the provider; $ npm test -- merge; ✕ handles DST shift; Tests: 1 failed, 1 passed",
       "browser": "Sourdough starter: a feeding schedule that works. Feed the starter at a 1:2:2 ratio of starter, flour and water. Shopping list: whole wheat flour 1kg, rye flour 500g, kitchen scale, glass jar"}
CASES = [("ide", "H04", "App: Terminal. Window title: zsh"), ("browser", "H13", "App: Chrome. Window title: (untitled tab)")]
rows = []
for m, vision in [("perplexity/pplx-decider-v1.1-27b", True), ("openai/gpt-6-luna-decisions", True), ("inception/mercury-decide", True), ("cloudflare/clef", True), ("typesafe/jev-1.13", False)]:
    for img, truth, meta in CASES:
        forms = {"meta_only": meta, "meta+ocr": f"{meta}\nOCR: {OCR[img]}"}
        if vision:
            forms["meta+img512"] = [meta, img_part(os.path.join(IMG, f"{img}_512.jpg"))]
            forms["meta+img1024"] = [meta, img_part(os.path.join(IMG, f"{img}_1024.jpg"))]
        for f, state in forms.items():
            r = openrouter(m, state, q, f"sparse-{f}")
            a = r["answers"]["thread"] if r["status"] == 200 else None
            rows.append({"model": m, "case": img, "form": f, "truth": truth, "pred": a and a["choice"], "p_truth": a and round(a["probabilities"].get(truth, 0), 3), "p_new": a and round(a["probabilities"].get("NEW", 0), 3), "tokens": r["usage"].get("input_tokens"), "ms": r["ms"], "err": r["error"] and r["error"].get("message")})
json.dump(rows, open(os.path.join(os.path.dirname(__file__), "p6_sparse_vision_results.json"), "w"), indent=0)
for r in rows: print(json.dumps(r))
