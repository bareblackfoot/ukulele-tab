"""Put correct lyrics on a sheet and rebuild its sung melody so every syllable starts its own note at the moment
it is sung in the recording.

    python tools/relyric.py <sheet.uke.json> <lyrics.txt> <check dir> [--asr <asr.json>] [--keep-melody] [--dry]

  sheet       a library sheet (ukulele-sheet v1) with youtube.videoId
  lyrics.txt  the lyrics as sung, one sung phrase per line (Korean syllables, or kana for Japanese)
  check dir   bridge/jobs/check-<videoId> after tools/sync_check.py: sync.json has the sung notes of the recording
  --asr       the speech recogniser's syllables (asr.json of the transcription) to guide where lines go
  --keep-melody  only move the lyrics onto the existing melody notes (for hand-made melodies such as SPRED ones)

The previous file goes to the library's 이전판 folder. Prints how far the syllables are from the sung starts.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TUNING = {"standard": [67, 60, 64, 69], "low-g": [55, 60, 64, 69]}


class TimeMap:
    def __init__(self, tempo, spb):
        self.segs = []
        t = 0.0
        ev = sorted(tempo, key=lambda e: e["col"])
        for i, e in enumerate(ev):
            spc = 60.0 / e["bpm"] / spb
            if i:
                t += (e["col"] - ev[i - 1]["col"]) * self.segs[-1][2]
            self.segs.append((e["col"], t, spc))

    def col_to_time(self, col):
        c, t, spc = [s for s in self.segs if s[0] <= col][-1] if col >= 0 else self.segs[0]
        return t + (col - c) * spc

    def time_to_col(self, t):
        c, t0, spc = [s for s in self.segs if s[1] <= t][-1] if t >= 0 else self.segs[0]
        return c + (t - t0) / spc


def node(script, payload):
    tmp = REPO / "bridge" / "logs" / f"relyric_{os.getpid()}.json"
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    try:
        r = subprocess.run(["node", str(REPO / "tools" / script), str(tmp)], capture_output=True, text=True, encoding="utf-8")
    finally:
        tmp.unlink(missing_ok=True)
    if r.returncode:
        raise SystemExit(r.stderr[-800:])
    return json.loads(r.stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("lyrics")
    ap.add_argument("check")
    ap.add_argument("--asr")
    ap.add_argument("--keep-melody", action="store_true")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    sheet_path = Path(a.sheet)
    s = json.loads(sheet_path.read_text(encoding="utf-8"))
    sync = json.loads((Path(a.check) / "sync.json").read_text(encoding="utf-8"))
    text = Path(a.lyrics).read_text(encoding="utf-8")
    spb = s["stepsPerBeat"]
    tm = TimeMap(s["tempo"], spb)
    off = (s.get("youtube") or {}).get("offsetMs", 0) / 1000.0
    to_col = lambda t: tm.time_to_col(t + off)        # video time -> column
    tuning = TUNING.get(s.get("tuning"), TUNING["standard"])
    capo = s.get("capo") or 0
    anchors = []
    if a.asr:
        for line in json.loads(Path(a.asr).read_text(encoding="utf-8"))["lines"]:
            anchors += [{"col": x["col"], "text": x["text"]} for x in line.get("syllables", [])]

    if a.keep_melody:
        mel = s["tracks"][0]["notes"]
        cand = [{"col": n["col"], "len": n["len"]} for n in mel]
    else:
        sung = [n for n in sync["sung_notes"] if n[2] - n[1] >= 0.06]
        cand = [{"col": to_col(st), "len": max(0.5, to_col(en) - to_col(st))} for _, st, en in sung]
    ev = node("align_lyrics.mjs", {"stepsPerBeat": spb, "notes": cand, "anchors": anchors, "text": text})

    if a.keep_melody:
        lyrics = [{"col": int(round(e["col"])), "text": e["text"]} for e in ev]
        melody = None
    else:
        # split sung notes where a syllable starts inside them; notes without a syllable stay (held vowels, runs)
        syl = sorted(((e["col"], e["text"]) for e in ev), key=lambda x: x[0])
        segs = []
        for p, st, en in sung:
            c0, c1 = to_col(st), to_col(en)
            cuts = [(c, t) for c, t in syl if c0 - 1e-6 <= c < c1 - 1e-6]
            starts = [(c0, None)] + cuts if not cuts or cuts[0][0] > c0 + 1e-6 else cuts
            for k, (c, t) in enumerate(starts):
                end = starts[k + 1][0] if k + 1 < len(starts) else c1
                segs.append([c, end, p, t])
        segs.sort(key=lambda x: x[0])
        # onto the step grid; a note never overlaps the next one, and every syllable keeps a note of its own
        notes, lyrics, last = [], [], -1
        for k, (c, end, p, t) in enumerate(segs):
            q0 = max(int(round(c)), last + 1) if t else int(round(c))
            nxt = int(round(segs[k + 1][0])) if k + 1 < len(segs) else 10 ** 9
            q1 = min(max(int(round(end)), q0 + 1), max(nxt, q0 + 1))
            if q0 <= last:
                if not t:
                    continue
                q0 = last + 1
            if not t and q1 - q0 < 1:
                continue
            if notes and notes[-1]["col"] + notes[-1]["len"] > q0:
                notes[-1]["len"] = max(1, q0 - notes[-1]["col"])
            notes.append({"col": q0, "len": max(1, q1 - q0), "midi": int(round(p))})
            if t:
                lyrics.append({"col": q0, "text": t})
            last = q0
        melody = notes

    # how far each syllable now is from the nearest sung start
    starts = sorted(to_col(x) for x in sync["sung_starts"])
    errs = []
    for l in lyrics:
        t = tm.col_to_time(l["col"]) - off
        d = min((abs(x - t) for x in sync["sung_starts"]), default=None)
        errs.append(d)
    good = [d for d in errs if d is not None]
    good.sort()
    print(f"{s['meta'].get('title')}: 가사 {len(lyrics)}음절, 부른 시작과 차이 중앙값 {1000 * good[len(good) // 2]:.0f}ms, "
          f"90% {1000 * good[int(len(good) * 0.9)]:.0f}ms, 60ms 안 {sum(d <= 0.06 for d in good) / len(good):.0%}")
    if a.dry:
        return

    if melody is None:
        s["lyrics"] = lyrics
        out = s
    else:
        # back to a transcription so the page's own fingering puts the new melody on strings
        def to_midi(t):
            return [{"col": n["col"], "len": n["len"], "midi": tuning[n["string"]] + capo + n["fret"]} for n in t["notes"]]
        tr = {"format": {"name": "ukulele-transcription", "version": 1},
              **{k: s[k] for k in ("meta", "stepsPerBeat", "columnCount", "tempo", "meter", "youtube", "chords", "sections", "strum", "capo") if k in s},
              "strums": s.get("strums", []), "lyrics": lyrics,
              "melody": [{"id": "melody", "name": s["tracks"][0].get("name", "노래 멜로디"), "notes": melody}] +
                        [{"id": t["id"], "name": t["name"], "notes": to_midi(t)} for t in s["tracks"][1:]]}
        tmp_in = REPO / "bridge" / "logs" / f"relyric_tr_{os.getpid()}.json"
        tmp_out = REPO / "bridge" / "logs" / f"relyric_out_{os.getpid()}.json"
        tmp_in.write_text(json.dumps(tr, ensure_ascii=False), encoding="utf-8")
        r = subprocess.run(["node", str(REPO / "tools" / "to_sheet.mjs"), str(tmp_in), str(tmp_out), s.get("tuning", "standard")],
                           capture_output=True, text=True, encoding="utf-8")
        tmp_in.unlink(missing_ok=True)
        if r.returncode:
            raise SystemExit(r.stderr[-800:])
        print("  ", r.stdout.strip())
        out = json.loads(tmp_out.read_text(encoding="utf-8"))
        tmp_out.unlink(missing_ok=True)
        out["chordShapes"] = s.get("chordShapes", {})
        for i, t in enumerate(s["tracks"][1:], start=1):   # keep the other tracks' visibility
            if i < len(out["tracks"]):
                out["tracks"][i]["hidden"], out["tracks"][i]["muted"] = t.get("hidden", False), t.get("muted", False)
    old = sheet_path.parent / "이전판"
    old.mkdir(exist_ok=True)
    os.replace(sheet_path, old / f"{sheet_path.stem}_{time.strftime('%Y%m%d-%H%M%S')}.json")
    sheet_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("   저장:", sheet_path.name)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
