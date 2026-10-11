"""One-off patch (2026-10-11): bar width follows the number of beats; a short pickup bar sits in front of the
first line instead of taking a full bar slot; the header shows the meter most bars use."""
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "js" / "sheet.js"
s = p.read_text(encoding="utf-8")


def rep(old, new):
    global s
    assert s.count(old) == 1, f"anchor x{s.count(old)}: {old[:70]!r}"
    s = s.replace(old, new)


rep('''    const barW = (W - left - right) / perLine;''', '''    // the bar length most bars use; a full bar of it is one slot, other bars get width by their beats
    const lenCount = new Map();
    for (const b of bars) lenCount.set(b.len, (lenCount.get(b.len) || 0) + 1);
    const mainLen = [...lenCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const lines = [];
    let i0 = 0;
    if (bars.length > 1 && bars[0].len < mainLen) i0 = 1; // pickup bar goes in front of the first line
    for (let i = i0; i < bars.length; i += perLine) lines.push(bars.slice(i === i0 && i0 ? 0 : i, i + perLine));
    if (!lines.length) lines.push(bars);''')

rep('''        <span>${score.meter[0].beats}/4</span>''', '''        <span>${Math.round(mainLen / score.stepsPerBeat)}/4</span>''')
rep('''    const lineCount = Math.ceil(bars.length / perLine);''', '''    const lineCount = lines.length;''')
rep('''      const lb = bars.slice(L * perLine, L * perLine + perLine);''', '''      const lb = lines[L];
      const units = lb.reduce((a, b) => a + b.len, 0);
      // a line is never wider than the page; lines with fewer bars keep the normal bar width
      const unit = (W - left - right) / Math.max(units, perLine * mainLen);
      const xs = [];
      let acc = left;
      for (const b of lb) { xs.push(acc); acc += b.len * unit; }
      const lineEnd = acc;''')
rep('''      g += `<line class="staff" x1="${left}" y1="${staffY}" x2="${left + barW * lb.length}" y2="${staffY}"/>`;''',
    '''      g += `<line class="staff" x1="${left}" y1="${staffY}" x2="${lineEnd}" y2="${staffY}"/>`;''')
rep('''          g += `<line class="tabline" x1="${left}" y1="${y}" x2="${left + barW * lb.length}" y2="${y}"/>`;''',
    '''          g += `<line class="tabline" x1="${left}" y1="${y}" x2="${lineEnd}" y2="${y}"/>`;''')
rep('''        const x0 = left + k * barW, x1 = x0 + barW;''', '''        const x0 = xs[k], x1 = x0 + bar.len * unit, barW = x1 - x0;''')
p.write_text(s, encoding="utf-8")
print("ok")
