// Score data model ("ukulele-sheet" v1), time map, bars and format conversion.
//
// Time runs in columns (steps). stepsPerBeat columns make one beat.
// Strings are 0..3 = G, C, E, A. A note is {col, len, string, fret}.

import { TUNINGS } from "./chords.js";
import { melodyToTab } from "./fingering.js";

export const FORMAT_NAME = "ukulele-sheet";
export const FORMAT_VERSION = 1;

export function newScore({ title = "새 악보", artist = "", bpm = 100, beats = 4, bars = 16, stepsPerBeat = 4 } = {}) {
  return {
    format: { name: FORMAT_NAME, version: FORMAT_VERSION },
    meta: { title, artist, key: "", arranger: "", comment: "", source: "" },
    tuning: "standard",
    capo: 0,                 // chord shapes and tab frets are relative to the capo
    stepsPerBeat,
    columnCount: bars * beats * stepsPerBeat,
    tempo: [{ col: 0, bpm }],
    meter: [{ col: 0, beats }],
    youtube: { videoId: "", offsetMs: 0 },
    strum: { pattern: "D-DU-UDU" },
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
  if (fname === FORMAT_NAME) return normalizeScore(obj);
  if (fname === "spred-sheet") return fromSpred(obj, opts);
  if (fname === "ukulele-transcription") return fromTranscription(obj, opts);
  throw new Error(`모르는 악보 형식: ${fname || "(format 없음)"}`);
}

export function normalizeScore(o) {
  const s = newScore();
  s.meta = { ...s.meta, ...(o.meta || {}) };
  s.tuning = TUNINGS[o.tuning] ? o.tuning : "standard";
  s.capo = Math.max(0, Math.min(12, int(o.capo, 0)));
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
  s.chords = ev(o.chords, "name");
  s.lyrics = ev(o.lyrics, "text");
  s.tracks = (o.tracks && o.tracks.length ? o.tracks : s.tracks).map((t, i) => ({
    id: String(t.id || `track${i}`),
    name: String(t.name || t.id || `트랙 ${i + 1}`),
    hidden: !!t.hidden,
    muted: !!t.muted,
    notes: (t.notes || []).map((n) => ({
      col: Math.max(0, int(n.col)), len: Math.max(1, int(n.len, 1)),
      string: Math.max(0, Math.min(3, int(n.string))), fret: Math.max(0, Math.min(24, int(n.fret))),
      ...(n.tech ? { tech: String(n.tech) } : {}),
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

export function midiOf(note, tuningName, capo = 0) {
  return (TUNINGS[tuningName] || TUNINGS.standard).strings[note.string] + capo + note.fret;
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

export function fromSpred(o, opts = {}) {
  const md = o.musicData || {};
  const cells = (o.globalLines && o.globalLines.cells) || [];
  const g = (row) => cells.filter((c) => c.rowId === row).map((c) => ({ col: c.col, v: parseFloat(c.rawText) }))
    .filter((c) => Number.isFinite(c.v)).sort((a, b) => a.col - b.col);
  const spbCells = g("global-spb");
  const spb = spbCells.length ? spbCells[0].v : 4;
  const melody = (o.tracks || []).map((t) => ({ id: t.trackId || t.id, name: t.trackName || t.trackId, ...spredNotes(t) }))
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

// Shared path for formats that store melody as MIDI pitches: put the melody on ukulele strings.
function fromPitchData(d, opts) {
  const s = newScore();
  s.meta = { ...s.meta, ...(d.meta || {}) };
  s.tuning = TUNINGS[opts.tuning] ? opts.tuning : "standard";
  s.stepsPerBeat = int(d.stepsPerBeat, 4) || 4;
  s.tempo = d.tempo && d.tempo.length ? d.tempo : [{ col: 0, bpm: 100 }];
  s.meter = d.meter && d.meter.length ? d.meter : [{ col: 0, beats: 4 }];
  s.youtube = { videoId: (d.youtube && d.youtube.videoId) || "", offsetMs: int(d.youtube && d.youtube.offsetMs) };
  s.chords = d.chords || [];
  s.lyrics = d.lyrics || [];
  s.sections = d.sections || [];
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
  const { importReport, ...rest } = score;
  return JSON.stringify(rest, null, 1);
}
