"""One-off patch: wire practice mode and the chord practice view into js/main.js (anchors must match once)."""
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "js" / "main.js"
s = p.read_text(encoding="utf-8")
before = len(s)


def rep(old, new):
    global s
    assert s.count(old) == 1, f"anchor not found once: {old[:70]!r} ({s.count(old)})"
    s = s.replace(old, new)


rep('''import { bridge, bridgeSettings, saveBridgeSettings } from "./bridge.js";''',
    '''import { bridge, bridgeSettings, saveBridgeSettings } from "./bridge.js";
import { Practice, calibrate } from "./practice.js";
import { DrillView } from "./drills_view_shim.js";
import { changeDrill, PASS, STEPS } from "./drills.js";''')

rep('''let editing = false;''', '''let editing = false;
let view = "sheet";       // "sheet" | "edit" | "drill"
let songScore = null;     // the song while a chord-change drill score is loaded
let resultCtx = { kind: "free" };''')

rep('''  onSeek: (col) => seek(col),
  status,
});
''', '''  onSeek: (col) => seek(col),
  status,
});

const practice = new Practice(engine, player, {
  lane: $(".g-lane"),
  judge: $(".g-judge"),
  onMark: (col, grade) => sheet.mark(col, grade),
  clearMarks: () => sheet.clearMarks(),
  status,
  syncControls: () => syncPracticeControls(),
  counts: (st) => {
    for (const el of $$(".g-counts [data-c]")) {
      const k = el.dataset.c;
      el.textContent = k === "acc" || k === "tacc" ? `${st[k]}%` : String(st[k]);
    }
  },
  heard: (txt) => { $(".g-heard").textContent = txt; },
  level: (v) => { $(".g-meter i").style.width = `${Math.min(100, Math.sqrt(v) * 400)}%`; },
});

const drillView = new DrillView($(".drill"), {
  engine, practice, settings, status,
  startChangeDrill: (a, b, opts) => startChangeDrill(a, b, opts),
  startSongStep: (step) => startSongStep(step),
});
''')

rep('''  player.setScore(score);
  chordbar.setScore(score, settings);''', '''  player.setScore(score);
  practice.setScore(score);
  drillView.setScore(score);
  chordbar.setScore(score, settings);''')

rep('''  saveTimer = setTimeout(() => store.set("uketab.last", JSON.parse(toJSON(score))), 400);''',
    '''  if (score.drill) return; // generated drill scores are not kept
  saveTimer = setTimeout(() => store.set("uketab.last", JSON.parse(toJSON(score))), 400);''')

rep('''  if (!seeking) $(".seek").value = String(Math.round((col / Math.max(1, score.columnCount)) * 1000));
}''', '''  if (!seeking) $(".seek").value = String(Math.round((col / Math.max(1, score.columnCount)) * 1000));
  if (practice.on && !player.playing) practice.drawLane();
}''')

rep('''  const col = player.position();
  updatePosition(col);''', '''  const col = player.position();
  updatePosition(col);
  practice.frame();''')

rep('''function seek(col) {
  col = Math.max(0, Math.min(score.columnCount, col));
  player.seek(col);''', '''function seek(col) {
  col = Math.max(0, Math.min(score.columnCount, col));
  practice.rewind(col);
  player.seek(col);''')

rep('''  if (type === "loop" && ytActive()) setTimeout(() => yt.start(player.scoreTime(), player.rate), 0);
});''', '''  if (type === "loop" && ytActive()) setTimeout(() => yt.start(player.scoreTime(), player.rate), 0);
  if (type === "loop" && loopState) practice.rewind(loopState.start);
  if (type === "end") {
    $(".play").textContent = "▶";
    yt.pause();
    if (practice.on) setTimeout(() => showResult(), 300);
  }
});''')

rep('''  edit: () => setEditing(!editing),''', '''  edit: () => setView(view === "edit" ? "sheet" : "edit"),
  "view-sheet": () => setView("sheet"),
  drill: () => setView(view === "drill" ? "sheet" : "drill"),
  practice: () => togglePractice(),
  "g-rules": () => $(".dlg-grules").showModal(),
  "g-sync": () => openSync(),
  "gr-retry": () => { $(".dlg-gresult").close(); retry(); },
  "gr-next": () => { $(".dlg-gresult").close(); nextStep(); },''')

