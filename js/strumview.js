// "스트럼 연습" view: right-hand strum patterns without a song, on one chord or a short progression
// (one chord per bar). A bar of metronome clicks with 3, 2, 1, 시작! comes first, then the pattern loops
// until stopped with the current slot lit. Optional: the strum sound, the metronome, +5 BPM every 4 bars,
// and a microphone timing check (strum times only; down and up cannot be told apart by sound).
// 게임 모드 (strumgame.js): a fixed number of bars at a fixed tempo, every strum judged, then a result card.

import { STRUMS, ARROW, countLabels, slotBeat, PROGRESSIONS } from "./strums.js";
import { StrumGame, showStrumResult } from "./strumgame.js";
import { songChords } from "./drills.js";
import { diagramSVG } from "./diagram.js";
import { chordShape, TUNINGS } from "./chords.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* blocked */ } },
};
const ROUND = 4;          // bars per round: speed-up and the microphone score go by rounds
const HIT = 0.1;          // seconds: a strum this close to a slot counts as on time
const MIN_BPM = 40, MAX_BPM = 200;

export class StrumView {
  // deps: {engine, practice, settings, status(msg, err)}
  constructor(root, deps) {
    this.root = root;
    this.d = deps;
    this.run = null;
    this.lastRun = null;
    root.addEventListener("click", (e) => this.click(e));
    root.addEventListener("change", (e) => this.change(e));
    // the tap button reacts on touch-down, not on release, so the timing is what the hand did
    root.addEventListener("pointerdown", (e) => {
      if (!e.target.closest("[data-sv=tap]")) return;
      e.preventDefault();
      if (this.run && this.run.game) this.run.game.tap();
    });
    document.addEventListener("keydown", (e) => this.key(e));
  }

  setScore(score) {
    this.score = score;
    if (!this.root.hidden && !this.run) this.render();
  }

  show(on) {
    this.root.hidden = !on;
    if (on) this.render(); else this.stop();
  }

  // ---------------------------------------------------------------- settings
  pattern() { return STRUMS.find((p) => p.id === store.get("uketab.strum.pattern", "calypso")) || STRUMS[0]; }
  bpm() { return store.get("uketab.strum.bpm", 70); }
  opt(k, d) { return store.get(`uketab.strum.${k}`, d); }
  bests() { return store.get("uketab.strum.best", {}); }

  progressions() {
    const list = PROGRESSIONS.slice();
    const s = this.score;
    if (s) {
      const names = songChords(s).map((c) => c.name).slice(0, 8);
      if (names.length >= 2) list.push({ id: "song", label: `이 곡 코드: ${names.join(" → ")}`, chords: names, song: true });
    }
    return list;
  }
  prog() {
    const all = this.progressions();
    return all.find((p) => p.id === store.get("uketab.strum.prog", "C")) || all[0];
  }

  // shape, tuning and capo for a chord of the chosen progression (the open song's own shapes for "이 곡")
  voicing(name, prog) {
    const s = this.score;
    const tuning = prog.song && s ? s.tuning : "standard";
    const custom = prog.song && s ? s.chordShapes : null;
    const capo = prog.song && s ? s.capo || 0 : 0;
    const sh = chordShape(name, tuning, custom);
    const tun = (TUNINGS[tuning] || TUNINGS.standard).strings;
    return { sh, midis: sh ? sh.frets.map((f, i) => (f < 0 ? null : tun[i] + f + capo)) : null, opts: { tuning, custom, orient: this.d.settings.orient } };
  }

