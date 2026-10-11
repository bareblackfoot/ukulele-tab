// Practice mode (rhythm game), modelled on SPRED's practice mode: the microphone hears your instrument,
// each target (a strum on a chord, or a melody note) is judged Perfect / Ok / Bad / Miss on timing and
// on the chord (or pitch) that sounded. A lane shows targets moving toward the hit line.

import { chordIndexAt, computeBars, barAt, strumAt } from "./model.js";
import { chordShape } from "./chords.js";
import { tuningOf, instOf, skey } from "./instrument.js";
import { MicAnalyzer, chroma, templateChroma, cosine, yin, rms } from "./dsp.js";

const GRADES = ["perfect", "ok", "bad", "miss"];
const ACC = { perfect: 1, ok: 2 / 3, bad: 1 / 3, miss: 0 };
const LABEL = { perfect: "PERFECT", ok: "OK", bad: "BAD", miss: "MISS" };

// timing windows in ms (real time): [perfect, ok, bad]; beyond the last one the target is missed
export const TIMING = { easy: [100, 170, 250], std: [60, 110, 180], pro: [35, 70, 120] };
// pitch windows in cents for melody: [perfect, ok, bad]
export const PITCH = { easy: [50, 100, 200], std: [50, 100, 200], pro: [30, 60, 100] };
// chord: margin below the best-matching chord that still counts as the right chord
export const CHORD = { easy: [0.06, 0.12, 0.2], std: [0.03, 0.08, 0.14], pro: [0.0, 0.04, 0.08] };

const worse = (a, b) => (GRADES.indexOf(a) > GRADES.indexOf(b) ? a : b);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* blocked */ } },
};

export class Practice {
  constructor(engine, player, ui) {
    this.engine = engine;
    this.player = player;
    this.ui = ui;            // {panel, lane, judge, onMark(col, grade), clearMarks(), status(msg, err), showResult(r)}
    this.on = false;
    this.mode = store.get(skey("practice.mode"), "std");
    this.target = store.get(skey("practice.target"), "beat");
    this.input = store.get(skey("practice.input"), "mic");
    this.offsetMs = store.get(skey("practice.offset"), 80);
    this.mic = null;
    this.targets = [];
    this.pending = [];
    this.flash = null;
    this.reset();
  }

  reset() {
    this.bursts = [];
    this.milestone = null;
    this.stats = { perfect: 0, ok: 0, bad: 0, miss: 0, early: 0, late: 0, combo: 0, maxCombo: 0, score: 0, accSum: 0, timeAccSum: 0, timeN: 0, n: 0 };
    this.flash = null;
  }

  setScore(score) {
    this.score = score;
    this.buildTargets();
  }

  // ---------------------------------------------------------------- targets
  buildTargets() {
    const s = this.score;
    if (!s) return;
    const tm = this.player.tm;
    const spb = s.stepsPerBeat;
    const bars = computeBars(s);
    const out = [];
    if (this.target === "melody") {
      const { strings: tuning, names } = tuningOf(s.tuning);
      for (const t of s.tracks) {
        if (t.hidden || t.muted) continue;
        for (const n of t.notes) out.push({ col: n.col, kind: "note", midi: tuning[n.string] + (s.capo || 0) + n.fret, label: `${names[n.string]}${n.fret}` });
      }
    } else if (s.chords.length) {
      const firstChord = s.chords[0].col;
      for (let col = firstChord; col < s.columnCount; col++) {
        const ci = chordIndexAt(s, col);
        if (ci < 0) continue;
        const ch = s.chords[ci];
        if (ch.name === "N.C." || !chordShape(ch.name, s.tuning, s.chordShapes)) continue;
        const bar = barAt(bars, col);
        const inBar = col - bar.start;
        let hit = false, dir = "D";
        if (this.target === "change") hit = ch.col === col;
        else if (this.target === "beat") hit = inBar % spb === 0;
        else if (spb % 2 === 0 && inBar % (spb / 2) === 0) {
          const pat = strumAt(s, col) || "D-D-D-D-";
          const c = pat[(inBar / (spb / 2)) % pat.length];
          hit = c === "D" || c === "U";
          dir = c;
        }
        if (hit) out.push({ col, kind: "chord", chord: ch.name, change: ch.col === col, dir, label: ch.col === col ? ch.name : dir === "U" ? "↑" : "↓" });
      }
    }
    out.sort((a, b) => a.col - b.col);
    for (const t of out) { t.t = tm.colToTime(t.col); t.grade = null; }
    this.targets = out;
    // chord templates for every chord in the song, to tell the right chord from the others
    this.templates = new Map();
    const tuning = tuningOf(s.tuning).strings;
    for (const c of new Set(s.chords.map((c) => c.name))) {
      const sh = chordShape(c, s.tuning, s.chordShapes);
      if (sh) this.templates.set(c, templateChroma(sh.frets.map((f, i) => (f < 0 ? null : tuning[i] + (s.capo || 0) + f)).filter((x) => x !== null)));
    }
    // a few common chords as well, so a wrong chord outside the song still scores lower
    for (const c of instOf(s.tuning).common) {
      if (this.templates.has(c)) continue;
      const sh = chordShape(c, s.tuning);
      if (sh) this.templates.set(c, templateChroma(sh.frets.map((f, i) => (f < 0 ? null : tuning[i] + (s.capo || 0) + f)).filter((x) => x !== null)));
    }
  }

