// Instruments and their tunings. The ukulele site and the guitar site run the same code; js/site.js says which
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
};

//   prefix: start of this site's localStorage keys (both sites share one web origin)
//   melodyCenter: MIDI pitch (above the capo) the melody tab is placed around; the guitar plays a sung melody
//   an octave below the singer, as guitar music is written; strumGap: seconds between strings in a strum
//   common: chords the game mode also listens for, so a wrong chord outside the song scores lower
//   progressions: chord choices in 스트럼 연습 (one chord per bar)
export const INSTRUMENTS = {
  ukulele: {
    id: "ukulele", name: "우쿨렐레", title: "우쿨렐레 코드 악보", prefix: "uketab", defaultTuning: "standard",
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
    id: "guitar", name: "기타", title: "기타 코드 악보", prefix: "guitartab", defaultTuning: "guitar",
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
};

export const INST = INSTRUMENTS[SITE] || INSTRUMENTS.ukulele;

// tuning by name; an unknown name means this site's usual tuning
export const tuningOf = (name) => TUNINGS[name] || TUNINGS[INST.defaultTuning];
export const instOf = (name) => INSTRUMENTS[tuningOf(name).inst];
export const tuningsOf = (instId) => Object.values(TUNINGS).filter((t) => t.inst === instId);

// localStorage key of this site (the login session and the bridge connection are shared by both sites)
export const skey = (k) => `${INST.prefix}.${k}`;
