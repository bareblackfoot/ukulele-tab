// Score data model ("ukulele-sheet" v1, also used for the guitar), time map, bars and format conversion.
//
// Time runs in columns (steps). stepsPerBeat columns make one beat.
// The tuning names the instrument (js/instrument.js). Strings count from 0: ukulele G, C, E, A;
// guitar low E .. high E. A note is {col, len, string, fret}.

import { TUNINGS, transposeChord, capoChoices, speller, NOTE_NAMES_SHARP } from "./chords.js";
import { INST, tuningOf, instOf } from "./instrument.js";
import { melodyToTab } from "./fingering.js";

export const FORMAT_NAME = "ukulele-sheet";
export const FORMAT_VERSION = 1;

export function newScore({ title = "새 악보", artist = "", bpm = 100, beats = 4, bars = 16, stepsPerBeat = 4 } = {}) {
  return {
    format: { name: FORMAT_NAME, version: FORMAT_VERSION },
    meta: { title, artist, key: "", arranger: "", comment: "", source: "" },
    tuning: INST.defaultTuning,
    capo: 0,                 // chord shapes and tab frets are relative to the capo
    stepsPerBeat,
    columnCount: bars * beats * stepsPerBeat,
    tempo: [{ col: 0, bpm }],
    meter: [{ col: 0, beats }],
    youtube: { videoId: "", offsetMs: 0 },
    strum: { pattern: "D-DU-UDU" },
    strums: [],              // strum pattern changes [{col, pattern}] (at bar starts); strum.pattern is used before the first
    sections: [],
    chords: [],
    lyrics: [],
    tracks: [{ id: "melody", name: "멜로디", notes: [] }],
    chordShapes: {},
  };
}

const int = (x, d = 0) => (Number.isFinite(Number(x)) ? Math.round(Number(x)) : d);

// Accepts a parsed JSON object of any supported format and returns a clean ukulele-sheet score.
// Throws Error with a Korean message when the file is not usable.
export function loadAnyFormat(obj, opts = {}) {
  if (!obj || typeof obj !== "object") throw new Error("JSON 객체가 아님");
  const fname = obj.format && (obj.format.name || obj.format.formatName);
  let s;
  if (fname === FORMAT_NAME) s = normalizeScore(obj);
  else if (fname === "spred-sheet") s = fromSpred(obj, opts);
  else if (fname === "ukulele-transcription") s = fromTranscription(obj, opts);
  else throw new Error(`모르는 악보 형식: ${fname || "(format 없음)"}`);
  // a sheet written for the other instrument opens moved onto this site's instrument
  if (!opts.keepInstrument && instOf(s.tuning).id !== INST.id) {
    const report = s.importReport;
    s = toInstrument(s, INST.defaultTuning);
    if (report) s.importReport = report;
  }
  return s;
}

