// Place lyrics on a melody with the page's own aligner (js/lyrics.js), for build scripts.
// usage: node tools/align_lyrics.mjs <in.json>   in: {stepsPerBeat, notes:[{col,len}], anchors:[{col,text}], text}
// prints [{col, text}] as JSON
import { readFileSync } from "node:fs";
import { alignLyrics } from "../js/lyrics.js";

const inp = JSON.parse(readFileSync(process.argv[2], "utf8"));
const score = { stepsPerBeat: inp.stepsPerBeat, tracks: [{ notes: inp.notes }], lyrics: inp.anchors || [] };
process.stdout.write(JSON.stringify(alignLyrics(score, inp.text, 0)));
