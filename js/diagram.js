// Chord diagram as SVG markup.
// "h" (horizontal, the layout used by many Korean beginner sheets): nut on the left, A string on top, G at the bottom.
// "v" (vertical chord box): nut on top, strings G C E A from left to right.

import { chordShape } from "./chords.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// size: pixel width of the fret area; options.numbers draws finger numbers in the dots
export function diagramSVG(name, { tuning = "standard", custom = null, orient = "h", size = 64, numbers = true, title = true, cls = "" } = {}) {
  if (!name || name === "N.C.") return `<svg class="diag ${cls}" viewBox="0 0 10 10" width="0" height="0" aria-hidden="true"></svg>`;
  const sh = chordShape(name, tuning, custom);
  if (!sh) {
    return `<svg class="diag unknown ${cls}" viewBox="0 0 80 40" role="img" aria-label="${esc(name)} (모르는 코드)">
      <text x="40" y="24" text-anchor="middle" font-size="12">${esc(name)}?</text></svg>`;
  }
  const pressed = sh.frets.filter((f) => f > 0);
  const hi = pressed.length ? Math.max(...pressed) : 0;
  const lo = pressed.length ? Math.min(...pressed) : 0;
  const nFrets = 4;
  const start = hi <= 4 ? 1 : lo; // first fret shown
  const nut = start === 1;
  const H = orient === "h";
  const len = size;               // along the frets
  const wid = size * 0.62;        // across the strings
  const cell = len / nFrets;
  const gap = wid / 3;
  const padL = H ? 10 : 8, padT = title ? (H ? 18 : 18) : 6;
  const W = H ? padL + len + 8 : padL * 2 + wid + 4;
  const Ht = H ? padT + wid + 8 : padT + len + 10;
  const r = Math.min(cell, gap) * 0.36;
  // string index 0..3 = G C E A
  const pos = (s, fretIdx) => {
    const along = (fretIdx - 0.5) * cell;
    return H ? [padL + along, padT + (3 - s) * gap] : [padL + s * gap, padT + along];
  };
  let g = "";
  if (title) {
    g += H
      ? `<text class="dn" x="${padL + len / 2}" y="${padT - 6}" text-anchor="middle">${esc(name)}</text>`
      : `<text class="dn" x="${padL + wid / 2}" y="${padT - 6}" text-anchor="middle">${esc(name)}</text>`;
  }
  for (let s = 0; s < 4; s++) {
    g += H
      ? `<line class="ds" x1="${padL}" y1="${padT + s * gap}" x2="${padL + len}" y2="${padT + s * gap}"/>`
      : `<line class="ds" x1="${padL + s * gap}" y1="${padT}" x2="${padL + s * gap}" y2="${padT + len}"/>`;
  }
  for (let f = 0; f <= nFrets; f++) {
    const thick = f === 0 && nut;
    g += H
      ? `<line class="${thick ? "dnut" : "df"}" x1="${padL + f * cell}" y1="${padT}" x2="${padL + f * cell}" y2="${padT + wid}"/>`
      : `<line class="${thick ? "dnut" : "df"}" x1="${padL}" y1="${padT + f * cell}" x2="${padL + wid}" y2="${padT + f * cell}"/>`;
  }
  if (!nut) {
    g += H
      ? `<text class="dpos" x="${padL + cell / 2}" y="${padT + wid + 8}" text-anchor="middle">${start}</text>`
      : `<text class="dpos" x="${padL - 3}" y="${padT + cell * 0.6}" text-anchor="end">${start}</text>`;
  }
  if (sh.barre) {
    const fi = sh.barre.fret - start + 1;
    const [x1, y1] = pos(sh.barre.from, fi);
    const [x2, y2] = pos(sh.barre.to, fi);
    g += `<line class="dbarre" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${r * 2}" stroke-linecap="round"/>`;
  }
  sh.frets.forEach((f, s) => {
    if (f < 0) {
      const [x, y] = H ? [padL - 6, padT + (3 - s) * gap] : [padL + s * gap, padT - 4];
      g += `<text class="dx" x="${x}" y="${y + 3}" text-anchor="middle">×</text>`;
      return;
    }
    if (f === 0) return;
    const [x, y] = pos(s, f - start + 1);
    const inBarre = sh.barre && sh.barre.fret === f && s >= sh.barre.from && s <= sh.barre.to;
    if (!inBarre) g += `<circle class="dd" cx="${x}" cy="${y}" r="${r}"/>`;
    const fg = sh.fingers[s];
    if (numbers && fg && (!inBarre || s === sh.barre.to)) {
      g += `<text class="dfg" x="${x}" y="${y + r * 0.42}" text-anchor="middle" font-size="${r * 1.25}">${fg}</text>`;
    }
  });
  return `<svg class="diag ${cls}" viewBox="0 0 ${W} ${Ht}" width="${W}" height="${Ht}" role="img" aria-label="${esc(name)} 코드: ${sh.frets.join(" ")}">${g}</svg>`;
}
