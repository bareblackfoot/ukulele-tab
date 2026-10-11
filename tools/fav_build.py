"""Build my-library sheets for the favourite songs from the transcriptions of the original recordings.

    python tools/fav_build.py

Chords: either an explicit bar-by-bar progression (read off a beginner sheet, e.g. 하루한장 우쿨렐레) or the
chords detected in the recording, renamed to the closest chord in a given chord set. With a capo, chord names
are the shapes played with the capo on. Melody, lyric timing, beat grid and YouTube sync come from the recording.
"""
import json
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
JOBS = REPO / "bridge" / "jobs"
LIB = Path(r"G:\내 드라이브\2.취미생활\우쿨렐레\악보")

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


def build(job, out_name, meta, strum, capo=0, explicit=None, vocab=None, sections=None, simplify=False, am7_after_a=False):
    t = json.loads((JOBS / job / "result.json").read_text(encoding="utf-8"))
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
    inp = JOBS / job / "fav_input.json"
    # the app's importer reads strum/sections/capo from the transcription file too
    inp.write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")
    out = LIB / f"{out_name}.uke.json"
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

# ---------------------------------------------------------------- ひとりごつ (하치와레): 원곡 코드를 기본 코드로
build("fav-hitorigotsu", "ひとりごつ (하치와레의 혼잣말) - ハチワレ",
      {"title": "ひとりごつ (하치와레의 혼잣말)", "artist": "ハチワレ (CV: 田中誠人)", "key": "D",
       "source": "원곡 녹음(TV 크기)에서 박자·가사·멜로디·코드를 땀. 코드 이름은 U-FRET 초보자판 코드표에 맞춤"},
      "D-DU-UDU", vocab=["D", "F#", "Bm", "G", "E", "A", "F#m", "C", "A#", "Em"])
