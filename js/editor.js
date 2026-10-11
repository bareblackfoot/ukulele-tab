// Grid editor (similar to the SPRED editor): one column per step, rows for tempo, meter, sections,
// chords, lyrics and the four strings. Click a cell, then type.

import { computeBars, barAt } from "./model.js";
import { parseChord } from "./chords.js";

const ROWS = [
  { id: "ruler", label: "마디", h: 20 },
  { id: "tempo", label: "BPM", h: 20 },
  { id: "meter", label: "박자", h: 20 },
  { id: "section", label: "구간", h: 20 },
  { id: "chord", label: "코드", h: 26 },
  { id: "lyric", label: "가사", h: 24 },
  { id: "s3", label: "A", h: 22, string: 3 },
  { id: "s2", label: "E", h: 22, string: 2 },
  { id: "s1", label: "C", h: 22, string: 1 },
  { id: "s0", label: "G", h: 22, string: 0 },
];
const LABEL_W = 52;
const TRACK_COLORS = ["#1f6fd1", "#2b8a3e", "#9c36b5", "#e67700"];

export class Editor {
  constructor(root, { onChange, onSeek, status }) {
    this.root = root;
    this.onChange = onChange;   // (mutator, label) => void ; main applies history + rerender
    this.onSeek = onSeek;
    this.status = status;
    this.cw = 18;
    this.sel = { row: 4, col: 0 };
    this.track = 0;
    this.newLen = 2;
    this.playCol = null;
    this.fretBuf = "";
    this.fretTimer = null;
    root.innerHTML = `
      <div class="ed-tools">
        <label>트랙 <select class="ed-track"></select></label>
        <label><input type="checkbox" class="ed-hide"> 숨김</label>
        <label><input type="checkbox" class="ed-mute"> 소리 끔</label>
        <button type="button" class="ed-addtrack">트랙 추가</button>
        <label>새 음 길이 <select class="ed-len">
          <option value="1">16분음표</option><option value="2" selected>8분음표</option><option value="4">4분음표</option>
          <option value="8">2분음표</option><option value="16">온음표</option></select></label>
        <label>칸 너비 <input type="range" class="ed-zoom" min="8" max="40" value="18"></label>
        <button type="button" class="ed-addbars">4마디 추가</button>
        <button type="button" class="ed-undo">실행 취소</button>
        <button type="button" class="ed-redo">다시 실행</button>
        <span class="hint">칸 누르고: 숫자 = 프렛 · Enter = 글자 입력 · Delete = 지우기 · [ ] = 음 길이 · 방향키 = 이동 · Space = 재생</span>
      </div>
      <div class="ed-scroll" tabindex="0"><canvas class="ed-canvas"></canvas><div class="ed-spacer"></div></div>`;
    this.scroll = root.querySelector(".ed-scroll");
    this.canvas = root.querySelector(".ed-canvas");
    this.spacer = root.querySelector(".ed-spacer");
    this.ctx = this.canvas.getContext("2d");
    this.scroll.addEventListener("scroll", () => this.draw());
    this.canvas.addEventListener("mousedown", (e) => this.mouse(e));
    this.canvas.addEventListener("dblclick", (e) => { this.mouse(e); this.openInput(""); });
    this.scroll.addEventListener("keydown", (e) => this.key(e));
    root.querySelector(".ed-zoom").addEventListener("input", (e) => { this.cw = +e.target.value; this.layout(); });
    root.querySelector(".ed-len").addEventListener("change", (e) => { this.newLen = +e.target.value; });
    root.querySelector(".ed-track").addEventListener("change", (e) => { this.track = +e.target.value; this.syncTrackBoxes(); this.draw(); });
    root.querySelector(".ed-hide").addEventListener("change", (e) => this.change((s) => { s.tracks[this.track].hidden = e.target.checked; }, "트랙 숨김"));
    root.querySelector(".ed-mute").addEventListener("change", (e) => this.change((s) => { s.tracks[this.track].muted = e.target.checked; }, "트랙 소리"));
    root.querySelector(".ed-addtrack").addEventListener("click", () => {
      const name = prompt("새 트랙 이름", `트랙 ${this.score.tracks.length + 1}`);
      if (!name) return;
      this.change((s) => { s.tracks.push({ id: `t${Date.now()}`, name, notes: [] }); }, "트랙 추가");
      this.track = this.score.tracks.length - 1;
    });
    root.querySelector(".ed-addbars").addEventListener("click", () => this.change((s) => {
      const bars = computeBars(s);
      const last = bars[bars.length - 1];
      s.columnCount += 4 * (last ? last.beats : 4) * s.stepsPerBeat;
    }, "마디 추가"));
    this.undoBtn = root.querySelector(".ed-undo");
    this.redoBtn = root.querySelector(".ed-redo");
    new ResizeObserver(() => this.layout()).observe(this.scroll);
  }

