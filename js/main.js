import { newScore, loadAnyFormat, normalizeScore, toJSON, TimeMap, computeBars, barAt, midiOf } from "./model.js";
import { transposeChord, TUNINGS } from "./chords.js";
import { melodyToTab } from "./fingering.js";
import { SheetView } from "./sheet.js";
import { ChordBar } from "./chordbar.js";
import { Editor } from "./editor.js";
import { Engine, Player } from "./audio.js";
import { YouTubeSync, parseVideoId } from "./youtube.js";
import { bridge, bridgeSettings, saveBridgeSettings } from "./bridge.js";
import { Practice, calibrate } from "./practice.js";
import { DrillView } from "./drillview.js";
import { changeDrill, PASS, STEPS } from "./drills.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage blocked */ } },
};

const DEFAULT_SETTINGS = { miniDiagrams: true, showTab: false, follow: true, orient: "h", upcoming: 4, barsPerLine: 0 };
const settings = { ...DEFAULT_SETTINGS, ...store.get("uketab.settings", {}) };

let score = newScore();
let undoStack = [], redoStack = [];
let editing = false;
let view = "sheet";       // "sheet" | "edit" | "drill"
let songScore = null;     // the song while a chord-change drill score is loaded
let resultCtx = { kind: "free" };
let loopState = null; // null | {start} | {start, end}

const statusEl = $(".status");
function status(msg, error = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", !!error);
}

const engine = new Engine();
const player = new Player(engine);
const yt = new YouTubeSync($(".yt-player"));
const sheet = new SheetView($(".sheet"), { onSeek: (col) => seek(col) });
const chordbar = new ChordBar($(".chordbar"));
const editor = new Editor($(".editor"), {
  onChange: (fn, label) => {
    if (fn === "undo") return undo();
    if (fn === "redo") return redo();
    mutate(fn, label);
  },
  onSeek: (col) => seek(col),
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

// ---------------------------------------------------------------- score lifecycle

function setScore(s, { keepHistory = false, msg } = {}) {
  score = s;
  if (!keepHistory) { undoStack = []; redoStack = []; }
  player.setScore(score);
  practice.setScore(score);
  drillView.setScore(score);
  chordbar.setScore(score, settings);
  sheet.render(score, settings);
  editor.setScore(score);
  editor.setHistoryButtons(undoStack.length > 0, redoStack.length > 0);
  yt.offsetMs = score.youtube.offsetMs || 0;
  $(".yt-url").value = score.youtube.videoId || "";
  $(".yt-offset").value = String(score.youtube.offsetMs || 0);
  if (!$(".yt").hidden && score.youtube.videoId) yt.load(score.youtube.videoId);
  document.title = (score.meta.title ? score.meta.title + " · " : "") + "우쿨렐레 코드 악보";
  updatePosition(player.position());
  if (msg) status(msg);
  autosave();
}

function mutate(fn, label = "편집") {
  const before = JSON.stringify(score);
  const draft = JSON.parse(before);
  fn(draft);
  const next = normalizeScore(draft);
  if (JSON.stringify(next) === JSON.stringify(normalizeScore(JSON.parse(before)))) return;
  undoStack.push(before);
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
  setScore(next, { keepHistory: true, msg: label });
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(score));
  setScore(normalizeScore(JSON.parse(undoStack.pop())), { keepHistory: true, msg: "실행 취소" });
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(score));
  setScore(normalizeScore(JSON.parse(redoStack.pop())), { keepHistory: true, msg: "다시 실행" });
}

let saveTimer = null;
function autosave() {
  clearTimeout(saveTimer);
  if (score.drill) return; // generated drill scores are not kept
  saveTimer = setTimeout(() => store.set("uketab.last", JSON.parse(toJSON(score))), 400);
}

// ---------------------------------------------------------------- playback

