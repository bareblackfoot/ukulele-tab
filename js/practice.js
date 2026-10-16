// Practice mode (rhythm game), modelled on SPRED's practice mode: the microphone hears your instrument,
// each target (a strum on a chord, or a melody note) is judged Perfect / Ok / Bad / Miss on timing and
// on the chord (or pitch) that sounded. A lane shows targets moving toward the hit line.
// On the otamatone site the notes are judged from the pitch heard all along (pitchgame.js), not from attacks.

import { chordIndexAt, computeBars, barAt, strumAt, pitchName } from "./model.js";
import { chordShape } from "./chords.js";
import { INST, tuningOf, instOf, skey } from "./instrument.js";
import { MicAnalyzer, chroma, templateChroma, cosine, yin, rms } from "./dsp.js";
import { PitchJudge } from "./pitchgame.js";
import { trackKind } from "./pitchcolor.js";

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
    this.deviceId = store.get(skey("practice.device"), ""); // "" = the device's default input
    this.mic = null;
    this.targets = [];
    this.micOff = false; // switched off in the game panel: not opened again until switched on
    this.strokes = [];
    this.pending = [];
    this.flash = null;
    // otamatone: melody only, judged on start timing and/or holding the pitch
    this.judgeKind = store.get(skey("practice.judge"), "both");
    this.pj = INST.roll ? new PitchJudge(this, TIMING) : null;
    if (INST.roll) this.target = "melody";
    this.reset();
  }

  // the microphone hears pitch all along (otamatone) instead of attacks
  get pitchMode() { return !!this.pj && this.input === "mic" && !!this.mic; }

  reset() {
    this.bursts = [];
    this.milestone = null;
    this.stats = { perfect: 0, ok: 0, bad: 0, miss: 0, early: 0, late: 0, combo: 0, maxCombo: 0, score: 0, accSum: 0, timeAccSum: 0, timeN: 0, n: 0, holdSum: 0, holdN: 0,
      dSum: 0, dN: 0, centSum: 0, centN: 0 }; // signed: how late the starts came (ms), how high the notes were (cent)
    this.flash = null;
    if (this.pj) this.pj.reset();
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
      s.tracks.forEach((t, ti) => {
        if (t.hidden || t.muted) return;
        const tk = trackKind(t, ti); // which of SPRED's tracks: the colour of its notes
        for (const n of t.notes) {
          const bend = n.tech && n.tech[0] === "b" ? +n.tech.slice(1) || 1 : 0;
          const midi = tuning[n.string] + (s.capo || 0) + n.fret;
          out.push({ col: n.col, len: n.len, kind: "note", midi, bend, tk, label: INST.roll ? pitchName(midi) : `${names[n.string]}${n.fret}${bend ? "b" : ""}` });
        }
      });
    }
    // the strokes of the strum pattern (as playback strums them, chucks too) are what the lane shows; the
    // targets are all of them («스트럼 패턴»), the first one in each beat («박마다») or the first one of each
    // chord («바뀔 때만»), so a target is always a stroke the pattern has
    const strokes = [];
    if (this.target !== "melody" && s.chords.length) {
      const step = spb % 2 === 0 ? spb / 2 : spb;
      let lastKey = null;
      for (let col = s.chords[0].col; col < s.columnCount; col++) {
        const ci = chordIndexAt(s, col);
        if (ci < 0) continue;
        const ch = s.chords[ci];
        if (ch.name === "N.C." || !chordShape(ch.name, s.tuning, s.chordShapes)) continue;
        const bar = barAt(bars, col);
        const inBar = col - bar.start;
        if (inBar % step) continue;
        const pat = step === spb ? "D" : strumAt(s, col) || "D-D-D-D-";
        const dir = pat[(inBar / step) % pat.length];
        if (dir !== "D" && dir !== "U" && dir !== "X") continue;
        const st = { col, dir, target: null };
        strokes.push(st);
        if (dir === "X") continue;   // a chuck has no chord to hear
        const key = this.target === "pattern" ? col : this.target === "beat" ? `${bar.index}.${Math.floor(inBar / spb)}` : `c${ci}`;
        if (key === lastKey) continue;
        lastKey = key;
        st.target = { col, kind: "chord", chord: ch.name, change: ch.col === col, dir, label: dir === "U" ? "↑" : "↓" };
        out.push(st.target);
      }
    }
    this.strokes = strokes;
    out.sort((a, b) => a.col - b.col);
    for (const t of out) { t.t = tm.colToTime(t.col); t.tEnd = tm.colToTime(t.col + (t.len || 0)); t.grade = null; }
    this.targets = out;
    // chord templates for every chord in the song, to tell the right chord from the others
    this.templates = new Map();
    if (instOf(s.tuning).roll) return;
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
    for (const t of this.targets) {
      if (t.col < col) continue;
      t.grade = null;
      for (const k of ["head", "headD", "run", "runStart", "holdN", "holdOk", "segs", "hold", "cs"]) delete t[k];
    }
    this.pending = [];
    if (this.pj) this.pj.rewind();
    this.stats.score = this.points();
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
    if (this.input === "mic" && !this.mic && !this.micOff) {
      const ctx = this.engine.ctx;
      try {
        this.engine.setRecording(true);
        // raw sound: no echo cancelling, noise removal or level control (a guitar through an audio interface stays as it is)
        const raw = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: this.deviceId ? { ...raw, deviceId: { exact: this.deviceId } } : raw });
        } catch (err) {
          // the chosen device was unplugged: use the default input
          if (!this.deviceId || (err.name !== "OverconstrainedError" && err.name !== "NotFoundError")) throw err;
          stream = await navigator.mediaDevices.getUserMedia({ audio: raw });
        }
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

  // game mode off: the microphone is let go (the browser's mic sign goes away, an iPad plays at full quality again)
  stop() {
    this.on = false;
    this.pending = [];
    this.micOff = false;
    this.closeMic();
  }

  // the microphone switch of the game panel
  async setMic(on) {
    this.micOff = !on;
    if (on) await this.ensureMic(); else this.closeMic();
  }

  // sound inputs of this device: [{id, label}] (names show after the microphone was allowed once)
  async inputDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications")
        .map((d, i) => ({ id: d.deviceId, label: d.label || `입력 장치 ${i + 1}` }));
    } catch (_) {
      return [];
    }
  }

  // use another input; an open microphone is opened again on it
  async setDevice(id) {
    this.deviceId = id || "";
    store.set(skey("practice.device"), this.deviceId);
    if (this.mic) {
      this.closeMic();
      await this.ensureMic();
    }
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
    // a key is pressed with what is heard, and playback is heard the output latency after its audio-clock time
    const ctx = this.engine.ctx;
    this.handleOnset(ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0), null);
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
    // a bent note is heard right after the pick (fretted pitch) or once pushed up (bent pitch): the closer one counts
    const centsTo = (m) => 1200 * Math.log2(f0 / (440 * 2 ** ((m - 69) / 12)));
    const c0 = centsTo(target.midi), c1 = target.bend ? centsTo(target.midi + target.bend) : Infinity;
    const cents = Math.abs(c1) < Math.abs(c0) ? c1 : c0;
    const w = PITCH[this.mode];
    const a = Math.abs(cents);
    return { grade: a < w[0] ? "perfect" : a < w[1] ? "ok" : a < w[2] ? "bad" : "miss", heard: `${Math.round(f0)} Hz`, hz: f0 };
  }

  finish(target, d, sound) {
    const dMs = d * 1000;
    const tg = this.timingGrade(dMs);
    let grade = sound ? worse(sound.grade, tg === "ok" ? "perfect" : tg) : tg;
    if (this.mode === "easy" && sound) grade = sound.grade; // easy: chord/pitch only, like SPRED's easy mode
    this.count(target, grade, dMs, tg, { heard: sound && sound.heard });
  }

  // one judged target: counts, combo, the judgement shown and the mark on the sheet. tg: grade of its timing
  // (null when only holding was judged); opts.flash false when its start was shown already; opts.hold: share
  // of the note held on pitch (0..1); opts.cents: how high it was played on average (otamatone)
  count(target, grade, dMs, tg, { flash = true, hold = null, heard = null, cents = null } = {}) {
    target.grade = grade;
    const st = this.stats;
    st[grade]++;
    st.n++;
    st.accSum += ACC[grade];
    if (tg) {
      if (grade !== "miss") {
        st.timeAccSum += ACC[tg];
        st.timeN++;
        if (tg !== "perfect" && dMs !== null) dMs < 0 ? st.early++ : st.late++;
      } else { st.timeN++; }
    }
    if (hold !== null) { st.holdSum += hold; st.holdN++; }
    if (tg && grade !== "miss" && dMs !== null) { st.dSum += dMs; st.dN++; }
    if (cents !== null) { st.centSum += cents; st.centN++; }
    const breaks = this.mode === "pro" ? grade === "bad" || grade === "miss" : grade === "miss";
    st.combo = breaks ? 0 : st.combo + 1;
    st.maxCombo = Math.max(st.maxCombo, st.combo);
    st.score = this.points();
    if (flash) {
      this.flash = { grade, text: LABEL[grade], sub: tg && tg !== "perfect" && grade !== "miss" && dMs !== null ? (dMs < 0 ? "EARLY" : "LATE") : "", t: performance.now(), combo: st.combo, midi: target.midi, dMs };
      this.bursts.push({ t: performance.now(), grade, midi: target.midi });
    }
    if (st.combo && (st.combo === 10 || st.combo === 20 || st.combo === 30 || st.combo % 50 === 0)) this.milestone = { n: st.combo, t: performance.now() };
    if (heard) this.ui.heard(heard);
    this.ui.onMark(target.col, grade);
    this.updateCounts();
  }

  // the start of a note shown before the whole note is judged (otamatone: start and holding judged together)
  flashOnly(target, grade, d) {
    const sub = grade !== "perfect" && grade !== "miss" && d !== null ? (d < 0 ? "EARLY" : "LATE") : "";
    this.flash = { grade, text: LABEL[grade], sub, t: performance.now(), combo: grade === "miss" ? 0 : this.stats.combo + 1, midi: target.midi, dMs: d === null ? null : d * 1000 };
    this.bursts.push({ t: performance.now(), grade, midi: target.midi });
  }

  // the note the microphone hears now, with how far off it is (cents), a few times a second
  showHeard() {
    const L = this.pj && this.pj.live;
    if (!L || performance.now() - this.pj.shownAt < 120) return;
    this.pj.shownAt = performance.now();
    if (L.m === null) { this.ui.heard("--"); return; }
    const r = Math.round(L.m), c = Math.round((L.m - r) * 100);
    this.ui.heard(`${pitchName(r)} ${c >= 0 ? "+" : ""}${c}`);
  }

  // while practice mode is on but nothing plays: keep the mic meter and the lane alive
  idle() {
    if (!this.on || this.player.playing) return;
    if (this.mic) {
      this.mic.an.takeOnsets();
      this.ui.level(this.mic.an.level);
      if (this.pitchMode) { this.pj.update(this.mic.an); this.showHeard(); }
    }
    this.drawLane();
    requestAnimationFrame(() => this.idle());
  }

  // called every animation frame while playing
  frame() {
    if (!this.on) return;
    const p = this.player;
    const ctx = this.engine.ctx;
    if (this.pitchMode) {
      const an = this.mic.an;
      an.takeOnsets();
      this.ui.level(an.level);
      this.pj.update(an);
      this.showHeard();
      if (p.playing) this.pj.tick(p.scoreTime());
    } else if (this.mic) {
      const an = this.mic.an;
      for (const o of an.takeOnsets()) this.handleOnset(o.t - this.offsetMs / 1000, an);
      this.ui.level(an.level);
      this.pending = this.pending.filter((q) => {
        if (an.lastT < q.at + 0.03 + 4096 / an.sr) return true;
        this.finish(q.target, q.d, this.soundGrade(q.target, an, q.at));
        return false;
      });
    }
    if (p.playing && !this.pitchMode && (this.input === "keys" || this.mic)) { // nothing is missed while the mic is off
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
    const hold = st.holdN ? Math.round((st.holdSum / st.holdN) * 1000) / 10 : 0;
    this.ui.counts({ ...st, acc, tacc, hold, ...this.tendency() });
  }

  // where the playing tends to land: start time (ms, + late) and pitch (cent, + high), averaged over the notes
  tendency() {
    const st = this.stats;
    return { davg: st.dN ? Math.round(st.dSum / st.dN) : null, dN: st.dN, cavg: st.centN ? Math.round(st.centSum / st.centN) : null };
  }

  // the score so far out of 100 (records.js pointsOf): every note of the song weighs the same, so it climbs
  // from 0 to the final score as the song goes; two players at the same place in the song compare directly.
  // It is taken from each note's grade as it stands: a note played again after going back (a seek, a loop)
  // counts once, with its newest grade. (Summed judgement by judgement, going back and playing on reached
  // 100 halfway through the song.)
  points() {
    let sum = 0;
    for (const t of this.targets) if (t.grade && t.grade !== "pending") sum += ACC[t.grade];
    return Math.min(100, Math.round((10000 * sum) / Math.max(1, this.targets.length)) / 100);
  }

  result() {
    const st = this.stats;
    const total = this.targets.length;
    return {
      ...st,
      score: this.points(),
      total,
      acc: st.n ? Math.round((st.accSum / st.n) * 1000) / 10 : 0,
      tacc: st.timeN ? Math.round((st.timeAccSum / st.timeN) * 1000) / 10 : 0,
      fullCombo: st.n > 0 && st.miss === 0 && (this.mode !== "pro" || st.bad === 0),
      mode: this.mode,
      target: this.target,
      ...this.tendency(),
      ...(this.pitchMode ? { judge: this.judgeKind, hold: st.holdN ? Math.round((st.holdSum / st.holdN) * 1000) / 10 : null } : {}),
    };
  }

  // ---------------------------------------------------------------- drawing
  drawLane() {
    const lane = this.ui.lane;
    if (!lane || !this.score) return;
    // the lane shows what is heard now: playback reaches the ears the output latency after its audio-clock time
    const p = this.player;
    let col = p.position();
    if (p.playing) {
      const ctx = this.engine.ctx;
      const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
      col = p.tm.timeToCol(Math.max(0, p.scoreTime() - lat * p.rate));
    }
    lane.draw(this, col);
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

// Input latency calibration: play clicks, find the microphone onsets, take the median delay.
// (The game panel's own loop takes the onsets every frame while it waits, so these are read from a tap of their
// own; reading takeOnsets() here found none and the measurement always failed.)
export async function calibrate(engine, practice, { clicks = 10, bpm = 90, onTick } = {}) {
  if (!practice.mic) throw new Error("마이크가 켜져 있지 않음");
  const ctx = engine.ctx;
  const an = practice.mic.an;
  an.tap = [];
  const t0 = ctx.currentTime + 0.6;
  const beat = 60 / bpm;
  const times = [];
  for (let i = 0; i < clicks; i++) { engine.click(t0 + i * beat, i % 4 === 0); times.push(t0 + i * beat); }
  const deltas = [];
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      for (const o of an.tap.splice(0)) {
        const near = times.reduce((a, b) => (Math.abs(b - o.t) < Math.abs(a - o.t) ? b : a));
        const d = (o.t - near) * 1000;
        if (Math.abs(d) < 300 && times.indexOf(near) >= 2) { deltas.push(d); if (onTick) onTick(d); }
      }
      if (ctx.currentTime > t0 + clicks * beat + 0.5) { clearInterval(iv); an.tap = null; resolve(); }
    }, 30);
  });
  if (deltas.length < 4) throw new Error(`박에 맞춘 소리를 ${deltas.length}번만 들음. 클릭마다 한 번씩 쳐야 함`);
  deltas.sort((a, b) => a - b);
  return Math.round(deltas[deltas.length >> 1]);
}