export function normalizeScore(o) {
  const s = newScore();
  s.meta = { ...s.meta, ...(o.meta || {}) };
  s.tuning = TUNINGS[o.tuning] ? o.tuning : "standard"; // files from before the guitar site are ukulele sheets
  s.capo = Math.max(0, Math.min(12, int(o.capo, 0)));
  const lastString = tuningOf(s.tuning).strings.length - 1;
  const fretMax = Math.max(24, instOf(s.tuning).maxFret); // the otamatone's one "string" spans E3..C#6
  s.stepsPerBeat = Math.max(1, Math.min(12, int(o.stepsPerBeat, 4)));
  s.tempo = (o.tempo || []).map((t) => ({ col: Math.max(0, int(t.col)), bpm: Number(t.bpm) }))
    .filter((t) => t.bpm >= 10 && t.bpm <= 400);
  if (!s.tempo.length || s.tempo[0].col !== 0) s.tempo.unshift({ col: 0, bpm: s.tempo.length ? s.tempo[0].bpm : 100 });
  s.meter = (o.meter || []).map((m) => ({ col: Math.max(0, int(m.col)), beats: Math.max(1, Math.min(16, int(m.beats, 4))) }));
  if (!s.meter.length || s.meter[0].col !== 0) s.meter.unshift({ col: 0, beats: s.meter.length ? s.meter[0].beats : 4 });
  s.youtube = { videoId: String((o.youtube && o.youtube.videoId) || ""), offsetMs: int(o.youtube && o.youtube.offsetMs) };
  s.strum = { pattern: String((o.strum && o.strum.pattern) || s.strum.pattern) };
  const ev = (arr, key) => (arr || []).filter((e) => e && e[key] !== undefined && String(e[key]).length)
    .map((e) => ({ col: Math.max(0, int(e.col)), [key]: String(e[key]) }));
  s.sections = ev(o.sections, "text");
  s.strums = cleanStrums(o.strums);
  if (Array.isArray(o.strumProfile)) s.strumProfile = cleanProfile(o.strumProfile);
  if (o.strumProfileKind) s.strumProfileKind = o.strumProfileKind === "ukulele" ? "ukulele" : "band";
  s.chords = ev(o.chords, "name");
  s.lyrics = ev(o.lyrics, "text");
  s.tracks = (o.tracks && o.tracks.length ? o.tracks : s.tracks).map((t, i) => ({
    id: String(t.id || `track${i}`),
    name: String(t.name || t.id || `트랙 ${i + 1}`),
    hidden: !!t.hidden,
    muted: !!t.muted,
    ...(t.absolute ? { absolute: true } : {}), // notes at the recording's pitch (a solo taken from it): never moved by octaves
    notes: (t.notes || []).map((n) => ({
      col: Math.max(0, int(n.col)), len: Math.max(1, int(n.len, 1)),
      string: Math.max(0, Math.min(lastString, int(n.string))), fret: Math.max(0, Math.min(fretMax, int(n.fret))),
      ...(n.tech ? { tech: String(n.tech).slice(0, 8) } : {}),
    })),
  }));
  s.chordShapes = o.chordShapes && typeof o.chordShapes === "object" ? { ...o.chordShapes } : {};
  const lastCol = Math.max(0, ...s.chords.map((c) => c.col + 1), ...s.lyrics.map((c) => c.col + 1),
    ...s.tracks.flatMap((t) => t.notes.map((n) => n.col + n.len)));
  s.columnCount = Math.max(int(o.columnCount, 0), lastCol, s.stepsPerBeat * 4);
  sortScore(s);
  return s;
}

export function sortScore(s) {
  const byCol = (a, b) => a.col - b.col;
  s.tempo.sort(byCol); s.meter.sort(byCol); s.sections.sort(byCol); s.chords.sort(byCol); s.lyrics.sort(byCol);
  (s.strums || (s.strums = [])).sort(byCol);
  for (const t of s.tracks) t.notes.sort((a, b) => a.col - b.col || b.string - a.string);
}

// ---------------------------------------------------------------- time map

export class TimeMap {
  constructor(score) {
    this.spb = score.stepsPerBeat;
    const ev = [...score.tempo].sort((a, b) => a.col - b.col);
    this.segs = []; // {col, t, secPerCol}
    let t = 0;
    for (let i = 0; i < ev.length; i++) {
      const spc = 60 / ev[i].bpm / this.spb;
      if (i > 0) t += (ev[i].col - ev[i - 1].col) * this.segs[i - 1].secPerCol;
      this.segs.push({ col: ev[i].col, t, secPerCol: spc, bpm: ev[i].bpm });
    }
  }
  segForCol(col) {
    let lo = 0, hi = this.segs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.segs[m].col <= col) lo = m; else hi = m - 1; }
    return this.segs[lo];
  }
  segForTime(t) {
    let lo = 0, hi = this.segs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.segs[m].t <= t) lo = m; else hi = m - 1; }
    return this.segs[lo];
  }
  colToTime(col) { const s = this.segForCol(col); return s.t + (col - s.col) * s.secPerCol; }
  timeToCol(t) { const s = this.segForTime(t); return s.col + (t - s.t) / s.secPerCol; }
  bpmAt(col) { return this.segForCol(col).bpm; }
}

