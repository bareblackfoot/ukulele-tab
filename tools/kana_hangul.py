"""Japanese kana -> Hangul pronunciation, one Hangul syllable per sung unit.

ん and っ become the final consonant of the syllable before them (なんだ -> 난다, しめって -> 시멧테), ー and
small vowels lengthen the syllable before them (バター -> 바타), k/t are written aspirated as Korean
ukulele sheets usually do (かと -> 카토), and the particle は is expected to be written わ in the input.
"""

BASE = {
    "あ": "아", "い": "이", "う": "우", "え": "에", "お": "오",
    "か": "카", "き": "키", "く": "쿠", "け": "케", "こ": "코",
    "が": "가", "ぎ": "기", "ぐ": "구", "げ": "게", "ご": "고",
    "さ": "사", "し": "시", "す": "스", "せ": "세", "そ": "소",
    "ざ": "자", "じ": "지", "ず": "즈", "ぜ": "제", "ぞ": "조",
    "た": "타", "ち": "치", "つ": "츠", "て": "테", "と": "토",
    "だ": "다", "ぢ": "지", "づ": "즈", "で": "데", "ど": "도",
    "な": "나", "に": "니", "ぬ": "누", "ね": "네", "の": "노",
    "は": "하", "ひ": "히", "ふ": "후", "へ": "헤", "ほ": "호",
    "ば": "바", "び": "비", "ぶ": "부", "べ": "베", "ぼ": "보",
    "ぱ": "파", "ぴ": "피", "ぷ": "푸", "ぺ": "페", "ぽ": "포",
    "ま": "마", "み": "미", "む": "무", "め": "메", "も": "모",
    "や": "야", "ゆ": "유", "よ": "요",
    "ら": "라", "り": "리", "る": "루", "れ": "레", "ろ": "로",
    "わ": "와", "を": "오", "ゔ": "부",
}
# i-row kana + small ya/yu/yo
YOON = {"ゃ": ("ㅑ", "야"), "ゅ": ("ㅠ", "유"), "ょ": ("ㅛ", "요")}
LENGTHEN = set("ぁぃぅぇぉゎー〜~")
FINAL = {"ん": 4, "っ": 19}   # jongseong index of ㄴ and ㅅ
VOWELS = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"


def hira(ch):
    o = ord(ch)
    return chr(o - 0x60) if 0x30A1 <= o <= 0x30F6 else ch


def _with_final(syl, idx):
    o = ord(syl) - 0xAC00
    if not 0 <= o < 11172 or o % 28:
        return syl
    return chr(ord(syl) + idx)


def _with_vowel(syl, jamo):
    o = ord(syl) - 0xAC00
    lead, _, tail = o // 588, (o % 588) // 28, o % 28
    return chr(0xAC00 + lead * 588 + VOWELS.index(jamo) * 28 + tail)


def units(text):
    """kana string (one word) -> [(hangul, index of the first kana)]"""
    out = []
    for i, raw in enumerate(text):
        ch = hira(raw)
        if ch in FINAL and out:
            out[-1] = (_with_final(out[-1][0], FINAL[ch]), out[-1][1])
        elif ch in YOON and out:
            out[-1] = (_with_vowel(out[-1][0], YOON[ch][0]), out[-1][1])
        elif ch in LENGTHEN and out:
            continue
        elif ch in BASE:
            out.append((BASE[ch], i))
        elif ch in FINAL:
            out.append(("은" if ch == "ん" else "읏", i))
        elif ch in YOON:
            out.append((YOON[ch][1], i))
        # anything else (kanji, punctuation) is dropped; read kanji into kana first
    return out


def line(text):
    """kana line with spaces between words -> Hangul line with the same spaces"""
    return " ".join("".join(u for u, _ in units(w)) for w in text.split())


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    for s in ["こんにちは せんせい", "きって", "コーヒー", "きゃきゅきょ"]:
        print(s, "->", line(s))
