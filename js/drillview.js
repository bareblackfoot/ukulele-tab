// "코드 연습" view: step 1 (one chord at a time, checked by microphone), step 2 (change between two chords
// against a metronome), steps 3-5 (the whole song with practice mode at rising difficulty).

import { STEPS, PASS, songChords, songTransitions, songKey } from "./drills.js";
import { diagramSVG } from "./diagram.js";
import { chordShape, TUNINGS } from "./chords.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* blocked */ } },
};

export class DrillView {
  // deps: {engine, practice, settings, startChangeDrill(a, b, opts), startSongStep(step), status(msg, err)}
  constructor(root, deps) {
    this.root = root;
    this.d = deps;
    this.step = 1;
    this.cur = 0;
    this.hits = 0;
    this.listening = false;
    this.raf = 0;
    root.addEventListener("click", (e) => this.click(e));
  }

  progress() { return store.get(songKey(this.score), { chords: {}, pairs: {}, steps: {} }); }
  saveProgress(p) { store.set(songKey(this.score), p); }

  setScore(score) {
    // drills run on generated scores; the view keeps the song it was opened for
    if (score.drill) return;
    this.score = score;
    this.chords = songChords(score);
    this.pairs = songTransitions(score);
    if (this.cur >= this.chords.length) this.cur = 0;
    if (!this.root.hidden) this.render();
  }

  show(on) {
    this.root.hidden = !on;
    if (on) this.render(); else this.stopListening();
  }

