"""Build the guitar site (repository bareblackfoot/guitar-tab, https://bareblackfoot.github.io/guitar-tab/) from
this repository. The code is the same; js/site.js says "guitar" and the page texts name the guitar.
Run it after changing the page, then commit and push both repositories.

    python tools/build_guitar.py [--out D:/codes/guitar-tab]

Each replacement below must match exactly once, so a changed sentence in index.html or help.html stops the build
instead of leaving ukulele words on the guitar site.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent
COPY_DIRS = ["css", "js", "examples"]
COPY_FILES = [".nojekyll", ".gitattributes"]

GUITAR_ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
               "%3Cpath d='M16 1v13' stroke='%23a8743f' stroke-width='3'/%3E%3Ccircle cx='16' cy='16' r='6' fill='%23a8743f'/%3E"
               "%3Ccircle cx='16' cy='24' r='7.5' fill='%23a8743f'/%3E%3Ccircle cx='16' cy='20' r='2.3' fill='%23fff'/%3E%3C/svg%3E")

INDEX = [
    ("<title>우쿨렐레 코드 악보</title>", "<title>기타 코드 악보</title>"),
    ("유튜브에 맞춰 재생하는 우쿨렐레 코드·TAB 악보.", "유튜브에 맞춰 재생하는 기타 코드·TAB 악보."),
    ("<b>우쿨렐레 코드 악보</b>", "<b>기타 코드 악보</b>"),
    ("JSON 열기 (우쿨렐레·SPRED)", "JSON 열기 (기타·우쿨렐레·SPRED)"),
    ("가로 (A현이 위)", "가로 (1번 줄이 위)"),
    ("이 PC의 구글 드라이브 우쿨렐레 폴더", "이 PC의 구글 드라이브 기타 폴더"),
    ("멜로디를 우쿨렐레로 옮기기", "멜로디를 기타로 옮기기"),
    ("기타 악보 사이트로", "우쿨렐레 악보 사이트로"),
]

HELP = [
    ("<title>사용법 · 우쿨렐레 코드 악보</title>", "<title>사용법 · 기타 코드 악보</title>"),
    ("<h1>우쿨렐레 코드 악보 사용법</h1>", "<h1>기타 코드 악보 사용법</h1>"),
    ("왼쪽 굵은 선이 너트, 맨 위 줄이 A현, 맨 아래 줄이 G현입니다.",
     "왼쪽 굵은 선이 너트, 맨 위 줄이 1번 줄(높은 E), 맨 아래 줄이 6번 줄(낮은 E)입니다. ×를 붙인 줄은 치지 않습니다."),
    ("줄 4개(위에서부터 A, E, C, G)", "줄 6개(위에서부터 e, B, G, D, A, E)"),
    ("기록은 이 PC의 구글 드라이브 우쿨렐레 폴더에 아이디별로 저장됩니다.",
     "기록은 이 PC의 구글 드라이브에 아이디별로 저장됩니다. 아이디는 우쿨렐레 사이트와 같이 씁니다."),
    ("<th>줄 칸(A·E·C·G)</th>", "<th>줄 칸(e·B·G·D·A·E)</th>"),
    ("SPRED 악보는 멜로디를 우쿨렐레 줄·프렛으로 바꿔서 엽니다.",
     "SPRED 악보는 멜로디를 기타 줄·프렛으로 바꿔서 엽니다. 우쿨렐레 악보는 소리는 그대로 두고 기타 코드가 가장 쉬운 카포로 옮겨서 엽니다."),
    ("튜닝(High-G·Low-G)", "튜닝(표준·Drop D)"),
    ("(예: 원곡이 Gb조면 카포 6에 C 운지)", "(예: 원곡이 Bb조면 카포 3에 G 운지)"),
    ("내 악보는 이 PC의 구글 드라이브 우쿨렐레 폴더에 있습니다", "내 악보는 이 PC의 구글 드라이브 기타 폴더에 있습니다"),
    ("<h2>게임 모드 (리듬게임)</h2>", """<h2>일렉기타</h2>
