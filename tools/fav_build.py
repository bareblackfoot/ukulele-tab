"""Build my-library sheets for the favourite songs from the transcriptions of the original recordings.

    python tools/fav_build.py [job ...]     (no job: all of them, e.g. fav-hitorigotsu for one song)

Chords: either an explicit bar-by-bar progression (read off a beginner sheet, e.g. 하루한장 우쿨렐레) or the
chords detected in the recording, renamed to the closest chord in a given chord set. With a capo, chord names
are the shapes played with the capo on. Melody, lyric timing, beat grid and YouTube sync come from the recording.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
JOBS = REPO / "bridge" / "jobs"
LIB = Path(r"G:\내 드라이브\2.취미생활\우쿨렐레\악보")
# importing this file (for its helpers) must not rebuild anything
ONLY = set(sys.argv[1:]) if __name__ == "__main__" else {"(imported)"}

PC = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8,
      "A": 9, "A#": 10, "Bb": 10, "B": 11}
SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
IV = {"": (0, 4, 7), "m": (0, 3, 7), "7": (0, 4, 7, 10), "m7": (0, 3, 7, 10), "M7": (0, 4, 7, 11), "maj7": (0, 4, 7, 11)}


def parse(name):
    m = re.match(r"^([A-G][#b]?)(.*)$", name)
    return PC[m.group(1)], m.group(2)


def tones(name):
    r, q = parse(name)
    return {(r + x) % 12 for x in IV.get(q, IV[""])}


def snap(name, vocab, shift=0):
    """auto chord (in the recording's key) -> closest chord of the sheet's chord set"""
    if name == "N.C.":
        return name
    r, q = parse(name)
    moved = SHARP[(r + shift) % 12] + ("m" if q.startswith("m") and not q.startswith("maj") else "") + ("7" if q.endswith("7") and not q.endswith("M7") else "")
    t = tones(moved)
    same_root = [v for v in vocab if parse(v)[0] == (r + shift) % 12]
    if same_root:
        # same root: prefer the same quality family, else whatever the sheet uses for that root
        best = max(same_root, key=lambda v: len(tones(v) & t) - 0.1 * len(tones(v) ^ t))
        return best
    best = max(vocab, key=lambda v: len(tones(v) & t) - 0.1 * len(tones(v) ^ t))
    return best if len(tones(best) & t) >= 2 else moved


def bars_of(t):
    spb = t.get("stepsPerBeat", 4)
    ms = sorted(t["meter"], key=lambda m: m["col"])
    out, col, mi = [], 0, 0
    while col < t["columnCount"]:
        while mi + 1 < len(ms) and ms[mi + 1]["col"] <= col:
            mi += 1
        ln = ms[mi]["beats"] * spb
        nxt = ms[mi + 1]["col"] if mi + 1 < len(ms) else None
        if nxt is not None and col < nxt < col + ln:
            ln = nxt - col
        out.append((col, ln))
        col += ln
    return out


def seconds_at(t, col):
    """score time of a column"""
    spb = t.get("stepsPerBeat", 4)
    ev = sorted(t["tempo"], key=lambda e: e["col"])
    sec = 0.0
    for i, e in enumerate(ev):
        end = ev[i + 1]["col"] if i + 1 < len(ev) else None
        if end is None or col <= end:
            return sec + (col - e["col"]) * 60.0 / e["bpm"] / spb
        sec += (end - e["col"]) * 60.0 / e["bpm"] / spb
    return sec


def trim(t, bar):
    """drop everything before bar `bar` (1-based, as bars_of counts) and keep the video in step"""
    c0 = bars_of(t)[bar - 1][0]
    x = seconds_at(t, c0)
    def shift(arr, keep_first=None):
        out = [{**e, "col": e["col"] - c0} for e in arr if e["col"] >= c0]
        if keep_first is not None and (not out or out[0]["col"] > 0):
            out.insert(0, {**keep_first, "col": 0})
        return out
    in_force = lambda arr: [e for e in sorted(arr, key=lambda e: e["col"]) if e["col"] <= c0][-1]
    t["tempo"] = shift(t["tempo"], in_force(t["tempo"]))
    t["meter"] = shift(t["meter"], in_force(t["meter"]))
    for k in ("chords", "lyrics", "sections"):
        t[k] = shift(t.get(k, []))
    for tr in t.get("melody", []):
        tr["notes"] = shift(tr["notes"])
    t["columnCount"] -= c0
    # video time = score time - offsetMs / 1000, and score time now starts x seconds later
    t["youtube"]["offsetMs"] = int(round(t["youtube"].get("offsetMs", 0) - x * 1000))
    return t


def build(job, out_name, meta, strum, capo=0, explicit=None, vocab=None, sections=None, simplify=False, am7_after_a=False,
          lyrics_fn=None, strums=None, trim_bar=None):
    if ONLY and job not in ONLY:
        return
    t = json.loads((JOBS / job / "result.json").read_text(encoding="utf-8"))
    if trim_bar:
        t = trim(t, trim_bar)
    bars = bars_of(t)
    spb = t.get("stepsPerBeat", 4)
    if explicit:
        chords = []
        for bar, items in sorted(explicit.items()):
            col0, ln = bars[bar - 1]
            for beat, name in items:
                chords.append({"col": col0 + (beat - 1) * spb, "name": name})
    else:
        chords = []
        for c in t["chords"]:
            name = c["name"]
            if vocab:
                name = snap(name, vocab, -capo)
            elif simplify and name != "N.C.":
                r, q = parse(name)
                name = SHARP[(r - capo) % 12] + ("m" if q.startswith("m") and not q.startswith("maj") else "") + ("7" if q in ("7",) else "")
            chords.append({"col": c["col"], "name": name})
    if am7_after_a:
        # beginner sheets play AM7 in the second bar when A lasts two bars or more
        starts = [b[0] for b in bars]
        extra = []
        srt = sorted(chords, key=lambda c: c["col"])
        for i, c in enumerate(srt):
            if c["name"] != "A" or c["col"] not in starts:
                continue
            end = srt[i + 1]["col"] if i + 1 < len(srt) else t["columnCount"]
            k = starts.index(c["col"])
            if k + 1 < len(starts) and end >= starts[k + 1] + bars[k + 1][1]:
                extra.append({"col": starts[k + 1], "name": "AM7"})
        chords = chords + extra
    clean = []
    for c in sorted(chords, key=lambda c: c["col"]):
        if clean and clean[-1]["name"] == c["name"]:
            continue
        clean.append(c)
    t["chords"] = clean
    t["capo"] = capo
    t["meta"] = {**t.get("meta", {}), **meta}
    t["strum"] = {"pattern": strum}
    t["sections"] = [{"col": bars[b - 1][0], "text": s} for b, s in (sections or [])]
    # strum pattern changes, keyed like explicit chords (bar numbers of the reference sheet + 1)
    t["strums"] = [{"col": bars[b - 1][0], "pattern": p} for b, p in (strums or [])]
    if lyrics_fn:
        t["lyrics"], extra = lyrics_fn(t, bars)
        t["sections"] = sorted(t["sections"] + extra, key=lambda s: s["col"])
    inp = JOBS / job / "fav_input.json"
    # the app's importer reads strum/sections/capo from the transcription file too
    inp.write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")
    out = LIB / f"{out_name}.uke.json"
    if out.exists():   # keep the previous version
        old = LIB / "이전판"
        old.mkdir(exist_ok=True)
        os.replace(out, old / f"{out.stem}_{time.strftime('%Y%m%d-%H%M%S')}.json")
    r = subprocess.run(["node", str(REPO / "tools" / "to_sheet.mjs"), str(inp), str(out)], capture_output=True, text=True, encoding="utf-8")
    print(out.name, "|", r.stdout.strip() or r.stderr.strip()[-300:])
    names = []
    for c in clean:
        if c["name"] not in names:
            names.append(c["name"])
    print("   코드:", " ".join(names))


# ---------------------------------------------------------------- Antifreeze (검정치마): 하루한장 C 진행 + 카포 6
VERSE = [["F"], ["G7"], ["C"], ["F"], ["F"], ["G7"], ["C"], ["E7"], ["F"], ["G7"], ["E7"], ["Am"], ["Dm"], ["G7"], ["C"], ["C"]]
PRE = [["Am"], ["Em7"], ["F", "G7"], ["C", "G"]] * 2
CHO = [["F"], ["Em7"], ["F"], ["Em7"], ["F"], ["Em7"], ["Dm"], ["G7"], ["C"], ["C"]]
BRIDGE = [["Am"], ["D7"], ["G7"], ["C", "G"]]


def lay(start, seq):
    out = {}
    for i, names in enumerate(seq):
        out[start + i] = [(1, names[0])] + ([(3, names[1])] if len(names) > 1 else [])
    return out


af = {}
af.update(lay(2, [["F"], ["G7"], ["C"], ["F"]] * 2))       # 전주
af.update(lay(10, VERSE))                                  # 1절
af.update(lay(26, VERSE))                                  # 2절
af.update(lay(42, PRE))                                    # 후렴 전
af.update(lay(50, CHO))                                    # 후렴
af.update(lay(60, PRE))
af.update(lay(68, CHO[:9] + [["C"], ["C"], ["C"]]))        # 후렴, 쉬는 마디
af.update(lay(80, BRIDGE * 8))                             # 브리지
af.update(lay(112, [["C"]] + [["D7"], ["G7"], ["C"], ["Am"]] * 3 + [["D7"], ["G7"], ["C"]]))
af.update(lay(128, [["C"]]))

build("fav-antifreeze", "Antifreeze - 검정치마",
      {"title": "Antifreeze", "artist": "검정치마", "key": "Gb (카포 6, C 운지)",
       "source": "원곡 녹음에서 박자·가사·멜로디를 땀. 코드 진행은 하루한장 우쿨렐레 C조 악보를 참고함"},
      "D-DU-UDU", capo=6, explicit=af,
      sections=[(2, "전주"), (10, "1절"), (26, "2절"), (42, "후렴 전"), (50, "후렴"), (60, "후렴 전"), (68, "후렴"), (80, "브리지"), (113, "끝")])

# ---------------------------------------------------------------- Antifreeze 하루한장 우쿨렐레판: 카포 없이 C조
# The 하루한장 video (pcsmodi4Uus) talks and drills chords for the first 30 bars; the sheet starts at bar 30 of the
# recording. Its own sheet: verse x2, pre-chorus, chorus (10 bars), pre-chorus, chorus, bridge (8 bars) x2.
H_V = [["F"], ["G7"], ["C"], ["F"], ["F"], ["G7"], ["C"], ["E7"], ["F"], ["G7"], ["E7"], ["Am"], ["Dm"], ["G7"], ["C"], ["C"]]
H_P = [["Am"], ["Em7"], ["F", "G7"], ["C", "G"]] * 2
H_C = [["F"], ["Em7"], ["F"], ["Em7"], ["F"], ["Em7"], ["Dm"], ["G7"], ["C"], ["C"]]
H_B = [["Am"], ["D7"], ["G7"], ["C", "G"]] * 2
haru = {}
haru.update(lay(3, H_V + H_V + H_P + H_C + H_P + H_C + H_B + H_B + [["C"]]))
build("haru-antifreeze2", "Antifreeze (하루한장 우쿨렐레, 카포 없음) - 검정치마",
      {"title": "Antifreeze (하루한장 우쿨렐레판)", "artist": "검정치마 · 연주 하루 한 장 우쿨렐레", "key": "C (카포 없음)",
       "source": "하루한장 우쿨렐레 영상(pcsmodi4Uus)의 연주에서 박자·멜로디를 땀. 코드는 영상 속 하루한장 악보를 따름"},
      "D-DU-UDU", explicit=haru, trim_bar=30,
      sections=[(3, "1절"), (19, "2절"), (35, "후렴 전"), (43, "후렴"), (53, "후렴 전"), (61, "후렴"), (71, "브리지"), (87, "끝")])

# ---------------------------------------------------------------- 0+0 (한로로): 원곡 코드를 하루한장 A조 코드표로
build("fav-0plus0", "0+0 - 한로로",
      {"title": "0+0", "artist": "한로로", "key": "A",
       "source": "원곡 녹음에서 박자·가사·멜로디·코드를 땀. 코드 이름은 하루한장 우쿨렐레 A조 코드표에 맞춤"},
      "D-D-DUDU", vocab=["A", "AM7", "F#", "Bm7", "E7", "D", "G", "Dm", "C#m7", "Em"], am7_after_a=True)

# ---------------------------------------------------------------- 사랑하게 될 거야 (한로로): 하루한장 G조 코드표로
build("fav-landing", "사랑하게 될 거야 - 한로로",
      {"title": "사랑하게 될 거야", "artist": "한로로", "key": "G",
       "source": "원곡 녹음에서 박자·가사·멜로디·코드를 땀. 코드 이름은 하루한장 우쿨렐레 G조 코드표에 맞춤"},
      "D-DU-UDU", vocab=["G", "B7", "Em7", "C", "D", "G7", "Em"])

# ---------------------------------------------------------------- ひとりごつ (하치와레): 우쿨소년 블로그 악보
# https://m.blog.naver.com/uke_boy/223497437366 (2024-07-01): bar-by-bar chords in D, sung in Hangul pronunciation,
# Korean meaning of each line shown above the bar where the line starts. Bar 1 of that sheet is the first full
# bar after the 2-beat pickup of the recording.
HG = [["D", "F#"], ["G"], ["G"], ["A7"],
      ["G"], ["Em7"], ["D", "F#"], ["G"], ["G", "A7"], ["D"],
      ["F#m"], ["Bm7"], ["G"], ["Em7"], ["A7"],
      ["D", "F#"], ["G"], ["G"], ["A7"], ["D"],
      ["C", "G"], ["C", "G"], ["Bb"], ["C"],
      ["D", "G"], ["Em7", "A7"], ["D", "G"], ["Em7", "A7"],
      ["D", "G"], ["Em7", "A7"], ["G"], ["G"], ["Em7"], ["G"], ["D"]]
# the lyrics themselves (kana as sung, the particle は written わ; the blog's Korean meaning per line; kanji
# readings for the recogniser's output) stay in my Google Drive, not in this public repo
HG_TEXT = LIB / "가사자료" / "ひとりごつ.json"
# lines 0-5 are placed automatically with the recogniser's timings; from あぁ~ on the recogniser mostly failed,
# so every syllable is placed by hand on the melody notes as (bar, beat). あああ is the same F#-E-F# figure on
# beats 2-2.5-3 of bars 25, 27 and 29.
HG_AUTO_LINES = 6
HG_MANUAL = [
    [(20, 4), (22, 2), (22, 3), (22, 3.5), (22, 4), (23, 1), (23, 1.5), (24, 1.5), (24, 2.5), (24, 3.25)],
    [(25, 2), (25, 2.5), (25, 3), (25, 4), (25, 4.5), (26, 1.5), (26, 2), (26, 2.5), (26, 3), (26, 3.5)],
    [(27, 2), (27, 2.5), (27, 3), (27, 4), (27, 4.5), (28, 1), (28, 1.5), (28, 2), (28, 3), (28, 3.5), (28, 4), (28, 4.5), (29, 1)],
    [(29, 2), (29, 2.5), (29, 3), (29, 4), (29, 4.5), (30, 1), (30, 1.5), (30, 2), (30, 2.5), (30, 3), (30, 3.5)],
    [(30, 4.5), (31, 2), (31, 2.5), (31, 3)],
    [(33, 1), (33, 1.5), (34, 1), (34, 1.5), (35, 1)],
]

def hitorigotsu_lyrics(t, bars):
    from kana_hangul import units
    text = json.loads(HG_TEXT.read_text(encoding="utf-8"))
    lines, reading = text["lines"], text["readings"]
    spb = t.get("stepsPerBeat", 4)
    at = lambda bar, beat: bars[bar][0] + round((beat - 1) * spb)   # bars[0] is the pickup, bars[1] is bar 1
    # recogniser output -> Hangul units with times; a kanji read with two kana (朝 = 아사) gets its second
    # syllable an 8th later
    stream = []
    for e in sorted(t["lyrics"], key=lambda e: e["col"]):
        for k, ch in enumerate(reading.get(e["text"], e["text"])):
            stream.append((ch, e["col"] + k * spb // 2))
    anchors = [{"col": stream[i][1], "text": u} for u, i in units("".join(c for c, _ in stream))]
    words = [["".join(u for u, _ in units(w)) for w in ln.split()] for ln in lines]
    end = at(*HG_MANUAL[0][0])
    inp = JOBS / "fav-hitorigotsu" / "align_input.json"
    inp.write_text(json.dumps({"stepsPerBeat": spb, "notes": [{"col": n["col"], "len": n["len"]} for n in t["melody"][0]["notes"] if n["col"] < end],
                               "anchors": [a for a in anchors if a["col"] < end],
                               "text": "\n".join(" ".join(ws) for ws in words[:HG_AUTO_LINES])}, ensure_ascii=False), encoding="utf-8")
    r = subprocess.run(["node", str(REPO / "tools" / "align_lyrics.mjs"), str(inp)], capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise SystemExit(r.stderr[-500:])
    ev = json.loads(r.stdout)
    for ws, places in zip(words[HG_AUTO_LINES:], HG_MANUAL):
        syl = "".join(ws)
        assert len(syl) == len(places), (ws, len(places))
        ev += [{"col": at(*p), "text": u} for u, p in zip(syl, places)]
    # unit index where each word starts
    first, k = {}, 0
    for li, ws in enumerate(words):
        for wi, w in enumerate(ws):
            first[(li, wi)] = k
            k += len(w)
    assert k == len(ev), (k, len(ev))
    if text.get("korean"):
        # sung in Korean: the same places, one Korean syllable for each sung syllable of the line
        out, k = [], 0
        for ws, ko in zip(words, text["korean"]):
            syl = [ch for ch in ko if "가" <= ch <= "힣"]
            n = sum(len(w) for w in ws)
            assert len(syl) == n, (ko, n)
            out += [{"col": e["col"], "text": u} for e, u in zip(ev[k:k + n], syl)]
            k += n
        return out, []
    sections = {}
    for key, meaning in text["meanings"]:
        col = ev[first[tuple(key)]]["col"]
        bi = max(i for i, (c0, _) in enumerate(bars) if c0 <= col)
        if col >= bars[bi][0] + bars[bi][1] - spb and bi + 1 < len(bars):
            bi += 1   # sung on the last beat: the line belongs to the next bar
        c0 = bars[bi][0]
        sections[c0] = sections[c0] + " / " + meaning if c0 in sections else meaning
    return ev, [{"col": c, "text": s} for c, s in sorted(sections.items())]


build("fav-hitorigotsu", "ひとりごつ (하치와레의 혼잣말) - ハチワレ",
      {"title": "ひとりごつ (하치와레의 혼잣말)", "artist": "ハチワレ (CV: 田中誠人)", "key": "D",
       "source": "원곡 녹음(TV 크기)에서 박자·멜로디를 땀. 코드는 우쿨소년 블로그 악보"
                 "(m.blog.naver.com/uke_boy/223497437366)를 따름. 가사는 그 뜻을 바탕으로 음에 맞춰 한국어로 개사함. 칼립소나 셔플 주법"},
      "D-DU-UDU", explicit=lay(2, HG), lyrics_fn=hitorigotsu_lyrics)
# strum patterns per bar come afterwards from the recording: tools/strum_apply.mjs <sheet> bridge/jobs/check-<id>/sync.json
