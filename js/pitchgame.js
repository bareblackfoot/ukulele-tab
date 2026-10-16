// Otamatone game mode: judged from the pitch the microphone hears, not from attacks (on the stem a note is
// often slid into from the one before, with no new attack).
//   start: when the note's pitch is first held for two frames (40 ms) near the note's time, judged on timing
//          like the other game modes. Being on that pitch already (the same pitch again, joined to the note
//          before) counts as on time.
//   hold: the share of frames on the note's pitch from just after its start to just before its end.
//   kind (chosen in the game panel): "both" (start and hold count half each), "start", "hold"

import { yin, rms, harmonicShare } from "./dsp.js";

const median = (a) => { const b = [...a].sort((x, y) => x - y), k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; };

export const PITCH_TOL = { easy: 120, std: 80, pro: 50 }; // cents from the note that still count as on it
export const JUDGE_KINDS = { both: "시작 박자 + 음 유지", start: "시작 박자만", hold: "음 유지만" };
const ACC = { perfect: 1, ok: 2 / 3, bad: 1 / 3, miss: 0 };
const FRAME = 2048, HOP = 0.02;
const JUMP = 2;              // semitones a frame may differ from a neighbouring frame (a slide is about this fast)
const PEAK_FALL = 0.92;      // per frame: how fast the level of what was just played is forgotten (about 0.25 s)
const LOW_CUT = 250;         // Hz: what is under it is not used to read pitch (the room's hum and rumble)
const MIN_LEVEL = 0.01;      // a window quieter than this is not read at all (SPRED's own limit)
const HARM_BELOW = 300;      // Hz: a pitch under this must have harmonics (the room's low noise has none)

export class PitchJudge {
  // timing: the timing windows of the game modes (TIMING in practice.js)
  constructor(practice, timing) {
    this.p = practice;
    this.timing = timing;
    this.reset();
  }

  reset() {
    this.nextT = null;   // audio-clock time of the next analysis window
    this.open = 0;       // first target not finished
    this.trail = [];     // {st: score time, m: MIDI (fractional) or null} heard while playing
    this.live = null;    // {m, at} the latest pitch, also while stopped
    this.shownAt = 0;
    this.held = null;    // {mid, m} the newest frame, passed on when the next one shows whether it stands alone
    this.before = null;  // the pitch of the frame passed on last
    this.peak = 0;       // level of what was just played
    this.steady = null;  // {m, since} a pitch heard without changing, and since when
    this.log = null;     // when an array: every frame passed on, {t: audio-clock time, m} (the sync measurement)
  }

  get kind() { return this.p.judgeKind; }

  // how far m is above the note (cent); in easy mode from the nearest octave of it
  cents(m, midi) {
    const c = (m - midi) * 100;
    return this.p.mode === "easy" ? (((c % 1200) + 1800) % 1200) - 600 : c; // any octave counts
  }

  near(m, midi) { return Math.abs(this.cents(m, midi)) <= PITCH_TOL[this.p.mode]; }

  // every animation frame: pitch of the new microphone sound, 50 frames a second, each frame passed on one
  // frame late (20 ms) so a pitch heard in one frame alone can be dropped
  update(an) {
    const dur = FRAME / an.sr;
    if (this.nextT === null || this.nextT < an.lastT - 1) { this.nextT = an.lastT - dur; this.held = null; this.before = null; }
    while (this.nextT + dur <= an.lastT) {
      if (!an.hp) an.highPass(LOW_CUT);
      const x = an.window(this.nextT, FRAME, true), raw = an.window(this.nextT, FRAME);
      const mid = this.nextT + dur / 2;
      this.nextT += HOP;
      const loud = !!raw && rms(raw) >= MIN_LEVEL;
      const m = this.pitchOf(x, an, mid, loud);
      const prev = this.held;
      this.held = { mid, m, raw: loud ? raw : null };
      if (!prev) continue;
      // A new note: the window before may already hold it. Without its fundamental (the low cut) a low note
      // is weaker, so a window half the old note and half a low new one still read the old one and the new
      // note's start came a frame late; read that window as it came, and take the new note if it is there.
      if (m !== null && prev.raw && (prev.m === null || Math.abs(prev.m - m) > JUMP)) {
        const r = yin(prev.raw, an.sr, 150, 1400), mr = 69 + 12 * Math.log2(r.f0 / 440);
        if (r.clarity >= 0.6 && Math.abs(mr - m) < 0.5) prev.m = mr;
      }
      // a frame far from the frames on both sides of it is a wrong reading (the period found twice over in
      // a quiet frame, the slide of a finger lifting off the stem), not a note: the dot jumped to the bottom
      // of the lane and back
      const v = prev.m, near = (a) => a !== null && Math.abs(a - v) <= JUMP;
      this.take(prev.mid, v !== null && (near(this.before) || near(m)) ? v : null);
      this.before = v;
    }
    if (this.trail.length > 500) this.trail.splice(0, this.trail.length - 500);
  }

