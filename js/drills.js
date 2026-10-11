// Chord practice for the open song: the chords it needs, the chord changes it uses, and short drill scores.

import { newScore, normalizeScore } from "./model.js";
import { chordShape, shapeDifficulty } from "./chords.js";

export const STEPS = [
  { id: 1, title: "코드 하나씩", desc: "이 곡에 나오는 코드를 하나씩 쳐 봄. 마이크가 맞는 코드로 들으면 3번 맞힐 때 다음 코드로 넘어감." },
  { id: 2, title: "두 코드 바꾸기", desc: "곡에서 이어지는 두 코드를 메트로놈에 맞춰 번갈아 침. 80% 넘게 맞히면 속도를 올림." },
  { id: 3, title: "곡 전체 · 느리게", desc: "60% 속도. 코드가 바뀌는 순간만 판정함.", target: "change", rate: 0.6 },
  { id: 4, title: "곡 전체 · 박마다", desc: "80% 속도. 박마다 한 번씩 쳐서 판정함.", target: "beat", rate: 0.8 },
  { id: 5, title: "곡 전체 · 원래대로", desc: "원래 속도. 곡 정보의 스트럼 패턴대로 판정함.", target: "pattern", rate: 1 },
];
export const PASS = 80;

const playable = (name, s) => name !== "N.C." && !!chordShape(name, s.tuning, s.chordShapes);

export function songChords(s) {
  const map = new Map();
  for (const c of s.chords) {
    if (!playable(c.name, s)) continue;
    if (!map.has(c.name)) map.set(c.name, { name: c.name, count: 0, first: c.col });
    map.get(c.name).count++;
  }
  return [...map.values()].map((c) => ({ ...c, difficulty: shapeDifficulty(chordShape(c.name, s.tuning, s.chordShapes)) }))
    .sort((a, b) => a.first - b.first);
}

// chord changes used in the song, both directions counted together, most frequent first
export function songTransitions(s) {
  const map = new Map();
  const cs = s.chords.filter((c) => playable(c.name, s));
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1].name, b = cs[i].name;
    if (a === b) continue;
    const key = [a, b].sort().join("|");
    if (!map.has(key)) map.set(key, { a, b, count: 0 });
    map.get(key).count++;
  }
  return [...map.values()].map((t) => ({
    ...t, difficulty: shapeDifficulty(chordShape(t.a, s.tuning, s.chordShapes)) + shapeDifficulty(chordShape(t.b, s.tuning, s.chordShapes)),
  })).sort((x, y) => y.count - x.count || y.difficulty - x.difficulty);
}

// A short score: one bar of count-in, then a and b alternate every beatsEach beats, ending on a.
export function changeDrill(a, b, { bpm = 60, beatsEach = 4, rounds = 4, tuning = "standard", chordShapes = {} } = {}) {
  const spb = 4;
  const s = newScore({ title: `코드 바꾸기 ${a} ↔ ${b}`, bpm, beats: 4, bars: 1 });
  s.meta.artist = `${bpm} BPM · 한 코드에 ${beatsEach}박`;
  s.tuning = tuning;
  s.chordShapes = { ...chordShapes };
  s.strum.pattern = "D-D-D-D-";
  s.sections = [{ col: 0, text: "준비" }];
  const chords = [{ col: 0, name: "N.C." }];
  let col = 4 * spb;
  for (let r = 0; r < rounds; r++) {
    chords.push({ col, name: a }); col += beatsEach * spb;
    chords.push({ col, name: b }); col += beatsEach * spb;
  }
  chords.push({ col, name: a }); col += 4 * spb;
  s.chords = chords;
  s.columnCount = Math.ceil(col / 16) * 16;
  s.tracks = [{ id: "melody", name: "멜로디", notes: [] }];
  const out = normalizeScore(s);
  out.drill = true;
  return out;
}

export function songKey(s) {
  return `uketab.drill.${s.youtube.videoId || ""}.${(s.meta.title || "").slice(0, 60)}`;
}
