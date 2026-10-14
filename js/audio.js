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

// Instrument sound: "acoustic" (this site's instrument as it is), or an electric guitar through an amp:
// "clean", or "drive" (overdrive: the signal is pushed into a soft clipping curve, then a speaker-like filter).
//   amp: gain into the clipping, curve steepness (0 = none), high-pass and low-pass of the speaker, output gain
//   (output gains set so a strummed chord has about the same loudness in all three, tests: offline render)
const AMP = {
  acoustic: { pre: 1, k: 0, hp: 20, lp: 20000, post: 1 },
  clean: { pre: 1, k: 0, hp: 70, lp: 5200, post: 1.3 },
  drive: { pre: 7, k: 2.6, hp: 110, lp: 3600, post: 0.09 },
};
export const TONE_NAMES = { clean: "깨끗한 소리", drive: "overdrive" };

function clipCurve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}

export class Engine {
  constructor() {
    this.ctx = null;
    this.cache = new Map();
    this.tone = "acoustic";
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
      // chords and melody go through the amp stage; the metronome does not
      const c = this.ctx;
      this.amp = { pre: c.createGain(), shaper: c.createWaveShaper(), hp: c.createBiquadFilter(), lp: c.createBiquadFilter(), post: c.createGain() };
      this.amp.shaper.oversample = "4x";
      this.amp.hp.type = "highpass";
      this.amp.lp.type = "lowpass";
      this.amp.pre.connect(this.amp.shaper).connect(this.amp.hp).connect(this.amp.lp).connect(this.amp.post).connect(this.master);
      this.melodyBus.connect(this.amp.pre);
      this.chordBus.connect(this.amp.pre);
      this.clickBus.connect(this.master);
      this.applyTone();
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

  setTone(tone) {
    this.tone = AMP[tone] ? tone : "acoustic";
    if (this.ctx) this.applyTone();
  }
  applyTone() {
    const a = AMP[this.tone], t = this.ctx.currentTime;
    this.amp.pre.gain.setValueAtTime(a.pre, t);
    this.amp.shaper.curve = a.k ? clipCurve(a.k) : null;
    this.amp.hp.frequency.setValueAtTime(a.hp, t);
    this.amp.lp.frequency.setValueAtTime(a.lp, t);
    this.amp.post.gain.setValueAtTime(a.post, t);
  }
  setBus(name, v) { this.ensure(); this[name].gain.value = v; }

  pluck(midi) {
    const electric = this.tone !== "acoustic";
    const key = `${electric ? "e" : "a"}${midi}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const ctx = this.ctx, sr = ctx.sampleRate;
    const f = 440 * 2 ** ((midi - 69) / 12);
    const N = Math.max(2, Math.round(sr / f));
    const len = Math.floor(sr * (electric ? 3.2 : 2.4));
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const ring = new Float32Array(N);
    // soft noise burst: smoothed so the attack is warm like a nylon string; a steel string keeps more of it
    // an electric string is plucked with a pick near the bridge pickup: bright, and it rings longer
    const smooth = electric ? 0.12 : INST.nylon ? 0.6 : 0.3;
    let prev = 0;
    for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; prev = smooth * prev + (1 - smooth) * r; ring[i] = prev; }
    if (electric) {
      const d = Math.max(1, Math.round(N * 0.18)), src = ring.slice();
      for (let i = 0; i < N; i++) ring[i] = src[i] - 0.7 * src[(i + d) % N];
    }
    const decay = electric ? Math.min(0.9995, 0.9984 + (60 - Math.min(midi, 90)) * 0.00002)
      : Math.min(INST.nylon ? 0.9985 : 0.999, (INST.nylon ? 0.9965 : 0.9972) + (60 - Math.min(midi, 90)) * 0.00004);
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
    this.cache.set(key, buf);
    return buf;
  }

  // returns a handle with stop(time); tech: playing mark of a melody note (bend, vibrato, hammer-on ...)
  note(midi, when, dur, gain, bus, tech = "") {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.pluck(midi);
    if (tech[0] === "b") {
      // the string is pushed up after the attack and held there
      src.detune.setValueAtTime(0, when + 0.04);
      src.detune.linearRampToValueAtTime(100 * (+tech.slice(1) || 1), when + Math.min(0.2, 0.04 + dur * 0.4));
    } else if (tech === "v") {
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.setValueAtTime(0, when);
      depth.gain.linearRampToValueAtTime(30, when + Math.min(0.3, dur * 0.5));
      lfo.connect(depth).connect(src.detune);
      lfo.start(when);
      lfo.stop(when + Math.min(dur, 2.3) + 0.3);
    }
    if (tech === "h" || tech === "p" || tech === "s") gain *= 0.7; // no pick attack: the left hand sounds the note
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

  // the otamatone: a buzzy tone from a small speaker; opening the squeezed mouth lets the high partials out
  // (the "wa" at the start), a little vibrato once the note is held. from: MIDI pitch of the note just before
  // when the two are joined (the finger slides on the stem), so the pitch glides and the mouth stays open.
  ota(midi, when, dur, gain, bus, from = null) {
    const ctx = this.ctx;
    const hz = (m) => 440 * 2 ** ((m - 69) / 12);
    const f = hz(midi);
    const osc = ctx.createOscillator();
    if (!this.otaWave) {
      // odd partials strong like a square wave, even ones weaker
      const n = 28, re = new Float32Array(n), im = new Float32Array(n);
      for (let k = 1; k < n; k++) im[k] = (k % 2 ? 1 : 0.35) / k;
      this.otaWave = ctx.createPeriodicWave(re, im);
    }
    osc.setPeriodicWave(this.otaWave);
    if (from !== null) {
      osc.frequency.setValueAtTime(hz(from), when);
      osc.frequency.exponentialRampToValueAtTime(f, when + 0.05);
    } else osc.frequency.setValueAtTime(f, when);
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 5.2;
    depth.gain.setValueAtTime(0, when);
    depth.gain.linearRampToValueAtTime(18, when + Math.min(0.35, dur * 0.6));
    lfo.connect(depth).connect(osc.detune);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 5;
    const open = Math.min(5200, f * 6 + 900), shut = Math.min(open, f * 1.6);
    const end = when + Math.max(0.06, dur);
    lp.frequency.setValueAtTime(from !== null ? open : shut, when);
    lp.frequency.exponentialRampToValueAtTime(open, when + 0.09);
    lp.frequency.setTargetAtTime(shut, Math.max(when + 0.09, end - 0.05), 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + (from !== null ? 0.005 : 0.02));
    g.gain.setTargetAtTime(0, end, 0.03);
    osc.connect(lp).connect(g).connect(bus);
    osc.start(when);
    lfo.start(when);
    osc.stop(end + 0.3);
    lfo.stop(end + 0.3);
    return {
      stop(t) {
        try { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.015); osc.stop(t + 0.15); lfo.stop(t + 0.15); } catch (_) { /* already stopped */ }
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
    s.tracks.forEach((t, ti) => {
      if (t.muted || t.hidden) return;
      for (const n of t.notes) {
        if (!this.noteAt.has(n.col)) this.noteAt.set(n.col, []);
        this.noteAt.get(n.col).push({ ...n, ti });
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
    this.lastMel = [];
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
          const midi = tuning[n.string] + (s.capo || 0) + n.fret;
          if (INST.roll) {
            // one voice per track; a note that starts where the one before ends is slid into
            const old = this.melodyVoices[n.ti], prev = this.lastMel[n.ti];
            if (old && old.end > when) old.stop(when);
            const from = prev && prev.endCol >= n.col && prev.midi !== midi ? prev.midi : null;
            this.melodyVoices[n.ti] = this.engine.ota(midi, when, dur, 0.3, this.engine.melodyBus, from);
            this.lastMel[n.ti] = { midi, endCol: n.col + n.len };
            continue;
          }
          const old = this.melodyVoices[n.string];
          if (old && old.end > when) old.stop(when);
          this.melodyVoices[n.string] = this.engine.note(midi, when, dur + 0.05, 0.55, this.engine.melodyBus, n.tech || "");
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
          if (dir && ch.name !== "N.C.") this.strum(ch.name, dir, when, vel);
        }
      }
      this.nextCol = col + 1;
    }
  }

  strum(name, dir, when, vel) {
    // a melody-only instrument plays its backing chords on another instrument's shapes
    const tuning = tuningOf(instOf(this.score.tuning).chordTuning || this.score.tuning).strings;
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
