// Make guitar copies of the sheets in my ukulele library: same sound, the capo where the guitar chord shapes are
// easiest, the melody placed again on the guitar strings (js/model.js toInstrument). An existing guitar sheet of
// the same name is moved to 이전판 first.
//
//   node tools/to_guitar.mjs [--dry] [--only <part of a file name>] [--capo <file part>=<n> ...]
//
// --capo fixes the capo of one song instead of the easiest one.

import fs from "node:fs";
import path from "node:path";
import { loadAnyFormat, toInstrument, toJSON } from "../js/model.js";
import { chordShape, shapeDifficulty } from "../js/chords.js";

const UKE = process.env.UKE_LIBRARY || "G:/내 드라이브/2.취미생활/우쿨렐레/악보";
const GTR = process.env.GUITAR_LIBRARY || "G:/내 드라이브/2.취미생활/기타/악보";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const fixed = [];
args.forEach((a, i) => { if (a === "--capo") { const [k, v] = args[i + 1].split("="); fixed.push({ k, capo: +v }); } });

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const cost = (s) => [...new Set(s.chords.map((c) => c.name).filter((n) => n !== "N.C."))]
  .reduce((a, n) => a + shapeDifficulty(chordShape(n, s.tuning, s.chordShapes)), 0);

if (!dry) fs.mkdirSync(GTR, { recursive: true });
const files = fs.readdirSync(UKE).filter((f) => f.endsWith(".json") && (!only || f.includes(only))).sort();
const rows = [];
for (const f of files) {
  const uke = loadAnyFormat(JSON.parse(fs.readFileSync(path.join(UKE, f), "utf-8")), { keepInstrument: true });
  const fx = fixed.find((x) => f.includes(x.k));
  const g = toInstrument(uke, "guitar", fx ? fx.capo : null);
  const missing = [...new Set(g.chords.map((c) => c.name))].filter((n) => n !== "N.C." && !chordShape(n, "guitar"));
  const name = f.replace(/\.uke\.json$/i, ".json").replace(/\.json$/i, ".guitar.json");
  rows.push({ f: name, title: uke.meta.title, ukeCapo: uke.capo, capo: g.capo, ukeCost: cost(uke).toFixed(1), cost: cost(g).toFixed(1),
    chords: [...new Set(g.chords.map((c) => c.name))].filter((n) => n !== "N.C.").join(" "), missing });
  if (dry) continue;
  const out = path.join(GTR, name);
  if (fs.existsSync(out)) {
    fs.mkdirSync(path.join(GTR, "이전판"), { recursive: true });
    fs.renameSync(out, path.join(GTR, "이전판", name.replace(/\.json$/, `_${stamp()}.json`)));
  }
  g.meta.source = [uke.meta.source, "우쿨렐레 악보에서 기타로 옮김"].filter(Boolean).join(" · ");
  fs.writeFileSync(out, toJSON(g), "utf-8");
}
for (const r of rows) {
  console.log(`${r.title.slice(0, 34).padEnd(34)} 우쿨렐레 카포 ${r.ukeCapo} -> 기타 카포 ${r.capo}  난이도 ${r.ukeCost} -> ${r.cost}  ${r.chords}${r.missing.length ? "  운지 없음: " + r.missing.join(",") : ""}`);
}
console.log(`${rows.length}곡${dry ? " (쓰지 않음)" : ` -> ${GTR}`}`);
