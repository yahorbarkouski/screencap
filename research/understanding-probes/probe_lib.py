"""Tiny client for decision endpoints. Synthetic inputs only. Logs every call (no keys) to calls.jsonl."""
import base64, json, os, time, requests

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "calls.jsonl")
UA = "Mozilla/5.0 (compatible; decision-probe/1.0)"
BUDGET_USD = 0.80

def spent():
    if not os.path.exists(LOG):
        return 0.0
    total = 0.0
    for line in open(LOG):
        r = json.loads(line)
        total += float(r.get("cost") or 0)
    return total

def img_part(path):
    b64 = base64.b64encode(open(path, "rb").read()).decode()
    return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}

def _post(url, key_env, body, tag, timeout=90):
    if spent() > BUDGET_USD:
        raise SystemExit(f"budget exceeded: {spent():.4f}")
    key = os.environ[key_env]
    t0 = time.perf_counter()
    r = requests.post(url, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": UA}, data=json.dumps(body), timeout=timeout)
    ms = (time.perf_counter() - t0) * 1000
    try:
        j = r.json()
    except Exception:
        j = {"raw": r.text[:500]}
    usage = j.get("usage") or {}
    cost = usage.get("cost")
    if cost is None and url.startswith("https://api.perplexity.ai"):
        cost = (usage.get("input_tokens") or 0) * 0.02e-6
    if cost is None and url.startswith("https://api.typesafe.ai"):
        cost = (usage.get("input_tokens") or 0) * 0.042e-6
    rec = {"tag": tag, "url": url, "model": body.get("model"), "status": r.status_code, "ms": round(ms, 1),
           "usage": usage, "cost": cost, "n_questions": len(body.get("questions", {})),
           "answers": j.get("answers"), "error": j.get("error") if r.status_code >= 400 else None,
           "resp_model": j.get("model"), "provider": j.get("provider")}
    with open(LOG, "a") as f:
        f.write(json.dumps(rec) + "\n")
    return rec

def openrouter(model, state, questions, tag):
    return _post("https://openrouter.ai/api/alpha/decisions", "OPENROUTER_API_KEY", {"model": model, "state": state, "questions": questions}, tag)

def perplexity(model, state, questions, tag):
    return _post("https://api.perplexity.ai/v1/decisions", "PERPLEXITY_API_KEY", {"model": model, "state": state, "questions": questions}, tag)

def typesafe(state, questions, tag, model="jev-latest"):
    return _post("https://api.typesafe.ai/v1/systemone", "TYPESAFE_API_KEY", {"model": model, "state": state, "questions": questions}, tag)
