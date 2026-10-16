// Chord sheet view: bars in lines (4 per line on wide screens), chord names with small diagrams above
// the line, lyrics below, optional melody tab. Highlights the bar being played.
// A melody-only instrument (the otamatone) gets pitch rows instead, like SPRED: time across, one row per
// semitone (higher notes higher) placed as far apart as the notes are on the stem, each note a bar on its row.

import { computeBars, distinctChords, barAt, tabLabel, midiOf, pitchName } from "./model.js";
import { diagramSVG } from "./diagram.js";
import { INST, tuningOf, stemMap, stemOf } from "./instrument.js";
import { noteFill, noteText, rowFill, trackKind } from "./pitchcolor.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const STRUM_ARROW = { D: "↓", U: "↑", "-": "·", x: "×", X: "×" };
const strumArrows = (p) => p.split("").map((c) => STRUM_ARROW[c] || c).join(" ");
export const SHEET_MAX_W = 980; // lines get hard to follow when they run across a wide monitor
const BLACK = new Set([1, 3, 6, 8, 10]);

export class SheetView {
  constructor(root, { onSeek, onStrum } = {}) {
    this.root = root;
    this.onSeek = onSeek || (() => {});
    this.onStrum = onStrum || (() => {});
    this.bars = [];
    this.geo = [];      // per bar: {line, x0, x1}
    this.lines = [];    // per line: {svg, el, cursor, hl}
    this.curBar = -1;
    this.curLine = -1;
    this.follow = true;
    this.pad = 7;       // space inside a bar before its first column and after its last
    root.addEventListener("click", (e) => this.handleClick(e));
  }

