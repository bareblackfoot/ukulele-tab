// Otamatone game judging (js/pitchgame.js) on synthesized sound: a buzzy square wave at the played pitches is
// pushed through the microphone analyzer as the browser would, and the grades are checked.
import test from "node:test";
import assert from "node:assert/strict";
import { MicAnalyzer } from "../js/dsp.js";
import { PitchJudge } from "../js/pitchgame.js";
import { TIMING } from "../js/practice.js";
import { fromSpred, midiOf, normalizeScore, toJSON } from "../js/model.js";
import { INSTRUMENTS, stemMap } from "../js/instrument.js";

const SR = 48000;

function fakePractice(targets, kind, mode = "std") {
  const counted = [];
  const p = {
    mode, judgeKind: kind, offsetMs: 0, targets,
    player: { playing: true, startCtx: 0, startScoreT: 0, rate: 1 },
    scoreTimeOf: (t) => t,
    timingGrade(dMs) {
      const w = TIMING[mode], a = Math.abs(dMs);
      return a <= w[0] ? "perfect" : a <= w[1] ? "ok" : a <= w[2] ? "bad" : "miss";
    },
    count(g, grade, dMs, tg, o) { g.grade = grade; counted.push({ midi: g.midi, grade, dMs, tg, hold: o.hold, cents: o.cents }); },
    flashOnly() {},
  };
  return { p, counted };
}

// played: [{t0, t1, midi}] -> samples; quiet room noise in between
function render(played, total, detune = 0) {
  const x = new Float32Array(Math.ceil(total * SR));
  let phase = 0, seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    x[i] = rnd() * 0.001;
    const n = played.find((q) => t >= q.t0 && t < q.t1);
    if (!n) continue;
    phase = (phase + 440 * 2 ** ((n.midi - 69 + detune / 100) / 12) / SR) % 1;
    x[i] += phase < 0.5 ? 0.2 : -0.2;
  }
  return x;
}

function run(notes, played, kind, mode = "std", detune = 0) {
  const targets = notes.map((n, i) => ({ col: i, t: n.t0, tEnd: n.t1, midi: n.midi, kind: "note", grade: null }));
  const { p, counted } = fakePractice(targets, kind, mode);
  const pj = new PitchJudge(p, TIMING);
  const an = new MicAnalyzer(SR);
  const total = Math.max(...notes.map((n) => n.t1)) + 1;
  const x = render(played, total, detune);
  const B = 128;
  for (let i = 0, k = 0; i + B <= x.length; i += B, k++) {
    an.push((i + B - 1) / SR, x.subarray(i, i + B));
    if (k % 8 === 0) pj.update(an); // about every 21 ms, like animation frames
  }
  pj.update(an);
  pj.tick(total + 2);
  return counted;
}

const SONG = [
  { t0: 0.5, t1: 1.0, midi: 60 }, { t0: 1.0, t1: 1.5, midi: 64 }, { t0: 1.5, t1: 2.5, midi: 67 },
  { t0: 2.5, t1: 3.0, midi: 67 }, { t0: 3.2, t1: 3.6, midi: 72 }, { t0: 3.6, t1: 4.4, midi: 55 },
];

test("played on time and on pitch: every note Perfect, held all the way", () => {
  // the same pitch twice in a row is one long tone (G4 G4), as on the stem
  const played = [{ t0: 0.5, t1: 1.5, midi: 60 }, { t0: 1.0, t1: 1.5, midi: 64 }, { t0: 1.5, t1: 3.0, midi: 67 },
    { t0: 3.2, t1: 3.6, midi: 72 }, { t0: 3.6, t1: 4.4, midi: 55 }];
  played[0].t1 = 1.0;
  const r = run(SONG, played, "both");
  assert.equal(r.length, SONG.length);
  for (const c of r) {
    assert.equal(c.grade, "perfect", JSON.stringify(c));
    assert.ok(c.hold > 0.9, JSON.stringify(c));
  }
});