  // ---------------------------------------------------------------- drawing
  render() {
    const p = this.run ? this.run.p : this.pattern();
    const prog = this.run ? this.run.prog : this.prog();
    const bests = this.bests();
    const labels = countLabels(p);
    const r = this.run;
    const bpm = r ? r.bpm : this.bpm();
    const list = STRUMS.map((q) => {
      const b = bests[q.id];
      const rec = b && b.best ? `최고 ${b.best} BPM` : b && b.last ? `지난번 ${b.last} BPM` : "";
      return `<button type="button" class="sv-item${q.id === p.id ? " cur" : ""}" data-pat="${q.id}" ${r ? "disabled" : ""}>
        <b>${esc(q.name)}</b><span class="sv-mini">${[...q.slots].map((c) => ARROW[c]).join("")}</span><small>${rec}</small></button>`;
    }).join("");
    const groups = [];
    for (let b = 0; b < p.beats; b++) {
      groups.push(`<div class="sv-beat">${Array.from({ length: p.sub }, (_, k) => {
        const i = b * p.sub + k, c = p.slots[i];
        return `<div class="sv-slot ${c === "-" ? "rest" : c === "X" ? "chuck" : ""}" data-i="${i}"><b>${ARROW[c]}</b><small>${esc(labels[i])}</small></div>`;
      }).join("")}</div>`);
    }
    const progOpts = this.progressions().map((q) => `<option value="${q.id}" ${q.id === prog.id ? "selected" : ""}>${esc(q.label)}</option>`).join("");
    const first = prog.chords[0], second = prog.chords[1 % prog.chords.length];
    const v1 = this.voicing(first, prog), v2 = this.voicing(second, prog);
    const mic = this.opt("mic", false);
    const game = this.opt("game", false);
    const gin = this.opt("ginput", "mic"), gmode = this.opt("gmode", "std"), gbars = this.opt("gbars", 8);
    const opts = game ? `
            <label><input type="checkbox" data-sv="sound" ${this.opt("sound", true) ? "checked" : ""}> 스트럼 소리</label>
            <label><input type="checkbox" data-sv="metro" ${this.opt("metro", true) ? "checked" : ""}> 메트로놈</label>
            <label>길이 <select data-sv="gbars" ${r ? "disabled" : ""}>${[4, 8, 16].map((n) => `<option value="${n}" ${n === gbars ? "selected" : ""}>${n}마디</option>`).join("")}</select></label>
            <span class="sv-modes" role="group" aria-label="난이도">${[["easy", "쉬움"], ["std", "보통"], ["pro", "어려움"]].map(([k, t]) =>
              `<button type="button" class="toggle" data-sv="gmode" data-v="${k}" aria-pressed="${k === gmode}" ${r ? "disabled" : ""}>${t}</button>`).join("")}</span>
            <label>입력 <select data-sv="ginput" ${r ? "disabled" : ""}><option value="mic" ${gin === "mic" ? "selected" : ""}>마이크</option><option value="keys" ${gin === "keys" ? "selected" : ""}>탭·키보드</option></select></label>` : `
            <label><input type="checkbox" data-sv="sound" ${this.opt("sound", true) ? "checked" : ""}> 스트럼 소리</label>
            <label><input type="checkbox" data-sv="metro" ${this.opt("metro", true) ? "checked" : ""}> 메트로놈</label>
            <label><input type="checkbox" data-sv="faster4" ${this.opt("faster4", false) ? "checked" : ""}> 4마디마다 +5 BPM</label>
            <label><input type="checkbox" data-sv="mic" ${mic ? "checked" : ""} ${r ? "disabled" : ""}> 마이크로 박자 확인</label>`;
    const hint = game
      ? gin === "mic" ? "마이크는 친 시각만 판정함. 다운과 업은 구분 못 함. 스트럼 소리를 끄거나 이어폰을 쓰면 판정이 정확함."
        : "칠 때마다 아래 버튼을 누르거나 Space·F·J를 누름. 시각만 판정함."
      : mic ? "마이크는 친 시각만 들음. 다운과 업은 구분 못 하고, 약한 업은 놓칠 수 있음. 스트럼 소리를 끄거나 이어폰을 쓰면 판정이 정확함." : "";
    const st = r && r.game ? r.game.stats : null;
    const counts = game ? `<div class="g-counts sv-counts">
            <span class="perfect">Perfect <b data-c="perfect">${st ? st.perfect : 0}</b></span><span class="ok">Ok <b data-c="ok">${st ? st.ok : 0}</b></span>
            <span class="bad">Bad <b data-c="bad">${st ? st.bad : 0}</b></span><span class="miss">Miss <b data-c="miss">${st ? st.miss : 0}</b></span>
            <span>콤보 <b data-c="combo">${st ? st.combo : 0}</b></span><span>점수 <b data-c="score">${st ? st.score : 0}</b></span></div>` : "";
    this.root.innerHTML = `
      <div class="dr-head"><h2>스트럼 연습</h2><span class="sub">${p.beats === 2 && p.sub === 3 ? "6/8" : `${p.beats}/4`}${p.swing ? " · shuffle" : ""}</span></div>
      <div class="sv-layout">
        <div class="sv-list" aria-label="스트럼 패턴">${list}</div>
        <div class="sv-main">
          <div class="sv-name">${esc(p.name)}</div>
          <div class="sv-patwrap">
            ${game ? `<div class="sv-hud"><span class="sv-progress">${this.progressText()}</span><span class="g-judge" aria-live="polite"></span></div>` : ""}
            <div class="sv-pat${p.swing ? " swing" : ""}" aria-label="패턴">${groups.join("")}</div>
            <div class="g-combo" aria-hidden="true"></div>
          </div>
          <p class="dr-desc">${esc(p.desc)}</p>
          <div class="dr-row sv-ctl">
            <label>코드 <select data-sv="prog" ${r ? "disabled" : ""}>${progOpts}</select></label>
            <span class="sv-bpm" role="group" aria-label="빠르기">
              <button type="button" data-sv="slower" aria-label="느리게" ${r && r.game ? "disabled" : ""}>−</button>
              <b class="sv-bpm-val">${bpm}</b> BPM
              <button type="button" data-sv="faster" aria-label="빠르게" ${r && r.game ? "disabled" : ""}>+</button>
            </span>
            <button type="button" class="toggle game-btn" data-sv="game" aria-pressed="${game}" ${r ? "disabled" : ""}>게임 모드</button>
            <button type="button" class="primary sv-go" data-sv="go">${r ? "멈춤" : game ? "게임 시작" : "시작"}</button>
          </div>
          <div class="dr-row sv-opts">${opts}
          </div>
          ${hint ? `<p class="sv-hint">${hint}</p>` : ""}
          ${counts}
          ${game && gin === "keys" ? `<button type="button" class="sv-tap" data-sv="tap" ${r && r.game ? "" : "disabled"}>치기</button>` : ""}
          <div class="sv-stage">
            <div class="dr-now" data-name="${esc(first)}">${v1.sh ? diagramSVG(first, { ...v1.opts, size: 150 }) : `<b>${esc(first)}</b>`}</div>
            <div class="dr-next"${prog.chords.length < 2 ? " hidden" : ""}><small>다음</small>${v2.sh ? diagramSVG(second, { ...v2.opts, size: 84 }) : ""}</div>
            <div class="dr-tally sv-tally" aria-live="polite">${this.tallyText()}</div>
          </div>
        </div>
      </div>`;
  }

