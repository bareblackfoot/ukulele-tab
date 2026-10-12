// Game-mode lane: what to play comes from the right to the hit line, a beat always the same width apart.
// Chords: the strokes of the song's strum pattern (down, up, chuck) with the count under them, and above them a
// small diagram of each chord where it starts. The chord being played stays at the hit line until the next one
// reaches it, so the hand position and the strokes are read in one place. Judged strokes are filled; the
// others (with «박마다» and «바뀔 때만» only some are judged) are outlined. Melody: the notes as string and fret.
// Only what is on screen has an element; each frame moves them.

import { diagramSVG } from "./diagram.js";
import { computeBars } from "./model.js";

const ARROW = {
  D: `<svg viewBox="0 0 20 24"><path d="M10 23 1.5 12.5H7V1h6v11.5h5.5z"/></svg>`,
  U: `<svg viewBox="0 0 20 24"><path d="M10 1 1.5 11.5H7V23h6V11.5h5.5z"/></svg>`,
  X: `<svg viewBox="0 0 20 24"><path d="M4 6l12 12M16 6 4 18" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>`,
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// index of the first item with col >= c (items sorted by col)
function firstAt(items, c) {
  let lo = 0, hi = items.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (items[m].col < c) lo = m + 1; else hi = m; }
  return lo;
}

export class GameLane {
  constructor(root, getSettings) {
    this.root = root;
    this.getSettings = getSettings;
    this.live = new Map();   // key -> element on screen
    this.key = "";
    this.hit = document.createElement("div");
    this.hit.className = "gl-hit";
    root.appendChild(this.hit);
  }

  // the counts under the strokes and the chord spans, once per score
  build(practice) {
    const s = practice.score;
    const spb = s.stepsPerBeat;
    const step = spb % 2 === 0 ? spb / 2 : spb;
    this.slots = [];
    for (const bar of computeBars(s)) {
      for (let k = 0; k < bar.len; k += step) {
        const beat = k % spb === 0;
        this.slots.push({ col: bar.start + k, beat, bar: k === 0, label: beat ? String(k / spb + 1) : "&" });
      }
    }
    this.spans = s.chords.map((c, i) => ({ col: c.col, end: s.chords[i + 1] ? s.chords[i + 1].col : s.columnCount, name: c.name }));
    this.melody = practice.target === "melody";
    this.items = this.melody ? practice.targets : practice.strokes;
    this.diagW = 0;
  }

  clear() {
    for (const el of this.live.values()) el.remove();
    this.live.clear();
  }