  setScore(score) {
    this.score = score;
    this.bars = computeBars(score);
    if (this.track >= score.tracks.length) this.track = 0;
    const sel = this.root.querySelector(".ed-track");
    sel.innerHTML = score.tracks.map((t, i) => `<option value="${i}">${t.name.replace(/</g, "&lt;")}</option>`).join("");
    sel.value = String(this.track);
    this.syncTrackBoxes();
    this.layout();
  }

  syncTrackBoxes() {
    const t = this.score.tracks[this.track];
    this.root.querySelector(".ed-hide").checked = !!t.hidden;
    this.root.querySelector(".ed-mute").checked = !!t.muted;
  }

  setHistoryButtons(canUndo, canRedo) {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  layout() {
    if (!this.score || this.root.hidden) return;
    const H = ROWS.reduce((a, r) => a + r.h, 0) + 8;
    const W = this.scroll.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.width = W + "px";
    this.canvas.style.height = H + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.spacer.style.width = LABEL_W + this.score.columnCount * this.cw + 40 + "px";
    this.canvas.style.marginBottom = -H + "px";
    this.H = H;
    this.W = W;
    this.draw();
  }

  rowTop(i) { let y = 0; for (let k = 0; k < i; k++) y += ROWS[k].h; return y; }
  xOf(col) { return LABEL_W + col * this.cw - this.scroll.scrollLeft; }

  draw() {
    const s = this.score;
    if (!s || !this.W) return;
    const c = this.ctx, cw = this.cw, sl = this.scroll.scrollLeft;
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    const ink = v("--ink"), ink2 = v("--ink2"), grid = v("--grid"), paper = v("--paper"), accent = v("--accent"), cursor = v("--cursor"), hl = v("--hl");
    c.fillStyle = paper;
    c.fillRect(0, 0, this.W, this.H);
    const c0 = Math.max(0, Math.floor(sl / cw) - 1);
    const c1 = Math.min(s.columnCount, Math.ceil((sl + this.W) / cw) + 1);
    const spb = s.stepsPerBeat;
    // bar shading and grid lines
    for (const bar of this.bars) {
      if (bar.start + bar.len < c0 || bar.start > c1) continue;
      if (bar.index % 2 === 1) {
        c.fillStyle = grid + "33";
        c.fillRect(this.xOf(bar.start), 0, bar.len * cw, this.H);
      }
    }
    for (let col = c0; col <= c1; col++) {
      const bar = barAt(this.bars, Math.min(col, s.columnCount - 1));
      const inBar = col - bar.start;
      const x = Math.round(this.xOf(col)) + 0.5;
      c.strokeStyle = inBar === 0 || col === bar.start + bar.len ? ink : inBar % spb === 0 ? grid : grid + "66";
      c.lineWidth = inBar === 0 ? 1.4 : 1;
      c.beginPath();
      c.moveTo(x, inBar === 0 ? 0 : ROWS[0].h);
      c.lineTo(x, this.H);
      c.stroke();
      if (inBar === 0) {
        c.fillStyle = ink2;
        c.font = "10px system-ui";
        c.fillText(String(bar.index + 1), x + 3, 13);
      }
    }
    // horizontal string lines
    ROWS.forEach((r, i) => {
      const y = this.rowTop(i);
      c.strokeStyle = grid;
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(this.W, y + 0.5); c.stroke();
      if (r.string !== undefined) {
        c.strokeStyle = ink2;
        c.beginPath(); c.moveTo(LABEL_W, y + r.h / 2 + 0.5); c.lineTo(this.W, y + r.h / 2 + 0.5); c.stroke();
      }
    });
    const text = (rowIdx, col, str, font = "12px system-ui", color = ink) => {
      const x = this.xOf(col);
      if (x < LABEL_W - 200 || x > this.W) return;
      c.font = font;
      c.fillStyle = color;
      c.fillText(str, x + 2, this.rowTop(rowIdx) + ROWS[rowIdx].h / 2 + 4);
    };
    for (const t of s.tempo) text(1, t.col, String(t.bpm), "11px system-ui", accent);
    for (const m of s.meter) text(2, m.col, `${m.beats}/4`, "11px system-ui", accent);
    for (const e of s.sections) text(3, e.col, e.text, "bold 11px system-ui", accent);
    for (const e of s.chords) text(4, e.col, e.name, "bold 13px system-ui", parseChord(e.name) || e.name === "N.C." ? ink : "#c92a2a");
    for (const e of s.lyrics) text(5, e.col, e.text, "13px system-ui");
    // notes
    s.tracks.forEach((t, ti) => {
      if (t.hidden && ti !== this.track) return;
      const col = TRACK_COLORS[ti % TRACK_COLORS.length];
      const alpha = ti === this.track ? 1 : 0.35;
      for (const n of t.notes) {
        if (n.col + n.len < c0 || n.col > c1) continue;
        const ri = ROWS.findIndex((r) => r.string === n.string);
        const y = this.rowTop(ri);
        const x = this.xOf(n.col);
        c.globalAlpha = alpha * 0.28;
        c.fillStyle = col;
        c.fillRect(x + 1, y + 4, n.len * cw - 2, ROWS[ri].h - 8);
        c.globalAlpha = alpha;
        c.fillStyle = paper;
        const label = String(n.fret);
        c.font = "bold 12px ui-monospace, Consolas, monospace";
        const w = c.measureText(label).width + 4;
        c.fillRect(x + 1, y + 4, w, ROWS[ri].h - 8);
        c.fillStyle = col;
        c.fillText(label, x + 3, y + ROWS[ri].h / 2 + 4);
        c.globalAlpha = 1;
      }
    });
    // loop range
    if (this.loop) {
      c.fillStyle = cursor + "22";
      c.fillRect(this.xOf(this.loop.start), 0, (this.loop.end - this.loop.start) * cw, this.H);
    }
    // selection
    const r = ROWS[this.sel.row];
    c.strokeStyle = cursor;
    c.lineWidth = 2;
    c.strokeRect(this.xOf(this.sel.col) + 1, this.rowTop(this.sel.row) + 1, cw - 2, r.h - 2);
    // playhead
    if (this.playCol !== null) {
      const x = this.xOf(this.playCol);
      c.strokeStyle = cursor;
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, this.H); c.stroke();
    }
    // labels column
    c.fillStyle = v("--panel");
    c.fillRect(0, 0, LABEL_W, this.H);
    ROWS.forEach((row, i) => {
      c.fillStyle = row.string !== undefined ? ink : ink2;
      c.font = row.string !== undefined ? "bold 12px system-ui" : "11px system-ui";
      c.fillText(row.label, 8, this.rowTop(i) + row.h / 2 + 4);
    });
    c.fillStyle = hl;
    c.fillRect(LABEL_W - 3, this.rowTop(this.sel.row), 3, ROWS[this.sel.row].h);
  }