  render() {
    const s = this.score;
    if (!s) return;
    const prog = this.progress();
    const opts = { tuning: s.tuning, custom: s.chordShapes, orient: this.d.settings.orient };
    const stepBtns = STEPS.map((st) => {
      let best = "";
      if (st.id === 1) {
        const done = this.chords.filter((c) => prog.chords[c.name]).length;
        best = this.chords.length ? `${done}/${this.chords.length} 코드 익힘` : "";
      } else if (st.id === 2) {
        const n = Object.keys(prog.pairs).length;
        best = n ? `${n}쌍 연습함` : "";
      } else if (prog.steps[st.id] !== undefined) best = `최고 ${prog.steps[st.id]}%${prog.steps[st.id] >= PASS ? " 통과" : ""}`;
      return `<button type="button" class="dr-step" data-step="${st.id}" aria-pressed="${st.id === this.step}">
        <b>${st.id}. ${esc(st.title)}</b><small>${esc(st.desc.split(".")[0])}</small><span class="best">${esc(best)}</span></button>`;
    }).join("");
    const st = STEPS[this.step - 1];
    let body = "";
    if (!this.chords.length) {
      body = `<p class="dr-desc">이 악보에는 연습할 코드가 없음. 코드가 있는 악보를 열거나 편집에서 코드를 넣으세요.</p>`;
    } else if (this.step === 1) {
      const c = this.chords[this.cur];
      const sh = chordShape(c.name, s.tuning, s.chordShapes);
      const fingers = sh.frets.map((f, i) => (f > 0 ? `${"GCEA"[i]}현 ${f}프렛 ${sh.fingers[i]}번 손가락` : null)).filter(Boolean);
      body = `<p class="dr-desc">${esc(st.desc)}</p>
        <div class="dr-big">
          ${diagramSVG(c.name, { ...opts, size: 150 })}
          <div>
            <div class="verdict" aria-live="polite">${this.listening ? "쳐 보세요" : "«듣기 시작»을 누르고 쳐 보세요"}</div>
            <div class="hint">${fingers.length ? esc(fingers.join(" · ")) : "아무 줄도 누르지 않고 칩니다 (개방현)"}${sh.barre ? ` · 1번 손가락으로 ${sh.barre.fret}프렛을 함께 누름` : ""}</div>
            <div class="hint">곡에서 ${c.count}번 나옴</div>
            <div class="dots">${[0, 1, 2].map((i) => `<i class="${i < this.hits ? "on" : ""}"></i>`).join("")}</div>
            <div class="dr-row">
              <button type="button" class="primary" data-dr="listen">${this.listening ? "듣기 멈춤" : "듣기 시작"}</button>
              <button type="button" data-dr="hear">소리 들어 보기</button>
              <button type="button" data-dr="self">쳤음 (마이크 없이)</button>
              <button type="button" data-dr="prev">이전 코드</button>
              <button type="button" data-dr="next">다음 코드</button>
            </div>
          </div>
        </div>
        <div class="dr-cards">${this.chords.map((ch, i) => `<div class="dr-card${i === this.cur ? " cur" : ""}${prog.chords[ch.name] ? " done" : ""}" data-chord="${i}">
          ${diagramSVG(ch.name, { ...opts, size: 64 })}<small>${prog.chords[ch.name] ? "익힘" : `${ch.count}번`}</small></div>`).join("")}</div>`;
    } else if (this.step === 2) {
      const bpmOpts = [40, 50, 60, 70, 80, 90, 100, 110, 120];
      body = `<p class="dr-desc">${esc(st.desc)} 연습 모드 판정을 같이 켭니다.</p>
        <div class="dr-row"><label>한 코드에 <select data-dr="beats"><option value="4">4박</option><option value="2">2박</option><option value="1">1박</option></select></label></div>
        <div class="dr-pairs">${this.pairs.slice(0, 12).map((p, i) => {
          const key = [p.a, p.b].sort().join("|");
          const rec = prog.pairs[key];
          const startBpm = rec ? Math.min(120, rec.bpm + (rec.acc >= PASS ? 10 : 0)) : 60;
          return `<div class="dr-pair" data-pair="${i}">
            ${diagramSVG(p.a, { ...opts, size: 52 })}<span class="arrow">⇄</span>${diagramSVG(p.b, { ...opts, size: 52 })}
            <span class="meta">곡에서 ${p.count}번 바뀜${rec ? ` · 지난번 ${rec.bpm} BPM ${rec.acc}%` : ""}</span>
            <label>BPM <select data-dr="bpm">${bpmOpts.map((b) => `<option ${b === startBpm ? "selected" : ""}>${b}</option>`).join("")}</select></label>
            <button type="button" class="primary" data-dr="pair">시작</button></div>`;
        }).join("") || "<p class='dr-desc'>코드가 바뀌는 곳이 없음</p>"}</div>`;
    } else {
      const best = prog.steps[st.id];
      body = `<p class="dr-desc">${esc(st.desc)} ${PASS}% 넘으면 통과.</p>
        <div class="dr-row"><button type="button" class="primary" data-dr="song">${st.id}단계 시작</button>
        ${best !== undefined ? `<span>최고 ${best}%</span>` : ""}</div>
        <p class="hint">시작하면 처음부터 재생하고 연습 모드 판정이 켜집니다. 위쪽 레인에서 동그라미가 빨간 선에 닿을 때 치세요.</p>`;
    }
    this.root.innerHTML = `<div class="dr-steps">${stepBtns}</div><div class="dr-body">${body}</div>`;
    const beatsSel = this.root.querySelector("[data-dr=beats]");
    if (beatsSel) beatsSel.value = String(store.get("uketab.drill.beats", 4));
  }