rep('''function setEditing(on) {
  editing = on;
  $("[data-act=edit]").setAttribute("aria-pressed", String(on));
  $(".editor").hidden = !on;
  $(".sheet").hidden = on;
  if (on) { editor.layout(); editor.setPlayhead(player.position(), false); $(".ed-scroll").focus(); }
  else sheet.render(score, settings);
  updatePosition(player.position());
}''', '''function setEditing(on) { setView(on ? "edit" : "sheet"); }

function setView(v) {
  if (v === "edit" && practice.on) { status("연습 모드 중에는 편집할 수 없음. 연습 모드를 먼저 끄세요", true); return; }
  if (v !== "drill" && score.drill) restoreSong();
  view = v;
  editing = v === "edit";
  $("[data-act=view-sheet]").setAttribute("aria-pressed", String(v === "sheet"));
  $("[data-act=edit]").setAttribute("aria-pressed", String(v === "edit"));
  $("[data-act=drill]").setAttribute("aria-pressed", String(v === "drill"));
  $(".editor").hidden = v !== "edit";
  $(".sheet").hidden = v !== "sheet";
  drillView.show(v === "drill");
  if (v === "edit") { editor.layout(); editor.setPlayhead(player.position(), false); $(".ed-scroll").focus(); }
  if (v === "sheet") sheet.render(score, settings);
  updatePosition(player.position());
}

// ---------------------------------------------------------------- practice mode

function syncPracticeControls() {
  $(".g-target").value = practice.target;
  $(".g-input").value = practice.input;
  $$(".g-modes [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === practice.mode)));
  const v = practice.offsetMs;
  $(".g-sync-val").textContent = `${v >= 0 ? "+" : ""}${v} ms`;
  $(".gs-val").textContent = `${v >= 0 ? "+" : ""}${v} ms`;
  const st = $(".g-state");
  st.textContent = !practice.on ? "꺼짐" : practice.input === "keys" ? "키보드 F·J" : practice.mic ? "마이크 켜짐" : "마이크 없음";
  st.classList.toggle("live", practice.on && (practice.input === "keys" || !!practice.mic));
  $(".g-mic").textContent = practice.mic ? "켜짐" : practice.input === "keys" ? "안 씀" : "--";
}

async function togglePractice(force) {
  const on = force ?? !practice.on;
  const btn = $("[data-act=practice]");
  if (on) {
    if (view === "edit") setView("sheet");
    $(".game").hidden = false;
    btn.setAttribute("aria-pressed", "true");
    await practice.start();
    if (practice.input === "mic" && practice.mic) status("연습 모드: 재생하면 레인의 동그라미가 빨간 선에 닿을 때 치세요");
    if (practice.input === "keys") status("연습 모드(키보드): 박에 맞춰 F나 J 키를 누르세요");
  } else {
    const had = practice.stats.n > 0;
    practice.stop();
    $(".game").hidden = true;
    btn.setAttribute("aria-pressed", "false");
    if (had && !player.playing) showResult();
    resultCtx = { kind: "free" };
  }
  syncPracticeControls();
  updatePosition(player.position());
}

$(".g-target").addEventListener("change", (e) => {
  practice.target = e.target.value;
  store.set("uketab.practice.target", practice.target);
  practice.buildTargets();
  practice.rewind(player.position());
});
$(".g-input").addEventListener("change", async (e) => {
  practice.input = e.target.value;
  store.set("uketab.practice.input", practice.input);
  if (practice.on && practice.input === "mic") await practice.ensureMic();
  syncPracticeControls();
});
$$(".g-modes [data-mode]").forEach((b) => b.addEventListener("click", () => {
  practice.mode = b.dataset.mode;
  store.set("uketab.practice.mode", practice.mode);
  syncPracticeControls();
}));
document.addEventListener("keydown", (e) => {
  if (!practice.on || practice.input !== "keys" || e.repeat) return;
  if (e.target.closest("input, select, textarea")) return;
  if (["f", "j", "F", "J", "d", "k"].includes(e.key)) { e.preventDefault(); practice.keyStrum(); }
});

function setSync(v) {
  practice.offsetMs = Math.max(-200, Math.min(500, Math.round(v)));
  store.set("uketab.practice.offset", practice.offsetMs);
  syncPracticeControls();
}
function openSync() {
  if (player.playing) pause();
  $(".gs-msg").textContent = "";
  $$(".gs-meter .gs-dot").forEach((d) => d.remove());
  syncPracticeControls();
  $(".dlg-gsync").showModal();
}
$$(".dlg-gsync [data-d]").forEach((b) => b.addEventListener("click", () => {
  setSync(b.dataset.d === "reset" ? 80 : practice.offsetMs + +b.dataset.d);
}));
$(".dlg-gsync [data-act=gs-auto]").addEventListener("click", async () => {
  const msg = $(".gs-msg");
  const meter = $(".gs-meter");
  $$(".gs-meter .gs-dot").forEach((d) => d.remove());
  if (practice.input !== "mic") { msg.textContent = "입력이 키보드라서 자동 맞추기를 못 함"; return; }
  if (!(await practice.ensureMic())) { msg.textContent = "마이크를 못 씀"; return; }
  msg.textContent = "딸깍 소리에 맞춰 10번 치세요…";
  try {
    const v = await calibrate(engine, practice, {
      onTick: (d) => {
        const dot = document.createElement("span");
        dot.className = "gs-dot";
        dot.style.left = `${50 + (d / 300) * 50}%`;
        meter.appendChild(dot);
      },
    });
    setSync(v);
    msg.textContent = `맞춤: 마이크 소리가 ${v} ms 늦게 들어옴`;
  } catch (err) {
    msg.textContent = err.message;
  }
});

function showResult() {
  const r = practice.result();
  if (!r.n) return;
  const dlg = $(".dlg-gresult");
  const modeName = { easy: "쉬움", std: "보통", pro: "어려움" }[r.mode];
  const targetName = { beat: "코드 박마다", change: "코드 바뀔 때", pattern: "스트럼 패턴", melody: "멜로디" }[r.target];
  let ctxText = "";
  if (resultCtx.kind === "pair") ctxText = ` · 코드 바꾸기 ${resultCtx.key.replace("|", " ⇄ ")} ${resultCtx.bpm} BPM`;
  if (resultCtx.kind === "step") ctxText = ` · ${resultCtx.step.id}단계 ${resultCtx.step.title}`;
  dlg.querySelector(".gr-meta").innerHTML = `${(songScore || score).meta.title || "제목 없음"} · ${modeName} · ${targetName}${ctxText}` +
    (r.fullCombo ? `<span class="gr-badge">FULL COMBO</span>` : "");
  const cell = (label, v, cls = "") => `<div><small>${label}</small><b class="${cls}">${v}</b></div>`;
  dlg.querySelector(".gr-grid").innerHTML = [
    cell("정확도", `${r.acc}%`), cell("타이밍 정확도", `${r.tacc}%`), cell("점수", r.score), cell("최대 콤보", r.maxCombo),
    cell("Perfect", r.perfect, "perfect"), cell("Ok", r.ok, "ok"), cell("Bad", r.bad, "bad"), cell("Miss", r.miss, "miss"),
    cell("빠름 (EARLY)", r.early), cell("늦음 (LATE)", r.late), cell("판정한 수", `${r.n}/${r.total}`),
  ].join("");
  const nextBtn = dlg.querySelector(".gr-next");
  let passed = false;
  if (resultCtx.kind === "pair") {
    drillView.recordResult("pair", resultCtx.key, r.acc, resultCtx.bpm);
    passed = r.acc >= PASS;
    nextBtn.textContent = passed ? `${Math.min(120, resultCtx.bpm + 10)} BPM으로 다시` : "다음 단계";
    nextBtn.hidden = !passed;
  } else if (resultCtx.kind === "step") {
    drillView.recordResult("step", resultCtx.step.id, r.acc);
    passed = r.acc >= PASS && resultCtx.step.id < STEPS.length;
    nextBtn.textContent = "다음 단계";
    nextBtn.hidden = !passed;
  } else nextBtn.hidden = true;
  dlg.showModal();
}

async function retry() {
  if (resultCtx.kind === "pair") return startChangeDrill(resultCtx.a, resultCtx.b, resultCtx.opts);
  if (resultCtx.kind === "step") return startSongStep(resultCtx.step);
  practice.reset();
  practice.rewind(0);
  sheet.clearMarks();
  seek(loopState && loopState.end ? loopState.start : 0);
  play();
}

async function nextStep() {
  if (resultCtx.kind === "pair") {
    const o = { ...resultCtx.opts, bpm: Math.min(120, resultCtx.opts.bpm + 10) };
    return startChangeDrill(resultCtx.a, resultCtx.b, o);
  }
  if (resultCtx.kind === "step") {
    const next = STEPS[resultCtx.step.id];
    if (next) { setView("drill"); drillView.step = next.id; drillView.render(); }
  }
}

function restoreSong() {
  if (!songScore) return;
  const s = songScore;
  songScore = null;
  setScore(s, { msg: "곡으로 돌아옴" });
}

async function startChangeDrill(a, b, opts) {
  if (player.playing) pause();
  if (!score.drill) songScore = score;
  const base = songScore || score;
  const d = changeDrill(a, b, { ...opts, tuning: base.tuning, chordShapes: base.chordShapes });
  setScore(d, { msg: `코드 바꾸기 연습: ${a} ⇄ ${b}, ${opts.bpm} BPM` });
  resultCtx = { kind: "pair", a, b, key: opts.key, bpm: opts.bpm, opts };
  practice.target = "beat";
  syncPracticeControls();
  $("[data-opt=metronome]").checked = true;
  player.setOptions({ metronome: true });
  $("[data-opt=rate]").value = "1";
  player.rate = 1;
  await togglePractice(true);
  resultCtx = { kind: "pair", a, b, key: opts.key, bpm: opts.bpm, opts };
  seek(0);
  play();
}

async function startSongStep(step) {
  if (player.playing) pause();
  if (score.drill) restoreSong();
  practice.target = step.target;
  store.set("uketab.practice.target", practice.target);
  let rate = step.rate;
  if (ytActive()) rate = yt.fitRate(rate);
  $("[data-opt=rate]").value = String(rate);
  player.rate = rate;
  await togglePractice(true);
  resultCtx = { kind: "step", step };
  practice.buildTargets();
  seek(0);
  play();
}''')

rep('''  setScore(s, { msg: describeImport(s, sourceName) });
  seek(0);
}''', '''  songScore = null;
  setScore(s, { msg: describeImport(s, sourceName) });
  seek(0);
}''')

s = s.replace('import { DrillView } from "./drills_view_shim.js";', 'import { DrillView } from "./drillview.js";')
p.write_text(s, encoding="utf-8")
print("main.js", before, "->", len(s))
