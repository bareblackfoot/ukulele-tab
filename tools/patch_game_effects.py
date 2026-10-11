"""One-off patch (2026-10-11): game effects - judge pop animation, hit bursts on the lane, big combo milestones."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent


def patch(rel, pairs):
    p = root / rel
    s = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert s.count(old) == 1, f"{rel}: anchor x{s.count(old)}: {old[:70]!r}"
        s = s.replace(old, new)
    p.write_text(s, encoding="utf-8")


patch("js/practice.js", [
    ('''    this.flash = { grade, text: LABEL[grade], sub: tg !== "perfect" && grade !== "miss" ? (dMs < 0 ? "EARLY" : "LATE") : "", t: performance.now(), combo: st.combo };''',
     '''    this.flash = { grade, text: LABEL[grade], sub: tg !== "perfect" && grade !== "miss" ? (dMs < 0 ? "EARLY" : "LATE") : "", t: performance.now(), combo: st.combo };
    this.bursts.push({ t: performance.now(), grade });
    if (st.combo && (st.combo === 10 || st.combo === 20 || st.combo === 30 || st.combo % 50 === 0)) this.milestone = { n: st.combo, t: performance.now() };'''),
    ('''  reset() {''', '''  reset() {
    this.bursts = [];
    this.milestone = null;'''),
    ('''    // hit line''', '''    // bursts where targets were hit: a ring that grows and fades
    const nowMs = performance.now();
    this.bursts = this.bursts.filter((b) => nowMs - b.t < 400);
    const ringColor = { perfect: "#2f9e44", ok: "#1c7ed6", bad: "#f08c00", miss: "#e03131" };
    for (const b of this.bursts) {
      const k = (nowMs - b.t) / 400;
      c.globalAlpha = 1 - k;
      c.strokeStyle = ringColor[b.grade];
      c.lineWidth = b.grade === "perfect" ? 4 : 2;
      c.beginPath(); c.arc(hitX, H / 2, 10 + k * 26, 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1;
    // hit line'''),
    ('''    el.style.opacity = String(Math.max(0, 1 - age / 700));
  }''', '''    el.style.opacity = String(Math.max(0, 1 - age / 700));
    // combo milestone banner
    const big = this.ui.combo;
    const m = this.milestone;
    if (big) {
      const mAge = m ? performance.now() - m.t : 1e9;
      if (mAge < 1100) {
        if (big.dataset.n !== String(m.n) + m.t) {
          big.dataset.n = String(m.n) + m.t;
          big.textContent = `콤보 ${m.n}!`;
          big.classList.remove("show");
          void big.offsetWidth; // restart the animation
          big.classList.add("show");
        }
      } else if (big.classList.contains("show")) big.classList.remove("show");
    }
  }'''),
    ('''    if (!f || age > 700) { if (el.dataset.shown) { el.textContent = ""; el.dataset.shown = ""; } return; }
    const key = `${f.t}`;
    if (el.dataset.shown !== key) {
      el.dataset.shown = key;
      el.className = `g-judge ${f.grade}`;''', '''    if (!f || age > 700) { if (el.dataset.shown) { el.textContent = ""; el.dataset.shown = ""; } return; }
    const key = `${f.t}`;
    if (el.dataset.shown !== key) {
      el.dataset.shown = key;
      el.className = `g-judge ${f.grade}`;
      void el.offsetWidth;
      el.classList.add("pop");'''),
])

patch("index.html", [
    ('''    <div class="g-lane-wrap"><canvas class="g-lane"></canvas><div class="g-judge" aria-hidden="true"></div></div>''',
     '''    <div class="g-lane-wrap"><canvas class="g-lane"></canvas><div class="g-judge" aria-hidden="true"></div><div class="g-combo" aria-hidden="true"></div></div>'''),
    ('''  <footer class="status" role="status"></footer>''', '''  <div class="countdown" aria-live="assertive" hidden></div>
  <footer class="status" role="status"></footer>'''),
])

patch("js/main.js", [
    ('''  lane: $(".g-lane"),
  judge: $(".g-judge"),''', '''  lane: $(".g-lane"),
  judge: $(".g-judge"),
  combo: $(".g-combo"),'''),
])

css = root / "css" / "app.css"
s = css.read_text(encoding="utf-8")
s += '''
/* game effects */
.g-judge.pop b { animation: judge-pop .22s ease-out; }
@keyframes judge-pop { 0% { transform: scale(1.6); } 100% { transform: scale(1); } }
.g-combo { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(.6); opacity: 0; pointer-events: none;
  font-size: 40px; font-weight: 900; color: #e8590c; text-shadow: 0 2px 0 var(--paper), 0 0 18px rgba(255, 170, 60, .7); white-space: nowrap; z-index: 6; }
.g-combo.show { animation: combo-in 1.1s ease-out forwards; }
@keyframes combo-in { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.5); } 15% { opacity: 1; transform: translate(-50%, -50%) scale(1.25); }
  30% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -70%) scale(1); } }
.countdown { position: fixed; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 40; }
.countdown[hidden] { display: none; }
.countdown b { font-size: 160px; font-weight: 900; color: var(--accent); text-shadow: 0 4px 0 var(--paper), 0 0 30px rgba(0,0,0,.15); animation: count-pop .5s ease-out; }
.countdown b.go { color: #2f9e44; font-size: 120px; }
@keyframes count-pop { 0% { transform: scale(1.8); opacity: 0; } 30% { opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
.gr-rank { font-size: 56px; font-weight: 900; line-height: 1; margin-right: 12px; }
.gr-rank.S { color: #e8590c; } .gr-rank.A { color: #2f9e44; } .gr-rank.B { color: #1c7ed6; } .gr-rank.C, .gr-rank.D { color: var(--ink2); }
.gr-best { display: inline-block; background: #e8590c; color: #fff; font-weight: 800; border-radius: 6px; padding: 2px 10px; margin-left: 6px; }
'''
css.write_text(s, encoding="utf-8")
print("ok")