<ul>
<li>위쪽 <b>통기타 / 일렉</b>에서 일렉을 고르면 카포 없이 원래 조로 보여 줍니다. F·Bm 같은 코드는 barre(검지 하나로 여러 줄을 한꺼번에 누르는 운지)로 나옵니다. 저장되는 악보는 통기타판(카포 포함) 그대로이고, 편집 화면도 그 악보를 보여 줍니다.</li>
<li>보기 → <b>일렉: 파워코드로 보기</b>: 모든 코드를 근음과 5도만 치는 파워코드(예: E5 = 0 2 2 x x x)로 바꿔 보여 줍니다. 장조·단조 구분이 없어집니다. 스트럼 연습의 코드도 파워코드로 바뀝니다.</li>
<li>보기 → <b>일렉 소리</b>: 재생 소리를 깨끗한 일렉 소리나 overdrive(조금 찌그러진 소리)로 고릅니다.</li>
<li>기타를 오디오 인터페이스에 꽂았으면 보기 → 소리 입력 장치에서 그 장치를 고르면 게임 판정에 기타 소리가 바로 들어갑니다.</li>
</ul>

<h2>게임 모드 (리듬게임)</h2>"""),
]

README = """# 기타 코드 악보

https://bareblackfoot.github.io/guitar-tab/

유튜브에 맞춰 재생하는 기타 코드·TAB 악보. 우쿨렐레 코드 악보(https://github.com/bareblackfoot/ukulele-tab)와
같은 코드이고, 이 저장소의 파일은 그쪽의 `tools/build_guitar.py`가 만든다. 고칠 때는 ukulele-tab에서 고치고 다시 만든다.
"""


def replace_all(text, pairs, what):
    for old, new in pairs:
        n = text.count(old)
        if n != 1:
            sys.exit(f"{what}: '{old}' 가 {n}번 나옴 (1번이어야 함)")
        text = text.replace(old, new)
    return text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(SRC.parent / "guitar-tab"))
    out = Path(ap.parse_args().out)
    out.mkdir(parents=True, exist_ok=True)
    for d in COPY_DIRS:
        if (out / d).exists():
            shutil.rmtree(out / d)
        shutil.copytree(SRC / d, out / d, ignore=shutil.ignore_patterns("__pycache__"))
    for f in COPY_FILES:
        shutil.copy2(SRC / f, out / f)
    (out / "js" / "site.js").write_text((SRC / "js" / "site.js").read_text(encoding="utf-8")
                                        .replace('export const SITE = "ukulele";', 'export const SITE = "guitar";'), encoding="utf-8")
    assert 'SITE = "guitar"' in (out / "js" / "site.js").read_text(encoding="utf-8")

    idx = (SRC / "index.html").read_text(encoding="utf-8")
    idx = replace_all(idx, INDEX, "index.html")
    start = idx.index('<link rel="icon" href="') + len('<link rel="icon" href="')
    idx = idx[:start] + GUITAR_ICON + idx[idx.index('"', start):]
    (out / "index.html").write_text(idx, encoding="utf-8")
    hlp = replace_all((SRC / "help.html").read_text(encoding="utf-8"), HELP, "help.html")
    (out / "help.html").write_text(hlp, encoding="utf-8")
    (out / "README.md").write_text(README, encoding="utf-8")

    # ukulele words left on the guitar pages (the menu link back and the file types it opens are meant)
    for name in ["index.html", "help.html"]:
        for line in (out / name).read_text(encoding="utf-8").splitlines():
            if "우쿨렐레" in line and "우쿨렐레 악보 사이트로" not in line and "기타·우쿨렐레·SPRED" not in line \
                    and "우쿨렐레 사이트와 같이" not in line and "우쿨렐레 악보는" not in line:
                sys.exit(f"{name}에 우쿨렐레 문구가 남음: {line.strip()[:100]}")
    subprocess.run([sys.executable, str(SRC / "tools" / "stamp.py"), str(out)], check=True)
    print("built", out)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
