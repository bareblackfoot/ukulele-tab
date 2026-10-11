"""Ukulele sheets from SPRED (otamatone) scores.

    python D:/codes/ukulele-tab/bridge/spred_to_uke.py <spred.json> [...] --out <library folder> [--skip-existing]

The melody comes from the SPRED score (basic / optional / extra tracks). Chords and lyrics come from the
original recording (the score's YouTube video), analysed on the score's own beat grid so everything lines up
and the YouTube sync of the SPRED score keeps working.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
TRACK_NAMES = {"basic": ("melody", "멜로디"), "optional": ("optional", "반주 멜로디"), "extra": ("extra", "추가 멜로디")}


def spred_parse(o):
    md = o.get("musicData", {})
    cells = (o.get("globalLines") or {}).get("cells", [])

    def row(name):
        out = []
        for c in cells:
            if c.get("rowId") == name:
                try:
                    out.append({"col": int(c["col"]), "v": float(c["rawText"])})
                except (ValueError, KeyError):
                    pass
        return sorted(out, key=lambda e: e["col"])

    spb = int(row("global-spb")[0]["v"]) if row("global-spb") else 4
    tempo = [{"col": e["col"], "bpm": e["v"]} for e in row("global-bpm")] or [{"col": 0, "bpm": 100}]
    meter = [{"col": e["col"], "beats": int(e["v"])} for e in row("global-bpb")] or [{"col": 0, "beats": 4}]
    tracks = []
    for t in o.get("tracks", []):
        rows = {}
        for c in t.get("cells", []):
            m = re.fullmatch(r"s\d+-note-(\d+)", c.get("rowId", ""))
            if m:
                rows.setdefault(int(m.group(1)), {})[int(c["col"])] = str(c.get("rawText", ""))
        notes = []
        for midi, cols in rows.items():
            def inner(t):
                # tuplet group "/3(...)" wraps the cell text; read what is inside on this cell
                return re.sub(r"^/\d+\(", "", t or "")

            for col, raw in cols.items():
                # a note starts with its name ("E4", "C#5"), possibly followed by marks like "+@m(..)" or "@g(..)";
                # the cells it holds start with "-" (plain hold) or "~" (held with vibrato); "//..." is a comment
                txt = inner(raw)
                if raw.startswith("//") or not re.match(r"[A-G]#?-?\d", txt):
                    continue
                ln = 1
                while inner(cols.get(col + ln))[:1] in ("-", "~"):
                    ln += 1
                notes.append({"col": col, "len": ln, "midi": midi})
        if notes:
            tid, name = TRACK_NAMES.get(t.get("trackId"), (t.get("trackId", "t"), t.get("trackName", "트랙")))
            tracks.append({"id": tid, "name": name, "notes": sorted(notes, key=lambda n: (n["col"], -n["midi"]))})
    yt = md.get("youtube") or {}
    return {
        "title": (md.get("musicTitle") or "").strip(), "artist": md.get("musicArtist") or "", "writer": md.get("scoreWriter") or "",
        "comment": md.get("comment") or "", "videoId": yt.get("videoId") or "", "offsetMs": int(yt.get("offsetMs") or 0),
        "grid": {"stepsPerBeat": spb, "tempo": tempo, "meter": meter, "columnCount": int((o.get("globalLines") or {}).get("columnCount") or 0),
                 "offsetMs": int(yt.get("offsetMs") or 0)},
        "tracks": tracks,
    }


def slug(s):
    s = re.sub(r"[\\/:*?\"<>|]+", "_", s).strip()
    return s[:80] or "untitled"


def guess_lang(text):
    if re.search(r"[\uac00-\ud7a3]", text):
        return "ko"
    if re.search(r"[\u3040-\u30ff]", text):
        return "ja"
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--skip-existing", action="store_true")
    a = ap.parse_args()
    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    ok = fail = 0
    for f in a.files:
        src = Path(f)
        sp = spred_parse(json.loads(src.read_text(encoding="utf-8")))
        name = slug(f"{sp['title']} - {sp['artist']}")
        target = out_dir / f"{name}.uke.json"
        if a.skip_existing and target.exists():
            print(f"건너뜀 (있음): {target.name}", flush=True)
            continue
        if not sp["videoId"]:
            print(f"건너뜀 (YouTube 없음): {src.name}", flush=True)
            continue
        jid = "spred-" + re.sub(r"[^A-Za-z0-9_-]", "", src.stem.split("[")[-1].rstrip("]"))[:50]
        job = HERE / "jobs" / jid
        job.mkdir(parents=True, exist_ok=True)
        (job / "grid.json").write_text(json.dumps(sp["grid"]), encoding="utf-8")
        lang = guess_lang(sp["title"])
        cmd = [sys.executable, str(HERE / "transcribe.py"), "--video", sp["videoId"], "--job", str(job), "--grid", str(job / "grid.json"),
               "--reuse-audio", "--no-inst"] + (["--lang", lang] if lang else [])
        print(f"=== {sp['title']} / {sp['artist']} ({sp['videoId']})", flush=True)
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NOWIN,
                           env={**os.environ, "PYTHONIOENCODING": "utf-8"})
        tail = [l for l in r.stdout.splitlines() if l.strip()][-3:]
        if r.returncode != 0 or not (job / "result.json").exists():
            print("  실패: " + " | ".join(tail)[-400:], flush=True)
            fail += 1
            continue
        t = json.loads((job / "result.json").read_text(encoding="utf-8"))
        t["melody"] = sp["tracks"]
        t["meta"] = {**t.get("meta", {}), "title": sp["title"], "artist": sp["artist"],
                     "source": f"SPRED 오타마톤 악보({sp['writer'] or '제작자'})의 멜로디 + 원곡에서 자동으로 딴 코드·가사",
                     "comment": sp["comment"]}
        t["youtube"] = {"videoId": sp["videoId"], "offsetMs": sp["offsetMs"]}
        (job / "uke_input.json").write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")
        r2 = subprocess.run(["node", str(REPO / "tools" / "to_sheet.mjs"), str(job / "uke_input.json"), str(target)],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NOWIN)
        if r2.returncode != 0:
            print("  변환 실패: " + r2.stderr[-300:], flush=True)
            fail += 1
            continue
        print("  " + r2.stdout.strip(), flush=True)
        for w in job.glob("audio.wav"):
            w.unlink()
        ok += 1
    print(f"끝: 성공 {ok}, 실패 {fail}", flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
