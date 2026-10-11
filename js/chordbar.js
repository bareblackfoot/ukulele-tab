// Top panel: diagram of the chord being played and of the next chords, with beats left until each change.

import { chordIndexAt } from "./model.js";
import { diagramSVG } from "./diagram.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export class ChordBar {
  constructor(root) {
    this.root = root;
    this.key = "";
  }

  setScore(score, settings) {
    this.score = score;
    this.settings = settings;
    this.key = "";
  }

  update(col) {
    const s = this.score;
    if (!s) return;
    const n = this.settings.upcoming ?? 4;
    if (!s.chords.length) {
      if (this.key !== "none") {
        this.root.innerHTML = `<div class="cb-empty">이 악보에는 코드가 없음</div>`;
        this.key = "none";
      }
      return;
    }
    const i = chordIndexAt(s, col);
    const list = [];
    for (let j = Math.max(0, i); j < s.chords.length && list.length < n + 1; j++) list.push({ ...s.chords[j], idx: j });
    const key = list.map((c) => c.idx).join(",") + "|" + this.settings.orient + "|" + s.tuning;
    if (key !== this.key) {
      this.key = key;
      this.root.innerHTML = list.map((c, k) => {
        const cur = k === 0 && i >= 0;
        const size = cur ? 92 : 70;
        return `<div class="cb-item${cur ? " cur" : ""}" data-idx="${c.idx}">
          <div class="cb-when"></div>
          ${c.name === "N.C." ? `<div class="cb-nc">쉼</div>` : diagramSVG(c.name, { tuning: s.tuning, custom: s.chordShapes, orient: this.settings.orient, size })}
          ${cur ? `<div class="cb-prog"><i></i></div>` : ""}
        </div>`;
      }).join("") || "";
      this.items = [...this.root.querySelectorAll(".cb-item")];
    }
    // countdown texts and progress of the current chord
    const spb = s.stepsPerBeat;
    this.items.forEach((el, k) => {
      const c = s.chords[+el.dataset.idx];
      const w = el.querySelector(".cb-when");
      if (k === 0 && i >= 0) {
        w.textContent = "지금";
        const next = s.chords[i + 1];
        const p = el.querySelector(".cb-prog i");
        if (p) p.style.width = next ? `${Math.min(100, ((col - c.col) / (next.col - c.col)) * 100)}%` : "0%";
      } else {
        const beats = Math.max(0, Math.ceil((c.col - col) / spb - 1e-6));
        w.textContent = beats <= 0 ? "곧" : `${beats}박 뒤`;
      }
    });
  }
}
