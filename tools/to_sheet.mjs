// Convert a transcription / SPRED JSON into an ukulele-sheet JSON (melody put on strings and frets).
// usage: node tools/to_sheet.mjs <in.json> <out.json> [standard|low-g]
import { readFileSync, writeFileSync } from "node:fs";
import { loadAnyFormat, toJSON } from "../js/model.js";

const [inp, out, tuning = "standard"] = process.argv.slice(2);
if (!inp || !out) { console.error("usage: node tools/to_sheet.mjs <in.json> <out.json> [standard|low-g]"); process.exit(2); }
const obj = JSON.parse(readFileSync(inp, "utf8"));
const s = loadAnyFormat(obj, { tuning });
// like SPRED, only the first track plays by default; the others stay in the file for later
s.tracks.forEach((t, i) => { if (i > 0) { t.hidden = true; t.muted = true; } });
writeFileSync(out, toJSON(s));
const rep = (s.importReport || []).map((r) => `${r.track}: ${r.notes}음${r.shift ? ` 옥타브 ${r.shift / 12}` : ""}${r.folded ? ` 접은 음 ${r.folded}` : ""}`).join(", ");
console.log(`${s.meta.title} | 코드 ${s.chords.length} 가사 ${s.lyrics.length} | ${rep}`);