// Bars: [{index, start, len, beats}] covering 0..columnCount. A meter event always starts a new bar.
export function computeBars(score) {
  const spb = score.stepsPerBeat;
  const meters = [...score.meter].sort((a, b) => a.col - b.col);
  const bars = [];
  let col = 0, mi = 0;
  while (col < score.columnCount) {
    while (mi + 1 < meters.length && meters[mi + 1].col <= col) mi++;
    let len = meters[mi].beats * spb;
    const next = meters[mi + 1];
    if (next && next.col > col && next.col < col + len) len = next.col - col;
    bars.push({ index: bars.length, start: col, len, beats: len / spb });
    col += len;
  }
  return bars;
}

export function barAt(bars, col) {
  let lo = 0, hi = bars.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m].start <= col) lo = m; else hi = m - 1; }
  return bars[lo];
}

// chord active at col (last chord at or before col), and the index into score.chords
export const cleanPattern = (p) => String(p || "").toUpperCase().replace(/[^DUX-]/g, "").slice(0, 32);

function cleanStrums(arr) {
  return (arr || []).map((e) => ({ col: Math.max(0, int(e && e.col)), pattern: cleanPattern(e && e.pattern) })).filter((e) => e.pattern);
}

// per bar, how strongly the recording's accompaniment starts a sound on each 8th (0..1); used to suggest patterns
const cleanProfile = (arr) => arr.map((b) => (Array.isArray(b) ? b.slice(0, 24).map((v) => Math.max(0, Math.min(1, Number(v) || 0))) : []));

// strum pattern in force at a column (8th-note slots counted from the bar start)
export function strumAt(score, col) {
  let p = score.strum.pattern;
  for (const e of score.strums || []) { if (e.col <= col) p = e.pattern; else break; }
  return p;
}

export function chordIndexAt(score, col) {
  const cs = score.chords;
  let lo = 0, hi = cs.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cs[m].col <= col) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

export function distinctChords(score) {
  const seen = [];
  for (const c of score.chords) if (!seen.includes(c.name)) seen.push(c.name);
  return seen;
}

// Playing marks (note.tech): "b1"/"b2" bend up 1 or 2 semitones, "v" vibrato, "h" hammer-on, "p" pull-off,
// "s" slide from the note before. TAB text: "7b9" (bend from fret 7 until it sounds like fret 9), "7~", "h7",
// "p5", "/9" or "\5" (slide up or down into the fret).
export const TECHS = ["b1", "b2", "v", "h", "p", "s"];
export function tabLabel(n, prev = null) {
  const t = n.tech || "";
  if (t === "h" || t === "p") return t + n.fret;
  if (t === "s") return (prev && prev.fret > n.fret ? "\\" : "/") + n.fret;
  if (t[0] === "b") return `${n.fret}b${n.fret + (+t.slice(1) || 1)}`;
  if (t === "v") return `${n.fret}~`;
  return String(n.fret);
}

