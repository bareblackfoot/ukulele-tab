"""Build the otamatone site (repository bareblackfoot/otamatone-tab, https://bareblackfoot.github.io/otamatone-tab/)
from this repository. The code is the same; js/site.js says "otamatone", the page texts name the otamatone, and
the help page is tools/otamatone_help.html (the chord parts of help.html do not apply). Run it after changing
the page, then commit and push both repositories.

    python tools/build_otamatone.py [--out D:/codes/otamatone-tab]

Each replacement below must match exactly once, so a changed sentence in index.html stops the build instead of
leaving ukulele words on the otamatone site.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_guitar import SRC, COPY_DIRS, COPY_FILES, replace_all  # noqa: E402

# a round head with a mouth on a stem, like the toy
ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
        "%3Cpath d='M21 2v17' stroke='%23a8743f' stroke-width='3' stroke-linecap='round'/%3E"
        "%3Ccircle cx='14' cy='22' r='9' fill='%23a8743f'/%3E%3Ccircle cx='11' cy='20' r='1.6' fill='%23fff'/%3E"
        "%3Ccircle cx='17' cy='20' r='1.6' fill='%23fff'/%3E%3Cellipse cx='14' cy='26' rx='3' ry='2' fill='%23fff'/%3E%3C/svg%3E")

INDEX = [
    ("<title>우쿨렐레 코드 악보</title>", "<title>오타마톤 악보</title>"),
    ('<meta name="description" content="유튜브에 맞춰 재생하는 우쿨렐레 코드·TAB 악보. 위쪽에 다음 코드 운지가 뜸.">',
     '<meta name="description" content="유튜브에 맞춰 재생하는 오타마톤 악보. SPRED처럼 음 높이 칸으로 보이고, 게임 모드에서 마이크로 음높이를 판정함.">'),
    ("<b>우쿨렐레 코드 악보</b>", "<b>오타마톤 악보</b>"),
    ("JSON 열기 (우쿨렐레·SPRED)", "JSON 열기 (SPRED·우쿨렐레·기타)"),
    ("이 PC의 구글 드라이브 우쿨렐레 폴더", "이 PC의 구글 드라이브 오타마톤 폴더"),
    ("멜로디를 우쿨렐레로 옮기기", "멜로디를 오타마톤으로 옮기기"),
    ('<div class="sheet" tabindex="0" aria-label="코드 악보"></div>', '<div class="sheet" tabindex="0" aria-label="오타마톤 악보"></div>'),
    ("곡 정보·튜닝·카포", "곡 정보·조옮김"),
    ("들린 코드/음", "들린 음"),
]

README = """# 오타마톤 악보

https://bareblackfoot.github.io/otamatone-tab/

유튜브에 맞춰 재생하는 오타마톤 악보. SPRED처럼 음 높이 칸으로 보이고, 게임 모드에서 마이크로 음높이를 판정한다.
우쿨렐레 코드 악보(https://github.com/bareblackfoot/ukulele-tab)와 같은 코드이고, 이 저장소의 파일은 그쪽의
`tools/build_otamatone.py`가 만든다. 고칠 때는 ukulele-tab에서 고치고 다시 만든다.
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(SRC.parent / "otamatone-tab"))
    out = Path(ap.parse_args().out)
    out.mkdir(parents=True, exist_ok=True)
    for d in COPY_DIRS:
        if (out / d).exists():
            shutil.rmtree(out / d)
        shutil.copytree(SRC / d, out / d, ignore=shutil.ignore_patterns("__pycache__"))
    for f in COPY_FILES:
        shutil.copy2(SRC / f, out / f)
    (out / "js" / "site.js").write_text((SRC / "js" / "site.js").read_text(encoding="utf-8")
                                        .replace('export const SITE = "ukulele";', 'export const SITE = "otamatone";'), encoding="utf-8")
    assert 'SITE = "otamatone"' in (out / "js" / "site.js").read_text(encoding="utf-8")

    idx = replace_all((SRC / "index.html").read_text(encoding="utf-8"), INDEX, "index.html")
    start = idx.index('<link rel="icon" href="') + len('<link rel="icon" href="')
    idx = idx[:start] + ICON + idx[idx.index('"', start):]
    (out / "index.html").write_text(idx, encoding="utf-8")
    shutil.copy2(SRC / "tools" / "otamatone_help.html", out / "help.html")
    (out / "README.md").write_text(README, encoding="utf-8")

    # ukulele words left where the otamatone site shows them (hidden chord-only parts and the file types it
    # opens are meant)
    for line in (out / "index.html").read_text(encoding="utf-8").splitlines():
        if "우쿨렐레" in line and "SPRED·우쿨렐레·기타" not in line and "chord-only" not in line \
                and "기타 악보 사이트로" not in line and "High-G" not in line:
            sys.exit(f"index.html에 우쿨렐레 문구가 남음: {line.strip()[:100]}")
    subprocess.run([sys.executable, str(SRC / "tools" / "stamp.py"), str(out)], check=True)
    print("built", out)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