  tallyText() {
    const r = this.run || this.lastRun;
    if (!r || r.curBar < 0) return "";
    const bars = r.curBar + 1;
    if (r.game) return `${Math.min(bars, r.game.bars)} / ${r.game.bars}마디 · ${r.bpm} BPM`;
    let t = `${bars}마디 · ${r.bpm} BPM`;
    if (r.useMic) {
      const cur = r.rounds[r.rounds.length - 1];
      const done = r.rounds.filter((x) => x.final);
      if (done.length) t += `<br>지난 ${ROUND}마디 박자 ${done[done.length - 1].acc}%`;
      else if (cur && cur.judged) t += `<br>박자 ${Math.round((cur.hits / cur.judged) * 100)}%`;
    }
    return t;
  }

  progressText() {
    const r = this.run;
    if (!r || !r.game) return `${this.opt("gbars", 8)}마디`;
    return r.curBar < 0 ? "준비" : `${Math.min(r.curBar + 1, r.game.bars)} / ${r.game.bars}마디`;
  }

  // ---------------------------------------------------------------- running
  async start() {
    if (this.starting) return;
    const eng = this.d.engine;
    eng.ensure();
    const game = this.opt("game", false);
    const useMic = game ? this.opt("ginput", "mic") === "mic" : this.opt("mic", false);
    const pr = this.d.practice;
    if (useMic) {
      if (pr.on) { this.d.status("악보 탭의 게임 모드가 켜져 있으면 마이크를 못 씀. 그쪽 게임 모드를 먼저 끄세요", true); return; }
      pr.input = "mic";
      this.starting = true;
      const ok = await pr.ensureMic();
      this.starting = false;
      if (!ok) { if (game) { store.set("uketab.strum.ginput", "keys"); this.render(); } return; }
      pr.mic.an.takeOnsets();
    }
    const p = this.pattern(), prog = this.prog();
    const beat = 60 / this.bpm();
    const t0 = eng.ctx.currentTime + 0.4;
    const r = {
      p, prog, useMic: useMic && !game, bpm: this.bpm(), bpm0: this.bpm(),
      bars: [], next: { bar: 0, slot: 0 }, curBar: -1, curSlot: -1,
      strokes: [], rounds: [], voices: [null, null, null, null], timers: [],
      firstBar: t0 + 4 * beat,
    };
    if (game) {
      const ui = {
        mark: (bar, i, grade) => {
          if (bar !== r.curBar) return;
          const el = this.root.querySelector(`.sv-slot[data-i="${i}"]`);
          if (!el) return;
          el.classList.remove("g-perfect", "g-ok", "g-bad", "g-miss", "burst");
          void el.offsetWidth;   // restart the burst animation
          el.classList.add(`g-${grade}`, "burst");
        },
        hud: () => {
          const st = r.game.stats;
          for (const k of ["perfect", "ok", "bad", "miss", "combo", "score"]) {
            const el = this.root.querySelector(`.sv-counts [data-c=${k}]`);
            if (el) el.textContent = String(st[k]);
          }
        },
      };
      r.game = new StrumGame({ engine: eng, practice: pr, mode: this.opt("gmode", "std"), input: useMic ? "mic" : "keys", bars: this.opt("gbars", 8), ui });
    }
    this.run = r;
    // count-in: four clicks with 3, 2, 1, 시작!
    const cd = document.querySelector(".countdown");
    ["3", "2", "1", "시작!"].forEach((txt, k) => {
      eng.click(t0 + k * beat, k === 0);
      r.timers.push(setTimeout(() => {
        if (!cd || this.run !== r) return;
        cd.hidden = false;
        cd.innerHTML = `<b class="${k === 3 ? "go" : ""}">${txt}</b>`;
      }, (t0 + k * beat - eng.ctx.currentTime) * 1000));
    });
    r.timers.push(setTimeout(() => { if (cd) { cd.hidden = true; cd.innerHTML = ""; } }, (r.firstBar - eng.ctx.currentTime) * 1000 + 350));
    this.render();
    // Space on a focused button would press it again instead of counting as a strum
    if (r.game && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const tick = () => {
      if (this.run !== r) return;
      const now = eng.ctx.currentTime;
      this.schedule(r, now + 0.2);
      if (r.useMic) this.judge(r, now);
      this.paint(r, now);
      if (r.game) {
        r.game.update(now);
        r.game.drawJudge(this.root.querySelector(".sv-hud .g-judge"), this.root.querySelector(".sv-patwrap .g-combo"));
        if (r.game.done(r.next.bar >= r.game.bars)) { this.finishGame(r); return; }
      }
      r.timer = setTimeout(tick, 25);
    };
    tick();
  }

  // bar k starts where bar k-1 ends; the tempo can step up at round boundaries
  bar(r, k) {
    while (r.bars.length <= k) {
      const i = r.bars.length;
      const prev = r.bars[i - 1];
      let bpm = prev ? prev.bpm : r.bpm;
      if (r.setBpm) { bpm = r.setBpm; r.setBpm = 0; }
      else if (!r.game && i > 0 && i % ROUND === 0 && this.opt("faster4", false) && bpm < MAX_BPM) {
        // with the microphone only after a round played on time (strums not judged yet are left out)
        const rd = r.rounds[i / ROUND - 1];
        if (!r.useMic || (rd && rd.judged && rd.hits / rd.judged >= 0.8)) bpm = Math.min(MAX_BPM, bpm + 5);
      }
      const beat = 60 / bpm;
      const start = prev ? prev.start + r.p.beats * prev.beat : r.firstBar;
      r.bars.push({ start, beat, bpm, chord: r.prog.chords[i % r.prog.chords.length] });
    }
    return r.bars[k];
  }

  schedule(r, horizon) {
    const eng = this.d.engine, p = r.p;
    const sound = this.opt("sound", true), metro = this.opt("metro", true);
    for (let guard = 0; guard < 200; guard++) {
      if (r.game && r.next.bar >= r.game.bars) break;
      const b = this.bar(r, r.next.bar);
      const i = r.next.slot;
      const pos = slotBeat(p, i);
      const when = b.start + pos * b.beat;
      if (when > horizon) break;
      if (metro && i % p.sub === 0) eng.click(when, i === 0);
      const c = p.slots[i];
      if (c !== "-") {
        if (sound) this.stroke(r, c, b, when, i % p.sub === 0);
        if (r.useMic) r.strokes.push({ t: when, bar: r.next.bar, i, hit: false, done: false });
        if (r.game) r.game.add(when, r.next.bar, i);
      }
      r.next.slot++;
      if (r.next.slot >= p.slots.length) { r.next.slot = 0; r.next.bar++; }
    }
  }

  // one strum of the chord: down/up rings, the old sound on each string stops; a chuck mutes everything
  stroke(r, c, b, when, onBeat) {
    const eng = this.d.engine;
    if (c === "X") {
      r.voices.forEach((v) => v && v.stop(when));
      this.chuck(when);
      return;
    }
    const { midis } = this.voicing(b.chord, r.prog);
    if (!midis) return;
    const order = c === "D" ? [0, 1, 2, 3] : [3, 2, 1, 0];
    const vel = c === "U" ? 0.13 : onBeat ? 0.24 : 0.19;
    order.forEach((s, k) => {
      if (midis[s] === null) return;
      const t = when + k * 0.012;
      const old = r.voices[s];
      if (old && old.end > t) old.stop(t);
      r.voices[s] = eng.note(midis[s], t, b.beat * 1.8, vel, eng.chordBus);
    });
  }

  // muted strum: a short band of noise
  chuck(when) {
    const eng = this.d.engine, ctx = eng.ctx;
    if (!this.noise) {
      const n = Math.floor(ctx.sampleRate * 0.06);
      this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n / 6));
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1800;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = 0.7;
    src.connect(f).connect(g).connect(eng.chordBus);
    src.start(when);
  }

