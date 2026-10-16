"""Backup volume and cost model for Screencap. Pure arithmetic; inputs are from the benchmarks.

Run: python3 -I backup_cost.py
"""

ACTIVE_HOURS = 8.4          # mean tracked hours on the 13 full days in the old app's last 35 days
ACTIVE_DAYS = 26            # per month, deliberately high
SWITCH_CAPTURES = 150       # per day, capture-on-context-switch with debounce (65/day seen at 2-min sampling)
DEDUPE = 0.30               # share of frames skipped as unchanged (old app: 16% merged .. 37% identical 8x8 dHash)
FRAME_KB = {"1x HEIC q0.6": 137, "1280w WebP (old app)": 68, "native HEIC q0.6": 372}

PRICES = {  # $/GB-month, $ per 1k PUT, $/GB egress, free GB, min days, min object KB, retrieval $/GB
    "S3 Standard": dict(gb=0.023, put=0.005, egress=0.09, free_gb=0, min_days=0, min_kb=0, retr=0),
    "S3 Glacier IR": dict(gb=0.004, put=0.02, egress=0.09, free_gb=0, min_days=90, min_kb=128, retr=0.03),
    "R2 Standard": dict(gb=0.015, put=0.0045, egress=0, free_gb=10, min_days=0, min_kb=0, retr=0),
    "B2": dict(gb=0.00695, put=0, egress=0, free_gb=10, min_days=0, min_kb=0, retr=0),
    "Wasabi": dict(gb=0.00799, put=0, egress=0, free_gb=0, min_days=90, min_kb=0, retr=0, min_bill_gb=1000),
}


def frames_per_day(cadence_min: float) -> float:
    return ACTIVE_HOURS * 60 / cadence_min + SWITCH_CAPTURES


def month_gb(cadence_min: float, kb: float, dedupe: float) -> float:
    return frames_per_day(cadence_min) * (1 - dedupe) * kb * ACTIVE_DAYS / 1024 / 1024


print("frames/day: 1-min %.0f, 2-min %.0f" % (frames_per_day(1), frames_per_day(2)))
print("\nGB per month uploaded")
for fmt_name, kb in FRAME_KB.items():
    for cad in (1, 2):
        print(f"  {fmt_name:22s} {cad}-min: {month_gb(cad, kb, 0):5.2f} GB raw, {month_gb(cad, kb, DEDUPE):5.2f} GB deduped")

print("\nMonthly bill after 12 months of 1-min, 1x HEIC, deduped (stored GB grows linearly, nothing deleted)")
gb_m = month_gb(1, FRAME_KB["1x HEIC q0.6"], DEDUPE)
stored = gb_m * 12
objects_per_month = frames_per_day(1) * (1 - DEDUPE) * ACTIVE_DAYS
for name, p in PRICES.items():
    billable = max(stored - p["free_gb"], 0)
    billable = max(billable, p.get("min_bill_gb", 0))
    storage = billable * p["gb"]
    per_frame_puts = objects_per_month / 1000 * p["put"]
    if name == "R2 Standard":
        per_frame_puts = 0 if objects_per_month < 1_000_000 else per_frame_puts  # 1M class A free
    hourly_pack_puts = ACTIVE_HOURS * ACTIVE_DAYS / 1000 * p["put"]
    restore = max(stored - (100 if name.startswith("S3") else 0), 0) * p["egress"] + stored * p["retr"]
    small_obj_note = ""
    if p["min_kb"] and FRAME_KB["1x HEIC q0.6"] < p["min_kb"] * 1.5:
        small_obj_note = " (per-frame objects near/below 128 KB min billable size)"
    print(f"  {name:14s} stored {stored:5.1f} GB: storage ${storage:5.2f}/mo, PUTs per-frame ${per_frame_puts:5.3f}/mo"
          f" vs hourly packs ${hourly_pack_puts:6.4f}/mo; full restore ${restore:5.2f}{small_obj_note}")
print(f"\nobjects/month per-frame: {objects_per_month:,.0f}; hourly packs: {ACTIVE_HOURS * ACTIVE_DAYS:.0f}")
print(f"S3 Intelligent-Tiering monitoring on per-frame objects after 12 months: "
      f"${objects_per_month * 12 / 1000 * 0.0025:.2f}/mo (objects <128 KB are never tiered)")
