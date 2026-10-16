"""Rescore p3 results with corrected S1 truth (gap g = boundary between capture g and g+1, 0-based)."""
import json, os, statistics
HERE = os.path.dirname(__file__)
out = json.load(open(os.path.join(HERE, "p3_boundary_results.json")))
TRUTH = {"S1": {5, 7, 9, 12}, "S2": {3, 5, 7, 9}}
for o in out:
    o["truth_boundary"] = o["gap"] in TRUTH[o["session"]]
json.dump(out, open(os.path.join(HERE, "p3_boundary_results.json"), "w"), indent=0)
models = sorted({o["model"] for o in out})
for m in models:
    for form in ("A", "B"):
        rows = [o for o in out if o["model"] == m and o["form"] == form and o["p_boundary"] is not None]
        tp = sum(o["truth_boundary"] and o["p_boundary"] >= 0.5 for o in rows); fp = sum((not o["truth_boundary"]) and o["p_boundary"] >= 0.5 for o in rows)
        fn = sum(o["truth_boundary"] and o["p_boundary"] < 0.5 for o in rows)
        f1 = 2 * tp / (2 * tp + fp + fn) if tp else 0.0
        brier = statistics.mean((o["p_boundary"] - (1.0 if o["truth_boundary"] else 0.0)) ** 2 for o in rows)
        errs = [(o["session"], o["gap"], round(o["p_boundary"], 2)) for o in rows if (o["p_boundary"] >= 0.5) != o["truth_boundary"]]
        toks = statistics.mean(o["tokens"] for o in rows if o["tokens"]) if form == "A" else sum({(o["session"]): o["tokens"] for o in rows}.values())
        print(f"{m:34s} {form} n={len(rows)} TP={tp} FP={fp} FN={fn} F1={f1:.2f} Brier={brier:.3f} median_ms={statistics.median(o['ms'] for o in rows):.0f} tokens={'%.0f/call' % toks if form=='A' else '%d total for 2 calls' % toks} errors={errs}")
