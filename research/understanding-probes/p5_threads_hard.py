"""Fine-grained thread linkage: near-duplicate invented threads (sub-projects, watch vs play, two trips). Synthetic only."""
import json, os, sys, statistics
sys.path.insert(0, os.path.dirname(__file__))
from probe_lib import openrouter
H = {
 "H01": "Acme budget-tracker: monthly charts feature (MonthlyChart.tsx, reports API)",
 "H02": "Acme budget-tracker: auth migration to OAuth (login flow, tokens, session middleware)",
 "H03": "Acme budget-tracker: production incident of 2 Oct (slow queries, Grafana, postmortem)",
 "H04": "weather-widget side project: DST bug in forecast merging",
 "H05": "weather-widget side project: redesign of the forecast card UI",
 "H06": "Watching chess content (YouTube videos, Twitch streams)",
 "H07": "Playing chess online (lichess games and puzzles)",
 "H08": "Lisbon trip planning (November, with partner)",
 "H09": "Porto trip planning (March, with parents)",
 "H10": "Learning Rust for fun (the Rust Book, exercises)",
 "H11": "Acme work: rewriting the CSV importer in Rust",
 "H12": "Interview prep for Globex",
}
Q = [
 ("code editor acme-budget-tracker src/auth/session.ts; Chrome 'OAuth PKCE flow explained'", "H02"),
 ("Grafana 'p95 latency budget-tracker api'; Google Docs 'Postmortem: Oct 2 slow reports'", "H03"),
 ("code editor acme-budget-tracker src/reports/api.ts function groupByMonth", "H01"),
 ("Figma 'weather-widget card v3' frames", "H05"),
 ("lichess.example 'Puzzle streak 23'", "H07"),
 ("YouTube 'Magnus vs Hikaru — round 5 recap'", "H06"),
 ("Chrome flights.example 'OPO return flights in March, 3 passengers'", "H09"),
 ("code editor acme-csv-importer src/main.rs 'use serde::Deserialize'", "H11"),
 ("Chrome doc.rust-lang.org 'Chapter 15: Smart Pointers'", "H10"),
 ("Chrome 'Day trips from Lisbon to Sintra'", "H08"),
 ("code editor weather-widget src/ui/HourlyStrip.tsx, CSS grid styles", "H05"),
 ("code editor acme-budget-tracker src/billing/invoice.ts 'export invoice as PDF' (first time this file appears)", "NEW"),
]
MODELS = ["typesafe/jev-1.13", "perplexity/pplx-decider-v1.1-27b", "openai/gpt-6-luna-decisions", "inception/mercury-decide", "cloudflare/clef-flash"]
crit = dict(H); crit["NEW"] = "None of the listed threads; this starts a new thread"
q = {"thread": {"type": "choice", "instructions": "Which existing thread does this activity belong to? Threads can be specific sub-projects; pick the most specific matching one, or NEW if none matches.", "criteria": crit}}
rows = []
for m in MODELS:
    for text, truth in Q:
        r = openrouter(m, {"activity": text}, q, "thread-hard")
        a = r["answers"]["thread"] if r["status"] == 200 else None
        rows.append({"model": m, "truth": truth, "pred": a and a["choice"], "p": a and round(a["probabilities"][a["choice"]], 3), "p_truth": a and round(a["probabilities"].get(truth, 0), 3), "conf": a and a.get("confidence"), "ms": r["ms"], "err": r["error"]})
json.dump(rows, open(os.path.join(os.path.dirname(__file__), "p5_threads_hard_results.json"), "w"), indent=0)
for m in MODELS:
    rs = [r for r in rows if r["model"] == m and r["pred"]]
    acc = sum(r["pred"] == r["truth"] for r in rs)
    print(f"{m:34s} acc={acc}/{len(rs)} mean_p_truth={statistics.mean(r['p_truth'] for r in rs):.2f} wrong={[(r['truth'], r['pred'], r['p']) for r in rs if r['pred'] != r['truth']]}")
