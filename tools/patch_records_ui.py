"""One-off patch (2026-10-11): records view, login dialog, saving game results with rank and personal best."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent


def patch(rel, pairs):
    p = root / rel
    s = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert s.count(old) == 1, f"{rel}: anchor x{s.count(old)}: {old[:70]!r}"
        s = s.replace(old, new)
    p.write_text(s, encoding="utf-8")


patch("index.html", [
    ('''        <button type="button" class="toggle" data-act="drill" aria-pressed="false">코드 연습</button>
      </span>''', '''        <button type="button" class="toggle" data-act="drill" aria-pressed="false">코드 연습</button>
        <button type="button" class="toggle" data-act="records" aria-pressed="false">기록</button>
      </span>'''),
    ('''    <button type="button" class="primary" data-act="transcribe">유튜브로 악보 따기</button>''',
     '''    <button type="button" class="account" data-act="account">로그인</button>
    <button type="button" class="primary" data-act="transcribe">유튜브로 악보 따기</button>'''),
    ('''    <div class="drill" hidden></div>''', '''    <div class="drill" hidden></div>
    <div class="records-view drill" hidden></div>'''),
    ('''<dialog class="dlg-lyrics">''', '''<dialog class="dlg-login">
  <form method="dialog" autocomplete="on">
    <h2>로그인</h2>
    <p class="hint">게임 기록을 계정에 저장해서 다른 기기에서도 봅니다. 처음이면 아이디와 PIN을 정하고 «가입».</p>
    <label class="row">아이디 <input type="text" name="id" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="영문 소문자·숫자 3~20자"></label>
    <label class="row">PIN <input type="password" name="pin" autocomplete="current-password" inputmode="numeric" placeholder="숫자 4~8자리"></label>
    <p class="hint lg-msg"></p>
    <div class="row end"><button value="cancel">취소</button><button type="button" data-act="lg-signup">가입</button><button type="button" class="primary" data-act="lg-login">로그인</button></div>
  </form>
</dialog>

<dialog class="dlg-lyrics">'''),
])

patch("js/main.js", [
    ('''import { alignLyrics } from "./lyrics.js";''', '''import { alignLyrics } from "./lyrics.js";
import { records, rankOf } from "./records.js";
import { Dashboard } from "./dashboard.js";
import { songKey } from "./drills.js";'''),
    ('''const drillView = new DrillView($(".drill"), {''', '''const dashboard = new Dashboard($(".records-view"), {
  onLogin: () => openLogin(),
  onLogout: async () => { await records.logout(); syncAccount(); dashboard.show(true); },
});

const drillView = new DrillView($(".drill:not(.records-view)"), {'''),
    ('''  "save-lib": () => saveToLibrary(),''', '''  "save-lib": () => saveToLibrary(),
  records: () => setView(view === "records" ? "sheet" : "records"),
  account: () => (records.session() ? setView("records") : openLogin()),
  "lg-login": () => doLogin(false),
  "lg-signup": () => doLogin(true),'''),
    ('''  if (v === "drill" && player.playing) pause();
  view = v;
  // chord practice has its own controls; the song's transport, chord panel and practice lane stay out of the way
  $(".transport").hidden = v === "drill";
  $(".cb-wrap").hidden = v === "drill";
  $(".game").hidden = v === "drill" || !practice.on;''', '''  const own = v === "drill" || v === "records";
  if (own && player.playing) pause();
  view = v;
  // chord practice and records have their own screens; the song's transport, chord panel and lane stay out of the way
  $(".transport").hidden = own;
  $(".cb-wrap").hidden = own;
  $(".game").hidden = own || !practice.on;
  $("[data-act=records]").setAttribute("aria-pressed", String(v === "records"));
  dashboard.show(v === "records");'''),
    ('''function showResult() {
  const r = practice.result();
  if (!r.n) return;
  const dlg = $(".dlg-gresult");''', '''function showResult() {
  const r = practice.result();
  if (!r.n) return;
  const rec = {
    time: Date.now(), song: songKey(score), title: score.meta.title || "제목 없음", artist: score.meta.artist || "",
    mode: r.mode, target: r.target, rate: player.rate, score: r.score, acc: r.acc, tacc: r.tacc, maxCombo: r.maxCombo,
    perfect: r.perfect, ok: r.ok, bad: r.bad, miss: r.miss, early: r.early, late: r.late, n: r.n, total: r.total, fullCombo: r.fullCombo,
  };
  const prevBest = records.add(rec);
  const dlg = $(".dlg-gresult");'''),
    ('''  dlg.querySelector(".gr-meta").innerHTML = `${score.meta.title || "제목 없음"} · ${modeName} · ${targetName}` +
    (r.fullCombo ? `<span class="gr-badge">FULL COMBO</span>` : "");''', '''  const rank = rankOf(r.acc);
  const best = prevBest === null ? "" : r.score > prevBest ? `<span class="gr-best">최고 기록! +${r.score - prevBest}</span>` : `<span class="hint">최고 ${prevBest}점</span>`;
  dlg.querySelector(".gr-meta").innerHTML = `<span class="gr-rank ${rank}">${rank}</span>${escHtml(score.meta.title || "제목 없음")} · ${modeName} · ${targetName}` +
    (r.fullCombo ? `<span class="gr-badge">FULL COMBO</span>` : "") + best +
    (records.session() ? "" : ` <span class="hint">이 브라우저에만 저장됨. 로그인하면 계정에 올라감</span>`);'''),
    ('''function openLyrics() {''', '''function syncAccount() {
  const s = records.session();
  const b = $("[data-act=account]");
  b.textContent = s ? s.id : "로그인";
  b.hidden = !records.available() && !s;
}

function openLogin() {
  const dlg = $(".dlg-login");
  dlg.querySelector(".lg-msg").textContent = "";
  dlg.querySelector("[name=pin]").value = "";
  dlg.showModal();
}

async function doLogin(signup) {
  const dlg = $(".dlg-login");
  const id = dlg.querySelector("[name=id]").value.trim().toLowerCase();
  const pin = dlg.querySelector("[name=pin]").value.trim();
  const msg = dlg.querySelector(".lg-msg");
  msg.textContent = signup ? "가입 중…" : "로그인 중…";
  try {
    if (signup) await records.signup(id, pin); else await records.login(id, pin);
    dlg.querySelector("[name=pin]").value = "";
    dlg.close();
    syncAccount();
    if (view === "records") dashboard.show(true);
  } catch (err) {
    msg.textContent = err.message;
  }
}

function openLyrics() {'''),
    ('''window.addEventListener("resize", () => {''', '''syncAccount();
records.flush().catch(() => {});

window.addEventListener("resize", () => {'''),
])

css = root / "css" / "app.css"
s = css.read_text(encoding="utf-8")
s += '''
/* records view */
.records-view .dr-head .sub button { margin-left: 8px; }
.db-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin: 12px auto; }
.db-tile { background: var(--panel); border-radius: 10px; padding: 10px 12px; }
.db-tile small { display: block; color: var(--ink2); font-size: 12px; }
.db-tile b { font-size: 20px; font-variant-numeric: tabular-nums; }
.db-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.db-table th, .db-table td { border-bottom: 1px solid var(--grid); padding: 7px 8px; text-align: left; vertical-align: middle; }
.db-table th { color: var(--ink2); font-weight: 600; font-size: 12px; }
.db-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.db-table td small { display: block; color: var(--ink2); font-size: 11px; }
.db-table tbody tr[data-song] { cursor: pointer; }
.db-table tbody tr[data-song]:hover { background: var(--panel); }
.db-table .up { color: #2f9e44; font-weight: 700; }
.rk { display: inline-block; min-width: 18px; text-align: center; font-weight: 900; }
.rk.S { color: #e8590c; } .rk.A { color: #2f9e44; } .rk.B { color: #1c7ed6; } .rk.C, .rk.D { color: var(--ink2); }
.spark polyline { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; }
.spark circle { fill: var(--accent); }
.db-chart { position: relative; margin: 10px 0 14px; }
.db-chart .gl { stroke: var(--grid); stroke-width: 1; }
.db-chart .gt { fill: var(--ink2); font-size: 11px; }
.db-chart .ln { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; }
.db-chart .pt { fill: var(--accent); stroke: var(--paper); stroke-width: 2; }
.db-chart .pt:hover { r: 7; }
.db-tip { position: absolute; background: var(--paper); border: 1px solid var(--btn-b); border-radius: 6px; padding: 4px 8px; font-size: 12px; pointer-events: none; box-shadow: var(--shadow); }
button.account { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
'''
css.write_text(s, encoding="utf-8")
print("ok")
