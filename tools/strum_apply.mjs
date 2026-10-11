// Put the recording's strum profile into a sheet and set the suggested strum pattern for every bar.
// usage: node tools/strum_apply.mjs <sheet.uke.json> <sync.json> [--ukulele] [--dry]
//   --ukulele  the recording is a ukulele playing alone, so its accompaniment shows the actual strums
// The previous file goes to the 이전판 folder next to the sheet. Prints the pattern of every bar.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { normalizeScore, toJSON, computeBars } from "../js/model.js";
import { recommendStrums, toStrumEvents, strumName } from "../js/strumfit.js";

const [sheetPath, syncPath, ...flags] = process.argv.slice(2);
const kind = flags.includes("--ukulele") ? "ukulele" : "band";
const raw = JSON.parse(readFileSync(sheetPath, "utf8"));
const sync = JSON.parse(readFileSync(syncPath, "utf8"));
const score = normalizeScore({ ...raw, strumProfile: sync.strum_profile, strumProfileKind: kind });
const rec = recommendStrums(score);
const { pattern, strums } = toStrumEvents(score, rec.perBar, rec.base);
const bars = computeBars(score);
const line = rec.perBar.map((p, i) => `${i + 1}:${p ?? "·"}`);
console.log(`${score.meta.title}: 기본 ${strumName(pattern)} (${pattern}), 바뀌는 곳 ${strums.length}, 근거 ${rec.source}`);
for (let i = 0; i < line.length; i += 8) console.log("  " + line.slice(i, i + 8).join("  "));
if (!flags.includes("--dry")) {
  const out = { ...raw, strum: { pattern }, strums, strumProfile: sync.strum_profile, strumProfileKind: kind };
  const old = join(dirname(sheetPath), "이전판");
  mkdirSync(old, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  renameSync(sheetPath, join(old, `${basename(sheetPath, ".json")}_${stamp}.json`));
  writeFileSync(sheetPath, JSON.stringify(out, null, 1));
  console.log("  저장:", basename(sheetPath), `(${bars.length}마디)`);
}
