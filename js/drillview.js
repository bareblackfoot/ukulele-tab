// "코드 연습" view: practise the chords of the open song without the song playing, the way beginner
// videos go through each chord before the song starts.
//   코드 익히기 - one chord at a time: big diagram, which finger goes where, its sound, optional microphone check
//   코드 바꾸기 - change between two chords (or the song's chords in order) on a metronome, optional microphone check

import { songChords, songTransitions, songKey } from "./drills.js";
import { diagramSVG } from "./diagram.js";
import { chordShape } from "./chords.js";
import { tuningOf, skey } from "./instrument.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* blocked */ } },
};
const FINGER = ["", "검지", "중지", "약지", "새끼"];
const UKE_STRING_NAME = ["G현(맨 아래 줄)", "C현", "E현", "A현(맨 위 줄)"];
// guitar strings are counted from the high E (1번 줄, top line of the diagram) to the low E (6번 줄)
const stringNames = (tuning) => {
  const t = tuningOf(tuning);
  if (t.inst !== "guitar") return UKE_STRING_NAME;
  const n = t.names.length;
  return t.names.map((nm, i) => `${n - i}번 줄(${nm.toUpperCase()}${i === 0 ? ", 맨 아래 줄" : i === n - 1 ? ", 맨 위 줄" : ""})`);
};

export class DrillView {
  // deps: {engine, practice, settings, status(msg, err)}
  constructor(root, deps) {
    this.root = root;
    this.d = deps;
    this.mode = "learn";       // "learn" | "change"
    this.cur = 0;
    this.hits = 0;
    this.listening = false;
    this.run = null;           // running change drill
    root.addEventListener("click", (e) => this.click(e));
    root.addEventListener("change", (e) => this.change(e));
    document.addEventListener("keydown", (e) => this.key(e));
  }

  progress() { return store.get(songKey(this.score), { chords: {}, pairs: {} }); }
  saveProgress(p) { store.set(songKey(this.score), p); }

  setScore(score) {
    this.score = score;
    this.chords = songChords(score);
    this.pairs = songTransitions(score);
    if (this.cur >= this.chords.length) this.cur = 0;
    this.stopAll();
    if (!this.root.hidden) this.render();
  }

  show(on) {
    this.root.hidden = !on;
    if (on) this.render(); else this.stopAll();
  }

  stopAll() {
    this.stopListening();
    this.stopChange();
    if (!this.d.practice.on) this.d.practice.closeMic(); // the game mode keeps it while it is on
  }

  shapeText(name) {
    const s = this.score;
    const sh = chordShape(name, s.tuning, s.chordShapes);
    if (!sh) return [];
    const lines = [];
    const STRING_NAME = stringNames(s.tuning);
    if (sh.barre) lines.push(`검지(1)로 ${sh.barre.fret}프렛을 ${STRING_NAME[sh.barre.to].replace(/\(.*\)/, "")}부터 ${STRING_NAME[sh.barre.from].replace(/\(.*\)/, "")}까지 눕혀 누름`);
    sh.frets.forEach((f, i) => {
      if (f <= 0) return;
      const fg = sh.fingers[i];
      if (sh.barre && fg === 1 && f === sh.barre.fret) return;
      lines.push(`${FINGER[fg] || ""}(${fg}) → ${STRING_NAME[i]} ${f}프렛`);
    });
    const open = sh.frets.map((f, i) => (f === 0 ? STRING_NAME[i].replace(/\(.*\)/, "") : null)).filter(Boolean);
    const muted = sh.frets.map((f, i) => (f < 0 ? STRING_NAME[i].replace(/\(.*\)/, "") : null)).filter(Boolean);
    if (open.length === sh.frets.length) lines.push("아무 줄도 누르지 않음");
    else if (open.length) lines.push(`${open.join("·")}은 누르지 않음`);
    if (muted.length) lines.push(`${muted.join("·")}은 치지 않음(×)`);
    return lines;
  }

