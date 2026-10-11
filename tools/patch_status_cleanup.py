"""One-off patch (2026-10-11): the status line only shows errors and results that change what the user does.
Messages that just repeat what happened on screen are removed; the line hides itself when empty."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
p = root / "js" / "main.js"
s = p.read_text(encoding="utf-8")


def rep(old, new, count=1):
    global s
    assert s.count(old) == count, f"anchor x{s.count(old)}: {old[:70]!r}"
    s = s.replace(old, new)


rep('''function status(msg, error = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", !!error);
}''', '''// Only errors and results that change what the user does next go here. Plain notes fade after a few seconds.
let statusTimer = null;
function status(msg, error = false) {
  clearTimeout(statusTimer);
  statusEl.textContent = msg || "";
  statusEl.classList.toggle("error", !!error);
  statusEl.hidden = !msg;
  if (msg && !error) statusTimer = setTimeout(() => { statusEl.hidden = true; }, 6000);
}
status("");''')

rep('''  setScore(next, { keepHistory: true, msg: label });''', '''  setScore(next, { keepHistory: true });''')
rep('''  setScore(normalizeScore(JSON.parse(undoStack.pop())), { keepHistory: true, msg: "실행 취소" });''',
    '''  setScore(normalizeScore(JSON.parse(undoStack.pop())), { keepHistory: true });''')
rep('''  setScore(normalizeScore(JSON.parse(redoStack.pop())), { keepHistory: true, msg: "다시 실행" });''',
    '''  setScore(normalizeScore(JSON.parse(redoStack.pop())), { keepHistory: true });''')
rep('''    setScore(newScore(), { msg: "새 악보" });''', '''    setScore(newScore());''')
rep('''  setScore(s, { msg: "곡으로 돌아옴" });''', '''  setScore(s);''')
rep('''  setScore(d, { msg: `코드 바꾸기 연습: ${a} ⇄ ${b}, ${opts.bpm} BPM` });''', '''  setScore(d);''')
rep('''  setScore(loadAnyFormat(obj), { msg: `예제 열림: ${obj.meta.title}` });''', '''  setScore(loadAnyFormat(obj));''')
rep('''    if (last) { setScore(loadAnyFormat(last), { msg: "지난번 악보를 이어서 엶" }); return; }''',
    '''    if (last) { setScore(loadAnyFormat(last)); return; }''')
rep('''    setScore(newScore(), { msg: `시작 악보를 못 엶: ${err.message}` });''',
    '''    setScore(newScore());
    status(`시작 악보를 못 엶: ${err.message}`, true);''')
rep('''  if (on && score.youtube.videoId) yt.load(score.youtube.videoId).then(() => status(yt.lastError ? `영상 오류 ${yt.lastError} (퍼가기 금지 영상일 수 있음)` : "영상 준비됨"));''',
    '''  if (on && score.youtube.videoId) yt.load(score.youtube.videoId).then(() => { if (yt.lastError) status(`영상 오류 ${yt.lastError} (퍼가기 금지 영상일 수 있음)`, true); });''')
rep('''    status("JSON 파일로 저장함");\n''', '')
rep('''    if (practice.input === "mic" && practice.mic) status("연습 모드: 재생하면 레인의 동그라미가 빨간 선에 닿을 때 치세요");
    if (practice.input === "keys") status("연습 모드(키보드): 박에 맞춰 F나 J 키를 누르세요");\n''', '')
rep('''  status(`코드 바꾸기 연습: ${a} ⇄ ${b}, ${opts.bpm} BPM. 첫 마디는 준비 박`);\n''', '')
rep('''        status(`악보 완성: ${j.title || j.videoId}`);\n''', '')
rep('''    status("내 PC 연결 토큰을 저장함");\n''', '')

# loop: say it on the button, not in the status line
rep('''    status(`구간 반복 시작: ${bar.index + 1}마디. 끝 마디에서 한 번 더 누름`);''',
    '''    btn.textContent = `${bar.index + 1}마디부터 · 끝 마디에서 다시 누름`;''')
rep('''    status(`구간 반복 켬: ${barAt(bars, loopState.start).index + 1}~${barAt(bars, end - 1).index + 1}마디`);''',
    '''    btn.textContent = `${barAt(bars, loopState.start).index + 1}~${barAt(bars, end - 1).index + 1}마디 반복 중`;''')
rep('''    status("구간 반복 끔");''', '''    btn.textContent = "구간 반복";''')

# import report: only when notes were moved or could not be read
rep('''function describeImport(s, name) {
  const parts = [`${name || "악보"} 열림`];
  for (const r of s.importReport || []) {
    parts.push(`${r.track}: 음 ${r.notes}개, 옥타브 ${r.shift >= 0 ? "+" : ""}${r.shift / 12}${r.folded ? `, 음역 밖이라 옥타브를 옮긴 음 ${r.folded}개` : ""}${r.skipped ? `, 못 읽은 칸 ${r.skipped}개` : ""}`);
  }
  return parts.join(" · ");
}''', '''function describeImport(s) {
  const parts = [];
  for (const r of s.importReport || []) {
    const bits = [];
    if (r.shift) bits.push(`멜로디를 ${r.shift > 0 ? "" : "-"}${Math.abs(r.shift / 12)}옥타브 옮김`);
    if (r.folded) bits.push(`음역 밖 음 ${r.folded}개는 따로 옥타브를 옮김`);
    if (r.skipped) bits.push(`못 읽은 칸 ${r.skipped}개`);
    if (bits.length) parts.push(`${r.track}: ${bits.join(", ")}`);
  }
  return parts.join(" · ");
}''')
rep('''  setScore(s, { msg: describeImport(s, sourceName) });''', '''  setScore(s, { msg: describeImport(s) });''')

p.write_text(s, encoding="utf-8")

# drill view and practice: drop guidance lines, keep errors
d = root / "js" / "drillview.js"
t = d.read_text(encoding="utf-8")
old = '''    if (pr.input !== "mic") { this.d.status("연습 모드 입력이 키보드라서 «쳤음» 버튼으로 넘어가세요"); return; }'''
assert t.count(old) == 1
t = t.replace(old, '''    if (pr.input !== "mic") { this.d.status("연습 모드 입력이 키보드로 되어 있어 마이크로 들을 수 없음", true); return; }''')
d.write_text(t, encoding="utf-8")

css = root / "css" / "app.css"
c = css.read_text(encoding="utf-8")
old = '''.status { padding: 4px 16px; font-size: 12px; color: var(--ink2); border-top: 1px solid var(--grid); min-height: 24px; background: var(--panel); }'''
assert c.count(old) == 1
c = c.replace(old, '''.status { padding: 4px 16px; font-size: 12px; color: var(--ink2); border-top: 1px solid var(--grid); background: var(--panel); }
.status[hidden] { display: none; }''')
css.write_text(c, encoding="utf-8")
print("ok")
