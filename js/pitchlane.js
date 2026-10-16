// Otamatone game lane, drawn like SPRED's practice mode: dark rows, one per semitone (higher notes higher),
// placed as far apart as the notes are on the stem at SPRED's own scale (at 100 %, 1 screen px for 1 of SPRED's
// layout: note rows 7 px, notes 21 px tall, rows 49 px apart near E3 and 13 near C6), notes in SPRED's colours
// coming from the right to the hit line, a beat always the same width. The pitch the microphone hears is a glowing green dot
// on the hit line, with the note there and how many cents off it is, and a line leaving to the left. The parts
// of a passed note held on pitch stay bright, the rest dims. A judged note gets its grade above it (with the
// combo, early/late and by how much) and a burst of sparks.

import { computeBars, pitchName, midiOf } from "./model.js";
import { stemMap, stemOf } from "./instrument.js";
import { noteFill, noteText, rowFill, trackKind } from "./pitchcolor.js";

const NATURAL = new Set([0, 2, 4, 5, 7, 9, 11]);
// SPRED's roll and judge colours
const BG = "#525252", ROW = "#646464", ROW_SHARP = "#5b5b5b", DOT = "#39ff79", HIT = "#ff5050";
const JUDGE = { perfect: "#62ff8b", ok: "#6fc7ff", bad: "#ffba5f", miss: "#ff6f6f" };
const LABEL = { perfect: "Perfect", ok: "Ok", bad: "Bad", miss: "Miss" };
const FLASH_MS = 520;

export class PitchLane {
  // settings: () => the view settings (rollZoom: the rows' height in % of SPRED's)
  constructor(root, settings = () => ({})) {
    this.root = root;
    this.settings = settings;
    root.classList.add("pitch");
    this.cv = document.createElement("canvas");
    root.appendChild(this.cv);
    this.sparks = [];
    this.seenBurst = 0;
    this.lastNow = 0;
  }

  draw(practice, nowCol) {
    const s = practice.score, cv = this.cv;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!s || !W) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ts = practice.targets, tm = practice.player.tm, spb = s.stepsPerBeat;
    if (this.ref !== ts || this.score !== s) {
      this.ref = ts;
      this.score = s;
      this.k = 0;
      const ms = ts.map((t) => t.midi);
      this.lo = (ms.length ? Math.min(...ms) : 60) - 1;
      this.hi = (ms.length ? Math.max(...ms) : 72) + 1;
      while (this.hi - this.lo < 8) { this.hi++; if (this.hi - this.lo < 8) this.lo--; }
      const stem = stemOf(s);
      this.pos = stemMap(stem);
      this.stemRow = (stem && stem.row) || 7;
      this.bars = computeBars(s);
      // the tracks switched off in 보기: drawn faint, not judged
      this.off = s.tracks.flatMap((t, ti) => (t.muted && !t.hidden ? t.notes.map((n) => ({ col: n.col, len: n.len, midi: midiOf(n, s.tuning, s.capo || 0), tk: trackKind(t, ti) })) : []))
        .sort((a, b) => a.col - b.col);
    }
    // as tall as the song's notes are apart on the stem at SPRED's scale (보기 → 세로 크기), all of it made
    // smaller in the same proportions when the song's range would not fit on the screen with the counts and a
    // little of the sheet below (notes went off the screen)
    const zoom = (Number(this.settings().rollZoom) || 100) / 100, span = this.pos(this.hi) - this.pos(this.lo);
    const room = window.innerHeight - this.root.getBoundingClientRect().top - 150;
    const fitK = Math.max(0.3, Math.min(zoom, (room - 12) / (span + 21)));
    if (Math.abs(fitK - this.k) > 0.005) {
      this.k = fitK;
      this.rowH = this.stemRow * fitK;
      this.root.style.height = `${Math.round(Math.max(110, span * fitK + 21 * fitK + 12))}px`;
    }
    const k = this.k;
    const narrow = W < 560;
    const hitX = narrow ? 64 : 84;
    this.root.parentElement.style.setProperty("--hit", `${hitX}px`);
    const ppc = Math.max(70, Math.min(110, W / 9)) / spb;
    const X = (col) => hitX + (col - nowCol) * ppc;
    const lo = this.lo, hi = this.hi, pos = this.pos, bh = 21 * k, rowH = this.rowH, top = bh / 2 + 6;
    const Y = (m) => top + (pos(hi) - pos(m)) * k;
    const clamp = (m) => Math.max(lo - 0.4, Math.min(hi + 0.4, m));
    const colLo = nowCol - hitX / ppc - 1, colHi = nowCol + (W - hitX) / ppc + 1;
    const now = performance.now(), dt = Math.min(0.05, (now - (this.lastNow || now)) / 1000);
    this.lastNow = now;