  // match microphone onsets to the expected strums of the pattern
  judge(r, now) {
    const pr = this.d.practice;
    if (!pr.mic) return;
    const an = pr.mic.an;
    const off = pr.offsetMs / 1000;
    for (const o of an.takeOnsets()) {
      const t = o.t - off;
      let best = null, bd = HIT;
      for (const s of r.strokes) {
        if (s.hit) continue;
        const d = Math.abs(s.t - t);
        if (d <= bd) { bd = d; best = s; }
      }
      if (best) best.hit = true;
    }
    // strums whose window has passed are final
    const heardUntil = an.lastT - off;
    for (const s of r.strokes) {
      if (s.done || (!s.hit && heardUntil < s.t + HIT + 0.06)) continue;
      s.done = true;
      const k = Math.floor(s.bar / ROUND);
      const rd = r.rounds[k] || (r.rounds[k] = { hits: 0, judged: 0, final: false, acc: 0 });
      rd.judged++;
      if (s.hit) rd.hits++;
      if (s.bar === r.curBar) {
        const el = this.root.querySelector(`.sv-slot[data-i="${s.i}"]`);
        if (el) el.classList.add(s.hit ? "hit" : "miss");
      }
    }
    r.strokes = r.strokes.filter((s) => !s.done);
    // a round is over when all its strums are judged and the next round has started
    r.rounds.forEach((rd, k) => {
      if (rd.final || r.curBar < (k + 1) * ROUND || r.strokes.some((s) => Math.floor(s.bar / ROUND) === k)) return;
      rd.final = true;
      rd.acc = rd.judged ? Math.round((rd.hits / rd.judged) * 100) : 0;
      const bpm = this.bar(r, k * ROUND).bpm;
      if (rd.acc >= 80) this.saveBest(r.p.id, { best: bpm });
    });
  }

