"""One-off patch (2026-10-11): private score library served by the bridge (files stay on this PC / Google Drive,
never in the public repo because they hold copyrighted lyrics)."""
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "bridge" / "bridge.py"
s = p.read_text(encoding="utf-8")


def rep(old, new):
    global s
    assert s.count(old) == 1, f"anchor x{s.count(old)}: {old[:70]!r}"
    s = s.replace(old, new)


rep('''JOB_TIMEOUT = 45 * 60''', '''JOB_TIMEOUT = 45 * 60
# my own sheets (lyrics are copyrighted, so they live here and not in the public repo)
LIBRARY = Path(os.environ.get("UKE_LIBRARY", r"G:\\내 드라이브\\2.취미생활\\우쿨렐레\\악보"))
LIB_NAME = re.compile(r"^[^\\\\/:*?\\"<>|]{1,120}\\.json$")''')

rep('''# ---------------------------------------------------------------- running Claude''', '''# ---------------------------------------------------------------- library

_lib_cache = {}


def library_list():
    out = []
    if not LIBRARY.exists():
        return out
    for f in sorted(LIBRARY.glob("*.json")):
        try:
            st = f.stat()
            key = (f.name, st.st_mtime)
            if key not in _lib_cache:
                d = json.loads(f.read_text(encoding="utf-8"))
                m = d.get("meta", {})
                _lib_cache[key] = {"file": f.name, "title": m.get("title") or f.stem, "artist": m.get("artist", ""),
                                   "key": m.get("key", ""), "capo": d.get("capo", 0), "source": m.get("source", ""),
                                   "chords": len(d.get("chords", [])), "lyrics": len(d.get("lyrics", [])), "updated": st.st_mtime}
            out.append(_lib_cache[key])
        except Exception as e:
            out.append({"file": f.name, "title": f.stem, "error": str(e)[:120]})
    return out


def library_save(name, score):
    if not LIB_NAME.match(name or ""):
        raise ValueError("파일 이름 형식이 아님")
    if (score.get("format") or {}).get("name") != "ukulele-sheet":
        raise ValueError("우쿨렐레 악보 형식이 아님")
    LIBRARY.mkdir(parents=True, exist_ok=True)
    target = LIBRARY / name
    if target.exists():  # keep the previous version
        old = LIBRARY / "이전판"
        old.mkdir(exist_ok=True)
        os.replace(target, old / f"{target.stem}_{time.strftime('%Y%m%d-%H%M%S')}.json")
    target.write_text(json.dumps(score, ensure_ascii=False, indent=1), encoding="utf-8")
    return name


# ---------------------------------------------------------------- running Claude''')

rep('''            if path == "/jobs":
                return self.send(200, {"jobs": list_jobs()})''', '''            if path == "/jobs":
                return self.send(200, {"jobs": list_jobs()})
            if path == "/library":
                return self.send(200, {"items": library_list(), "folder": str(LIBRARY)})
            if path.startswith("/library/"):
                from urllib.parse import unquote
                name = unquote(path[len("/library/"):])
                f = LIBRARY / name
                if not LIB_NAME.match(name) or not f.exists():
                    return self.send(404, {"error": "없는 악보"})
                return self.send(200, json.loads(f.read_text(encoding="utf-8")))''')

rep('''        n = int(self.headers.get("Content-Length") or 0)
        if n > 10_000:''', '''        n = int(self.headers.get("Content-Length") or 0)
        if path == "/library":
            if n > 5_000_000:
                return self.send(413, {"error": "악보가 너무 큼"})
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
                name = library_save(str(body.get("file") or ""), body.get("score") or {})
                log(f"library saved {name}")
                return self.send(200, {"file": name})
            except (ValueError, OSError) as e:
                return self.send(400, {"error": str(e)})
        if n > 10_000:''')

p.write_text(s, encoding="utf-8")
print("ok")