test("90 ms late: start Ok and LATE, the note still counted", () => {
  const played = SONG.map((n) => ({ ...n, t0: n.t0 + 0.09, t1: n.t1 + 0.09 }));
  const r = run(SONG.filter((n, i) => i !== 3), played.filter((n, i) => i !== 3), "start");
  for (const c of r) {
    assert.equal(c.grade, "ok", JSON.stringify(c));
    assert.ok(c.dMs > 60 && c.dMs < 140, JSON.stringify(c));
  }
});

test("a semitone off is a Miss; easy mode takes the right note an octave off", () => {
  const off = SONG.map((n) => ({ ...n, midi: n.midi + 1 }));
  for (const c of run(SONG, off, "both")) assert.equal(c.grade, "miss", JSON.stringify(c));
  const oct = SONG.map((n) => ({ ...n, midi: n.midi + 12 }));
  for (const c of run(SONG, oct, "both", "easy")) assert.equal(c.grade, "perfect", JSON.stringify(c));
});

test("where the playing lands: a flat otamatone reads flat, early starts read early", () => {
  // one note into the next, a semitone up each time: 25 cent flat and 120 ms early, so the end of each note's
  // time already hears the next one (25 cent flat of a semitone up is +75: that must not pull the average up)
  const notes = [60, 61, 62, 63, 64].map((midi, i) => ({ t0: 0.5 + i * 0.5, t1: 1.0 + i * 0.5, midi }));
  const played = notes.map((n) => ({ ...n, t0: n.t0 - 0.12, t1: n.t1 - 0.12 }));
  const r = run(notes, played, "both", "std", -25);
  assert.equal(r.length, notes.length);
  for (const c of r) {
    assert.ok(c.cents > -32 && c.cents < -18, JSON.stringify(c));
    assert.ok(c.dMs > -150 && c.dMs < -90, JSON.stringify(c));
  }
});

test("holding: a note dropped halfway counts about half", () => {
  const notes = [{ t0: 0.5, t1: 2.5, midi: 62 }];
  const r = run(notes, [{ t0: 0.5, t1: 1.5, midi: 62 }], "hold");
  assert.equal(r.length, 1);
  assert.ok(r[0].hold > 0.4 && r[0].hold < 0.6, JSON.stringify(r[0]));
  assert.equal(r[0].grade, "bad");
  const both = run(notes, [{ t0: 0.5, t1: 1.5, midi: 62 }], "both");
  assert.equal(both[0].tg, "perfect");
  assert.equal(both[0].grade, "ok"); // half of 1 + half of ~0.5
});

test("SPRED notes keep their pitch on the otamatone tuning", () => {
  const spred = {
    format: { formatName: "spred-sheet" },
    musicData: { musicTitle: "t" },
    globalLines: { columnCount: 32, cells: [{ rowId: "global-bpm", col: 0, rawText: "120" }, { rowId: "global-bpb", col: 0, rawText: "4" }, { rowId: "global-spb", col: 0, rawText: "4" }] },
    tracks: [{ trackId: "basic", trackName: "basic", cells: [{ rowId: "s1-note-52", col: 0, rawText: "E3" }, { rowId: "s1-note-85", col: 4, rawText: "C#6" }, { rowId: "s1-note-85", col: 5, rawText: "-" }] }],
  };
  const s = fromSpred(spred, { tuning: "otamatone", octaveShift: 0 });
  assert.equal(s.tuning, "otamatone");
  assert.deepEqual(s.tracks[0].notes.map((n) => midiOf(n, s.tuning)), [52, 85]);
  assert.equal(s.tracks[0].notes[1].len, 2);
  assert.equal(s.tracks[0].name, "노래 멜로디 (basic)");
});