  // nowCol: the column at the hit line
  draw(practice, nowCol) {
    const s = practice.score;
    const W = this.root.clientWidth;
    if (!s || !W) return;
    const st = this.getSettings();
    const narrow = W < 560;
    const hitX = narrow ? 74 : 96;
    const key = [W, st.orient, s.tuning, practice.target, practice.strokes.length, practice.targets.length].join("|");
    if (key !== this.key || this.score !== s || this.strokesRef !== practice.strokes || this.targetsRef !== practice.targets) {
      this.key = key;
      this.score = s;
      this.strokesRef = practice.strokes;
      this.targetsRef = practice.targets;
      this.clear();
      this.build(practice);
      this.root.parentElement.style.setProperty("--hit", `${hitX}px`);
      this.hit.style.transform = `translateX(${hitX}px)`;
      this.root.classList.toggle("narrow", narrow);
      this.root.classList.toggle("melody", this.melody);
    }
    const spb = s.stepsPerBeat;
    const ppc = Math.max(64, Math.min(96, W / 10)) / spb;   // pixels per column
    const X = (col) => hitX + (col - nowCol) * ppc;
    const lo = nowCol - (hitX + 50) / ppc, hi = nowCol + (W - hitX + 50) / ppc;
    const seen = new Set();
    const put = (k, make) => {
      let el = this.live.get(k);
      if (!el) { el = make(); el.classList.add("gl-item"); this.root.appendChild(el); this.live.set(k, el); }
      seen.add(k);
      return el;
    };
    const at = (el, x) => { el.style.transform = `translateX(${x.toFixed(1)}px)`; };

    // beat lines and counts
    for (let i = firstAt(this.slots, lo); i < this.slots.length && this.slots[i].col <= hi; i++) {
      const sl = this.slots[i];
      at(put(`s${i}`, () => {
        const el = document.createElement("div");
        el.className = `gl-slot${sl.beat ? " beat" : ""}${sl.bar ? " bar" : ""}`;
        el.innerHTML = `<span>${sl.label}</span>`;
        return el;
      }), X(sl.col));
    }

    // strokes or notes
    for (let i = firstAt(this.items, lo); i < this.items.length && this.items[i].col <= hi; i++) {
      const it = this.items[i];
      const el = put(`n${i}`, () => {
        const el = document.createElement("div");
        if (this.melody) el.innerHTML = `<b>${esc(it.label)}</b>`;
        else el.innerHTML = ARROW[it.dir];
        return el;
      });
      const g = this.melody ? it : it.target;
      const x = X(it.col);
      const cls = `${this.melody ? "gl-note" : `gl-st ${it.dir.toLowerCase()}`}${g ? " tg" : ""}${g && g.grade && g.grade !== "pending" ? ` ${g.grade}` : ""}${x < hitX - 3 ? " past" : ""}`;
      if (el.dataset.cls !== cls) { el.dataset.cls = cls; el.className = `gl-item ${cls}`; }
      at(el, x);
    }

    // chord diagrams: the current one waits at the hit line until the next pushes it out
    if (!this.melody && this.spans.length) {
      const sp = this.spans;
      const cur = firstAt(sp, nowCol + 1e-6) - 1;
      const size = st.orient === "v" ? (narrow ? 36 : 42) : (narrow ? 42 : 50);
      const est = this.diagW || size + 26;
      const gapAfter = (j) => (sp[j + 1] ? (sp[j + 1].col - sp[j].col) * ppc : Infinity);
      const leftOf = [];
      for (let j = Math.max(0, cur - 1); j < sp.length && sp[j].col <= hi + est / ppc; j++) {
        const c = sp[j];
        const small = c.name === "N.C." || gapAfter(j) < est + 10;
        const el = put(`c${j}${small ? "s" : "d"}`, () => {
          const el = document.createElement("div");
          el.className = `gl-chord${small ? " small" : ""}`;
          el.innerHTML = small ? `<b>${c.name === "N.C." ? "쉼" : esc(c.name)}</b>`
            : diagramSVG(c.name, { tuning: s.tuning, custom: s.chordShapes, orient: st.orient, size, numbers: false, cls: "mini" });
          return el;
        });
        if (!el._w) {
          el._w = el.offsetWidth;
          if (!small && !this.diagW) this.diagW = el._w;
        }
        leftOf[j] = { el, w: el._w };
      }
      // from the last one back: each is pushed by the one after it
      const js = Object.keys(leftOf).map(Number).sort((a, b) => b - a);
      for (const j of js) {
        const { el, w } = leftOf[j];
        const own = X(sp[j].col) - 4;
        const next = leftOf[j + 1] ? X(sp[j + 1].col) - 4 : Infinity;
        const left = j > cur ? own : Math.min(hitX - 4, next - w - 6);
        el.classList.toggle("cur", j === cur);
        at(el, left);
      }
    }

    // a ring at the hit line for each judged target, fading
    const now = performance.now();
    practice.bursts = practice.bursts.filter((b) => now - b.t < 400);
    for (const b of practice.bursts) {
      put(`b${b.t}`, () => {
        const el = document.createElement("div");
        el.className = `gl-burst ${b.grade}`;
        el.style.left = `${hitX}px`;
        return el;
      });
    }

    for (const [k, el] of this.live) if (!seen.has(k)) { el.remove(); this.live.delete(k); }
  }
}
