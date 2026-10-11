// Chord sheet view: bars in lines (4 per line on wide screens), chord names with small diagrams above
// the line, lyrics below, optional melody tab. Highlights the bar being played.

import { computeBars, distinctChords, barAt } from "./model.js";
import { diagramSVG } from "./diagram.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const STRUM_ARROW = { D: "↓", U: "↑", "-": "·", x: "×", X: "×" };
const STRING_LABEL = ["G", "C", "E", "A"];
export const SHEET_MAX_W = 980; // lines get hard to follow when they run across a wide monitor

export class SheetView {
  constructor(root, { onSeek } = {}) {
    this.root = root;
    this.onSeek = onSeek || (() => {});
    this.bars = [];
    this.geo = [];      // per bar: {line, x0, x1}
    this.lines = [];    // per line: {svg, el, cursor, hl}
    this.curBar = -1;
    this.curLine = -1;
    this.follow = true;
    root.addEventListener("click", (e) => this.handleClick(e));
  }

  render(score, settings) {
    this.score = score;
    this.settings = settings;
    const bars = (this.bars = computeBars(score));
    const W = Math.max(320, Math.min(SHEET_MAX_W, this.root.clientWidth - 24));
    const perLine = settings.barsPerLine || (W >= 760 ? 4 : W >= 540 ? 3 : 2);
    const left = 26, right = 8;
    const barW = (W - left - right) / perLine;
    const showTab = settings.showTab && score.tracks.some((t) => !t.hidden && t.notes.length);
    const staffY = 50, lyricY = staffY + 19;
    const tabTop = lyricY + 14, tabGap = 9;
    const H = showTab ? tabTop + tabGap * 3 + 12 : lyricY + 10;
    const tuning = score.tuning;
    const custom = score.chordShapes;
    const meterAt = new Map(score.meter.map((m) => [m.col, m.beats]));
    const sectionAt = new Map(score.sections.map((s) => [s.col, s.text]));

    const parts = [];
    // header
    const chordsUsed = distinctChords(score).filter((c) => c !== "N.C.");
    const bpm = score.tempo[0].bpm;
    const pat = (score.strum.pattern || "").split("").map((c) => STRUM_ARROW[c] || c).join(" ");
    parts.push(`<header class="sheet-head">
      <h1>${esc(score.meta.title || "제목 없음")}</h1>
      <div class="sub">${esc(score.meta.artist || "")}</div>
      <div class="chips">
        ${score.meta.key ? `<span>조 ${esc(score.meta.key)}</span>` : ""}
        <span>${Math.round(bpm * 10) / 10} BPM${score.tempo.length > 1 ? " (바뀜)" : ""}</span>
        <span>${score.meter[0].beats}/4</span>
        <span>${tuning === "low-g" ? "Low-G" : "High-G"}</span>
        ${pat ? `<span title="스트럼 패턴 (8분음표 단위, ↓ 다운 ↑ 업 · 쉼)">${esc(pat)}</span>` : ""}
      </div>
      ${chordsUsed.length ? `<div class="all-chords" aria-label="이 곡의 코드">${chordsUsed.map((c) =>
        diagramSVG(c, { tuning, custom, orient: settings.orient, size: 58 })).join("")}</div>` : ""}
    </header>`);

    this.geo = [];
    const lineCount = Math.ceil(bars.length / perLine);
    const tracks = score.tracks.filter((t) => !t.hidden);
    let ci = 0, li = 0, ni = tracks.map(() => 0);
    for (let L = 0; L < lineCount; L++) {
      const lb = bars.slice(L * perLine, L * perLine + perLine);
      let g = "";
      let under = "";   // bar highlight boxes go below the lines so the lines stay visible
      g += `<line class="staff" x1="${left}" y1="${staffY}" x2="${left + barW * lb.length}" y2="${staffY}"/>`;
      if (showTab) {
        for (let s = 0; s < 4; s++) {
          const y = tabTop + s * tabGap;
          g += `<line class="tabline" x1="${left}" y1="${y}" x2="${left + barW * lb.length}" y2="${y}"/>`;
          g += `<text class="tablab" x="${left - 4}" y="${y + 3}" text-anchor="end">${STRING_LABEL[3 - s]}</text>`;
        }
      }
      let lyricEnd = -1e9;
      lb.forEach((bar, k) => {
        const x0 = left + k * barW, x1 = x0 + barW;
        this.geo[bar.index] = { line: L, x0, x1 };
        const xOf = (col) => x0 + 7 + ((col - bar.start) / bar.len) * (barW - 14);
        under += `<rect class="bar-hl" data-bar="${bar.index}" x="${x0}" y="${staffY - 44}" width="${barW}" height="${H - staffY + 44 - 2}"/>`;
        const yb0 = staffY - 9, yb1 = showTab ? tabTop + tabGap * 3 : staffY + 9;
        g += `<line class="barline" x1="${x1}" y1="${yb0}" x2="${x1}" y2="${yb1}"/>`;
        if (k === 0) g += `<line class="barline" x1="${x0}" y1="${yb0}" x2="${x0}" y2="${yb1}"/>`;
        if (meterAt.has(bar.start) || (bar.index === 0)) {
          const b = meterAt.get(bar.start) ?? bar.beats;
          g += `<text class="tsig" x="${x0 - 12}" y="${staffY - 2}" text-anchor="middle">${b}</text><text class="tsig" x="${x0 - 12}" y="${staffY + 14}" text-anchor="middle">4</text>`;
        } else if (bar.len !== bars[Math.max(0, bar.index - 1)].len) {
          g += `<text class="tsig" x="${x0 - 12}" y="${staffY - 2}" text-anchor="middle">${bar.beats}</text><text class="tsig" x="${x0 - 12}" y="${staffY + 14}" text-anchor="middle">4</text>`;
        }
        if (sectionAt.has(bar.start)) g += `<text class="sect" x="${x0 + 3}" y="${staffY - 38}">${esc(sectionAt.get(bar.start))}</text>`;
        if (k === 0 && L > 0 || k === 0) g += `<text class="barno" x="${x0 + 2}" y="${staffY + 32 + (showTab ? 0 : -6)}">${bar.index + 1}</text>`;
        // chords in this bar
        while (ci < score.chords.length && score.chords[ci].col < bar.start) ci++;
        let lastChordEnd = -1e9;
        for (let j = ci; j < score.chords.length && score.chords[j].col < bar.start + bar.len; j++) {
          const c = score.chords[j];
          let x = Math.max(xOf(c.col), lastChordEnd + 2);
          const nameW = c.name.length * 8.6 + 2;
          g += `<text class="cname" x="${x}" y="${staffY - 8}">${esc(c.name)}</text>`;
          let end = x + nameW;
          if (settings.miniDiagrams && c.name !== "N.C.") {
            const svg = diagramSVG(c.name, { tuning, custom, orient: "h", size: 26, numbers: false, title: false, cls: "mini" });
            g += `<g class="diag mini" transform="translate(${x + nameW - 2},${staffY - 30}) scale(0.9)">${svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</g>`;
            end += 34;
          }
          lastChordEnd = end;
        }
        // lyrics
        while (li < score.lyrics.length && score.lyrics[li].col < bar.start) li++;
        for (let j = li; j < score.lyrics.length && score.lyrics[j].col < bar.start + bar.len; j++) {
          const l = score.lyrics[j];
          const w = [...l.text].reduce((s, ch) => s + (ch.charCodeAt(0) > 0x2e80 ? 12.5 : 7.2), 0);
          const x = Math.max(xOf(l.col), lyricEnd + 1);
          g += `<text class="lyr" x="${x}" y="${lyricY}">${esc(l.text)}</text>`;
          lyricEnd = x + w;
        }
        // melody tab
        if (showTab) {
          tracks.forEach((t, ti) => {
            const ns = t.notes;
            while (ni[ti] < ns.length && ns[ni[ti]].col < bar.start) ni[ti]++;
            for (let j = ni[ti]; j < ns.length && ns[j].col < bar.start + bar.len; j++) {
              const n = ns[j];
              const x = xOf(n.col), y = tabTop + (3 - n.string) * tabGap;
              const txt = String(n.fret);
              g += `<rect class="tabbg" x="${x - 1}" y="${y - 5}" width="${txt.length * 6 + 2}" height="10"/>`;
              g += `<text class="tabnum t${ti}" x="${x}" y="${y + 3.5}">${txt}</text>`;
            }
          });
        }
      });
      g += `<line class="cursor" x1="0" y1="${staffY - 40}" x2="0" y2="${H - 4}" visibility="hidden"/>`;
      parts.push(`<div class="sheet-line" data-line="${L}"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${under}${g}</svg></div>`);
    }
    this.root.innerHTML = parts.join("");
    this.lines = [...this.root.querySelectorAll(".sheet-line")].map((el) => ({
      el, svg: el.querySelector("svg"), cursor: el.querySelector(".cursor"),
    }));
    this.barRects = [...this.root.querySelectorAll(".bar-hl")];
    this.curBar = -1;
    this.curLine = -1;
  }

