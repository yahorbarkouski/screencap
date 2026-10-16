"""Option/question limits and many-option latency. Synthetic."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from probe_lib import openrouter
state = {"activity": "Code editor weather-widget src/forecast/merge.ts; npm test shows 'handles DST shift' failing"}
def choice(n):
    crit = {f"t{i:03d}": f"Invented thread number {i}: hobby or project topic #{i}" for i in range(n - 1)}
    crit["weather"] = "weather-widget side project: DST bug in forecast merging"
    return {"thread": {"type": "choice", "instructions": "Which thread does this activity belong to?", "criteria": crit}}
def nouls(n):
    return {f"q{i}": {"type": "noul", "instructions": f"The activity concerns topic number {i}."} for i in range(n)}
for m in ["perplexity/pplx-decider-v1.1-27b", "openai/gpt-6-luna-decisions", "typesafe/jev-1.13", "inception/mercury-decide", "cloudflare/clef-flash"]:
    for label, q in [("choice200", choice(200)), ("choice256", choice(256)), ("noul129", nouls(129) if m != "perplexity/pplx-decider-v1.1-27b" else nouls(129))]:
        if label == "noul129" and m == "perplexity/pplx-decider-v1.1-27b":
            pass
        r = openrouter(m, state, q, f"limit-{label}")
        a = (r["answers"] or {}).get("thread") if r["status"] == 200 else None
        print(json.dumps({"model": m, "probe": label, "status": r["status"], "ms": r["ms"], "tokens": r["usage"].get("input_tokens"), "cost": r["cost"],
                          "choice": a and a.get("choice"), "p": a and round(a["probabilities"][a["choice"]], 3), "n_answers": len(r["answers"] or {}), "err": r["error"] and str(r["error"].get("message"))[:160]}))
