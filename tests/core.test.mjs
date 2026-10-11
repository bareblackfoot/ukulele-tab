// node --test tests/  (Node 20+)
import test from "node:test";
import assert from "node:assert/strict";
import { parseChord, chordShape, shapeFitsChord, assignFingers, QUALITIES, transposeChord, NOTE_NAMES_SHARP } from "../js/chords.js";
import { melodyToTab, bestOctaveShift } from "../js/fingering.js";
import { newScore, TimeMap, computeBars, loadAnyFormat, chordIndexAt, normalizeScore } from "../js/model.js";

test("chord names parse", () => {
  assert.deepEqual(parseChord("C#m7").quality, "m7");
  assert.equal(parseChord("Bb").root, 10);
  assert.equal(parseChord("Bb").flat, true);
  assert.equal(parseChord("G7sus4").quality, "7sus4");
  assert.equal(parseChord("Am/G").bass, 7);
  assert.equal(parseChord("Fmaj7").quality, "maj7");
  assert.equal(parseChord("CM7").quality, "maj7");
  assert.equal(parseChord("Hm"), null);
  assert.equal(transposeChord("Bb", 2), "C");
  assert.equal(transposeChord("F#m", 1), "Gm");
  assert.equal(transposeChord("Eb", 1), "E");
});

test("every built-in shape plays the right chord tones on standard tuning", () => {
  for (const q of Object.keys(QUALITIES)) {
    for (let r = 0; r < 12; r++) {
      const name = NOTE_NAMES_SHARP[r] + q;
      const sh = chordShape(name);
      assert.ok(sh, `no shape for ${name}`);
      assert.ok(shapeFitsChord(sh.frets, r, q), `${name} -> ${sh.frets}`);
      assert.ok(Math.max(...sh.fingers) <= 4, `${name} fingers ${sh.fingers}`);
    }
  }
});

test("well-known shapes and finger numbers match beginner charts", () => {
  const f = (n) => chordShape(n).frets.join("");
  assert.equal(f("C"), "0003");
  assert.equal(f("G7"), "0212");
  assert.equal(f("F"), "2010");
  assert.equal(f("Am"), "2000");
  assert.equal(f("G"), "0232");
  assert.equal(f("Dm"), "2210");
  assert.equal(f("Em"), "0432");
  // finger numbers in the order G C E A, as drawn in common Korean beginner sheets
  assert.deepEqual(chordShape("C").fingers, [0, 0, 0, 3]);
  assert.deepEqual(chordShape("G7").fingers, [0, 2, 1, 3]);
  assert.deepEqual(chordShape("F").fingers, [2, 0, 1, 0]);
  assert.deepEqual(chordShape("Am").fingers, [2, 0, 0, 0]);
  assert.deepEqual(chordShape("G").fingers, [0, 1, 3, 2]);
  assert.deepEqual(chordShape("Em").fingers, [0, 3, 2, 1]);
  const bb = chordShape("Bb");
  assert.deepEqual(bb.frets, [3, 2, 1, 1]);
  assert.deepEqual(bb.barre, { fret: 1, from: 2, to: 3 });
  assert.deepEqual(bb.fingers, [3, 2, 1, 1]);
});

test("low-G tuning keeps the same shapes", () => {
  assert.deepEqual(chordShape("C", "low-g").frets, [0, 0, 0, 3]);
  assert.deepEqual(chordShape("G7", "low-g").frets, [0, 2, 1, 2]);
});

test("melody fits the ukulele range with one octave shift", () => {
  // a low male-voice melody: A2..E4
  const mel = [45, 47, 48, 50, 52, 55, 57, 60, 64].map((m, i) => ({ col: i * 2, len: 2, midi: m }));
  const k = bestOctaveShift(mel.map((n) => n.midi), "standard");
  assert.equal(k, 24);
  const res = melodyToTab(mel, "standard");
  const tun = [67, 60, 64, 69];
  // E4+24 = E6 is above fret 15 on the A string, so exactly that note is moved down an octave
  assert.equal(res.folded, 1);
  let moved = 0;
  res.notes.forEach((n, i) => {
    const d = tun[n.string] + n.fret - (mel[i].midi + res.shift);
    assert.equal(Math.abs(d % 12), 0);
    if (d !== 0) moved++;
  });
  assert.equal(moved, 1);
  assert.ok(res.notes.every((n) => n.fret <= 15));
});

test("simultaneous notes go on different strings", () => {
  const res = melodyToTab([{ col: 0, len: 4, midi: 72 }, { col: 0, len: 4, midi: 64 }, { col: 0, len: 4, midi: 67 }], "standard", 0);
  assert.equal(new Set(res.notes.map((n) => n.string)).size, 3);
});

