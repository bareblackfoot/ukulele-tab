// Strum patterns for a sheet, and a suggestion for every bar.
// score.strumProfile (from the recording): per bar, how strongly the accompaniment starts a sound on each 8th, 0..1.
//  - a ukulele playing alone (score.strumProfileKind "ukulele"): those are the strums, so the closest pattern wins
//  - a band: drums and guitars do not show the ukulele strum, so calypso stays the pattern and only clearly quieter
//    bars (fewer strums) or loud busy bars (8ths) get another one
// Without a profile the bar's meter, tempo and melody decide. Neighbouring bars keep the same pattern unless a
// 4-bar phrase starts or the recording clearly changes.

import { STRUMS } from "./strums.js";
import { computeBars, chordIndexAt, TimeMap } from "./model.js";

// 8th-note patterns the sheet can play, simplest first (score notation: D down, U up, X chuck, - none)
export const SHEET_STRUMS = [
  { slots: "D-------", name: "한 번 (마디 첫 박만)" },
  { slots: "D---D---", name: "다운 2번 (1·3박)" },
  ...STRUMS.filter((p) => p.sub === 2 && !p.swing && p.beats === 4).map((p) => ({ slots: p.slots, name: p.name })),
  { slots: "--------", name: "치지 않음" },
  // 3/4 bars
  { slots: "D-----", name: "한 번 (3/4)", beats: 3 },
  { slots: "D-D-D-", name: "다운 3번 (3/4)", beats: 3 },
  ...STRUMS.filter((p) => p.sub === 2 && !p.swing && p.beats === 3).map((p) => ({ slots: p.slots, name: p.name, beats: 3 })),
];

export function strumName(slots) {
  const p = SHEET_STRUMS.find((x) => x.slots === slots);
  return p ? p.name : slots;
}

const W = { D: 1, U: 0.6, X: 0.8, "-": 0 };
const strokes = (slots) => [...slots].filter((c) => c !== "-").length;

function fitScore(slots, prof) {
  // cosine between where the pattern strikes and where the recording starts sounds, minus a little for busy patterns
  let dot = 0, a = 0, b = 0;
  for (let i = 0; i < prof.length; i++) {
    const w = W[slots[i % slots.length]] || 0;
    dot += w * prof[i]; a += w * w; b += prof[i] * prof[i];
  }
  if (!a || !b) return -1;
  return dot / Math.sqrt(a * b) - 0.015 * strokes(slots);
}