  render() {
    const s = this.score;
    if (!s) return;
    const opts = { tuning: s.tuning, custom: s.chordShapes, orient: this.d.settings.orient };
    const prog = this.progress();
    const capo = s.capo ? ` · 카포 ${s.capo}` : "";
    let body = "";
    if (!this.chords.length) {
      this.root.innerHTML = `<div class="dr-head"><h2>코드 연습</h2></div><p class="dr-desc">이 악보에는 코드가 없음.</p>`;
      return;
    }
    if (this.mode === "learn") {
      const c = this.chords[this.cur];
      body = `
        <div class="dr-big">
          ${diagramSVG(c.name, { ...opts, size: 180 })}
          <div class="dr-info">
            <div class="dr-name">${esc(c.name)}<small>${this.cur + 1} / ${this.chords.length}</small></div>
            <ul class="dr-fingers">${this.shapeText(c.name).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
            <div class="verdict" aria-live="polite"></div>
            <div class="dots" title="마이크가 맞는 코드로 3번 들으면 익힘">${[0, 1, 2].map((i) => `<i class="${i < this.hits ? "on" : ""}"></i>`).join("")}</div>
            <div class="dr-row">
              <button type="button" data-dr="prev" title="←">◀ 이전</button>
              <button type="button" class="primary" data-dr="hear" title="Space">소리 듣기</button>
              <button type="button" data-dr="next" title="→">다음 ▶</button>
              <button type="button" class="toggle" data-dr="listen" aria-pressed="${this.listening}">마이크로 확인</button>
            </div>
          </div>
        </div>`;
    } else {
      const seqName = "곡 순서대로";
      const pairOpts = [`<option value="seq">${seqName} (${this.songOrder().join(" → ")})</option>`]
        .concat(this.pairs.slice(0, 12).map((p, i) => {
          const rec = prog.pairs[[p.a, p.b].sort().join("|")];
          return `<option value="${i}">${esc(p.a)} ⇄ ${esc(p.b)} · 곡에서 ${p.count}번${rec ? ` · 지난번 ${rec.bpm} BPM ${rec.acc}%` : ""}</option>`;
        })).join("");
      const r = this.run;
      const seq = r ? r.seq : this.currentSeq();
      const curName = r && r.beat >= 0 ? seq[Math.floor(r.beat / r.beatsEach) % seq.length] : seq[0];
      const nextName = r && r.beat >= 0 ? seq[(Math.floor(r.beat / r.beatsEach) + 1) % seq.length] : seq[1 % seq.length];
      body = `
        <div class="dr-row">
          <label>바꿀 코드 <select data-dr="pair">${pairOpts}</select></label>
          <label>BPM <select data-dr="bpm">${[40, 50, 60, 70, 80, 90, 100, 110, 120].map((b) => `<option ${b === this.bpm() ? "selected" : ""}>${b}</option>`).join("")}</select></label>
          <label>한 코드에 <select data-dr="beats">${[4, 2, 1].map((b) => `<option value="${b}" ${b === this.beatsEach() ? "selected" : ""}>${b}박</option>`).join("")}</select></label>
          <label><input type="checkbox" data-dr="sound" ${store.get(skey("drill.sound"), true) ? "checked" : ""}> 코드 소리</label>
          <label><input type="checkbox" data-dr="mic" ${store.get(skey("drill.mic"), false) ? "checked" : ""}> 마이크로 판정</label>
          <button type="button" class="primary" data-dr="go">${r ? "멈춤" : "시작"}</button>
        </div>
        <div class="dr-change">
          <div class="dr-now">${diagramSVG(curName, { ...opts, size: 170 })}<div class="beats">${Array.from({ length: this.beatsEach() }, (_, i) => `<i data-b="${i}"></i>`).join("")}</div></div>
          <div class="dr-next"><small>다음</small>${diagramSVG(nextName, { ...opts, size: 90 })}</div>
          <div class="dr-tally" aria-live="polite">${this.tallyText()}</div>
        </div>`;
    }
    this.root.innerHTML = `
      <div class="dr-head"><h2>코드 연습</h2><span class="sub">${esc(s.meta.title || "")}${capo}</span></div>
      <div class="dr-tabs" role="group">
        <button type="button" class="toggle" data-dr="mode-learn" aria-pressed="${this.mode === "learn"}">코드 익히기</button>
        <button type="button" class="toggle" data-dr="mode-change" aria-pressed="${this.mode === "change"}">코드 바꾸기</button>
      </div>
      ${body}
      <div class="dr-cards" aria-label="이 곡의 코드">${this.chords.map((ch, i) => `<button type="button" class="dr-card${this.mode === "learn" && i === this.cur ? " cur" : ""}${prog.chords[ch.name] ? " done" : ""}" data-chord="${i}">
        ${diagramSVG(ch.name, { ...opts, size: 60 })}<small>${prog.chords[ch.name] ? "익힘" : `곡에서 ${ch.count}번`}</small></button>`).join("")}</div>`;
  }

  // ---------------------------------------------------------------- learn mode
  hear(name) {
    const s = this.score;
    const sh = chordShape(name, s.tuning, s.chordShapes);
    if (!sh) return;
    const tun = tuningOf(s.tuning).strings;
    this.d.engine.strumMidis(sh.frets.map((f, i) => (f < 0 ? null : tun[i] + f + (s.capo || 0))));
  }

  move(d) {
    this.cur = (this.cur + d + this.chords.length) % this.chords.length;
    this.hits = 0;
    this.render();
    if (store.get(skey("drill.autoplay"), true)) this.hear(this.chords[this.cur].name);
  }

