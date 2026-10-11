// Chord names, shapes (frets per string, string 0 first) and finger numbers for the ukulele and the guitar.
// Strings are indexed from 0: ukulele 0..3 = G, C, E, A; guitar 0..5 = low E, A, D, G, B, high E.
// A fret of -1 means the string is not played (x).

import { TUNINGS, tuningOf } from "./instrument.js";
export { TUNINGS };

export const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// canonical quality -> intervals (semitones above the root); "essential" tones must be present in a shape
export const QUALITIES = {
  "": { iv: [0, 4, 7], essential: [0, 4] },
  m: { iv: [0, 3, 7], essential: [0, 3] },
  "7": { iv: [0, 4, 7, 10], essential: [0, 4, 10] },
  m7: { iv: [0, 3, 7, 10], essential: [0, 3, 10] },
  maj7: { iv: [0, 4, 7, 11], essential: [0, 4, 11] },
  "6": { iv: [0, 4, 7, 9], essential: [0, 4, 9] },
  m6: { iv: [0, 3, 7, 9], essential: [0, 3, 9] },
  sus2: { iv: [0, 2, 7], essential: [0, 2, 7] },
  sus4: { iv: [0, 5, 7], essential: [0, 5, 7] },
  "7sus4": { iv: [0, 5, 7, 10], essential: [0, 5, 10] },
  dim: { iv: [0, 3, 6, 9], essential: [0, 3, 6] }, // songbooks play "dim" with the dim7 shape on ukulele
  dim7: { iv: [0, 3, 6, 9], essential: [0, 3, 6, 9] },
  m7b5: { iv: [0, 3, 6, 10], essential: [0, 3, 6, 10] },
  aug: { iv: [0, 4, 8], essential: [0, 4, 8] },
  add9: { iv: [0, 2, 4, 7], essential: [0, 2, 4] },
  "9": { iv: [0, 2, 4, 10], essential: [0, 2, 4, 10] },
  mmaj7: { iv: [0, 3, 7, 11], essential: [0, 3, 11] },
};

const QUALITY_ALIASES = {
  "": "", maj: "", M: "", major: "",
  m: "m", min: "m", "-": "m", minor: "m",
  "7": "7", dom7: "7",
  m7: "m7", min7: "m7", "-7": "m7",
  maj7: "maj7", M7: "maj7", "Δ7": "maj7", "Δ": "maj7", ma7: "maj7",
  "6": "6", m6: "m6", min6: "m6",
  sus2: "sus2", "2": "sus2",
  sus4: "sus4", sus: "sus4", "4": "sus4",
  "7sus4": "7sus4", "7sus": "7sus4",
  dim: "dim", "°": "dim", o: "dim",
  dim7: "dim7", "°7": "dim7", o7: "dim7",
  m7b5: "m7b5", "m7-5": "m7b5", "ø": "m7b5", "ø7": "m7b5",
  aug: "aug", "+": "aug", "+5": "aug",
  add9: "add9", add2: "add9",
  "9": "9",
  mmaj7: "mmaj7", mM7: "mmaj7", "m(maj7)": "mmaj7",
};

// Standard beginner shapes (G C E A), by root C, C#, D, ... B. Checked against chord tones by tests/core.test.mjs.
const UKE_SHAPES = {
  "": ["0003", "1114", "2220", "0331", "1402", "2010", "3121", "0232", "1343", "2100", "3211", "4322"],
  m: ["0333", "1104", "2210", "3321", "0432", "1013", "2120", "0231", "1342", "2000", "3111", "4222"],
  "7": ["0001", "1112", "2223", "3334", "1202", "2310", "3424", "0212", "1323", "0100", "1211", "2322"],
  m7: ["3333", "1102", "2213", "3324", "0202", "1313", "2424", "0211", "1322", "0000", "1111", "2222"],
  maj7: ["0002", "1113", "2224", "3335", "1302", "5500", "3524", "0222", "1333", "1100", "3210", "3322"],
  "6": ["0000", "1111", "2222", "3333", "1424", "2213", "3324", "0202", "1312", "2424", "0211", "1322"],
  sus2: ["0233", "1344", "2200", "3311", "4422", "0013", "1124", "0230", "1341", "2452", "3013", "4124"],
  sus4: ["0013", "1124", "0230", "1341", "2452", "3013", "4124", "0233", "1344", "2200", "3311", "4422"],
  dim: ["2323", "0101", "1212", "2323", "0101", "1212", "2323", "0101", "1212", "2323", "0101", "1212"],
  aug: ["1003", "2110", "3221", "0332", "1003", "2110", "3221", "0332", "1003", "2110", "3221", "0332"],
};