  setPlayhead(col, follow) {
    this.playCol = col;
    if (follow && col !== null) {
      const x = LABEL_W + col * this.cw;
      const sl = this.scroll.scrollLeft;
      if (x < sl + LABEL_W + 40 || x > sl + this.W * 0.75) this.scroll.scrollLeft = x - this.W * 0.3;
    }
    this.draw();
  }

  mouse(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let ri = 0, acc = 0;
    for (; ri < ROWS.length; ri++) { if (y < acc + ROWS[ri].h) break; acc += ROWS[ri].h; }
    if (ri >= ROWS.length) return;
    const col = Math.floor((x - LABEL_W + this.scroll.scrollLeft) / this.cw);
    if (col < 0 || col >= this.score.columnCount) return;
    if (ROWS[ri].id === "ruler") { this.onSeek(col); return; }
    this.sel = { row: ri, col };
    this.fretBuf = "";
    this.scroll.focus({ preventScroll: true });
    this.draw();
  }

  change(fn, label) { this.onChange(fn, label); }

  noteAt(string, col, track = this.track) {
    const t = this.score.tracks[track];
    return t.notes.find((n) => n.string === string && n.col <= col && col < n.col + n.len);
  }

  key(e) {
    if (e.target !== this.scroll) return;
    const row = ROWS[this.sel.row];
    const spb = this.score.stepsPerBeat;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "Z")) { e.preventDefault(); this.onChange(e.shiftKey ? "redo" : "undo"); return; }
    if ((e.ctrlKey || e.metaKey) && (k === "y" || k === "Y")) { e.preventDefault(); this.onChange("redo"); return; }
    if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      const step = e.shiftKey ? spb : 1;
      this.sel.col = Math.max(0, Math.min(this.score.columnCount - 1, this.sel.col + (k === "ArrowLeft" ? -step : step)));
      this.ensureVisible();
      this.fretBuf = "";
      this.draw();
      return;
    }
    if (k === "ArrowUp" || k === "ArrowDown") {
      e.preventDefault();
      this.sel.row = Math.max(1, Math.min(ROWS.length - 1, this.sel.row + (k === "ArrowUp" ? -1 : 1)));
      this.fretBuf = "";
      this.draw();
      return;
    }
    if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      this.deleteAt();
      return;
    }
    if (row.string !== undefined) {
      if (/^[0-9]$/.test(k)) {
        e.preventDefault();
        clearTimeout(this.fretTimer);
        const two = this.fretBuf + k;
        const fret = this.fretBuf && +two <= 24 ? +two : +k;
        this.fretBuf = this.fretBuf && +two <= 24 ? "" : k;
        this.fretTimer = setTimeout(() => { this.fretBuf = ""; }, 800);
        const col = this.sel.col, string = row.string;
        this.change((s) => {
          const t = s.tracks[this.track];
          const ex = t.notes.find((n) => n.string === string && n.col === col);
          if (ex) ex.fret = fret;
          else {
            t.notes.push({ col, len: this.newLen, string, fret });
            if (col + this.newLen > s.columnCount) s.columnCount = col + this.newLen;
          }
        }, "음 입력");
        return;
      }
      if (k === "[" || k === "]") {
        e.preventDefault();
        const n = this.noteAt(row.string, this.sel.col);
        if (!n) return;
        const d = k === "]" ? 1 : -1;
        const idx = this.score.tracks[this.track].notes.indexOf(n);
        this.change((s) => { const m = s.tracks[this.track].notes[idx]; m.len = Math.max(1, m.len + d); }, "음 길이");
        return;
      }
      if (k === "Enter") { e.preventDefault(); this.sel.col = Math.min(this.score.columnCount - 1, this.sel.col + this.newLen); this.draw(); }
      return;
    }
    if (k === "Enter" || k === "F2") { e.preventDefault(); this.openInput(null); return; }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && k !== " ") { e.preventDefault(); this.openInput(k); }
  }

  ensureVisible() {
    const x = LABEL_W + this.sel.col * this.cw;
    const sl = this.scroll.scrollLeft;
    if (x < sl + LABEL_W) this.scroll.scrollLeft = x - LABEL_W - 20;
    else if (x > sl + this.W - 60) this.scroll.scrollLeft = x - this.W + 120;
  }

  eventList(s, id) {
    return { tempo: s.tempo, meter: s.meter, section: s.sections, chord: s.chords, lyric: s.lyrics }[id];
  }

  deleteAt() {
    const row = ROWS[this.sel.row], col = this.sel.col;
    if (row.string !== undefined) {
      const n = this.noteAt(row.string, col);
      if (!n) return;
      const idx = this.score.tracks[this.track].notes.indexOf(n);
      this.change((s) => { s.tracks[this.track].notes.splice(idx, 1); }, "음 지우기");
      return;
    }
    const list = this.eventList(this.score, row.id);
    const i = list.findIndex((e) => e.col === col);
    if (i < 0 || ((row.id === "tempo" || row.id === "meter") && col === 0)) return;
    this.change((s) => { this.eventList(s, row.id).splice(i, 1); }, "지우기");
  }

  openInput(initial) {
    const row = ROWS[this.sel.row];
    if (row.string !== undefined || row.id === "ruler") return;
    const list = this.eventList(this.score, row.id);
    const ex = list.find((e) => e.col === this.sel.col);
    const key = { tempo: "bpm", meter: "beats", section: "text", chord: "name", lyric: "text" }[row.id];
    const inp = document.createElement("input");
    inp.className = "ed-input";
    inp.value = initial !== null && initial !== "" ? initial : ex ? String(ex[key]) : "";
    const x = this.xOf(this.sel.col), y = this.rowTop(this.sel.row);
    inp.style.left = Math.max(LABEL_W, x) + "px";
    inp.style.top = this.canvas.offsetTop + y - 2 + "px";
    inp.style.width = row.id === "section" ? "140px" : "90px";
    this.scroll.appendChild(inp);
    inp.focus();
    if (initial === null || initial === "") inp.select();
    let done = false;
    const finish = (commit, move) => {
      if (done) return;
      done = true;
      const val = inp.value.trim();
      inp.remove();
      this.scroll.focus({ preventScroll: true });
      if (commit) this.commitText(row.id, key, this.sel.col, val);
      if (move) {
        const step = row.id === "lyric" ? this.nextLyricStep(this.sel.col) : this.score.stepsPerBeat;
        this.sel.col = Math.min(this.score.columnCount - 1, this.sel.col + step);
        this.ensureVisible();
        this.draw();
      }
    };
    inp.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") { e.preventDefault(); finish(true, true); }
      else if (e.key === "Tab") { e.preventDefault(); finish(true, true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false, false); }
      e.stopPropagation();
    });
    inp.addEventListener("blur", () => finish(true, false));
  }

  // after typing a lyric syllable, go to the next melody note start (or one 8th later)
  nextLyricStep(col) {
    const starts = this.score.tracks.flatMap((t) => t.notes.map((n) => n.col)).filter((c) => c > col).sort((a, b) => a - b);
    return starts.length && starts[0] - col <= this.score.stepsPerBeat * 2 ? starts[0] - col : Math.max(1, this.score.stepsPerBeat / 2);
  }

  commitText(rowId, key, col, val) {
    const parse = {
      tempo: (v) => { const x = parseFloat(v); return x >= 20 && x <= 400 ? Math.round(x * 100) / 100 : null; },
      meter: (v) => { const x = parseInt(v, 10); return x >= 1 && x <= 12 ? x : null; },
      section: (v) => v,
      chord: (v) => v.replace(/\s+/g, ""),
      lyric: (v) => v,
    }[rowId];
    this.change((s) => {
      const list = this.eventList(s, rowId);
      const i = list.findIndex((e) => e.col === col);
      if (!val) {
        if (i >= 0 && !((rowId === "tempo" || rowId === "meter") && col === 0)) list.splice(i, 1);
        return;
      }
      const v = parse(val);
      if (v === null || v === "") return;
      if (i >= 0) list[i][key] = v; else list.push({ col, [key]: v });
      list.sort((a, b) => a.col - b.col);
    }, "입력");
    if (rowId === "chord" && val && !parseChord(val.replace(/\s+/g, "")) && val !== "N.C.") this.status(`모르는 코드 이름이라 운지 그림을 못 그림: ${val}`, true);
  }
}
