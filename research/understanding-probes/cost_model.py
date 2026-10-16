"""Cost per 1,000 captures for the candidate architectures. All inputs are stated assumptions; prices from the OpenRouter catalog (2026-10-14)."""
P = {"jev": 0.042e-6, "pplx": 0.02e-6, "luna_dec": 0.10e-6, "haiku_in": 0.10e-6, "haiku_out": 0.50e-6, "gpt5_in": 1.25e-6, "gpt5_out": 10e-6}
N = 1000                      # captures
CAP_PER_H = 30                # v1 data: ~30 captures per active hour at 2-min cadence
ACT = 150                     # activities per 1,000 captures (~13 min each; assumption)
NEW_THREADS = 30              # thread births per 1,000 captures (assumption)
LINE = 90                     # tokens per capture line: metadata + OCR-diff excerpt
OPT = 35                      # tokens per thread option (name, description, evidence, corrections)
LIVE = 100                    # live threads offered as options
LINKS_PER_ACT = 2             # provisional link at 3 captures + final link at close
JEV_Q = 21                    # measured Jev tokens per extra question
IMG768 = 364                  # measured pplx image tokens at 768x480
def jev(tokens): return tokens * P["jev"]
# Boundary: window of 12 lines + rule + current-thread card, asked every 3 captures, 3 gap questions + 1 vision-gate question
bnd_calls = N / 3
bnd = bnd_calls * jev(12 * LINE + 120 + 60 + 4 * JEV_Q)
link_tokens = 600 + LIVE * OPT
link = LINKS_PER_ACT * ACT * jev(link_tokens)
cat = NEW_THREADS * jev(800)
name = (NEW_THREADS * 1.5) * (1500 * P["haiku_in"] + 30 * P["haiku_out"])
nightly = 5 * 20 * jev(500)
A = bnd + link + cat + name + nightly
# A+V: 30% of gaps and 30% of links re-asked with a 768px image on pplx (per-question billing)
vis = 0.3 * N * (12 * LINE + 180 + IMG768) * P["pplx"] + 0.3 * LINKS_PER_ACT * ACT * (link_tokens + IMG768) * P["pplx"]
B = N * jev(7 * LINE + LIVE * OPT) + bnd + cat + name + nightly
C = 0.25 * N * jev(1500) + name
D_planner = (N / 6) * ((1800 + 2000 + 300) * P["haiku_in"] + 300 * P["haiku_out"]) + link
v1 = N * (4000 * P["gpt5_in"] + 1000 * P["gpt5_out"])
rows = [("A decision cascade (text, Jev)", A), ("A+V (+ images on 30% via pplx 768px)", A + vis), ("B capture-level linking (Jev)", B),
        ("C embedding-first + gray-zone decisions", C), ("D Haiku 5.5 sequence planner + decision linking", D_planner),
        ("prior plan, measured (gpt-5.6-terra planner, mock)", 0.1053 / 356 * 1000), ("v1 estimate (GPT-5 vision per capture, 4k in / 1k out)", v1)]
print(f"components A: boundary ${bnd:.4f}  link ${link:.4f}  category ${cat:.4f}  naming ${name:.4f}  nightly ${nightly:.4f}  vision add-on ${vis:.4f}")
for k, v in rows:
    print(f"{k:58s} ${v:8.4f} per 1,000 captures   ${v / (N / CAP_PER_H):.5f} per active hour")
