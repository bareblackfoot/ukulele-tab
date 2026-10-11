"""Lyric lines of a finished job: show what Whisper heard, apply corrected lines, check the result.

    python D:/codes/ukulele-tab/bridge/lyrics_tool.py show  --job <dir>
    python D:/codes/ukulele-tab/bridge/lyrics_tool.py apply --job <dir> --file <dir>/lyrics_fix.txt
    python D:/codes/ukulele-tab/bridge/lyrics_tool.py check --job <dir>

lyrics_fix.txt has one line per corrected lyric line: "<number>: <corrected text>", or "<number>: -" to drop a line
that is not sung. Lines that are not listed stay as they are. Corrected syllables keep the timing of the syllables
they replace; added syllables are spread between their neighbours.
"""
import argparse
import difflib
import json
import re
import sys
import unicodedata
from pathlib import Path

SMALL_KANA = set("ゃゅょぁぃぅぇぉゎャュョァィゥェォヮっッー")  # sung together with the kana before them


def units_of(text):
    """Same split as server/analyze.py: Hangul syllables, kana morae, other words whole."""
    out = []
    for word in unicodedata.normalize("NFC", text).split():
        w = re.sub(r"[\.,!?~…·\"'“”‘’()\[\]{}<>:;—–\-]+", "", word)
        if not w:
            continue
        if re.search(r"[\uac00-\ud7a3]", w) and not re.search(r"[A-Za-z]{2,}", w):
            out += [ch for ch in w if re.match(r"[\uac00-\ud7a3A-Za-z0-9]", ch)]
        elif re.search(r"[\u3040-\u30ff\u4e00-\u9fff]", w):
            for ch in w:
                if ch in SMALL_KANA and out:
                    out[-1] += ch
                else:
                    out.append(ch)
        else:
            out.append(w)
    return out


def load(job):
    job = Path(job)
    res = json.loads((job / "result.json").read_text(encoding="utf-8"))
    asr = json.loads((job / "asr.json").read_text(encoding="utf-8"))
    return job, res, asr


def bar_of(col, res):
    spb = res.get("stepsPerBeat", 4)
    meters = sorted(res.get("meter", [{"col": 0, "beats": 4}]), key=lambda m: m["col"])
    c, b, mi = 0, 0, 0
    while True:
        while mi + 1 < len(meters) and meters[mi + 1]["col"] <= c:
            mi += 1
        ln = meters[mi]["beats"] * spb
        if col < c + ln:
            return b + 1
        c += ln
        b += 1


def cmd_show(job):
    job, res, asr = load(job)
    m = res.get("meta", {})
    print(f"곡: {m.get('title', '')} / {m.get('artist', '')} (언어 {asr.get('language')})")
    for ln in asr["lines"]:
        if ln.get("dropped"):
            continue
        sy = ln["syllables"]
        if not sy:
            continue
        low = sum(1 for s in sy if s.get("prob", 1) < 0.4)
        print(f"{ln['index']}: {''.join(s['text'] for s in sy)}    [마디 {bar_of(sy[0]['col'], res)}~{bar_of(sy[-1]['col'], res)}, "
              f"음절 {len(sy)}개{f', 자신 없는 음절 {low}개' if low else ''}]")


def spread(lo, hi, n):
    """n distinct integer columns strictly between lo and hi when possible."""
    if n <= 0:
        return []
    if hi - lo - 1 >= n:
        return [lo + 1 + round((i + 0.5) * (hi - lo - 1) / n - 0.5) for i in range(n)]
    return [lo + 1 + i for i in range(n)]


