"""Check placed lyrics against what the speech recogniser heard: for syllables that both have (matched in order),
how far apart they are, line by line. A line far off from the recogniser means it sits on the wrong notes.

    python tools/lyric_check.py <sheet.uke.json> <asr.json> [--asr-shift N]
"""
import argparse
import json
import sys
from pathlib import Path


def lcs_pairs(a, b):
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            dp[i][j] = dp[i + 1][j + 1] + 1 if a[i] == b[j] else max(dp[i + 1][j], dp[i][j + 1])
    out, i, j = [], 0, 0
    while i < n and j < m:
        if a[i] == b[j]:
            out.append((i, j)); i += 1; j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("asr")
    ap.add_argument("--asr-scale", type=float, default=1.0, help="multiply the recogniser's columns (0.5 when the tempo was halved)")
    ap.add_argument("--asr-shift", type=int, default=0)
    a = ap.parse_args()
    s = json.loads(Path(a.sheet).read_text(encoding="utf-8"))
    spb = s["stepsPerBeat"]
    lyr = sorted(s["lyrics"], key=lambda e: e["col"])
    heard = [{"col": x["col"] * a.asr_scale + a.asr_shift, "text": x["text"]}
             for line in json.loads(Path(a.asr).read_text(encoding="utf-8"))["lines"] for x in line.get("syllables", [])]
    pairs = lcs_pairs([e["text"] for e in lyr], [h["text"] for h in heard])
    beats = [(lyr[i]["col"] - heard[j]["col"]) / spb for i, j in pairs]
    print(f"{s['meta'].get('title')}: 맞춘 음절 {len(pairs)}/{len(lyr)}, 차이(박) 중앙값 {sorted(beats)[len(beats) // 2]:+.2f}, "
          f"1박 넘게 차이 {sum(abs(x) > 1 for x in beats)}곳")
    # runs of placed syllables that differ by more than a beat from the recogniser
    run = []
    for (i, j), d in zip(pairs, beats):
        if abs(d) > 1:
            run.append((i, d))
        elif run:
            if len(run) >= 3:
                txt = "".join(lyr[k]["text"] for k, _ in run)
                print(f"  {txt[:30]:30} {run[0][1]:+.1f}박 (마디 {lyr[run[0][0]]['col'] // (4 * spb)} 근처)")
            run = []


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