  // the pitch in one window of the high-passed sound (MIDI, fractional), or null for the room, a sound much
  // quieter than what was just played (a finger letting go) or a sound with no clear pitch; loud: the window as
  // it came reaches MIN_LEVEL
  pitchOf(x, an, t, loud = true) {
    if (!x) return null;
    const lv = rms(x);
    this.peak = Math.max(lv, (this.peak || 0) * PEAK_FALL);
    if (!loud || lv < Math.max(an.hp.noise * 4, 0.0015) || lv < this.peak / 8) return null;
    // a sound starting from quiet must be clearly pitched (talking, music in the room); going on from a pitch,
    // less so (a window half one note, half the next)
    const { f0, clarity } = yin(x, an.sr, 150, 1400);
    const going = !!this.held && this.held.m !== null;
    if (clarity < (going ? 0.6 : 0.75) || !(f0 > 0)) return null;
    // a low pitch with no harmonics is the room (a band of low noise, a fan tone, a hum), not the otamatone:
    // low on the stem the otamatone has 0.3 to 0.9 of its sound there, those under 0.1 (rarely 0.15). High on
    // the stem its notes are nearly pure (E5 to C6: 0 to 0.15), and the room's noise is not up there.
    if (f0 < HARM_BELOW && harmonicShare(x, an.sr, f0) < (going ? 0.1 : 0.15)) return null;
    const m = 69 + 12 * Math.log2(f0 / 440);
    // a held note keeps the room estimate from climbing to it (then quiet notes were not heard); a pitch that
    // has not moved for 10 s is more likely the room (a fan, a hum) and may become the room level
    if (!this.steady || Math.abs(m - this.steady.m) > 0.5) this.steady = { m, since: t };
    if (t - this.steady.since < 10) an.toneT = t;
    return m;
  }

  take(mid, m) {
    const p = this.p, pl = p.player;
    this.live = { m, at: performance.now() };
    if (this.log) this.log.push({ t: mid, m });
    if (!pl.playing) return;
    const tc = mid - p.offsetMs / 1000; // when it was played: the microphone delay taken off
    if (tc < pl.startCtx) return;
    const st = p.scoreTimeOf(tc);
    this.trail.push({ st, m });
    this.feed(st, m);
  }

  feed(st, m) {
    const p = this.p, ts = p.targets, rate = p.player.rate || 1;
    const win = (this.timing[p.mode][2] / 1000) * rate; // the Bad window, in score seconds
    const kind = this.kind;
    for (let k = this.open; k < ts.length; k++) {
      const g = ts[k];
      if (g.t - win > st) break;
      if (g.grade && g.grade !== "pending") continue;
      const on = m !== null && this.near(m, g.midi);
      if (kind !== "hold" && !g.head) {
        if (on && st <= g.t + win) {
          if (!g.run) { g.run = 1; g.runStart = st; } else g.run++;
          if (g.run >= 2) {
            const prev = ts[k - 1];
            const joined = g.runStart < g.t - win + 0.03 && prev && prev.midi === g.midi && prev.tEnd >= g.t - 0.02;
            this.head(g, joined ? 0 : (g.runStart - g.t) / rate);
          }
        } else if (!on) g.run = 0;
        if (!g.head && st > g.t + win) this.head(g, null);
      }
      const len = g.tEnd - g.t;
      if (st >= g.t + Math.min(0.06, len * 0.2) && st <= g.tEnd - Math.min(0.08, len * 0.25)) {
        g.holdN = (g.holdN || 0) + 1;
        // how high it was played: the middle of what was heard within a semitone of the note (a neighbour
        // note reached early or left late does not pull it)
        const c = m === null ? null : this.cents(m, g.midi);
        if (c !== null && Math.abs(c) <= 100) (g.cs || (g.cs = [])).push(c);
        if (on) {
          g.holdOk = (g.holdOk || 0) + 1;
          const segs = g.segs || (g.segs = []);
          const last = segs[segs.length - 1];
          if (last && st - last[1] < 0.05 * rate) last[1] = st; else segs.push([st, st]);
        }
      }
      if (kind === "start" ? !!g.head : st > g.tEnd + 0.02 && (kind === "hold" || !!g.head)) this.finish(g);
    }
    while (this.open < ts.length && ts[this.open].grade && ts[this.open].grade !== "pending") this.open++;
  }

  // the start of a note: d seconds (real time) from its time, or null when it never came
  head(g, d) {
    const p = this.p;
    g.head = d === null ? "miss" : p.mode === "easy" ? "perfect" : p.timingGrade(d * 1000);
    g.headD = d;
    g.grade = "pending";
    if (this.kind === "both") p.flashOnly(g, g.head, d);
  }

  finish(g) {
    const kind = this.kind;
    const h = g.head || "miss";
    const r = g.holdN ? g.holdOk / g.holdN || 0 : h !== "miss" ? 1 : 0;
    g.hold = r;
    let grade;
    if (kind === "start") grade = h;
    else if (kind === "hold") grade = r >= 0.85 ? "perfect" : r >= 0.6 ? "ok" : r >= 0.3 ? "bad" : "miss";
    else {
      const a = 0.5 * ACC[h] + 0.5 * r;
      grade = a >= 0.9 ? "perfect" : a >= 0.65 ? "ok" : a >= 0.35 ? "bad" : "miss";
    }
    this.p.count(g, grade, g.headD == null ? null : g.headD * 1000, kind === "hold" ? null : h,
      { flash: kind !== "both", hold: kind === "start" ? null : r, cents: g.cs && g.cs.length >= 3 ? median(g.cs) : null });
  }

  // notes long past whose sound never came (the microphone stopped): finished as they are
  tick(now) {
    const ts = this.p.targets, rate = this.p.player.rate || 1;
    for (let k = this.open; k < ts.length; k++) {
      const g = ts[k];
      if (g.t > now) break;
      if (g.grade && g.grade !== "pending") continue;
      if (g.tEnd + 0.6 * rate < now) this.finish(g);
    }
    while (this.open < ts.length && ts[this.open].grade && ts[this.open].grade !== "pending") this.open++;
  }

  rewind() {
    this.open = 0;
    this.trail = [];
    this.nextT = null;
    this.held = null;
    this.before = null;
    this.steady = null;
  }
}
