"""One-off patch (2026-10-11): my library only for the owner account (nurikim). The session goes in X-Session
for GET and in the body for POST; other accounts and logged-out pages get 403 and the page hides the section."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent


def patch(rel, pairs):
    p = root / rel
    s = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert s.count(old) == 1, f"{rel}: anchor x{s.count(old)}: {old[:70]!r}"
        s = s.replace(old, new)
    p.write_text(s, encoding="utf-8")


patch("bridge/bridge.py", [
    ('''def library_save(name, score):''', '''def library_owners():
    """accounts that may see and change my library (bridge/state/config.json "libraryOwners", default nurikim)"""
    cfg = _jload(STATE_DIR / "config.json", {}) if (STATE_DIR / "config.json").exists() else {}
    return set(cfg.get("libraryOwners") or ["nurikim"])


def library_auth(session):
    """id of the logged-in owner, or raises PermissionError"""
    try:
        uid = _auth(session)
    except PermissionError:
        raise PermissionError("내 악보는 로그인해야 볼 수 있음")
    if uid not in library_owners():
        raise PermissionError("내 악보는 주인 아이디로 로그인해야 볼 수 있음")
    return uid


def library_save(name, score):'''),
    ('''            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Token")''',
     '''            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Token, X-Session")'''),
    ('''            if path == "/library":
                return self.send(200, {"items": library_list(), "folder": str(LIBRARY)})
            if path.startswith("/library/"):
                from urllib.parse import unquote''', '''            if path == "/library" or path.startswith("/library/"):
                try:
                    library_auth(self.headers.get("X-Session"))
                except PermissionError as e:
                    return self.send(403, {"error": str(e)})
            if path == "/library":
                return self.send(200, {"items": library_list(), "folder": str(LIBRARY)})
            if path.startswith("/library/"):
                from urllib.parse import unquote'''),
    ('''                body = json.loads(self.rfile.read(n) or b"{}")
                name = library_save(str(body.get("file") or ""), body.get("score") or {})''',
     '''                body = json.loads(self.rfile.read(n) or b"{}")
                try:
                    library_auth(body.get("session"))
                except PermissionError as e:
                    return self.send(403, {"error": str(e)})
                name = library_save(str(body.get("file") or ""), body.get("score") or {})'''),
])

patch("js/bridge.js", [
    ('''async function call(path, { method = "GET", body } = {}) {''', '''async function call(path, { method = "GET", body, headers = {} } = {}) {'''),
    ('''      headers: { "X-Bridge-Token": s.token, ...(body ? { "Content-Type": "application/json" } : {}) },''',
     '''      headers: { "X-Bridge-Token": s.token, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },'''),
    ('''  library: () => call("/library"),
  libraryGet: (file) => call(`/library/${encodeURIComponent(file)}`),
  librarySave: (file, score) => call("/library", { method: "POST", body: { file, score } }),''',
     '''  // my library needs the owner's login session
  library: (session) => call("/library", { headers: { "X-Session": session || "" } }),
  libraryGet: (file, session) => call(`/library/${encodeURIComponent(file)}`, { headers: { "X-Session": session || "" } }),
  librarySave: (file, score, session) => call("/library", { method: "POST", body: { file, score, session } }),'''),
])

patch("js/main.js", [
    ('''  const filter = dlg.querySelector(".lib-filter");
  try {
    const { items } = await bridge.library();''', '''  const filter = dlg.querySelector(".lib-filter");
  const sess = records.session();
  // my library is only for the owner account; everyone else does not see the section at all
  dlg.querySelectorAll(".lib-part").forEach((el) => { el.hidden = true; });
  try {
    if (!sess) throw Object.assign(new Error("로그인 안 함"), { status: 403 });
    const { items } = await bridge.library(sess.session);
    dlg.querySelectorAll(".lib-part").forEach((el) => { el.hidden = false; });'''),
    ('''            const obj = await bridge.libraryGet(it.file);''', '''            const obj = await bridge.libraryGet(it.file, sess.session);'''),
    ('''  } catch (err) {
    mine.textContent = `내 PC에 연결되지 않아 못 불러옴 (${err.message})`;
  }''', '''  } catch (err) {
    if (err.status !== 403) {
      dlg.querySelectorAll(".lib-part").forEach((el) => { el.hidden = false; });
      mine.textContent = `내 PC에 연결되지 않아 못 불러옴 (${err.message})`;
    }
  }'''),
    ('''    await bridge.librarySave(file, JSON.parse(toJSON(score)));''',
     '''    const sess = records.session();
    if (!sess) throw new Error("내 악보함은 주인 아이디로 로그인해야 쓸 수 있음");
    await bridge.librarySave(file, JSON.parse(toJSON(score)), sess.session);'''),
    ('''function syncAccount() {
  const s = records.session();
  const b = $("[data-act=account]");
  b.textContent = s ? s.id : "로그인";
  b.hidden = false;
}''', '''function syncAccount() {
  const s = records.session();
  const b = $("[data-act=account]");
  b.textContent = s ? s.id : "로그인";
  b.hidden = false;
  // saving to my library only makes sense for the owner; the bridge checks again
  $("[data-act=save-lib]").hidden = !s;
  $("[data-act=examples]").textContent = s ? "예제·내 악보" : "예제";
}'''),
])

patch("index.html", [
    ('''    <h2>내 악보 <small class="hint">이 PC의 구글 드라이브 우쿨렐레 폴더</small></h2>
    <input type="search" class="lib-filter" placeholder="제목·가수 찾기">
    <div class="lib-list ex-list"></div>''', '''    <h2 class="lib-part" hidden>내 악보 <small class="hint">이 PC의 구글 드라이브 우쿨렐레 폴더</small></h2>
    <input type="search" class="lib-filter lib-part" placeholder="제목·가수 찾기" hidden>
    <div class="lib-list ex-list lib-part" hidden></div>'''),
])
print("ok")
