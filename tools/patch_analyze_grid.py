"""One-off patch: analyze.py --grid <json> uses a given beat grid (e.g. from a SPRED score) instead of beat tracking."""
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "bridge" / "server" / "analyze.py"
s = p.read_text(encoding="utf-8")


def rep(old, new):
    global s
    assert s.count(old) == 1, f"anchor x{s.count(old)}: {old[:60]!r}"
    s = s.replace(old, new)


rep('''    ap.add_argument("--spb", type=int, default=4)
    args = ap.parse_args()''', '''    ap.add_argument("--spb", type=int, default=4)
    ap.add_argument("--grid", default=None, help="JSON with stepsPerBeat, tempo, meter, columnCount, offsetMs (skip beat tracking)")
    args = ap.parse_args()''')

rep('''    # 2. beats and bars
    from beat_this.inference import Audio2Beats
    a2b = Audio2Beats(checkpoint_path="final0", device=device, dbn=False)
    beats, downbeats = a2b(mix, sr)
    del a2b
    g = build_grid(beats, downbeats, duration, spb)''', '''    # 2. beats and bars
    if args.grid:
        g = grid_from_file(args.grid)
        spb = g["spb"]
        beats = g["beat_times"]
    else:
        from beat_this.inference import Audio2Beats
        a2b = Audio2Beats(checkpoint_path="final0", device=device, dbn=False)
        beats, downbeats = a2b(mix, sr)
        del a2b
        g = build_grid(beats, downbeats, duration, spb)''')

rep('''# ---------------------------------------------------------------- melody notes from a pitch track''', '''def grid_from_file(path):
    """Beat grid from a score's own tempo map. Video time of column c = t0 + time(c), t0 = -offsetMs/1000."""
    d = json.load(open(path, encoding="utf-8"))
    spb = int(d.get("stepsPerBeat", 4))
    tempo = sorted(d["tempo"], key=lambda e: e["col"])
    meter = sorted(d["meter"], key=lambda e: e["col"])
    tm = TimeMap(tempo, spb)
    t0 = -float(d.get("offsetMs", 0)) / 1000
    n_beats = int(math.ceil(d["columnCount"] / spb))
    beat_times = np.array([t0 + tm.col_to_time(k * spb) for k in range(n_beats + 1)])
    bar_starts, col, mi = [], 0, 0
    while col < d["columnCount"]:
        while mi + 1 < len(meter) and meter[mi + 1]["col"] <= col:
            mi += 1
        ln = int(meter[mi]["beats"]) * spb
        nxt = meter[mi + 1]["col"] if mi + 1 < len(meter) else None
        if nxt is not None and col < nxt < col + ln:
            ln = nxt - col
        bar_starts.append(col // spb)
        col += ln
    beats_per_bar = int(np.bincount([int(m["beats"]) for m in meter]).argmax()) if meter else 4
    return {"beat_times": beat_times, "t0": t0, "tempo": tempo, "meter": meter, "bar_starts": bar_starts,
            "constant": len(tempo) == 1, "resid_p95_ms": 0.0, "resid_max_ms": 0.0, "beats_per_bar": beats_per_bar,
            "irregular_bars": 0, "column_count": int(d["columnCount"]), "bpm_estimate": tempo[0]["bpm"], "spb": spb}


# ---------------------------------------------------------------- melody notes from a pitch track''')

p.write_text(s, encoding="utf-8")
print("ok")
