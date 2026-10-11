// Game mode of "스트럼 연습": a fixed number of bars of the chosen pattern, every D/U/X slot is a target,
// judged Perfect / Ok / Bad / Miss on timing only (the same windows as the song game mode). Input is the
// microphone (strum onsets) or taps / keys. At the end a result card, saved with the other game records.

import { TIMING } from "./practice.js";
import { records, rankOf } from "./records.js";

const ACC = { perfect: 1, ok: 2 / 3, bad: 1 / 3, miss: 0 };
const LABEL = { perfect: "PERFECT", ok: "OK", bad: "BAD", miss: "MISS" };
const MODE_NAME = { easy: "쉬움", std: "보통", pro: "어려움" };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// With a speaker, the metronome clicks come back through the microphone right on the beats and were counted
// as strums. During the count-in the player waits, so the onsets heard right after the four count-in clicks
// are our own clicks: from them come how late the microphone hears what the app plays (used as the 싱크 for
// this run) and how strong a click sounds there. Later onsets right on a click that are not clearly stronger
// than that (and a quiet click heard only now and then is never as strong as a strum: below CLICK_F it is
// dropped even when the count-in caught nothing).
const CLICK_F = 40;
export class ClickBleed {
  constructor() {
    this.clicks = [];         // {t, countIn} audio-clock times of our clicks
    this.seen = [];           // count-in: {d: delay, f: onset strength}
    this.latency = null;      // seconds, once learned
    this.strength = 0;
  }

  add(t, countIn) {
    this.clicks.push({ t, countIn });
    if (this.clicks.length > 80) this.clicks.splice(this.clicks.findIndex((c) => !c.countIn), 1);
  }

  // onset {t: raw audio-clock time, f: strength} -> time corrected by the microphone delay, or null to drop it
  filter(o, storedOff) {
    const ci = this.clicks.find((c) => c.countIn && o.t >= c.t - 0.03 && o.t - c.t < 0.3);
    if (ci) {
      this.seen.push({ d: o.t - ci.t, f: o.f || 0 });
      this.learn();
      return null;
    }
    // right on one of our clicks, in microphone time: the learned delay, or anything a microphone could add
    const lat = this.latency;
    const onClick = this.clicks.some((c) => !c.countIn && (lat !== null ? Math.abs(o.t - c.t - lat) < 0.04 : o.t >= c.t - 0.03 && o.t - c.t < 0.25));
    if (onClick && o.f < Math.max(CLICK_F, this.strength * 2.5)) return null;
    return o.t - this.offset(storedOff);
  }

  offset(storedOff) { return this.latency ?? storedOff; }

  learn() {
    if (this.seen.length < 2) return;
    const q = (a, p) => a[Math.floor((a.length - 1) * p)];
    const ds = this.seen.map((x) => x.d).sort((a, b) => a - b);
    // our own clicks come back with the same delay each time; strums during the count-in would not
    if (q(ds, 0.75) - q(ds, 0.25) > 0.025) return;
    this.latency = q(ds, 0.5);
    this.strength = q(this.seen.map((x) => x.f).sort((a, b) => a - b), 0.5);
  }
}

export class StrumGame {
  // opts: {engine, practice, mode: "easy"|"std"|"pro", input: "mic"|"keys", bars, gate (ClickBleed, microphone),
  //        ui: {mark(bar, i, grade), hud()}}
  constructor(opts) {
    Object.assign(this, opts);
    this.targets = [];        // {t, bar, i, win, grade}
    this.open = 0;            // index of the first target not judged yet
    this.stats = { perfect: 0, ok: 0, bad: 0, miss: 0, early: 0, late: 0, combo: 0, maxCombo: 0, score: 0, accSum: 0, n: 0 };
    this.flash = null;
    this.milestone = null;
  }

