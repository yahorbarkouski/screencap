"""Image token cost and latency by resolution for image-capable decision models (synthetic images)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from probe_lib import openrouter, img_part
IMG = os.path.join(os.path.dirname(__file__), "img")
MODELS = ["perplexity/pplx-decider-v1.1-27b", "openai/gpt-6-luna-decisions", "cloudflare/clef", "cloudflare/clef-flash", "cloudflare/clef-omni", "inception/mercury-decide"]
prefix = "Capture at 14:02. App: Code editor."
q = {"debugging": {"type": "noul", "instructions": "The screenshot shows a failing test that the person is likely investigating."}}
rows = []
for m in MODELS:
    base = openrouter(m, [prefix], q, "img-base")
    rows.append((m, "text", base["usage"].get("input_tokens"), base["ms"], base["status"], base["answers"]))
    for w in (512, 768, 1024, 1568, 2048):
        r = openrouter(m, [prefix, img_part(os.path.join(IMG, f"ide_{w}.jpg"))], q, f"img-{w}")
        rows.append((m, w, r["usage"].get("input_tokens"), r["ms"], r["status"], r["answers"] if r["status"] == 200 else r["error"]))
for row in rows:
    print(json.dumps(row)[:300])
