// Sound: plucked-string synthesis (Karplus-Strong), chord strums, metronome, and a look-ahead scheduler.

import { TimeMap, computeBars, barAt, chordIndexAt, strumAt } from "./model.js";
import { chordShape } from "./chords.js";
import { INST, tuningOf, instOf } from "./instrument.js";

const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function setSession(type) {
  try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch (_) { /* older Safari */ }
}

// older iOS without navigator.audioSession: a playing <audio> element switches the page to media playback,
// which also lets Web Audio sound in silent mode. Started once, inside the first tap.
function silentLoop() {
  const n = 4000, b = new Uint8Array(44 + n);
  const v = new DataView(b.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  str(0, "RIFF"); v.setUint32(4, 36 + n, true); str(8, "WAVEfmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, "data"); v.setUint32(40, n, true);
  b.fill(128, 44);
  const el = document.createElement("audio");
  el.src = "data:audio/wav;base64," + btoa(String.fromCharCode(...b));
  el.loop = true;
  el.setAttribute("playsinline", "");
  el.play().catch(() => {});
}

// metronome click tones (the strum practice microphone check leaves these bands out)
export const CLICK_HZ = [1175, 1760];

export class Engine {
  constructor() {
    this.ctx = null;
    this.cache = new Map();
  }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      this.melodyBus = this.ctx.createGain();
      this.chordBus = this.ctx.createGain();
      this.clickBus = this.ctx.createGain();
      this.melodyBus.connect(this.master);
      this.chordBus.connect(this.master);
      this.clickBus.connect(this.master);
    }
    // iOS also leaves it "interrupted" after another app or a call took the sound
    if (this.ctx.state === "suspended" || this.ctx.state === "interrupted") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  // Called on every tap. iPad/iPhone: sound may only start inside a tap, and Web Audio stays silent while the
  // device is in silent mode unless the page says it plays media (as video sites do).
  unlock() {
    setSession(this.recording ? "play-and-record" : "playback");
    const ctx = this.ensure();
    if (!this.unlocked) {
      this.unlocked = true;
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      s.connect(ctx.destination);
      s.start(0);
      if (IOS && !("audioSession" in navigator)) silentLoop();
    }
  }

  // the microphone (game mode) needs the record-and-play session; back to plain playback when it closes
  setRecording(on) {
    this.recording = on;
    setSession(on ? "play-and-record" : "playback");
  }
  setVolume(v) { this.ensure(); this.master.gain.value = v; }
  setBus(name, v) { this.ensure(); this[name].gain.value = v; }

  pluck(midi) {
    if (this.cache.has(midi)) return this.cache.get(midi);
    const ctx = this.ctx, sr = ctx.sampleRate;
    const f = 440 * 2 ** ((midi - 69) / 12);
    const N = Math.max(2, Math.round(sr / f));
    const len = Math.floor(sr * 2.4);
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const ring = new Float32Array(N);
    // soft noise burst: smoothed so the attack is warm like a nylon string; a steel string keeps more of it
    const smooth = INST.nylon ? 0.6 : 0.3;
    let prev = 0;
    for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; prev = smooth * prev + (1 - smooth) * r; ring[i] = prev; }
    const decay = Math.min(INST.nylon ? 0.9985 : 0.999, (INST.nylon ? 0.9965 : 0.9972) + (60 - Math.min(midi, 90)) * 0.00004);
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const a = ring[idx], b = ring[(idx + 1) % N];
      out[i] = a;
      ring[idx] = 0.5 * (a + b) * decay;
      idx = (idx + 1) % N;
    }
    let peak = 0;
    for (let i = 0; i < Math.min(len, N * 8); i++) peak = Math.max(peak, Math.abs(out[i]));
    const k = peak > 0 ? 0.6 / peak : 1;
    for (let i = 0; i < len; i++) out[i] *= k;
    this.cache.set(midi, buf);
    return buf;
  }

  // returns a handle with stop(time)
  note(midi, when, dur, gain, bus) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.pluck(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.004);
    src.connect(g).connect(bus);
    src.start(when);
    const end = when + Math.min(dur, 2.3);
    g.gain.setTargetAtTime(0, end, 0.04);
    src.stop(end + 0.3);
    return {
      stop(t) {
        try { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.02); src.stop(t + 0.15); } catch (_) { /* already stopped */ }
      },
      end,
    };
  }

  // strum a chord given as MIDI pitches in string order (null = string not played); down starts at string 0
  strumMidis(midis, when = null, dir = "D", vel = 0.3) {
    this.ensure();
    const t0 = when ?? this.ctx.currentTime + 0.03;
    const order = midis.map((_, i) => i);
    if (dir !== "D") order.reverse();
    const gap = INST.strumGap * 1.25;
    order.forEach((s, k) => { if (midis[s] !== null && midis[s] !== undefined) this.note(midis[s], t0 + k * gap, 1.6, vel, this.chordBus); });
  }

  click(when, accent) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = accent ? CLICK_HZ[1] : CLICK_HZ[0];
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
    o.connect(g).connect(this.clickBus);
    o.start(when);
    o.stop(when + 0.08);
  }
}

