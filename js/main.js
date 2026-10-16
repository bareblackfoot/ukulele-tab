import { newScore, loadAnyFormat, normalizeScore, toJSON, TimeMap, computeBars, barAt, retune, midiOf } from "./model.js";
import { melodyToTab } from "./fingering.js";
import { transposeChord, TUNINGS, capoChoices, powerChord } from "./chords.js";
import { INST, INSTRUMENTS, tuningsOf, skey } from "./instrument.js";
import { SheetView } from "./sheet.js";
import { ChordBar } from "./chordbar.js";
import { GameLane } from "./lane.js";
import { PitchLane } from "./pitchlane.js";
import { JUDGE_KINDS } from "./pitchgame.js";
import { Editor } from "./editor.js";
import { Engine, Player } from "./audio.js";
import { YouTubeSync, parseVideoId } from "./youtube.js";
import { bridge, bridgeSettings, saveBridgeSettings, connectBridge, isRemote } from "./bridge.js";
import { Practice, calibrate } from "./practice.js";
import { alignLyrics } from "./lyrics.js";
import { records, rankOf, pointsText } from "./records.js";
import { Dashboard } from "./dashboard.js";
import { songKey } from "./drills.js";
import { DrillView } from "./drillview.js";
import { StrumView } from "./strumview.js";
import { SHEET_STRUMS, recommendStrums, toStrumEvents, currentPerBar } from "./strumfit.js";
import { ARROW } from "./strums.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
// the page's parts that only chord instruments (or only the otamatone) have are shown by this class
document.body.classList.add(`inst-${INST.id}`);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage blocked */ } },
};

const DEFAULT_SETTINGS = { miniDiagrams: true, showTab: false, follow: true, orient: "h", upcoming: 4, barsPerLine: 0,
  electric: false, power: false, drive: "clean", leadHigh: true, // electric guitar mode (guitar site only)
  lead: false, leadTrack: "",                                        // lead view: one line's TAB big
  parts: {},                                                         // otamatone: tracks played (id -> on)
  rollZoom: window.innerWidth < 560 ? 60 : 100 };                   // otamatone: note rows' height, % of SPRED's
const settings = { ...DEFAULT_SETTINGS, ...store.get(skey("settings"), {}) };

let score = newScore();
let shown = score;   // what the sheet, sound and practice use: the score itself, or its electric guitar view
let undoStack = [], redoStack = [];
let editing = false;
let view = "sheet";       // "sheet" | "edit" | "drill"
let loopState = null; // null | {start} | {start, end}

const statusEl = $(".status");
// Only errors and results that change what the user does next go here. Plain notes fade after a few seconds.
let statusTimer = null;
function status(msg, error = false) {
  clearTimeout(statusTimer);
  statusEl.textContent = msg || "";
  statusEl.classList.toggle("error", !!error);
  statusEl.hidden = !msg;
  if (msg && !error) statusTimer = setTimeout(() => { statusEl.hidden = true; }, 6000);
}
status("");

const engine = new Engine();
const player = new Player(engine);
const yt = new YouTubeSync($(".yt-player"));
yt.onBlocked = () => status("영상이 시작되지 않음. 아이패드·아이폰은 영상 화면을 한 번 직접 눌러 재생해야 함. 그다음부터는 재생 버튼으로 같이 움직임", true);
const sheet = new SheetView($(".sheet"), { onSeek: (col) => seek(col), onStrum: (bar) => openStrumPicker(bar) });
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
  lane: INST.roll ? new PitchLane($(".g-lane"), () => settings) : new GameLane($(".g-lane"), () => settings),
  judge: $(".g-judge"),
  combo: $(".g-combo"),
  onMark: (col, grade) => sheet.mark(col, grade),
  clearMarks: () => sheet.clearMarks(),
  status,
  syncControls: () => syncPracticeControls(),
  counts: (st) => {
    $(".g-score b").textContent = pointsText(st.score);
    for (const el of $$(".g-counts [data-c]")) {
      const k = el.dataset.c;
      el.textContent = k === "acc" || k === "tacc" || k === "hold" ? `${st[k]}%` : k === "davg" ? lateText(st.davg)
        : k === "cavg" ? highText(st.cavg) : String(st[k]);
    }
  },
  heard: (txt) => { $(".g-heard").textContent = txt; },
  level: (v) => { $(".g-meter i").style.width = `${Math.min(100, Math.sqrt(v) * 400)}%`; },
});

const dashboard = new Dashboard($(".records-view"), {
  onLogin: () => openLogin(),
  onLogout: async () => { await records.logout(); syncAccount(); dashboard.show(true); },
});

const drillView = new DrillView($(".drill:not(.records-view)"), {
  engine, practice, settings, status,
});
const strumView = new StrumView($(".strum-view"), { engine, practice, settings, status });

// ---------------------------------------------------------------- score lifecycle

// ---------------------------------------------------------------- electric guitar mode (guitar site)

const electricOn = () => INST.id === "guitar" && !!settings.electric;

// The open sheet as an electric guitar player reads it: no capo (the original key, barre shapes where needed),
// power chords when chosen. The sheet itself (and what is saved) keeps its capo; the editor shows the sheet.
function electricView(src) {
  const s = JSON.parse(toJSON(src));
  const fromCapo = s.capo || 0;
  if (fromCapo) retune(s, s.tuning, 0, 0, 0);
  s.meta.key = (s.meta.key || "").replace(/\s*\(.*\)\s*$/, "");
  if (settings.power) s.chords = s.chords.map((c) => ({ ...c, name: c.name === "N.C." ? c.name : powerChord(c.name) }));
  // an electric guitar plays the tune where it is sung (the acoustic sheet has it an octave lower), up the neck
  if (settings.leadHigh) {
    for (const t of s.tracks) {
      const mel = t.notes.map((n) => ({ col: n.col, len: n.len, midi: midiOf(n, s.tuning, 0), tech: n.tech }));
      t.notes = melodyToTab(mel, s.tuning, t.absolute ? 0 : null, { lead: true, center: 72, maxFret: 22 }).notes;
    }
  }
  const out = normalizeScore(s);
  out.electric = { fromCapo, power: !!settings.power };
  return out;
}