const fmt = (t) => { t = Math.max(0, t); return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`; };

function updatePosition(col) {
  chordbar.update(col);
  sheet.follow = settings.follow;
  sheet.setPosition(col, player.playing);
  if (editing) editor.setPlayhead(col, player.playing && settings.follow);
  const tm = player.tm || new TimeMap(score);
  const total = tm.colToTime(score.columnCount);
  $(".time").textContent = `${fmt(tm.colToTime(col))} / ${fmt(total)}`;
  if (!seeking) $(".seek").value = String(Math.round((col / Math.max(1, score.columnCount)) * 1000));
  if (practice.on && !player.playing) practice.drawLane();
}

let raf = 0, lastYtCheck = 0;
function frame(ts) {
  if (!player.playing) { raf = 0; return; }
  const col = player.position();
  updatePosition(col);
  practice.frame();
  if (ytActive() && ts - lastYtCheck > 400) { lastYtCheck = ts; yt.check(player.scoreTime()); }
  raf = requestAnimationFrame(frame);
}

function ytActive() { return !$(".yt").hidden && yt.ready && !!score.youtube.videoId; }

function play() {
  if (player.playing) return;
  let rate = +$("[data-opt=rate]").value;
  if (ytActive()) {
    const r = yt.fitRate(rate);
    if (r !== rate) { rate = r; $("[data-opt=rate]").value = String(r); status(`영상이 지원하는 속도 ${Math.round(r * 100)}%로 맞춤`); }
  }
  player.rate = rate;
  player.play();
  if (ytActive()) yt.start(player.scoreTime(), rate);
  $(".play").textContent = "❚❚";
  $(".play").setAttribute("aria-label", "일시 정지");
  if (!raf) raf = requestAnimationFrame(frame);
}
function pause() {
  player.pause();
  yt.pause();
  setTimeout(() => practice.idle(), 0);
  $(".play").textContent = "▶";
  $(".play").setAttribute("aria-label", "재생");
  updatePosition(player.position());
}
function seek(col) {
  col = Math.max(0, Math.min(score.columnCount, col));
  practice.rewind(col);
  player.seek(col);
  if (player.playing && ytActive()) yt.start(player.scoreTime(), player.rate);
  updatePosition(col);
}

player.on((type) => {
  if (type === "pause" && !player.playing) {
    $(".play").textContent = "▶";
    if (player.position() >= score.columnCount - 0.01 || type === "pause") yt.pause();
  }
  if (type === "loop" && ytActive()) setTimeout(() => yt.start(player.scoreTime(), player.rate), 0);
  if (type === "loop" && loopState) practice.rewind(loopState.start);
  if (type === "end") {
    $(".play").textContent = "▶";
    yt.pause();
    setTimeout(() => practice.idle(), 0);
    if (practice.on) setTimeout(() => showResult(), 300);
  }
});

let seeking = false;
$(".seek").addEventListener("input", (e) => { seeking = true; const col = (+e.target.value / 1000) * score.columnCount; updatePosition(col); });
$(".seek").addEventListener("change", (e) => { seeking = false; seek(Math.round((+e.target.value / 1000) * score.columnCount)); });

$("[data-opt=rate]").addEventListener("change", (e) => {
  let r = +e.target.value;
  if (ytActive()) {
    const f = yt.fitRate(r);
    if (f !== r) { status(`영상은 ${Math.round(f * 100)}%만 지원해서 그 속도로 맞춤`); r = f; e.target.value = String(f); }
  }
  player.setRate(r);
  if (player.playing && ytActive()) yt.start(player.scoreTime(), r);
});
$("[data-opt=chordMode]").addEventListener("change", (e) => player.setOptions({ chordMode: e.target.value }));
$("[data-opt=melody]").addEventListener("change", (e) => player.setOptions({ melody: e.target.checked }));
$("[data-opt=metronome]").addEventListener("change", (e) => player.setOptions({ metronome: e.target.checked }));
$("[data-opt=volume]").addEventListener("input", (e) => engine.setVolume(+e.target.value / 100));

// ---------------------------------------------------------------- YouTube panel

function toggleYT(on) {
  const panel = $(".yt");
  panel.hidden = !on;
  $("[data-act=yt]").setAttribute("aria-pressed", String(on));
  if (on && score.youtube.videoId) yt.load(score.youtube.videoId).then(() => status(yt.lastError ? `영상 오류 ${yt.lastError} (퍼가기 금지 영상일 수 있음)` : "영상 준비됨"));
  if (!on) yt.pause();
}
$(".yt-close").addEventListener("click", () => toggleYT(false));
$(".yt-url").addEventListener("change", (e) => {
  const id = parseVideoId(e.target.value);
  if (!id) { status("YouTube 주소에서 영상 ID를 못 찾음", true); return; }
  mutate((s) => { s.youtube.videoId = id; }, "영상 바꿈");
  yt.load(id);
});
$(".yt-offset").addEventListener("change", (e) => {
  const v = Math.round(+e.target.value || 0);
  mutate((s) => { s.youtube.offsetMs = v; }, `싱크 ${v} ms`);
  if (player.playing && ytActive()) yt.start(player.scoreTime(), player.rate);
});
$(".yt-vol").addEventListener("input", (e) => yt.setVolume(+e.target.value));

// ---------------------------------------------------------------- menus and actions

$$(".menu-btn").forEach((b) => b.addEventListener("click", (e) => {
  const m = b.parentElement;
  const open = !m.classList.contains("open");
  $$(".menu").forEach((x) => x.classList.remove("open"));
  if (open) m.classList.add("open");
  e.stopPropagation();
}));
document.addEventListener("click", (e) => { if (!e.target.closest(".menu")) $$(".menu").forEach((x) => x.classList.remove("open")); });

for (const el of $$("[data-set]")) {
  const k = el.dataset.set;
  if (el.type === "checkbox") el.checked = !!settings[k]; else el.value = String(settings[k]);
  el.addEventListener("change", () => {
    settings[k] = el.type === "checkbox" ? el.checked : (isNaN(+el.value) ? el.value : +el.value);
    store.set("uketab.settings", settings);
    chordbar.setScore(score, settings);
    sheet.render(score, settings);
    updatePosition(player.position());
  });
}

const actions = {
  play: () => (player.playing ? pause() : play()),
  stop: () => { pause(); seek(loopState && loopState.end ? loopState.start : 0); },
  yt: () => toggleYT($(".yt").hidden),
  edit: () => setView(view === "edit" ? "sheet" : "edit"),
  "view-sheet": () => setView("sheet"),
  drill: () => setView(view === "drill" ? "sheet" : "drill"),
  practice: () => togglePractice(),
  "g-rules": () => $(".dlg-grules").showModal(),
  "g-sync": () => openSync(),
  "gr-retry": () => { $(".dlg-gresult").close(); retry(); },
  "gr-next": () => { $(".dlg-gresult").close(); nextStep(); },
  new: () => {
    if (!confirm("지금 악보를 닫고 새 악보를 만들까? (저장 안 한 내용은 브라우저에 남은 마지막 판만 있음)")) return;
    setScore(newScore(), { msg: "새 악보" });
    setEditing(true);
  },
  open: () => $(".file-input").click(),
  save: () => {
    const name = (score.meta.title || "ukulele").replace(/[\\/:*?"<>|]/g, "_");
    const blob = new Blob([toJSON(score)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.uke.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    status("JSON 파일로 저장함");
  },
  print: () => { const prev = settings.follow; window.print(); settings.follow = prev; },
  examples: () => openExamples(),
  details: () => openDetails(),
  help: () => window.open("help.html", "_blank", "noopener"),
  transcribe: () => openTranscribe(),
  loop: () => toggleLoop(),
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || !actions[b.dataset.act]) return;
  $$(".menu").forEach((x) => x.classList.remove("open"));
  actions[b.dataset.act]();
});

function setEditing(on) { setView(on ? "edit" : "sheet"); }

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
  status(`코드 바꾸기 연습: ${a} ⇄ ${b}, ${opts.bpm} BPM. 첫 마디는 준비 박`);
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
}

function toggleLoop() {
  const bars = computeBars(score);
  const bar = barAt(bars, player.position());
  const btn = $("[data-act=loop]");
  if (!loopState) {
    loopState = { start: bar.start };
    btn.setAttribute("aria-pressed", "true");
    status(`구간 반복 시작: ${bar.index + 1}마디. 끝 마디에서 한 번 더 누름`);
  } else if (loopState.end === undefined) {
    const end = Math.max(bar.start + bar.len, loopState.start + 1);
    loopState = { start: Math.min(loopState.start, bar.start), end };
    player.setOptions({ loop: loopState });
    editor.loop = loopState;
    status(`구간 반복 켬: ${barAt(bars, loopState.start).index + 1}~${barAt(bars, end - 1).index + 1}마디`);
  } else {
    loopState = null;
    player.setOptions({ loop: null });
    editor.loop = null;
    btn.setAttribute("aria-pressed", "false");
    status("구간 반복 끔");
  }
  editor.draw();
}

document.addEventListener("keydown", (e) => {
  if (e.key !== " " || e.repeat) return;
  const t = e.target;
  if (t.closest("input, select, textarea, dialog, button") && !t.classList.contains("ed-scroll")) return;
  e.preventDefault();
  actions.play();
});

// ---------------------------------------------------------------- files

const importDlg = $(".dlg-import");
function askImportOptions(defTuning = "standard") {
  return new Promise((resolve) => {
    importDlg.querySelector("[name=tuning]").value = defTuning;
    importDlg.returnValue = "";
    importDlg.showModal();
    importDlg.addEventListener("close", () => {
      if (importDlg.returnValue !== "ok") return resolve(null);
      const oct = importDlg.querySelector("[name=octave]").value;
      resolve({ tuning: importDlg.querySelector("[name=tuning]").value, octaveShift: oct === "auto" ? undefined : +oct });
    }, { once: true });
  });
}

async function openObject(obj, sourceName, opts) {
  const fname = obj && obj.format && (obj.format.name || obj.format.formatName);
  if ((fname === "spred-sheet" || fname === "ukulele-transcription") && !opts) {
    opts = await askImportOptions(obj.tuning || "standard");
    if (!opts) return;
  }
  const s = loadAnyFormat(obj, opts || {});
  if (sourceName && !s.meta.title) s.meta.title = sourceName.replace(/\.(uke\.)?json$/i, "");
  songScore = null;
  setScore(s, { msg: describeImport(s, sourceName) });
  seek(0);
}

function describeImport(s, name) {
  const parts = [`${name || "악보"} 열림`];
  for (const r of s.importReport || []) {
    parts.push(`${r.track}: 음 ${r.notes}개, 옥타브 ${r.shift >= 0 ? "+" : ""}${r.shift / 12}${r.folded ? `, 음역 밖이라 옥타브를 옮긴 음 ${r.folded}개` : ""}${r.skipped ? `, 못 읽은 칸 ${r.skipped}개` : ""}`);
  }
  return parts.join(" · ");
}

$(".file-input").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    await openObject(JSON.parse(await f.text()), f.name);
  } catch (err) {
    status(`열기 실패: ${err.message}`, true);
  }
});

async function openExamples() {
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
}

async function loadExample(file) {
  const obj = await (await fetch(`examples/${file}`)).json();
  setScore(loadAnyFormat(obj), { msg: `예제 열림: ${obj.meta.title}` });
  seek(0);
}

// ---------------------------------------------------------------- details / transpose

function openDetails() {
  const dlg = $(".dlg-details");
  const f = (n) => dlg.querySelector(`[name=${n}]`);
  f("title").value = score.meta.title || "";
  f("artist").value = score.meta.artist || "";
  f("key").value = score.meta.key || "";
  f("pattern").value = score.strum.pattern || "";
  f("tuning").value = score.tuning;
  f("video").value = score.youtube.videoId || "";
  f("offset").value = String(score.youtube.offsetMs || 0);
  f("transpose").value = "0";
  dlg.querySelector(".transpose-hint").textContent = "";
  f("transpose").oninput = () => {
    const k = +f("transpose").value || 0;
    dlg.querySelector(".transpose-hint").textContent = k ? `코드 예: ${[...new Set(score.chords.map((c) => c.name))].slice(0, 6).map((c) => `${c}→${transposeChord(c, k)}`).join(", ")}. 원곡 영상과 음이 달라짐` : "";
  };
  dlg.returnValue = "";
  dlg.showModal();
  dlg.addEventListener("close", () => {
    if (dlg.returnValue !== "ok") return;
    const k = +f("transpose").value || 0;
    const newTuning = f("tuning").value;
    mutate((s) => {
      s.meta.title = f("title").value.trim();
      s.meta.artist = f("artist").value.trim();
      s.meta.key = f("key").value.trim();
      s.strum.pattern = f("pattern").value.trim().toUpperCase().replace(/[^DUX-]/g, "") || "D-DU-UDU";
      const vid = parseVideoId(f("video").value);
      s.youtube.videoId = vid;
      s.youtube.offsetMs = Math.round(+f("offset").value || 0);
      if (k || newTuning !== s.tuning) {
        // re-finger every track from its pitches so the tab stays playable
        for (const t of s.tracks) {
          const mel = t.notes.map((n) => ({ col: n.col, len: n.len, midi: midiOf(n, s.tuning) + k }));
          t.notes = melodyToTab(mel, newTuning, 0).notes;
        }
        s.chords = s.chords.map((c) => ({ ...c, name: c.name === "N.C." ? c.name : transposeChord(c.name, k) }));
        if (k && s.meta.key) s.meta.key = transposeChord(s.meta.key, k);
        s.tuning = newTuning;
      }
    }, k ? `조옮김 ${k > 0 ? "+" : ""}${k}` : "곡 정보 바꿈");
  }, { once: true });
}

// ---------------------------------------------------------------- transcription through the local bridge

const txDlg = $(".dlg-transcribe");
let pollTimer = null;

async function refreshJobs() {
  const box = txDlg.querySelector(".tx-jobs");
  try {
    const { jobs } = await bridge.jobs();
    txDlg.querySelector(".tx-conn").textContent = "내 PC 연결됨";
    box.innerHTML = "";
    if (!jobs.length) { box.textContent = "아직 없음"; return; }
    for (const j of jobs) {
      const row = document.createElement("div");
      row.className = "job";
      const label = { queued: "대기", running: "진행 중", done: "완료", failed: "실패", cancelled: "취소" }[j.state] || j.state;
      row.innerHTML = `<span><b></b> <small></small></span><span class="btns"></span>`;
      row.querySelector("b").textContent = j.title || j.videoId;
      row.querySelector("small").textContent = `${label} · ${new Date(j.created * 1000).toLocaleString("ko-KR")}${j.error ? " · " + j.error : ""}`;
      const btns = row.querySelector(".btns");
      if (j.state === "done") {
        const b = document.createElement("button"); b.type = "button"; b.textContent = "열기";
        b.addEventListener("click", () => loadJob(j.id));
        btns.appendChild(b);
      }
      if (j.state === "running" || j.state === "queued") {
        const b = document.createElement("button"); b.type = "button"; b.textContent = "진행 보기";
        b.addEventListener("click", () => watchJob(j.id));
        btns.appendChild(b);
      }
      box.appendChild(row);
    }
  } catch (err) {
    txDlg.querySelector(".tx-conn").textContent = "";
    box.textContent = err.message;
  }
}

async function loadJob(id) {
  try {
    const obj = await bridge.result(id);
    txDlg.close();
    await openObject(obj, obj.meta && obj.meta.title, { tuning: obj.tuning || "standard" });
    toggleYT(true);
  } catch (err) {
    status(`결과를 못 엶: ${err.message}`, true);
  }
}

function watchJob(id) {
  clearInterval(pollTimer);
  const out = txDlg.querySelector(".tx-progress");
  const tick = async () => {
    try {
      const j = await bridge.job(id);
      out.textContent = (j.progress || []).slice(-40).join("\n");
      out.scrollTop = out.scrollHeight;
      if (j.state === "done") {
        clearInterval(pollTimer);
        status(`악보 완성: ${j.title || j.videoId}`);
        await loadJob(id);
      } else if (j.state === "failed" || j.state === "cancelled") {
        clearInterval(pollTimer);
        status(`악보 따기 ${j.state === "failed" ? "실패" : "취소"}: ${j.error || ""}`, true);
        refreshJobs();
      }
    } catch (err) {
      out.textContent += `\n${err.message}`;
    }
  };
  tick();
  pollTimer = setInterval(tick, 2500);
}

function openTranscribe() {
  txDlg.querySelector(".tx-progress").textContent = "";
  txDlg.showModal();
  refreshJobs();
}
txDlg.addEventListener("close", () => clearInterval(pollTimer));

txDlg.querySelector("[data-act=tx-start]").addEventListener("click", async () => {
  const f = (n) => txDlg.querySelector(`[name=${n}]`);
  const id = parseVideoId(f("url").value);
  if (!id) { txDlg.querySelector(".tx-progress").textContent = "YouTube 주소에서 영상 ID를 못 찾음"; return; }
  try {
    const j = await bridge.submit({ videoId: id, tuning: f("tuning").value, lang: f("lang").value, lyrics: f("lyrics").checked, inst: f("inst").checked });
    txDlg.querySelector(".tx-progress").textContent = "작업을 넘김. Claude가 시작하면 진행 상황이 여기 뜸";
    watchJob(j.id);
    refreshJobs();
  } catch (err) {
    txDlg.querySelector(".tx-progress").textContent = err.message;
  }
});

const brDlg = $(".dlg-bridge");
txDlg.querySelector("[data-act=tx-settings]").addEventListener("click", () => {
  const s = bridgeSettings();
  brDlg.querySelector("[name=url]").value = s.url;
  brDlg.querySelector("[name=token]").value = s.token;
  brDlg.querySelector(".br-msg").textContent = "";
  brDlg.returnValue = "";
  brDlg.showModal();
});
brDlg.querySelector("[data-act=br-test]").addEventListener("click", async () => {
  const prev = bridgeSettings();
  saveBridgeSettings({ url: brDlg.querySelector("[name=url]").value.trim(), token: brDlg.querySelector("[name=token]").value.trim() });
  try {
    const h = await bridge.health();
    brDlg.querySelector(".br-msg").textContent = `연결됨 (브리지 ${h.version}, ${h.busy ? "작업 중" : "대기 중"})`;
  } catch (err) {
    brDlg.querySelector(".br-msg").textContent = err.message;
    saveBridgeSettings(prev);
  }
});
brDlg.addEventListener("close", () => {
  if (brDlg.returnValue === "ok") {
    saveBridgeSettings({ url: brDlg.querySelector("[name=url]").value.trim(), token: brDlg.querySelector("[name=token]").value.trim() });
    refreshJobs();
  }
});

// ---------------------------------------------------------------- start

window.addEventListener("resize", () => { if (!editing) { sheet.render(score, settings); updatePosition(player.position()); } });

(async function start() {
  const params = new URLSearchParams(location.search);
  // pairing link from the bridge: #token=... is stored and removed from the address bar
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("token")) {
    saveBridgeSettings({ ...bridgeSettings(), token: hash.get("token") });
    history.replaceState(null, "", location.pathname + location.search);
    status("내 PC 연결 토큰을 저장함");
  }
  try {
    if (params.get("job")) { await loadJob(params.get("job")); return; }
    if (params.get("example")) { await loadExample(params.get("example") + ".json"); return; }
    const last = store.get("uketab.last", null);
    if (last) { setScore(loadAnyFormat(last), { msg: "지난번 악보를 이어서 엶" }); return; }
    await loadExample("twinkle.json");
  } catch (err) {
    setScore(newScore(), { msg: `시작 악보를 못 엶: ${err.message}` });
  }
})();
