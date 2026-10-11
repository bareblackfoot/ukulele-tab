"""One-off patch (2026-10-11): the chord practice tab no longer plays the song or runs practice mode.
Remove the drill-score / song-step plumbing from main.js and hide the song controls while that tab is open."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
p = root / "js" / "main.js"
s = p.read_text(encoding="utf-8")


def rep(old, new):
    global s
    assert s.count(old) == 1, f"anchor x{s.count(old)}: {old[:70]!r}"
    s = s.replace(old, new)


def cut(start, end):
    """remove from the line starting with `start` up to (not including) `end`"""
    global s
    i = s.index(start)
    j = s.index(end, i)
    s = s[:i] + s[j:]


rep('import { changeDrill, PASS, STEPS } from "./drills.js";\n', "")
rep('''let songScore = null;     // the song while a chord-change drill score is loaded
let resultCtx = { kind: "free" };\n''', "")
rep('''  startChangeDrill: (a, b, opts) => startChangeDrill(a, b, opts),
  startSongStep: (step) => startSongStep(step),\n''', "")
rep('''  if (score.drill) return; // generated drill scores are not kept\n''', "")
rep('''  if (v !== "drill" && score.drill) restoreSong();
  view = v;''', '''  if (v === "drill" && player.playing) pause();
  view = v;
  // chord practice has its own controls; the song's transport, chord panel and practice lane stay out of the way
  $(".transport").hidden = v === "drill";
  $(".cb-wrap").hidden = v === "drill";
  $(".game").hidden = v === "drill" || !practice.on;''')
rep('''    if (had && !player.playing) showResult();
    resultCtx = { kind: "free" };''', '''    if (had && !player.playing) showResult();''')
rep('''  let ctxText = "";
  if (resultCtx.kind === "pair") ctxText = ` · 코드 바꾸기 ${resultCtx.key.replace("|", " ⇄ ")} ${resultCtx.bpm} BPM`;
  if (resultCtx.kind === "step") ctxText = ` · ${resultCtx.step.id}단계 ${resultCtx.step.title}`;
  dlg.querySelector(".gr-meta").innerHTML = `${(songScore || score).meta.title || "제목 없음"} · ${modeName} · ${targetName}${ctxText}` +''',
    '''  dlg.querySelector(".gr-meta").innerHTML = `${score.meta.title || "제목 없음"} · ${modeName} · ${targetName}` +''')
rep('''  const nextBtn = dlg.querySelector(".gr-next");
  let passed = false;
  if (resultCtx.kind === "pair") {
    drillView.recordResult("pair", resultCtx.key, r.acc, resultCtx.bpm);
    passed = r.acc >= PASS;
    nextBtn.textContent = passed ? `${Math.min(120, resultCtx.bpm + 10)} BPM으로 다시` : "다음 단계";
    nextBtn.hidden = !passed;
  } else if (resultCtx.kind === "step") {
    drillView.recordResult("step", resultCtx.step.id, r.acc);
    passed = r.acc >= PASS && resultCtx.step.id < STEPS.length;
    nextBtn.textContent = "다음 단계";
    nextBtn.hidden = !passed;
  } else nextBtn.hidden = true;
  dlg.showModal();''', '''  dlg.showModal();''')
rep('''async function retry() {
  if (resultCtx.kind === "pair") return startChangeDrill(resultCtx.a, resultCtx.b, resultCtx.opts);
  if (resultCtx.kind === "step") return startSongStep(resultCtx.step);
  practice.reset();''', '''async function retry() {
  practice.reset();''')
cut("async function nextStep() {", "function toggleLoop() {")
rep('''  "gr-next": () => { $(".dlg-gresult").close(); nextStep(); },\n''', "")
rep('''  songScore = null;
  setScore(s, { msg: describeImport(s) });''', '''  setScore(s, { msg: describeImport(s) });''')
rep('''document.addEventListener("keydown", (e) => {
  if (e.key !== " " || e.repeat) return;''', '''document.addEventListener("keydown", (e) => {
  if (e.key !== " " || e.repeat || view === "drill") return;''')
p.write_text(s, encoding="utf-8")

h = root / "index.html"
t = h.read_text(encoding="utf-8")
old = '''<button type="button" class="gr-next primary" data-act="gr-next" hidden>다음 단계</button>'''
assert t.count(old) == 1
t = t.replace(old, "")
h.write_text(t, encoding="utf-8")

d = root / "js" / "drills.js"
u = d.read_text(encoding="utf-8")
i = u.index("export const STEPS = [")
j = u.index("const playable =")
u = u[:i] + u[j:]
i = u.index("// A short score: one bar of count-in")
j = u.index("export function songKey(s)")
u = u[:i] + u[j:]
u = u.replace('import { newScore, normalizeScore } from "./model.js";\n', "")
d.write_text(u, encoding="utf-8")
print("ok")