// the line chosen in 보기 > 칠 줄 (default: a lead track taken from the recording, else the sung melody)
function leadId(s) {
  if (s.tracks.some((t) => t.id === settings.leadTrack)) return settings.leadTrack;
  return (s.tracks.find((t) => t.id === "lead") || s.tracks[0]).id;
}

// lead view: only the chosen line is drawn, heard and judged
function leadView(src) {
  const s = normalizeScore(JSON.parse(toJSON(src)));
  if (src.electric) s.electric = src.electric;
  const id = leadId(s);
  for (const t of s.tracks) { const on = t.id === id; t.hidden = !on; t.muted = !on; }
  s.leadTrack = id;
  return s;
}

function fillLeadTracks() {
  const sel = $(".lead-track");
  sel.replaceChildren(...score.tracks.map((t) => new Option(`${t.name} (${t.notes.length}음)`, t.id)));
  sel.value = leadId(score);
}

// otamatone: the tracks switched on in 보기 are played, heard and judged; the others are drawn faint. Like SPRED,
// only the first (the sung melody) is on until others are switched on.
const partOn = (t, i) => settings.parts[t.id] ?? i === 0;
function partsView(src) {
  const s = normalizeScore(JSON.parse(toJSON(src)));
  s.tracks.forEach((t, i) => { t.muted = !partOn(t, i); });
  return s;
}

function fillParts() {
  const box = $(".parts-list");
  if (!box) return;
  box.replaceChildren(...score.tracks.map((t, i) => {
    const l = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = partOn(t, i);
    cb.addEventListener("change", () => {
      settings.parts = { ...settings.parts, [t.id]: cb.checked };
      store.set(skey("settings"), settings);
      showScore();
      updatePosition(player.position());
    });
    l.append(cb, ` ${t.name} (${t.notes.length}음)`);
    return l;
  }));
}

// hand the sheet (or its electric view) to everything that shows or plays it
function showScore() {
  shown = electricOn() ? electricView(score) : score;
  if (settings.lead) shown = leadView(shown);
  if (INST.roll) shown = partsView(shown);
  fillLeadTracks();
  fillParts();
  engine.setTone(electricOn() ? settings.drive : "acoustic");
  player.setScore(shown);
  practice.setScore(shown);
  drillView.setScore(shown);
  strumView.setScore(shown);
  chordbar.setScore(shown, settings);
  sheet.render(shown, settings);
}

function syncKind() {
  $(".kind-switch").hidden = INST.id !== "guitar";
  $(".electric-opts").hidden = !electricOn();
  $("[data-act=kind-acoustic]").setAttribute("aria-pressed", String(!electricOn()));
  $("[data-act=kind-electric]").setAttribute("aria-pressed", String(electricOn()));
}

function setKind(electric) {
  settings.electric = electric;
  store.set(skey("settings"), settings);
  syncKind();
  showScore();
  updatePosition(player.position());
}

function setScore(s, { keepHistory = false, msg } = {}) {
  const fresh = !keepHistory; // another sheet, not an edit of this one
  score = s;
  if (!keepHistory) { undoStack = []; redoStack = []; }
  showScore();
  editor.setScore(score);
  editor.setHistoryButtons(undoStack.length > 0, redoStack.length > 0);
  yt.offsetMs = score.youtube.offsetMs || 0;
  $(".yt-url").value = score.youtube.videoId || "";
  $(".yt-offset").value = String(score.youtube.offsetMs || 0);
  // a newly opened sheet with a video comes with the video box; one without it closes the box
  if (fresh && !!score.youtube.videoId !== !$(".yt").hidden) toggleYT(!!score.youtube.videoId);
  else if (!$(".yt").hidden && score.youtube.videoId) yt.load(score.youtube.videoId);
  document.title = (score.meta.title ? score.meta.title + " · " : "") + INST.title;
  updatePosition(player.position());
  if (msg !== undefined) status(msg); // an empty one clears what the last sheet said
  autosave();
}

// where the open score came from, so a later visit opens the newest version of an example or my-library sheet
// instead of this browser's old copy (unless it was edited here)
const SRC = skey("lastSource");
function rememberSource(kind, file) { store.set(SRC, kind ? { kind, file, edited: false } : null); drawSongbar(); }
// the song list on the left: examples, and my library's items (null when this login has none)
const songbar = { examples: [], mine: null };

function mutate(fn, label = "편집") {
  const before = JSON.stringify(score);
  const draft = JSON.parse(before);
  fn(draft);
  const next = normalizeScore(draft);
  if (JSON.stringify(next) === JSON.stringify(normalizeScore(JSON.parse(before)))) return;
  const src = store.get(SRC, null);
  if (src && !src.edited) store.set(SRC, { ...src, edited: true });
  undoStack.push(before);
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
  setScore(next, { keepHistory: true });
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(score));
  setScore(normalizeScore(JSON.parse(undoStack.pop())), { keepHistory: true });
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(score));
  setScore(normalizeScore(JSON.parse(redoStack.pop())), { keepHistory: true });
}

let saveTimer = null;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(skey("last"), JSON.parse(toJSON(score))), 400);
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

let countIn = null; // {timers, el} while the game-mode count-in runs

function play() {
  if (player.playing || countIn) return;
  let rate = +$("[data-opt=rate]").value;
  if (ytActive()) {
    const r = yt.fitRate(rate);
    if (r !== rate) { rate = r; $("[data-opt=rate]").value = String(r); status(`영상이 지원하는 속도 ${Math.round(r * 100)}%로 맞춤`); }
  }
  player.rate = rate;
  $(".play").textContent = "❚❚";
  $(".play").setAttribute("aria-label", "일시 정지");
  if (!practice.on) {
    player.play();
    if (ytActive()) yt.start(player.scoreTime(), rate);
    if (!raf) raf = requestAnimationFrame(frame);
    return;
  }
  // game mode: wait a moment, one bar of clicks with 3, 2, 1, 시작! and start on the next beat
  engine.ensure();
  const col = player.position();
  const beat = 60 / player.tm.bpmAt(col) / rate;
  const t0 = engine.ctx.currentTime + 0.6;
  const startAt = t0 + 4 * beat;
  const el = $(".countdown");
  const timers = [];
  ["3", "2", "1", "시작!"].forEach((txt, k) => {
    engine.click(t0 + k * beat, k === 0);
    timers.push(setTimeout(() => {
      el.hidden = false;
      el.innerHTML = `<b class="${k === 3 ? "go" : ""}">${txt}</b>`;
    }, (t0 + k * beat - engine.ctx.currentTime) * 1000));
  });
  timers.push(setTimeout(() => { el.hidden = true; el.innerHTML = ""; }, (startAt - engine.ctx.currentTime) * 1000 + 350));
  countIn = { timers, el };
  timers.push(setTimeout(() => { countIn = null; }, (startAt - engine.ctx.currentTime) * 1000));
  player.play(col, startAt);
  if (ytActive()) timers.push(setTimeout(() => yt.start(player.scoreTime(), rate), Math.max(0, (startAt - engine.ctx.currentTime) * 1000 - 20)));
  if (!raf) raf = requestAnimationFrame(frame);
}