// Schedules events of the score against the audio clock.
// options: rate (speed multiplier), chordMode ("off" | "change" | "pattern"), metronome (bool), loop {start, end} | null
export class Player {
  constructor(engine) {
    this.engine = engine;
    this.playing = false;
    this.rate = 1;
    this.opts = { chordMode: "pattern", metronome: false, melody: true, loop: null };
    this.listeners = new Set();
  }

  setScore(score) {
    this.score = score;
    this.tm = new TimeMap(score);
    this.bars = computeBars(score);
    this.buildIndex();
    if (this.playing) this.restart(this.position());
  }

  buildIndex() {
    const s = this.score;
    this.noteAt = new Map();
    s.tracks.forEach((t) => {
      if (t.muted || t.hidden) return;
      for (const n of t.notes) {
        if (!this.noteAt.has(n.col)) this.noteAt.set(n.col, []);
        this.noteAt.get(n.col).push(n);
      }
    });
  }

  setOptions(o) {
    Object.assign(this.opts, o);
    if (this.playing) this.restart(this.position());
  }

  setRate(r) {
    if (this.playing) {
      const pos = this.position();
      this.rate = r;
      this.restart(pos);
    } else this.rate = r;
  }

  position() {
    if (!this.playing) return this.pausedCol ?? 0;
    const ctx = this.engine.ctx;
    const t = this.startScoreT + Math.max(0, ctx.currentTime - this.startCtx) * this.rate;
    return this.tm.timeToCol(t);
  }

  scoreTime() {
    return this.tm.colToTime(this.position());
  }

  // startAt: audio-clock time at which the first column sounds (default: right away)
  play(fromCol, startAt) {
    this.engine.ensure();
    this.playing = true;
    this.restart(fromCol ?? this.pausedCol ?? 0, startAt);
    this.emit("play");
  }

  restart(col, startAt) {
    const ctx = this.engine.ctx;
    this.silence();
    this.startCtx = startAt ?? ctx.currentTime + 0.06;
    this.startScoreT = this.tm.colToTime(col);
    this.nextCol = Math.ceil(col - 1e-6);
    this.melodyVoices = [];
    this.chordVoices = [];
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
    this.emit("seek");
  }

  pause() {
    if (!this.playing) return;
    this.pausedCol = this.position();
    this.playing = false;
    clearInterval(this.timer);
    this.silence();
    this.emit("pause");
  }

  stop() {
    this.pause();
    this.pausedCol = this.opts.loop ? this.opts.loop.start : 0;
    this.emit("seek");
  }

  seek(col) {
    if (this.playing) this.restart(col);
    else { this.pausedCol = col; this.emit("seek"); }
  }