// Otamatone: the app plays short notes from the speaker and reads them back with the game's own pitch reading,
// so the delay measured is the whole way from a note sounding to the game hearing it (speaker, room, microphone,
// browser and the reading itself): what a player playing along with what they hear comes in late by. Nothing to
// play; it needs the speaker, not earphones.
export async function calibratePitch(engine, practice, { onTick } = {}) {
  if (!practice.mic || !practice.pj) throw new Error("마이크가 켜져 있지 않음");
  const ctx = engine.ctx, an = practice.mic.an, pj = practice.pj;
  // notes a few semitones apart and gaps of different lengths, so no note is taken for the one before or after
  const notes = [69, 76, 72, 79, 74, 81, 71, 78, 73, 80, 75, 70];
  const gaps = [0.42, 0.5, 0.38, 0.55, 0.45, 0.4, 0.52, 0.36, 0.48, 0.44, 0.5];
  const times = [];
  let t = ctx.currentTime + 0.5;
  notes.forEach((m, i) => { engine.ota(m, t, 0.2, 0.35, engine.melodyBus); times.push(t); t += gaps[i] || 0.45; });
  pj.log = [];
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      pj.update(an);
      if (ctx.currentTime > t + 0.6) { clearInterval(iv); resolve(); }
    }, 20);
  });
  const log = pj.log;
  pj.log = null;
  const deltas = [];
  times.forEach((T, i) => {
    const f = log.find((e) => e.t >= T - 0.08 && e.t <= T + 0.45 && e.m !== null && Math.abs(e.m - notes[i]) <= 0.6);
    if (!f) return;
    deltas.push((f.t - T) * 1000);
    if (onTick) onTick(deltas[deltas.length - 1]);
  });
  if (deltas.length < 6) throw new Error(`스피커로 낸 음 ${notes.length}개 중 ${deltas.length}개만 마이크로 들림. 이어폰 말고 스피커로, 소리를 키우고 다시 하세요`);
  deltas.sort((a, b) => a - b);
  return Math.round(deltas[deltas.length >> 1]);
}
