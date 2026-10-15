// Instruments and their tunings. The ukulele, guitar and otamatone sites run the same code; js/site.js says which
// instrument the page is for. Every tuning name is unique across instruments, so a score's tuning also tells
// which instrument it was written for.
//   strings: open-string MIDI pitches, string 0 first (ukulele G C E A, guitar low E A D G B high E)
//   names: string letters in the same order

import { SITE } from "./site.js";

export const TUNINGS = {
  standard: { name: "standard", inst: "ukulele", label: "High-G (G4 C4 E4 A4)", short: "High-G", strings: [67, 60, 64, 69], names: ["G", "C", "E", "A"] },
  "low-g": { name: "low-g", inst: "ukulele", label: "Low-G (G3 C4 E4 A4)", short: "Low-G", strings: [55, 60, 64, 69], names: ["G", "C", "E", "A"] },
  guitar: { name: "guitar", inst: "guitar", label: "표준 (E2 A2 D3 G3 B3 E4)", short: "표준 튜닝", strings: [40, 45, 50, 55, 59, 64], names: ["E", "A", "D", "G", "B", "e"] },
  "guitar-drop-d": { name: "guitar-drop-d", inst: "guitar", label: "Drop D (D2 A2 D3 G3 B3 E4)", short: "Drop D", strings: [38, 45, 50, 55, 59, 64], names: ["D", "A", "D", "G", "B", "e"] },
  // the otamatone has one stem and no frets: a note is its pitch above the lowest one SPRED writes (E3), so
  // "fret" n is E3 + n semitones, up to C#6 (SPRED's otamatone-basic range)
  otamatone: { name: "otamatone", inst: "otamatone", label: "오타마톤 (E3~C#6)", short: "오타마톤", strings: [52], names: ["음"] },
};

//   prefix: start of this site's localStorage keys (both sites share one web origin)
//   melodyCenter: MIDI pitch (above the capo) the melody tab is placed around; the guitar plays a sung melody
//   an octave below the singer, as guitar music is written; strumGap: seconds between strings in a strum
//   common: chords the game mode also listens for, so a wrong chord outside the song scores lower
//   progressions: chord choices in 스트럼 연습 (one chord per bar)
//   roll: melody only, shown as pitch rows like SPRED (no chords to play, no TAB); chordTuning: the chords a
//   sheet may still have are played as backing on this tuning's shapes
//   url: the site's address next to the other sites
//   stem: how far apart the notes are on the instrument, as SPRED draws it (rows of `row` px, gaps[m] px more
//   between note m and m + 1); a sheet from SPRED brings its own (score.stem)
export const INSTRUMENTS = {
  ukulele: {
    id: "ukulele", name: "우쿨렐레", title: "우쿨렐레 코드 악보", prefix: "uketab", defaultTuning: "standard", url: "../ukulele-tab/",
    fileExt: ".uke.json", melodyCenter: 70, maxFret: 15, strumGap: 0.012, nylon: true,
    common: ["C", "G", "Am", "F", "D", "Em", "G7", "Dm", "A", "E7"],
    progressions: [
      { id: "C", label: "C", chords: ["C"] },
      { id: "Am", label: "Am", chords: ["Am"] },
      { id: "F", label: "F", chords: ["F"] },
      { id: "G", label: "G", chords: ["G"] },
      { id: "C-Am-F-G", label: "C → Am → F → G", chords: ["C", "Am", "F", "G"] },
      { id: "C-G-Am-F", label: "C → G → Am → F", chords: ["C", "G", "Am", "F"] },
      { id: "F-G-Em-Am", label: "F → G → Em → Am", chords: ["F", "G", "Em", "Am"] },
      { id: "G-Em-C-D", label: "G → Em → C → D", chords: ["G", "Em", "C", "D"] },
    ],
  },
  guitar: {
    id: "guitar", name: "기타", title: "기타 코드 악보", prefix: "guitartab", defaultTuning: "guitar", url: "../guitar-tab/",
    fileExt: ".guitar.json", melodyCenter: 60, maxFret: 17, strumGap: 0.009, nylon: false,
    common: ["G", "C", "D", "Em", "Am", "E", "A", "Dm", "F", "B7"],
    progressions: [
      { id: "G", label: "G", chords: ["G"] },
      { id: "C", label: "C", chords: ["C"] },
      { id: "D", label: "D", chords: ["D"] },
      { id: "Em", label: "Em", chords: ["Em"] },
      { id: "Am", label: "Am", chords: ["Am"] },
      { id: "G-C-D", label: "G → C → D", chords: ["G", "C", "D"] },
      { id: "G-Em-C-D", label: "G → Em → C → D", chords: ["G", "Em", "C", "D"] },
      { id: "C-G-Am-F", label: "C → G → Am → F", chords: ["C", "G", "Am", "F"] },
      { id: "Am-F-C-G", label: "Am → F → C → G", chords: ["Am", "F", "C", "G"] },
      { id: "E-A-B7", label: "E → A → B7", chords: ["E", "A", "B7"] },
    ],
  },
  otamatone: {
    id: "otamatone", name: "오타마톤", title: "오타마톤 악보", prefix: "otatab", defaultTuning: "otamatone", url: "../otamatone-tab/",
    fileExt: ".ota.json", melodyCenter: 67, maxFret: 33, strumGap: 0.012, nylon: true, roll: true, chordTuning: "standard",
    common: [], progressions: [],
    // the layout of the SPRED maker's sheets (all 36 the same): the finger moves 49-61 px a semitone low on the
    // stem and 9-15 px near the top, so the sheet shows the real distance between two notes
    stem: { row: 7, gaps: { 52: 42, 53: 54, 54: 54, 55: 42, 56: 42, 57: 42, 58: 34, 59: 28, 60: 32, 61: 30, 62: 30, 63: 24,
      64: 22, 65: 22, 66: 20, 67: 18, 68: 14, 69: 14, 70: 14, 71: 12, 72: 14, 73: 14, 74: 10, 75: 6, 76: 8, 77: 6, 78: 8,
      79: 8, 80: 4, 81: 6, 82: 8, 83: 2, 84: 6 } },
  },
};

export const INST = INSTRUMENTS[SITE] || INSTRUMENTS.ukulele;

// tuning by name; an unknown name means this site's usual tuning
export const tuningOf = (name) => TUNINGS[name] || TUNINGS[INST.defaultTuning];
export const instOf = (name) => INSTRUMENTS[tuningOf(name).inst];
export const tuningsOf = (instId) => Object.values(TUNINGS).filter((t) => t.inst === instId);

// localStorage key of this site (the login session and the bridge connection are shared by all sites)
export const skey = (k) => `${INST.prefix}.${k}`;

// where a pitch sits on the stem: SPRED px above E3, a fractional pitch (a heard one) between its two notes;
// outside the stem the nearest step goes on. Without a stem every semitone is one step of 10.
export function stemMap(stem) {
  if (!stem) return (m) => (m - 52) * 10;
  const lo = 52, hi = 85, step = (m) => stem.row + (Number(stem.gaps[m]) || 0), p = [0];
  for (let m = lo; m < hi; m++) p.push(p[p.length - 1] + step(m));
  return (m) => {
    if (m <= lo) return (m - lo) * step(lo);
    if (m >= hi) return p[hi - lo] + (m - hi) * step(hi - 1);
    const i = Math.floor(m) - lo;
    return p[i] + (m - Math.floor(m)) * (p[i + 1] - p[i]);
  };
}
export const stemOf = (score) => (score && score.stem) || INST.stem || null;