// MIDI pitch -> name as SPRED writes it ("C#4")
export const pitchName = (m) => `${NOTE_NAMES_SHARP[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

export function midiOf(note, tuningName, capo = 0) {
  return tuningOf(tuningName).strings[note.string] + capo + note.fret;
}

// Same sound on another tuning or capo, plus an optional transposition k (semitones): chord shapes move by
// the capo change, the melody is placed again on the new strings (octave chosen when octave is null).
// Changes s in place.
export function retune(s, newTuning, newCapo, k = 0, octave = 0) {
  const oldCapo = s.capo || 0;
  const shapeShift = k - (newCapo - oldCapo);
  for (const t of s.tracks) {
    const mel = t.notes.map((n) => ({ col: n.col, len: n.len, midi: midiOf(n, s.tuning, oldCapo) + k - newCapo, tech: n.tech }));
    t.notes = melodyToTab(mel, newTuning, t.absolute ? 0 : octave, t.absolute ? { lead: true } : {}).notes;
  }
  if (shapeShift) {
    const moved = s.chords.map((c) => (c.name === "N.C." ? c.name : transposeChord(c.name, shapeShift)));
    const spell = speller(moved);
    s.chords = s.chords.map((c, i) => ({ ...c, name: c.name === "N.C." ? c.name : spell(moved[i]) }));
  }
  if (k && s.meta.key) s.meta.key = transposeChord(s.meta.key, k);
  if (instOf(newTuning).id !== instOf(s.tuning).id) s.chordShapes = {}; // own shapes are for one instrument
  s.tuning = newTuning;
  s.capo = newCapo;
  return s;
}

// A copy of the score for another instrument (named by its tuning): same sound, the capo where its chord
// shapes are easiest (or the given capo), the melody placed again on its strings.
export function toInstrument(score, tuning, fixedCapo = null) {
  const s = JSON.parse(JSON.stringify(score));
  delete s.importReport;
  const from = instOf(s.tuning);
  const sounding = s.chords.filter((c) => c.name !== "N.C.").map((c) => transposeChord(c.name, s.capo || 0));
  // a melody-only instrument has no chord shapes to make easy: no capo
  const capo = fixedCapo ?? (sounding.length && !instOf(tuning).roll ? capoChoices(sounding, tuning)[0].capo : 0);
  retune(s, tuning, capo, 0, null);
  // the key text names the shapes of the old capo ("Gb (카포 6, C 운지)"): write it for the new one
  const key = (s.meta.key || "").replace(/\s*\(.*\)\s*$/, "").trim();
  if (key) {
    const shapes = speller(s.chords.map((c) => c.name).filter((n) => n !== "N.C."))(transposeChord(key, -capo));
    s.meta.key = capo ? `${key} (카포 ${capo}, ${shapes} 운지)` : /카포 없음/.test(s.meta.key) ? `${key} (카포 없음)` : key;
  }
  const out = normalizeScore(s);
  out.converted = { from: from.id, capo };
  return out;
}

// ---------------------------------------------------------------- imports

// a note cell starts with its name; marks may follow ("E4+@m(..)", "B4@g(..)")
const NOTE_RE = /^([A-G])(#?)(-?\d)/;
const isHold = (t) => t !== undefined && (t[0] === "-" || t[0] === "~"); // "-" hold, "~" hold with vibrato, marks may follow
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function spredNotes(track) {
  // SPRED cells: rowId "s1-note-<midi>", rawText "E4" starts a note, "-" continues it on the same row
  const rows = new Map();
  for (const c of track.cells || []) {
    const m = /^s\d+-note-(\d+)$/.exec(c.rowId || "");
    if (!m) continue;
    if (!rows.has(c.rowId)) rows.set(c.rowId, { midi: +m[1], cols: new Map() });
    rows.get(c.rowId).cols.set(c.col, String(c.rawText));
  }
  const out = [];
  let skipped = 0;
  for (const { midi, cols } of rows.values()) {
    for (const [col, raw] of cols) {
      if (raw.startsWith("//")) continue; // a comment, not a note
      const txt = raw.replace(/^\/\d+\(/, ""); // tuplet group "/3(...)": read the note inside on this cell
      if (isHold(txt)) continue;
      const nm = NOTE_RE.exec(txt);
      if (!nm) { if (/[A-G]#?-?\d/.test(txt)) skipped++; continue; } // only count cells that look like a note
      const m2 = (parseInt(nm[3], 10) + 1) * 12 + PC[nm[1]] + (nm[2] ? 1 : 0);
      let len = 1;
      while (isHold((cols.get(col + len) || "").replace(/^\/\d+\(/, "") || undefined)) len++;
      out.push({ col, len, midi: Number.isFinite(m2) ? m2 : midi });
    }
  }
  out.sort((a, b) => a.col - b.col || b.midi - a.midi);
  return { notes: out, skipped };
}

// what SPRED's three tracks hold (the maker's sheets): the sung melody, the instrument line of the intro and
// interludes, short runs that lead into a section
const SPRED_TRACK = { basic: "노래 멜로디 (basic)", optional: "반주 멜로디 (optional)", extra: "덧붙인 음 (extra)" };

export function fromSpred(o, opts = {}) {
  // SPRED is an otamatone app: on the otamatone site its notes keep their pitch
  if (INST.roll && opts.octaveShift === undefined) opts = { ...opts, octaveShift: 0 };
  const md = o.musicData || {};
  const cells = (o.globalLines && o.globalLines.cells) || [];
  const g = (row) => cells.filter((c) => c.rowId === row).map((c) => ({ col: c.col, v: parseFloat(c.rawText) }))
    .filter((c) => Number.isFinite(c.v)).sort((a, b) => a.col - b.col);
  const spbCells = g("global-spb");
  const spb = spbCells.length ? spbCells[0].v : 4;
  const melody = (o.tracks || []).map((t) => ({ id: t.trackId || t.id, name: SPRED_TRACK[t.trackName] || t.trackName || t.trackId, ...spredNotes(t) }))
    .filter((t) => t.notes.length);
  return fromPitchData({
    meta: { title: (md.musicTitle || "").trim(), artist: md.musicArtist || "", comment: md.comment || "",
      source: "SPRED 악보에서 가져옴" + (md.scoreWriter ? ` (원 악보: ${md.scoreWriter})` : "") },
    stepsPerBeat: spb,
    columnCount: (o.globalLines && o.globalLines.columnCount) || 0,
    tempo: g("global-bpm").map((c) => ({ col: c.col, bpm: c.v })),
    meter: g("global-bpb").map((c) => ({ col: c.col, beats: c.v })),
    youtube: md.youtube || {},
    chords: [], lyrics: [], sections: [],
    melody,
  }, opts);
}

export function fromTranscription(o, opts = {}) {
  return fromPitchData({ ...o, melody: o.melody || [] }, opts);
}

// Shared path for formats that store melody as MIDI pitches: put the melody on the instrument's strings.
function fromPitchData(d, opts) {
  const s = newScore();
  s.meta = { ...s.meta, ...(d.meta || {}) };
  s.tuning = TUNINGS[opts.tuning] ? opts.tuning : INST.defaultTuning;
  s.stepsPerBeat = int(d.stepsPerBeat, 4) || 4;
  s.tempo = d.tempo && d.tempo.length ? d.tempo : [{ col: 0, bpm: 100 }];
  s.meter = d.meter && d.meter.length ? d.meter : [{ col: 0, beats: 4 }];
  s.youtube = { videoId: (d.youtube && d.youtube.videoId) || "", offsetMs: int(d.youtube && d.youtube.offsetMs) };
  s.chords = d.chords || [];
  s.lyrics = d.lyrics || [];
  s.sections = d.sections || [];
  if (d.strum && d.strum.pattern) s.strum = { pattern: String(d.strum.pattern) };
  s.strums = cleanStrums(d.strums);
  if (Array.isArray(d.strumProfile)) s.strumProfile = cleanProfile(d.strumProfile);
  if (d.strumProfileKind) s.strumProfileKind = d.strumProfileKind === "ukulele" ? "ukulele" : "band";
  const report = [];
  s.tracks = (d.melody || []).map((t, i) => {
    const capo = Math.max(0, Math.min(12, int(d.capo ?? opts.capo, 0)));
    s.capo = capo;
    const res = melodyToTab(t.notes.map((n) => ({ col: n.col, len: n.len, midi: n.midi - capo })), s.tuning, opts.octaveShift);
    report.push({ track: t.name || t.id, shift: res.shift, folded: res.folded, notes: res.notes.length, skipped: t.skipped || 0 });
    return { id: String(t.id || `track${i}`), name: String(t.name || t.id || `트랙 ${i + 1}`), notes: res.notes };
  });
  if (!s.tracks.length) s.tracks = [{ id: "melody", name: "멜로디", notes: [] }];
  s.columnCount = int(d.columnCount, 0);
  const out = normalizeScore(s);
  out.importReport = report;
  return out;
}

export function toJSON(score) {
  const { importReport, converted, ...rest } = score;
  return JSON.stringify(rest, null, 1);
}