  // light the current slot, change the chord pictures at bar lines
  paint(r, now) {
    let k = r.curBar;
    const last = r.game ? r.game.bars - 1 : Infinity;
    while (k < last && r.bars[k + 1] && r.bars[k + 1].start <= now) k++;
    if (k < 0) return;
    const b = r.bars[k];
    let i = -1;
    for (let j = 0; j < r.p.slots.length; j++) if (b.start + slotBeat(r.p, j) * b.beat <= now) i = j;
    if (k === last && now >= b.start + r.p.beats * b.beat) i = -1;   // the round is over
    if (k !== r.curBar) {
      r.curBar = k;
      const nxt = (r.bars[k + 1] || (k < last ? this.bar(r, k + 1) : b)).chord;
      const now_ = this.root.querySelector(".dr-now");
      if (now_ && now_.dataset.name !== b.chord) {
        now_.dataset.name = b.chord;
        const v = this.voicing(b.chord, r.prog);
        now_.innerHTML = v.sh ? diagramSVG(b.chord, { ...v.opts, size: 150 }) : `<b>${esc(b.chord)}</b>`;
      }
      const nx = this.root.querySelector(".dr-next");
      if (nx && r.prog.chords.length > 1 && k < last) {
        const v = this.voicing(nxt, r.prog);
        nx.innerHTML = `<small>다음</small>${v.sh ? diagramSVG(nxt, { ...v.opts, size: 84 }) : ""}`;
      }
      this.root.querySelectorAll(".sv-slot").forEach((el) => el.classList.remove("hit", "miss", "g-perfect", "g-ok", "g-bad", "g-miss", "burst"));
      const pg = this.root.querySelector(".sv-progress");
      if (pg) pg.textContent = this.progressText();
      const bv = this.root.querySelector(".sv-bpm-val");
      if (bv) bv.textContent = String(b.bpm);
      r.bpm = b.bpm;
      const t = this.root.querySelector(".sv-tally");
      if (t) t.innerHTML = this.tallyText();
    }
    if (i !== r.curSlot) {
      r.curSlot = i;
      this.root.querySelectorAll(".sv-slot").forEach((el) => el.classList.toggle("on", +el.dataset.i === i));
    }
  }