  // forget judgements from col on (after a seek or when a loop starts again)
  rewind(col) {
    for (const t of this.targets) if (t.col >= col) t.grade = null;
    this.pending = [];
  }

  // ---------------------------------------------------------------- start / stop
  async start() {
    await this.ensureMic();
    this.on = true;
    this.reset();
    this.buildTargets();
    this.rewind(0);
    this.ui.clearMarks();
    this.updateCounts();
    this.idle();
  }

  async ensureMic() {
    this.engine.ensure();
    if (this.input === "mic" && !this.mic) {
      const ctx = this.engine.ctx;
      try {
        this.engine.setRecording(true);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        await ctx.audioWorklet.addModule(new URL("./mic-worklet.js", import.meta.url));
        const src = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "uke-tap");
        const sink = ctx.createGain();
        sink.gain.value = 0;
        src.connect(node).connect(sink).connect(ctx.destination);
        const an = new MicAnalyzer(ctx.sampleRate);
        node.port.onmessage = (e) => an.push(e.data.t, e.data.s);
        this.mic = { stream, node, an };
      } catch (err) {
        this.engine.setRecording(false);
        this.ui.status(`마이크를 못 씀: ${err.message}. 키보드 입력으로 바꿈`, true);
        this.input = "keys";
        this.ui.syncControls();
      }
    }
    return !!this.mic;
  }

  // which chord template the sound right after an onset matches best: {best, expectedScore, bestScore} or null
  hearChord(at, expected) {
    const an = this.mic && this.mic.an;
    if (!an) return null;
    const x = an.window(at + 0.03, 4096);
    if (!x) return null;
    if (rms(x) < an.noise * 3) return { best: null, quiet: true };
    const c = chroma(x, an.sr);
    let best = null, bestV = -1;
    for (const [name, tpl] of this.templates) { const v = cosine(c, tpl); if (v > bestV) { bestV = v; best = name; } }
    const exp = this.templates.get(expected);
    return { best, bestScore: bestV, expectedScore: exp ? cosine(c, exp) : 0 };
  }

  stop() {
    this.on = false;
    this.pending = [];
  }

  closeMic() {
    if (this.mic) {
      this.mic.stream.getTracks().forEach((t) => t.stop());
      this.mic.node.disconnect();
      this.mic = null;
      this.engine.setRecording(false);
    }
  }

  // keyboard input: a strum at this moment (timing only)
  keyStrum() {
    if (!this.on || !this.player.playing) return;
    this.handleOnset(this.engine.ctx.currentTime, null);
  }

  // ---------------------------------------------------------------- judging
  scoreTimeOf(ctxTime) {
    const p = this.player;
    return p.startScoreT + (ctxTime - p.startCtx) * p.rate;
  }

  handleOnset(ctxTime, an) {
    const p = this.player;
    if (!p.playing || ctxTime < p.startCtx) return;
    const s = this.scoreTimeOf(ctxTime);
    const win = TIMING[this.mode][2] / 1000;
    let best = null, bestD = Infinity;
    for (const t of this.targets) {
      if (t.grade) continue;
      const d = (s - t.t) / p.rate;
      if (d < -win) break;
      if (Math.abs(d) <= win && Math.abs(d) < bestD) { best = t; bestD = Math.abs(d); }
    }
    if (!best) return; // strums between targets are not penalised
    const d = (s - best.t) / p.rate;
    best.grade = "pending";
    if (!an) { this.finish(best, d, null); return; }
    // wait until 160 ms of sound after the onset has arrived, then look at what was played
    this.pending.push({ target: best, d, at: ctxTime + this.offsetMs / 1000, an });
  }

  timingGrade(dMs) {
    const w = TIMING[this.mode];
    const a = Math.abs(dMs);
    if (this.mode === "easy") return a <= w[2] ? "perfect" : "miss";
    return a <= w[0] ? "perfect" : a <= w[1] ? "ok" : a <= w[2] ? "bad" : "miss";
  }

  soundGrade(target, an, at) {
    const sr = an.sr;
    if (target.kind === "chord") {
      const x = an.window(at + 0.03, 4096);
      if (!x) return { grade: "bad", heard: "?" };
      if (rms(x) < an.noise * 3) return { grade: "bad", heard: "소리 작음" };
      const c = chroma(x, sr);
      let best = null, bestV = -1;
      for (const [name, tpl] of this.templates) { const v = cosine(c, tpl); if (v > bestV) { bestV = v; best = name; } }
      const exp = this.templates.get(target.chord);
      const ev = exp ? cosine(c, exp) : 0;
      const gap = bestV - ev;
      const w = CHORD[this.mode];
      const grade = ev < 0.5 ? "miss" : gap <= w[0] ? "perfect" : gap <= w[1] ? "ok" : gap <= w[2] ? "bad" : "miss";
      return { grade, heard: best };
    }
    const x = an.window(at + 0.03, 2048);
    if (!x) return { grade: "bad", heard: "?" };
    // guitar melody notes go down to about C3 (131 Hz); the ukulele's lowest string is G3/C4
    const { f0, clarity } = yin(x, sr, instOf(this.score.tuning).id === "guitar" ? 75 : 180);
    if (clarity < 0.5) return { grade: "bad", heard: "?" };
    const cents = 1200 * Math.log2(f0 / (440 * 2 ** ((target.midi - 69) / 12)));
    const w = PITCH[this.mode];
    const a = Math.abs(cents);
    return { grade: a < w[0] ? "perfect" : a < w[1] ? "ok" : a < w[2] ? "bad" : "miss", heard: `${Math.round(f0)} Hz`, hz: f0 };
  }

  finish(target, d, sound) {
    const dMs = d * 1000;
    const tg = this.timingGrade(dMs);
    let grade = sound ? worse(sound.grade, tg === "ok" ? "perfect" : tg) : tg;
    if (this.mode === "easy" && sound) grade = sound.grade; // easy: chord/pitch only, like SPRED's easy mode
    target.grade = grade;
    const st = this.stats;
    st[grade]++;
    st.n++;
    st.accSum += ACC[grade];
    if (grade !== "miss") {
      st.timeAccSum += ACC[tg];
      st.timeN++;
      if (tg !== "perfect") dMs < 0 ? st.early++ : st.late++;
    } else { st.timeN++; }
    const breaks = this.mode === "pro" ? grade === "bad" || grade === "miss" : grade === "miss";
    st.combo = breaks ? 0 : st.combo + 1;
    st.maxCombo = Math.max(st.maxCombo, st.combo);
    st.score += Math.round(100 * ACC[grade]);
    this.flash = { grade, text: LABEL[grade], sub: tg !== "perfect" && grade !== "miss" ? (dMs < 0 ? "EARLY" : "LATE") : "", t: performance.now(), combo: st.combo };
    this.bursts.push({ t: performance.now(), grade });
    if (st.combo && (st.combo === 10 || st.combo === 20 || st.combo === 30 || st.combo % 50 === 0)) this.milestone = { n: st.combo, t: performance.now() };
    if (sound && sound.heard) this.ui.heard(sound.heard);
    this.ui.onMark(target.col, grade);
    this.updateCounts();
  }

  // while practice mode is on but nothing plays: keep the mic meter and the lane alive
  idle() {
    if (!this.on || this.player.playing) return;
    if (this.mic) { this.mic.an.takeOnsets(); this.ui.level(this.mic.an.level); }
    this.drawLane();
    requestAnimationFrame(() => this.idle());
  }

  // called every animation frame while playing
  frame() {
    if (!this.on) return;
    const p = this.player;
    const ctx = this.engine.ctx;
    if (this.mic) {
      const an = this.mic.an;
      for (const o of an.takeOnsets()) this.handleOnset(o.t - this.offsetMs / 1000, an);
      this.ui.level(an.level);
      this.pending = this.pending.filter((q) => {
        if (an.lastT < q.at + 0.03 + 4096 / an.sr) return true;
        this.finish(q.target, q.d, this.soundGrade(q.target, an, q.at));
        return false;
      });
    }
    if (p.playing) {
      // targets whose window has passed without a strum are missed
      const s = p.scoreTime();
      const win = TIMING[this.mode][2] / 1000 + 0.05;
      for (const t of this.targets) {
        if (t.t > s) break;
        if (!t.grade && (s - t.t) / p.rate > win) this.recordMiss(t);
      }
    }
    this.drawLane();
    this.drawJudge();
  }

  recordMiss(t) {
    t.grade = "miss";
    const st = this.stats;
    st.miss++;
    st.n++;
    st.timeN++;
    st.combo = 0;
    this.flash = { grade: "miss", text: LABEL.miss, sub: "", t: performance.now(), combo: 0 };
    this.ui.onMark(t.col, "miss");
    this.updateCounts();
  }

  updateCounts() {
    const st = this.stats;
    const acc = st.n ? Math.round((st.accSum / st.n) * 1000) / 10 : 0;
    const tacc = st.timeN ? Math.round((st.timeAccSum / st.timeN) * 1000) / 10 : 0;
    this.ui.counts({ ...st, acc, tacc });
  }

  result() {
    const st = this.stats;
    const total = this.targets.length;
    return {
      ...st,
      total,
      acc: st.n ? Math.round((st.accSum / st.n) * 1000) / 10 : 0,
      tacc: st.timeN ? Math.round((st.timeAccSum / st.timeN) * 1000) / 10 : 0,
      fullCombo: st.n > 0 && st.miss === 0 && (this.mode !== "pro" || st.bad === 0),
      mode: this.mode,
      target: this.target,
    };
  }

  // ---------------------------------------------------------------- drawing
  drawLane() {
    const cv = this.ui.lane;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    c.fillStyle = v("--panel");
    c.fillRect(0, 0, W, H);
    const hitX = 70, pps = Math.max(120, W / 4); // pixels per second of real time
    const p = this.player;
    const now = p.playing ? p.scoreTime() : this.player.tm.colToTime(this.player.position());
    const rate = p.rate || 1;
    // beat grid
    c.strokeStyle = v("--grid");
    c.lineWidth = 1;
    const spb = this.score.stepsPerBeat;
    const tm = p.tm;
    const c0 = Math.floor(tm.timeToCol(Math.max(0, now - 0.5)) / spb) * spb;
    for (let col = c0; col < this.score.columnCount; col += spb) {
      const x = hitX + ((tm.colToTime(col) - now) / rate) * pps;
      if (x > W) break;
      c.beginPath(); c.moveTo(x + 0.5, 8); c.lineTo(x + 0.5, H - 8); c.stroke();
    }
    // bursts where targets were hit: a ring that grows and fades
    const nowMs = performance.now();
    this.bursts = this.bursts.filter((b) => nowMs - b.t < 400);
    const ringColor = { perfect: "#2f9e44", ok: "#1c7ed6", bad: "#f08c00", miss: "#e03131" };
    for (const b of this.bursts) {
      const k = (nowMs - b.t) / 400;
      c.globalAlpha = 1 - k;
      c.strokeStyle = ringColor[b.grade];
      c.lineWidth = b.grade === "perfect" ? 4 : 2;
      c.beginPath(); c.arc(hitX, H / 2, 10 + k * 26, 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1;
    // hit line
    c.strokeStyle = v("--cursor");
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(hitX, 4); c.lineTo(hitX, H - 4); c.stroke();
    const colors = { perfect: "#2f9e44", ok: "#1c7ed6", bad: "#f08c00", miss: "#e03131" };
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (const t of this.targets) {
      const x = hitX + ((t.t - now) / rate) * pps;
      if (x < -40) continue;
      if (x > W + 40) break;
      const y = H / 2;
      const judged = t.grade && t.grade !== "pending";
      c.globalAlpha = judged ? 0.45 : 1;
      if (t.kind === "chord" && t.change) {
        c.font = "bold 14px system-ui";
        const w = Math.max(30, c.measureText(t.label).width + 14);
        c.fillStyle = judged ? colors[t.grade] : v("--accent");
        roundRect(c, x - w / 2, y - 14, w, 28, 7);
        c.fill();
        c.fillStyle = "#fff";
        c.fillText(t.label, x, y + 1);
      } else {
        c.fillStyle = judged ? colors[t.grade] : v("--ink");
        c.beginPath(); c.arc(x, y, 12, 0, Math.PI * 2); c.fill();
        c.fillStyle = v("--paper");
        c.font = "bold 13px system-ui";
        c.fillText(t.label, x, y + 1);
      }
      c.globalAlpha = 1;
    }
  }

  drawJudge() {
    const el = this.ui.judge;
    if (!el) return;
    const f = this.flash;
    const age = f ? performance.now() - f.t : 1e9;
    if (!f || age > 700) { if (el.dataset.shown) { el.textContent = ""; el.dataset.shown = ""; } return; }
    const key = `${f.t}`;
    if (el.dataset.shown !== key) {
      el.dataset.shown = key;
      el.className = `g-judge ${f.grade}`;
      void el.offsetWidth;
      el.classList.add("pop");
      el.innerHTML = `<b>${f.text}</b>${f.sub ? `<small>${f.sub}</small>` : ""}${f.combo > 1 ? `<i>${f.combo} COMBO</i>` : ""}`;
    }
    el.style.opacity = String(Math.max(0, 1 - age / 700));
    // combo milestone banner
    const big = this.ui.combo;
    const m = this.milestone;
    if (big) {
      const mAge = m ? performance.now() - m.t : 1e9;
      if (mAge < 1100) {
        if (big.dataset.n !== String(m.n) + m.t) {
          big.dataset.n = String(m.n) + m.t;
          big.textContent = `콤보 ${m.n}!`;
          big.classList.remove("show");
          void big.offsetWidth; // restart the animation
          big.classList.add("show");
        }
      } else if (big.classList.contains("show")) big.classList.remove("show");
    }
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// Input latency calibration: play clicks, find the microphone onsets, take the median delay.
export async function calibrate(engine, practice, { clicks = 10, bpm = 90, onTick } = {}) {
  if (!practice.mic) throw new Error("마이크가 켜져 있지 않음");
  const ctx = engine.ctx;
  const an = practice.mic.an;
  an.takeOnsets();
  const t0 = ctx.currentTime + 0.6;
  const beat = 60 / bpm;
  const times = [];
  for (let i = 0; i < clicks; i++) { engine.click(t0 + i * beat, i % 4 === 0); times.push(t0 + i * beat); }
  const deltas = [];
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      for (const o of an.takeOnsets()) {
        const near = times.reduce((a, b) => (Math.abs(b - o.t) < Math.abs(a - o.t) ? b : a));
        const d = (o.t - near) * 1000;
        if (Math.abs(d) < 300 && times.indexOf(near) >= 2) { deltas.push(d); if (onTick) onTick(d); }
      }
      if (ctx.currentTime > t0 + clicks * beat + 0.5) { clearInterval(iv); resolve(); }
    }, 30);
  });
  if (deltas.length < 4) throw new Error(`박에 맞춘 소리를 ${deltas.length}번만 들음. 클릭마다 한 번씩 쳐야 함`);
  deltas.sort((a, b) => a - b);
  return Math.round(deltas[deltas.length >> 1]);
}
