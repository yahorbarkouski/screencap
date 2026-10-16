#!/usr/bin/env python3 -I
"""Prints "previous<TAB>next" frame paths for consecutive kept focused frames of one place, for crop_ocr_bench.

    python3 -I crop_pairs.py --store store-copy.sqlite --frames ~/Library/Application\\ Support/com.screencaping.app \\
        --kind view --max-gap 120 --limit 60 > pairs.tsv

--kind view keeps pairs with the same context key (app, title, site, path), the case of extra frames inside one view;
--kind place keeps pairs of one app and site whose title or path changed.
"""

import argparse
import os
import random
import re
import sqlite3


def stable(title):
    return re.sub(r"^\(\d+\)\s*", "", title or "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", required=True)
    ap.add_argument("--frames", required=True)
    ap.add_argument("--kind", choices=("view", "place"), default="view")
    ap.add_argument("--max-gap", type=float, default=120)
    ap.add_argument("--limit", type=int, default=60)
    args = ap.parse_args()
    rows = sqlite3.connect(args.store).execute(
        "select at, bundleID, windowTitle, urlHost, urlPath, framePath from capture "
        "where isFocusedDisplay = 1 and framePath is not null order by at").fetchall()
    pairs = []
    for a, b in zip(rows, rows[1:]):
        if b[0] - a[0] > args.max_gap:
            continue
        same_place = a[1] == b[1] and a[3] == b[3]
        same_view = same_place and stable(a[2]) == stable(b[2]) and a[4] == b[4]
        if (args.kind == "view" and same_view) or (args.kind == "place" and same_place and not same_view):
            pa, pb = os.path.join(args.frames, a[5]), os.path.join(args.frames, b[5])
            if os.path.exists(pa) and os.path.exists(pb):
                pairs.append((pa, pb))
    random.Random(7).shuffle(pairs)
    for pa, pb in pairs[: args.limit]:
        print(f"{pa}\t{pb}")


if __name__ == "__main__":
    main()
