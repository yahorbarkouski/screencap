"""Thread linkage on an invented library of 40 threads and 16 invented activities (synthetic; no real data).
Retrieval: OpenRouter embeddings (qwen3-embedding-8b) over thread cards. Decision forms:
  C8  = one Choice over top-8 retrieved threads + NEW;  C40 = one Choice over all 40 + NEW;  P8 = eight noul pair questions in one call."""
import json, os, sys, time, statistics, requests
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from probe_lib import openrouter, LOG, UA
HERE = os.path.dirname(__file__)
THREADS = {
 "T01": "weather-widget: personal TypeScript side project (forecast merging, DST bugs), repo weather-widget, GitHub, code editor",
 "T02": "budget-tracker at Acme: day-job React + Postgres app, repo acme/budget-tracker, charts and reports",
 "T03": "Learning Rust: The Rust Book, Rust playground, exercism exercises, tutorials",
 "T04": "Watching chess content: YouTube chess videos and Twitch chess streams",
 "T05": "Baking sourdough: starter feeding, recipes, buying flour",
 "T06": "Lisbon trip planning: flights, hotels, itinerary for November",
 "T07": "Interview prep for Globex: system design notes, algorithm practice",
 "T08": "Family chat: messages with Mom and Dad, sharing photos",
 "T09": "Household bills: electricity, internet, rent payments and receipts",
 "T10": "Fantasy football league: lineups, waiver wire, league chat",
 "T11": "Acme Q4 planning: roadmap drafts, OKRs, planning docs",
 "T12": "Acme weekly product sync: recurring Zoom meeting and notes",
 "T13": "Home gym research: comparing racks, dumbbells, reviews",
 "T14": "Reading the sci-fi novel 'The Long Orbit' on Kindle",
 "T15": "Learning Spanish: Duolingo lessons and Spanish podcasts",
 "T16": "Apartment renovation: bathroom tiles, contractor emails, quotes",
 "T17": "Tax return 2025: forms, receipts, emails with accountant",
 "T18": "Watching StarCraft II tournaments and pro streams",
 "T19": "Podcast editing side gig: Audacity edits, show notes for client",
 "T20": "Photo editing: Lightroom edits of travel photos",
 "T21": "Acme on-call: incident pages, Grafana dashboards, postmortems",
 "T22": "Personal finance: brokerage statements, budgeting spreadsheet",
 "T23": "Car maintenance: service booking, tire comparison",
 "T24": "Open-source contribution to a Markdown parser library",
 "T25": "Learning piano: lesson videos, sheet music",
 "T26": "News reading: daily headlines and long-form articles",
 "T27": "Acme hiring: reviewing candidate resumes and interview scorecards",
 "T28": "Wedding gift shopping for a friend's wedding",
 "T29": "Gardening: tomato plants, balcony planters",
 "T30": "Running training: Strava runs, half-marathon plan",
 "T31": "Watching a TV series on Netflix: 'Harbor Lights'",
 "T32": "Writing a personal blog post about productivity tools",
 "T33": "Acme customer support escalations in Zendesk",
 "T34": "Board game night planning with friends",
 "T35": "Learning machine learning: online course on transformers",
 "T36": "Medical appointments: booking dentist and GP visits",
 "T37": "Smart home setup: Home Assistant automations",
 "T38": "Acme design reviews in Figma for the mobile app",
 "T39": "Video games: playing an indie roguelike on Steam",
 "T40": "Volunteering: organizing a community cleanup event",
}
QUERIES = [
 ("Q01", "T01", "Chrome stackoverflow.com 'Intl.DateTimeFormat returns wrong offset after DST change'; then Code editor weather-widget src/forecast/fetch.ts"),
 ("Q02", "T02", "Code editor acme-budget-tracker src/reports/MonthlyChart.tsx; Terminal psql budget_dev 'SELECT category, sum(amount)'"),
 ("Q03", "T03", "Chrome exercism.org Rust track: 'Lifetimes' exercise, failing test output"),
 ("Q04", "T04", "Twitch 'GM blitz marathon — 3+0 arena' live stream, chat scrolling"),
 ("Q05", "T05", "Chrome bakers-forum.example 'rye starter hydration too wet?'"),
 ("Q06", "T06", "Chrome booking.example 'Hotels in Alfama, 12–16 Nov'"),
 ("Q07", "T07", "Chrome leetcode.example 'LRU Cache — Medium'; Notes 'Globex onsite: system design checklist'"),
 ("Q08", "T08", "WhatsApp chat 'Dad': 'happy birthday! here are the photos from the lake'"),
 ("Q09", "T09", "Chrome isp.example.com 'Pay invoice — October internet service'"),
 ("Q10", "T11", "Google Sheets 'Acme Q4 OKRs' editing key results"),
 ("Q11", "T14", "Kindle 'The Long Orbit — Chapter 14: Perihelion'"),
 ("Q12", "T16", "Mail 'Re: bathroom tile quote — revised' from contractor"),
 ("Q13", "NEW", "Chrome 'Adopting a rescue dog — shelters near me', petfinder.example listings"),
 ("Q14", "NEW", "GarageBand 'song idea 3' recording a guitar track"),
 ("Q15", "NEW", "Chrome 'Best electric bikes 2026 — commuter comparison'"),
 ("Q16", "NEW", "Code editor 'mandelbrot-shader' repo, GLSL fragment shader, WebGL canvas preview"),
]
MODELS = ["typesafe/jev-1.13", "perplexity/pplx-decider-v1.1-27b", "openai/gpt-6-luna-decisions", "inception/mercury-decide", "cloudflare/clef-flash"]

