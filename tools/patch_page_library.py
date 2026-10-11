"""One-off patch (2026-10-11): page side of the private library (examples dialog + save to library)."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent


def patch(rel, pairs):
    p = root / rel
    s = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert s.count(old) == 1, f"{rel}: anchor x{s.count(old)}: {old[:70]!r}"
        s = s.replace(old, new)
    p.write_text(s, encoding="utf-8")


patch("js/bridge.js", [
    ('''  cancel: (id) => call(`/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),''',
     '''  cancel: (id) => call(`/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  library: () => call("/library"),
  libraryGet: (file) => call(`/library/${encodeURIComponent(file)}`),
  librarySave: (file, score) => call("/library", { method: "POST", body: { file, score } }),'''),
])

patch("js/main.js", [
    ('''async function openExamples() {
  const dlg = $(".dlg-examples");
  const list = dlg.querySelector(".ex-list");
  list.textContent = "불러오는 중…";
  dlg.showModal();
  try {
    const items = await (await fetch("examples/manifest.json")).json();
    list.innerHTML = "";
    for (const it of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<b>${it.title}</b> <small>${it.note || ""}</small>`;
      b.addEventListener("click", async () => { dlg.close(); await loadExample(it.file); });
      list.appendChild(b);
    }
  } catch (err) {
    list.textContent = `예제 목록을 못 불러옴: ${err.message}`;
  }
}''', '''const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let libraryFile = null; // file name in my library of the score that is open, so saving writes back to it

async function openExamples() {
  const dlg = $(".dlg-examples");
  const list = dlg.querySelector(".ex-list");
  const mine = dlg.querySelector(".lib-list");
  list.textContent = "";
  mine.textContent = "";
  dlg.showModal();
  const filter = dlg.querySelector(".lib-filter");
  try {
    const { items } = await bridge.library();
    const draw = () => {
      const q = filter.value.trim().toLowerCase();
      mine.innerHTML = "";
      for (const it of items.filter((x) => !q || `${x.title} ${x.artist}`.toLowerCase().includes(q))) {
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = `<b>${escHtml(it.title)}</b> <small>${escHtml(it.artist)}${it.capo ? ` · 카포 ${it.capo}` : ""}${it.key ? ` · ${escHtml(it.key)}` : ""}</small>`;
        b.addEventListener("click", async () => {
          dlg.close();
          try {
            const obj = await bridge.libraryGet(it.file);
            setScore(loadAnyFormat(obj));
            libraryFile = it.file;
            seek(0);
          } catch (err) { status(`악보를 못 엶: ${err.message}`, true); }
        });
        mine.appendChild(b);
      }
      if (!mine.children.length) mine.textContent = items.length ? "맞는 곡 없음" : "아직 없음";
    };
    filter.oninput = draw;
    draw();
  } catch (err) {
    mine.textContent = `내 PC에 연결되지 않아 못 불러옴 (${err.message})`;
  }
  try {
    const items = await (await fetch("examples/manifest.json")).json();
    for (const it of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<b>${escHtml(it.title)}</b> <small>${escHtml(it.note || "")}</small>`;
      b.addEventListener("click", async () => { dlg.close(); await loadExample(it.file); });
      list.appendChild(b);
    }
  } catch (err) {
    list.textContent = `예제 목록을 못 불러옴: ${err.message}`;
  }
}

async function saveToLibrary() {
  const def = libraryFile || `${(score.meta.title || "새 악보").replace(/[\\\\/:*?"<>|]/g, "_")}${score.meta.artist ? " - " + score.meta.artist.replace(/[\\\\/:*?"<>|]/g, "_") : ""}.uke.json`;
  const name = prompt("내 악보함에 저장할 파일 이름", def);
  if (!name) return;
  const file = name.endsWith(".json") ? name : `${name}.json`;
  try {
    await bridge.librarySave(file, JSON.parse(toJSON(score)));
    libraryFile = file;
  } catch (err) {
    status(`저장 못 함: ${err.message}`, true);
  }
}'''),
    ('''  examples: () => openExamples(),''', '''  examples: () => openExamples(),
  "save-lib": () => saveToLibrary(),'''),
    ('''  setScore(loadAnyFormat(obj));
  seek(0);
}''', '''  setScore(loadAnyFormat(obj));
  libraryFile = null;
  seek(0);
}'''),
])

patch("index.html", [
    ('''          <button type="button" data-act="examples">예제</button>''',
     '''          <button type="button" data-act="examples">예제·내 악보</button>
          <button type="button" data-act="save-lib">내 악보함에 저장</button>'''),
    ('''    <h2>예제</h2>
    <div class="ex-list"></div>''', '''    <h2>내 악보 <small class="hint">이 PC의 구글 드라이브 우쿨렐레 폴더</small></h2>
    <input type="search" class="lib-filter" placeholder="제목·가수 찾기">
    <div class="lib-list ex-list"></div>
    <h2>예제</h2>
    <div class="ex-list"></div>'''),
])
print("ok")