  // targets come in time order from the scheduler; a window never reaches past half the gap to a neighbour,
  // so one strum cannot be counted for two slots
  add(t, bar, i) {
    const full = TIMING[this.mode][2] / 1000;
    const prev = this.targets[this.targets.length - 1];
    const g = { t, bar, i, win: full, grade: null };
    if (prev) {
      const half = (t - prev.t) / 2;
      prev.win = Math.min(prev.win, half);
      g.win = Math.min(full, half);
    }
    this.targets.push(g);
  }

  // a strum heard or tapped at audio-clock time t
  hit(t) {
    let best = null, bd = Infinity;
    for (let k = this.open; k < this.targets.length; k++) {
      const g = this.targets[k];
      if (g.grade) continue;
      const d = t - g.t;
      if (d < -g.win) break;
      if (Math.abs(d) <= g.win && Math.abs(d) < bd) { best = g; bd = Math.abs(d); }
    }
    if (best) this.judge(best, t - best.t);
  }

  // taps: the sound comes out of the speaker a little after its audio-clock time
  tap() {
    const ctx = this.engine.ctx;
    this.hit(ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0));
  }

  judge(g, d) {
    const w = TIMING[this.mode];
    const a = Math.abs(d) * 1000;
    const grade = this.mode === "easy" ? "perfect" : a <= w[0] ? "perfect" : a <= w[1] ? "ok" : "bad";
    this.count(g, grade, d);
  }

  count(g, grade, d = 0) {
    g.grade = grade;
    const st = this.stats;
    st[grade]++;
    st.n++;
    st.accSum += ACC[grade];
    if (grade !== "miss" && grade !== "perfect") d < 0 ? st.early++ : st.late++;
    const breaks = this.mode === "pro" ? grade === "bad" || grade === "miss" : grade === "miss";
    st.combo = breaks ? 0 : st.combo + 1;
    st.maxCombo = Math.max(st.maxCombo, st.combo);
    st.score += Math.round(100 * ACC[grade]);
    this.flash = { grade, sub: grade !== "miss" && grade !== "perfect" ? (d < 0 ? "EARLY" : "LATE") : "", t: performance.now(), combo: st.combo };
    if (st.combo && (st.combo === 10 || st.combo === 20 || st.combo === 30 || st.combo % 50 === 0)) this.milestone = { n: st.combo, t: performance.now() };
    this.ui.mark(g.bar, g.i, grade);
    this.ui.hud();
  }

  // every tick: microphone onsets, targets whose window has passed
  update(now) {
    let heard = now;
    if (this.input === "mic" && this.practice.mic) {
      const an = this.practice.mic.an;
      const stored = this.practice.offsetMs / 1000;
      for (const o of an.takeOnsets()) {
        const t = this.gate ? this.gate.filter(o, stored) : o.t - stored;
        if (t !== null) this.hit(t);
      }
      heard = an.lastT - (this.gate ? this.gate.offset(stored) : stored);
    }
    for (let k = this.open; k < this.targets.length; k++) {
      const g = this.targets[k];
      if (g.grade) continue;
      // wait for the microphone to deliver the sound of the window, but not forever if it stalls
      if (Math.min(now, heard) > g.t + g.win + 0.03 || now > g.t + g.win + 0.6) this.count(g, "miss");
      else break;
    }
    while (this.open < this.targets.length && this.targets[this.open].grade) this.open++;
  }

  // all targets of the round are scheduled and judged
  done(scheduled) { return scheduled && this.targets.length > 0 && this.open >= this.targets.length; }

  result() {
    const st = this.stats;
    const acc = st.n ? Math.round((st.accSum / st.n) * 1000) / 10 : 0;
    return { ...st, acc, tacc: acc, total: this.targets.length, fullCombo: st.n > 0 && st.miss === 0 && (this.mode !== "pro" || st.bad === 0) };
  }

  // the judgement text and combo banner over the pattern
  drawJudge(el, banner) {
    const f = this.flash;
    const age = f ? performance.now() - f.t : 1e9;
    if (el) {
      if (!f || age > 700) { if (el.dataset.shown) { el.innerHTML = ""; el.dataset.shown = ""; } }
      else {
        if (el.dataset.shown !== String(f.t)) {
          el.dataset.shown = String(f.t);
          el.className = `g-judge ${f.grade}`;
          void el.offsetWidth;   // restart the animation
          el.classList.add("pop");
          el.innerHTML = `<b>${LABEL[f.grade]}</b>${f.sub ? `<small>${f.sub}</small>` : ""}${f.combo > 1 ? `<i>${f.combo} COMBO</i>` : ""}`;
        }
        el.style.opacity = String(Math.max(0, 1 - age / 700));
      }
    }
    const m = this.milestone;
    if (banner) {
      const mAge = m ? performance.now() - m.t : 1e9;
      if (mAge < 1100) {
        if (banner.dataset.n !== String(m.n) + m.t) {
          banner.dataset.n = String(m.n) + m.t;
          banner.textContent = `콤보 ${m.n}!`;
          banner.classList.remove("show");
          void banner.offsetWidth;
          banner.classList.add("show");
        }
      } else if (banner.classList.contains("show")) banner.classList.remove("show");
    }
  }
}

