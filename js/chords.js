// Ukulele chord names, shapes (frets per string in G-C-E-A order) and finger numbers.
// Strings are indexed 0..3 = G, C, E, A everywhere in this app.

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

// Standard beginner shapes (G C E A). Checked against chord tones by tests/chords.test.mjs.
const STANDARD = {
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

export const TUNINGS = {
  standard: { name: "standard", label: "표준 (High-G: G4 C4 E4 A4)", strings: [67, 60, 64, 69] },
  "low-g": { name: "low-g", label: "Low-G (G3 C4 E4 A4)", strings: [55, 60, 64, 69] },
};

function shapePitchClasses(frets, tuning) {
  return frets.map((f, i) => (f < 0 ? null : (tuning[i] + f) % 12));
}

export function shapeFitsChord(frets, root, quality, tuning = TUNINGS.standard.strings) {
  const q = QUALITIES[quality];
  if (!q) return false;
  const tones = new Set(q.iv.map((x) => (root + x) % 12));
  const pcs = shapePitchClasses(frets, tuning).filter((x) => x !== null);
  if (pcs.some((p) => !tones.has(p))) return false;
  const have = new Set(pcs);
  return q.essential.every((x) => have.has((root + x) % 12));
}

// Search playable 4-string shapes when no standard shape is listed (or the tuning is not standard).
function generateShape(root, quality, tuning) {
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
  const fingers = [0, 0, 0, 0];
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
  if (pressed.length === 4 && atLo.length >= 2) {
    // index finger lies across the strings from the first to the last string fretted at the lowest fret
    const from = Math.min(...atLo.map((p) => p.s));
    const to = Math.max(...atLo.map((p) => p.s));
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
    const tuning = (TUNINGS[tuningName] || TUNINGS.standard).strings;
    let frets = null;
    if (custom && custom[name]) frets = parseFrets(custom[name]);
    // the standard table is written for High-G; Low-G only changes the G string's octave, so pitch classes stay the same
    if (!frets && STANDARD[c.quality]) frets = parseFrets(STANDARD[c.quality][c.root]);
    if (frets && !shapeFitsChord(frets, c.root, c.quality, tuning) && !(custom && custom[name])) frets = null;
    if (!frets) frets = generateShape(c.root, c.quality, tuning);
    if (frets) {
      const fg = assignFingers(frets);
      res = { name, frets, fingers: fg ? fg.fingers : [0, 0, 0, 0], barre: fg ? fg.barre : null };
    }
  }
  shapeCache.set(key, res);
  return res;
}

export function parseFrets(s) {
  if (Array.isArray(s)) return s.slice(0, 4);
  const t = String(s).trim();
  const parts = t.includes(" ") || t.includes(",") ? t.split(/[\s,]+/) : t.split("");
  if (parts.length !== 4) return null;
  return parts.map((p) => (p === "x" || p === "X" ? -1 : parseInt(p, 10)));
}

// Rough difficulty used to suggest an easier key: fretted notes, span, barre, high position.
export function shapeDifficulty(shape) {
  if (!shape) return 6;
  const pressed = shape.frets.filter((f) => f > 0);
  const lo = pressed.length ? Math.min(...pressed) : 0;
  const hi = pressed.length ? Math.max(...pressed) : 0;
  return pressed.length * 0.6 + (hi - lo) * 0.5 + (shape.barre ? 1.5 : 0) + Math.max(0, lo - 2) * 0.7;
}
