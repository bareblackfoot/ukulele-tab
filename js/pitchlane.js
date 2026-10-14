// Otamatone game lane: one row per semitone (higher notes higher), each note a bar on its row coming from the
// right to the hit line, a beat always the same width. The pitch the microphone hears is drawn as a line that
// leaves the hit line to the left, so being on a note shows as the line running along its bar; the parts of a
// note held on pitch turn green. Bottom left: the note heard now and how far off it is (cents).

import { computeBars, pitchName } from "./model.js";

const BLACK = new Set([1, 3, 6, 8, 10]);
const GRADE = { perfect: "#2f9e44", ok: "#1c7ed6", bad: "#f08c00", miss: "#e03131" };

export class PitchLane {
  constructor(root) {
    this.root = root;
    root.classList.add("pitch");
    this.cv = document.createElement("canvas");
    root.appendChild(this.cv);
  }

  draw(practice, nowCol) {
    const s = practice.score, cv = this.cv;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!s || !W) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    const ts = practice.targets, tm = practice.player.tm, spb = s.stepsPerBeat;
    if (this.ref !== ts || this.score !== s) {
      this.ref = ts;
      this.score = s;
      const ms = ts.map((t) => t.midi);
      this.lo = (ms.length ? Math.min(...ms) : 60) - 2;
      this.hi = (ms.length ? Math.max(...ms) : 72) + 2;
      while (this.hi - this.lo < 12) { this.hi++; if (this.hi - this.lo < 12) this.lo--; }
      this.bars = computeBars(s);
      // about 10 px a row, so a wide song gets a taller lane (within what fits next to the sheet)
      const rows = this.hi - this.lo + 1, small = window.innerWidth < 560;
      this.root.style.height = `${Math.round(Math.max(small ? 170 : 200, Math.min(small ? 260 : 340, rows * 10 + 8)))}px`;
    }
    const narrow = W < 560;
    const hitX = narrow ? 64 : 84;
    this.root.parentElement.style.setProperty("--hit", `${hitX}px`);
    const ppc = Math.max(70, Math.min(110, W / 9)) / spb;
    const X = (col) => hitX + (col - nowCol) * ppc;
    const lo = this.lo, hi = this.hi, top = 4, rowH = (H - 8) / (hi - lo + 1);
    const Y = (m) => top + (hi - m + 0.5) * rowH;
    const colLo = nowCol - hitX / ppc - 1, colHi = nowCol + (W - hitX) / ppc + 1;