// result card; saves the round with the song game records. info: {pattern, bpm, bars, chords}
export function showStrumResult(game, info, onAgain) {
  const r = game.result();
  if (!r.n) return null;
  const target = `${info.bpm} BPM · ${info.bars}마디${game.input === "keys" ? " · 탭" : ""}`;
  const rec = {
    time: Date.now(), song: `strum.${info.pattern.id}`, title: `스트럼: ${info.pattern.name}`, artist: "스트럼 연습",
    mode: game.mode, target, rate: 1, score: r.score, acc: r.acc, tacc: r.tacc, maxCombo: r.maxCombo,
    perfect: r.perfect, ok: r.ok, bad: r.bad, miss: r.miss, early: r.early, late: r.late, n: r.n, total: r.total, fullCombo: r.fullCombo,
  };
  const prevBest = records.add(rec);
  let dlg = document.querySelector(".dlg-sgresult");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.className = "dlg-sgresult";
    dlg.innerHTML = `<form method="dialog"><h2>게임 결과</h2><div class="gr-meta"></div><div class="gr-grid"></div>
      <div class="row end gr-btns"><button type="button" class="primary" data-sg="again">다시</button><button value="close">닫기</button></div></form>`;
    document.body.appendChild(dlg);
    dlg.querySelector("[data-sg=again]").addEventListener("click", () => { dlg.close(); if (dlg.onAgain) dlg.onAgain(); });
  }
  dlg.onAgain = onAgain;
  const rank = rankOf(r.acc);
  const best = prevBest === null ? "" : r.score > prevBest ? `<span class="gr-best">최고 기록! +${r.score - prevBest}</span>`
    : `<span class="hint">같은 패턴·빠르기·길이 최고 ${prevBest}점</span>`;
  dlg.querySelector(".gr-meta").innerHTML = `<span class="gr-rank ${rank}">${rank}</span>${esc(info.pattern.name)} · ${target} · ${MODE_NAME[game.mode]} · ${esc(info.chords)}` +
    (r.fullCombo ? `<span class="gr-badge">FULL COMBO</span>` : "") + best +
    (records.session() ? "" : ` <span class="hint">이 브라우저에만 저장됨. 로그인하면 계정에 올라감</span>`);
  const cell = (label, v, cls = "") => `<div><small>${label}</small><b class="${cls}">${v}</b></div>`;
  dlg.querySelector(".gr-grid").innerHTML = [
    cell("정확도", `${r.acc}%`), cell("점수", r.score), cell("최대 콤보", r.maxCombo), cell("판정한 수", `${r.n}/${r.total}`),
    cell("Perfect", r.perfect, "perfect"), cell("Ok", r.ok, "ok"), cell("Bad", r.bad, "bad"), cell("Miss", r.miss, "miss"),
    cell("빠름 (EARLY)", r.early), cell("늦음 (LATE)", r.late),
  ].join("");
  dlg.showModal();
  return r;
}
