"""One-off patch (2026-10-11): count-in before game mode playback (metronome, 3-2-1-시작!)."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent


def patch(rel, pairs):
    p = root / rel
    s = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert s.count(old) == 1, f"{rel}: anchor x{s.count(old)}: {old[:70]!r}"
        s = s.replace(old, new)
    p.write_text(s, encoding="utf-8")


patch("js/audio.js", [
    ('''  play(fromCol) {
    this.engine.ensure();
    this.playing = true;
    this.restart(fromCol ?? this.pausedCol ?? 0);
    this.emit("play");
  }

  restart(col) {
    const ctx = this.engine.ctx;
    this.silence();
    this.startCtx = ctx.currentTime + 0.06;''', '''  // startAt: audio-clock time at which the first column sounds (default: right away)
  play(fromCol, startAt) {
    this.engine.ensure();
    this.playing = true;
    this.restart(fromCol ?? this.pausedCol ?? 0, startAt);
    this.emit("play");
  }

  restart(col, startAt) {
    const ctx = this.engine.ctx;
    this.silence();
    this.startCtx = startAt ?? ctx.currentTime + 0.06;'''),
])

patch("js/main.js", [
    ('''function play() {
  if (player.playing) return;
  let rate = +$("[data-opt=rate]").value;
  if (ytActive()) {
    const r = yt.fitRate(rate);
    if (r !== rate) { rate = r; $("[data-opt=rate]").value = String(r); status(`영상이 지원하는 속도 ${Math.round(r * 100)}%로 맞춤`); }
  }
  player.rate = rate;
  player.play();
  if (ytActive()) yt.start(player.scoreTime(), rate);
  $(".play").textContent = "❚❚";
  $(".play").setAttribute("aria-label", "일시 정지");
  if (!raf) raf = requestAnimationFrame(frame);
}
function pause() {
  player.pause();''', '''let countIn = null; // {timers, el} while the game-mode count-in runs

function play() {
  if (player.playing || countIn) return;
  let rate = +$("[data-opt=rate]").value;
  if (ytActive()) {
    const r = yt.fitRate(rate);
    if (r !== rate) { rate = r; $("[data-opt=rate]").value = String(r); status(`영상이 지원하는 속도 ${Math.round(r * 100)}%로 맞춤`); }
  }
  player.rate = rate;
  $(".play").textContent = "❚❚";
  $(".play").setAttribute("aria-label", "일시 정지");
  if (!practice.on) {
    player.play();
    if (ytActive()) yt.start(player.scoreTime(), rate);
    if (!raf) raf = requestAnimationFrame(frame);
    return;
  }
  // game mode: wait a moment, one bar of clicks with 3, 2, 1, 시작! and start on the next beat
  engine.ensure();
  const col = player.position();
  const beat = 60 / player.tm.bpmAt(col) / rate;
  const t0 = engine.ctx.currentTime + 0.6;
  const startAt = t0 + 4 * beat;
  const el = $(".countdown");
  const timers = [];
  ["3", "2", "1", "시작!"].forEach((txt, k) => {
    engine.click(t0 + k * beat, k === 0);
    timers.push(setTimeout(() => {
      el.hidden = false;
      el.innerHTML = `<b class="${k === 3 ? "go" : ""}">${txt}</b>`;
    }, (t0 + k * beat - engine.ctx.currentTime) * 1000));
  });
  timers.push(setTimeout(() => { el.hidden = true; el.innerHTML = ""; }, (startAt - engine.ctx.currentTime) * 1000 + 350));
  countIn = { timers, el };
  timers.push(setTimeout(() => { countIn = null; }, (startAt - engine.ctx.currentTime) * 1000));
  player.play(col, startAt);
  if (ytActive()) timers.push(setTimeout(() => yt.start(player.scoreTime(), rate), Math.max(0, (startAt - engine.ctx.currentTime) * 1000 - 20)));
  if (!raf) raf = requestAnimationFrame(frame);
}

function cancelCountIn() {
  if (!countIn) return;
  countIn.timers.forEach(clearTimeout);
  countIn.el.hidden = true;
  countIn.el.innerHTML = "";
  countIn = null;
}

function pause() {
  cancelCountIn();
  player.pause();'''),
])
print("ok")