  silence() {
    const t = this.engine.ctx ? this.engine.ctx.currentTime : 0;
    for (const v of [...(this.melodyVoices || []), ...(this.chordVoices || [])]) if (v) v.stop(t);
    this.melodyVoices = [];
    this.chordVoices = [];
  }

  colTime(col) {
    // audio-clock time at which column col sounds
    return this.startCtx + (this.tm.colToTime(col) - this.startScoreT) / this.rate;
  }

  tick() {
    if (!this.playing) return;
    const ctx = this.engine.ctx;
    const horizon = ctx.currentTime + 0.18;
    const s = this.score;
    const spb = s.stepsPerBeat;
    const tuning = tuningOf(s.tuning).strings;
    let guard = 0;
    while (this.colTime(this.nextCol) < horizon && guard++ < 400) {
      const col = this.nextCol;
      const loop = this.opts.loop;
      if (loop && col >= loop.end) {
        // jump back: continue the audio clock from the loop start
        const when = this.colTime(col);
        this.startScoreT = this.tm.colToTime(loop.start);
        this.startCtx = when;
        this.nextCol = loop.start;
        this.emit("loop");
        continue;
      }
      if (col >= s.columnCount) {
        const endAt = this.colTime(col);
        setTimeout(() => { if (this.playing && this.position() >= s.columnCount - 0.01) { this.stop(); this.emit("end"); } }, Math.max(0, (endAt - ctx.currentTime) * 1000 + 50));
        this.nextCol = Infinity;
        break;
      }
      const when = this.colTime(col);
      const bar = barAt(this.bars, col);
      const inBar = col - bar.start;
      // metronome
      if (this.opts.metronome && inBar % spb === 0) this.engine.click(when, inBar === 0);
      // melody
      if (this.opts.melody) {
        for (const n of this.noteAt.get(col) || []) {
          const dur = (this.tm.colToTime(n.col + n.len) - this.tm.colToTime(n.col)) / this.rate;
          const old = this.melodyVoices[n.string];
          if (old && old.end > when) old.stop(when);
          this.melodyVoices[n.string] = this.engine.note(tuning[n.string] + (s.capo || 0) + n.fret, when, dur + 0.05, 0.55, this.engine.melodyBus);
        }
      }
      // chords
      const mode = this.opts.chordMode;
      if (mode !== "off" && s.chords.length) {
        const ci = chordIndexAt(s, col);
        if (ci >= 0) {
          const ch = s.chords[ci];
          let dir = null, vel = 0.2;
          if (mode === "change") {
            if (ch.col === col) dir = "D";
          } else if (spb % 2 === 0 && inBar % (spb / 2) === 0) {
            const pat = strumAt(s, col) || "D-D-D-D-";
            const slot = inBar / (spb / 2);
            const c = pat[slot % pat.length];
            if (c === "D" || c === "U") dir = c;
            vel = inBar % spb === 0 ? 0.24 : 0.17;
          }
          if (dir && ch.name !== "N.C.") this.strum(ch.name, dir, when, vel, tuning);
        }
      }
      this.nextCol = col + 1;
    }
  }

  strum(name, dir, when, vel, tuning) {
    const sh = chordShape(name, this.score.tuning, this.score.chordShapes);
    if (!sh) return;
    const order = sh.frets.map((_, i) => i);
    if (dir !== "D") order.reverse();
    const gap = instOf(this.score.tuning).strumGap;
    const beat = 60 / this.tm.bpmAt(this.position()) / this.rate;
    order.forEach((s, k) => {
      if (sh.frets[s] < 0) return;
      const t = when + k * gap;
      const old = this.chordVoices[s];
      if (old && old.end > t) old.stop(t);
      this.chordVoices[s] = this.engine.note(tuning[s] + (this.score.capo || 0) + sh.frets[s], t, beat * 1.8, vel * (dir === "U" ? 0.8 : 1), this.engine.chordBus);
    });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type) { for (const fn of this.listeners) fn(type); }
}