def cmd_apply(job, fix_file):
    job, res, asr = load(job)
    fixes = {}
    for raw in Path(fix_file).read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*(\d+)\s*[:：]\s*(.*)$", raw)
        if m:
            fixes[int(m.group(1))] = m.group(2).strip()
    if not fixes:
        sys.exit("고칠 줄이 없음 (형식: 번호: 고친 가사)")
    lyrics = res.get("lyrics", [])
    changed = dropped = 0
    for ln in asr["lines"]:
        if ln["index"] not in fixes or not ln["syllables"]:
            continue
        old = ln["syllables"]
        old_cols = {s["col"] for s in old}
        lyrics = [e for e in lyrics if e["col"] not in old_cols]
        new_text = fixes[ln["index"]]
        if new_text in ("-", ""):
            ln["dropped"] = True
            ln["syllables"] = []
            dropped += 1
            continue
        new_units = units_of(new_text)
        sm = difflib.SequenceMatcher(a=[s["text"] for s in old], b=new_units, autojunk=False)
        cols = [None] * len(new_units)
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "equal":
                for k in range(j2 - j1):
                    cols[j1 + k] = old[i1 + k]["col"]
            elif tag == "replace":
                oc = [old[i]["col"] for i in range(i1, i2)]
                for k in range(min(len(oc), j2 - j1)):
                    cols[j1 + k] = oc[k]
        # fill the rest between known neighbours
        k = 0
        first_col, last_col = old[0]["col"], old[-1]["col"]
        while k < len(cols):
            if cols[k] is not None:
                k += 1
                continue
            j = k
            while j < len(cols) and cols[j] is None:
                j += 1
            lo = cols[k - 1] if k > 0 else first_col - 2 * (j - k) - 1
            hi = cols[j] if j < len(cols) else max(last_col + 2 * (j - k) + 1, lo + (j - k) + 1)
            for t, c in zip(range(k, j), spread(lo, hi, j - k)):
                cols[t] = max(0, c)
            k = j
        for t in range(1, len(cols)):
            if cols[t] <= cols[t - 1]:
                cols[t] = cols[t - 1] + 1
        ln["syllables"] = [{"text": u, "col": int(c), "prob": 1.0, "corrected": True} for u, c in zip(new_units, cols)]
        ln["text"] = new_text
        lyrics += [{"col": int(c), "text": u} for u, c in zip(new_units, cols)]
        changed += 1
    # keep one syllable per column
    seen, out = set(), []
    for e in sorted(lyrics, key=lambda e: e["col"]):
        while e["col"] in seen:
            e = {**e, "col": e["col"] + 1}
        seen.add(e["col"])
        out.append(e)
    res["lyrics"] = out
    (job / "result.json").write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    (job / "asr.json").write_text(json.dumps(asr, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"고친 줄 {changed}개, 뺀 줄 {dropped}개, 가사 음절 {len(out)}개")


def cmd_check(job):
    job = Path(job)
    res = json.loads((job / "result.json").read_text(encoding="utf-8"))
    assert res["format"]["name"] == "ukulele-transcription", "형식 이름이 다름"
    assert res["tempo"] and res["tempo"][0]["col"] == 0 and 20 <= res["tempo"][0]["bpm"] <= 400, "템포가 이상함"
    assert res["meter"] and res["meter"][0]["col"] == 0, "박자가 이상함"
    assert res["columnCount"] > 0, "길이가 0"
    for key in ("chords", "lyrics"):
        cols = [e["col"] for e in res[key]]
        assert cols == sorted(cols), f"{key} 순서가 이상함"
    n = sum(len(t["notes"]) for t in res.get("melody", []))
    print(f"result.json 확인됨: 코드 {len(res['chords'])}개, 가사 음절 {len(res['lyrics'])}개, 멜로디 음 {n}개, "
          f"{res['tempo'][0]['bpm']} BPM, 영상 {res.get('youtube', {}).get('videoId')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["show", "apply", "check"])
    ap.add_argument("--job", required=True)
    ap.add_argument("--file")
    a = ap.parse_args()
    if a.action == "show":
        cmd_show(a.job)
    elif a.action == "apply":
        if not a.file:
            sys.exit("--file 필요")
        cmd_apply(a.job, a.file)
    else:
        cmd_check(a.job)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