  setPosition(col, playing) {
    if (!this.bars.length) return;
    const bar = barAt(this.bars, col);
    const geo = this.geo[bar.index];
    if (!geo) return;
    if (bar.index !== this.curBar) {
      if (this.barRects[this.curBar]) this.barRects[this.curBar].classList.remove("on");
      if (this.barRects[bar.index]) this.barRects[bar.index].classList.add("on");
      this.curBar = bar.index;
    }
    if (geo.line !== this.curLine) {
      if (this.lines[this.curLine]) this.lines[this.curLine].cursor.setAttribute("visibility", "hidden");
      this.curLine = geo.line;
      this.lines[geo.line].cursor.setAttribute("visibility", "visible");
      if (playing && this.follow) this.scrollToLine(geo.line);
    }
    const x = geo.x0 + 7 + ((col - bar.start) / bar.len) * (geo.x1 - geo.x0 - 14);
    const c = this.lines[geo.line].cursor;
    c.setAttribute("x1", x);
    c.setAttribute("x2", x);
  }

  // small coloured dot under the staff where a practice target was judged
  mark(col, grade) {
    if (!this.bars.length) return;
    const bar = barAt(this.bars, col);
    const geo = this.geo[bar.index];
    if (!geo) return;
    const x = geo.x0 + 7 + ((col - bar.start) / bar.len) * (geo.x1 - geo.x0 - 14);
    const svg = this.lines[geo.line].svg;
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("class", `jm ${grade}`);
    c.setAttribute("cx", x);
    c.setAttribute("cy", 50 + 4);
    c.setAttribute("r", 4);
    svg.appendChild(c);
  }

  clearMarks() {
    this.root.querySelectorAll(".jm").forEach((e) => e.remove());
  }

  scrollToLine(L) {
    const el = this.lines[L] && this.lines[L].el;
    if (!el) return;
    const sc = this.root;
    const top = el.offsetTop - sc.clientHeight * 0.28;
    sc.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  handleClick(e) {
    const lineEl = e.target.closest(".sheet-line");
    if (!lineEl || !this.score) return;
    const L = +lineEl.dataset.line;
    const rect = lineEl.querySelector("svg").getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = this.geo.findIndex((g) => g && g.line === L && x >= g.x0 && x < g.x1);
    if (idx < 0) return;
    const bar = this.bars[idx], g = this.geo[idx];
    const frac = Math.min(1, Math.max(0, (x - g.x0 - 7) / (g.x1 - g.x0 - 14)));
    const spb = this.score.stepsPerBeat;
    const col = bar.start + Math.floor((frac * bar.len) / spb) * spb;
    this.onSeek(col);
  }
}
