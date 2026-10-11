// Builds examples/*.json from short note lists (public-domain tunes). Run: node tools/make_examples.mjs
import { writeFileSync } from "node:fs";
import { newScore, normalizeScore } from "../js/model.js";
import { melodyToTab } from "../js/fingering.js";

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midi = (n) => { const m = /^([A-G])(#?)(\d)$/.exec(n); return (+m[3] + 1) * 12 + PC[m[1]] + (m[2] ? 1 : 0); };

// notes: "C4:4 D4:2 ..." (length in 16th steps); chords: [[bar, beat, name]] (beat is 0-based)
function build({ title, artist, comment, bpm, notes, chords, lyrics, pattern, sections }) {
  const s = newScore({ title, artist, bpm, beats: 4 });
  s.meta.comment = comment;
  s.meta.key = "C";
  s.strum.pattern = pattern;
  let col = 0;
  const mel = [];
  for (const tok of notes.trim().split(/\s+/)) {
    const [n, l] = tok.split(":");
    if (n !== "r") mel.push({ col, len: +l, midi: midi(n) });
    col += +l;
  }
  s.columnCount = Math.ceil(col / 16) * 16;
  s.tracks = [{ id: "melody", name: "멜로디", notes: melodyToTab(mel, "standard").notes }];
  s.chords = chords.map(([bar, beat, name]) => ({ col: bar * 16 + beat * 4, name }));
  const syl = lyrics ? lyrics.trim().split(/\s+/) : [];
  s.lyrics = syl.map((t, i) => ({ col: mel[i].col, text: t.replace(/_/g, " ") }));
  s.sections = sections || [];
  return normalizeScore(s);
}

const twinkle = build({
  title: "Twinkle, Twinkle, Little Star",
  artist: "프랑스 민요 (영어 가사 Jane Taylor, 1806)",
  comment: "저작권이 끝난 곡으로 만든 예제",
  bpm: 96,
  pattern: "D-D-DUDU",
  notes: `C4:4 C4:4 G4:4 G4:4 A4:4 A4:4 G4:8 F4:4 F4:4 E4:4 E4:4 D4:4 D4:4 C4:8
          G4:4 G4:4 F4:4 F4:4 E4:4 E4:4 D4:8 G4:4 G4:4 F4:4 F4:4 E4:4 E4:4 D4:8
          C4:4 C4:4 G4:4 G4:4 A4:4 A4:4 G4:8 F4:4 F4:4 E4:4 E4:4 D4:4 D4:4 C4:8`,
  chords: [[0, 0, "C"], [1, 0, "F"], [1, 2, "C"], [2, 0, "F"], [2, 2, "C"], [3, 0, "G7"], [3, 2, "C"],
    [4, 0, "C"], [4, 2, "G7"], [5, 0, "C"], [5, 2, "G7"], [6, 0, "C"], [6, 2, "G7"], [7, 0, "C"], [7, 2, "G7"],
    [8, 0, "C"], [9, 0, "F"], [9, 2, "C"], [10, 0, "F"], [10, 2, "C"], [11, 0, "G7"], [11, 2, "C"]],
  lyrics: `Twin kle twin kle lit tle star How I won der what you are Up a bove the world so high
           Like a dia mond in the sky Twin kle twin kle lit tle star How I won der what you are`,
  sections: [{ col: 0, text: "A" }, { col: 64, text: "B" }, { col: 128, text: "A" }],
});

const ode = build({
  title: "Ode to Joy (환희의 송가)",
  artist: "L. v. Beethoven",
  comment: "교향곡 9번 4악장 주제. 저작권이 끝난 곡으로 만든 예제",
  bpm: 108,
  pattern: "D-DUD-DU",
  notes: `E4:4 E4:4 F4:4 G4:4 G4:4 F4:4 E4:4 D4:4 C4:4 C4:4 D4:4 E4:4 E4:6 D4:2 D4:8
          E4:4 E4:4 F4:4 G4:4 G4:4 F4:4 E4:4 D4:4 C4:4 C4:4 D4:4 E4:4 D4:6 C4:2 C4:8
          D4:4 D4:4 E4:4 C4:4 D4:4 E4:2 F4:2 E4:4 C4:4 D4:4 E4:2 F4:2 E4:4 D4:4 C4:4 D4:4 G3:8
          E4:4 E4:4 F4:4 G4:4 G4:4 F4:4 E4:4 D4:4 C4:4 C4:4 D4:4 E4:4 D4:6 C4:2 C4:8`,
  chords: [[0, 0, "C"], [1, 0, "G7"], [2, 0, "C"], [3, 0, "C"], [3, 2, "G7"],
    [4, 0, "C"], [5, 0, "G7"], [6, 0, "C"], [7, 0, "G7"], [7, 2, "C"],
    [8, 0, "G7"], [8, 2, "C"], [9, 0, "G7"], [9, 2, "C"], [10, 0, "G7"], [10, 2, "C"], [11, 0, "Am"], [11, 2, "G7"],
    [12, 0, "C"], [13, 0, "G7"], [14, 0, "C"], [15, 0, "G7"], [15, 2, "C"]],
  sections: [{ col: 0, text: "A" }, { col: 128, text: "B" }, { col: 192, text: "A" }],
});

writeFileSync(new URL("../examples/twinkle.json", import.meta.url), JSON.stringify(twinkle, null, 1));
writeFileSync(new URL("../examples/ode-to-joy.json", import.meta.url), JSON.stringify(ode, null, 1));
writeFileSync(new URL("../examples/manifest.json", import.meta.url), JSON.stringify([
  { file: "twinkle.json", title: "Twinkle, Twinkle, Little Star", note: "C · F · G7, 가사 있음" },
  { file: "ode-to-joy.json", title: "Ode to Joy (환희의 송가)", note: "C · G7 · Am, 멜로디 TAB" },
], null, 1));
console.log("examples written", twinkle.tracks[0].notes.length, ode.tracks[0].notes.length);
