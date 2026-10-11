"""Turn time-synced lyrics (LRC, e.g. from lrclib.net) into a lyrics file and line pins for tools/relyric.py.

    python tools/lrc_fit.py <sheet.uke.json> <lyrics.lrc> <check dir> <out.txt> [--lang ko|en|ja] [--keep-paren]

Finds the time shift between the LRC and this recording (line starts against the sung note starts in
<check dir>/sync.json), keeps the lines that are sung in this recording, writes one lyric line per sung line
(Japanese as Hangul pronunciation, one syllable per sung syllable) and prints the --pin arguments that start
every line where the recording has it. Lines whose syllables do not fit the melody notes before the next line
lose their pin (the aligner then places them with the neighbouring line).
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from relyric import TimeMap  # noqa: E402

LRC = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\](.*)")


def parse_lrc(text):
    out = []
    for line in text.splitlines():
        m = LRC.match(line.strip())
        if not m:
            continue
        t = int(m.group(1)) * 60 + float(m.group(2))
        out.append((t, m.group(3).strip()))
    return out


READINGS = [("降り止む", "ふりやむ"), ("側に", "そばに"), ("あの日", "あのひ"), ("この日", "このひ"), ("その日", "そのひ"), ("日々", "ひび"), ("貴方", "あなた"), ("何処", "どこ"), ("何故", "なぜ"), ("一人", "ひとり"), ("二人", "ふたり"), ("今日", "きょう"),
            ("明日", "あした"), ("昨日", "きのう"), ("一緒", "いっしょ"), ("大人", "おとな"), ("君", "きみ"), ("私", "わたし"),
            ("僕", "ぼく"), ("貴女", "あなた"), ("此処", "ここ"), ("今", "いま"), ("何", "なに"), ("瞳", "ひとみ"), ("涙", "なみだ"),
            ("心", "こころ"), ("声", "こえ"), ("夢", "ゆめ"), ("空", "そら"), ("恋", "こい"), ("愛", "あい")]


LONG_O = "おこそとのほもよろごぞどぼぽょょうくすつぬふむゆるぐずづぶぷゅ"
LONG_E = "えけせてねへめれげぜでべぺ"


def merge_long(kana, kanji_word=False):
    """long vowels sung as one note: おう/こう.. -> one syllable; えい/けい.. only inside a kanji word
    (先生, 永遠), since in kana text it is usually two words (それでいつか)"""
    kana = re.sub("([" + LONG_O + "])う", lambda m: m.group(1) + "ー", kana)
    if kanji_word:
        kana = re.sub("([" + LONG_E + "])い", lambda m: m.group(1) + "ー", kana)
    return kana


LONG = False


def ja_to_hangul(text):
    """Japanese line -> Hangul pronunciation with the same word breaks (particles は/へ read as わ/え)"""
    import pykakasi
    from kana_hangul import units
    kk = pykakasi.kakasi()
    # readings the converter gets wrong in song lyrics
    for kanji, kana in READINGS:
        text = text.replace(kanji, kana)
    words = []
    for part in re.split(r"[\s　]+", text):
        if not part:
            continue
        toks = kk.convert(part)
        kana = ""
        for k, tok in enumerate(toks):
            if re.search(r"[A-Za-z]", tok["orig"]):
                # English inside a Japanese line stays English (the page splits it into syllables)
                if kana:
                    words.append("".join(u for u, _ in units(kana)))
                    kana = ""
                words.append(re.sub(r"[^A-Za-z']+", " ", tok["orig"]).strip())
                continue
            h = merge_long(tok["hira"], bool(re.search(r"[一-鿿]", tok["orig"]))) if LONG else tok["hira"]
            if tok["orig"] in ("は", "へ") and k > 0:
                h = {"は": "わ", "へ": "え"}[tok["orig"]]
            elif k > 0 and tok["orig"][:1] == "は" and re.search(r"[一-鿿゠-ヿ]", toks[k - 1]["orig"]):
                h = "わ" + h[1:]   # particle right after a kanji/katakana word
            kana += h
        # particle は after common kana words
        kana = re.sub(r"(あなた|わたし|ぼく|きみ|これ|それ|あれ|ここ|いま|から|まで|こと|もの|さよなら|[にでとの])は(?!じ|な[しい]|る)",
                      lambda m: m.group(1) + "わ", kana)
        hangul = "".join(u for u, _ in units(kana))
        if hangul:
            words.append(hangul)
    return " ".join(w for w in words if w)


def syllables(text, lang=None):
    # Hangul: one per character; Latin words: vowel groups (as js/lyrics.js splits them)
    n = len(re.findall(r"[가-힣]", text))
    for w in re.findall(r"[A-Za-z']+", text):
        n += max(1, len(re.findall(r"[aeiouy]+", w.lower())))
    return n


JA = re.compile(r"[぀-ヿ一-鿿]")


def plain_latin(ch):
    import unicodedata
    if "À" <= ch <= "ɏ":
        return "".join(c for c in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(c))
    return ch


def js_syllables(lines):
    """syllables per line as js/lyrics.js splits them"""
    import subprocess
    src = Path(__file__).resolve().parent.parent / "js" / "lyrics.js"
    code = ("import { syllabify } from " + json.dumps(src.as_uri()) + ";"
            "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const L=JSON.parse(d);"
            "console.log(JSON.stringify(L.map(x=>syllabify(x).length)));});")
    r = subprocess.run(["node", "--input-type=module", "-e", code], input=json.dumps(lines, ensure_ascii=False),
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return json.loads(r.stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("lrc")
    ap.add_argument("check")
    ap.add_argument("out")
    ap.add_argument("--lang", default="ko", choices=["ko", "en", "ja", "mix"], help="mix: Japanese lines -> Hangul, others as is")
    ap.add_argument("--scale", action="store_true", help="also search a tempo scale (LRC from a differently timed release)")
    ap.add_argument("--long", action="store_true", help="Japanese long vowels (おう, えい) as one syllable")
    ap.add_argument("--keep-paren", action="store_true", help="keep (backing vocal) words in parentheses")
    ap.add_argument("--shift", type=float, default=None, help="use this LRC->recording shift in seconds instead of searching")
    ap.add_argument("--voiced", action="store_true", help="drop lines with no singing found (only for a shorter or cut recording)")
    a = ap.parse_args()
    global LONG
    LONG = a.long
    s = json.loads(Path(a.sheet).read_text(encoding="utf-8"))
    sync = json.loads((Path(a.check) / "sync.json").read_text(encoding="utf-8"))
    lines = [(t, x) for t, x in parse_lrc(Path(a.lrc).read_text(encoding="utf-8"))]
    starts = sorted(sync["sung_starts"])
    sung = sync["sung_notes"]
    end_t = max((n[2] for n in sung), default=0) + 5
    # 1. shift: line starts should sit on sung note starts
    import bisect

    def near(t):
        i = bisect.bisect_left(starts, t)
        return min((abs(starts[j] - t) for j in (i - 1, i) if 0 <= j < len(starts)), default=9)

    texted = [(t, x) for t, x in lines if x and not re.fullmatch(r"[♪\s\-–—…・()（）]*", x)]
    scale = 1.0
    if a.shift is None:
        best, shift = -1, 0.0
        for sc_ in ([1 + k * 0.0025 for k in range(-24, 25)] if a.scale else [1.0]):
            for k in range(-2000, 2001, 2 if a.scale else 1):
                d = k * 0.01
                sc = sum(max(0.0, 1 - near(t * sc_ + d) / 0.25) for t, _ in texted if 0 <= t * sc_ + d <= end_t)
                if sc > best:
                    best, shift, scale = sc, d, sc_
        print(f"shift {shift:+.2f}s scale {scale:.4f}, {best:.1f} of {len(texted)} line starts on a sung start")
    else:
        shift = a.shift
    lines = [(t * scale, x) for t, x in lines]
    # 2. lines sung in this recording: some voiced singing between this line and the next
    spb = s["stepsPerBeat"]
    tm = TimeMap(s["tempo"], spb)
    off = (s.get("youtube") or {}).get("offsetMs", 0) / 1000.0
    to_col = lambda vt: tm.time_to_col(vt + off)
    meters = sorted(s["meter"], key=lambda m: m["col"])
    bars, col, mi = [], 0, 0
    while col < s["columnCount"]:
        while mi + 1 < len(meters) and meters[mi + 1]["col"] <= col:
            mi += 1
        ln = meters[mi]["beats"] * spb
        if mi + 1 < len(meters) and col < meters[mi + 1]["col"] < col + ln:
            ln = meters[mi + 1]["col"] - col
        bars.append(col)
        col += ln
    notes = sorted(n["col"] for n in s["tracks"][0]["notes"])
    kept = []
    all_t = [t for t, _ in lines] + [1e9]
    for i, (t, x) in enumerate(lines):
        if not x or re.fullmatch(r"[♪\s\-–—…・()（）]*", x):
            continue
        t0, t1 = t + shift, all_t[i + 1] + shift
        voiced = sum(max(0.0, min(e, t1) - max(b, t0)) for _, b, e in sung)
        if t0 > end_t or t0 < -0.5 or (a.voiced and voiced < 0.25):
            print(f"  not sung here: {x[:40]}")
            continue
        kept.append((t0, t1, x))
    # some LRC lines are stamped at the start of an instrumental break before them: when a line cannot be sung
    # before the next long silence (too few sung notes), it starts after that silence
    gaps = []
    ends = sorted((b, e) for _, b, e in sung)
    far = -1e9
    for b, e in ends:
        if far > -1e9 and b - far >= 3.0:
            gaps.append((far, b))
        far = max(far, e)
    moved = []
    for k, (t0, t1, x) in enumerate(kept):
        n_syl = max(1, len(re.findall(r"[가-힣ぁ-んァ-ン一-鿿]", x)) or len(re.findall(r"[aeiouy]+", x.lower())))
        nxt = kept[k + 1][0] if k + 1 < len(kept) else 1e9   # next sung line (blank LRC lines mark breaks)
        g = next((g for g in gaps if t0 - 0.5 <= g[0] <= t0 + 4.0 and g[1] < nxt), None)
        if g:
            before = sum(1 for _, b, _ in sung if t0 - 0.4 <= b < g[0])
            if before < 0.5 * n_syl:
                moved.append(x[:20])
                t0 = g[1] - 0.1
        kept[k] = (t0, t1, x)
    if moved:
        print("  line starts moved past a break:", " / ".join(moved))
    # 3. text per line, and where each line starts
    mel = sorted(s["tracks"][0]["notes"], key=lambda n: n["col"])

    def room_in(c0, c1):
        """places the aligner (js/lyrics.js) makes from the notes starting in [c0, c1): note starts and every 8th
        inside a long note; a note starting where the previous one started adds nothing"""
        n_, last = 0, None
        for n in mel:
            if not (c0 - 1e-6 <= n["col"] < c1 - 1e-6) or n["col"] == last:
                continue
            mids = list(range(n["col"] + 2, n["col"] + n["len"], 2))
            n_ += 1 + len(mids)
            last = mids[-1] if mids else n["col"]   # the aligner compares with its last place, start or in-between
        return n_

    def pin_col(c):
        """the column relyric gets back from the printed BAR.BEAT"""
        bi = max(k for k, b in enumerate(bars) if b <= c)
        return bars[bi] + (round(1 + (c - bars[bi]) / spb, 2) - 1) * spb
    rows = []
    for t0, t1, x in kept:
        if not a.keep_paren:
            x = re.sub(r"[(（][^)）]*[)）]", " ", x)
        x = re.sub(r"[「」『』\"“”]", "", x).strip()
        # accented Latin letters -> plain ones, so the page splits words like più, partirò into syllables
        x = "".join(plain_latin(ch) for ch in x)
        if a.lang == "ja" or (a.lang == "mix" and JA.search(x)):
            x = ja_to_hangul(x)
        if x.strip():
            rows.append([x, to_col(t0 - 0.35)])
    counts = js_syllables([r[0] for r in rows])
    # every pinned group of lines must have at least as many places as syllables; otherwise merge it with the next
    pinned = [r[1] >= 0 for r in rows]
    if rows:
        pinned[0] = rows[0][1] >= 0
    while True:
        starts = sorted(set([0] + [i for i, p in enumerate(pinned) if p])) if rows else []
        bad = None
        for gi, i in enumerate(starts):
            j = starts[gi + 1] if gi + 1 < len(starts) else len(rows)
            c0 = pin_col(rows[i][1]) if gi > 0 or rows[i][1] >= 0 else -1e9
            c1 = pin_col(rows[j][1]) if j < len(rows) else 1e9
            if gi == 0:
                c0 = -1e9   # relyric starts the first part at the beginning when line 0 is not pinned
                if pinned[0]:
                    c0 = pin_col(rows[0][1])
            need = sum(counts[k] for k in range(i, j))
            room = room_in(c0, c1)
            if need + 1 > room:
                bad = (gi, starts, j)
                break
        if bad is None:
            break
        gi, starts, j = bad
        if j < len(rows):
            pinned[j] = False          # take in the next line(s)
        elif gi > 0 and pinned[starts[gi]]:
            pinned[starts[gi]] = False  # last group: join the one before
        else:
            print("  the whole song has more syllables than melody places")
            break
    pins = []
    for i, (x, c0) in enumerate(rows):
        if not pinned[i]:
            continue
        bi = max(k for k, b in enumerate(bars) if b <= c0)
        beat = 1 + (c0 - bars[bi]) / spb
        pins.append(f"--pin {i}={bi + 1}.{beat:.2f}")   # relyric reads BAR.BEAT with a fractional beat
    Path(a.out).write_text("\n".join(r[0] for r in rows) + "\n", encoding="utf-8")
    print(f"{len(rows)} lines ({len(pins)} pinned), {sum(counts)} syllables, "
          f"{len(mel)} melody notes, {room_in(-1e9, 1e9)} places")
    print("PINS " + " ".join(pins))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
