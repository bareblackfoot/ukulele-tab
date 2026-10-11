// Practice-mode signal processing on synthetic plucked strings: the right chord must rank first,
// onsets must be found near the strum times, YIN must find the pitch.
import test from "node:test";
import assert from "node:assert/strict";
import { chroma, templateChroma, cosine, yin, MicAnalyzer } from "../js/dsp.js";
import { chordShape } from "../js/chords.js";

const SR = 48000;
const TUNING = [67, 60, 64, 69];
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// decaying string with a few harmonics and a little noise, like a nylon string through a laptop mic
function pluck(out, start, midi, amp = 0.2) {
  const f = hz(midi);
  for (let i = 0; i < SR * 1.2 && start + i < out.length; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 3) * Math.min(1, i / 60);
    let v = 0;
    [1, 0.5, 0.3, 0.15].forEach((a, h) => { v += a * Math.sin(2 * Math.PI * f * (h + 1) * t); });
    out[start + i] += amp * env * v;
  }
}
function strum(out, start, name) {
  const sh = chordShape(name);
  sh.frets.forEach((f, s) => pluck(out, start + Math.round(s * 0.012 * SR), TUNING[s] + f));
}
function noise(out, level = 0.003) { for (let i = 0; i < out.length; i++) out[i] += (Math.random() * 2 - 1) * level; }

const NAMES = ["C", "G", "Am", "F", "G7", "Dm", "Em", "D", "A7", "E7"];
const TPL = new Map(NAMES.map((n) => [n, templateChroma(chordShape(n).frets.map((f, s) => TUNING[s] + f))]));

for (const name of ["C", "G7", "Am", "F", "G", "Dm"]) {
  test(`chroma picks ${name} among common chords`, () => {
    const x = new Float32Array(SR);
    strum(x, 0, name);
    noise(x);
    const c = chroma(x.subarray(Math.round(0.08 * SR), Math.round(0.08 * SR) + 4096), SR);
    const ranked = [...TPL].map(([n, t]) => [n, cosine(c, t)]).sort((a, b) => b[1] - a[1]);
    assert.equal(ranked[0][0], name, JSON.stringify(ranked.slice(0, 3)));
  });
}

test("onsets found within 25 ms of each strum", () => {
  const times = [0.5, 1.1, 1.7, 2.3, 2.9];
  const x = new Float32Array(Math.round(SR * 3.6));
  noise(x);
  times.forEach((t, i) => strum(x, Math.round(t * SR), ["C", "G7", "C", "F", "C"][i]));
  const an = new MicAnalyzer(SR);
  for (let i = 0; i + 512 <= x.length; i += 512) an.push((i + 511) / SR, x.subarray(i, i + 512));
  const on = an.takeOnsets().map((o) => o.t);
  for (const t of times) {
    const d = Math.min(...on.map((o) => Math.abs(o - t)));
    assert.ok(d < 0.025, `strum at ${t}s: nearest onset ${d * 1000} ms away (onsets ${on.map((o) => o.toFixed(3))})`);
  }
  assert.ok(on.length <= times.length + 1, `too many onsets: ${on.length}`);
});

test("YIN finds a plucked E4 within 20 cents", () => {
  const x = new Float32Array(4096);
  pluck(x, 0, 64);
  const { f0, clarity } = yin(x.subarray(1000, 3048), SR);
  const cents = 1200 * Math.log2(f0 / hz(64));
  assert.ok(Math.abs(cents) < 20, `f0 ${f0} (${cents} cents), clarity ${clarity}`);
});