  click(e) {
    const stepBtn = e.target.closest("[data-step]");
    if (stepBtn) { this.step = +stepBtn.dataset.step; this.stopListening(); this.render(); return; }
    const card = e.target.closest("[data-chord]");
    if (card) { this.cur = +card.dataset.chord; this.hits = 0; this.render(); return; }
    const b = e.target.closest("[data-dr]");
    if (!b || b.tagName === "SELECT") return;
    const act = b.dataset.dr;
    const s = this.score;
    if (act === "listen") this.listening ? this.stopListening() : this.startListening();
    else if (act === "hear") {
      const sh = chordShape(this.chords[this.cur].name, s.tuning, s.chordShapes);
      const tun = (TUNINGS[s.tuning] || TUNINGS.standard).strings;
      this.d.engine.strumMidis(sh.frets.map((f, i) => (f < 0 ? null : tun[i] + f)));
    } else if (act === "self") this.judged(true, null);
    else if (act === "prev") { this.cur = (this.cur - 1 + this.chords.length) % this.chords.length; this.hits = 0; this.render(); }
    else if (act === "next") { this.cur = (this.cur + 1) % this.chords.length; this.hits = 0; this.render(); }
    else if (act === "pair") {
      const row = b.closest("[data-pair]");
      const p = this.pairs[+row.dataset.pair];
      const bpm = +row.querySelector("[data-dr=bpm]").value;
      const beatsEach = +this.root.querySelector("[data-dr=beats]").value;
      store.set("uketab.drill.beats", beatsEach);
      this.d.startChangeDrill(p.a, p.b, { bpm, beatsEach, key: [p.a, p.b].sort().join("|") });
    } else if (act === "song") this.d.startSongStep(STEPS[this.step - 1]);
  }

  // ---------------------------------------------------------------- step 1 listening
  async startListening() {
    const pr = this.d.practice;
    if (pr.input !== "mic") { this.d.status("연습 모드 입력이 키보드라서 «쳤음» 버튼으로 넘어가세요"); return; }
    const ok = await pr.ensureMic();
    if (!ok) return;
    pr.setScore(this.score);
    pr.mic.an.takeOnsets();
    this.listening = true;
    this.pending = [];
    this.render();
    const loop = () => {
      if (!this.listening) return;
      const an = pr.mic.an;
      for (const o of an.takeOnsets()) this.pending.push(o.t);
      this.pending = this.pending.filter((t) => {
        if (an.lastT < t + 0.03 + 4096 / an.sr) return true;
        const name = this.chords[this.cur].name;
        const r = pr.hearChord(t, name);
        if (r && !r.quiet) this.judged(r.best === name || r.bestScore - r.expectedScore <= 0.03, r.best);
        return false;
      });
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stopListening() {
    this.listening = false;
    cancelAnimationFrame(this.raf);
  }

  judged(ok, heard) {
    const v = this.root.querySelector(".verdict");
    if (ok) {
      this.hits++;
      if (this.hits >= 3) {
        const prog = this.progress();
        prog.chords[this.chords[this.cur].name] = true;
        this.saveProgress(prog);
        const name = this.chords[this.cur].name;
        this.hits = 0;
        const nextUndone = this.chords.findIndex((c, i) => i > this.cur && !prog.chords[c.name]);
        this.cur = nextUndone >= 0 ? nextUndone : (this.cur + 1) % this.chords.length;
        this.render();
        const v2 = this.root.querySelector(".verdict");
        if (v2) { v2.textContent = `${name} 익힘! 다음 코드`; v2.className = "verdict good"; }
        return;
      }
      this.render();
      const v2 = this.root.querySelector(".verdict");
      if (v2) { v2.textContent = `맞음 (${this.hits}/3)`; v2.className = "verdict good"; }
    } else if (v) {
      v.textContent = heard ? `다른 코드로 들림: ${heard}` : "잘 안 들림. 한 번 더";
      v.className = "verdict badv";
    }
  }

  // called by main when a drill or song step ends with a practice result
  recordResult(kind, key, acc, bpm) {
    const prog = this.progress();
    if (kind === "pair") {
      const old = prog.pairs[key];
      if (!old || bpm > old.bpm || (bpm === old.bpm && acc > old.acc)) prog.pairs[key] = { bpm, acc };
    } else {
      prog.steps[key] = Math.max(prog.steps[key] ?? 0, acc);
    }
    this.saveProgress(prog);
    if (!this.root.hidden) this.render();
  }
}
