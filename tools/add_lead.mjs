// Put a lead line taken from the recording (bridge/server/lead_track.py -> lead.json) into a sheet as its own track:
// note times -> the sheet's columns (score time = video time + youtube.offsetMs / 1000), pitches on the strings at
// the recording's pitch in a hand position up the neck, playing marks kept. The old sheet goes to 이전판.
//
//   node tools/add_lead.mjs <sheet.json> <lead.json> [--name "기타 솔로"] [--extra <track id> --extra-name "..."] [--dry]
//
// --extra: a hand-made track of the same part (default "optional", the SPRED 반주 멜로디). Bends and vibrato
// found in the recording are copied onto its notes where the same note (pitch class) starts within 120 ms, and it
// is marked absolute (played at its written pitch) and placed up the neck. Its name becomes --extra-name.
//
// Prints how the notes compare with the sheet's other extra tracks in the same time ranges (pitch classes in
// order, longest common part) so a wrong take shows up.

import fs from "node:fs";
import path from "node:path";
import { normalizeScore, TimeMap, toJSON, midiOf } from "../js/model.js";
import { melodyToTab } from "../js/fingering.js";

const args = process.argv.slice(2);
const [sheetPath, leadPath] = args;
const dry = args.includes("--dry");
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const name = opt("--name", "기타 솔로 (원곡에서 자동으로 딴 것)");
const extraId = opt("--extra", "optional");
const extraName = opt("--extra-name", "기타 솔로·간주 (사람이 만든 악보)");

const s = normalizeScore(JSON.parse(fs.readFileSync(sheetPath, "utf-8")));
const lead = JSON.parse(fs.readFileSync(leadPath, "utf-8"));
const tm = new TimeMap(s);
const off = (s.youtube.offsetMs || 0) / 1000;
const capo = s.capo || 0;
const colOf = (t) => Math.round(tm.timeToCol(t + off));

// one note per column, each cut where the next starts
const raw = lead.notes.map((n) => ({ col: colOf(n.t0), end: colOf(n.t1), midi: n.midi - capo, tech: n.tech }))
  .filter((n) => n.col >= 0 && n.col < s.columnCount).sort((a, b) => a.col - b.col);
const mel = [];
for (const n of raw) {
  const last = mel[mel.length - 1];
  if (last && last.col === n.col) { if (n.end - n.col > last.end - last.col) Object.assign(last, n); continue; }
  mel.push({ ...n });
}
mel.forEach((n, i) => {
  const next = mel[i + 1];
  n.len = Math.max(1, Math.min(n.end, next ? next.col : n.end) - n.col);
  delete n.end;
});
const res = melodyToTab(mel, s.tuning, 0, { lead: true, maxFret: 22 });

// compare with the other extra tracks inside the lead's ranges
const pcs = (notes, tuning) => notes.map((n) => ((midiOf(n, tuning, capo) % 12) + 12) % 12);
const lcs = (a, b) => {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  return dp[0][0];
};
const lo = Math.min(...res.notes.map((n) => n.col)), hi = Math.max(...res.notes.map((n) => n.col));
for (const t of s.tracks.slice(1).filter((t) => t.id !== "lead")) {
  const inside = t.notes.filter((n) => n.col >= lo && n.col <= hi);
  if (!inside.length) continue;
  const a = pcs(res.notes, s.tuning), b = pcs(inside, s.tuning);
  const starts = new Set(inside.map((n) => n.col));
  const sameStart = res.notes.filter((n) => [-1, 0, 1].some((d) => starts.has(n.col + d))).length;
  console.log(`«${t.name}» ${inside.length}음과 비교: 음이름 순서 일치 ${lcs(a, b)}음 (새 트랙 ${a.length}음 중 ${Math.round((100 * lcs(a, b)) / a.length)}%), ` +
    `시작 칸이 한 칸 안으로 같은 음 ${sameStart}`);
}
const tech = {};
for (const n of res.notes) if (n.tech) tech[n.tech] = (tech[n.tech] || 0) + 1;
const frets = res.notes.map((n) => n.fret).sort((a, b) => a - b);
console.log(`새 트랙 «${name}»: ${res.notes.length}음, 프렛 ${frets[0]}~${frets[frets.length - 1]} (중앙 ${frets[frets.length >> 1]}), 기법 ${JSON.stringify(tech)}, 분리한 소리 ${lead.stem}`);
if (dry) process.exit(0);

const out = JSON.parse(toJSON(s));
const extra = out.tracks.find((t) => t.id === extraId);
if (extra) {
  let copied = 0;
  const mel = extra.notes.map((n) => {
    const t = tm.colToTime(n.col) - off, m = midiOf(n, s.tuning, capo);
    const hit = lead.notes.find((x) => /^(b1|b2|v)$/.test(x.tech || "") && Math.abs(x.t0 - t) <= 0.12 && (((x.midi - m) % 12) + 12) % 12 === 0);
    if (hit && !n.tech) copied++;
    return { col: n.col, len: n.len, midi: m - capo, tech: n.tech || (hit ? hit.tech : undefined) };
  });
  extra.notes = melodyToTab(mel, s.tuning, 0, { lead: true, maxFret: 22 }).notes;
  extra.absolute = true;
  extra.name = extraName;
  console.log(`«${extraName}»: 원곡에서 찾은 벤딩·비브라토 ${copied}곳을 옮겨 붙임`);
}
out.tracks = out.tracks.filter((t) => t.id !== "lead");
out.tracks.push({ id: "lead", name, absolute: true, notes: res.notes });
const dir = path.dirname(sheetPath), base = path.basename(sheetPath);
fs.mkdirSync(path.join(dir, "이전판"), { recursive: true });
const d = new Date(), z = (v) => String(v).padStart(2, "0");
const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
fs.copyFileSync(sheetPath, path.join(dir, "이전판", base.replace(/\.json$/, `_${stamp}.json`)));
fs.writeFileSync(sheetPath, toJSON(normalizeScore(out)), "utf-8");
console.log("저장:", sheetPath);
