"""Smoke test: one text-only noul question per endpoint/model."""
import json, sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from probe_lib import openrouter, perplexity, typesafe
state = "App: Code editor. Window: weather-widget — src/forecast/merge.ts. OCR: export function mergeForecasts(...) ... Tests: 1 failed (handles DST shift)."
q = {"coding": {"type": "noul", "instructions": "The person is writing or debugging software in this capture."}}
for m in ["perplexity/pplx-decider-v1.1-27b", "openai/gpt-6-luna-decisions", "cloudflare/clef", "cloudflare/clef-flash", "cloudflare/clef-omni", "inception/mercury-decide", "typesafe/jev-1.13"]:
    r = openrouter(m, state, q, "smoke")
    print(m, r["status"], r["ms"], r["usage"], json.dumps(r["answers"])[:160], r["error"])
r = perplexity("pplx-decider-v1.1-27b", state, q, "smoke-pplx-direct"); print("pplx direct", r["status"], r["ms"], r["usage"], r["answers"], r["error"])
r = typesafe(state, q, "smoke-jev-direct"); print("jev direct", r["status"], r["ms"], r["usage"], r["answers"], r["error"], r["resp_model"])
