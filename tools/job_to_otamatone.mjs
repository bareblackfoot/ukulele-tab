// A song transcribed from its recording (bridge/transcribe.py: <job>/result.json) into my otamatone library as
// "<title> - <artist>.ota.json": the melody at its pitch on the otamatone (moved by whole octaves to fit the stem,
// E3 to C#6), named as SPRED's tracks: the sung melody is the song melody (basic) and the instrument line heard
// where nobody sings is the accompaniment melody (optional); an instrumental piece has only the instrument line,
// and that is its song melody. A sheet already there goes to 이전판 first.
//
//   node tools/job_to_otamatone.mjs <job dir | transcription .json> --title "베토벤 바이러스" --artist "BanYa" [--octave 0] [--out <folder>] [--dry]
// --octave: move the melody by that many octaves (default: as many as fit the stem best; with a number, notes off
// the stem fold back an octave one by one)

import fs from "node:fs";
import path from "node:path";
import { fromTranscription, toJSON, midiOf } from "../js/model.js";

const args = process.argv.slice(2);
const opt = (k, d = "") => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const job = args[0];
const dry = args.includes("--dry");
const out = opt("--out", "G:\\내 드라이브\\2.취미생활\\오타마톤\\악보");
const o = JSON.parse(fs.readFileSync(job.endsWith(".json") ? job : path.join(job, "result.json"), "utf-8"));
if (!o.format || o.format.name !== "ukulele-transcription") throw new Error(`${job}/result.json is not a transcription`);
const s = fromTranscription(o, { tuning: "otamatone", ...(args.includes("--octave") ? { octaveShift: Number(opt("--octave")) } : {}) });
const report = s.importReport || [];
delete s.importReport;
s.meta.title = opt("--title", s.meta.title);
s.meta.artist = opt("--artist", s.meta.artist);
s.meta.source = o.meta && o.meta.source && !/자동 채보$/.test(o.meta.source) ? o.meta.source
  : `녹음에서 자동 채보 (${o.youtube && o.youtube.videoId ? `유튜브 ${o.youtube.videoId}` : "녹음"})`;
s.lyrics = [];
// the song melody first: the sung line when there is one, else the instrument line
const sung = s.tracks.filter((t) => t.id !== "inst" && t.notes.length >= 20);
const inst = s.tracks.filter((t) => t.id === "inst" && t.notes.length);
const main = sung[0] || inst[0];
if (!main) throw new Error("no melody in the transcription");
const rest = s.tracks.filter((t) => t !== main && t.notes.length && (t.id === "inst"));
main.id = "basic";
main.name = "노래 멜로디 (basic)";
rest.forEach((t) => { t.id = "optional"; t.name = "반주 멜로디 (optional)"; });
s.tracks = [main, ...rest];
const clean = (x) => String(x || "").replace(/[\\/:*?"<>|]/g, "_").trim();
const name = `${clean(s.meta.title)}${s.meta.artist ? " - " + clean(s.meta.artist) : ""}.ota.json`;
const ms = s.tracks.flatMap((t) => t.notes.map((x) => midiOf(x, s.tuning)));
console.log(`${name}: ${s.tracks.map((t) => `${t.id} ${t.notes.length}음`).join(", ")}, 음 ${Math.min(...ms)}~${Math.max(...ms)}, ` +
  `옥타브 옮김 ${report.map((r) => `${r.track} ${r.shift}`).join(" · ")}, 음역 밖이라 접은 음 ${report.reduce((a, r) => a + r.folded, 0)}개, ` +
  `템포 ${s.tempo.map((t) => t.bpm).join("/")}, 영상 ${s.youtube.videoId || "없음"}`);
if (!dry) {
  const d = new Date(), z = (v) => String(v).padStart(2, "0");
  const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
  const dest = path.join(out, name);
  if (fs.existsSync(dest)) {
    fs.mkdirSync(path.join(out, "이전판"), { recursive: true });
    fs.copyFileSync(dest, path.join(out, "이전판", name.replace(/\.ota\.json$/, `_${stamp}.ota.json`)));
  }
  fs.writeFileSync(dest, toJSON(s), "utf-8");
  console.log(`저장: ${dest}`);
}