def embed(texts, model="qwen/qwen3-embedding-8b"):
    t0 = time.perf_counter()
    r = requests.post("https://openrouter.ai/api/v1/embeddings", headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}", "User-Agent": UA},
                      json={"model": model, "input": texts}, timeout=60)
    j = r.json(); ms = (time.perf_counter() - t0) * 1000
    with open(LOG, "a") as f:
        f.write(json.dumps({"tag": "embed", "model": model, "status": r.status_code, "ms": round(ms, 1), "usage": j.get("usage"), "cost": (j.get("usage") or {}).get("cost")}) + "\n")
    v = np.array([d["embedding"] for d in j["data"]], dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True), ms

tids = list(THREADS)
tv, ms1 = embed([THREADS[t] for t in tids])
qv, ms2 = embed([q[2] for q in QUERIES])
sims = qv @ tv.T
results = {"embed_ms": [ms1, ms2], "retrieval": [], "decisions": []}
for i, (qid, truth, text) in enumerate(QUERIES):
    order = [tids[j] for j in np.argsort(-sims[i])]
    results["retrieval"].append({"q": qid, "truth": truth, "rank": order.index(truth) + 1 if truth != "NEW" else None, "top1_sim": float(sims[i].max()),
                                 "truth_sim": float(sims[i][tids.index(truth)]) if truth != "NEW" else None, "top8": order[:8]})
    top8 = order[:8]
    state = {"activity": text}
    instr = ("Which existing thread does this activity belong to? A thread is one ongoing project, topic or pastime in the person's life. "
             "Pick NEW if none of the listed threads is the same project, topic or pastime.")
    def choice(cands):
        crit = {t: THREADS[t] for t in cands}; crit["NEW"] = "None of the listed threads; this starts a new thread"
        return {"thread": {"type": "choice", "instructions": instr, "criteria": crit}}
    for m in MODELS:
        for form, q in (("C8", choice(top8)), ("C40", choice(tids)),
                        ("P8", {t: {"type": "noul", "instructions": f"This activity belongs to the same ongoing project, topic or pastime as the thread: {THREADS[t]}"} for t in top8})):
            r = openrouter(m, state, q, f"thread-{form}")
            rec = {"q": qid, "truth": truth, "model": m, "form": form, "ms": r["ms"], "tokens": r["usage"].get("input_tokens"), "cost": r["cost"], "err": r["error"]}
            if r["status"] == 200:
                if form.startswith("C"):
                    a = r["answers"]["thread"]; rec.update(pred=a["choice"], p_pred=a["probabilities"][a["choice"]], p_new=a["probabilities"].get("NEW"), confidence=a.get("confidence"))
                else:
                    ps = {t: r["answers"][t]["noul"] for t in top8}; best = max(ps, key=ps.get)
                    rec.update(pred=best if ps[best] >= 0.5 else "NEW", p_pred=ps[best], pair_probs=ps)
            results["decisions"].append(rec)
json.dump(results, open(os.path.join(HERE, "p4_threads_results.json"), "w"), indent=1)
print("recall@1", sum(r["rank"] == 1 for r in results["retrieval"] if r["rank"]), "recall@8", sum(r["rank"] <= 8 for r in results["retrieval"] if r["rank"]), "of 12; ranks", [r["rank"] for r in results["retrieval"]])
print("NEW top1 sims", [round(r["top1_sim"], 3) for r in results["retrieval"] if r["truth"] == "NEW"], "linked truth sims", [round(r["truth_sim"], 3) for r in results["retrieval"] if r["truth_sim"]])
for m in MODELS:
    for form in ("C8", "C40", "P8"):
        rows = [d for d in results["decisions"] if d["model"] == m and d["form"] == form and "pred" in d]
        acc = sum(d["pred"] == d["truth"] for d in rows)
        wrong = [(d["q"], d["pred"], round(d["p_pred"], 2)) for d in rows if d["pred"] != d["truth"]]
        print(f"{m:34s} {form:3s} acc={acc}/{len(rows)} median_ms={statistics.median(d['ms'] for d in rows):.0f} mean_tokens={statistics.mean(d['tokens'] for d in rows):.0f} wrong={wrong}")