function cancelCountIn() {
  if (!countIn) return;
  countIn.timers.forEach(clearTimeout);
  countIn.el.hidden = true;
  countIn.el.innerHTML = "";
  countIn = null;
}

function pause() {
  cancelCountIn();
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
  if (on) placeYT();
  $("[data-act=yt]").setAttribute("aria-pressed", String(on));
  if (on && score.youtube.videoId) yt.load(score.youtube.videoId).then(() => { if (yt.lastError) status(`영상 오류 ${yt.lastError} (퍼가기 금지 영상일 수 있음)`, true); });
  if (!on) yt.pause();
}
$(".yt-close").addEventListener("click", () => toggleYT(false));

// the video box: drag it by its title, make it smaller or bigger; place and size are remembered in this browser
const YT_WIDTHS = [200, 280, 420, 560, 720];
const ytBox = { ...store.get(skey("ytbox"), {}) };
// the size step the box has until resized: the smallest on a phone, where it now opens with every sheet that has a video
const ytSize = () => ytBox.size ?? (window.innerWidth < 560 ? 0 : 2);
function placeYT() {
  const el = $(".yt");
  const w = Math.min(YT_WIDTHS[ytSize()] || 420, window.innerWidth - 16);
  el.style.width = `${w}px`;
  if (ytBox.x == null) return;   // default corner from the stylesheet
  const r = el.getBoundingClientRect();
  const x = Math.max(8, Math.min(window.innerWidth - r.width - 8, ytBox.x));
  const y = Math.max(8, Math.min(window.innerHeight - Math.min(r.height, 120) - 8, ytBox.y));
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, right: "auto", bottom: "auto" });
}
$$(".yt-size").forEach((b) => b.addEventListener("click", () => {
  ytBox.size = Math.max(0, Math.min(YT_WIDTHS.length - 1, ytSize() + +b.dataset.step));
  store.set(skey("ytbox"), ytBox);
  placeYT();
}));
$(".yt-more").addEventListener("click", (e) => {
  const opts = $(".yt-opts");
  opts.hidden = !opts.hidden;
  e.currentTarget.setAttribute("aria-pressed", String(!opts.hidden));
  placeYT();
});
$(".yt-grip").addEventListener("pointerdown", (e) => {
  const el = $(".yt");
  const r = el.getBoundingClientRect();
  const dx = e.clientX - r.left, dy = e.clientY - r.top;
  const grip = e.currentTarget;
  grip.setPointerCapture(e.pointerId);
  el.classList.add("dragging");
  const move = (ev) => { ytBox.x = ev.clientX - dx; ytBox.y = ev.clientY - dy; placeYT(); };
  const up = () => {
    el.classList.remove("dragging");
    grip.removeEventListener("pointermove", move);
    store.set(skey("ytbox"), ytBox);
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", up, { once: true });
  grip.addEventListener("pointercancel", up, { once: true });
});
window.addEventListener("resize", () => { if (!$(".yt").hidden) placeYT(); });
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
    store.set(skey("settings"), settings);
    if (["power", "drive", "lead", "leadHigh"].includes(k)) showScore();
    else {
      chordbar.setScore(shown, settings);
      sheet.render(shown, settings);
    }
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
  strum: () => setView(view === "strum" ? "sheet" : "strum"),
  practice: () => togglePractice(),
  "g-rules": () => $(".dlg-grules").showModal(),
  "g-sync": () => openSync(),
  "g-mic": async () => { await practice.setMic(!practice.mic); syncPracticeControls(); },
  "gr-sync": (b) => { setSync(+b.dataset.v); b.hidden = true; status(`게임 싱크 ${$(".g-sync-val").textContent}`); },
  "gr-retry": () => { $(".dlg-gresult").close(); retry(); },
  new: () => {
    if (!confirm("지금 악보를 닫고 새 악보를 만들까? (저장 안 한 내용은 브라우저에 남은 마지막 판만 있음)")) return;
    setScore(newScore());
    rememberSource(null);
    libraryFile = null;
    setEditing(true);
  },
  open: () => $(".file-input").click(),
  save: () => {
    const name = (score.meta.title || INST.id).replace(/[\\/:*?"<>|]/g, "_");
    const blob = new Blob([toJSON(score)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}${INST.fileExt}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  print: () => { const prev = settings.follow; window.print(); settings.follow = prev; },
  examples: () => showSongbar(true),
  songbar: () => showSongbar(!document.body.classList.contains("songbar-open")),
  "save-lib": () => saveToLibrary(),
  records: () => setView(view === "records" ? "sheet" : "records"),
  account: async () => {
    if (records.session()) return setView("records");
    openLogin();
    const dlg = $(".dlg-login");
    dlg.querySelector(".lg-msg").textContent = "집 PC에 연결 중…";
    const ok = await autoPair();
    dlg.querySelector(".lg-msg").textContent = "";
    // new accounts are made on the PC only; from outside it is login only
    dlg.querySelector("[data-act=lg-signup]").hidden = isRemote();
    if (!ok) {
      // say it inside the dialog: the status line can sit below the visible area on tablets
      dlg.querySelector(".lg-msg").textContent = "집 PC에 연결되지 않아 로그인할 수 없음 (PC가 꺼졌거나 연결 프로그램이 멈춤). 게임 기록은 이 기기 브라우저에만 저장됨.";
      dlg.querySelectorAll("[data-act=lg-login], [data-act=lg-signup]").forEach((b) => { b.disabled = true; });
    } else {
      $(".dlg-login").querySelectorAll("[data-act=lg-login], [data-act=lg-signup]").forEach((b) => { b.disabled = false; });
    }
  },
  "lg-login": () => doLogin(false),
  "lg-signup": () => doLogin(true),
  "strum-pick": () => openStrumPicker(),
  "st-recommend": () => fillStrumPicker("recommend"),
  "st-all": () => fillStrumPicker("base"),
  "st-apply": () => applyStrumPicker(),
  lyrics: () => openLyrics(),
  "ly-apply": () => applyLyrics(),
  details: () => openDetails(),
  help: () => window.open("help.html", "_blank", "noopener"),
  // the ukulele site and the guitar site sit next to each other on GitHub Pages
  "kind-acoustic": () => setKind(false),
  "kind-electric": () => setKind(true),
  transcribe: () => openTranscribe(),
  loop: () => toggleLoop(),
};
// iPad/iPhone only start sound inside a tap; capture phase so it runs before the button's own handler
for (const ev of ["touchend", "click", "keydown"]) window.addEventListener(ev, () => engine.unlock(), { capture: true, passive: true });

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || !actions[b.dataset.act]) return;
  $$(".menu").forEach((x) => x.classList.remove("open"));
  actions[b.dataset.act](b);
});

function setEditing(on) { setView(on ? "edit" : "sheet"); }

function setView(v) {
  if (v === "edit" && practice.on) { status("게임 모드 중에는 편집할 수 없음. 게임 모드를 먼저 끄세요", true); return; }
  const own = v === "drill" || v === "records" || v === "strum";
  if (own && player.playing) pause();
  view = v;
  // chord practice and records have their own screens; the song's transport, chord panel and lane stay out of the way
  $(".transport").hidden = own;
  // in game mode the lane shows the chords where they come, so the chord panel is not needed
  $(".cb-wrap").hidden = own || practice.on;
  $(".game").hidden = own || !practice.on;
  $("[data-act=records]").setAttribute("aria-pressed", String(v === "records"));
  dashboard.show(v === "records");
  editing = v === "edit";
  $("[data-act=view-sheet]").setAttribute("aria-pressed", String(v === "sheet"));
  $("[data-act=edit]").setAttribute("aria-pressed", String(v === "edit"));
  $("[data-act=drill]").setAttribute("aria-pressed", String(v === "drill"));
  $(".editor").hidden = v !== "edit";
  $(".sheet").hidden = v !== "sheet";
  drillView.show(v === "drill");
  $("[data-act=strum]").setAttribute("aria-pressed", String(v === "strum"));
  strumView.show(v === "strum");
  if (v === "edit") {
    editor.layout(); editor.setPlayhead(player.position(), false); $(".ed-scroll").focus();
    if (shown !== score && (score.capo || settings.power)) status(`편집 화면은 저장되는 통기타판 코드${score.capo ? `(카포 ${score.capo})` : ""}로 보임`);
  }
  if (v === "sheet") sheet.render(shown, settings);
  updatePosition(player.position());
}

// ---------------------------------------------------------------- practice mode

function syncPracticeControls() {
  $(".g-target").value = practice.target;
  $(".g-judge-kind").value = practice.judgeKind;
  $(".g-input").value = practice.input;
  $$(".g-modes [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === practice.mode)));
  const v = practice.offsetMs;
  $(".g-sync-val").textContent = `${v >= 0 ? "+" : ""}${v} ms`;
  $(".gs-val").textContent = `${v >= 0 ? "+" : ""}${v} ms`;
  const st = $(".g-state");
  st.textContent = !practice.on ? "꺼짐" : practice.input === "keys" ? "키보드 F·J" : practice.mic ? "마이크 켜짐" : practice.micOff ? "마이크 꺼짐" : "마이크 없음";
  st.disabled = !practice.on || practice.input === "keys";
  st.title = practice.mic ? "누르면 마이크를 끔" : "누르면 마이크를 켬";
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
  } else {
    const had = practice.stats.n > 0;
    if (player.playing || countIn) pause();
    practice.stop();
    $(".game").hidden = true;
    btn.setAttribute("aria-pressed", "false");
    if (had && !player.playing) showResult();
  }
  $(".cb-wrap").hidden = practice.on || view === "drill" || view === "records" || view === "strum";
  syncPracticeControls();
  updatePosition(player.position());
}

$(".g-judge-kind").addEventListener("change", (e) => {
  practice.judgeKind = JUDGE_KINDS[e.target.value] ? e.target.value : "both";
  store.set(skey("practice.judge"), practice.judgeKind);
});
$(".g-target").addEventListener("change", (e) => {
  practice.target = e.target.value;
  store.set(skey("practice.target"), practice.target);
  practice.buildTargets();
  practice.rewind(player.position());
});
$(".g-input").addEventListener("change", async (e) => {
  practice.input = e.target.value;
  store.set(skey("practice.input"), practice.input);
  if (practice.on && practice.input === "mic") await practice.ensureMic();
  syncPracticeControls();
});
$$(".g-modes [data-mode]").forEach((b) => b.addEventListener("click", () => {
  practice.mode = b.dataset.mode;
  store.set(skey("practice.mode"), practice.mode);
  syncPracticeControls();
}));
document.addEventListener("keydown", (e) => {
  if (!practice.on || practice.input !== "keys" || e.repeat) return;
  if (e.target.closest("input, select, textarea")) return;
  if (["f", "j", "F", "J", "d", "k"].includes(e.key)) { e.preventDefault(); practice.keyStrum(); }
});

function setSync(v) {
  practice.offsetMs = Math.max(-200, Math.min(500, Math.round(v)));
  store.set(skey("practice.offset"), practice.offsetMs);
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

// where the playing lands on average: "+45 ms 늦음", "-18 cent 낮음"
const signed = (v) => `${v > 0 ? "+" : ""}${v}`;
function lateText(v, unit = " ms") { return v === null || v === undefined ? "--" : `${signed(v)}${unit} ${Math.abs(v) < 10 ? "맞음" : v > 0 ? "늦음" : "빠름"}`; }
function highText(v, unit = " cent") { return v === null || v === undefined ? "--" : `${signed(v)}${unit} ${Math.abs(v) < 10 ? "맞음" : v > 0 ? "높음" : "낮음"}`; }

function showResult() {
  const r = practice.result();
  if (!r.n) return;
  const rec = {
    time: Date.now(), song: songKey(score), title: score.meta.title || "제목 없음", artist: score.meta.artist || "",
    mode: r.mode, target: r.target, rate: player.rate, score: r.score, pts: r.score, acc: r.acc, tacc: r.tacc, maxCombo: r.maxCombo,
    perfect: r.perfect, ok: r.ok, bad: r.bad, miss: r.miss, early: r.early, late: r.late, n: r.n, total: r.total, fullCombo: r.fullCombo,
    ...(r.judge ? { judge: r.judge, hold: r.hold } : {}),
  };
  const prevBest = records.add(rec);
  const dlg = $(".dlg-gresult");
  const modeName = { easy: "쉬움", std: "보통", pro: "어려움" }[r.mode];
  const targetName = r.judge ? JUDGE_KINDS[r.judge] : { beat: "코드 박마다", change: "코드 바뀔 때", pattern: "스트럼 패턴", melody: "멜로디" }[r.target];
  const rank = rankOf(r.score);
  const best = prevBest === null ? "" : r.score > prevBest ? `<span class="gr-best">최고 기록! +${pointsText(r.score - prevBest)}</span>`
    : `<span class="hint">같은 난이도·판정·속도 최고 ${pointsText(prevBest)}점</span>`;
  dlg.querySelector(".gr-meta").innerHTML = `<span class="gr-rank ${rank}">${rank}</span>${escHtml(score.meta.title || "제목 없음")} · ${modeName} · ${targetName}` +
    (r.fullCombo ? `<span class="gr-badge">FULL COMBO</span>` : "") + best +
    (records.session() ? "" : ` <span class="hint">이 브라우저에만 저장됨. 로그인하면 계정에 올라감</span>`);
  const cell = (label, v, cls = "") => `<div><small>${label}</small><b class="${cls}">${v}</b></div>`;
  dlg.querySelector(".gr-grid").innerHTML = [
    cell("점수 (100점 만점)", pointsText(r.score), "pts"), cell("정확도", `${r.acc}%`), r.judge === "hold" ? "" : cell("타이밍 정확도", `${r.tacc}%`),
    r.hold === null || r.hold === undefined ? "" : cell("음 유지", `${r.hold}%`), cell("최대 콤보", r.maxCombo),
    cell("Perfect", r.perfect, "perfect"), cell("Ok", r.ok, "ok"), cell("Bad", r.bad, "bad"), cell("Miss", r.miss, "miss"),
    cell("빠름 (EARLY)", r.early), cell("늦음 (LATE)", r.late), cell("판정한 수", `${r.n}/${r.total}`),
    r.davg === null ? "" : cell("시작 박자 평균 (ms)", lateText(r.davg, "")), r.cavg === null || r.cavg === undefined ? "" : cell("음높이 평균 (cent)", highText(r.cavg, "")),
  ].join("");
  // starts that came late (or early) all along mean the sync is off rather than the playing: offer to move it
  const fix = dlg.querySelector("[data-act=gr-sync]");
  const move = r.dN >= 8 && Math.abs(r.davg) >= 15 ? r.davg : 0;
  fix.hidden = !move;
  fix.dataset.v = String(practice.offsetMs + move);
  fix.textContent = `싱크를 ${signed(practice.offsetMs + move)} ms로 (평균 ${signed(move)} ms 반영)`;
  dlg.showModal();
}

async function retry() {
  practice.reset();
  practice.rewind(0);
  sheet.clearMarks();
  seek(loopState && loopState.end ? loopState.start : 0);
  play();
}

function toggleLoop() {
  const bars = computeBars(score);
  const bar = barAt(bars, player.position());
  const btn = $("[data-act=loop]");
  if (!loopState) {
    loopState = { start: bar.start };
    btn.setAttribute("aria-pressed", "true");
    btn.textContent = `${bar.index + 1}마디부터 · 끝 마디에서 다시 누름`;
  } else if (loopState.end === undefined) {
    const end = Math.max(bar.start + bar.len, loopState.start + 1);
    loopState = { start: Math.min(loopState.start, bar.start), end };
    player.setOptions({ loop: loopState });
    editor.loop = loopState;
    btn.textContent = `${barAt(bars, loopState.start).index + 1}~${barAt(bars, end - 1).index + 1}마디 반복 중`;
  } else {
    loopState = null;
    player.setOptions({ loop: null });
    editor.loop = null;
    btn.setAttribute("aria-pressed", "false");
    btn.textContent = "구간 반복";
  }
  editor.draw();
}

document.addEventListener("keydown", (e) => {
  if (e.key !== " " || e.repeat || view === "drill" || view === "strum") return;
  const t = e.target;
  if (t.closest("input, select, textarea, dialog, button") && !t.classList.contains("ed-scroll")) return;
  e.preventDefault();
  actions.play();
});

// ---------------------------------------------------------------- files

// the three instruments' sites in the top bar. They sit on one web origin, so the song open here is handed
// over in this browser's storage: the other site opens its own version of it (the same example, or the same
// title in its part of my library), else this sheet moved onto its instrument.
const HANDOFF = "tabsite.handoff";
for (const it of Object.values(INSTRUMENTS)) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "toggle";
  b.textContent = it.name;
  b.setAttribute("aria-pressed", String(it.id === INST.id));
  if (it.id !== INST.id) {
    b.title = `지금 곡을 ${it.name} 악보로 열기`;
    b.addEventListener("click", () => {
      const src = store.get(SRC, null);
      store.set(HANDOFF, {
        at: Date.now(), from: INST.id, title: score.meta.title || "", artist: score.meta.artist || "",
        example: src && !src.edited && src.kind === "example" ? src.file : null, score: JSON.parse(toJSON(score)),
      });
      location.href = it.url;
    });
  }
  $(".site-switch").appendChild(b);
}

// the song handed over by another instrument's site (a minute old at most): true when it was opened
async function openHandoff() {
  const ho = store.get(HANDOFF, null);
  if (!ho) return false;
  store.set(HANDOFF, null);
  if (ho.from === INST.id || Date.now() - ho.at > 60000) return false;
  const from = INSTRUMENTS[ho.from] ? INSTRUMENTS[ho.from].name : "다른";
  if (ho.example) { await loadExample(ho.example); return true; }
  const sess = records.session();
  if (ho.title && sess && await autoPair()) {
    try {
      const norm = (t) => String(t || "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
      const { items } = await bridge.library(sess.session);
      const same = items.filter((x) => norm(x.title) === norm(ho.title));
      const it = same.find((x) => norm(x.artist) === norm(ho.artist)) || same[0];
      if (it) {
        setScore(loadAnyFormat(await bridge.libraryGet(it.file, sess.session)), { msg: `${from} 악보에서 넘어옴: 내 악보의 ${INST.name}판을 엶` });
        libraryFile = it.file;
        rememberSource("library", it.file);
        return true;
      }
    } catch (_) { /* not in my library here: the handed sheet below */ }
  }
  if (!ho.score) return false;
  const s = loadAnyFormat(ho.score);
  setScore(s, { msg: describeImport(s) });
  libraryFile = null;
  rememberSource(null);
  return true;
}

syncKind();
$(".lead-track").addEventListener("change", (e) => {
  settings.leadTrack = e.target.value;
  store.set(skey("settings"), settings);
  showScore();
  updatePosition(player.position());
});

// sound input for the microphone checks (an audio interface with a guitar plugged in, a USB microphone ...)
const devSel = $(".input-dev");
async function fillDevices() {
  const list = await practice.inputDevices();
  devSel.replaceChildren(new Option("기본 입력", ""), ...list.map((d) => new Option(d.label, d.id)));
  devSel.value = list.some((d) => d.id === practice.deviceId) ? practice.deviceId : "";
}
devSel.addEventListener("pointerdown", fillDevices);
devSel.addEventListener("focus", fillDevices);
devSel.addEventListener("change", () => practice.setDevice(devSel.value).then(fillDevices));
fillDevices();

// tuning choices of this site's instrument in every tuning menu
for (const sel of $$("select[name=tuning]")) sel.innerHTML = tuningsOf(INST.id).map((t) => `<option value="${t.name}">${t.label}</option>`).join("");
const ownTuning = (t) => (TUNINGS[t] && TUNINGS[t].inst === INST.id ? t : INST.defaultTuning);

const importDlg = $(".dlg-import");
function askImportOptions(defTuning = INST.defaultTuning) {
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
  rememberSource(null);
  const fname = obj && obj.format && (obj.format.name || obj.format.formatName);
  // the otamatone has one tuning, and SPRED notes keep their pitch there: nothing to ask
  if ((fname === "spred-sheet" || fname === "ukulele-transcription") && !opts && !INST.roll) {
    opts = await askImportOptions(ownTuning(obj.tuning));
    if (!opts) return;
  }
  const s = loadAnyFormat(obj, opts || {});
  if (sourceName && !s.meta.title) s.meta.title = sourceName.replace(/\.(uke\.|guitar\.|ota\.)?json$/i, "");
  setScore(s, { msg: describeImport(s) });
  seek(0);
}

function describeImport(s) {
  const parts = [];
  if (s.converted) parts.push(INST.roll ? `${INSTRUMENTS[s.converted.from].name} 악보의 멜로디를 오타마톤 음으로 옮김`
    : `${INSTRUMENTS[s.converted.from].name} 악보를 ${INST.name} 코드로 옮김${s.converted.capo ? ` (카포 ${s.converted.capo})` : ""}`);
  for (const r of s.importReport || []) {
    const bits = [];
    if (r.shift) bits.push(`멜로디를 ${r.shift > 0 ? "" : "-"}${Math.abs(r.shift / 12)}옥타브 옮김`);
    if (r.folded) bits.push(`음역 밖 음 ${r.folded}개는 따로 옥타브를 옮김`);
    if (r.skipped) bits.push(`못 읽은 칸 ${r.skipped}개`);
    if (bits.length) parts.push(`${r.track}: ${bits.join(", ")}`);
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

const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let libraryFile = null; // file name in my library of the score that is open, so saving writes back to it

// ---------------------------------------------------------------- song list on the left
// The examples and (for the owner account) my library stay at hand on the left: a song opens with one click.
// The 악보 button folds the list away (remembered in this browser); on a narrow screen it lies over the page
// and folds after a pick.
const SONGBAR = skey("songbar");
const narrowScreen = () => window.innerWidth < 1000;

function showSongbar(open, { quiet = false } = {}) {
  document.body.classList.toggle("songbar-open", open);
  $$("[data-act=songbar]").forEach((b) => b.setAttribute("aria-pressed", String(open)));
  store.set(SONGBAR, open);
  if (open) drawSongbar();
  if (!quiet && !narrowScreen()) window.dispatchEvent(new Event("resize")); // the sheet gets narrower or wider
}

function drawSongbar() {
  const filter = $(".sb-filter");
  if (!filter) return;
  const q = filter.value.trim().toLowerCase();
  const src = store.get(SRC, null);
  const fill = (box, items, kind) => {
    box.textContent = "";
    for (const it of items.filter((x) => !q || `${x.title} ${x.artist || ""} ${x.note || ""}`.toLowerCase().includes(q))) {
      const b = document.createElement("button");
      b.type = "button";
      const sub = kind === "library" ? `${it.artist || ""}${it.capo ? ` · 카포 ${it.capo}` : ""}` : it.note || "";
      b.innerHTML = `<b>${escHtml(it.title)}</b>${sub ? `<small>${escHtml(sub)}</small>` : ""}`;
      b.title = sub ? `${it.title} · ${sub}` : it.title;
      if (src && src.kind === kind && src.file === it.file) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => openSong(kind, it));
      box.appendChild(b);
    }
    if (!box.children.length) box.textContent = items.length ? "맞는 곡 없음" : "아직 없음";
  };
  // my library is only for the owner account; everyone else does not see the section at all
  $$(".sb-mine-part").forEach((el) => { el.hidden = !songbar.mine; });
  if (songbar.mine) {
    fill($(".sb-mine"), songbar.mine, "library");
    $(".sb-count").textContent = `${songbar.mine.length}곡`;
  }
  fill($(".sb-examples"), songbar.examples, "example");
  const cur = $(".sb-list [aria-current=true]");
  if (cur) cur.scrollIntoView({ block: "nearest" });
}

async function openSong(kind, it) {
  if (narrowScreen()) showSongbar(false);
  try {
    if (kind === "example") { await loadExample(it.file); return; }
    const sess = records.session();
    setScore(loadAnyFormat(await bridge.libraryGet(it.file, sess && sess.session)));
    libraryFile = it.file;
    rememberSource("library", it.file);
    seek(0);
  } catch (err) { status(`악보를 못 엶: ${err.message}`, true); }
}

$(".sb-filter").addEventListener("input", drawSongbar);
fetch("examples/manifest.json").then((r) => r.json()).then((items) => { songbar.examples = items; drawSongbar(); })
  .catch((err) => { $(".sb-examples").textContent = `예제 목록을 못 불러옴: ${err.message}`; });
showSongbar(store.get(SONGBAR, !narrowScreen()), { quiet: true });

function syncAccount() {
  const s = records.session();
  const b = $("[data-act=account]");
  b.textContent = s ? s.id : "로그인";
  b.hidden = false;
  // my library is for the owner account only; ask the bridge whether this login may use it
  $("[data-act=save-lib]").hidden = true;
  $("[data-act=examples]").textContent = "예제";
  songbar.mine = null;
  drawSongbar();
  if (s) {
    bridge.library(s.session).then(({ items }) => {
      $("[data-act=save-lib]").hidden = false;
      $("[data-act=examples]").textContent = "예제·내 악보";
      songbar.mine = items;
      drawSongbar();
    }).catch(() => {});
  }
}

// connect to the bridge (on this PC directly, elsewhere through the tunnel) without copying a token
let connecting = null;
async function autoPair() {
  if (bridgeSettings().token || isRemote()) return true;
  connecting = connecting || connectBridge();
  const mode = await connecting;
  connecting = null;
  if (mode) syncAccount();
  return !!mode;
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

// ---------------------------------------------------------------- strum patterns for the song and each bar

const arrowsOf = (slots) => [...slots].map((c) => ARROW[c] || c).join("");
let strumRec = null;

function strumOptions(beats, rec) {
  const list = SHEET_STRUMS.filter((p) => (p.beats || 4) === (beats === 3 ? 3 : 4));
  return list.map((p) => `<option value="${p.slots}">${arrowsOf(p.slots)}  ${escHtml(p.name)}${p.slots === rec ? " ★추천" : ""}</option>`).join("");
}

function openStrumPicker(focusBar = -1) {
  const dlg = $(".dlg-strum");
  strumRec = recommendStrums(score);
  const bars = computeBars(score);
  const cur = currentPerBar(score);
  dlg.querySelector(".st-src").textContent = strumRec.source === "recording"
    ? "★추천: 원곡 반주에서 8분음표마다 소리가 나는 자리를 보고 마디마다 가장 비슷한 패턴을 고름. 4마디 단위로 같은 패턴을 이어 감"
    : "★추천: 박자·빠르기·멜로디가 바쁜 정도로 고름. 원곡 분석이 있는 악보는 반주 소리로 고름";
  const base = dlg.querySelector("[name=base]");
  base.innerHTML = strumOptions(4, strumRec.base);
  if (![...base.options].some((o) => o.value === score.strum.pattern)) base.insertAdjacentHTML("afterbegin", `<option value="${escHtml(score.strum.pattern)}">${arrowsOf(score.strum.pattern)}  지금 패턴</option>`);
  base.value = score.strum.pattern;
  const box = dlg.querySelector(".st-bars");
  box.innerHTML = "";
  bars.forEach((bar, i) => {
    const names = shown.chords.filter((c) => c.col >= bar.start && c.col < bar.start + bar.len).map((c) => c.name);
    const cell = document.createElement("div");
    cell.className = "st-bar" + (i === focusBar ? " focus" : "");
    cell.dataset.bar = i;
    if (cur[i] === null) {
      cell.innerHTML = `<b>${i + 1}마디</b> <span class="none">코드 없음</span>`;
    } else {
      cell.innerHTML = `<b>${i + 1}마디</b> ${escHtml(names.join(" ") || "")}<select aria-label="${i + 1}마디 스트럼">${strumOptions(bar.beats, strumRec.perBar[i])}</select>`;
      const sel = cell.querySelector("select");
      if (![...sel.options].some((o) => o.value === cur[i])) sel.insertAdjacentHTML("afterbegin", `<option value="${escHtml(cur[i])}">${arrowsOf(cur[i])}  지금 패턴</option>`);
      sel.value = cur[i];
      sel.addEventListener("change", markStrumCells);
    }
    box.appendChild(cell);
  });
  markStrumCells();
  dlg.showModal();
  if (focusBar >= 0) box.querySelector(`[data-bar="${focusBar}"]`)?.scrollIntoView({ block: "center" });
}

// outline the bars whose pattern differs from the bar before (where the sheet will show a change)
function markStrumCells() {
  let prev = $(".dlg-strum [name=base]").value;
  $$(".dlg-strum .st-bar").forEach((cell) => {
    const sel = cell.querySelector("select");
    if (!sel) return;
    cell.classList.toggle("changed", sel.value !== prev);
    prev = sel.value;
  });
}

function fillStrumPicker(how) {
  const dlg = $(".dlg-strum");
  if (how === "recommend") dlg.querySelector("[name=base]").value = strumRec.base;
  const base = dlg.querySelector("[name=base]").value;
  dlg.querySelectorAll(".st-bar").forEach((cell) => {
    const sel = cell.querySelector("select");
    if (!sel) return;
    const want = how === "recommend" ? strumRec.perBar[+cell.dataset.bar] : base;
    if ([...sel.options].some((o) => o.value === want)) sel.value = want;
  });
  markStrumCells();
}

function applyStrumPicker() {
  const dlg = $(".dlg-strum");
  const base = dlg.querySelector("[name=base]").value;
  const perBar = computeBars(score).map((_, i) => dlg.querySelector(`.st-bar[data-bar="${i}"] select`)?.value || null);
  const { pattern, strums } = toStrumEvents(score, perBar, base);
  mutate((s) => { s.strum.pattern = pattern; s.strums = strums; }, "스트럼 패턴");
  dlg.close();
}
$(".dlg-strum [name=base]").addEventListener("change", markStrumCells);

function openLyrics() {
  const dlg = $(".dlg-lyrics");
  const sel = dlg.querySelector("[name=track]");
  sel.innerHTML = score.tracks.map((t, i) => `<option value="${i}">${escHtml(t.name)} (${t.notes.length}음)</option>`).join("");
  dlg.querySelector(".ly-msg").textContent = "";
  dlg.showModal();
}

function applyLyrics() {
  const dlg = $(".dlg-lyrics");
  const text = dlg.querySelector("[name=text]").value;
  const ti = +dlg.querySelector("[name=track]").value || 0;
  try {
    const ev = alignLyrics(score, text, ti);
    mutate((s) => { s.lyrics = ev; }, "가사");
    dlg.close();
  } catch (err) {
    dlg.querySelector(".ly-msg").textContent = err.message;
  }
}

async function saveToLibrary() {
  const def = libraryFile || `${(score.meta.title || "새 악보").replace(/[\\/:*?"<>|]/g, "_")}${score.meta.artist ? " - " + score.meta.artist.replace(/[\\/:*?"<>|]/g, "_") : ""}${INST.fileExt}`;
  const name = prompt("내 악보함에 저장할 파일 이름", def);
  if (!name) return;
  const file = name.endsWith(".json") ? name : `${name}.json`;
  try {
    const sess = records.session();
    if (!sess) throw new Error("내 악보함은 주인 아이디로 로그인해야 쓸 수 있음");
    await bridge.librarySave(file, JSON.parse(toJSON(score)), sess.session);
    libraryFile = file;
    rememberSource("library", file);
    bridge.library(sess.session).then(({ items }) => { songbar.mine = items; drawSongbar(); }).catch(() => {});
  } catch (err) {
    status(`저장 못 함: ${err.message}`, true);
  }
}

async function loadExample(file) {
  const obj = await (await fetch(`examples/${file}`)).json();
  const s = loadAnyFormat(obj);
  setScore(s, { msg: describeImport(s) });
  libraryFile = null;
  rememberSource("example", file);
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
  f("capo").value = String(score.capo || 0);
  const names = [...new Set(score.chords.map((c) => c.name).filter((c) => c !== "N.C."))];
  // capo positions that make the shapes easiest while the sound stays the same
  const sounding = score.chords.filter((c) => c.name !== "N.C.").map((c) => transposeChord(c.name, score.capo || 0));
  const easiest = capoChoices(sounding, score.tuning).slice(0, 3).map((x) => x.capo);
  const hint = () => {
    const k = +f("transpose").value || 0;
    const shift = k - ((+f("capo").value || 0) - (score.capo || 0));
    const ex = names.slice(0, 6).map((c) => `${c}→${transposeChord(c, shift)}`).join(", ");
    dlg.querySelector(".transpose-hint").textContent =
      (shift ? `코드 모양: ${ex}. ` : "") + (k ? "조옮김은 원곡 영상과 음이 달라짐. " : "") + `쉬운 카포: ${easiest.join(", ")}`;
  };
  f("transpose").oninput = hint;
  f("capo").oninput = hint;
  hint();
  dlg.returnValue = "";
  dlg.showModal();
  dlg.addEventListener("close", () => {
    if (dlg.returnValue !== "ok") return;
    const k = +f("transpose").value || 0;
    const newTuning = f("tuning").value;
    const newCapo = Math.max(0, Math.min(12, Math.round(+f("capo").value || 0)));
    mutate((s) => {
      s.meta.title = f("title").value.trim();
      s.meta.artist = f("artist").value.trim();
      s.meta.key = f("key").value.trim();
      s.strum.pattern = f("pattern").value.trim().toUpperCase().replace(/[^DUX-]/g, "") || "D-DU-UDU";
      const vid = parseVideoId(f("video").value);
      s.youtube.videoId = vid;
      s.youtube.offsetMs = Math.round(+f("offset").value || 0);
      // same sound (plus the transposition); shapes and frets move by the capo change
      if (k || newTuning !== s.tuning || newCapo !== (s.capo || 0)) retune(s, newTuning, newCapo, k, 0);
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
    await openObject(obj, obj.meta && obj.meta.title, { tuning: ownTuning(obj.tuning) });
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
  if (isRemote()) {
    // the tunnel does not take jobs: Claude runs on the PC, so it is started there
    txDlg.querySelector(".tx-conn").textContent = "";
    txDlg.querySelector(".tx-jobs").textContent = "유튜브로 악보 따기는 집 PC에서만 됨";
    txDlg.querySelector("[data-act=tx-start]").disabled = true;
    return;
  }
  txDlg.querySelector("[data-act=tx-start]").disabled = false;
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
    syncAccount();
  }
});

// ---------------------------------------------------------------- start

syncAccount();
records.flush().catch(() => {});

window.addEventListener("resize", () => { if (!editing) { sheet.render(shown, settings); updatePosition(player.position()); } });

(async function start() {
  const params = new URLSearchParams(location.search);
  // pairing link from the bridge: #token=... is stored and removed from the address bar
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("token")) {
    saveBridgeSettings({ ...bridgeSettings(), token: hash.get("token") });
    syncAccount();
    history.replaceState(null, "", location.pathname + location.search);
  }
  autoPair().then((ok) => { if (ok) records.flush().catch(() => {}); });
  try {
    if (params.get("job")) { await loadJob(params.get("job")); return; }
    if (params.get("example")) { await loadExample(params.get("example") + ".json"); return; }
    if (await openHandoff()) return;
    const last = store.get(skey("last"), null);
    const src = store.get(SRC, null);
    if (src && !src.edited && src.kind === "example") { await loadExample(src.file); return; }
    if (last) setScore(loadAnyFormat(last));
    if (src && !src.edited && src.kind === "library") {
      // my library may have a newer version than the copy kept in this browser
      libraryFile = src.file;
      const sess = records.session();
      if (sess && await autoPair()) {
        try { setScore(loadAnyFormat(await bridge.libraryGet(src.file, sess.session))); } catch (_) { /* keep the copy */ }
      }
    }
    if (last || src) return;
    await loadExample("twinkle.json");
  } catch (err) {
    setScore(newScore());
    status(`시작 악보를 못 엶: ${err.message}`, true);
  }
})();