test("rows as far apart as the notes are on the stem: the sheet's own SPRED layout, else the maker's", () => {
  const rows = [{ rowId: "global-bpm", type: "global", height: 21 }, { rowId: "s1-gap-62-63", type: "gap", stringId: "s1", fromMidi: 62, toMidi: 63, height: 7 }];
  for (let m = 61; m >= 52; m--) {
    rows.push({ rowId: `s1-note-${m}`, type: "note", stringId: "s1", midi: m, height: 7 });
    if (m > 52) rows.push({ rowId: `s1-gap-${m - 1}-${m}`, type: "gap", stringId: "s1", fromMidi: m - 1, toMidi: m, height: m > 56 ? 10 : 40 });
  }
  const spred = {
    format: { formatName: "spred-sheet" }, musicData: { musicTitle: "t" }, layout: { rowDefinitions: rows },
    globalLines: { columnCount: 16, cells: [{ rowId: "global-bpm", col: 0, rawText: "120" }] },
    tracks: [{ trackId: "basic", trackName: "basic", cells: [{ rowId: "s1-note-60", col: 0, rawText: "C4" }] }],
  };
  const s = normalizeScore(JSON.parse(toJSON(fromSpred(spred, { tuning: "otamatone", octaveShift: 0 }))));
  assert.equal(s.stem.row, 7);
  assert.equal(s.stem.gaps[52], 40);
  assert.equal(s.stem.gaps[60], 10);
  assert.equal(s.stem.gaps[61], undefined); // the gap above the last note row is padding, not a distance
  const p = stemMap(s.stem);
  assert.equal(p(53) - p(52), 47);
  assert.equal(p(61) - p(60), 17);
  assert.equal(p(60.5) - p(60), 8.5);
  // the maker's layout: a semitone low on the stem is several times one near the top
  const q = stemMap(INSTRUMENTS.otamatone.stem);
  assert.ok(q(53) - q(52) > 3 * (q(85) - q(84)));
  for (let m = 52; m < 85; m++) assert.ok(q(m + 1) > q(m));
});

// the pitch the lane shows (pj.live) for a sound given by amp(t) and midi(t) over room noise (hiss and rumble): a saw wave
// through a soft low-pass, smooth like the otamatone, so a held note gives no new attacks
function heard(secs, amp, midi) {
  const p = { mode: "std", judgeKind: "both", offsetMs: 0, targets: [], player: { playing: false, rate: 1 }, scoreTimeOf: (t) => t };
  const pj = new PitchJudge(p, TIMING), an = new MicAnalyzer(SR);
  const x = new Float32Array(Math.ceil(secs * SR));
  let phase = 0, lp = 0, rumble = 0, seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR, a = amp(t);
    rumble = 0.995 * rumble + rnd() * 0.02;
    x[i] = rnd() * 0.0015 + rumble * 0.012;
    if (a <= 0) continue;
    phase = (phase + 440 * 2 ** ((midi(t) - 69) / 12) / SR) % 1;
    lp += 0.25 * (2 * phase - 1 - lp);
    x[i] += a * lp;
  }
  const out = [];
  for (let i = 0, k = 0; i + 128 <= x.length; i += 128, k++) {
    an.push((i + 127) / SR, x.subarray(i, i + 128));
    if (k % 8 === 0) { pj.update(an); out.push({ t: i / SR, m: pj.live ? pj.live.m : null }); }
  }
  return out;
}

test("a quiet note held for seconds stays heard (the room estimate does not climb to it)", () => {
  // a loud note, a short rest, then a note 26 dB quieter started softly (few attacks heard) and held
  const fr = heard(9, (t) => (t > 0.5 && t < 1.5 ? 0.3 : t > 1.7 ? 0.015 * Math.min(1, (t - 1.7) / 0.3) : 0), () => 64)
    .filter((f) => f.t > 2.1);
  const on = fr.filter((f) => f.m !== null && Math.abs(f.m - 64) < 0.3).length;
  assert.ok(on / fr.length > 0.95, `${on} of ${fr.length}`);
});

test("letting go of the stem: the slide down and the quiet tail do not show as a low note", () => {
  // G4 held, then in the last 40 ms the finger lifts: the pitch dives an octave while the sound dies away
  const end = 1.5, fr = heard(2.5, (t) => (t < end - 0.04 ? 0.3 : t < end ? 0.3 * ((end - t) / 0.04) ** 2 : 0),
    (t) => (t < end - 0.04 ? 67 : 67 - 12 * (t - (end - 0.04)) / 0.04));
  const low = fr.filter((f) => f.m !== null && f.m < 64);
  assert.deepEqual(low, []);
  assert.ok(fr.filter((f) => f.t > 0.6 && f.t < 1.4).every((f) => f.m !== null && Math.abs(f.m - 67) < 0.3));
});
