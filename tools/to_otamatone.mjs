// SPRED sheets (the maker's examples, or my own) into my otamatone library: each becomes "<title> - <artist>.ota.json"
// in the otamatone folder, notes at their pitch on the otamatone tuning, the three SPRED tracks named. A sheet
// already there goes to 이전판 first.
//
//   node tools/to_otamatone.mjs <SPRED folder or file> [--out "G:\내 드라이브\2.취미생활\오타마톤\악보"] [--dry]

import fs from "node:fs";
import path from "node:path";
import { fromSpred, toJSON, midiOf } from "../js/model.js";

const args = process.argv.slice(2);
const src = args[0];
const dry = args.includes("--dry");
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "G:\\내 드라이브\\2.취미생활\\오타마톤\\악보";
const files = fs.statSync(src).isDirectory()
  ? fs.readdirSync(src).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => path.join(src, f))
  : [src];
const clean = (x) => String(x || "").replace(/[\\/:*?"<>|]/g, "_").trim();
const d = new Date(), z = (v) => String(v).padStart(2, "0");
const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
if (!dry) fs.mkdirSync(out, { recursive: true });
let n = 0;
for (const f of files) {
  const o = JSON.parse(fs.readFileSync(f, "utf-8"));
  if (!o.format || o.format.formatName !== "spred-sheet") { console.log("SPRED 악보 아님, 건너뜀:", path.basename(f)); continue; }
  const s = fromSpred(o, { tuning: "otamatone", octaveShift: 0 });
  const folded = (s.importReport || []).reduce((a, r) => a + r.folded, 0);
  delete s.importReport;
  const name = `${clean(s.meta.title) || path.basename(f, ".json")}${s.meta.artist ? " - " + clean(s.meta.artist) : ""}.ota.json`;
  const ms = s.tracks.flatMap((t) => t.notes.map((x) => midiOf(x, s.tuning)));
  console.log(`${name}: ${s.tracks.map((t) => `${t.id} ${t.notes.length}음`).join(", ")}, 음 ${Math.min(...ms)}~${Math.max(...ms)}` +
    `${folded ? `, 음역 밖이라 옥타브를 옮긴 음 ${folded}개` : ""}, 영상 ${s.youtube.videoId || "없음"}`);
  if (dry) continue;
  const dest = path.join(out, name);
  if (fs.existsSync(dest)) {
    fs.mkdirSync(path.join(out, "이전판"), { recursive: true });
    fs.copyFileSync(dest, path.join(out, "이전판", name.replace(/\.ota\.json$/, `_${stamp}.ota.json`)));
  }
  fs.writeFileSync(dest, toJSON(s), "utf-8");
  n++;
}
console.log(dry ? "(시험, 저장 안 함)" : `${n}곡 저장: ${out}`);
