// node --test tests/  (Node 20+): guitar shapes, capo choice and ukulele -> guitar conversion
import test from "node:test";
import assert from "node:assert/strict";
import { chordShape, shapeFitsChord, QUALITIES, NOTE_NAMES_SHARP, lowestPc, capoChoices, transposeChord, parseChord } from "../js/chords.js";
import { newScore, normalizeScore, toInstrument, midiOf, tabLabel, retune } from "../js/model.js";
import { melodyToTab } from "../js/fingering.js";

const GTR = [40, 45, 50, 55, 59, 64];

test("every guitar shape plays the chord tones with the root lowest and needs at most 4 fingers", () => {
  for (const q of Object.keys(QUALITIES)) {
    for (let r = 0; r < 12; r++) {
      const name = NOTE_NAMES_SHARP[r] + q;
      const sh = chordShape(name, "guitar");
      assert.ok(sh, `no shape for ${name}`);
      assert.equal(sh.frets.length, 6);
      assert.ok(shapeFitsChord(sh.frets, r, q, GTR), `${name} -> ${sh.frets}`);
      assert.equal(lowestPc(sh.frets, GTR), r, `${name} bass -> ${sh.frets}`);
      assert.ok(Math.max(...sh.fingers) <= 4, `${name} fingers ${sh.fingers}`);
    }
  }
});

test("open chords and barre chords match common guitar charts", () => {
  const f = (n) => chordShape(n, "guitar").frets.map((x) => (x < 0 ? "x" : x)).join("");
  assert.equal(f("C"), "x32010");
  assert.equal(f("G"), "320003");
  assert.equal(f("D"), "xx0232");
  assert.equal(f("Am"), "x02210");
  assert.equal(f("Em"), "022000");
  assert.equal(f("E7"), "020100");
  assert.equal(f("B7"), "x21202");
  assert.equal(f("Bb"), "x13331");
  // finger numbers low E .. high E
  assert.deepEqual(chordShape("C", "guitar").fingers, [0, 3, 2, 0, 1, 0]);
  assert.deepEqual(chordShape("D", "guitar").fingers, [0, 0, 0, 1, 3, 2]);
  assert.deepEqual(chordShape("B7", "guitar").fingers, [0, 2, 1, 3, 0, 4]);
  const F = chordShape("F", "guitar");
  assert.deepEqual(F.frets, [1, 3, 3, 2, 1, 1]);
  assert.deepEqual(F.barre, { fret: 1, from: 0, to: 5 });
  assert.deepEqual(F.fingers, [1, 3, 4, 2, 1, 1]);
  const Bm = chordShape("Bm", "guitar");
  assert.deepEqual(Bm.barre, { fret: 2, from: 1, to: 5 });
  assert.deepEqual(Bm.fingers, [0, 1, 3, 4, 2, 1]);
});

test("a slash chord puts its bass note lowest on the guitar", () => {
  for (const n of ["D/F#", "C/G", "G/B", "C/E", "Am/G"]) {
    const sh = chordShape(n, "guitar");
    assert.ok(sh, n);
    assert.equal(lowestPc(sh.frets, GTR), parseChord(n).bass, `${n} -> ${sh.frets}`);
  }
});

test("the capo goes where the guitar shapes are easiest", () => {
  // Bb Eb F Gm sound the same as G C D Em with the capo on 3
  const sounding = ["Bb", "Eb", "F", "Gm", "Bb", "F"];
  assert.equal(capoChoices(sounding, "guitar")[0].capo, 3);
  // G C D needs no capo
  assert.equal(capoChoices(["G", "C", "D", "Em"], "guitar")[0].capo, 0);
});

test("a ukulele sheet becomes a guitar sheet with the same sound", () => {
  const s = normalizeScore({
    ...newScore(), tuning: "standard", capo: 0, meta: { ...newScore().meta, key: "Bb" },
    chords: [{ col: 0, name: "Bb" }, { col: 16, name: "Eb" }, { col: 32, name: "F" }, { col: 48, name: "Gm" }, { col: 56, name: "N.C." }],
    tracks: [{ id: "melody", name: "멜로디", notes: melodyToTab([70, 72, 74, 75, 77].map((m, i) => ({ col: i * 4, len: 4, midi: m })), "standard").notes }],
  });
  const g = toInstrument(s, "guitar");
  assert.equal(g.tuning, "guitar");
  assert.equal(g.capo, 3);
  assert.deepEqual(g.chords.map((c) => c.name), ["G", "C", "D", "Em", "N.C."]);
  assert.equal(g.meta.key, "Bb (카포 3, G 운지)");
  g.chords.forEach((c, i) => {
    if (c.name === "N.C.") return;
    assert.equal(parseChord(transposeChord(c.name, g.capo)).root, parseChord(s.chords[i].name).root);
  });
  const before = s.tracks[0].notes.map((n) => midiOf(n, s.tuning, s.capo));
  const after = g.tracks[0].notes.map((n) => midiOf(n, g.tuning, g.capo));
  assert.equal(after.length, before.length);
  after.forEach((m, i) => assert.equal(Math.abs(m - before[i]) % 12, 0));
  assert.ok(g.tracks[0].notes.every((n) => n.string >= 0 && n.string <= 5 && n.fret <= 17));
});

test("playing marks are written the usual TAB way and kept through a capo change", () => {
  assert.equal(tabLabel({ fret: 7, tech: "b2" }), "7b9");
  assert.equal(tabLabel({ fret: 7, tech: "b1" }), "7b8");
  assert.equal(tabLabel({ fret: 5, tech: "v" }), "5~");
  assert.equal(tabLabel({ fret: 7, tech: "h" }, { fret: 5 }), "h7");
  assert.equal(tabLabel({ fret: 5, tech: "p" }, { fret: 7 }), "p5");
  assert.equal(tabLabel({ fret: 9, tech: "s" }, { fret: 7 }), "/9");
  assert.equal(tabLabel({ fret: 5, tech: "s" }, { fret: 7 }), "\\5");
  // a solo taken from the recording (absolute) keeps its pitch, octave included, and its marks; a bend never
  // lands on an open string
  const notes = melodyToTab([64, 67, 69, 71, 76].map((m, i) => ({ col: i * 4, len: 4, midi: m, tech: i === 0 ? "b2" : i === 2 ? "v" : undefined })), "guitar", 0, { lead: true });
  assert.ok(notes.notes[0].fret > 0, "bent note on an open string");
  const s = normalizeScore({ ...newScore(), tuning: "guitar", capo: 3, tracks: [{ id: "lead", name: "솔로", absolute: true, notes: notes.notes }] });
  const before = s.tracks[0].notes.map((n) => midiOf(n, s.tuning, s.capo));
  const t = retune(JSON.parse(JSON.stringify(s)), "guitar", 0, 0, null);
  const after = t.tracks[0].notes.map((n) => midiOf(n, t.tuning, t.capo));
  assert.deepEqual(after, before);
  assert.deepEqual(t.tracks[0].notes.map((n) => n.tech || ""), ["b2", "", "v", "", ""]);
  assert.equal(t.tracks[0].absolute, true);
});