// Guitar shapes (low E to high E, x = not played) as printed in common chord charts: open chords where they
// exist, otherwise the E-shape or A-shape barre. null = found by the search below.
const GUITAR_SHAPES = {
  "": ["x32010", "x46664", "xx0232", "x68886", "022100", "133211", "244322", "320003", "466544", "x02220", "x13331", "x24442"],
  m: ["x35543", "x46654", "xx0231", "x68876", "022000", "133111", "244222", "355333", "466444", "x02210", "x13321", "x24432"],
  "7": ["x32310", "x46464", "xx0212", "x68686", "020100", "131211", "242322", "320001", "464544", "x02020", "x13131", "x21202"],
  m7: ["x35343", "x46454", "xx0211", "x68676", "020000", "131111", "242222", "353333", "464444", "x02010", "x13121", "x20202"],
  maj7: ["x32000", "x46564", "xx0222", "x68786", "021100", "xx3210", "xx4321", "320002", "xx6543", "x02120", "x13231", "x24342"],
  "6": ["x32210", null, "xx0202", null, "022120", null, null, "320000", null, "x02222", null, null],
  m6: [null, null, "xx0201", null, "022020", null, null, null, null, "x02212", null, null],
  sus2: ["x30013", null, "xx0230", null, null, null, null, "300033", null, "x02200", null, "x24422"],
  sus4: ["x33011", null, "xx0233", null, "022200", "133311", null, "330013", null, "x02230", "x13341", "x24452"],
  "7sus4": [null, null, "xx0213", null, "020200", null, null, "330011", null, "x02030", null, null],
  aug: ["x32110", null, null, null, null, null, null, null, null, null, null, null],
  add9: ["x32030", null, null, null, "024100", null, null, "320203", null, "x02420", null, null],
};

export function normalizeAccidental(s) {
  return s.replace(/♯/g, "#").replace(/♭/g, "b");
}