  finishGame(r) {
    const info = { pattern: r.p, bpm: r.bpm, bars: r.game.bars, chords: r.prog.label };
    this.stop();
    this.render();
    const res = showStrumResult(r.game, info, () => this.start());
    if (res && res.acc >= 80) { this.saveBest(r.p.id, { best: r.bpm }); this.render(); }
  }

  saveBest(id, rec) {
    const all = this.bests();
    const old = all[id] || {};
    all[id] = { ...old, ...rec, best: Math.max(old.best || 0, rec.best || 0) || undefined };
    store.set("uketab.strum.best", all);
  }

  stop() {
    const r = this.run;
    if (!r) return;
    clearTimeout(r.timer);
    r.timers.forEach(clearTimeout);
    const t = this.d.engine.ctx ? this.d.engine.ctx.currentTime : 0;
    r.voices.forEach((v) => v && v.stop(t));
    const cd = document.querySelector(".countdown");
    if (cd) { cd.hidden = true; cd.innerHTML = ""; }
    if (r.curBar >= 0) this.saveBest(r.p.id, { last: r.bpm });
    this.lastRun = r;
    this.run = null;
  }

  // ---------------------------------------------------------------- events
  click(e) {
    const item = e.target.closest("[data-pat]");
    if (item) {
      if (this.run) return;
      store.set("uketab.strum.pattern", item.dataset.pat);
      this.lastRun = null;
      this.render();
      return;
    }
    const b = e.target.closest("button[data-sv]");
    if (!b) return;
    const act = b.dataset.sv;
    if (act === "go") { if (this.run) { this.stop(); this.render(); } else this.start(); }
    else if (act === "game") { store.set("uketab.strum.game", !this.opt("game", false)); this.lastRun = null; this.render(); }
    else if (act === "gmode") { store.set("uketab.strum.gmode", b.dataset.v); this.render(); }
    else if (act === "slower" || act === "faster") {
      const v = Math.max(MIN_BPM, Math.min(MAX_BPM, this.bpm() + (act === "faster" ? 5 : -5)));
      store.set("uketab.strum.bpm", v);
      if (this.run) {
        // from the next bar that is not scheduled yet
        const r = this.run;
        r.bars.length = Math.min(r.bars.length, r.next.bar + 1);
        r.setBpm = v;
      }
      const bv = this.root.querySelector(".sv-bpm-val");
      if (bv) bv.textContent = String(v);
    }
  }

  change(e) {
    const el = e.target.closest("[data-sv]");
    if (!el) return;
    const k = el.dataset.sv;
    if (k === "prog") store.set("uketab.strum.prog", el.value);
    if (k === "gbars") store.set("uketab.strum.gbars", +el.value);
    if (k === "ginput") store.set("uketab.strum.ginput", el.value);
    if (k === "sound" || k === "metro" || k === "faster4" || k === "mic") store.set(`uketab.strum.${k}`, el.checked);
    if (!this.run) this.render();
  }

  key(e) {
    if (this.root.hidden || e.repeat || e.target.closest("input, select, textarea, dialog")) return;
    const r = this.run;
    // game with tap input: Space, F, J (also D, K) are strums, Esc stops
    if (r && r.game && r.game.input === "keys") {
      if ([" ", "f", "j", "d", "k", "F", "J", "D", "K"].includes(e.key)) { e.preventDefault(); r.game.tap(); }
      else if (e.key === "Escape") { this.stop(); this.render(); }
      return;
    }
    if (e.key !== " " || e.target.closest("button")) return;
    e.preventDefault();
    if (r) { this.stop(); this.render(); } else this.start();
  }
}
