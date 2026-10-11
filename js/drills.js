// Chord practice for the open song: the chords it needs, the chord changes it uses, and short drill scores.

import { chordShape, shapeDifficulty } from "./chords.js";
import { skey } from "./instrument.js";

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

export function songKey(s) {
  return skey(`drill.${s.youtube.videoId || ""}.${(s.meta.title || "").slice(0, 60)}`);
}
