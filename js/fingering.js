// Put a melody (MIDI pitches) on the strings and frets of the score's instrument.
// Picks one octave shift for the whole melody so most notes fit, then chooses string/fret per note
// with a shortest-path search that prefers low frets and small hand movement.

import { tuningOf, instOf } from "./instrument.js";

export const MAX_FRET = 15;

export function playableRange(tuningName, maxFret = instOf(tuningName).maxFret) {
  const st = tuningOf(tuningName).strings;
  return { lo: Math.min(...st), hi: Math.max(...st) + maxFret };
}

export function bestOctaveShift(midis, tuningName, center = instOf(tuningName).melodyCenter, maxFret = undefined) {
  if (!midis.length) return 0;
  const { lo, hi } = playableRange(tuningName, maxFret);
  const sorted = [...midis].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  let best = null;
  for (let k = -36; k <= 36; k += 12) {
    const inRange = midis.filter((m) => m + k >= lo && m + k <= hi).length;
    const score = inRange * 1000 - Math.abs(median + k - center) - Math.abs(k) * 0.01;
    if (!best || score > best.score) best = { k, score };
  }
  return best.k;
}

function candidates(m, strings, maxFret = MAX_FRET) {
  const out = [];
  strings.forEach((open, s) => {
    const f = m - open;
    if (f >= 0 && f <= maxFret) out.push({ s, f });
  });
  return out;
}

const nodeCost = (c) => 0.15 * c.f + (c.f > 12 ? 1 : 0) + (c.f === 0 ? -0.1 : 0);
// lead lines (solos, an electric guitar playing the tune) sit in a hand position up the neck, around fret 5..12
const leadCost = (c) => 0.08 * Math.max(0, 5 - c.f) + 0.08 * Math.max(0, c.f - 12) + (c.f === 0 ? 0.5 : 0);

function moveCost(a, b) {
  const ds = Math.abs(a.s - b.s);
  if (a.f === 0 || b.f === 0) return 0.1 * ds;
  const df = Math.abs(a.f - b.f);
  return 0.1 * df + Math.max(0, df - 2) * 0.6 + 0.1 * ds;
}

// notes: [{col, len, midi, tech?}] -> {notes: [{col, len, string, fret, tech?}], shift, folded}
// opts: {lead: hand position up the neck, center: MIDI pitch the octave is chosen around, maxFret}
// A note with a bend (tech "b1"/"b2") is never put on an open string.
export function melodyToTab(notes, tuningName = "standard", octaveShift = undefined, opts = {}) {
  const strings = tuningOf(tuningName).strings;
  const maxFret = opts.maxFret || instOf(tuningName).maxFret;
  const { lo, hi } = playableRange(tuningName, maxFret);
  const node = opts.lead ? leadCost : nodeCost;
  const shift = Number.isFinite(octaveShift) ? octaveShift : bestOctaveShift(notes.map((n) => n.midi), tuningName, opts.center, maxFret);
  let folded = 0;
  const pitched = notes.map((n) => {
    let m = n.midi + shift;
    if (m < lo || m > hi) {
      folded++;
      while (m < lo) m += 12;
      while (m > hi) m -= 12;
    }
    return { col: n.col, len: n.len, m, tech: n.tech };
  }).sort((a, b) => a.col - b.col || b.m - a.m);

  // group notes that start together; the top note of each group goes through the path search,
  // the rest are put on free strings afterwards
  const groups = [];
  for (const n of pitched) {
    const g = groups[groups.length - 1];
    if (g && g.col === n.col) g.notes.push(n); else groups.push({ col: n.col, notes: [n] });
  }
  const lead = groups.map((g) => g.notes[0]);
  const cand = lead.map((n) => {
    const cs = candidates(n.m, strings, maxFret);
    const bent = n.tech && n.tech[0] === "b" ? cs.filter((c) => c.f > 0) : cs;
    return bent.length ? bent : cs;
  });
  // Viterbi over the lead line
  const cost = [], back = [];
  cand.forEach((cs, i) => {
    cost.push(cs.map((c) => node(c)));
    back.push(cs.map(() => -1));
    if (i === 0) return;
    cs.forEach((c, j) => {
      let bestK = -1, bestV = Infinity;
      cand[i - 1].forEach((p, k) => {
        const v = cost[i - 1][k] + moveCost(p, c);
        if (v < bestV) { bestV = v; bestK = k; }
      });
      cost[i][j] += bestV;
      back[i][j] = bestK;
    });
  });
  const pick = new Array(lead.length);
  if (lead.length) {
    let j = cost[lead.length - 1].indexOf(Math.min(...cost[lead.length - 1]));
    for (let i = lead.length - 1; i >= 0; i--) { pick[i] = cand[i][j]; j = back[i][j]; }
  }
  const out = [];
  groups.forEach((g, i) => {
    const used = new Set([pick[i].s]);
    out.push({ col: g.col, len: g.notes[0].len, string: pick[i].s, fret: pick[i].f, ...(g.notes[0].tech ? { tech: g.notes[0].tech } : {}) });
    for (const n of g.notes.slice(1)) {
      const cs = candidates(n.m, strings, maxFret).filter((c) => !used.has(c.s))
        .sort((a, b) => Math.abs(a.f - pick[i].f) - Math.abs(b.f - pick[i].f));
      if (!cs.length) continue;
      used.add(cs[0].s);
      out.push({ col: n.col, len: n.len, string: cs[0].s, fret: cs[0].f });
    }
  });
  // a string can only sound one note: cut a note when the next note on the same string starts
  const lastOnString = strings.map(() => null);
  for (const n of out.sort((a, b) => a.col - b.col)) {
    const prev = lastOnString[n.string];
    if (prev && prev.col + prev.len > n.col) prev.len = Math.max(1, n.col - prev.col);
    lastOnString[n.string] = n;
  }
  return { notes: out, shift, folded };
}