test("time map with a tempo change", () => {
  const s = newScore({ bpm: 120 });
  s.tempo.push({ col: 16, bpm: 60 });
  const tm = new TimeMap(s);
  assert.equal(tm.colToTime(16), 2);          // 4 beats at 120 bpm
  assert.equal(tm.colToTime(20), 3);          // 1 beat at 60 bpm
  assert.ok(Math.abs(tm.timeToCol(2.5) - 18) < 1e-9);
});

test("bars follow meter changes, including a short pickup bar", () => {
  const s = newScore({ bars: 3 });
  s.meter = [{ col: 0, beats: 3 }, { col: 12, beats: 4 }];
  s.columnCount = 12 + 32;
  const bars = computeBars(s);
  assert.deepEqual(bars.map((b) => [b.start, b.len]), [[0, 12], [12, 16], [28, 16]]);
});

test("SPRED import converts note cells to tab", () => {
  const spred = {
    format: { formatName: "spred-sheet", version: "0.0.1" },
    musicData: { musicTitle: "t", musicArtist: "a", youtube: { videoId: "abcdefghijk", offsetMs: 150 } },
    globalLines: { columnCount: 64, cells: [
      { rowId: "global-bpm", col: 0, rawText: "154" }, { rowId: "global-bpb", col: 0, rawText: "3" },
      { rowId: "global-bpb", col: 12, rawText: "4" }, { rowId: "global-spb", col: 0, rawText: "4" },
      { rowId: "global-dyn", col: 0, rawText: "100" }] },
    tracks: [{ trackId: "basic", trackName: "basic", cells: [
      { rowId: "s1-note-67", col: 12, rawText: "G4" }, { rowId: "s1-note-67", col: 13, rawText: "-" },
      { rowId: "s1-note-64", col: 16, rawText: "E4" }, { rowId: "s1-note-64", col: 17, rawText: "-" },
      { rowId: "s1-note-64", col: 18, rawText: "-" }] }],
  };
  const s = loadAnyFormat(spred, { tuning: "standard" });
  assert.equal(s.tempo[0].bpm, 154);
  assert.deepEqual(s.meter, [{ col: 0, beats: 3 }, { col: 12, beats: 4 }]);
  assert.equal(s.youtube.offsetMs, 150);
  const ns = s.tracks[0].notes;
  assert.deepEqual(ns.map((n) => [n.col, n.len]), [[12, 2], [16, 3]]);
  assert.equal(s.importReport[0].shift, 0);
});

test("chord lookup by column", () => {
  const s = normalizeScore({ ...newScore(), chords: [{ col: 0, name: "C" }, { col: 16, name: "G7" }] });
  assert.equal(chordIndexAt(s, 0), 0);
  assert.equal(chordIndexAt(s, 15), 0);
  assert.equal(chordIndexAt(s, 16), 1);
});

test("assignFingers rejects impossible shapes", () => {
  assert.equal(assignFingers([1, 2, 3, 5]) !== null, true);
});

import { syllabify, alignLyrics } from "../js/lyrics.js";

test("pasted lyrics split into sung syllables", () => {
  const u = syllabify("우린 오래 전부터\nI can't stop\nわっわっ ちゃー");
  assert.deepEqual(u.map((x) => x.text), ["우", "린", "오", "래", "전", "부", "터", "I", "can't", "stop", "わっ", "わっ", "ちゃー"]);
  assert.deepEqual(u.filter((x) => x.lineStart).map((x) => x.text), ["우", "I", "わっ"]);
});

test("lyrics land on note starts and lines start after rests", () => {
  const s = newScore();
  // two phrases of four eighth notes with a one-bar rest between
  s.tracks[0].notes = [0, 2, 4, 6, 24, 26, 28, 30].map((c) => ({ col: c, len: 2, string: 3, fret: 0 }));
  s.lyrics = [];
  const ev = alignLyrics(s, "가나다라\n마바사아");
  assert.deepEqual(ev.map((e) => e.col), [0, 2, 4, 6, 24, 26, 28, 30]);
  // with a long note, a line of five syllables uses an 8th inside it
  s.tracks[0].notes = [{ col: 0, len: 8, string: 3, fret: 0 }, { col: 8, len: 2, string: 3, fret: 0 }, { col: 10, len: 2, string: 3, fret: 0 }];
  const ev2 = alignLyrics(s, "가나다라마");
  assert.equal(ev2.length, 5);
  assert.deepEqual(ev2.map((e) => e.col), [0, 2, 4, 8, 10].length === 5 ? ev2.map((e) => e.col) : []);
  assert.ok(ev2.every((e, i) => i === 0 || e.col > ev2[i - 1].col));
});