  async startListening() {
    const pr = this.d.practice;
    pr.input = "mic";
    if (!(await pr.ensureMic())) return;
    pr.setScore(this.score);
    pr.mic.an.takeOnsets();
    this.listening = true;
    this.pending = [];
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
    this.render();
  }

  stopListening() {
    this.listening = false;
    cancelAnimationFrame(this.raf);
  }

  judged(ok, heard) {
    const name = this.chords[this.cur].name;
    if (ok) {
      this.hits++;
      if (this.hits >= 3) {
        const prog = this.progress();
        prog.chords[name] = true;
        this.saveProgress(prog);
        this.hits = 0;
        const next = this.chords.findIndex((c, i) => i > this.cur && !prog.chords[c.name]);
        this.cur = next >= 0 ? next : (this.cur + 1) % this.chords.length;
        this.render();
        this.say(`${name} 익힘`, true);
        return;
      }
      this.render();
      this.say(`맞음 (${this.hits}/3)`, true);
    } else {
      this.say(heard ? `${heard}로 들림` : "잘 안 들림", false);
    }
  }

  say(text, good) {
    const v = this.root.querySelector(".verdict");
    if (v) { v.textContent = text; v.className = `verdict ${good ? "good" : "badv"}`; }
  }

  // ---------------------------------------------------------------- change mode
  bpm() { return store.get(skey("drill.bpm"), 60); }
  beatsEach() { return store.get(skey("drill.beats"), 4); }
  songOrder() {
    // the song's chords in the order they first appear
    return this.chords.map((c) => c.name);
  }
  currentSeq() {
    const v = store.get(skey("drill.pair"), "seq");
    if (v === "seq" || !this.pairs[+v]) return this.songOrder();
    return [this.pairs[+v].a, this.pairs[+v].b];
  }
  tallyText() {
    const r = this.run || this.lastRun;
    if (!r) return "";
    if (!r.useMic) return `바꾼 횟수 ${r.changes}`;
    return `${r.changes}번 바꿈 · 맞음 ${r.right}${r.done ? ` (${r.changes ? Math.round((r.right / r.changes) * 100) : 0}%)` : ""}`;
  }

  async startChange() {
    const eng = this.d.engine;
    eng.ensure();
    const useMic = store.get(skey("drill.mic"), false);
    if (useMic) {
      this.d.practice.input = "mic";
      if (!(await this.d.practice.ensureMic())) return;
      this.d.practice.setScore(this.score);
      this.d.practice.mic.an.takeOnsets();
    }
    const seq = this.currentSeq();
    const beat = 60 / this.bpm();
    const beatsEach = this.beatsEach();
    const total = Math.max(8, beatsEach * seq.length * 2) + 4; // a bar of count-in, then at least two rounds
    const t0 = eng.ctx.currentTime + 0.4;
    this.run = { seq, beat, beatsEach, t0, total, next: 0, beat: -1, changes: 0, right: 0, useMic, judged: new Set(), pend: [] };
    this.render();
    const r = this.run;
    const tick = () => {
      if (this.run !== r) return;
      const now = eng.ctx.currentTime;
      // schedule clicks and chord sounds a little ahead
      while (r.next < total && t0 + r.next * beat < now + 0.2) {
        const when = t0 + r.next * beat;
        const k = r.next - 4; // first 4 beats are the count-in
        eng.click(when, k < 0 ? k === -4 : k % beatsEach === 0);
        if (k >= 0 && k % beatsEach === 0 && store.get(skey("drill.sound"), true)) {
          const name = seq[Math.floor(k / beatsEach) % seq.length];
          const s = this.score, sh = chordShape(name, s.tuning, s.chordShapes);
          const tun = tuningOf(s.tuning).strings;
          if (sh) eng.strumMidis(sh.frets.map((f, i) => (f < 0 ? null : tun[i] + f + (s.capo || 0))), when, "D", 0.12);
        }
        r.next++;
      }
      // judge strums near each change
      if (r.useMic) {
        const an = this.d.practice.mic.an;
        for (const o of an.takeOnsets()) r.pend.push(o.t - this.d.practice.offsetMs / 1000);
        r.pend = r.pend.filter((t) => {
          if (an.lastT < t + 0.03 + 4096 / an.sr + this.d.practice.offsetMs / 1000) return true;
          const k = Math.round((t - t0) / beat) - 4;
          if (k < 0 || k % beatsEach !== 0 || r.judged.has(k) || Math.abs(t - (t0 + (k + 4) * beat)) > 0.25) return false;
          r.judged.add(k);
          const name = seq[Math.floor(k / beatsEach) % seq.length];
          const h = this.d.practice.hearChord(t + this.d.practice.offsetMs / 1000, name);
          if (h && !h.quiet && (h.best === name || h.bestScore - h.expectedScore <= 0.03)) r.right++;
          return false;
        });
      }
      // display
      const b = Math.floor((now - t0) / beat) - 4;
      if (b !== r.beat) {
        r.beat = b;
        if (b >= 0 && b % beatsEach === 0) r.changes = Math.floor(b / beatsEach) + 1;
        this.updateChange();
      }
      if (now > t0 + total * beat + 0.3) { this.finishChange(); return; }
      r.timer = setTimeout(tick, 25);
    };
    tick();
  }