// returns {base, perBar: [slots per bar], source: "recording" | "sheet"}
export function recommendStrums(score) {
  const bars = computeBars(score);
  const tm = new TimeMap(score);
  const spb = score.stepsPerBeat;
  const prof = Array.isArray(score.strumProfile) && score.strumProfile.length >= bars.length * 0.8 ? score.strumProfile : null;
  const solo = score.strumProfileKind === "ukulele";
  const energy = (b) => (b && b.length ? b.reduce((a, v) => a + v, 0) / b.length : 0);
  const med = prof ? [...prof.map(energy).filter((e) => e > 0.02)].sort((a, b) => a - b) : [];
  const median = med.length ? med[med.length >> 1] : 0;
  const melody = score.tracks.filter((t) => !t.hidden).flatMap((t) => t.notes);
  const lastChordBar = (() => {
    const c = score.chords.filter((x) => x.name !== "N.C.").pop();
    return c ? bars.findIndex((b) => c.col >= b.start && c.col < b.start + b.len) : -1;
  })();
  // per bar: candidate patterns with a cost each
  const opts = bars.map((bar, i) => {
    const beats = bar.beats;
    const ci = chordIndexAt(score, bar.start + bar.len - 1);
    const hasChord = ci >= 0 && score.chords[ci].name !== "N.C." && score.chords[ci].col < bar.start + bar.len;
    const fits = SHEET_STRUMS.filter((p) => (p.beats || 4) === (beats === 3 ? 3 : 4));
    if (!hasChord) return [{ slots: null, cost: 0 }];   // nothing to strum; the pattern carries on after it
    if (prof && prof[i] && solo && prof[i].some((v) => v > 0.05)) {
      // patterns a player of beginner sheets actually uses; rarer ones (reggae, chuck runs) only by choice
      const usual = ["D-------", "D---D---", "D-D-D-D-", "D-DU-UDU", "DUDUDUDU", "D-D-DUDU", "D-X-D-X-", "D-----", "D-D-D-", "D-DUDU"];
      return fits.filter((p) => usual.includes(p.slots)).map((p) => ({ slots: p.slots, cost: 1 - fitScore(p.slots, prof[i]) }));
    }
    if (prof && prof[i] && median > 0 && beats !== 3) {
      // band recording: how loud and busy this bar is next to the rest of the song
      const e = energy(prof[i]) / median;
      const off = prof[i].filter((v, k) => k % 2 === 1 && v > 0.4).length;
      let pick = "D-DU-UDU";
      if (i === lastChordBar || e < 0.3) pick = "D-------";
      else if (e < 0.6) pick = "D---D---";
      else if (e > 1.5 && off >= 3) pick = "DUDUDUDU";
      // patterns ordered from few strums to many; a near one costs little, so bars do not flip back and forth
      const order = ["D-------", "D---D---", "D-D-D-D-", "D-DU-UDU", "DUDUDUDU"];
      return order.map((slots) => ({ slots, cost: 0.12 * Math.abs(order.indexOf(slots) - order.indexOf(pick)) }));
    }
    // no recording: the meter, tempo and how busy the melody is
    const bpm = tm.bpmAt(bar.start);
    const starts = new Set(melody.filter((n) => n.col >= bar.start && n.col < bar.start + bar.len).map((n) => n.col)).size;
    let pick;
    if (beats === 3) pick = "D-DUDU";
    else if (i === lastChordBar) pick = "D-------";
    else if (starts <= 1) pick = bpm < 110 ? "D---D---" : "D-------";
    else if (bpm >= 150) pick = "D-D-D-D-";
    else pick = "D-DU-UDU";
    if (i === lastChordBar && beats === 3) pick = "D-----";
    return fits.filter((p) => strokes(p.slots)).map((p) => ({ slots: p.slots, cost: p.slots === pick ? 0 : 0.5 }));
  });
  // keep a pattern going: changing costs more inside a 4-bar phrase than at its start
  const n = bars.length;
  const best = opts.map((o) => o.map(() => Infinity)), back = opts.map((o) => o.map(() => -1));
  opts[0].forEach((o, k) => { best[0][k] = o.cost; });
  for (let i = 1; i < n; i++) {
    const change = (i % 4 === 0) ? 0.06 : 0.2;
    opts[i].forEach((o, k) => {
      opts[i - 1].forEach((p, j) => {
        const v = best[i - 1][j] + o.cost + (p.slots === o.slots || !p.slots || !o.slots ? 0 : change);
        if (v < best[i][k]) { best[i][k] = v; back[i][k] = j; }
      });
    });
  }
  let k = best[n - 1].indexOf(Math.min(...best[n - 1]));
  const perBar = new Array(n);
  for (let i = n - 1; i >= 0; i--) { perBar[i] = opts[i][k].slots; k = back[i][k]; }
  // the most used real pattern is the song's own; bars that differ become changes
  const count = new Map();
  for (const p of perBar) if (p && /[DUX]/.test(p)) count.set(p, (count.get(p) || 0) + 1);
  const base = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || score.strum.pattern;
  return { base, perBar, source: prof ? "recording" : "sheet" };
}

// per-bar patterns (null = bar without a chord) -> {pattern, strums} for the score: the song's own pattern and
// changes only where a bar differs from the one before
export function toStrumEvents(score, perBar, base) {
  const bars = computeBars(score);
  const events = [];
  let cur = base;
  for (let i = 0; i < bars.length; i++) {
    const p = perBar[i];
    if (!p || p === cur) continue;
    events.push({ col: bars[i].start, pattern: p });
    cur = p;
  }
  return { pattern: base, strums: events };
}

// pattern of every bar as the score has it now (null where the bar has no chord)
export function currentPerBar(score) {
  const bars = computeBars(score);
  return bars.map((bar) => {
    const ci = chordIndexAt(score, bar.start + bar.len - 1);
    if (ci < 0 || score.chords[ci].name === "N.C.") return null;
    let p = score.strum.pattern;
    for (const e of score.strums || []) { if (e.col <= bar.start) p = e.pattern; else break; }
    return p;
  });
}