// "C#m7/G#" -> {root: 1, quality: "m7", bass: 8, rootName: "C#", text}; returns null for unknown names
export function parseChord(name) {
  if (!name) return null;
  const s = normalizeAccidental(String(name).trim());
  const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(s);
  if (!m) return null;
  let pc = LETTER_PC[m[1]];
  if (m[2] === "#") pc += 1;
  if (m[2] === "b") pc -= 1;
  pc = (pc + 12) % 12;
  const quality = QUALITY_ALIASES[m[3]] ?? QUALITY_ALIASES[m[3].replace(/[()]/g, "")];
  if (quality === undefined) return null;
  let bass = null;
  if (m[4]) {
    const bm = /^([A-G])([#b]?)$/.exec(m[4]);
    bass = (LETTER_PC[bm[1]] + (bm[2] === "#" ? 1 : bm[2] === "b" ? -1 : 0) + 12) % 12;
  }
  return { root: pc, quality, bass, rootName: m[1] + m[2], flat: m[2] === "b", text: s };
}

export function chordName(root, quality, useFlats = false, bass = null) {
  const names = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  return names[(root + 120) % 12] + quality + (bass === null ? "" : "/" + names[(bass + 120) % 12]);
}

export function transposeChord(name, semis) {
  const c = parseChord(name);
  if (!c) return name;
  return chordName(c.root + semis, c.quality, c.flat, c.bass === null ? null : c.bass + semis);
}

function shapePitchClasses(frets, tuning) {
  return frets.map((f, i) => (f < 0 ? null : (tuning[i] + f) % 12));
}

// bass: pitch class the lowest string must play (slash chords on the guitar); it may be outside the chord
export function shapeFitsChord(frets, root, quality, tuning = TUNINGS.standard.strings, bass = null) {
  const q = QUALITIES[quality];
  if (!q) return false;
  const tones = new Set(q.iv.map((x) => (root + x) % 12));
  if (bass !== null) tones.add(bass);
  const pcs = shapePitchClasses(frets, tuning).filter((x) => x !== null);
  if (pcs.some((p) => !tones.has(p))) return false;
  const have = new Set(pcs);
  return q.essential.every((x) => have.has((root + x) % 12));
}

// pitch class of the lowest sounding string, or null when nothing sounds
export function lowestPc(frets, tuning) {
  let best = null;
  frets.forEach((f, i) => { if (f >= 0 && (best === null || tuning[i] + f < best)) best = tuning[i] + f; });
  return best === null ? null : best % 12;
}

// Search a playable shape when no standard shape is listed (or the tuning is not standard).
function generateShape(root, quality, tuning, bass = null) {
  return tuning.length === 4 ? generateUke(root, quality, tuning) : generateGuitar(root, quality, tuning, bass);
}

// Guitar: the lowest sounding note is the root (or the slash bass); strings left out only at the low end
// (x32010) and at most the top string; at least 4 strings sound; one hand (a barre counts as one finger).
function generateGuitar(root, quality, tuning, bass) {
  const q = QUALITIES[quality];
  const tones = new Set(q.iv.map((x) => (root + x) % 12));
  if (bass !== null) tones.add(bass);
  const low = bass ?? root;
  const n = tuning.length;
  let best = null;
  for (let base = 1; base <= 12; base++) {
    const opts = tuning.map((open) => {
      const o = [-1];
      for (const f of [0, base, base + 1, base + 2, base + 3]) if (tones.has((open + f) % 12) && !o.includes(f)) o.push(f);
      return o;
    });
    const frets = new Array(n);
    const walk = (i) => {
      if (i < n) { for (const f of opts[i]) { frets[i] = f; walk(i + 1); } return; }
      let a = 0; while (a < n && frets[a] < 0) a++;
      let b = n - 1; while (b > a && frets[b] < 0) b--;
      if (n - b - 1 > 1 || b - a + 1 < 4) return;
      for (let k = a; k <= b; k++) if (frets[k] < 0) return;
      if (lowestPc(frets, tuning) !== low) return;
      if (!shapeFitsChord(frets, root, quality, tuning, bass)) return;
      const pressed = frets.filter((f) => f > 0);
      const lo = pressed.length ? Math.min(...pressed) : 0;
      const hi = pressed.length ? Math.max(...pressed) : 0;
      if (hi - lo > 3) return;
      const fg = assignFingers(frets);
      if (!fg) return;
      const sounding = b - a + 1;
      const cost = pressed.reduce((s, f) => s + f, 0) * 0.12 + (hi - lo) * 0.7 + new Set(fg.fingers.filter((x) => x)).size * 0.5 +
        lo * 0.5 + (fg.barre ? 1.2 : 0) + (n - sounding) * 0.45;
      if (!best || cost < best.cost) best = { frets: frets.slice(), cost };
    };
    walk(0);
  }
  return best ? best.frets : null;
}

// Ukulele: all four strings play.
function generateUke(root, quality, tuning) {
  const q = QUALITIES[quality];
  const tones = new Set(q.iv.map((x) => (root + x) % 12));
  let best = null;
  for (let base = 1; base <= 10; base++) {
    const opts = tuning.map((open) => {
      const o = [];
      for (const f of [0, base, base + 1, base + 2, base + 3]) if (tones.has((open + f) % 12) && !o.includes(f)) o.push(f);
      return o;
    });
    for (const a of opts[0]) for (const b of opts[1]) for (const c of opts[2]) for (const d of opts[3]) {
      const frets = [a, b, c, d];
      if (!shapeFitsChord(frets, root, quality, tuning)) continue;
      const pressed = frets.filter((f) => f > 0);
      const lo = pressed.length ? Math.min(...pressed) : 0;
      const hi = pressed.length ? Math.max(...pressed) : 0;
      if (hi - lo > 3) continue;
      if (!assignFingers(frets)) continue;
      const cost = pressed.reduce((s, f) => s + f, 0) * 0.35 + (hi - lo) * 0.8 + pressed.length * 0.4 + lo * 0.6;
      if (!best || cost < best.cost) best = { frets, cost };
    }
  }
  return best ? best.frets : null;
}

// Finger numbers (1 = index .. 4 = pinky) for a shape, plus an optional barre.
// Returns {fingers:[f|0 per string], barre:{fret, from, to}|null} or null when the shape needs more than 4 fingers.
export function assignFingers(frets) {
  const pressed = frets.map((f, s) => ({ s, f })).filter((x) => x.f > 0);
  const fingers = frets.map(() => 0);
  if (pressed.length === 0) return { fingers, barre: null };
  if (pressed.length === 1) {
    const p = pressed[0];
    fingers[p.s] = p.f <= 4 ? p.f : 1;
    return { fingers, barre: null };
  }
  const lo = Math.min(...pressed.map((p) => p.f));
  const atLo = pressed.filter((p) => p.f === lo);
  let barre = null;
  let rest = pressed;
  let prev = 0;
  // ukulele: all four strings fretted; guitar: more than four fretted notes
  if ((frets.length === 4 ? pressed.length === 4 : pressed.length > 4) && atLo.length >= 2) {
    // index finger lies across the strings from the first to the last string fretted at the lowest fret
    const from = Math.min(...atLo.map((p) => p.s));
    const to = Math.max(...atLo.map((p) => p.s));
    // every string under the barre sounds at the barre fret or higher (an open or silent string there cannot)
    for (let k = from; k <= to; k++) if (frets[k] < lo) return null;
    barre = { fret: lo, from, to };
    for (const p of atLo) fingers[p.s] = 1;
    rest = pressed.filter((p) => p.f !== lo);
    prev = 1;
  }
  rest = [...rest].sort((x, y) => x.f - y.f || x.s - y.s);
  for (const p of rest) {
    const fg = Math.max(prev + 1, p.f - lo + 1);
    fingers[p.s] = fg;
    prev = fg;
  }
  if (prev > 4) {
    // too wide for the fret-distance rule: fall back to plain order
    let k = barre ? 1 : 0;
    for (const p of rest) fingers[p.s] = ++k;
    if (k > 4) return null;
  }
  return { fingers, barre };
}

const shapeCache = new Map();

// Shape for a chord name on a tuning: {frets, fingers, barre, name} or null.
// custom: optional map name -> "frets string" that overrides the built-in table.
export function chordShape(name, tuningName = "standard", custom = null) {
  const key = `${tuningName}|${name}|${custom && custom[name] ? custom[name] : ""}`;
  if (shapeCache.has(key)) return shapeCache.get(key);
  let res = null;
  const c = parseChord(name);
  if (c) {
    const tun = tuningOf(tuningName);
    const tuning = tun.strings;
    const guitar = tun.inst === "guitar";
    const table = guitar ? GUITAR_SHAPES : UKE_SHAPES;
    // a slash chord on the guitar plays its bass note on the lowest string; the ukulele leaves the bass out
    const bass = guitar && c.bass !== null && c.bass !== c.root ? c.bass : null;
    let frets = null;
    if (custom && custom[name]) frets = parseFrets(custom[name], tuning.length);
    // the tables are written for High-G and guitar standard tuning; Low-G only changes the G string's octave,
    // other tunings keep a table shape only if it still fits
    if (!frets && bass !== null) frets = generateShape(c.root, c.quality, tuning, bass);
    if (!frets && table[c.quality] && table[c.quality][c.root]) frets = parseFrets(table[c.quality][c.root], tuning.length);
    if (frets && !shapeFitsChord(frets, c.root, c.quality, tuning, bass) && !(custom && custom[name])) frets = null;
    if (!frets) frets = generateShape(c.root, c.quality, tuning);
    if (frets) {
      const fg = assignFingers(frets);
      res = { name, frets, fingers: fg ? fg.fingers : frets.map(() => 0), barre: fg ? fg.barre : null };
    }
  }
  shapeCache.set(key, res);
  return res;
}

export function parseFrets(s, n = 4) {
  if (Array.isArray(s)) return s.length === n ? s.slice() : null;
  const t = String(s).trim();
  const parts = t.includes(" ") || t.includes(",") ? t.split(/[\s,]+/) : t.split("");
  if (parts.length !== n) return null;
  return parts.map((p) => (p === "x" || p === "X" ? -1 : parseInt(p, 10)));
}

// Rough difficulty used to suggest an easier key: fretted notes, span, barre (a wider one is harder),
// high position, strings left out.
export function shapeDifficulty(shape) {
  if (!shape) return 6;
  const pressed = shape.frets.filter((f) => f > 0);
  const lo = pressed.length ? Math.min(...pressed) : 0;
  const hi = pressed.length ? Math.max(...pressed) : 0;
  const barre = shape.barre ? 1.5 + Math.max(0, shape.barre.to - shape.barre.from + 1 - 4) * 0.75 : 0;
  return pressed.length * 0.6 + (hi - lo) * 0.5 + barre + Math.max(0, lo - 2) * 0.7 + shape.frets.filter((f) => f < 0).length * 0.2;
}

// ---------------------------------------------------------------- capo and spelling for another key

// Major key whose scale holds the most chord roots.
function guessKey(names) {
  const w = new Array(12).fill(0);
  for (const nm of names) { const c = parseChord(nm); if (c) w[c.root] += 1; }
  let best = 0, bv = -1;
  for (let k = 0; k < 12; k++) {
    const v = [0, 2, 4, 5, 7, 9, 11].reduce((a, x) => a + w[(k + x) % 12], 0) + w[k] * 0.5;
    if (v > bv) { bv = v; best = k; }
  }
  return best;
}

// Returns a function that spells a chord the way charts in the key of these chords do: sharps in G D A E B F#,
// flats in F Bb Eb Ab Db, and in C the usual C# Eb F# Ab Bb.
export function speller(names) {
  const k = guessKey(names);
  const n12 = [7, 2, 9, 4, 11, 6].includes(k) ? NOTE_NAMES_SHARP
    : [5, 10, 3, 8, 1].includes(k) ? NOTE_NAMES_FLAT
      : ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  return (nm) => {
    const c = parseChord(nm);
    if (!c) return nm;
    const q = /^([A-G][#b]?)([^/]*)/.exec(c.text)[2];
    return n12[c.root] + q + (c.bass === null ? "" : "/" + n12[c.bass]);
  };
}

// Capo positions (0..maxCapo) ranked by how easy the chord shapes become while the sound stays the same.
// sounding: chord names as they sound (one entry per chord played, so frequent chords weigh more).
export function capoChoices(sounding, tuningName, maxCapo = 7) {
  const counts = new Map();
  for (const nm of sounding) if (nm !== "N.C." && parseChord(nm)) counts.set(nm, (counts.get(nm) || 0) + 1);
  const out = [];
  for (let cp = 0; cp <= maxCapo; cp++) {
    let d = 0;
    for (const [nm, k] of counts) d += shapeDifficulty(chordShape(transposeChord(nm, -cp), tuningName)) * (1 + Math.log2(k) * 0.3);
    // a high capo changes the sound of the instrument; prefer a low one when the shapes are about as easy
    out.push({ capo: cp, cost: d + cp * 0.35 + Math.max(0, cp - 4) * 0.8 });
  }
  return out.sort((a, b) => a.cost - b.cost);
}
