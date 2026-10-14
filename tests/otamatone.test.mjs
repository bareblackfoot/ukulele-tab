// Otamatone game judging (js/pitchgame.js) on synthesized sound: a buzzy square wave at the played pitches is
// pushed through the microphone analyzer as the browser would, and the grades are checked.
import test from "node:test";
import assert from "node:assert/strict";
import { MicAnalyzer } from "../js/dsp.js";
import { PitchJudge } from "../js/pitchgame.js";
import { TIMING } from "../js/practice.js";
import { fromSpred, midiOf } from "../js/model.js";

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
    count(g, grade, dMs, tg, o) { g.grade = grade; counted.push({ midi: g.midi, grade, dMs, tg, hold: o.hold }); },
    flashOnly() {},
  };
  return { p, counted };
}

// played: [{t0, t1, midi}] -> samples; quiet room noise in between
function render(played, total) {
  const x = new Float32Array(Math.ceil(total * SR));
  let phase = 0, seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    x[i] = rnd() * 0.001;
    const n = played.find((q) => t >= q.t0 && t < q.t1);
    if (!n) continue;
    phase = (phase + 440 * 2 ** ((n.midi - 69) / 12) / SR) % 1;
    x[i] += phase < 0.5 ? 0.2 : -0.2;
  }
  return x;
}

function run(notes, played, kind, mode = "std") {
  const targets = notes.map((n, i) => ({ col: i, t: n.t0, tEnd: n.t1, midi: n.midi, kind: "note", grade: null }));
  const { p, counted } = fakePractice(targets, kind, mode);
  const pj = new PitchJudge(p, TIMING);
  const an = new MicAnalyzer(SR);
  const total = Math.max(...notes.map((n) => n.t1)) + 1;
  const x = render(played, total);
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