    c.fillStyle = v("--paper");
    c.fillRect(0, 0, W, H);
    // rows
    for (let m = lo; m <= hi; m++) {
      const pc = ((m % 12) + 12) % 12, y = Y(m) - rowH / 2;
      if (BLACK.has(pc)) { c.fillStyle = v("--panel"); c.fillRect(0, y, W, rowH); }
      if (pc === 0) { c.strokeStyle = v("--btn-b"); c.lineWidth = 1; c.beginPath(); c.moveTo(0, y + rowH); c.lineTo(W, y + rowH); c.stroke(); }
    }
    // beats and bars
    c.lineWidth = 1;
    for (const b of this.bars) {
      if (b.start > colHi) break;
      if (b.start + b.len < colLo) continue;
      for (let k = 0; k < b.len; k += spb) {
        const x = X(b.start + k);
        if (x < -2 || x > W + 2) continue;
        c.strokeStyle = k === 0 ? v("--btn-b") : v("--grid");
        c.lineWidth = k === 0 ? 2 : 1;
        c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
      }
    }
    // row names at the left edge
    c.font = `${Math.min(11, Math.max(8, rowH * 0.8))}px system-ui, sans-serif`;
    c.textBaseline = "middle";
    c.textAlign = "left";
    for (let m = lo; m <= hi; m++) {
      if (rowH < 9 && m % 12 !== 0) continue;
      c.fillStyle = m % 12 === 0 ? v("--ink") : v("--ink2");
      c.fillText(pitchName(m), 3, Y(m));
    }
    // notes
    const bh = Math.max(7, rowH * 0.88);
    c.textAlign = "left";
    for (const g of ts) {
      if (g.col > colHi) break;
      if (g.col + (g.len || 1) < colLo) continue;
      const x0 = X(g.col), x1 = X(g.col + (g.len || 1)) - 1.5, y = Y(g.midi);
      const done = g.grade && g.grade !== "pending";
      c.globalAlpha = done ? 0.55 : 1;
      c.fillStyle = done ? GRADE[g.grade] : g.head ? GRADE[g.head] : v("--ink");
      roundRect(c, x0, y - bh / 2, Math.max(4, x1 - x0), bh, Math.min(4, bh / 2));
      c.fill();
      c.globalAlpha = 1;
      // the parts held on pitch
      if (g.segs) {
        c.fillStyle = "rgba(47, 158, 68, .95)";
        for (const [a, b] of g.segs) {
          const xa = X(tm.timeToCol(a)), xb = X(tm.timeToCol(b + 0.02));
          c.fillRect(xa, y - bh / 2 + 1.5, Math.max(1.5, xb - xa), bh - 3);
        }
      }
      if (x1 - x0 > 26 && bh >= 8) {
        c.fillStyle = v("--paper");
        c.font = `bold ${Math.max(7.5, Math.min(11, bh - 0.5))}px system-ui, sans-serif`;
        c.fillText(pitchName(g.midi), x0 + 4, y + 0.5);
      }
    }
    // hit line
    c.strokeStyle = v("--cursor");
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(hitX, 0); c.lineTo(hitX, H); c.stroke();
    // the pitch heard: a line to the left of the hit line, a dot at it
    const pj = practice.pj;
    if (pj) {
      const clamp = (m) => Math.max(lo - 0.4, Math.min(hi + 0.4, m));
      c.strokeStyle = v("--cursor");
      c.lineWidth = 2.5;
      c.lineJoin = "round";
      let open = false, lastX = -1e9;
      c.beginPath();
      for (const f of pj.trail) {
        const x = X(tm.timeToCol(f.st));
        if (x < -4 || f.m === null || x - lastX > 12) { if (open) c.stroke(); open = false; c.beginPath(); }
        if (x < -4 || f.m === null) { lastX = -1e9; continue; }
        const y = Y(clamp(f.m));
        if (!open) { c.moveTo(x, y); open = true; } else c.lineTo(x, y);
        lastX = x;
      }
      if (open) c.stroke();
      const L = pj.live;
      if (L && L.m !== null && performance.now() - L.at < 200) {
        c.fillStyle = v("--cursor");
        c.beginPath(); c.arc(hitX, Y(clamp(L.m)), 6, 0, Math.PI * 2); c.fill();
        const r = Math.round(L.m), cents = Math.round((L.m - r) * 100);
        const txt = `${pitchName(r)} ${cents >= 0 ? "+" : ""}${cents}`;
        c.font = "bold 13px system-ui, sans-serif";
        c.textBaseline = "bottom";
        c.fillStyle = v("--paper");
        c.fillRect(0, H - 20, c.measureText(txt).width + 10, 20);
        c.fillStyle = v("--ink");
        c.fillText(txt, 4, H - 3);
      }
    }
    // a ring where a note was judged
    const now = performance.now();
    practice.bursts = practice.bursts.filter((b) => now - b.t < 400);
    for (const b of practice.bursts) {
      const k = (now - b.t) / 400;
      c.globalAlpha = 1 - k;
      c.strokeStyle = GRADE[b.grade];
      c.lineWidth = b.grade === "perfect" ? 4 : 2;
      c.beginPath(); c.arc(hitX, b.midi !== undefined ? Y(b.midi) : H / 2, 8 + k * 22, 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1;
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
