#!/usr/bin/env python3 -I
"""Prints the Markdown tables of research/smart-capture.md from analyze.py's results.

    python3 -I report_tables.py results.json crop-view.jsonl crop-place.jsonl
"""

import json
import sys

import numpy as np

NAMED = ["P0 current", "P0b timer after last capture", "P1 typing pause", "P2 click settle", "P3 scroll stop",
         "P4 every view change", "P5 adaptive interval", "P6 all triggers", "P7 all triggers, capped",
         "P8 settled changes", "P9 settle 5 s", "P10 settle 10 s", "P11 view + settle, with switch",
         "P12 view + settle", "P13 dwell capture", "P14 dwell capture + place"]


def f(x, d=0):
    return "–" if x is None else f"{x:,.{d}f}"


def table(header, rows):
    print("| " + " | ".join(header) + " |")
    print("|" + "|".join("---" if i == 0 else "---:" for i in range(len(header))) + "|")
    for row in rows:
        print("| " + " | ".join(str(c) for c in row) + " |")
    print()


def main():
    r = json.load(open(sys.argv[1]))
    d = r["describe"]
    print(f"Window {d['window_hours']:.2f} h, active {d['active_hours']:.2f} h; "
          f"logger agrees with the app's own context at {r['validate']['place_agree_pct']:.0f}% (app and site) and "
          f"{r['validate']['view_agree_pct']:.0f}% (title and URL) of {r['validate']['captures']} captures.\n")
    print("## Input rates per active hour\n")
    table(["Input", "Events per active hour", "Active seconds with any"],
          [[k, f(d["per_active_hour"][k]), f(d["active_seconds_with"][k], 1) + "%"]
           for k in ("keys", "clicks", "scroll", "moves", "drags", "ax_title_events")]
          + [["none of these", "", f(d["active_seconds_with"]["no_input"], 1) + "%"]])
    tb = d["typing_bursts"]
    print(f"Typing bursts of 8+ keys: {tb['per_active_hour']:.1f}/h, median {f(tb['keys_median'])} keys over "
          f"{f(tb['seconds_median'])} s (p90 {f(tb['keys_p90'])} keys, {f(tb['seconds_p90'])} s); shorter bursts "
          f"{tb['short_per_active_hour']:.1f}/h.\n")
    table(["Level", "States per active hour", "Median s", "p90 s", "Under 5 s", "Under 60 s"],
          [[lvl, f(v["per_active_hour"]), f(v["median_s"], 1), f(v["p90_s"]), f(v["under_5s_pct"]) + "%",
            f(v["under_60s_pct"]) + "%"] for lvl, v in d["states"].items()])
    print("View changes (changes, of which without key/click/scroll in the 3 s before): "
          + ", ".join(f"{k} {v['changes']}/{v['without_input_3s']}" for k, v in d["view_changes"].items()) + "\n")
    print("Time by category: " + ", ".join(f"{k} {v}%" for k, v in d["time_by_category_pct"].items()) + "\n")

    print("## What today's captures missed\n")
    rc = r["real"]
    print(f"Real captures: {rc['captures_per_active_hour']:.0f} per active hour, {rc['by_trigger']}, "
          f"{rc['duplicates']} duplicates. App gaps over 90 s while active: {len(r['app_gaps'])}.\n")
    rows = []
    for key, v in r["real_misses"].items():
        rows.append([key, v["states"], v["missed"], f(v["missed_pct"]) + "%", f(v["missed_active_min_per_hour"], 1),
                     f(v["missed_median_s"]), f(v["missed_p90_s"]), f(v["missed_max_s"]),
                     ", ".join(f"{k} {n}" for k, n in sorted(v["missed_by_category"].items(), key=lambda x: -x[1]))])
    table(["States lasting", "States", "Never captured", "Share", "Their active min/h", "Median s", "p90 s", "Max s",
           "By category"], rows)
    g = r["real_gaps"]
    print(f"Gaps between real captures while active: median {f(g['median_s'])} s, p90 {f(g['p90_s'])} s, max "
          f"{f(g['max_s'])} s; {g['over_75s']} of {g['intervals']} over 75 s, {g['over_75s_switch_then_timer']} of them "
          f"a switch capture followed by a timer capture.\n")
    h = r["long_missed_views_in_holes"]
    print(f"Missed views of 30 s or more: {h['missed']}, of which inside a gap of over 75 s: {h['inside_gap_over_75s']}.\n")
    t = r["typing_vs_real"]
    print(f"Typing bursts: {t['view_changed_within_1_5s']} of {t['bursts']} ended in a view change within 1.5 s; "
          f"{t['stayed_3s']} stayed 3 s or more in the same view, {t['stayed_3s_captured']} of them captured there.\n")
    print(f"Typing bursts (8+ keys): {t['bursts']}; a capture after the burst and before the view changed for "
          f"{t['captured_before_view_change_pct']:.0f}%; next capture within 5/15/30/60 s: "
          + "/".join(f(t["next_capture_within"][k]) for k in ("5s", "15s", "30s", "60s")) + "%; median "
          f"{f(t['median_next_capture_s'])} s.\n")
    rows = []
    for name, key in (("Click, then no input", "clicks_vs_real"), ("Scroll of 10+ events, then pause", "scrolls_vs_real")):
        for k, v in r[key].items():
            rows.append([name, k.split(">=")[1], f(v["moments_per_active_hour"]), f(v["captured_pct"]) + "%"])
    for k, v in r["epochs_vs_real"].items():
        rows.append(["Quiet screen (no key, click, scroll, view change)", k.lstrip(">="), f(v["per_active_hour"]),
                     f(v["captured_pct"]) + "%"])
    table(["Moment", "Lasting at least", "Per active hour", "Captured"], rows)
    b = r["between_real_captures"]
    print(f"Between consecutive captures (median gap {f(b['median_gap_s'])} s, {b['intervals']} intervals): "
          f"{f(b['with_unseen_view_pct'])}% held a view of 5+ s that began and ended unseen "
          f"({f(b['unseen_views_per_active_hour'])}/h); {f(b['with_unseen_epoch_pct'])}% held an unseen quiet screen "
          f"of 5+ s ({f(b['unseen_epochs_per_active_hour'])}/h, p90 {f(b['unseen_epochs_p90'])} per interval).\n")
    print("Dedupe calibration: " + json.dumps(r["dedupe_calibration"]) + "\n")
    p0 = r["simulations"]["P0 current"]["replay_check"]
    print(f"Simulator check (P0 replayed with the app's restarts): {p0['replay_captures']} simulated vs "
          f"{p0['real_captures']} real; timer within 2 s {p0['timer_within_2s_pct']:.0f}%, switch within 2/5 s "
          f"{p0['switch_within_2s_pct']:.0f}/{p0['switch_within_5s_pct']:.0f}%.\n")

    print("## Policies: coverage\n")
    rows = []
    for name in NAMED:
        v = r["simulations"][name]
        c = v["coverage"]
        rows.append([name, f(v["captures_per_active_hour"]), f(v["kept_per_active_hour"]),
                     f(c["place"]["captured_pct"]), f(c["place10"]["captured_pct"]), f(c["view"]["captured_pct"]),
                     f(c["view10"]["captured_pct"]),
                     f(c["view30"]["captured_pct"]), f(c["view"]["missed_min_per_hour"], 1),
                     f(c["typing"]["captured_pct"]), f(c["click"]["captured_pct"]), f(c["scroll"]["captured_pct"]),
                     f(c["epochs10"]["captured_pct"])])
    table(["Policy", "Captures/h", "Kept/h", "Places 5 s+", "Places 10 s+", "Views 5 s+", "Views 10 s+",
           "Views 30 s+", "Missed view min/h", "Typing that stayed", "Click 3 s+", "Scroll 3 s+", "Quiet 10 s+"], rows)
    n = r["simulations"]["P0 current"]["coverage"]["typing"]["bursts"]
    print(f"Typing that stayed: {n} bursts.\n")

    print("## Policies: model money\n")
    rows = []
    for name in NAMED:
        v = r["simulations"][name]
        A, B = v["price_A_all_questions"], v["price_B_evidence"]
        rows.append([name, f(A["questions_h"]), f"${A['model_usd_h']:.4f}", f"${A['model_usd_day']:.3f}",
                     f"${A['model_usd_month']:.2f}", f(B["questions_h"]), f"${B['model_usd_h']:.4f}",
                     f"${B['model_usd_day']:.3f}", f"${B['model_usd_month']:.2f}"])
    table(["Policy", "Questions/h A", "A $/h", "A $/day", "A $/month", "Questions/h B", "B $/h", "B $/day",
           "B $/month"], rows)

    print("## Policies: CPU and storage\n")
    rows = []
    for name in NAMED:
        v = r["simulations"][name]
        A, B, C = v["price_A_all_questions"], v["price_B_evidence"], v["price_C_evidence_crop"]
        D = v["price_D_evidence_no_ocr"]
        rows.append([name, f(v["kept_per_active_hour"]), f(A["cpu_pct"], 2), f(B["cpu_pct"], 2), f(C["cpu_pct"], 2),
                     f(D["cpu_pct"], 2), f(A["gb_day"] * 1000), f(A["gb_month"], 1), f(A["local_gb_90_days"], 1),
                     f"${A['r2_usd_month_per_month_kept']:.3f}", f"${A['r2_usd_month_after_year']:.2f}"])
    print("OCR CPU per frame (0.288 s in the measured hour) at which each design meets the 1% budget:\n")
    table(["Policy", "A", "B", "C", "D"], [[name] + [f(r["simulations"][name][k]["ocr_s_per_frame_to_fit"], 2) + " s"
          for k in ("price_A_all_questions", "price_B_evidence", "price_C_evidence_crop", "price_D_evidence_no_ocr")]
          for name in NAMED])
    table(["Policy", "Kept/h", "CPU % A", "CPU % B", "CPU % C", "CPU % D", "MB/day", "GB/month", "Local GB, 90 days",
           "R2 $/month per month kept", "R2 $/month after 12 months"], rows)

    print("## Sweep\n")
    rows = []
    for name, v in r["simulations"].items():
        if not name.startswith("sweep"):
            continue
        c = v["coverage"]
        rows.append([name[6:], f(v["kept_per_active_hour"]), f(c["place10"]["captured_pct"]),
                     f(c["view10"]["captured_pct"]), f(c["view30"]["captured_pct"]), f(c["epochs10"]["captured_pct"]),
                     f(v["price_B_evidence"]["cpu_pct"], 2), f(v["price_C_evidence_crop"]["cpu_pct"], 2)])
    table(["Variant", "Kept/h", "Places 10 s+", "Views 10 s+", "Views 30 s+", "Quiet 10 s+", "CPU % B", "CPU % C"], rows)

    if len(sys.argv) > 3:
        print("## Changed-region OCR bench\n")
        rows = []
        for label, path in (("same view", sys.argv[2]), ("same site, new title or path", sys.argv[3])):
            x = [json.loads(line) for line in open(path)]
            area = np.array([e["area"] for e in x])
            full = np.array([e["full_cpu_ms"] for e in x])
            crop = np.array([e["crop_cpu_ms"] for e in x])
            rec = np.array([e["recall"] for e in x])
            prec = np.array([e["precision"] for e in x])
            prev = np.array([e["previous_recall"] for e in x])
            rows.append([label, len(x), f(100 * np.median(area)) + "%", f(np.median(full)), f(100 * crop.sum() / full.sum()) + "%",
                         f(100 * np.median(rec)) + "% / " + f(100 * np.percentile(rec, 10)) + "%",
                         f(100 * np.median(prec)) + "%", f(100 * np.median(prev)) + "%"])
        table(["Pair", "Pairs", "Changed area (median)", "Full OCR CPU ms (median)", "Crop CPU vs full",
               "Words recovered (median / p10)", "Precision (median)", "Previous frame's text alone"], rows)


if __name__ == "__main__":
    main()
