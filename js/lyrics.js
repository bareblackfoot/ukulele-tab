// Pasted lyrics -> syllables -> placed on the melody's note starts.
// Lines in the pasted text are sung phrases: a line should start after a rest, and syllables that match the
// lyrics already in the score (machine transcription) keep roughly the same place.

const SMALL = new Set([..."ゃゅょぁぃぅぇぉゎャュョァィゥェォヮっッー"]);

function englishSyllables(word) {
  const w = word.toLowerCase();
  const parts = w.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/g);
  if (!parts || parts.length < 2) return [word];
  // a final silent "e" belongs to the syllable before it
  if (parts.length > 1 && /^[^aeiouy]*e$/.test(parts[parts.length - 1]) && !/le$/.test(w)) {
    parts[parts.length - 2] += parts.pop();
  }
  // keep the original letters (case) in each piece
  const out = [];
  let k = 0;
  for (const p of parts) { out.push(word.slice(k, k + p.length)); k += p.length; }
  if (k < word.length) out[out.length - 1] += word.slice(k);
  return out;
}

// text -> [{text, lineStart}]
export function syllabify(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/[\(\)\[\]「」『』"“”]/g, " ").trim();
    if (!line) continue;
    let first = true;
    for (const word of line.split(/\s+/)) {
      const w = word.replace(/[.,!?~…·:;]+$/g, "").replace(/^[.,!?~…·:;]+/g, "");
      if (!w) continue;
      let units = [];
      if (/^[A-Za-z']+$/.test(w)) units = englishSyllables(w);
      else {
        for (const ch of w) {
          if (/[぀-ヿ]/.test(ch) && SMALL.has(ch) && units.length) units[units.length - 1] += ch;
          else if (/[A-Za-z']/.test(ch) && units.length && /[A-Za-z']$/.test(units[units.length - 1])) units[units.length - 1] += ch;
          else units.push(ch);
        }
      }
      for (const u of units) { out.push({ text: u, lineStart: first }); first = false; }
    }
  }
  return out;
}

// longest common subsequence pairs between two string arrays
function lcsPairs(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m || n * m > 4e6) return [];
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

// score + pasted text -> lyrics events, or throws with a Korean message
export function alignLyrics(score, text, trackIndex = 0) {
  const units = syllabify(text);
  if (!units.length) throw new Error("붙여 넣은 가사가 없음");
  const spb = score.stepsPerBeat;
  const track = score.tracks[trackIndex];
  if (!track || !track.notes.length) throw new Error("맞출 멜로디 음이 없음");
  const notes = [...track.notes].sort((x, y) => x.col - y.col);
  // candidate places: every note start, and every 8th inside long notes (a syllable can start mid-note)
  const cand = [];
  let prevEnd = -1e9;
  for (const n of notes) {
    if (cand.length && cand[cand.length - 1].col === n.col) continue;
    cand.push({ col: n.col, pen: 0, gap: n.col - prevEnd });
    for (let c = n.col + 2; c < n.col + n.len; c += 2) cand.push({ col: c, pen: 0.6, gap: 0 });
    prevEnd = Math.max(prevEnd, n.col + n.len);
  }
  const n = units.length, m = cand.length;
  if (n > m) throw new Error(`음절(${n})이 멜로디 자리(${m})보다 많음`);
  // anchors from the lyrics already in the score
  const old = [...score.lyrics].sort((x, y) => x.col - y.col);
  const anchor = new Array(n).fill(null);
  for (const [i, j] of lcsPairs(units.map((u) => u.text), old.map((e) => e.text))) anchor[i] = old[j].col;
  const cost = (i, j) => {
    const u = units[i], c = cand[j];
    let v = c.pen;
    if (anchor[i] !== null) v += Math.min(4, Math.abs(c.col - anchor[i]) / spb);
    if (u.lineStart) v += c.gap >= 2 ? -0.6 : 0.4;
    // inside a line a syllable does not jump over a long rest (4 bars and more): squeeze it onto the notes before
    else v += c.gap >= spb * 16 ? 5 : c.gap >= spb * 4 ? 1.5 : c.gap >= spb * 2 ? 0.6 : 0;
    return v;
  };
  const SKIP = 0.15;
  // A[i][j]: unit i on candidate j; best over j' < j of A[i-1][j'] + SKIP * (j - j' - 1)
  const A = Array.from({ length: n }, () => new Float64Array(m).fill(Infinity));
  const back = Array.from({ length: n }, () => new Int32Array(m).fill(-1));
  for (let j = 0; j <= m - n; j++) A[0][j] = cost(0, j) + SKIP * j;
  for (let i = 1; i < n; i++) {
    let best = Infinity, bestK = -1;
    for (let j = i; j <= m - (n - i); j++) {
      const k = j - 1;
      const v = A[i - 1][k] - SKIP * k;
      if (v < best) { best = v; bestK = k; }
      if (best === Infinity) continue;
      A[i][j] = cost(i, j) + best + SKIP * (j - 1);
      back[i][j] = bestK;
    }
  }
  let j = -1, bv = Infinity;
  for (let k = n - 1; k < m; k++) { const v = A[n - 1][k] + SKIP * (m - 1 - k); if (v < bv) { bv = v; j = k; } }
  const cols = new Array(n);
  for (let i = n - 1; i >= 0; i--) { cols[i] = cand[j].col; j = back[i][j]; }
  return units.map((u, i) => ({ col: cols[i], text: u.text }));
}