  render(score, settings) {
    if (INST.roll) return this.renderRoll(score, settings);
    this.pad = 7;
    this.score = score;
    this.settings = settings;
    const bars = (this.bars = computeBars(score));
    const W = Math.max(320, Math.min(SHEET_MAX_W, this.root.clientWidth - 24));
    // lead view: fast lines need room, so 2 bars a line unless the user chose a number
    const perLine = settings.barsPerLine || (score.leadTrack ? (W >= 760 ? 2 : 1) : W >= 760 ? 4 : W >= 540 ? 3 : 2);
    const left = 26, right = 8;
    // the bar length most bars use; a full bar of it is one slot, other bars get width by their beats
    const lenCount = new Map();
    for (const b of bars) lenCount.set(b.len, (lenCount.get(b.len) || 0) + 1);
    const mainLen = [...lenCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const lines = [];
    let i0 = 0;
    if (bars.length > 1 && bars[0].len < mainLen) i0 = 1; // pickup bar goes in front of the first line
    for (let i = i0; i < bars.length; i += perLine) lines.push(bars.slice(i === i0 && i0 ? 0 : i, i + perLine));
    if (!lines.length) lines.push(bars);
    // lead view (score.leadTrack): only that line, its TAB big with note lengths; chord pictures left out
    const lead = !!score.leadTrack;
    const showTab = (settings.showTab || lead) && score.tracks.some((t) => !t.hidden && t.notes.length);
    const names = tuningOf(score.tuning).names, nStr = names.length, top = nStr - 1;
    const staffY = 50, lyricY = staffY + 19;
    const tabTop = lyricY + (lead ? 18 : 14), tabGap = lead ? 13 : 9;
    const charW = lead ? 7.8 : 6;
    const H = showTab ? tabTop + tabGap * top + 12 : lyricY + 10;
    const tuning = score.tuning;
    const custom = score.chordShapes;
    const meterAt = new Map(score.meter.map((m) => [m.col, m.beats]));
    const sectionAt = new Map(score.sections.map((s) => [s.col, s.text]));
    const strumAt = new Map((score.strums || []).map((s) => [s.col, s.pattern]));

    const parts = [];
    // header
    const chordsUsed = distinctChords(score).filter((c) => c !== "N.C.");
    const bpm = score.tempo[0].bpm;
    const pat = strumArrows(score.strum.pattern || "");
    parts.push(`<header class="sheet-head">
      <h1>${esc(score.meta.title || "제목 없음")}</h1>
      <div class="sub">${esc(score.meta.artist || "")}</div>
      <div class="chips">
        ${score.meta.key ? `<span>조 ${esc(score.meta.key)}</span>` : ""}
        <span>${Math.round(bpm * 10) / 10} BPM${score.tempo.length > 1 ? " (바뀜)" : ""}</span>
        <span>${Math.round(mainLen / score.stepsPerBeat)}/4</span>
        ${score.capo ? `<span class="capo">카포 ${score.capo}</span>` : ""}
        ${score.electric ? `<span title="${score.electric.fromCapo ? `통기타판은 카포 ${score.electric.fromCapo}` : "통기타판도 카포 없음"}">일렉기타${score.electric.power ? " · 파워코드" : ""}</span>` : ""}
        <span>${esc(tuningOf(tuning).short)}</span>
        ${pat ? `<span title="스트럼 패턴 (8분음표 단위, ↓ 다운 ↑ 업 · 쉼)">${esc(pat)}</span>` : ""}
      </div>
      ${chordsUsed.length ? `<div class="all-chords" aria-label="이 곡의 코드">${chordsUsed.map((c) =>
        diagramSVG(c, { tuning, custom, orient: settings.orient, size: 58 })).join("")}</div>` : ""}
    </header>`);

    this.geo = [];
    const lineCount = lines.length;
    const tracks = score.tracks.filter((t) => !t.hidden);
    let ci = 0, li = 0, ni = tracks.map(() => 0);
    for (let L = 0; L < lineCount; L++) {
      const lb = lines[L];
      const units = lb.reduce((a, b) => a + b.len, 0);
      // a line is never wider than the page; lines with fewer bars keep the normal bar width
      const unit = (W - left - right) / Math.max(units, perLine * mainLen);
      const xs = [];
      let acc = left;
      for (const b of lb) { xs.push(acc); acc += b.len * unit; }
      const lineEnd = acc;
      let g = "";
      let under = "";   // bar highlight boxes go below the lines so the lines stay visible
      g += `<line class="staff" x1="${left}" y1="${staffY}" x2="${lineEnd}" y2="${staffY}"/>`;
      if (showTab) {
        for (let s = 0; s < nStr; s++) {
          const y = tabTop + s * tabGap;
          g += `<line class="tabline" x1="${left}" y1="${y}" x2="${lineEnd}" y2="${y}"/>`;
          g += `<text class="tablab" x="${left - 4}" y="${y + 3}" text-anchor="end">${names[top - s]}</text>`;
        }
      }
      let lyricEnd = -1e9;
      lb.forEach((bar, k) => {
        const x0 = xs[k], x1 = x0 + bar.len * unit, barW = x1 - x0;
        this.geo[bar.index] = { line: L, x0, x1 };
        const xOf = (col) => x0 + 7 + ((col - bar.start) / bar.len) * (barW - 14);
        under += `<rect class="bar-hl" data-bar="${bar.index}" x="${x0}" y="${staffY - 44}" width="${barW}" height="${H - staffY + 44 - 2}"/>`;
        const yb0 = staffY - 9, yb1 = showTab ? tabTop + tabGap * top : staffY + 9;
        g += `<line class="barline" x1="${x1}" y1="${yb0}" x2="${x1}" y2="${yb1}"/>`;
        if (k === 0) g += `<line class="barline" x1="${x0}" y1="${yb0}" x2="${x0}" y2="${yb1}"/>`;
        if (meterAt.has(bar.start) || (bar.index === 0)) {
          const b = meterAt.get(bar.start) ?? bar.beats;
          g += `<text class="tsig" x="${x0 - 12}" y="${staffY - 2}" text-anchor="middle">${b}</text><text class="tsig" x="${x0 - 12}" y="${staffY + 14}" text-anchor="middle">4</text>`;
        } else if (bar.len !== bars[Math.max(0, bar.index - 1)].len) {
          g += `<text class="tsig" x="${x0 - 12}" y="${staffY - 2}" text-anchor="middle">${bar.beats}</text><text class="tsig" x="${x0 - 12}" y="${staffY + 14}" text-anchor="middle">4</text>`;
        }
        // a new strum pattern starts here: arrows first, then the section text after them
        let sx = x0 + 3;
        if (strumAt.has(bar.start)) {
          const arrows = strumArrows(strumAt.get(bar.start));
          g += `<text class="strumchg" data-bar="${bar.index}" x="${sx}" y="${staffY - 38}"><title>여기부터 스트럼 패턴 바뀜 (누르면 고르기)</title>${esc(arrows)}</text>`;
          sx += arrows.length * 6.2 + 10;
        }
        if (sectionAt.has(bar.start)) g += `<text class="sect" x="${sx}" y="${staffY - 38}">${esc(sectionAt.get(bar.start))}</text>`;
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
          if (settings.miniDiagrams && !lead && c.name !== "N.C.") {
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
        // melody tab; a number never runs into the one before it on the same string
        if (showTab) {
          const ends = [];
          tracks.forEach((t, ti) => {
            const ns = t.notes;
            while (ni[ti] < ns.length && ns[ni[ti]].col < bar.start) ni[ti]++;
            for (let j = ni[ti]; j < ns.length && ns[j].col < bar.start + bar.len; j++) {
              const n = ns[j];
              const txt = tabLabel(n, j > 0 ? ns[j - 1] : null);
              const w = txt.length * charW + 2;
              const x = Math.max(xOf(n.col), (ends[n.string] ?? -1e9) + 2), y = tabTop + (top - n.string) * tabGap;
              ends[n.string] = x + w;
              if (lead) {
                // how long the note rings: a line from the number to where the note ends
                const x2 = xOf(Math.min(n.col + n.len, bar.start + bar.len)) - 2;
                if (x2 > x + w + 2) g += `<line class="tabdur t${ti}" x1="${x + w}" y1="${y}" x2="${x2}" y2="${y}"/>`;
              }
              g += `<rect class="tabbg" x="${x - 1}" y="${y - (lead ? 7 : 5)}" width="${w}" height="${lead ? 14 : 10}"/>`;
              g += `<text class="tabnum t${ti}${lead ? " big" : ""}" x="${x}" y="${y + (lead ? 4.5 : 3.5)}">${esc(txt)}</text>`;
            }
          });
        }
      });
      g += `<line class="cursor" x1="0" y1="${staffY - 40}" x2="0" y2="${H - 4}" visibility="hidden"/>`;
      parts.push(`<div class="sheet-line" data-line="${L}"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${under}${g}</svg></div>`);
    }
    this.root.innerHTML = parts.join("");
    this.finishRender(54);
  }

  finishRender(markY) {
    this.lines = [...this.root.querySelectorAll(".sheet-line")].map((el) => ({
      el, svg: el.querySelector("svg"), cursor: el.querySelector(".cursor"), markY: +(el.dataset.marky || markY),
    }));
    this.barRects = [...this.root.querySelectorAll(".bar-hl")];
    this.curBar = -1;
    this.curLine = -1;
  }

  // SPRED-like pitch rows: each line shows the rows its notes use (one more above and below)
  renderRoll(score, settings) {
    this.score = score;
    this.settings = settings;
    this.pad = 0;
    const bars = (this.bars = computeBars(score));
    const W = Math.max(320, Math.min(SHEET_MAX_W, this.root.clientWidth - 24));
    const lenCount = new Map();
    for (const b of bars) lenCount.set(b.len, (lenCount.get(b.len) || 0) + 1);
    const mainLen = [...lenCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const perLine = settings.barsPerLine || (W >= 760 ? 4 : W >= 540 ? 3 : 2);
    const lines = [];
    let i0 = 0;
    if (bars.length > 1 && bars[0].len < mainLen) i0 = 1; // pickup bar goes in front of the first line
    for (let i = i0; i < bars.length; i += perLine) lines.push(bars.slice(i === i0 && i0 ? 0 : i, i + perLine));
    if (!lines.length) lines.push(bars);
    // a note's height is its place on the stem at SPRED's scale: at 100 % 1 screen px for 1 of SPRED's layout,
    // note rows 7 px, notes 21 px tall (settings.rollZoom scales all three, as SPRED's zoom does)
    const k = (Number(settings.rollZoom) || 100) / 100, stem = stemOf(score), pos = stemMap(stem);
    const left = 34, right = 8, bh = 21 * k, rowH = ((stem && stem.row) || 7) * k, top = 18, fs = Math.max(7, Math.round(12 * k));
    const spb = score.stepsPerBeat;
    const tracks = score.tracks.map((t, ti) => ({ t, ti })).filter(({ t }) => !t.hidden);
    const notes = tracks.flatMap(({ t, ti }) => t.notes.map((n) => ({ col: n.col, len: n.len, m: midiOf(n, score.tuning, score.capo || 0), tk: trackKind(t, ti), off: !!t.muted })));
    notes.sort((a, b) => a.col - b.col);
    const all = notes.filter((n) => !n.off).map((n) => n.m);
    const sectionAt = new Map(score.sections.map((s) => [s.col, s.text]));
    const bpm = score.tempo[0].bpm;
    const parts = [`<header class="sheet-head">
      <h1>${esc(score.meta.title || "제목 없음")}</h1>
      <div class="sub">${esc(score.meta.artist || "")}</div>
      <div class="chips">
        ${score.meta.key ? `<span>조 ${esc(score.meta.key)}</span>` : ""}
        <span>${Math.round(bpm * 10) / 10} BPM${score.tempo.length > 1 ? " (바뀜)" : ""}</span>
        <span>${Math.round(mainLen / spb)}/4</span>
        ${all.length ? `<span title="켠 트랙의 가장 낮은 음과 높은 음">음역 ${pitchName(Math.min(...all))}~${pitchName(Math.max(...all))}</span>` : ""}
      </div>
    </header>`];
    this.geo = [];
    let ni = 0, li = 0, prevRange = all.length ? [Math.min(...all), Math.max(...all)] : [60, 67];
    lines.forEach((lb, L) => {
      const start = lb[0].start, end = lb[lb.length - 1].start + lb[lb.length - 1].len;
      while (ni < notes.length && notes[ni].col + notes[ni].len <= start && notes[ni].col < start) ni++;
      const inLine = [];
      for (let j = ni; j < notes.length && notes[j].col < end; j++) if (notes[j].col + notes[j].len > start) inLine.push(notes[j]);
      let lo = inLine.length ? Math.min(...inLine.map((n) => n.m)) - 1 : prevRange[0];
      let hi = inLine.length ? Math.max(...inLine.map((n) => n.m)) + 1 : prevRange[1];
      while (hi - lo < 6) { hi++; if (hi - lo < 6) lo--; }
      prevRange = [lo + 1, hi - 1];
      const rowsTop = top, yOf = (m) => rowsTop + bh / 2 + 2 + (pos(hi) - pos(m)) * k; // middle of the note's row
      const rowsBot = yOf(lo) + bh / 2 + 2;
      const hasLyr = score.lyrics.some((l) => l.col >= start && l.col < end);
      const H = rowsBot + (hasLyr ? 22 : 8);
      const units = lb.reduce((a, b) => a + b.len, 0);
      const unit = (W - left - right) / Math.max(units, perLine * mainLen);
      const xOf = (col) => left + (col - start) * unit;
      let under = "", g = "";
      // rows: a band per note (black keys darker), narrower where the notes sit close on the stem; on the left
      // SPRED's dark shade of each note's colour, with the name where it fits (C first)
      const named = [];
      const byPlace = [];
      for (let m = hi; m >= lo; m--) {
        const y = yOf(m), pc = ((m % 12) + 12) % 12;
        const h = Math.max(1, Math.min(rowH, (m < hi ? y - yOf(m + 1) : rowH + 2) - 1, (m > lo ? yOf(m - 1) - y : rowH + 2) - 1));
        under += `<rect class="${BLACK.has(pc) ? "roll-black" : "roll-row"}" x="${left}" y="${y - h / 2}" width="${xOf(end) - left}" height="${h}"/>`;
        if (pc === 0) g += `<line class="roll-c" x1="${left}" y1="${y + h / 2 + 0.5}" x2="${xOf(end)}" y2="${y + h / 2 + 0.5}"/>`;
        g += `<rect x="2" y="${y - h / 2}" width="${left - 5}" height="${h}" fill="${rowFill(m)}"/>`;
        byPlace.push({ m, y, rank: pc === 0 ? 0 : BLACK.has(pc) ? 2 : 1 });
      }
      for (const r of byPlace.sort((a, b) => a.rank - b.rank)) {
        if (named.some((y) => Math.abs(y - r.y) < 8)) continue;
        named.push(r.y);
        g += `<rect x="2" y="${r.y - 4}" width="${left - 5}" height="8" fill="${rowFill(r.m)}"/>` +
          `<text class="roll-name" x="${(left - 3) / 2 + 1}" y="${r.y + 2.6}" text-anchor="middle">${pitchName(r.m)}</text>`;
      }
      lb.forEach((bar, k) => {
        const x0 = xOf(bar.start), x1 = xOf(bar.start + bar.len);
        this.geo[bar.index] = { line: L, x0, x1 };
        under += `<rect class="bar-hl" data-bar="${bar.index}" x="${x0}" y="${rowsTop - 16}" width="${x1 - x0}" height="${H - rowsTop + 14}"/>`;
        for (let b = spb; b < bar.len; b += spb) g += `<line class="roll-beat" x1="${xOf(bar.start + b)}" y1="${rowsTop}" x2="${xOf(bar.start + b)}" y2="${rowsBot}"/>`;
        g += `<line class="barline" x1="${x1}" y1="${rowsTop}" x2="${x1}" y2="${rowsBot}"/>`;
        if (k === 0) g += `<line class="barline" x1="${x0}" y1="${rowsTop}" x2="${x0}" y2="${rowsBot}"/>`;
        g += `<text class="barno" x="${x0 + 2}" y="${rowsTop - 5}">${bar.index + 1}</text>`;
        if (sectionAt.has(bar.start)) g += `<text class="sect" x="${x0 + 22}" y="${rowsTop - 5}">${esc(sectionAt.get(bar.start))}</text>`;
      });
      g += `<line class="roll-edge" x1="${left}" y1="${rowsTop}" x2="${xOf(end)}" y2="${rowsTop}"/><line class="roll-edge" x1="${left}" y1="${rowsBot}" x2="${xOf(end)}" y2="${rowsBot}"/>`;
      // notes (a note running into the next line is drawn up to the line's end and again on the next line)
      for (const n of inLine) {
        const xa = Math.max(xOf(start), xOf(n.col)) + 0.5, xb = Math.min(xOf(end), xOf(n.col + n.len)) - 0.5, y = yOf(n.m);
        g += `<rect class="roll-note t${n.tk}${n.off ? " off" : ""}" x="${xa}" y="${y - bh / 2}" width="${Math.max(2, xb - xa)}" height="${bh}" rx="1.5" fill="${noteFill(n.m, n.tk)}"/>`;
        if (xb - xa >= fs * 2.4 && n.col >= start) g += `<text class="roll-label${n.off ? " off" : ""}" x="${xa + 2}" y="${y + fs * 0.36}" style="font-size:${fs}px" fill="${noteText(n.tk)}">${pitchName(n.m)}</text>`;
      }
      // lyrics
      if (hasLyr) {
        while (li < score.lyrics.length && score.lyrics[li].col < start) li++;
        let lyricEnd = -1e9;
        for (let j = li; j < score.lyrics.length && score.lyrics[j].col < end; j++) {
          const l = score.lyrics[j];
          const w = [...l.text].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 12.5 : 7.2), 0);
          const x = Math.max(xOf(l.col), lyricEnd + 1);
          g += `<text class="lyr" x="${x}" y="${rowsBot + 16}">${esc(l.text)}</text>`;
          lyricEnd = x + w;
        }
      }
      g += `<line class="cursor" x1="0" y1="${rowsTop - 14}" x2="0" y2="${H - 2}" visibility="hidden"/>`;
      parts.push(`<div class="sheet-line roll" data-line="${L}" data-marky="${rowsBot + 4}"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${under}${g}</svg></div>`);
    });
    this.root.innerHTML = parts.join("");
    this.finishRender(54);
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
    const x = geo.x0 + this.pad + ((col - bar.start) / bar.len) * (geo.x1 - geo.x0 - 2 * this.pad);
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
    const x = geo.x0 + this.pad + ((col - bar.start) / bar.len) * (geo.x1 - geo.x0 - 2 * this.pad);
    const svg = this.lines[geo.line].svg;
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("class", `jm ${grade}`);
    c.setAttribute("cx", x);
    c.setAttribute("cy", this.lines[geo.line].markY);
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
    const mark = e.target.closest(".strumchg");
    if (mark) { this.onStrum(+mark.dataset.bar); return; }
    const lineEl = e.target.closest(".sheet-line");
    if (!lineEl || !this.score) return;
    const L = +lineEl.dataset.line;
    const rect = lineEl.querySelector("svg").getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = this.geo.findIndex((g) => g && g.line === L && x >= g.x0 && x < g.x1);
    if (idx < 0) return;
    const bar = this.bars[idx], g = this.geo[idx];
    const frac = Math.min(1, Math.max(0, (x - g.x0 - this.pad) / (g.x1 - g.x0 - 2 * this.pad)));
    const spb = this.score.stepsPerBeat;
    const col = bar.start + Math.floor((frac * bar.len) / spb) * spb;
    this.onSeek(col);
  }
}
