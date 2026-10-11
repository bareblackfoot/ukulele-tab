// "스트럼 연습" view: right-hand strum patterns without a song, on one chord or a short progression
// (one chord per bar). A bar of metronome clicks with 3, 2, 1, 시작! comes first, then the pattern loops
// until stopped with the current slot lit. Optional: the strum sound, the metronome, +5 BPM every 4 bars,
// and a microphone timing check (strum times only; down and up cannot be told apart by sound).

import { STRUMS, ARROW, countLabels, slotBeat, PROGRESSIONS } from "./strums.js";
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
    this.root.innerHTML = `
      <div class="dr-head"><h2>스트럼 연습</h2><span class="sub">${p.beats === 2 && p.sub === 3 ? "6/8" : `${p.beats}/4`}${p.swing ? " · shuffle" : ""}</span></div>
      <div class="sv-layout">
        <div class="sv-list" aria-label="스트럼 패턴">${list}</div>
        <div class="sv-main">
          <div class="sv-name">${esc(p.name)}</div>
          <div class="sv-pat${p.swing ? " swing" : ""}" aria-label="패턴">${groups.join("")}</div>
          <p class="dr-desc">${esc(p.desc)}</p>
          <div class="dr-row sv-ctl">
            <label>코드 <select data-sv="prog" ${r ? "disabled" : ""}>${progOpts}</select></label>
            <span class="sv-bpm" role="group" aria-label="빠르기">
              <button type="button" data-sv="slower" aria-label="느리게">−</button>
              <b class="sv-bpm-val">${bpm}</b> BPM
              <button type="button" data-sv="faster" aria-label="빠르게">+</button>
            </span>
            <button type="button" class="primary sv-go" data-sv="go">${r ? "멈춤" : "시작"}</button>
          </div>
          <div class="dr-row sv-opts">
            <label><input type="checkbox" data-sv="sound" ${this.opt("sound", true) ? "checked" : ""}> 스트럼 소리</label>
            <label><input type="checkbox" data-sv="metro" ${this.opt("metro", true) ? "checked" : ""}> 메트로놈</label>
            <label><input type="checkbox" data-sv="faster4" ${this.opt("faster4", false) ? "checked" : ""}> 4마디마다 +5 BPM</label>
            <label><input type="checkbox" data-sv="mic" ${mic ? "checked" : ""} ${r ? "disabled" : ""}> 마이크로 박자 확인</label>
          </div>
          ${mic ? `<p class="sv-hint">마이크는 친 시각만 들음. 다운과 업은 구분 못 하고, 약한 업은 놓칠 수 있음. 스트럼 소리를 끄거나 이어폰을 쓰면 판정이 정확함.</p>` : ""}
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
    let t = `${bars}마디 · ${r.bpm} BPM`;
    if (r.useMic) {
      const cur = r.rounds[r.rounds.length - 1];
      const done = r.rounds.filter((x) => x.final);
      if (done.length) t += `<br>지난 ${ROUND}마디 박자 ${done[done.length - 1].acc}%`;
      else if (cur && cur.judged) t += `<br>박자 ${Math.round((cur.hits / cur.judged) * 100)}%`;
    }
    return t;
  }

  // ---------------------------------------------------------------- running
  async start() {
    if (this.starting) return;
    const eng = this.d.engine;
    eng.ensure();
    const useMic = this.opt("mic", false);
    const pr = this.d.practice;
    if (useMic) {
      if (pr.on) { this.d.status("게임 모드가 켜져 있으면 마이크 확인을 못 함. 게임 모드를 먼저 끄세요", true); return; }
      pr.input = "mic";
      this.starting = true;
      const ok = await pr.ensureMic();
      this.starting = false;
      if (!ok) return;
      pr.mic.an.takeOnsets();
    }
    const p = this.pattern(), prog = this.prog();
    const beat = 60 / this.bpm();
    const t0 = eng.ctx.currentTime + 0.4;
    const r = {
      p, prog, useMic, bpm: this.bpm(), bpm0: this.bpm(),
      bars: [], next: { bar: 0, slot: 0 }, curBar: -1, curSlot: -1,
      strokes: [], rounds: [], voices: [null, null, null, null], timers: [],
      firstBar: t0 + 4 * beat,
    };
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
    const tick = () => {
      if (this.run !== r) return;
      const now = eng.ctx.currentTime;
      this.schedule(r, now + 0.2);
      if (r.useMic) this.judge(r, now);
      this.paint(r, now);
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
      else if (i > 0 && i % ROUND === 0 && this.opt("faster4", false) && bpm < MAX_BPM) {
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
    while (r.bars[k + 1] && r.bars[k + 1].start <= now) k++;
    if (k < 0) return;
    const b = r.bars[k];
    let i = -1;
    for (let j = 0; j < r.p.slots.length; j++) if (b.start + slotBeat(r.p, j) * b.beat <= now) i = j;
    if (k !== r.curBar) {
      r.curBar = k;
      const nxt = this.bar(r, k + 1).chord;
      const now_ = this.root.querySelector(".dr-now");
      if (now_ && now_.dataset.name !== b.chord) {
        now_.dataset.name = b.chord;
        const v = this.voicing(b.chord, r.prog);
        now_.innerHTML = v.sh ? diagramSVG(b.chord, { ...v.opts, size: 150 }) : `<b>${esc(b.chord)}</b>`;
      }
      const nx = this.root.querySelector(".dr-next");
      if (nx && r.prog.chords.length > 1) {
        const v = this.voicing(nxt, r.prog);
        nx.innerHTML = `<small>다음</small>${v.sh ? diagramSVG(nxt, { ...v.opts, size: 84 }) : ""}`;
      }
      this.root.querySelectorAll(".sv-slot").forEach((el) => el.classList.remove("hit", "miss"));
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
    if (k === "sound" || k === "metro" || k === "faster4" || k === "mic") store.set(`uketab.strum.${k}`, el.checked);
    if (!this.run) this.render();
  }

  key(e) {
    if (this.root.hidden || e.key !== " " || e.repeat || e.target.closest("input, select, textarea, dialog, button")) return;
    e.preventDefault();
    if (this.run) { this.stop(); this.render(); } else this.start();
  }
}