    c.fillStyle = BG;
    c.fillRect(0, 0, W, H);
    // rows: a band per note as tall as SPRED's note rows (narrower only where the rows would touch)
    const rows = [];
    for (let m = lo; m <= hi; m++) {
      const pc = ((m % 12) + 12) % 12, y = Y(m);
      const h = Math.max(1, Math.min(rowH, (m < hi ? y - Y(m + 1) : rowH + 2) - 1, (m > lo ? Y(m - 1) - y : rowH + 2) - 1));
      c.fillStyle = NATURAL.has(pc) ? ROW : ROW_SHARP;
      c.fillRect(0, y - h / 2, W, h);
      rows.push({ m, y, h, rank: pc === 0 ? 0 : NATURAL.has(pc) ? 1 : 2 });
    }
    // beats and bars
    for (const b of this.bars) {
      if (b.start > colHi) break;
      if (b.start + b.len < colLo) continue;
      for (let k = 0; k < b.len; k += spb) {
        const x = X(b.start + k);
        if (x < -2 || x > W + 2) continue;
        c.strokeStyle = k === 0 ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.2)";
        c.lineWidth = k === 0 ? 2 : 1;
        c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
      }
    }
    // notes of the tracks switched off
    c.globalAlpha = 0.22;
    for (const g of this.off) {
      if (g.col > colHi) break;
      if (g.col + g.len < colLo || g.midi < lo - 1 || g.midi > hi + 1) continue;
      c.fillStyle = noteFill(g.midi, g.tk);
      c.fillRect(X(g.col), Y(g.midi) - bh / 2, Math.max(3, g.len * ppc - 1.5), bh);
    }
    c.globalAlpha = 1;
    // the notes to play: bright until they reach the hit line; past it only the parts held on pitch stay bright
    c.textBaseline = "middle";
    c.textAlign = "left";
    let atHit = null;
    for (const g of ts) {
      if (g.col > colHi) break;
      if (g.col + (g.len || 1) < colLo) continue;
      const x0 = X(g.col), x1 = X(g.col + (g.len || 1)) - 1.5, y = Y(g.midi), w = Math.max(4, x1 - x0);
      const fill = noteFill(g.midi, g.tk || 0);
      if (x0 <= hitX && x1 >= hitX) atHit = g;
      const bar = () => { c.beginPath(); c.rect(x0, y - bh / 2, w, bh); };
      if (x0 < hitX) {
        c.globalAlpha = 0.32;
        c.fillStyle = fill;
        bar(); c.fill();
        c.globalAlpha = 1;
        c.save();
        c.beginPath(); c.rect(hitX, 0, W, H); c.clip();
        c.fillStyle = fill; bar(); c.fill();
        c.restore();
      } else {
        c.fillStyle = fill; bar(); c.fill();
      }
      c.strokeStyle = g.tk === 2 ? "rgba(255,255,255,.92)" : "rgba(255,255,255,.22)";
      c.lineWidth = 1;
      bar(); c.stroke();
      if (g.segs) {
        c.save();
        c.shadowColor = fill;
        c.shadowBlur = 10;
        c.fillStyle = fill;
        for (const [a, b] of g.segs) {
          const xa = Math.max(x0, X(tm.timeToCol(a))), xb = Math.min(x1, X(tm.timeToCol(b + 0.02)));
          if (xb > xa) c.fillRect(xa, y - bh / 2, Math.max(1.5, xb - xa), bh);
        }
        c.restore();
      }
      if (x1 - x0 > 26 * Math.max(0.6, k)) {
        c.fillStyle = noteText(g.tk || 0);
        c.font = `bold ${Math.max(8, Math.round(13 * k))}px Arial, system-ui, sans-serif`;
        c.fillText(pitchName(g.midi), x0 + 3, y + 0.5);
      }
    }
    // hit line
    c.save();
    c.shadowColor = HIT;
    c.shadowBlur = 8;
    c.strokeStyle = HIT;
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(hitX, 0); c.lineTo(hitX, H); c.stroke();
    c.restore();
    // row names at the left edge on SPRED's dark shade of each note's colour, the name where it fits (C first)
    c.font = "bold 9.5px Arial, system-ui, sans-serif";
    c.textAlign = "center";
    const shown = [];
    for (const r of rows) { c.fillStyle = rowFill(r.m); c.fillRect(0, r.y - r.h / 2, 30, r.h); }
    for (const r of rows.sort((a, b) => a.rank - b.rank)) {
      if (shown.some((y) => Math.abs(y - r.y) < 11)) continue;
      shown.push(r.y);
      c.fillStyle = rowFill(r.m);
      c.fillRect(0, r.y - 5.5, 30, 11);
      c.fillStyle = "#fff";
      c.fillText(pitchName(r.m), 15, r.y + 0.5);
    }
    // the pitch heard: a green line to the left of the hit line, a glowing dot on it
    const pj = practice.pj;
    if (pj) {
      c.save();
      c.strokeStyle = DOT;
      c.globalAlpha = 0.85;
      c.lineWidth = 2.5;
      c.lineJoin = "round";
      c.shadowColor = DOT;
      c.shadowBlur = 6;
      let open = false, lastX = -1e9;
      c.beginPath();
      for (const f of pj.trail) {
        const x = X(tm.timeToCol(f.st));
        if (x < 30 || f.m === null || x - lastX > 12) { if (open) c.stroke(); open = false; c.beginPath(); }
        if (x < 30 || f.m === null) { lastX = -1e9; continue; }
        const y = Y(clamp(f.m));
        if (!open) { c.moveTo(x, y); open = true; } else c.lineTo(x, y);
        lastX = x;
      }
      if (open) c.stroke();
      c.restore();
      const L = pj.live;
      if (L && L.m !== null && now - L.at < 200) {
        const y = Y(clamp(L.m));
        c.save();
        c.shadowColor = DOT;
        c.shadowBlur = 14;
        c.fillStyle = DOT;
        c.beginPath(); c.arc(hitX, y, 7, 0, Math.PI * 2); c.fill();
        c.shadowBlur = 0;
        c.strokeStyle = "#fff";
        c.lineWidth = 2;
        c.stroke();
        c.restore();
        // the note heard, by name only (no cents: «E4 +12» read badly); green when it counts as the note at the
        // hit line, orange when it does not, white with no note there
        const on = atHit ? pj.near(L.m, atHit.midi) : null;
        const txt = on ? pitchName(atHit.midi) : pitchName(Math.round(L.m));
        c.font = "bold 13px Arial, system-ui, sans-serif";
        c.textAlign = "right";
        c.textBaseline = "middle";
        // above the dot (below it near the top), so the line it leaves stays in sight
        const tw = c.measureText(txt).width, ty = y - 17 >= 9 ? y - 17 : Math.min(H - 9, y + 17);
        c.fillStyle = "rgba(0,0,0,.65)";
        c.fillRect(hitX - 12 - tw - 6, ty - 9, tw + 10, 18);
        c.fillStyle = on === null ? "#fff" : on ? DOT : JUDGE.bad;
        c.fillText(txt, hitX - 13, ty + 0.5);
      }
    }
    // a ring and sparks where a note was judged
    practice.bursts = practice.bursts.filter((b) => now - b.t < 400);
    for (const b of practice.bursts) {
      const y = b.midi !== undefined ? Y(clamp(b.midi)) : H / 2;
      if (b.t > this.seenBurst) {
        this.seenBurst = b.t;
        const n = b.grade === "perfect" ? 16 : b.grade === "miss" ? 0 : 9;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, v = 70 + Math.random() * 150;
          this.sparks.push({ x: hitX, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 1, color: JUDGE[b.grade] });
        }
      }
      const k = (now - b.t) / 400;
      c.save();
      c.globalAlpha = 1 - k;
      c.strokeStyle = JUDGE[b.grade];
      c.shadowColor = JUDGE[b.grade];
      c.shadowBlur = 10;
      c.lineWidth = b.grade === "perfect" ? 4 : 2;
      c.beginPath(); c.arc(hitX, y, 9 + k * 24, 0, Math.PI * 2); c.stroke();
      c.restore();
    }
    c.save();
    c.globalCompositeOperation = "lighter";
    this.sparks = this.sparks.filter((p) => (p.life -= dt / 0.5) > 0);
    for (const p of this.sparks) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt;
      c.globalAlpha = p.life;
      c.fillStyle = p.color;
      c.beginPath(); c.arc(p.x, p.y, 1.2 + 1.8 * p.life, 0, Math.PI * 2); c.fill();
    }
    c.restore();
    // the grade above the note just judged: combo, grade, early/late and by how much
    const f = practice.flash;
    const age = f ? now - f.t : 1e9;
    if (f && age < FLASH_MS && f.midi !== undefined) {
      const lines = [];
      if (f.combo > 1 && f.grade !== "miss") lines.push({ t: `COMBO ${f.combo}`, size: 13, color: "#fff" });
      lines.push({ t: LABEL[f.grade], size: 21, color: JUDGE[f.grade] });
      if (f.sub) lines.push({ t: `${f.sub.toLowerCase()}${f.dMs !== null && f.dMs !== undefined ? ` ${Math.abs(Math.round(f.dMs))}ms` : ""}`, size: 12, color: f.sub === "EARLY" ? JUDGE.ok : JUDGE.miss });
      const scale = age < 110 ? 1.35 - 0.35 * (age / 110) : 1;
      const alpha = age > FLASH_MS - 150 ? (FLASH_MS - age) / 150 : 1;
      const total = lines.reduce((a, l) => a + l.size + 2, 0);
      let yy = Math.max(4, Y(clamp(f.midi)) - bh / 2 - 8 - total - age * 0.02);
      c.save();
      c.globalAlpha = alpha;
      c.textAlign = "center";
      c.textBaseline = "top";
      c.lineJoin = "round";
      for (const l of lines) {
        c.font = `900 ${Math.round(l.size * scale)}px Arial, system-ui, sans-serif`;
        c.lineWidth = 3.5;
        c.strokeStyle = "rgba(0,0,0,.9)";
        c.strokeText(l.t, hitX + 50, yy);
        c.fillStyle = l.color;
        c.fillText(l.t, hitX + 50, yy);
        yy += l.size + 2;
      }
      c.restore();
    }
  }
}
