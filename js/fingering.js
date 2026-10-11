// Put a melody (MIDI pitches) on ukulele strings and frets.
// Picks one octave shift for the whole melody so most notes fit, then chooses string/fret per note
// with a shortest-path search that prefers low frets and small hand movement.

import { TUNINGS } from "./chords.js";

export const MAX_FRET = 15;

export function playableRange(tuningName) {
  const st = (TUNINGS[tuningName] || TUNINGS.standard).strings;
  return { lo: Math.min(...st), hi: Math.max(...st) + MAX_FRET };
}

export function bestOctaveShift(midis, tuningName) {
  if (!midis.length) return 0;
  const { lo, hi } = playableRange(tuningName);
  const sorted = [...midis].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  let best = null;
  for (let k = -36; k <= 36; k += 12) {
    const inRange = midis.filter((m) => m + k >= lo && m + k <= hi).length;
    const score = inRange * 1000 - Math.abs(median + k - 70) - Math.abs(k) * 0.01;
    if (!best || score > best.score) best = { k, score };
  }
  return best.k;
}

function candidates(m, strings) {
  const out = [];
  strings.forEach((open, s) => {
    const f = m - open;
    if (f >= 0 && f <= MAX_FRET) out.push({ s, f });
  });
  return out;
}

const nodeCost = (c) => 0.15 * c.f + (c.f > 12 ? 1 : 0) + (c.f === 0 ? -0.1 : 0);

function moveCost(a, b) {
  const ds = Math.abs(a.s - b.s);
  if (a.f === 0 || b.f === 0) return 0.1 * ds;
  const df = Math.abs(a.f - b.f);
  return 0.1 * df + Math.max(0, df - 2) * 0.6 + 0.1 * ds;
}

// notes: [{col, len, midi}] -> {notes: [{col, len, string, fret}], shift, folded}
export function melodyToTab(notes, tuningName = "standard", octaveShift = undefined) {
  const strings = (TUNINGS[tuningName] || TUNINGS.standard).strings;
  const { lo, hi } = playableRange(tuningName);
  const shift = Number.isFinite(octaveShift) ? octaveShift : bestOctaveShift(notes.map((n) => n.midi), tuningName);
  let folded = 0;
  const pitched = notes.map((n) => {
    let m = n.midi + shift;
    if (m < lo || m > hi) {
      folded++;
      while (m < lo) m += 12;
      while (m > hi) m -= 12;
    }
    return { col: n.col, len: n.len, m };
  }).sort((a, b) => a.col - b.col || b.m - a.m);

  // group notes that start together; the top note of each group goes through the path search,
  // the rest are put on free strings afterwards
  const groups = [];
  for (const n of pitched) {
    const g = groups[groups.length - 1];
    if (g && g.col === n.col) g.notes.push(n); else groups.push({ col: n.col, notes: [n] });
  }
  const lead = groups.map((g) => g.notes[0]);
  const cand = lead.map((n) => candidates(n.m, strings));
  // Viterbi over the lead line
  const cost = [], back = [];
  cand.forEach((cs, i) => {
    cost.push(cs.map((c) => nodeCost(c)));
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
    out.push({ col: g.col, len: g.notes[0].len, string: pick[i].s, fret: pick[i].f });
    for (const n of g.notes.slice(1)) {
      const cs = candidates(n.m, strings).filter((c) => !used.has(c.s))
        .sort((a, b) => Math.abs(a.f - pick[i].f) - Math.abs(b.f - pick[i].f));
      if (!cs.length) continue;
      used.add(cs[0].s);
      out.push({ col: n.col, len: n.len, string: cs[0].s, fret: cs[0].f });
    }
  });
  // a string can only sound one note: cut a note when the next note on the same string starts
  const lastOnString = [null, null, null, null];
  for (const n of out.sort((a, b) => a.col - b.col)) {
    const prev = lastOnString[n.string];
    if (prev && prev.col + prev.len > n.col) prev.len = Math.max(1, n.col - prev.col);
    lastOnString[n.string] = n;
  }
  return { notes: out, shift, folded };
}
