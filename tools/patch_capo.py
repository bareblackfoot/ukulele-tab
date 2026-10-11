"""One-off patch (2026-10-11): capo. Chord shapes and tab frets are written relative to the capo;
every sound, practice judgement and pitch import adds/subtracts score.capo semitones."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent


def patch(rel, pairs):
    p = root / rel
    s = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert s.count(old) == 1, f"{rel}: anchor x{s.count(old)}: {old[:70]!r}"
        s = s.replace(old, new)
    p.write_text(s, encoding="utf-8")


patch("js/model.js", [
    ('''    tuning: "standard",
    stepsPerBeat,''', '''    tuning: "standard",
    capo: 0,                 // chord shapes and tab frets are relative to the capo
    stepsPerBeat,'''),
    ('''  s.tuning = TUNINGS[o.tuning] ? o.tuning : "standard";
  s.stepsPerBeat''', '''  s.tuning = TUNINGS[o.tuning] ? o.tuning : "standard";
  s.capo = Math.max(0, Math.min(12, int(o.capo, 0)));
  s.stepsPerBeat'''),
    ('''export function midiOf(note, tuningName) {
  return (TUNINGS[tuningName] || TUNINGS.standard).strings[note.string] + note.fret;''', '''export function midiOf(note, tuningName, capo = 0) {
  return (TUNINGS[tuningName] || TUNINGS.standard).strings[note.string] + capo + note.fret;'''),
    ('''    const res = melodyToTab(t.notes.map((n) => ({ col: n.col, len: n.len, midi: n.midi })), s.tuning, opts.octaveShift);''',
     '''    const capo = Math.max(0, Math.min(12, int(d.capo ?? opts.capo, 0)));
    s.capo = capo;
    const res = melodyToTab(t.notes.map((n) => ({ col: n.col, len: n.len, midi: n.midi - capo })), s.tuning, opts.octaveShift);'''),
])

patch("js/audio.js", [
    ('''          this.melodyVoices[n.string] = this.engine.note(tuning[n.string] + n.fret, when, dur + 0.05, 0.55, this.engine.melodyBus);''',
     '''          this.melodyVoices[n.string] = this.engine.note(tuning[n.string] + (s.capo || 0) + n.fret, when, dur + 0.05, 0.55, this.engine.melodyBus);'''),
    ('''      this.chordVoices[s] = this.engine.note(tuning[s] + sh.frets[s], t, beat * 1.8, vel * (dir === "U" ? 0.8 : 1), this.engine.chordBus);''',
     '''      this.chordVoices[s] = this.engine.note(tuning[s] + (this.score.capo || 0) + sh.frets[s], t, beat * 1.8, vel * (dir === "U" ? 0.8 : 1), this.engine.chordBus);'''),
])

patch("js/practice.js", [
    ('''        for (const n of t.notes) out.push({ col: n.col, kind: "note", midi: tuning[n.string] + n.fret, label: `${"GCEA"[n.string]}${n.fret}` });''',
     '''        for (const n of t.notes) out.push({ col: n.col, kind: "note", midi: tuning[n.string] + (s.capo || 0) + n.fret, label: `${"GCEA"[n.string]}${n.fret}` });'''),
    ('''      if (sh) this.templates.set(c, templateChroma(sh.frets.map((f, i) => (f < 0 ? null : tuning[i] + f)).filter((x) => x !== null)));''',
     '''      if (sh) this.templates.set(c, templateChroma(sh.frets.map((f, i) => (f < 0 ? null : tuning[i] + (s.capo || 0) + f)).filter((x) => x !== null)));'''),
    ('''      if (sh) this.templates.set(c, templateChroma(sh.frets.map((f, i) => tuning[i] + f)));''',
     '''      if (sh) this.templates.set(c, templateChroma(sh.frets.map((f, i) => tuning[i] + (s.capo || 0) + f)));'''),
])

patch("js/main.js", [
    ('''          const mel = t.notes.map((n) => ({ col: n.col, len: n.len, midi: midiOf(n, s.tuning) + k }));''',
     '''          const mel = t.notes.map((n) => ({ col: n.col, len: n.len, midi: midiOf(n, s.tuning, s.capo) + k - newCapo }));'''),
])

print("ok")
