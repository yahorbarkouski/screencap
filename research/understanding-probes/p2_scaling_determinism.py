"""Questions-per-call scaling (tokens billed, latency) and repeat-call determinism. Synthetic inputs."""
import json, os, sys, statistics
sys.path.insert(0, os.path.dirname(__file__))
from probe_lib import openrouter, img_part
IMG = os.path.join(os.path.dirname(__file__), "img")
text = ("Capture 14:02:10. App: Code editor. Window: weather-widget — src/forecast/merge.ts. Workspace: weather-widget. "
        "Previous capture 14:00:05: same app, window merge.test.ts. OCR excerpt: npm test -- merge; 1 failed (handles DST shift).")
activities = ["writing or debugging code", "reading documentation", "watching a video for fun", "chatting with a friend", "paying a bill", "taking an online course",
              "reviewing a pull request", "writing an email to a colleague", "shopping online", "reading news", "playing a game", "planning a trip",
              "editing a spreadsheet", "designing a user interface", "attending a video meeting", "searching for a recipe"]
def qs(n):
    out = {}
    for i in range(n):
        a = activities[i % len(activities)]
        out[f"q{i}"] = {"type": "noul", "instructions": f"In this capture the person is {a}." + (f" (variant {i // len(activities)})" if i >= len(activities) else "")}
    return out
cat = {"category": {"type": "choice", "instructions": "What is the purpose of the activity shown?",
       "criteria": {"Work": "professional tasks, including coding, documents, meetings and team communication", "Study": "learning for its own sake",
                    "Leisure": "entertainment, games, recreational browsing, passive media", "Chores": "personal administration, bills, shopping",
                    "Social": "personal communication", "Unknown": "purpose cannot be determined"}}}
res = []
for m, with_img in [("perplexity/pplx-decider-v1.1-27b", True), ("openai/gpt-6-luna-decisions", True), ("cloudflare/clef", True), ("inception/mercury-decide", True), ("typesafe/jev-1.13", False)]:
    state = [text, img_part(os.path.join(IMG, "ide_1024.jpg"))] if with_img else text
    for n in (1, 4, 16, 64):
        r = openrouter(m, state, qs(n), f"scale-{n}")
        res.append({"model": m, "n": n, "tokens": r["usage"].get("input_tokens"), "ms": r["ms"], "cost": r["cost"], "status": r["status"], "err": r["error"]})
    # determinism: same 16 questions + category, 5 repeats
    q = {**qs(16), **cat}
    runs = [openrouter(m, state, q, "determinism") for _ in range(5)]
    vals = {}
    for r in runs:
        if r["status"] != 200: continue
        for k, a in r["answers"].items():
            v = a.get("noul") if a["type"] == "noul" else a.get("probabilities", {}).get("Work")
            vals.setdefault(k, []).append(v)
    spreads = {k: (max(v) - min(v)) for k, v in vals.items() if len(v) > 1 and None not in v}
    res.append({"model": m, "determinism_runs": len([r for r in runs if r["status"] == 200]), "max_spread": max(spreads.values()) if spreads else None,
                "mean_spread": round(statistics.mean(spreads.values()), 4) if spreads else None,
                "category": [r["answers"]["category"]["choice"] for r in runs if r["status"] == 200],
                "p_work": [round(r["answers"]["category"]["probabilities"]["Work"], 4) for r in runs if r["status"] == 200],
                "ms": [r["ms"] for r in runs]})
for r in res: print(json.dumps(r))