  updateChange() {
    const r = this.run;
    if (!r) return;
    const k = r.beat;
    const s = this.score;
    const opts = { tuning: s.tuning, custom: s.chordShapes, orient: this.d.settings.orient };
    const idx = k < 0 ? 0 : Math.floor(k / r.beatsEach);
    const cur = r.seq[idx % r.seq.length], nxt = r.seq[(idx + 1) % r.seq.length];
    const now = this.root.querySelector(".dr-now");
    if (!now) return;
    if (now.dataset.name !== cur) {
      now.dataset.name = cur;
      now.querySelector("svg").outerHTML = diagramSVG(cur, { ...opts, size: 170 });
      this.root.querySelector(".dr-next svg").outerHTML = diagramSVG(nxt, { ...opts, size: 90 });
    }
    this.root.querySelectorAll(".beats i").forEach((el, i) => {
      el.className = k < 0 ? (i === (k + 4) % r.beatsEach ? "count" : "") : (i === k % r.beatsEach ? "on" : "");
    });
    const t = this.root.querySelector(".dr-tally");
    if (t) t.textContent = k < 0 ? `준비 ${-k}` : this.tallyText();
  }

  finishChange() {
    const r = this.run;
    if (!r) return;
    clearTimeout(r.timer);
    r.done = true;
    this.lastRun = r;
    this.run = null;
    if (r.useMic && r.changes) {
      const acc = Math.round((r.right / r.changes) * 100);
      const pairSel = store.get(skey("drill.pair"), "seq");
      if (pairSel !== "seq" && this.pairs[+pairSel]) {
        const p = this.pairs[+pairSel];
        const key = [p.a, p.b].sort().join("|");
        const prog = this.progress();
        const old = prog.pairs[key];
        if (!old || this.bpm() > old.bpm || (this.bpm() === old.bpm && acc > old.acc)) prog.pairs[key] = { bpm: this.bpm(), acc };
        this.saveProgress(prog);
      }
      if (acc >= 80 && this.bpm() < 120) store.set(skey("drill.bpm"), this.bpm() + 10);
    }
    this.render();
  }

  stopChange() {
    if (this.run) { clearTimeout(this.run.timer); this.run = null; }
  }

  // ---------------------------------------------------------------- events
  click(e) {
    const card = e.target.closest("[data-chord]");
    if (card) {
      this.mode = "learn";
      this.stopChange();
      this.cur = +card.dataset.chord;
      this.hits = 0;
      this.render();
      this.hear(this.chords[this.cur].name);
      return;
    }
    const b = e.target.closest("button[data-dr]");
    if (!b) return;
    const act = b.dataset.dr;
    if (act === "mode-learn" || act === "mode-change") {
      this.stopAll();
      this.mode = act === "mode-learn" ? "learn" : "change";
      this.render();
    } else if (act === "prev") this.move(-1);
    else if (act === "next") this.move(1);
    else if (act === "hear") this.hear(this.chords[this.cur].name);
    else if (act === "listen") { if (this.listening) { this.stopListening(); this.render(); } else this.startListening(); }
    else if (act === "go") { if (this.run) { this.stopChange(); this.render(); } else this.startChange(); }
  }

  change(e) {
    const el = e.target.closest("[data-dr]");
    if (!el) return;
    const k = el.dataset.dr;
    if (k === "pair") store.set(skey("drill.pair"), el.value);
    if (k === "bpm") store.set(skey("drill.bpm"), +el.value);
    if (k === "beats") store.set(skey("drill.beats"), +el.value);
    if (k === "sound") store.set(skey("drill.sound"), el.checked);
    if (k === "mic") store.set(skey("drill.mic"), el.checked);
    if (!this.run) this.render();
  }

  key(e) {
    if (this.root.hidden || e.target.closest("input, select, textarea, dialog")) return;
    if (this.mode !== "learn") return;
    if (e.key === "ArrowRight") { e.preventDefault(); this.move(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); this.move(-1); }
    else if (e.key === " ") { e.preventDefault(); e.stopImmediatePropagation(); this.hear(this.chords[this.cur].name); }
  }
}
